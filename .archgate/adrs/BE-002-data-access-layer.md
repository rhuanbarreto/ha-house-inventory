---
id: BE-002
title: Data Access Layer
domain: backend
rules: false
files:
  - "house-inventory/src/db.ts"
  - "house-inventory/src/settings.ts"
  - "house-inventory/src/sync.ts"
  - "house-inventory/src/enrich.ts"
  - "house-inventory/src/enrich-batch.ts"
---

# Data Access Layer

## Context

House Inventory stores all persistent state — asset records, enrichment results, downloaded manual files, sync history, and user settings — in a SQLite database on the `/data` volume. The data access patterns are straightforward: CRUD operations on ~9 tables, periodic bulk upserts during HA registry sync, and a per-model enrichment cache. The data layer choice affects query performance on resource-constrained hardware, data safety during unclean shutdowns, and the ease of adding new tables as features grow.

Without a standardized data access approach, the project risks:

1. **Data corruption on crash** — SQLite's default `DELETE` journal mode is slower and less crash-resilient than WAL for the concurrent-read/single-writer pattern this add-on uses. An unclean shutdown (power loss, OOM kill, s6-overlay `SIGTERM`) could leave the database in an inconsistent state.
2. **Migration conflicts** — editing a previously shipped migration changes the SQL that runs on existing installations (which have already applied it), potentially leaving the schema out of sync between old and new users.
3. **Performance regression in sync** — the HA registry sync upserts 150+ devices in a single pass. Without prepared statements and a wrapping transaction, each upsert would be an individual disk write, making sync take seconds instead of milliseconds.
4. **ORM abstraction leaks** — ORMs like Prisma or Drizzle add a generation step, a query engine, and a schema DSL. For a project with 9 tables and inline SQL queries, the abstraction adds dependency weight and indirection without reducing complexity.

### Alternatives Considered

- **Prisma**: Full-featured ORM with schema-as-code, migration generation, and a typed query builder. However, it requires a generation step (`prisma generate`), ships a query engine binary (~15 MB), and does not support `bun:sqlite` natively — it would need the `@prisma/adapter-libsql` or a PostgreSQL sidecar. Overkill for 9 tables.
- **Drizzle ORM**: Lightweight, TypeScript-native ORM with SQLite support. Closer to raw SQL than Prisma, but still adds a schema DSL, a migration generator, and a dependency. For this project's query complexity (simple SELECTs and INSERT ON CONFLICT), Drizzle's typed query builder adds indirection without reducing boilerplate.
- **better-sqlite3**: The standard Node.js synchronous SQLite driver. Well-proven, but it is a native C++ addon that requires node-gyp compilation. Bun ships `bun:sqlite` as a built-in — no native compilation, no additional dependency, and it is included in the `bun build --compile` binary automatically.
- **bun:sqlite (inline SQL)**: Bun's built-in SQLite driver. Zero dependencies, synchronous API (natural for SQLite's single-writer model), supports typed queries via `db.query<Row, Params>()`, and is included in the compiled binary. The trade-off is that all SQL is inline strings with no schema-level type generation — type safety depends on manual `<Row>` type annotations.

For House Inventory, `bun:sqlite` with inline SQL is the clear fit: zero dependencies, zero build steps, included in the compiled binary (see [ARCH-001](./ARCH-001-tech-stack-and-runtime.md)), and matched to the project's straightforward query patterns. The database lives on the `/data` volume (see [ARCH-002](./ARCH-002-ha-add-on-container-architecture.md)), ensuring persistence across container updates and inclusion in HA backups.

## Decision

All database access MUST use **`bun:sqlite`** with inline SQL queries. The database MUST be configured with **WAL journal mode**, **foreign keys ON**, and **synchronous NORMAL**. Schema changes MUST use **append-only migrations** tracked in the `schema_migrations` table — shipped migrations MUST NOT be edited. Multi-row write operations MUST be wrapped in **`db.transaction()`**.

### Scope

This ADR covers:
- The SQLite driver and query API used for database access
- The database PRAGMAs and configuration
- The migration system and append-only convention
- The transaction and prepared statement patterns
- The settings key-value store
- The enrichment cache model
- Data safety invariants (zero-device guard, soft-delete)

This ADR does NOT cover:
- The `/data` volume and backup configuration (see [ARCH-002](./ARCH-002-ha-add-on-container-architecture.md))
- The HTTP API routes that consume database queries (see [BE-001](./BE-001-backend-api-design.md))
- The Bun runtime or compilation (see [ARCH-001](./ARCH-001-tech-stack-and-runtime.md))

