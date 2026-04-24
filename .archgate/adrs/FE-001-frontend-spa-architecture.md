---
id: FE-001
title: Frontend SPA Architecture
domain: frontend
rules: false
files:
  - "house-inventory/src/frontend/**/*.ts"
  - "house-inventory/src/frontend/**/*.tsx"
  - "house-inventory/src/frontend/app.css"
---

# Frontend SPA Architecture

## Context

House Inventory's UI runs inside Home Assistant's sidebar via Ingress — a proxied iframe that injects authentication and a dynamic base path. The frontend must be a self-contained SPA that reads the ingress path at boot, prefixes all API calls and navigation links accordingly, and works reliably on local-network hardware without depending on CDN-hosted assets. The UI is simple: a dashboard, asset list/detail, area overview, LLM configuration page, and a manual asset form — six routes total.

Without a standardized frontend architecture, the project risks:

1. **Ingress path drift** — HA Ingress injects a session-specific path prefix (e.g., `/api/hassio_ingress/abc123`). If API calls or router navigation do not consistently use this prefix, requests 404 and navigation escapes the Ingress iframe.
2. **Stale data** — without a dedicated data-fetching layer, components that read server state must manually track loading, error, and refetch states. This leads to duplicated fetch logic, race conditions, and stale UI after mutations.
3. **Bundle bloat** — adding a CSS framework (Tailwind: ~10 KB gzip) or a UI component library (MUI: ~80 KB gzip) increases the bundle size with no benefit for a local-network add-on that serves 6 pages to a single user.
4. **Route codegen complexity** — TanStack Router's file-based route generation requires a build plugin and a code generation step. For 6 routes on a local add-on, this adds tooling complexity without meaningful benefit.

### Alternatives Considered

- **Next.js / Remix**: Full-stack React frameworks with SSR, file-based routing, and built-in data loading. Both are overkill for a client-side SPA embedded in HA Ingress. They require their own server process (conflicting with the Hono backend), have large dependency trees, and their SSR features provide no benefit in a single-user local-network context.
- **Vue 3 + Vue Router**: A viable alternative with a smaller learning curve for simple UIs. However, the project already uses React for its component model, and switching would require rewriting all existing components. Vue's ecosystem is smaller for TypeScript-first development.
- **Preact + wouter**: Ultra-lightweight (~3 KB + ~1 KB). Tempting for bundle size, but lacks TanStack Query integration for data fetching and wouter does not support route-level data preloading. The developer would need to build their own query cache and loading state management.
- **React 19 + TanStack Router + TanStack Query**: React 19 provides the component model and hooks. TanStack Router provides type-safe, code-based routing with route-level data preloading via loaders. TanStack Query provides automatic caching, refetching, and mutation state management. Combined bundle is ~40 KB gzip — acceptable for a local-network add-on.

For House Inventory, React 19 with TanStack Router and TanStack Query provides the right balance: type-safe routing with data preloading, automatic cache management for server state, and a component model familiar to the widest developer pool. The bundle is served as static files from the Bun backend (see [ARCH-001](./ARCH-001-tech-stack-and-runtime.md)), with the ingress path injected into the HTML at serve time (see [BE-001](./BE-001-backend-api-design.md)).

## Decision

The frontend MUST be a **React 19 SPA** using **TanStack Router** for code-based routing and **TanStack Query** for all server state management. All backend communication MUST go through the typed **`api.ts` client**, which prefixes requests with the HA Ingress path. Styling MUST use **plain CSS** — no CSS frameworks, CSS-in-JS, or heavy UI component libraries.

### Scope

This ADR covers:
- The frontend framework (React 19)
- The routing library and route definition pattern (TanStack Router, code-based)
- The data fetching and caching strategy (TanStack Query)
- The API client design and ingress path integration
- The styling approach (plain CSS)
- The component and file organization conventions
- The build and bundling pipeline (Bun bundler)

This ADR does NOT cover:
- The TypeScript configuration for the frontend (see [ARCH-001](./ARCH-001-tech-stack-and-runtime.md) — `tsconfig.frontend.json`)
- The backend API endpoints consumed by the frontend (see [BE-001](./BE-001-backend-api-design.md))
- The Dockerfile or static file serving configuration (see [ARCH-002](./ARCH-002-ha-add-on-container-architecture.md))

