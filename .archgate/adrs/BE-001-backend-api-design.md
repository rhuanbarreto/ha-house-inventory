---
id: BE-001
title: Backend API Design
domain: backend
rules: false
files:
  - "house-inventory/src/*.ts"
  - "house-inventory/src/frontend/api.ts"
---

# Backend API Design

## Context

House Inventory needs an HTTP backend that serves a JSON API for the React SPA frontend, hosts the SPA's static files, integrates with Home Assistant's Ingress proxy, and runs background tasks (HA registry sync, LLM-driven enrichment). The framework choice and API conventions affect developer velocity, bundle size, HA integration correctness, and the ease of adding new endpoints.

Without a standardized API design, the project risks:

1. **Ingress breakage** — HA's Ingress proxy injects an `x-ingress-path` header that the SPA needs to construct correct URLs. If the backend does not pass this through consistently, navigation and API calls break when accessed via the HA sidebar.
2. **Inconsistent error responses** — mixing plain-text errors, HTML error pages, and JSON error objects makes the frontend's error handling fragile and unpredictable.
3. **Route sprawl** — without a clear mounting convention, endpoints scatter across files with no consistent prefix, making it hard to distinguish API routes from SPA routes from health checks.
4. **Auth confusion** — HA Ingress handles authentication. Adding redundant auth middleware wastes code and can conflict with Ingress's own session management.

### Alternatives Considered

- **Express.js**: The most popular Node.js framework. Mature and well-documented, but lacks native TypeScript types, has a dated callback-based API, and produces a larger bundle. Its middleware ecosystem is unnecessary for this project since HA Ingress handles auth and CORS is not needed for a same-origin SPA.
- **Fastify**: High-performance with good TypeScript support and a schema-based validation system. However, it is heavier than needed for ~20 endpoints, and its plugin architecture adds indirection without clear benefit for a single-file API server. Fastify also has no Bun-native adapter — it requires a compatibility layer.
- **Koa**: Lightweight and middleware-focused, but its ecosystem has stagnated. TypeScript support exists but is community-maintained. No Bun-native serving.
- **Hono**: Ultra-lightweight (~14 KB), TypeScript-native, supports Bun natively via `hono/bun`. Provides `serveStatic` for Bun out of the box. Its API is minimal — `app.get()`, `app.post()`, `c.json()`, `c.text()` — which matches the project's needs perfectly. The trade-off is a smaller middleware ecosystem than Express, but this project uses zero third-party middleware.

For House Inventory, Hono is the ideal fit: it runs natively on Bun (see [ARCH-001](./ARCH-001-tech-stack-and-runtime.md)), has zero-overhead static file serving, and its minimalist API matches the project's ~20 endpoints without unnecessary abstraction. The compiled binary includes Hono's entire source at ~14 KB — negligible in a ~25 MB binary.

## Decision

The backend MUST use **Hono** as the HTTP framework. All JSON API endpoints MUST be mounted under the `/api/*` prefix via a separate `Hono` instance routed with `app.route("/api", api)`. Error responses from API endpoints MUST be JSON objects with an `error` field. The SPA MUST be served as a catch-all route with the HA Ingress path injected into the HTML. The `/healthz` health check MUST remain at the root path, outside `/api`.

### Scope

This ADR covers:
- The HTTP framework used for the backend
- The API route structure and mounting convention
- The error response format
- The SPA serving and Ingress path injection pattern
- The static file serving configuration
- The background task execution model
- The HA API client design

This ADR does NOT cover:
- The database schema or query patterns (see BE-002)
- The Docker container or s6-overlay configuration (see [ARCH-002](./ARCH-002-ha-add-on-container-architecture.md))
- The frontend SPA framework or routing (see FE-001)

### API Route Structure

The backend has three distinct route zones:

1. **`/healthz`** — Health check endpoint. Mounted directly on the root `app` instance, not under `/api`. Returns `200 "ok"` as plain text. Used by Docker `HEALTHCHECK` and HA Supervisor `watchdog`.

