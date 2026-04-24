/**
 * TanStack Router — route tree + router instance.
 *
 * Uses code-based route definitions (no file-based codegen needed for
 * 6 flat routes). Each route has a loader that pre-fetches data via
 * TanStack Query's `ensureQueryData`.
 */

import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { queryClient } from "./query.ts";
import { getBaseUrl } from "./api.ts";

// -- Lazy route imports (code-split each page) --------------------------------

const lazyRootRoute = () => import("./routes/__root.tsx");
const lazyIndex = () => import("./routes/index.tsx");
const lazyAssetList = () => import("./routes/assets.index.tsx");
const lazyAssetNew = () => import("./routes/assets.new.tsx");
const lazyAssetDetail = () => import("./routes/assets.$id.tsx");
const lazyAreas = () => import("./routes/areas.tsx");
const lazyLlm = () => import("./routes/llm.tsx");

// -- Route tree ---------------------------------------------------------------

const rootRoute = createRootRoute({
  component: () => {
    // Resolved lazily — the actual component is set below after we import
    throw new Error("Root component should be set via lazy loading");
  },
});

// Override root component after lazy import
rootRoute.update({
  component: undefined, // will be set via the lazy import pattern below
});

// We'll use a simpler approach: define routes with inline lazy components
// TanStack Router supports this via route.lazy()

// Actually, for simplicity with 6 routes, let's just import them eagerly.
// The total code is small and code-splitting 6 tiny pages adds complexity
// without meaningful benefit for a local-network add-on.

import { RootLayout } from "./routes/__root.tsx";
import { DashboardPage } from "./routes/index.tsx";
import { AssetListPage } from "./routes/assets.index.tsx";
import { AssetNewPage } from "./routes/assets.new.tsx";
import { AssetDetailPage } from "./routes/assets.$id.tsx";
import { AreasPage } from "./routes/areas.tsx";
import { LlmPage } from "./routes/llm.tsx";
import {
  dashboardQuery,
  assetListQuery,
  assetDetailQuery,
  areasQuery,
  llmQuery,
  llmCreatableQuery,
} from "./query.ts";

// -- Define routes ------------------------------------------------------------

const rootDef = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootDef,
  path: "/",
  component: DashboardPage,
  loader: () => queryClient.ensureQueryData(dashboardQuery),
});

const assetsIndexRoute = createRoute({
  getParentRoute: () => rootDef,
  path: "/assets",
  component: AssetListPage,
  validateSearch: (search: Record<string, unknown>) => ({
    q: (search.q as string) ?? "",
    area: (search.area as string) ?? "",
    hidden: (search.hidden as string) ?? "0",
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    queryClient.ensureQueryData(
      assetListQuery({
        q: deps.q || undefined,
        area: deps.area || undefined,
        hidden: deps.hidden || undefined,
      }),
    ),
});

const assetsNewRoute = createRoute({
  getParentRoute: () => rootDef,
  path: "/assets/new",
  component: AssetNewPage,
});

const assetDetailRoute = createRoute({
  getParentRoute: () => rootDef,
  path: "/assets/$id",
  component: AssetDetailPage,
  loader: ({ params }) =>
    queryClient.ensureQueryData(assetDetailQuery(params.id)),
});

const areasRoute = createRoute({
  getParentRoute: () => rootDef,
  path: "/areas",
  component: AreasPage,
  loader: () => queryClient.ensureQueryData(areasQuery),
});

const llmRoute = createRoute({
  getParentRoute: () => rootDef,
  path: "/llm",
  component: LlmPage,
  loader: async () => {
    await Promise.all([
      queryClient.ensureQueryData(llmQuery),
      queryClient.ensureQueryData(llmCreatableQuery),
    ]);
  },
});

// -- Route tree ---------------------------------------------------------------

const routeTree = rootDef.addChildren([
  indexRoute,
  assetsIndexRoute,
  assetsNewRoute,
  assetDetailRoute,
  areasRoute,
  llmRoute,
]);

// -- Router instance ----------------------------------------------------------

export function createAppRouter() {
  // Read basepath from the meta tag (injected by server for HA Ingress).
  const ingress = getBaseUrl();
  return createRouter({
    routeTree,
    basepath: ingress || "/",
    defaultPreload: "intent",
  });
}

// Type registration for TanStack Router
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