### React 19

React 19 is the UI framework. The SPA entry point at `src/frontend/main.tsx` renders:

```
StrictMode > QueryClientProvider > RouterProvider
```

Components are function components using hooks. No class components. No external state management (Redux, Zustand, Jotai) — TanStack Query handles all server state, and local UI state uses `useState`.

### TanStack Router: Code-Based Routes

Routes are defined programmatically in `src/frontend/router.tsx` using `createRootRoute`, `createRoute`, and `createRouter`. There are 6 routes:

| Route | File | Description |
|-------|------|-------------|
| `/` | `routes/index.tsx` | Dashboard with stats |
| `/assets` | `routes/assets.index.tsx` | Asset list with search/filter |
| `/assets/new` | `routes/assets.new.tsx` | Manual asset creation form |
| `/assets/$id` | `routes/assets.$id.tsx` | Asset detail with links/files |
| `/areas` | `routes/areas.tsx` | Area listing grouped by floor |
| `/llm` | `routes/llm.tsx` | LLM entity selection and creation |

Each route has a `loader` function that calls `queryClient.ensureQueryData()` to preload the page's data before rendering. The router's `basepath` is set from the ingress meta tag via `getBaseUrl()`.

Route files are eagerly imported (not lazy/code-split). For 6 small pages on a local-network add-on, the overhead of code-splitting infrastructure exceeds the bundle size savings.

### TanStack Query: Server State

All server state is managed via TanStack Query. Query definitions live in `src/frontend/query.ts` as reusable query option objects (e.g., `dashboardQuery`, `assetListQuery(params)`, `assetDetailQuery(id)`). Components access data via `useQuery(queryDef)`.

Mutations (sync, enrich, create asset, toggle hidden) use either direct `api.*` calls followed by `queryClient.invalidateQueries()`, or TanStack Query's `useMutation` hook.

### API Client: `api.ts`

The typed API client at `src/frontend/api.ts` provides:

- `getBaseUrl()` — reads the `<meta name="ingress-path">` tag once and caches the result
- Low-level helpers: `get<T>(path)`, `post<T>(path, body)`, `put<T>(path, body)`, `del<T>(path)` — all prefixed with `getBaseUrl() + "/api"`
- `ApiError` class with `status` and `body` fields for structured error handling
- `api` const object with typed methods: `api.getDashboard()`, `api.getAssets(params)`, `api.enrichAsset(id)`, etc.

All backend communication MUST go through this client. No raw `fetch()` calls to `/api/*` endpoints in components or route files.

### Styling: Plain CSS

All styles live in `src/frontend/app.css`. The project uses plain CSS with no preprocessor, no CSS framework, and no CSS-in-JS. The design respects `prefers-color-scheme` for automatic dark/light mode. Component-specific styles use class names (not CSS modules or scoped styles).

### File Organization

```
src/frontend/
  main.tsx           — Entry point (StrictMode > QueryClientProvider > RouterProvider)
  router.tsx         — Route tree and router instance
  query.ts           — TanStack Query definitions (query keys + queryFn)
  api.ts             — Typed API client
  types.ts           — Shared TypeScript interfaces
  app.css            — All styles
  components/        — Reusable UI components (Tag, StatCard, Flash, etc.)
  hooks/             — Custom React hooks (useFlash)
  routes/            — Route page components (__root.tsx, index.tsx, etc.)
  lib/               — Pure utility functions (relative-time.ts)
```

## Do's and Don'ts

### Do