2. **`/api/*`** — JSON API endpoints. Mounted via `app.route("/api", api)` where `api` is a separate `Hono()` instance. All endpoints return JSON. Organized by resource:
   - `/api/config` — SPA bootstrap configuration
   - `/api/dashboard` — Aggregated statistics
   - `/api/assets`, `/api/assets/:id` — Asset CRUD
   - `/api/areas` — Area and floor listings
   - `/api/sync`, `/api/sync/history` — HA registry sync
   - `/api/llm`, `/api/settings/llm` — LLM entity management
   - `/api/enrich/*` — Enrichment queue and batch operations
   - `/api/files/:fileId` — PDF file serving

3. **`/static/*` and `GET *`** — Static file serving and SPA catch-all. `/static/*` serves built frontend assets with long-lived cache headers. The `GET *` catch-all serves `index.html` with the `x-ingress-path` header value injected into a `<meta>` tag.

### Error Response Format

All API error responses MUST use this JSON format:

```json
{ "error": "Human-readable error message" }
```

With the appropriate HTTP status code:
- `400` — Bad request (missing required fields, invalid input)
- `404` — Resource not found
- `409` — Conflict (e.g., batch already in flight)
- `500` — Internal server error (caught exceptions)

### Ingress Path Injection

The SPA catch-all reads the `x-ingress-path` header (injected by HA Supervisor for Ingress-proxied requests) and injects it into the HTML response by replacing a placeholder `<meta>` tag:

```html
<!-- Template -->
<meta name="ingress-path" content="" />

<!-- Injected at serve time -->
<meta name="ingress-path" content="/api/hassio_ingress/abc123" />
```

The SPA reads this meta tag synchronously on boot to set the base URL for API calls and router navigation.

### Background Tasks

Long-running work runs on timer-based intervals, not request-driven:
- **HA registry sync**: `queueMicrotask` for startup, then `setInterval` every 15 minutes
- **Enrichment tick**: `setTimeout` for 10s post-startup delay, then `setInterval` every 10 minutes
- **Manual batch enrichment**: Fire-and-forget via `void runBatch(...).then(...).finally(...)` — the HTTP handler returns immediately with `{ ok: true, started: true, max: N }`

### HA Client

The `HaClient` class encapsulates all communication with Home Assistant:
- **WebSocket** (`fetchRegistry`): Connects to HA's WebSocket API to fetch device, area, floor, and entity registries in a single connection lifecycle.
- **REST** (`discoverLlmEntities`, `callService`, `startSubentryFlow`): Uses HA's REST API for entity state queries and service calls.
- Constructor accepts a `Config` object containing `haBaseUrl` and `haToken`.

## Do's and Don'ts

### Do

- **DO** use `Hono` as the HTTP framework. Import from `"hono"` for the core and `"hono/bun"` for Bun-specific utilities like `serveStatic`.
- **DO** mount all JSON API endpoints under `/api/*` using `app.route("/api", api)` where `api` is a separate `Hono()` instance.
- **DO** return error responses as JSON `{ error: string }` with the appropriate HTTP status code. Use `c.json({ error: "message" }, statusCode)`.
- **DO** keep `/healthz` at the root path (on the main `app`, not on the `api` sub-router). This endpoint is used by Docker `HEALTHCHECK` and HA `watchdog`, which expect it at the root.
- **DO** read the `x-ingress-path` header via `c.req.header("x-ingress-path")` and inject it into the SPA's `index.html` for the catch-all route.
- **DO** use `serveStatic` from `"hono/bun"` for serving the built SPA static assets under `/static/*`.
- **DO** use fire-and-forget (`void promise.then(...).catch(...).finally(...)`) for long-running operations triggered by HTTP requests, returning immediately with a status response.
- **DO** encapsulate all HA API communication in the `HaClient` class. Pass the `Config` object to the constructor.
- **DO** cast caught errors as `(err as Error).message` when forwarding error messages to JSON responses.

### Don't

