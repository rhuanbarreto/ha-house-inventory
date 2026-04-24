/**
 * Dashboard — landing page with totals, last sync, LLM selection, quick
 * links to common actions.
 */

import type { Database } from "bun:sqlite";
import type { Config } from "../config.ts";
import { getSetting } from "../settings.ts";
import { queueStatus } from "../enrich-batch.ts";
import { getInFlightBatch } from "../batch-state.ts";
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

    ${renderEnrichmentCard(db, llm !== null)}
  `;

  return renderPage({ title: "Dashboard", active: "home", body, baseHref });
}

/**
 * Enrichment progress card: visual bar of how many assets still need
 * enrichment, plus buttons to run a small/large batch now. Scheduler runs
 * in the background too — this UI is for impatient users.
 */
function renderEnrichmentCard(db: Database, hasLlm: boolean): string {
  const status = queueStatus(db);
  const inFlight = getInFlightBatch();
  const enriched = db
    .query<{ c: number }, []>(
      `SELECT COUNT(DISTINCT asset_id) AS c FROM asset_links`,
    )
    .get()?.c ?? 0;
  const pending = status.total_eligible;
  const total = pending + enriched;
  const pct = total === 0 ? 0 : Math.round((enriched / total) * 100);
  const buttonsDisabled = !hasLlm || pending === 0 || inFlight !== null;

  // When a batch is running, auto-refresh so the user sees progress
  // without having to hit refresh themselves. ~8s balances "feels live"
  // vs "don't hammer the server".
  const autoRefresh = inFlight
    ? '<meta http-equiv="refresh" content="8">'
    : "";

  return /* html */ `
    ${autoRefresh}
    <h2>Enrichment progress</h2>
    <div class="card">
      ${
        inFlight
          ? /* html */ `
        <div class="flash info" style="margin-bottom:12px;display:flex;align-items:center;gap:10px">
          <span class="spinner" aria-hidden="true"
                style="display:inline-block;width:14px;height:14px;border-radius:50%;
                       border:2px solid var(--accent-soft);border-top-color:var(--accent);
                       animation:spin 0.8s linear infinite"></span>
          Running a batch of ${inFlight.max} · started ${escapeHtml(rel(inFlight.startedAt))}.
          Page auto-refreshes every few seconds.
        </div>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`
          : ""
      }
      <div style="display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap">
        <div>
          <div style="font-size:22px;font-weight:600;letter-spacing:-0.02em">
            ${enriched} / ${total} <span style="color:var(--text-faint);font-weight:400;font-size:14px">enriched</span>
          </div>
          <div class="muted" style="color:var(--text-dim);font-size:12.5px;margin-top:4px">
            ${status.never_attempted} never attempted ·
            ${status.stale} stale (>30d) ·
            ${status.failed_in_backoff} failed (in backoff)
          </div>
          ${
            status.last_success_at
              ? `<div class="muted" style="color:var(--text-faint);font-size:12.5px;margin-top:4px">Last success: ${escapeHtml(rel(status.last_success_at))}</div>`
              : ""
          }
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <form method="post" action="./api/enrich/batch?n=3" style="margin:0"
                onsubmit="const b=this.querySelector('button');b.disabled=true;b.textContent='Starting…';">
            <button class="btn" type="submit" ${buttonsDisabled ? "disabled" : ""}>Enrich 3</button>
          </form>
          <form method="post" action="./api/enrich/batch?n=10" style="margin:0"
                onsubmit="const b=this.querySelector('button');b.disabled=true;b.textContent='Starting…';">
            <button class="btn primary" type="submit" ${buttonsDisabled ? "disabled" : ""}>Enrich 10</button>
          </form>
        </div>
      </div>
      <div style="margin-top:12px;height:6px;border-radius:999px;background:var(--surface-alt);overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--accent);transition:width .3s"></div>
      </div>
      <div class="muted" style="color:var(--text-faint);font-size:12px;margin-top:8px">
        Background tick runs every 10 min · 3 assets at a time · DDG + AI Task throttled.
      </div>
    </div>
  `;
}
