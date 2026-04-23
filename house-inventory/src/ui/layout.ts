/**
 * Shared HTML layout: CSS, page chrome, tiny helpers.
 *
 * Kept deliberately dependency-free — no templating engine, no build step.
 * Everything is a string literal + tagged helper. HTMX is loaded from a CDN
 * for tiny bits of interactivity (toggles, quick forms) without bundling.
 *
 * The design target is "crisp admin panel" — clean typography, calm color
 * palette, no skeuomorphism. Inspired by Linear / Vercel dashboards. Looks
 * fine inside HA's sidebar Ingress panel because it uses system fonts and
 * adapts to the HA iframe width.
 */

export interface PageProps {
  title: string;
  active?: "home" | "assets" | "areas" | "llm" | "sync";
  body: string;
  /** Optional status bar message (shown top-right in the header). */
  status?: string;
  /**
   * Base URL for resolving relative links on the page. Must end in "/".
   * In dev this is "/"; behind HA Ingress it's the ingress path + "/".
   * Critical: without a base tag, `href="./api/..."` on /assets/new would
   * resolve to /assets/api/... instead of /api/....
   */
  baseHref: string;
}

const CSS = /* css */ `
:root {
  color-scheme: light dark;
  --bg: #fafafa;
  --surface: #ffffff;
  --surface-alt: #f5f5f5;
  --border: #e5e5e5;
  --border-strong: #d4d4d4;
  --text: #18181b;
  --text-dim: #71717a;
  --text-faint: #a1a1aa;
  --accent: #2563eb;
  --accent-soft: #dbeafe;
  --success: #16a34a;
  --warn: #ca8a04;
  --danger: #dc2626;
  --radius: 8px;
  --shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 1px 3px rgb(0 0 0 / 0.06);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b0b0f;
    --surface: #131318;
    --surface-alt: #1a1a21;
    --border: #27272a;
    --border-strong: #3f3f46;
    --text: #f4f4f5;
    --text-dim: #a1a1aa;
    --text-faint: #71717a;
    --accent: #60a5fa;
    --accent-soft: #1e3a8a;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg);
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12.5px; }
code { padding: 1px 4px; background: var(--surface-alt); border-radius: 4px; }

.app {
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 100vh;
}
header.top {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 24px;
  height: 52px;
}
header.top .brand {
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
}
header.top nav { display: flex; gap: 4px; flex: 1; }
header.top nav a {
  padding: 6px 12px;
  border-radius: 6px;
  color: var(--text-dim);
}
header.top nav a:hover { background: var(--surface-alt); text-decoration: none; color: var(--text); }
header.top nav a.active { background: var(--surface-alt); color: var(--text); }
header.top .status {
  color: var(--text-faint);
  font-size: 12.5px;
}

main.page {
  padding: 24px;
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
}

h1 { font-size: 22px; font-weight: 600; margin: 0 0 16px; letter-spacing: -0.02em; }
h2 { font-size: 15px; font-weight: 600; margin: 24px 0 12px; letter-spacing: -0.01em; color: var(--text-dim); text-transform: uppercase; }

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  box-shadow: var(--shadow);
}

.grid-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.stat {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
}
.stat .label { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-faint); }
.stat .value { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; margin-top: 4px; }
.stat .sub { font-size: 12.5px; color: var(--text-dim); margin-top: 4px; }

table.rows {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
table.rows th {
  text-align: left;
  font-weight: 500;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-faint);
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-alt);
}
table.rows td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
table.rows tr:last-child td { border-bottom: none; }
table.rows tr:hover td { background: var(--surface-alt); }
table.rows a { color: var(--text); font-weight: 500; }
table.rows .muted { color: var(--text-dim); }

.tag {
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--surface-alt);
  color: var(--text-dim);
  border: 1px solid var(--border);
}
.tag.good { background: rgb(22 163 74 / 0.12); color: var(--success); border-color: rgb(22 163 74 / 0.3); }
.tag.warn { background: rgb(202 138 4 / 0.12); color: var(--warn); border-color: rgb(202 138 4 / 0.3); }
.tag.danger { background: rgb(220 38 38 / 0.12); color: var(--danger); border-color: rgb(220 38 38 / 0.3); }
.tag.accent { background: var(--accent-soft); color: var(--accent); border-color: transparent; }

.btn {
  display: inline-block;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  text-decoration: none;
  line-height: 1.4;
}
.btn:hover { background: var(--surface-alt); text-decoration: none; }
.btn.primary { background: var(--accent); color: white; border-color: transparent; }
.btn.primary:hover { filter: brightness(1.1); background: var(--accent); }
.btn.danger { color: var(--danger); }

.row-actions { display: flex; gap: 6px; align-items: center; }

.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.toolbar input[type="search"], .toolbar select, input[type="text"], input[type="number"], input[type="date"], select, textarea {
  font: inherit;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  min-width: 180px;
}
input[type="search"]:focus, input[type="text"]:focus, select:focus, textarea:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
  border-color: transparent;
}
textarea { min-height: 80px; resize: vertical; }
.toolbar .spacer { flex: 1; }

dl.facts { display: grid; grid-template-columns: 160px 1fr; gap: 6px 16px; margin: 0; }
dl.facts dt { color: var(--text-faint); font-size: 12.5px; }
dl.facts dd { margin: 0; color: var(--text); }

.links-list { display: flex; flex-direction: column; gap: 6px; }
.links-list a { display: inline-flex; align-items: center; gap: 8px; }
.links-list .kind { font-size: 11px; text-transform: uppercase; color: var(--text-faint); letter-spacing: 0.04em; min-width: 70px; }

form.form-stack { display: grid; gap: 12px; max-width: 540px; }
form.form-stack label { display: grid; gap: 4px; font-size: 12.5px; color: var(--text-dim); }
form.form-stack label input, form.form-stack label select, form.form-stack label textarea { color: var(--text); }
form.form-stack .actions { display: flex; gap: 8px; margin-top: 8px; }

.flash { padding: 10px 14px; border-radius: var(--radius); margin-bottom: 16px; font-size: 13px; border: 1px solid transparent; }
.flash.info { background: var(--accent-soft); color: var(--accent); }
.flash.ok { background: rgb(22 163 74 / 0.12); color: var(--success); border-color: rgb(22 163 74 / 0.3); }
.flash.err { background: rgb(220 38 38 / 0.12); color: var(--danger); border-color: rgb(220 38 38 / 0.3); }

.empty { padding: 40px 20px; text-align: center; color: var(--text-faint); }
.pager { display: flex; gap: 8px; align-items: center; justify-content: flex-end; margin-top: 12px; font-size: 12.5px; color: var(--text-dim); }
`;

