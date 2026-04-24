/**
 * Asset list, detail, and "add manual asset" form.
 *
 * Server-rendered HTML. No JavaScript apart from HTMX for the small bits
 * of interactivity (enrich button, hide/unhide toggle, inline edits).
 */

import type { Database } from "bun:sqlite";
import { escapeHtml, rel, renderFlash, renderPage } from "./layout.ts";

// ---- List ------------------------------------------------------------------

interface ListRow {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  area_id: string | null;
  source: string;
  hidden: number;
  link_count: number;
  file_count: number;
}

export interface ListQuery {
  q?: string;
  area?: string;
  hidden?: "1" | "0";
}

export function renderAssetList(
  db: Database,
  query: ListQuery,
  flash: string | undefined,
  baseHref: string,
): string {
  const showHidden = query.hidden === "1";
  const areas = db
    .query<{ id: string; name: string }, []>(
      "SELECT id, name FROM areas ORDER BY name",
    )
    .all();

  const where: string[] = [`a.hidden = ${showHidden ? 1 : 0}`];
  const params: (string | number)[] = [];
  if (query.area) {
    where.push("a.area_id = ?");
    params.push(query.area);
  }
  if (query.q && query.q.trim().length > 0) {
    const term = `%${query.q.trim()}%`;
    where.push(
      "(a.name LIKE ? OR COALESCE(a.manufacturer,'') LIKE ? OR COALESCE(a.model,'') LIKE ?)",
    );
    params.push(term, term, term);
  }

  const rows = db
    .query<ListRow, (string | number)[]>(
      `SELECT a.id, a.name, a.manufacturer, a.model, a.area_id, a.source, a.hidden,
              (SELECT COUNT(*) FROM asset_links l WHERE l.asset_id = a.id) AS link_count,
              (SELECT COUNT(*) FROM asset_files f WHERE f.asset_id = a.id) AS file_count
       FROM assets a
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(a.manufacturer,''), COALESCE(a.model,''), a.name`,
    )
    .all(...params);

  const totalVisible = db
    .query<{ c: number }, []>("SELECT COUNT(*) AS c FROM assets WHERE hidden=0")
    .get()?.c ?? 0;
  const totalHidden = db
    .query<{ c: number }, []>("SELECT COUNT(*) AS c FROM assets WHERE hidden=1")
    .get()?.c ?? 0;

  const body = /* html */ `
    ${renderFlash(flash)}
    <h1>Assets</h1>

    <form class="toolbar" method="get" action="./assets">
      <input type="search" name="q" placeholder="Search name, manufacturer, model…" value="${escapeHtml(query.q ?? "")}" />
      <select name="area">
        <option value="">All areas</option>
        ${areas
          .map(
            (a) =>
              `<option value="${escapeHtml(a.id)}" ${query.area === a.id ? "selected" : ""}>${escapeHtml(a.name)}</option>`,
          )
          .join("")}
      </select>
      <select name="hidden">
        <option value="0" ${!showHidden ? "selected" : ""}>Visible (${totalVisible})</option>
        <option value="1" ${showHidden ? "selected" : ""}>Hidden (${totalHidden})</option>
      </select>
      <button class="btn" type="submit">Apply</button>
      <div class="spacer"></div>
      <a class="btn primary" href="./assets/new">+ Add manual asset</a>
    </form>

    ${
      rows.length === 0
        ? '<div class="card empty">No assets match.</div>'
        : /* html */ `
    <table class="rows">
      <thead>
        <tr>
          <th>Name</th>
          <th>Manufacturer</th>
          <th>Model</th>
          <th>Area</th>
          <th>Source</th>
          <th>Enriched</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((r) => {
            const enriched =
              r.link_count > 0
                ? `<span class="tag good">${r.link_count} link${r.link_count === 1 ? "" : "s"}${r.file_count > 0 ? ` · ${r.file_count} pdf` : ""}</span>`
                : `<span class="tag">—</span>`;
            return /* html */ `
            <tr>
              <td><a href="./assets/${escapeHtml(r.id)}">${escapeHtml(r.name)}</a></td>
              <td class="${r.manufacturer ? "" : "muted"}">${escapeHtml(r.manufacturer ?? "—")}</td>
              <td class="${r.model ? "mono" : "muted"}" style="font-size:12.5px">${escapeHtml(r.model ?? "—")}</td>
              <td class="${r.area_id ? "" : "muted"}">${escapeHtml(r.area_id ?? "—")}</td>
              <td><span class="tag ${r.source === "manual" ? "accent" : ""}">${r.source === "manual" ? "manual" : "home_assistant"}</span></td>
              <td>${enriched}</td>
              <td><a class="btn" href="./assets/${escapeHtml(r.id)}">Open →</a></td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
    <div class="pager">${rows.length} result${rows.length === 1 ? "" : "s"}</div>
    `
    }
  `;

  return renderPage({
    title: showHidden ? "Hidden assets" : "Assets",
    active: "assets",
    body,
    baseHref,
  });
}

// ---- Detail ----------------------------------------------------------------

interface AssetRow {
  id: string;
  source: string;
  ha_device_id: string | null;
  name: string;
  manufacturer: string | null;
  model: string | null;
  model_id: string | null;
  sw_version: string | null;
  hw_version: string | null;
  serial_number: string | null;
  area_id: string | null;
  category: string | null;
  purchase_date: string | null;
  purchase_price_cents: number | null;
  warranty_until: string | null;
  notes: string | null;
  hidden: number;
  hidden_reason: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  last_enrichment_attempt_at: string | null;
  last_enrichment_success_at: string | null;
  last_enrichment_error: string | null;
  enrichment_attempts: number;
}

interface LinkRow {
  id: number;
  kind: string;
  url: string;
  title: string | null;
  fetched_at: string;
}

interface FileRow {
  id: number;
  kind: string;
  local_path: string;
  sha256: string;
  bytes: number;
  downloaded_at: string;
}

export function renderAssetDetail(
  db: Database,
  assetId: string,
  flash: string | undefined,
  baseHref: string,
): string | null {
  const asset = db
    .query<AssetRow, [string]>("SELECT * FROM assets WHERE id = ?")
    .get(assetId);
  if (!asset) return null;

  const links = db
    .query<LinkRow, [string]>(
      "SELECT * FROM asset_links WHERE asset_id = ? ORDER BY kind",
    )
    .all(assetId);
  const files = db
    .query<FileRow, [string]>(
      "SELECT * FROM asset_files WHERE asset_id = ? ORDER BY downloaded_at DESC",
    )
    .all(assetId);

  const areas = db
    .query<{ id: string; name: string }, []>(
      "SELECT id, name FROM areas ORDER BY name",
    )
    .all();

  const kindLabel: Record<string, string> = {
    product: "Product",
    support: "Support",
    manual: "Manual",
    firmware: "Firmware",
    parts: "Parts",
    datasheet: "Datasheet",
    other: "Other",
  };

  const pdfKb = (b: number): string =>
    b > 1024 * 1024
      ? `${(b / 1024 / 1024).toFixed(1)} MB`
      : `${Math.round(b / 1024)} KB`;

  const body = /* html */ `
    ${renderFlash(flash)}
    <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:8px">
      <a href="./assets" style="color:var(--text-dim)">← Assets</a>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
      <div>
        <h1 style="margin:0">${escapeHtml(asset.name)}</h1>
        <div class="muted" style="color:var(--text-dim);margin-top:4px">
          ${escapeHtml(asset.manufacturer ?? "unknown")} · <span class="mono">${escapeHtml(asset.model ?? "no model")}</span>
          ${asset.hidden ? ` · <span class="tag warn">hidden (${escapeHtml(asset.hidden_reason ?? "manual")})</span>` : ""}
        </div>
      </div>
      <div class="row-actions">
        <form method="post" action="./api/enrich/${escapeHtml(asset.id)}" style="margin:0"
              onsubmit="const b=this.querySelector('button');b.disabled=true;b.textContent='Enriching…';">
          <button class="btn primary" type="submit" ${!asset.manufacturer || !asset.model ? "disabled title='No manufacturer/model to enrich'" : ""}>
            ⚡ Enrich
          </button>
        </form>
        <form method="post" action="./api/assets/${escapeHtml(asset.id)}/toggle-hidden" style="margin:0">
          <button class="btn" type="submit">${asset.hidden ? "Unhide" : "Hide"}</button>
        </form>
        ${
          asset.source === "manual"
            ? `<form method="post" action="./api/assets/${escapeHtml(asset.id)}/delete" style="margin:0" onsubmit="return confirm('Delete this manual asset?')">
                 <button class="btn danger" type="submit">Delete</button>
               </form>`
            : ""
        }
      </div>
    </div>

    <div style="display:grid;grid-template-columns: 1fr 1fr;gap:16px;margin-top:20px">
      <section>
        <h2>Facts</h2>
        <div class="card">
          <dl class="facts">
            <dt>Source</dt><dd><span class="tag ${asset.source === "manual" ? "accent" : ""}">${escapeHtml(asset.source)}</span></dd>
            ${asset.ha_device_id ? `<dt>HA device</dt><dd class="mono" style="font-size:12px">${escapeHtml(asset.ha_device_id)}</dd>` : ""}
            <dt>Area</dt><dd>${escapeHtml(asset.area_id ?? "—")}</dd>
            <dt>Manufacturer</dt><dd>${escapeHtml(asset.manufacturer ?? "—")}</dd>
            <dt>Model</dt><dd class="mono" style="font-size:12.5px">${escapeHtml(asset.model ?? "—")}</dd>
            <dt>Model ID</dt><dd class="mono" style="font-size:12.5px">${escapeHtml(asset.model_id ?? "—")}</dd>
            <dt>SW</dt><dd>${escapeHtml(asset.sw_version ?? "—")}</dd>
            <dt>HW</dt><dd>${escapeHtml(asset.hw_version ?? "—")}</dd>
            <dt>Serial</dt><dd>${escapeHtml(asset.serial_number ?? "—")}</dd>
            <dt>Last seen</dt><dd>${escapeHtml(rel(asset.last_seen_at))}</dd>
            <dt>Enriched</dt><dd>${
              asset.last_enrichment_success_at
                ? `<span class="tag good">ok</span> ${escapeHtml(rel(asset.last_enrichment_success_at))}`
                : asset.last_enrichment_error
                  ? `<span class="tag danger">error</span> ${escapeHtml(asset.last_enrichment_error)}`
                  : `<span class="muted" style="color:var(--text-faint)">never</span>`
            }</dd>
          </dl>
        </div>

        <h2>Inventory fields</h2>
        <form class="card form-stack" method="post" action="./api/assets/${escapeHtml(asset.id)}/edit">
          <label>
            <span>Category</span>
            <input type="text" name="category" value="${escapeHtml(asset.category ?? "")}" placeholder="e.g. appliance, electronics" />
          </label>
          <label>
            <span>Area</span>
            <select name="area_id">
              <option value="">—</option>
              ${areas
                .map(
                  (a) =>
                    `<option value="${escapeHtml(a.id)}" ${asset.area_id === a.id ? "selected" : ""}>${escapeHtml(a.name)}</option>`,
                )
                .join("")}
            </select>
          </label>
          <label>
            <span>Purchase date</span>
            <input type="date" name="purchase_date" value="${escapeHtml(asset.purchase_date ?? "")}" />
          </label>
          <label>
            <span>Purchase price (€ or $, whole or decimal)</span>
            <input type="text" name="purchase_price" value="${asset.purchase_price_cents !== null ? (asset.purchase_price_cents / 100).toFixed(2) : ""}" placeholder="e.g. 499.00" />
          </label>
          <label>
            <span>Warranty until</span>
            <input type="date" name="warranty_until" value="${escapeHtml(asset.warranty_until ?? "")}" />
          </label>
          <label>
            <span>Notes</span>
            <textarea name="notes" placeholder="Anything else worth remembering about this asset">${escapeHtml(asset.notes ?? "")}</textarea>
          </label>
          <div class="actions">
            <button class="btn primary" type="submit">Save</button>
          </div>
        </form>
      </section>

      <section>
        <h2>Links</h2>
        <div class="card">
          ${
            links.length === 0
              ? '<div class="empty" style="padding:16px">No links yet. Click Enrich to generate.</div>'
              : /* html */ `
            <div class="links-list">
              ${links
                .map(
                  (l) => /* html */ `
                <div>
                  <span class="kind">${escapeHtml(kindLabel[l.kind] ?? l.kind)}</span>
                  <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.url)}</a>
                </div>`,
                )
                .join("")}
            </div>`
          }
        </div>

        <h2>Files</h2>
        <div class="card">
          ${
            files.length === 0
              ? '<div class="empty" style="padding:16px">No files downloaded yet.</div>'
              : /* html */ `
            <table class="rows" style="border:none;box-shadow:none">
              <thead>
                <tr><th>Kind</th><th>Size</th><th>Downloaded</th><th></th></tr>
              </thead>
              <tbody>
                ${files
                  .map(
                    (f) => /* html */ `
                  <tr>
                    <td><span class="tag accent">${escapeHtml(f.kind)}</span></td>
                    <td>${pdfKb(f.bytes)}</td>
                    <td class="muted">${escapeHtml(rel(f.downloaded_at))}</td>
                    <td><a class="btn" href="./api/files/${f.id}">Open PDF</a></td>
                  </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>`
          }
        </div>
      </section>
    </div>
  `;

  return renderPage({
    title: asset.name,
    active: "assets",
    body,
    baseHref,
  });
}

