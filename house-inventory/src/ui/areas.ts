/**
 * Areas page — every area grouped by floor, with asset counts.
 *
 * Areas without a floor fall into an "Unassigned" bucket at the bottom.
 * Asset counts show visible + hidden separately so the user can see at a
 * glance which room has the most tracked stuff.
 */

import type { Database } from "bun:sqlite";
import { escapeHtml, renderFlash, renderPage } from "./layout.ts";

interface FloorRow {
  id: string;
  name: string;
  icon: string | null;
  level: number | null;
}

interface AreaRow {
  id: string;
  name: string;
  icon: string | null;
  floor_id: string | null;
  visible_count: number;
  hidden_count: number;
  enriched_count: number;
}

export function renderAreasPage(
  db: Database,
  flash: string | undefined,
  baseHref: string,
): string {
  const floors = db
    .query<FloorRow, []>(
      `SELECT id, name, icon, level FROM floors
       ORDER BY COALESCE(level, 0), name`,
    )
    .all();

  const areas = db
    .query<AreaRow, []>(
      `SELECT
         ar.id,
         ar.name,
         ar.icon,
         ar.floor_id,
         (SELECT COUNT(*) FROM assets a
            WHERE a.area_id = ar.id AND a.hidden = 0) AS visible_count,
         (SELECT COUNT(*) FROM assets a
            WHERE a.area_id = ar.id AND a.hidden = 1) AS hidden_count,
         (SELECT COUNT(DISTINCT l.asset_id) FROM asset_links l
            INNER JOIN assets a ON a.id = l.asset_id
            WHERE a.area_id = ar.id AND a.hidden = 0) AS enriched_count
       FROM areas ar
       ORDER BY ar.name`,
    )
    .all();

  const byFloor = new Map<string | null, AreaRow[]>();
  for (const a of areas) {
    const key = a.floor_id;
    const bucket = byFloor.get(key);
    if (bucket) bucket.push(a);
    else byFloor.set(key, [a]);
  }

  // Render order: known floors in their (level, name) order, then "Unassigned".
  const rendered: string[] = [];
  for (const f of floors) {
    const floorAreas = byFloor.get(f.id) ?? [];
    if (floorAreas.length === 0) continue;
    rendered.push(renderFloorBlock(f.name, floorAreas, baseHref));
  }
  const unassigned = byFloor.get(null) ?? [];
  if (unassigned.length > 0) {
    rendered.push(renderFloorBlock("Unassigned", unassigned, baseHref));
  }

  const unassigned_assets = db
    .query<{ c: number }, []>(
      "SELECT COUNT(*) AS c FROM assets WHERE area_id IS NULL AND hidden = 0",
    )
    .get()?.c ?? 0;

  const body = /* html */ `
    ${renderFlash(flash)}
    <h1>Areas</h1>
    <p class="muted" style="color:var(--text-dim);margin-top:-8px">
      ${areas.length} area${areas.length === 1 ? "" : "s"} across ${floors.length} floor${floors.length === 1 ? "" : "s"} — synced from Home Assistant.
    </p>

    ${
      rendered.length === 0
        ? '<div class="card empty">No areas synced yet. Run a sync from the dashboard.</div>'
        : rendered.join("\n")
    }

    ${
      unassigned_assets > 0
        ? /* html */ `
      <h2>Without an area</h2>
      <div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <span>${unassigned_assets} asset${unassigned_assets === 1 ? "" : "s"} aren't assigned to any area.</span>
        <a class="btn" href="assets?area=">View them →</a>
      </div>`
        : ""
    }
  `;

  return renderPage({ title: "Areas", active: "areas", body, baseHref });
}

function renderFloorBlock(
  floorName: string,
  areas: AreaRow[],
  _baseHref: string,
): string {
  const totalVisible = areas.reduce((s, a) => s + a.visible_count, 0);
  const totalEnriched = areas.reduce((s, a) => s + a.enriched_count, 0);
  return /* html */ `
    <h2>${escapeHtml(floorName)}
      <span style="color:var(--text-faint);font-weight:400;font-size:12.5px;margin-left:8px">
        ${areas.length} area${areas.length === 1 ? "" : "s"} · ${totalVisible} asset${totalVisible === 1 ? "" : "s"} · ${totalEnriched} enriched
      </span>
    </h2>
    <table class="rows">
      <thead>
        <tr>
          <th>Area</th>
          <th style="text-align:right">Visible</th>
          <th style="text-align:right">Enriched</th>
          <th style="text-align:right">Hidden</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${areas
          .map(
            (a) => /* html */ `
          <tr>
            <td>
              <a href="assets?area=${encodeURIComponent(a.id)}">${escapeHtml(a.name)}</a>
              <span class="mono" style="color:var(--text-faint);font-size:11.5px;margin-left:6px">${escapeHtml(a.id)}</span>
            </td>
            <td style="text-align:right;font-variant-numeric:tabular-nums">${a.visible_count}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums;color:${a.enriched_count > 0 ? "var(--success)" : "var(--text-faint)"}">${a.enriched_count}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums;color:var(--text-faint)">${a.hidden_count}</td>
            <td><a class="btn" href="assets?area=${encodeURIComponent(a.id)}">Open →</a></td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  `;
}
