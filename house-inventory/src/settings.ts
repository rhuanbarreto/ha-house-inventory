/**
 * Key-value settings persisted in SQLite.
 *
 * Unlike `Config` (which is read from env on boot), these values can be
 * changed at runtime via the UI / API and must survive restarts. Everything
 * in this module is a thin wrapper around the `settings` table.
 */

import type { Database } from "bun:sqlite";

export type SettingKey = "llm_entity_id";

export function getSetting(db: Database, key: SettingKey): string | null {
  const row = db
    .query<{ value: string }, [string]>(
      "SELECT value FROM settings WHERE key = ?",
    )
    .get(key);
  return row?.value ?? null;
}

export function setSetting(
  db: Database,
  key: SettingKey,
  value: string,
): void {
  db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    [key, value, new Date().toISOString()],
  );
}

export function clearSetting(db: Database, key: SettingKey): void {
  db.run("DELETE FROM settings WHERE key = ?", [key]);
}