- **DON'T** use Express, Fastify, Koa, or any other HTTP framework. The project is standardized on Hono.
- **DON'T** add authentication middleware to the backend. HA Ingress handles authentication; the `x-remote-user-*` headers are available for user identification but MUST NOT be validated by the backend.
- **DON'T** return HTML or plain-text from `/api/*` endpoints (except `/api/files/*` which serves PDFs). All API responses MUST be JSON.
- **DON'T** hardcode ingress paths. Always read from the `x-ingress-path` header at request time — the path changes per installation and per HA Ingress session.
- **DON'T** mount health checks under `/api/healthz`. The `/healthz` endpoint MUST be at the root for compatibility with Docker `HEALTHCHECK` and HA `watchdog` URL patterns.
- **DON'T** `await` fire-and-forget operations in HTTP handlers. Batch enrichment and similar long-running tasks MUST return immediately; use `void` prefix to explicitly discard the promise.
- **DON'T** make HA API calls directly via `fetch` in route handlers. All HA communication MUST go through the `HaClient` class for consistent URL construction and auth header injection.

## Implementation Pattern

### Route Handler Example

```typescript
// Good: JSON response with proper error handling
api.get("/assets/:id", (c) => {
  const assetId = c.req.param("id");
  const asset = db.query("SELECT * FROM assets WHERE id = ?").get(assetId);
  if (!asset) return c.json({ error: "not found" }, 404);
  return c.json({ asset });
});

// Good: fire-and-forget for long-running work
api.post("/enrich/batch", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { n?: number } | null;
  // ... validation ...

  void runBatch(db, ha, config.dataDir, { max, searchConfig: searchConfig() })
    .then((r) => console.log(`[batch] done — ${r.succeeded} ok`))
    .catch((err) => console.error(`[batch] error: ${(err as Error).message}`))
    .finally(() => setInFlightBatch(null));

  return c.json({ ok: true, started: true, max });
});
```

```typescript
// Bad: returning plain text from an API endpoint
api.get("/assets/:id", (c) => {
  const asset = db.query("...").get(c.req.param("id"));
  if (!asset) return c.text("Not found", 404); // DON'T — use c.json()
  return c.json({ asset });
});

// Bad: awaiting fire-and-forget work (blocks the response)
api.post("/enrich/batch", async (c) => {
  await runBatch(db, ha, config.dataDir, opts); // DON'T — return immediately
  return c.json({ ok: true });
});
```

### SPA Catch-All Pattern

```typescript
app.get("*", async (c) => {
  if (indexHtmlTemplate === null) {
    const indexPath = join(STATIC_DIR, "index.html");
    try {
      indexHtmlTemplate = await Bun.file(indexPath).text();
    } catch {
      return c.text("Frontend not built — run `bun run build` first.", 500);
    }
  }
  const ingress = c.req.header("x-ingress-path") ?? "";
  const html = indexHtmlTemplate.replace(
    '<meta name="ingress-path" content="" />',
    `<meta name="ingress-path" content="${ingress}" />`,
  );
  return c.html(html);
});
```

## Consequences

### Positive

- **Bun-native performance:** Hono's `hono/bun` adapter provides zero-overhead static file serving and direct integration with Bun's HTTP server, with no compatibility shims.
- **Tiny footprint:** Hono adds ~14 KB to the compiled binary. Express would add ~200 KB+ with its dependency tree.
- **TypeScript-first:** Hono's API is fully typed — `c.req.param("id")`, `c.json()`, `c.req.header()` all have correct types without additional type packages.
- **Clear route zones:** The three-zone structure (`/healthz`, `/api/*`, `/*`) makes it immediately obvious which routes are infrastructure, which are API, and which serve the SPA.
- **Ingress transparency:** The `x-ingress-path` injection pattern is invisible to the SPA — it reads the meta tag synchronously and all subsequent navigation and API calls use the correct base URL.
- **Consistent error handling:** The `{ error: string }` convention means the frontend's `ApiError` class can reliably extract error messages from any failed API call.
- **Non-blocking enrichment:** Fire-and-forget batch processing lets the HTTP handler return in milliseconds while the enrichment runs for minutes in the background.

