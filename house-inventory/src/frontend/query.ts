/**
 * TanStack Query configuration — QueryClient, query key factories,
 * and reusable queryOptions for each API endpoint.
 */

import { QueryClient, queryOptions } from "@tanstack/react-query";
import { api } from "./api.ts";

// ---------------------------------------------------------------------------
// Query client
// ---------------------------------------------------------------------------

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30s — data from the local add-on is cheap to refetch
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

// ---------------------------------------------------------------------------
// Query key factories — centralised so cache invalidation is easy
// ---------------------------------------------------------------------------

export const keys = {
  config: ["config"] as const,
  dashboard: ["dashboard"] as const,
  assets: {
    all: ["assets"] as const,
    list: (params?: { hidden?: string; area?: string; q?: string }) =>
      ["assets", "list", params ?? {}] as const,
    detail: (id: string) => ["assets", "detail", id] as const,
  },
  areas: ["areas"] as const,
  llm: ["llm"] as const,
  llmCreatable: ["llm", "creatable"] as const,
  enrichStatus: ["enrich", "status"] as const,
  enrichInFlight: ["enrich", "inflight"] as const,
  syncHistory: ["sync", "history"] as const,
};

// ---------------------------------------------------------------------------
// Reusable queryOptions (used in route loaders and components)
// ---------------------------------------------------------------------------

export const configQuery = queryOptions({
  queryKey: keys.config,
  queryFn: () => api.getConfig(),
  staleTime: Infinity, // ingress path never changes within a session
});

export const dashboardQuery = queryOptions({
  queryKey: keys.dashboard,
  queryFn: () => api.getDashboard(),
});

export const assetListQuery = (params?: {
  hidden?: string;
  area?: string;
  q?: string;
}) =>
  queryOptions({
    queryKey: keys.assets.list(params),
    queryFn: () => api.getAssets(params),
  });

export const assetDetailQuery = (id: string) =>
  queryOptions({
    queryKey: keys.assets.detail(id),
    queryFn: () => api.getAsset(id),
  });

export const areasQuery = queryOptions({
  queryKey: keys.areas,
  queryFn: () => api.getAreas(),
});

export const llmQuery = queryOptions({
  queryKey: keys.llm,
  queryFn: () => api.getLlm(),
});

export const llmCreatableQuery = queryOptions({
  queryKey: keys.llmCreatable,
  queryFn: () => api.getCreatableEntries(),
});

export const enrichInFlightQuery = queryOptions({
  queryKey: keys.enrichInFlight,
  queryFn: () => api.getInFlight(),
  refetchInterval: (query) => {
    // Poll every 8s while a batch is in flight
    const data = query.state.data;
    return data?.inFlight ? 8_000 : false;
  },
});
