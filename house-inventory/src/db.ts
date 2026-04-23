/**
 * SQLite layer.
 *
 * The database lives at `${DATA_DIR}/inventory.db`. In the add-on that's
 * `/data/inventory.db`, which HA's backup includes automatically.
 *
 * Migrations are plain SQL strings, applied in order, each wrapped in a
 * transaction, tracked in the `schema_migrations` table. Keep them append-only —
 * never edit a migration once it has shipped.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE areas (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        floor_id TEXT,
        icon TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE assets (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK(source IN ('home_assistant','manual')),
        ha_device_id TEXT UNIQUE,
        name TEXT NOT NULL,
        manufacturer TEXT,
        model TEXT,
        model_id TEXT,
        sw_version TEXT,
        hw_version TEXT,
        serial_number TEXT,
        area_id TEXT REFERENCES areas(id) ON DELETE SET NULL,
        category TEXT,
        purchase_date TEXT,
        purchase_price_cents INTEGER,
        warranty_until TEXT,
        notes TEXT,
        hidden INTEGER NOT NULL DEFAULT 0,
        hidden_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT
      );

      CREATE INDEX idx_assets_manufacturer_model ON assets(manufacturer, model);
      CREATE INDEX idx_assets_area ON assets(area_id);
      CREATE INDEX idx_assets_hidden ON assets(hidden);

      CREATE TABLE asset_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('manual','support','product','firmware','parts','datasheet','other')),
        url TEXT NOT NULL,
        title TEXT,
        fetched_at TEXT NOT NULL,
        UNIQUE(asset_id, kind, url)
      );
      CREATE INDEX idx_asset_links_asset ON asset_links(asset_id);

      CREATE TABLE asset_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        local_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        downloaded_at TEXT NOT NULL
      );
      CREATE INDEX idx_asset_files_asset ON asset_files(asset_id);
      CREATE INDEX idx_asset_files_sha ON asset_files(sha256);

      CREATE TABLE ha_sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        devices_added INTEGER NOT NULL DEFAULT 0,
        devices_updated INTEGER NOT NULL DEFAULT 0,
        devices_hidden INTEGER NOT NULL DEFAULT 0,
        areas_upserted INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );

      CREATE TABLE enrichment_cache (
        key TEXT PRIMARY KEY,
        manufacturer TEXT NOT NULL,
        model TEXT NOT NULL,
        data_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        expires_at TEXT
      );
    `,
  },
  {
    version: 2,
    name: "settings_kv",
    sql: `
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 3,
    name: "asset_enrichment_state",
    sql: `
      ALTER TABLE assets ADD COLUMN last_enrichment_attempt_at TEXT;
      ALTER TABLE assets ADD COLUMN last_enrichment_success_at TEXT;
      ALTER TABLE assets ADD COLUMN last_enrichment_error TEXT;
      ALTER TABLE assets ADD COLUMN enrichment_attempts INTEGER NOT NULL DEFAULT 0;

      -- Index the filter the queue uses heavily: physical assets that still
      -- need enrichment, oldest-attempted first.
      CREATE INDEX idx_assets_enrichment_queue
        ON assets(hidden, last_enrichment_attempt_at)
        WHERE hidden = 0
          AND manufacturer IS NOT NULL
          AND model IS NOT NULL;
    `,
  },
  {
    version: 4,
    name: "sync_removal_stats",
    sql: `
      ALTER TABLE ha_sync_log ADD COLUMN devices_removed INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE ha_sync_log ADD COLUMN devices_restored INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 5,
    name: "floors",
    sql: `
      -- HA's floor registry: a floor groups a set of areas (e.g.
      -- 'apartment' floor with 'kitchen', 'bedroom', etc.). We already
      -- store floor_id on areas; this table gives us a name + icon +
      -- level ordering to render a grouped "Areas" page.
      CREATE TABLE floors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT,
        level INTEGER,
        updated_at TEXT NOT NULL
      );
    `,
  },
];

export function openDatabase(dataDir: string): Database {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, "inventory.db");
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA synchronous = NORMAL;");
  runMigrations(db);
  return db;
}

function runMigrations(db: Database): void {
  // Bootstrap: schema_migrations is itself created by migration 1, so probe
  // with a cheap check rather than querying a table that may not exist.
  const hasMigrationsTable = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .get();

  const appliedVersions = new Set<number>();
  if (hasMigrationsTable) {
    const rows = db
      .query<{ version: number }, []>(
        "SELECT version FROM schema_migrations ORDER BY version",
      )
      .all();
    for (const r of rows) appliedVersions.add(r.version);
  }

  for (const m of MIGRATIONS) {
    if (appliedVersions.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.run(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        [m.version, m.name, new Date().toISOString()],
      );
    })();
    // eslint-disable-next-line no-console
    console.log(`[db] applied migration ${m.version} ${m.name}`);
  }
}