### Negative

- **Single-file API:** All routes are currently defined in `src/index.ts` (~700 lines). As the API grows, this file will become unwieldy. Hono supports modular sub-routers, but the project has not yet needed to split.
- **No request validation:** There is no schema validation middleware (e.g., Zod, Valibot). Request bodies are cast with `as` type assertions, relying on the frontend to send correct data. This is acceptable for a single-SPA add-on but would not scale to a public API.
- **Limited middleware ecosystem:** Hono has fewer middleware packages than Express. Features like rate limiting, request logging, or CORS would need custom implementations. Currently none of these are needed (Ingress handles auth; same-origin eliminates CORS).
- **No OpenAPI spec:** The API is not documented via OpenAPI/Swagger. Consumers must read the source or the frontend's typed `api.ts` client.

### Risks

- **Hono breaking changes:** Hono follows semver but is evolving rapidly (currently v4.x). A major version bump could require route handler refactoring. **Mitigation:** Pin the major version in `package.json` (`"hono": "^4.6.0"`). The project uses only core APIs (`get`, `post`, `json`, `text`, `serveStatic`) that are stable across minor versions.
- **Index.html template injection XSS:** The ingress path is injected into HTML via string replacement. A malicious `x-ingress-path` header could inject arbitrary HTML. **Mitigation:** The `x-ingress-path` header is set by HA Supervisor, not by the user's browser. In add-on mode, only the Supervisor can set this header. In dev mode, the header is absent (empty string). The risk is theoretical since the attack vector requires compromising the HA Supervisor itself.
- **Fire-and-forget error silencing:** Background batch errors are logged to `console.error` but not surfaced to the user in real-time. **Mitigation:** The `/api/enrich/inflight` endpoint provides batch status. The frontend polls this endpoint to detect completion. Persistent errors are recorded per-asset in the database (`last_enrichment_error` column) and visible on the asset detail page.

## Compliance and Enforcement

### Automated Enforcement

- **TypeScript compilation:** The `bun run typecheck` command (enforced by CI per [ARCH-001](./ARCH-001-tech-stack-and-runtime.md)) catches type errors in route handlers, ensuring `c.json()` and `c.req.param()` are used correctly.
- **Docker build:** The compiled binary includes all routes. If a route handler has a runtime import error or missing dependency, the `bun build --compile` step fails.

### Manual Enforcement

- **Code review — route mounting:** Reviewers MUST verify that new API endpoints are added to the `api` sub-router (not the root `app`), ensuring they appear under `/api/*`.
- **Code review — error format:** Reviewers MUST verify that error responses use `c.json({ error: "..." }, statusCode)`, not `c.text()` or thrown exceptions.
- **Code review — no auth middleware:** Reviewers MUST reject any PR that adds authentication or authorization middleware. HA Ingress is the sole auth layer.
- **Code review — ingress path:** Reviewers MUST verify that any new route reading the ingress path uses `c.req.header("x-ingress-path")`, never a hardcoded string.

### Exceptions

If a future feature requires a non-JSON response from `/api/*` (e.g., Server-Sent Events for real-time enrichment progress), it MUST be documented as a comment in the route handler explaining why JSON is not used, and the endpoint MUST still return JSON for error cases.

## References

- [ARCH-001 — Tech Stack and Runtime](./ARCH-001-tech-stack-and-runtime.md)
- [ARCH-002 — HA Add-on Container Architecture](./ARCH-002-ha-add-on-container-architecture.md)
- [Hono documentation](https://hono.dev/)
- [Hono — Bun adapter](https://hono.dev/docs/getting-started/bun)
- [Hono — serveStatic for Bun](https://hono.dev/docs/getting-started/bun#serve-static-files)
- [HA Add-on Ingress documentation](https://developers.home-assistant.io/docs/add-ons/presentation#ingress)