// ---- New manual asset form -------------------------------------------------

export function renderNewAssetForm(
  db: Database,
  flash: string | undefined,
  baseHref: string,
): string {
  const areas = db
    .query<{ id: string; name: string }, []>(
      "SELECT id, name FROM areas ORDER BY name",
    )
    .all();

  const body = /* html */ `
    ${renderFlash(flash)}
    <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:8px">
      <a href="./assets" style="color:var(--text-dim)">← Assets</a>
    </div>
    <h1>Add manual asset</h1>
    <p class="muted" style="color:var(--text-dim);margin-top:-8px">
      For things that aren't on Home Assistant — furniture, dumb appliances, tools.
    </p>

    <form class="card form-stack" method="post" action="./api/assets">
      <label>
        <span>Name *</span>
        <input type="text" name="name" required placeholder="e.g. Living room sofa, Bosch washing machine" />
      </label>
      <label>
        <span>Manufacturer</span>
        <input type="text" name="manufacturer" placeholder="Bosch" />
      </label>
      <label>
        <span>Model</span>
        <input type="text" name="model" placeholder="WAW28460GB" />
      </label>
      <label>
        <span>Category</span>
        <input type="text" name="category" placeholder="appliance, furniture, tool, …" />
      </label>
      <label>
        <span>Area</span>
        <select name="area_id">
          <option value="">—</option>
          ${areas.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join("")}
        </select>
      </label>
      <label>
        <span>Purchase date</span>
        <input type="date" name="purchase_date" />
      </label>
      <label>
        <span>Purchase price</span>
        <input type="text" name="purchase_price" placeholder="e.g. 499.00" />
      </label>
      <label>
        <span>Warranty until</span>
        <input type="date" name="warranty_until" />
      </label>
      <label>
        <span>Notes</span>
        <textarea name="notes"></textarea>
      </label>
      <div class="actions">
        <button class="btn primary" type="submit">Create</button>
        <a class="btn" href="./assets">Cancel</a>
      </div>
    </form>
  `;

  return renderPage({ title: "New asset", active: "assets", body, baseHref });
}
