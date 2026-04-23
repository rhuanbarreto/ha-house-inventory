/**
 * Dashboard — landing page with totals, last sync, LLM selection, quick
 * links to common actions.
 */

import type { Database } from "bun:sqlite";
import type { Config } from "../config.ts";
import { getSetting } from "../settings.ts";
import { escapeHtml, rel, renderFlash, renderPage } from "./layout.ts";

export function renderDashboard(
  db: Database,
  config: Config,
  flash: string | undefined,
  baseHref: string,
): string {
  const totals = db
    .query<
      {
        total: number;
        visible: number;
        hidden: number;
        manual: number;
        with_links: number;
        with_pdf: number;
        areas: number;
      },
      []
    >(
      `SELECT
         (SELECT COUNT(*) FROM assets)                              AS total,
         (SELECT COUNT(*) FROM assets WHERE hidden=0)               AS visible,
         (SELECT COUNT(*) FROM assets WHERE hidden=1)               AS hidden,
         (SELECT COUNT(*) FROM assets WHERE source='manual')        AS manual,
         (SELECT COUNT(DISTINCT asset_id) FROM asset_links)         AS with_links,
         (SELECT COUNT(DISTINCT asset_id) FROM asset_files)         AS with_pdf,
         (SELECT COUNT(*) FROM areas)                               AS areas`,
    )
    .get();

  const lastSync = db
    .query<
      {
        started_at: string;
        finished_at: string | null;
        error: string | null;
        devices_added: number;
        devices_updated: number;
      },
      []
    >(
      `SELECT started_at, finished_at, error, devices_added, devices_updated
       FROM ha_sync_log ORDER BY id DESC LIMIT 1`,
    )
    .get();

  const llm = getSetting(db, "llm_entity_id");

  const body = /* html */ `
    ${renderFlash(flash)}
    <h1>Dashboard</h1>

    <div class="grid-stats">
      <div class="stat">
        <div class="label">Visible assets</div>
        <div class="value">${totals?.visible ?? 0}</div>
        <div class="sub">${totals?.hidden ?? 0} hidden · ${totals?.manual ?? 0} manual</div>
      </div>
      <div class="stat">
        <div class="label">Enriched with links</div>
        <div class="value">${totals?.with_links ?? 0}</div>
        <div class="sub">${totals?.with_pdf ?? 0} with manual PDF</div>
      </div>
      <div class="stat">
        <div class="label">Areas</div>
        <div class="value">${totals?.areas ?? 0}</div>
        <div class="sub">from Home Assistant</div>
      </div>
      <div class="stat">
        <div class="label">Mode</div>
        <div class="value" style="font-size:14px">${escapeHtml(config.mode)}</div>
        <div class="sub">data at <code>${escapeHtml(config.dataDir)}</code></div>
      </div>
    </div>

    <h2>Last HA sync</h2>
    <div class="card">
      ${
        lastSync
          ? /* html */ `
            <dl class="facts">
              <dt>Started</dt><dd>${escapeHtml(rel(lastSync.started_at))}</dd>
              <dt>Duration</dt><dd>${
                lastSync.finished_at
                  ? Math.max(
                      0,
                      Date.parse(lastSync.finished_at) -
                        Date.parse(lastSync.started_at),
                    ) + " ms"
                  : "in progress"
              }</dd>
              <dt>Result</dt><dd>${
                lastSync.error
                  ? `<span class="tag danger">error</span> ${escapeHtml(lastSync.error)}`
                  : `<span class="tag good">ok</span> +${lastSync.devices_added} added, ${lastSync.devices_updated} updated`
              }</dd>
            </dl>
          `
          : '<div class="empty">no syncs yet</div>'
      }
      <div style="margin-top:12px;display:flex;gap:8px">
        <form method="post" action="./api/sync" style="margin:0">
          <button class="btn" type="submit">Sync now</button>
        </form>
        <a class="btn" href="./api/sync/history">History (JSON)</a>
      </div>
    </div>

    <h2>LLM for enrichment</h2>
    <div class="card">
      ${
        llm
          ? `<p style="margin:0">Selected: <code>${escapeHtml(llm)}</code></p>
             <p class="muted" style="margin:6px 0 0;color:var(--text-dim);font-size:12.5px">
               Change on the <a href="./llm">LLM page</a>.
             </p>`
          : `<p style="margin:0">No LLM configured yet. <a href="./llm">Pick or create one</a> to enable enrichment.</p>`
      }
    </div>
  `;

  return renderPage({ title: "Dashboard", active: "home", body, baseHref });
}