### Database Configuration

The `openDatabase()` function in `src/db.ts` MUST apply these PRAGMAs before returning:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
```

- **WAL mode**: Enables concurrent reads during writes and provides better crash recovery than the default `DELETE` mode. Essential for an add-on that runs background sync and enrichment while serving API reads.
- **Foreign keys ON**: Enforces referential integrity (e.g., `asset_links.asset_id` references `assets.id` with `ON DELETE CASCADE`). SQLite disables foreign keys by default; this MUST be explicitly enabled.
- **Synchronous NORMAL**: Balances durability and performance. In WAL mode, `NORMAL` is safe against data corruption on crash (committed transactions survive) while avoiding the ~10x write penalty of `FULL`.

### Migration System

Migrations are defined as an ordered array of `{ version: number, name: string, sql: string }` objects in `src/db.ts`. Each migration:

1. Has a monotonically increasing integer `version` (1, 2, 3, ...).
2. Contains one or more SQL statements in the `sql` string.
3. Is applied in a `db.transaction()`, with a row inserted into `schema_migrations` recording the version, name, and timestamp.
4. Is **append-only** — once shipped, a migration's SQL MUST NOT be modified. To change the schema, add a new migration with the next version number.

The `runMigrations()` function bootstraps by probing for the `schema_migrations` table (which is itself created by migration 1), then applies any migrations whose version is not yet recorded.

### Query Patterns

Two query APIs are used depending on the context:

- **`db.query<Row, Params>(sql)`**: Returns a prepared query object with `.get()`, `.all()`, and `.run()` methods. Used for one-shot typed reads in route handlers. The `Row` type parameter provides type-safe result access.
- **`db.prepare(sql)`**: Returns a persistent prepared statement. Used in hot paths (sync, batch enrichment) where the same statement is executed many times within a transaction.

### Data Safety Invariants

- **Zero-device guard**: During HA registry sync, if the HA API returns zero devices (a transient glitch), the removal pass is skipped entirely to avoid soft-hiding the entire inventory.
- **Soft-delete**: HA-sourced assets are never hard-deleted. When a device disappears from HA, it is set to `hidden = 1, hidden_reason = 'removed_from_ha'`. If the device reappears, it is auto-restored (hidden set back to 0) — but only if the `hidden_reason` is still `'removed_from_ha'` (a user-set reason wins).
- **Manual asset protection**: Only assets with `source = 'manual'` can be hard-deleted via the API. HA-sourced assets are protected from deletion.

### Settings Store

The `settings` table provides a simple key-value store via `getSetting(db, key)` and `setSetting(db, key, value)` in `src/settings.ts`. Currently used for `llm_entity_id` (the user's chosen AI Task entity). Settings persist across container restarts and are included in HA backups.

### Enrichment Cache

The `enrichment_cache` table caches LLM enrichment results keyed by normalized `manufacturer|model`. This means enriching one Netatmo Weather Station enriches all Netatmo Weather Stations for free. Cache entries have a 30-day TTL (`expires_at`). Expired entries are treated as cache misses.

## Do's and Don'ts

### Do

- **DO** use `import { Database } from "bun:sqlite"` for all database access. Pass the database path and `{ create: true }` to the constructor.
- **DO** set `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, and `PRAGMA synchronous = NORMAL` in `openDatabase()` before any queries.
- **DO** add new schema changes as a new migration with the next sequential version number. Never modify an existing migration's SQL.
- **DO** wrap multi-row write operations in `db.transaction()`. This includes the full HA registry sync (areas, devices, orphan detection) and batch enrichment link/file inserts.
- **DO** use `db.query<RowType, ParamType>(sql)` with explicit type parameters for typed reads. Define the row type inline or as a named interface when the query is complex.
- **DO** use `db.prepare(sql)` for statements executed repeatedly in a loop (e.g., upsert statements in the sync transaction).
- **DO** implement the zero-device guard: skip the orphan-removal pass if the HA API returns an empty device list, to prevent hiding the entire inventory on a transient glitch.
- **DO** use soft-delete (`hidden = 1` with `hidden_reason`) for HA-sourced assets instead of `DELETE`. Inventory data (links, files, notes) is valuable even if the device is temporarily removed from HA.
- **DO** normalize enrichment cache keys as `manufacturer.trim().toLowerCase() + "|" + model.trim().toLowerCase()` to ensure cache hits across case variations.

### Don't

