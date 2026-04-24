/**
 * Typed API client for the House Inventory backend.
 *
 * All fetch calls are prefixed with the HA Ingress path (discovered from
 * a <meta> tag injected by the server). In dev mode the prefix is empty.
 */

import type {
  AppConfig,
  AreasResponse,
  AssetDetailResponse,
  AssetListResponse,
  CreateAssetPayload,
  CreatableEntriesResponse,
  DashboardData,
  EnrichResult,
  LlmDiscovery,
  SyncResult,
  UpdateAssetPayload,
} from "./types.ts";

// Read the ingress path synchronously from the meta tag the server injects.
function readIngressPath(): string {
  if (typeof document === "undefined") return "";
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="ingress-path"]',
  );
  return meta?.content ?? "";
}

let _baseUrl: string | null = null;

export function getBaseUrl(): string {
  if (_baseUrl === null) {
    const ingress = readIngressPath();
    _baseUrl = ingress.endsWith("/") ? ingress.slice(0, -1) : ingress;
  }
  return _baseUrl;
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}`);
    this.name = "ApiError";
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}/api${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getBaseUrl()}/api${path}`, {
    method: "POST",
    headers: body != null ? { "Content-Type": "application/json" } : {},
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, errBody);
  }
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getBaseUrl()}/api${path}`, {
    method: "PUT",
    headers: body != null ? { "Content-Type": "application/json" } : {},
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, errBody);
  }
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}/api${path}`, { method: "DELETE" });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, errBody);
  }
  return res.json() as Promise<T>;
}

function toQuery(params?: Record<string, string | undefined>): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(
    (e): e is [string, string] => e[1] != null && e[1] !== "",
  );
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries).toString();
}

// ---------------------------------------------------------------------------
// Typed endpoints
// ---------------------------------------------------------------------------

export const api = {
  // Config
  getConfig: () => get<AppConfig>("/config"),

  // Dashboard
  getDashboard: () => get<DashboardData>("/dashboard"),

  // Assets
  getAssets: (params?: { hidden?: string; area?: string; q?: string }) =>
    get<AssetListResponse>(`/assets${toQuery(params)}`),
  getAsset: (id: string) => get<AssetDetailResponse>(`/assets/${id}`),
  createAsset: (data: CreateAssetPayload) =>
    post<{ id: string; name: string }>("/assets", data),
  updateAsset: (id: string, data: UpdateAssetPayload) =>
    post<{ ok: true }>(`/assets/${id}/edit`, data),
  toggleHidden: (id: string) =>
    post<{ hidden: boolean }>(`/assets/${id}/toggle-hidden`),
  deleteAsset: (id: string) => post<{ ok: true }>(`/assets/${id}/delete`),

  // Sync
  sync: () => post<SyncResult>("/sync"),
  getSyncHistory: () =>
    get<{ id: number; started_at: string; finished_at: string | null }[]>(
      "/sync/history",
    ),

  // LLM
  getLlm: () => get<LlmDiscovery>("/llm"),
  selectLlm: (entityId: string) =>
    put<{ ok: true; entity_id: string; kind: string }>("/settings/llm", {
      entity_id: entityId,
    }),
  clearLlm: () => del<{ ok: true }>("/settings/llm"),
  getCreatableEntries: () => get<CreatableEntriesResponse>("/llm/creatable"),
  createAiTask: (entryId: string, model?: string) =>
    post<{ ok: true; entity_id: string | null }>("/llm/create", {
      entry_id: entryId,
      options: model ? { model } : {},
    }),

  // Enrich
  getEnrichStatus: () =>
    get<{
      total_eligible: number;
      never_attempted: number;
      stale: number;
      failed_in_backoff: number;
      last_success_at: string | null;
    }>("/enrich/status"),
  getInFlight: () =>
    get<{ inFlight: { startedAt: string; max: number } | null }>(
      "/enrich/inflight",
    ),
  enrichBatch: (n: number) =>
    post<{ ok: true; started: boolean; max: number }>("/enrich/batch", { n }),
  enrichAsset: (id: string) => post<EnrichResult>(`/enrich/${id}`),

  // Areas
  getAreas: () => get<AreasResponse>("/areas"),
} as const;