- **DO** use TanStack Router with code-based route definitions in `src/frontend/router.tsx`. Define routes using `createRoute()` with a `component` and `loader`.
- **DO** use `queryClient.ensureQueryData(queryDef)` in route loaders to preload page data before the component renders.
- **DO** use the typed `api` object from `src/frontend/api.ts` for all backend communication. Never call `fetch()` directly against `/api/*` endpoints from components or route files.
- **DO** define reusable query options in `src/frontend/query.ts` (e.g., `export const dashboardQuery = { queryKey: ["dashboard"], queryFn: api.getDashboard }`). Components MUST reference these definitions via `useQuery(queryDef)`.
- **DO** use `getBaseUrl()` from `api.ts` to read the HA Ingress path. This function reads the `<meta name="ingress-path">` tag once and caches the result for the session lifetime.
- **DO** use plain CSS in `src/frontend/app.css`. Support dark and light mode via `prefers-color-scheme` media queries.
- **DO** keep reusable UI components in `src/frontend/components/` and custom hooks in `src/frontend/hooks/`. Each component MUST be a named export (not a default export).
- **DO** define shared TypeScript interfaces in `src/frontend/types.ts`. Route-specific types may live in the route file if they are not shared.

### Don't

- **DON'T** add a CSS framework (Tailwind CSS, Bootstrap, Bulma) or a CSS-in-JS library (styled-components, Emotion, vanilla-extract). The project uses plain CSS to minimize bundle size and avoid build tooling dependencies.
- **DON'T** add a heavy UI component library (Material UI, Chakra UI, Ant Design, shadcn/ui). Keep the UI lightweight with custom components.
- **DON'T** use TanStack Router's file-based route generation or code generation plugins. Routes are defined manually in `router.tsx` for a 6-route SPA.
- **DON'T** make `fetch()` calls directly to `/api/*` from components or route files. All backend communication MUST go through the `api` object in `api.ts` to ensure consistent ingress path prefixing and error handling.
- **DON'T** add external state management libraries (Redux, Zustand, Jotai, MobX). TanStack Query manages server state; `useState` handles local UI state.
- **DON'T** introduce code splitting or lazy route loading. The total SPA bundle for 6 pages is small enough that eager loading is faster than the overhead of dynamic imports on a local network.
- **DON'T** use default exports for components or hooks. Named exports (`export function AssetListPage()`) enable consistent import patterns and better IDE refactoring.

## Implementation Pattern

### Route Definition

```tsx
// Good: code-based route with loader that preloads data
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
```

### Query Definition

```typescript
// Good: reusable query definition in query.ts
export const dashboardQuery = {
  queryKey: ["dashboard"],
  queryFn: api.getDashboard,
  staleTime: 10_000,
};

// Good: parameterized query factory
export function assetDetailQuery(id: string) {
  return {
    queryKey: ["asset", id],
    queryFn: () => api.getAsset(id),
  };
}
```

### Component Data Access

```tsx
// Good: useQuery with shared query definition
export function DashboardPage() {
  const { data, isLoading } = useQuery(dashboardQuery);
  if (isLoading) return <div className="card empty">Loading...</div>;
  return <div>{/* render data */}</div>;
}
```

```tsx
// Bad: raw fetch in a component
export function DashboardPage() {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetch("/api/dashboard")       // DON'T — no ingress prefix, no caching
      .then(r => r.json())
      .then(setData);
  }, []);
  // ...
}
```

### API Client Usage

```typescript
// Good: using the typed api object
const result = await api.enrichAsset(assetId);
const assets = await api.getAssets({ area: areaId, hidden: "0" });
```

```typescript
// Bad: raw fetch with manual ingress path
const res = await fetch(`${getBaseUrl()}/api/enrich/${assetId}`, {
  method: "POST",                 // DON'T — use api.enrichAsset() instead
});
```

## Consequences

### Positive

- **Type-safe routing:** TanStack Router provides fully typed route params, search params, and loaders. A typo in a route path or a missing param is caught at compile time.
- **Automatic data preloading:** Route loaders with `ensureQueryData` guarantee that page data is in the cache before the component renders, eliminating loading spinners on navigation.
- **Cache-managed server state:** TanStack Query handles stale-while-revalidate, background refetching, and cache invalidation after mutations — eliminating manual loading/error state management.
- **Ingress path consistency:** Centralizing the ingress path in `api.ts` ensures every API call and every router navigation uses the correct HA Ingress prefix, regardless of the installation's specific Ingress session.
- **Minimal bundle size:** React 19 + TanStack Router + TanStack Query + plain CSS produces a total bundle under ~80 KB gzip. No CSS framework or UI library overhead.
- **Dark/light mode for free:** Plain CSS with `prefers-color-scheme` provides automatic theme switching without a theme provider or runtime JS.
- **Simple mental model:** 6 routes, eagerly loaded, with data preloading via loaders. No code splitting, no lazy boundaries, no suspense fallbacks — the entire SPA loads in one request on a local network.

