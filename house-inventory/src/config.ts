/**
 * Runtime configuration.
 *
 * Two modes are supported:
 * - "addon"  — running inside Home Assistant. `SUPERVISOR_TOKEN` is injected
 *              by HA and we talk to the Core API at http://supervisor/core.
 * - "dev"    — running locally. The user sets `HA_BASE_URL` and `HA_TOKEN`
 *              (a long-lived access token from their HA profile).
 */

export type Mode = "addon" | "dev";

export interface Config {
  mode: Mode;
  /** Base URL for HA Core API, no trailing slash. */
  haBaseUrl: string;
  /** Bearer token for HA Core API. */
  haToken: string;
  /** Port the HTTP server binds to. Ingress routes here. */
  port: number;
  /** Where SQLite DB + downloaded manuals live. Mapped to HA's /data in prod. */
  dataDir: string;
  /** Web search provider for enrichment. */
  webSearchProvider: "duckduckgo" | "brave";
  /** Optional Brave Search API key. */
  braveApiKey: string | null;
  logLevel: "trace" | "debug" | "info" | "warning" | "error";
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export function loadConfig(): Config {
  const mode: Mode = process.env.HA_MODE === "addon" ? "addon" : "dev";

  const haBaseUrl =
    mode === "addon"
      ? (process.env.HA_BASE_URL ?? "http://supervisor/core")
      : requireEnv("HA_BASE_URL");

  const haToken =
    mode === "addon"
      ? requireEnv("HA_TOKEN") // Populated from SUPERVISOR_TOKEN by run script.
      : requireEnv("HA_TOKEN");

  const provider = process.env.WEB_SEARCH_PROVIDER ?? "duckduckgo";
  if (provider !== "duckduckgo" && provider !== "brave") {
    throw new Error(`Invalid WEB_SEARCH_PROVIDER: ${provider}`);
  }

  return {
    mode,
    haBaseUrl: haBaseUrl.replace(/\/$/, ""),
    haToken,
    port: Number(process.env.PORT ?? "8099"),
    dataDir: process.env.DATA_DIR ?? "./data",
    webSearchProvider: provider,
    braveApiKey: process.env.BRAVE_SEARCH_API_KEY || null,
    logLevel: (process.env.LOG_LEVEL as Config["logLevel"]) ?? "info",
  };
}