- **DON'T** use an ORM (Prisma, Drizzle, TypeORM, Sequelize, Knex). The project uses inline SQL with `bun:sqlite` for all database access.
- **DON'T** edit a shipped migration. If migration 3 needs a fix, add migration 6 with an `ALTER TABLE` or corrective statement. The original migration 3 MUST remain unchanged.
- **DON'T** use `journal_mode = DELETE` or `synchronous = FULL`. WAL mode with `synchronous = NORMAL` provides the best balance of crash safety and write performance for this workload.
- **DON'T** store persistent data outside the `/data` directory. The database path MUST be `${DATA_DIR}/inventory.db` where `DATA_DIR` defaults to `/data` in production.
- **DON'T** hard-delete HA-sourced assets (`source = 'home_assistant'`). Use the soft-delete pattern (`hidden = 1, hidden_reason`) instead. Only `source = 'manual'` assets may be hard-deleted.
- **DON'T** run multi-row writes without a wrapping transaction. Individual writes without a transaction cause a disk sync per row, degrading sync performance from milliseconds to seconds on SD-card storage.
- **DON'T** skip the `schema_migrations` table check in `runMigrations()`. The bootstrap probe (`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`) handles the first-run case where the table does not yet exist.

## Implementation Pattern

### Migration Definition

```typescript
// Good: append-only — add a new version, never edit an old one
const MIGRATIONS: Migration[] = [
  { version: 1, name: "initial_schema", sql: `CREATE TABLE ...` },
  { version: 2, name: "settings_kv", sql: `CREATE TABLE settings (...)` },
  // Version 3 shipped with a bug? Add version 6 to fix it:
  { version: 6, name: "fix_index_typo", sql: `DROP INDEX ...; CREATE INDEX ...` },
];
```

```typescript
// Bad: editing a shipped migration
const MIGRATIONS: Migration[] = [
  { version: 1, name: "initial_schema", sql: `CREATE TABLE ... /* EDITED! */` },
  //                                                              ^^^^^^^^
  // DON'T — this SQL already ran on existing installations. Editing it
  // has no effect on deployed databases and creates a schema mismatch.
];
```

### Transaction-Wrapped Bulk Operations

```typescript
// Good: all upserts in one transaction — one disk sync total
const tx = db.transaction(() => {
  const upsert = db.prepare(`INSERT INTO areas ... ON CONFLICT(id) DO UPDATE SET ...`);
  for (const area of areas) {
    upsert.run(area.id, area.name, area.floor_id, area.icon, now);
  }
});
tx();
```

```typescript
// Bad: no transaction — one disk sync per row, 150x slower on SD cards
for (const area of areas) {
  db.run(`INSERT INTO areas ... ON CONFLICT(id) DO UPDATE SET ...`,
    [area.id, area.name, area.floor_id, area.icon, now]);
}
```

### Typed Query Read

```typescript
// Good: explicit Row type parameter
const row = db
  .query<{ id: string; name: string; hidden: number }, [string]>(
    "SELECT id, name, hidden FROM assets WHERE id = ?",
  )
  .get(assetId);
```

### Zero-Device Guard

```typescript
// Good: skip removal if HA returned zero devices (transient glitch)
if (devices.length > 0) {
  // ... orphan detection and soft-hide logic ...
}
// If devices.length === 0, the removal pass is skipped entirely.
// The rest of the sync (areas, device upserts for the 0 devices) still runs.
```

## Consequences

### Positive

- **Zero dependencies:** `bun:sqlite` is built into Bun — no npm packages, no native compilation, no query engine binary. The database driver is included in the compiled binary automatically.
- **Crash-safe writes:** WAL mode with `synchronous = NORMAL` ensures committed transactions survive unclean shutdowns (power loss, OOM kill). This is critical for an add-on running on Raspberry Pi hardware with SD-card storage.
- **Fast bulk sync:** Prepared statements in a transaction enable 150+ device upserts in single-digit milliseconds. Without this, each upsert would trigger a disk sync, taking seconds on slow storage.
- **Type-safe reads:** `db.query<Row, Params>()` provides TypeScript-level type safety for query results without an ORM's code generation step.
- **Referential integrity:** `foreign_keys = ON` enforces `ON DELETE CASCADE` for `asset_links` and `asset_files`, preventing orphaned rows when an asset is deleted.
- **Transparent backups:** The database file at `/data/inventory.db` is included in HA snapshots automatically. Excluding WAL/SHM files via `backup_exclude` ensures clean restore.
- **Cross-model enrichment cache:** The normalized `manufacturer|model` cache key means enriching one instance of a product enriches all identical products for free, reducing LLM API calls.
- **Safe sync recovery:** The zero-device guard and soft-delete pattern protect the user's inventory from transient HA API failures and allow automatic recovery when devices reappear.