### Negative

- **No code splitting:** All 6 routes are bundled together. If the SPA grows significantly (20+ routes with heavy page-specific dependencies), the single-bundle approach will need to be revisited.
- **Plain CSS scalability:** Without CSS modules, scoped styles, or a naming convention like BEM, class name collisions become possible as the stylesheet grows. Currently manageable at ~500 lines, but could become an issue.
- **No component library design system:** Custom components (Tag, StatCard, etc.) are built from scratch. There is no shared design token system, no accessibility audit tooling, and no Storybook for isolated development.
- **Manual route definitions:** Adding a new route requires editing `router.tsx` (import, route definition, route tree). File-based routing would make this automatic, but adds a codegen step.

### Risks

- **TanStack Router API instability:** TanStack Router is pre-1.0 and its API changes between minor versions, especially around type inference. **Mitigation:** Pin the major version (`^1.120.3`). The project uses only core APIs (`createRoute`, `createRouter`, `useSearch`, `Link`). Migration guides are published for breaking changes. The 6-route surface area limits the blast radius of any API change.
- **Ingress path caching bug:** `getBaseUrl()` caches the ingress path on first read. If HA rotates the Ingress session while the SPA is open, API calls will use the stale path and 404. **Mitigation:** HA Ingress sessions are stable for the duration of a browser session. A full page reload (which re-reads the meta tag) resolves any stale path. The `ApiError` class surfaces 404s clearly in the UI.
- **CSS class collisions:** Without scoping, two components using the same class name (e.g., `.card`) will share styles unintentionally. **Mitigation:** The current stylesheet uses descriptive class names (`.toolbar`, `.stat-card`, `.pager`). If collisions become a problem, CSS modules can be adopted incrementally without changing the plain CSS decision — Bun's bundler supports CSS modules natively.

## Compliance and Enforcement

### Automated Enforcement

- **TypeScript compilation:** `tsc --noEmit -p tsconfig.frontend.json` (run by `bun run typecheck` per [ARCH-001](./ARCH-001-tech-stack-and-runtime.md)) catches type errors in route definitions, query definitions, and component props. TanStack Router's type inference flags route param mismatches at compile time.
- **Bun bundler:** The `scripts/build.ts` build script bundles the SPA. If a component has an import error or references a non-existent module, the build fails.

### Manual Enforcement

- **Code review — API client usage:** Reviewers MUST verify that new data fetching uses `api.*` methods from `api.ts`, not raw `fetch()` calls. Any `fetch()` in `src/frontend/` that targets `/api/*` is a violation.
- **Code review — query definitions:** Reviewers MUST verify that new queries are defined in `query.ts` as reusable query option objects, not inline in components.
- **Code review — no new frameworks:** Reviewers MUST reject PRs that add CSS frameworks (`tailwindcss`, `@emotion/*`, `styled-components`), UI libraries (`@mui/*`, `@chakra-ui/*`, `antd`), or state management libraries (`redux`, `zustand`, `jotai`).
- **Code review — named exports:** Reviewers MUST verify that components and hooks use named exports, not default exports.

### Exceptions

If a future feature requires a component with significant interactivity (e.g., drag-and-drop inventory organization), a targeted library (e.g., `@dnd-kit`) may be added for that specific feature. It MUST NOT be a full UI framework, and its use MUST be scoped to the feature that requires it.

## References

- [ARCH-001 — Tech Stack and Runtime](./ARCH-001-tech-stack-and-runtime.md)
- [ARCH-002 — HA Add-on Container Architecture](./ARCH-002-ha-add-on-container-architecture.md)
- [BE-001 — Backend API Design](./BE-001-backend-api-design.md)
- [React 19 documentation](https://react.dev/)
- [TanStack Router documentation](https://tanstack.com/router)
- [TanStack Query documentation](https://tanstack.com/query)
- [Bun — Bundler](https://bun.sh/docs/bundler)