export function renderPage(props: PageProps): string {
  const navItem = (
    href: string,
    label: string,
    id: NonNullable<PageProps["active"]>,
  ): string =>
    `<a href="${href}" ${props.active === id ? 'class="active"' : ""}>${label}</a>`;

  return /* html */ `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <base href="${escapeHtml(props.baseHref)}" />
    <title>${escapeHtml(props.title)} · House Inventory</title>
    <script src="https://unpkg.com/htmx.org@2.0.3" defer></script>
    <style>${CSS}</style>
  </head>
  <body>
    <div class="app">
      <header class="top">
        <div class="brand">📦 House Inventory</div>
        <nav>
          ${navItem("./", "Dashboard", "home")}
          ${navItem("./assets", "Assets", "assets")}
          ${navItem("./areas", "Areas", "areas")}
          ${navItem("./llm", "LLM", "llm")}
        </nav>
        <div class="status">${props.status ?? ""}</div>
      </header>
      <main class="page">
        ${props.body}
      </main>
    </div>
  </body>
</html>`;
}

/** Escape a string for use inside HTML text content or attribute values. */
export function escapeHtml(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Format an ISO timestamp as a compact relative string. */
export function rel(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return String(iso);
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day}d ago`;
  return new Date(then).toISOString().slice(0, 10);
}

/** Render a short flash message from `?flash=<kind>:<text>` in the URL. */
export function renderFlash(param: string | undefined): string {
  if (!param) return "";
  const [kind, ...rest] = param.split(":");
  const text = rest.join(":");
  const cls = kind === "ok" || kind === "err" || kind === "info" ? kind : "info";
  return `<div class="flash ${cls}">${escapeHtml(text)}</div>`;
}