### Negative

- **No schema-level type generation:** Unlike Prisma or Drizzle, `bun:sqlite` does not generate TypeScript types from the schema. Row types must be manually defined and kept in sync with migrations. A column rename in a migration requires finding and updating all `db.query<Row>()` calls that reference it.
- **Inline SQL verbosity:** Complex queries (e.g., the dashboard aggregation with 7 subqueries) are long SQL strings embedded in TypeScript files. This makes the code harder to scan than ORM-style fluent builders.
- **Manual migration ordering:** The migration array in `db.ts` must be manually ordered by version number. A developer adding migration 6 must insert it at the correct position — the system does not auto-sort.
- **Single-writer limitation:** SQLite allows only one writer at a time. This is not a problem for the current single-process architecture, but would become a bottleneck if the backend ever scaled to multiple worker processes.

### Risks

- **Migration version collision:** Two developers working in parallel could both create migration version 6, causing a conflict on merge. **Mitigation:** The project is primarily solo-maintained. For contributions, the PR review process catches version collisions. The migration system treats duplicate versions as already-applied (idempotent skip), so the worst case is a missed migration, not data corruption.
- **SQLite file locking on NFS/CIFS:** Some HA installations use network-mounted storage. SQLite's file locking does not work reliably over NFS or CIFS, which can cause database corruption. **Mitigation:** The `/data` volume is local to the container by default. The project documentation does not endorse or support network-mounted data directories. WAL mode is more resilient than DELETE mode for transient lock issues.
- **Schema type drift:** If a migration adds or renames a column but the corresponding `db.query<Row>()` call is not updated, the TypeScript types will be wrong — the code compiles but returns `undefined` at runtime for the missing column. **Mitigation:** `noUncheckedIndexedAccess` (enforced by [ARCH-001](./ARCH-001-tech-stack-and-runtime.md)) catches some of these cases. Manual review of all query sites when modifying migrations is the primary safeguard.

## Compliance and Enforcement

### Automated Enforcement

- **TypeScript compilation:** `bun run typecheck` catches type mismatches in `db.query<Row>()` calls. If a query's row type does not match how the result is used, the compiler flags it.
- **Docker build:** The database initialization runs at startup. If a migration contains a SQL syntax error, the container fails to start and the health check fails, preventing the broken version from being served.
- **Foreign key enforcement:** `PRAGMA foreign_keys = ON` enforces referential integrity at the database level. An `INSERT` into `asset_links` with a non-existent `asset_id` fails with a constraint violation.

### Manual Enforcement

- **Code review — migration immutability:** Reviewers MUST verify that no existing migration in the `MIGRATIONS` array has been modified. Only new entries at the end of the array are permitted. Use `git diff` on `src/db.ts` to check.
- **Code review — transaction wrapping:** Reviewers MUST verify that any new code performing multiple writes (inserts, updates, deletes) wraps them in `db.transaction()`.
- **Code review — soft-delete:** Reviewers MUST verify that no code hard-deletes HA-sourced assets. Only `source = 'manual'` assets may be deleted with `DELETE FROM assets`.
- **Code review — typed queries:** Reviewers MUST verify that new `db.query()` calls include explicit `<Row, Params>` type parameters, not untyped `.get()` or `.all()`.

### Exceptions

If a future requirement demands a different database (e.g., PostgreSQL for multi-process writes), it MUST be proposed as a new ADR that supersedes this one. The migration system and append-only convention MUST be preserved regardless of the underlying database engine.

## References

- [ARCH-001 — Tech Stack and Runtime](./ARCH-001-tech-stack-and-runtime.md)
- [ARCH-002 — HA Add-on Container Architecture](./ARCH-002-ha-add-on-container-architecture.md)
- [BE-001 — Backend API Design](./BE-001-backend-api-design.md)
- [Bun — SQLite (bun:sqlite)](https://bun.sh/docs/api/sqlite)
- [SQLite — Write-Ahead Logging (WAL)](https://www.sqlite.org/wal.html)
- [SQLite — PRAGMA statements](https://www.sqlite.org/pragma.html)
- [SQLite — Foreign key support](https://www.sqlite.org/foreignkeys.html)
