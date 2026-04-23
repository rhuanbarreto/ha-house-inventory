/**
 * Home Assistant sync.
 *
 * Pulls the HA registry snapshot and upserts into SQLite:
 *   - areas       → `areas`
 *   - devices     → `assets` (source='home_assistant'), classified via filters.ts
 *
 * Removal policy: HA-sourced assets that disappear from the registry are
 * soft-hidden with hidden_reason='removed_from_ha' (never hard-deleted —
 * the user may have inventory data worth keeping). If the device comes
 * back, we auto-restore it IFF its current hidden_reason is still
 * 'removed_from_ha'. A user-set hidden_reason wins over sync.
 *
 * Safety: if HA returns zero devices (unusual transient), we skip the
 * removal pass entirely to avoid hiding the whole inventory on a glitch.
 *
 * Designed to be idempotent. Manual assets (source='manual') are never touched
 * by sync. Hidden status is kept user-editable: if a user manually un-hides a
 * device, we never re-hide it even if the heuristic still says hide.
 */

import type { Database } from "bun:sqlite";
import type { HaClient, HaArea, HaDevice, HaFloor } from "./ha-client.ts";
import { classifyDevice } from "./filters.ts";

export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  devicesAdded: number;
  devicesUpdated: number;
  devicesHidden: number;
  devicesRemoved: number;
  devicesRestored: number;
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
    const counts = upsertRegistry(db, snap.devices, snap.areas, snap.floors);
    const finishedAt = new Date().toISOString();

    db.run(
      `UPDATE ha_sync_log SET
         finished_at=?, devices_added=?, devices_updated=?, devices_hidden=?,
         devices_removed=?, devices_restored=?, areas_upserted=?
       WHERE id=?`,
      [
        finishedAt,
        counts.devicesAdded,
        counts.devicesUpdated,
        counts.devicesHidden,
        counts.devicesRemoved,
        counts.devicesRestored,
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
      devicesRemoved: 0,
      devicesRestored: 0,
      areasUpserted: 0,
      error: message,
    };
  }
}

interface UpsertCounts {
  devicesAdded: number;
  devicesUpdated: number;
  devicesHidden: number;
  devicesRemoved: number;
  devicesRestored: number;
  areasUpserted: number;
}

function upsertRegistry(
  db: Database,
  devices: HaDevice[],
  areas: HaArea[],
  floors: HaFloor[],
): UpsertCounts {
  const now = new Date().toISOString();
  const counts: UpsertCounts = {
    devicesAdded: 0,
    devicesUpdated: 0,
    devicesHidden: 0,
    devicesRemoved: 0,
    devicesRestored: 0,
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

  const upsertFloor = db.prepare(
    `INSERT INTO floors (id, name, icon, level, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name,
       icon=excluded.icon,
       level=excluded.level,
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
    for (const f of floors) {
      upsertFloor.run(f.floor_id, f.name, f.icon, f.level, now);
    }
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

        // Auto-restore: if this device was previously hidden because it
        // disappeared from HA, and now it's back, unhide it. A manually
        // set hidden_reason (e.g. 'pet_profile', 'manual_hide') wins.
        if (existing.hidden === 1 && existing.hidden_reason === "removed_from_ha") {
          db.run(
            `UPDATE assets SET hidden = 0, hidden_reason = NULL, updated_at = ? WHERE id = ?`,
            [now, existing.id],
          );
          counts.devicesRestored++;
        }
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

    // ---- Soft-remove devices that used to be in HA but aren't anymore ----
    //
    // Guard: if `devices` is empty, this would hide the entire HA-sourced
    // inventory on a transient glitch. Skip the removal pass in that case —
    // the rest of the sync still runs, we just don't prune.
    if (devices.length > 0) {
      const seen = new Set(devices.map((d) => d.id));
      const orphans = db
        .query<
          { id: string; hidden: number; hidden_reason: string | null },
          []
        >(
          `SELECT id, hidden, hidden_reason
           FROM assets
           WHERE source = 'home_assistant' AND ha_device_id IS NOT NULL`,
        )
        .all();

      const hideOrphan = db.prepare(
        `UPDATE assets SET hidden = 1, hidden_reason = 'removed_from_ha', updated_at = ? WHERE id = ?`,
      );
      for (const row of orphans) {
        if (seen.has(row.id)) continue;

        // Already hidden with a different reason (e.g. pet_profile, or the
        // user manually hid it): leave as-is.
        if (row.hidden === 1 && row.hidden_reason !== "removed_from_ha") continue;

        // Already flagged as removed — don't re-write (saves a write + log entry).
        if (row.hidden === 1 && row.hidden_reason === "removed_from_ha") continue;

        hideOrphan.run(now, row.id);
        counts.devicesRemoved++;
      }
    }
  });

  tx();
  return counts;
}
