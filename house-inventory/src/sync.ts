/**
 * Home Assistant sync.
 *
 * Pulls the HA registry snapshot and upserts into SQLite:
 *   - areas       → `areas`
 *   - devices     → `assets` (source='home_assistant'), classified via filters.ts
 *
 * Designed to be idempotent. Manual assets (source='manual') are never touched
 * by sync. Hidden status is kept user-editable: if a user manually un-hides a
 * device, we never re-hide it even if the heuristic still says hide.
 */

import type { Database } from "bun:sqlite";
import type { HaClient, HaArea, HaDevice } from "./ha-client.ts";
import { classifyDevice } from "./filters.ts";

export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  devicesAdded: number;
  devicesUpdated: number;
  devicesHidden: number;
  areasUpserted: number;
  error?: string;
}

interface ExistingAssetRow {
  id: string;
  hidden: number;
  hidden_reason: string | null;
}

export async function syncFromHomeAssistant(
  db: Database,
  ha: HaClient,
): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const logRow = db.run(
    "INSERT INTO ha_sync_log (started_at) VALUES (?)",
    [startedAt],
  );
  const logId = Number(logRow.lastInsertRowid);

  try {
    const snap = await ha.fetchRegistry();
    const counts = upsertRegistry(db, snap.devices, snap.areas);
    const finishedAt = new Date().toISOString();

    db.run(
      `UPDATE ha_sync_log SET finished_at=?, devices_added=?, devices_updated=?, devices_hidden=?, areas_upserted=? WHERE id=?`,
      [
        finishedAt,
        counts.devicesAdded,
        counts.devicesUpdated,
        counts.devicesHidden,
        counts.areasUpserted,
        logId,
      ],
    );

    return { startedAt, finishedAt, ...counts };
  } catch (err) {
    const finishedAt = new Date().toISOString();
    const message = (err as Error).message;
    db.run(
      "UPDATE ha_sync_log SET finished_at=?, error=? WHERE id=?",
      [finishedAt, message, logId],
    );
    return {
      startedAt,
      finishedAt,
      devicesAdded: 0,
      devicesUpdated: 0,
      devicesHidden: 0,
      areasUpserted: 0,
      error: message,
    };
  }
}

interface UpsertCounts {
  devicesAdded: number;
  devicesUpdated: number;
  devicesHidden: number;
  areasUpserted: number;
}

function upsertRegistry(
  db: Database,
  devices: HaDevice[],
  areas: HaArea[],
): UpsertCounts {
  const now = new Date().toISOString();
  const counts: UpsertCounts = {
    devicesAdded: 0,
    devicesUpdated: 0,
    devicesHidden: 0,
    areasUpserted: 0,
  };

  const upsertArea = db.prepare(
    `INSERT INTO areas (id, name, floor_id, icon, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name,
       floor_id=excluded.floor_id,
       icon=excluded.icon,
       updated_at=excluded.updated_at`,
  );

  const selectAsset = db.prepare<ExistingAssetRow, [string]>(
    "SELECT id, hidden, hidden_reason FROM assets WHERE ha_device_id = ?",
  );

  const insertAsset = db.prepare(
    `INSERT INTO assets (
       id, source, ha_device_id, name, manufacturer, model, model_id,
       sw_version, hw_version, serial_number, area_id,
       hidden, hidden_reason,
       created_at, updated_at, last_seen_at
     ) VALUES (?, 'home_assistant', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const updateAsset = db.prepare(
    `UPDATE assets SET
       name=?, manufacturer=?, model=?, model_id=?,
       sw_version=?, hw_version=?, serial_number=?, area_id=?,
       updated_at=?, last_seen_at=?
     WHERE id=?`,
  );

  const tx = db.transaction(() => {
    for (const a of areas) {
      upsertArea.run(a.area_id, a.name, a.floor_id, a.icon, now);
      counts.areasUpserted++;
    }

    for (const d of devices) {
      const classification = classifyDevice(d);
      const displayName = d.name_by_user ?? d.name ?? "(unnamed device)";
      const existing = selectAsset.get(d.id);

      if (existing) {
        updateAsset.run(
          displayName,
          d.manufacturer,
          d.model,
          d.model_id,
          d.sw_version,
          d.hw_version,
          d.serial_number,
          d.area_id,
          now,
          now,
          existing.id,
        );
        counts.devicesUpdated++;
      } else {
        insertAsset.run(
          d.id, // reuse HA device id as asset id for HA-sourced rows
          d.id,
          displayName,
          d.manufacturer,
          d.model,
          d.model_id,
          d.sw_version,
          d.hw_version,
          d.serial_number,
          d.area_id,
          classification.hidden ? 1 : 0,
          classification.reason,
          now,
          now,
          now,
        );
        counts.devicesAdded++;
        if (classification.hidden) counts.devicesHidden++;
      }
    }
  });

  tx();
  return counts;
}
