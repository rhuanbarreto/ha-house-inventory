/**
 * Tests for the database migration system.
 *
 * Verifies that all migrations apply cleanly on a fresh database
 * and produce the expected schema.
 */

import { describe, expect, test } from "bun:test";
import { openDatabase } from "../db.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Best-effort cleanup — Windows may lock WAL/SHM files briefly after close. */
function tryCleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Temp dir will be cleaned up by the OS eventually.
  }
}

function withTempDb(fn: (db: ReturnType<typeof openDatabase>) => void) {
  const dir = mkdtempSync(join(tmpdir(), "hi-test-"));
  const db = openDatabase(dir);
  try {
    fn(db);
  } finally {
    db.close();
    tryCleanup(dir);
  }
}

describe("openDatabase", () => {
  test("creates database and applies all migrations", () => {
    withTempDb((db) => {
      const migrations = db
        .query<{ version: number; name: string }, []>(
          "SELECT version, name FROM schema_migrations ORDER BY version",
        )
        .all();

      // Must have at least the 5 initial migrations
      expect(migrations.length).toBeGreaterThanOrEqual(5);
      expect(migrations[0]?.name).toBe("initial_schema");
      expect(migrations[1]?.name).toBe("settings_kv");
      expect(migrations[2]?.name).toBe("asset_enrichment_state");
      expect(migrations[3]?.name).toBe("sync_removal_stats");
      expect(migrations[4]?.name).toBe("floors");
    });
  });

  test("creates all expected tables", () => {
    withTempDb((db) => {
      const tables = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all()
        .map((r) => r.name);

      expect(tables).toContain("assets");
      expect(tables).toContain("areas");
      expect(tables).toContain("floors");
      expect(tables).toContain("asset_links");
      expect(tables).toContain("asset_files");
      expect(tables).toContain("ha_sync_log");
      expect(tables).toContain("enrichment_cache");
      expect(tables).toContain("settings");
      expect(tables).toContain("schema_migrations");
    });
  });

  test("WAL mode is enabled", () => {
    withTempDb((db) => {
      const mode = db
        .query<{ journal_mode: string }, []>("PRAGMA journal_mode")
        .get();
      expect(mode?.journal_mode).toBe("wal");
    });
  });

  test("foreign keys are enabled", () => {
    withTempDb((db) => {
      const fk = db
        .query<{ foreign_keys: number }, []>("PRAGMA foreign_keys")
        .get();
      expect(fk?.foreign_keys).toBe(1);
    });
  });

  test("idempotent — running openDatabase twice on the same dir is safe", () => {
    const dir = mkdtempSync(join(tmpdir(), "hi-test-"));
    try {
      const db1 = openDatabase(dir);
      db1.close();
      // Second open should not throw or re-apply migrations
      const db2 = openDatabase(dir);
      const migrations = db2
        .query<{ version: number }, []>(
          "SELECT version FROM schema_migrations ORDER BY version",
        )
        .all();
      expect(migrations.length).toBeGreaterThanOrEqual(5);
      db2.close();
    } finally {
      tryCleanup(dir);
    }
  });

  test("assets table has enrichment state columns from migration 3", () => {
    withTempDb((db) => {
      // Insert a row and verify enrichment columns exist
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO assets (id, source, name, hidden, created_at, updated_at)
         VALUES ('test1', 'manual', 'Test', 0, ?, ?)`,
        [now, now],
      );
      const row = db
        .query<
          {
            last_enrichment_attempt_at: string | null;
            last_enrichment_success_at: string | null;
            last_enrichment_error: string | null;
            enrichment_attempts: number;
          },
          [string]
        >(
          `SELECT last_enrichment_attempt_at, last_enrichment_success_at,
                  last_enrichment_error, enrichment_attempts
           FROM assets WHERE id = ?`,
        )
        .get("test1");

      expect(row).not.toBeNull();
      expect(row?.last_enrichment_attempt_at).toBeNull();
      expect(row?.enrichment_attempts).toBe(0);
    });
  });

  test("cascade delete removes asset_links when asset is deleted", () => {
    withTempDb((db) => {
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO assets (id, source, name, hidden, created_at, updated_at)
         VALUES ('test1', 'manual', 'Test', 0, ?, ?)`,
        [now, now],
      );
      db.run(
        `INSERT INTO asset_links (asset_id, kind, url, fetched_at)
         VALUES ('test1', 'manual', 'https://example.com/manual.pdf', ?)`,
        [now],
      );

      // Verify link exists
      const before = db
        .query<{ id: number }, []>(
          "SELECT id FROM asset_links WHERE asset_id = 'test1'",
        )
        .all();
      expect(before.length).toBe(1);

      // Delete asset
      db.run("DELETE FROM assets WHERE id = 'test1'");

      // Verify link was cascade-deleted
      const after = db
        .query<{ id: number }, []>(
          "SELECT id FROM asset_links WHERE asset_id = 'test1'",
        )
        .all();
      expect(after.length).toBe(0);
    });
  });
});
