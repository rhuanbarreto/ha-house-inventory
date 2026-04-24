---
id: ARCH-001
title: Tech Stack and Runtime
domain: architecture
rules: false
files:
  - "house-inventory/**/*.ts"
  - "house-inventory/**/*.tsx"
  - "house-inventory/package.json"
  - "house-inventory/tsconfig.json"
  - "house-inventory/tsconfig.frontend.json"
---

# Tech Stack and Runtime

## Context

House Inventory is a Home Assistant add-on that runs as a single container on resource-constrained hardware (Raspberry Pi, Home Assistant Green, NUC-class devices). The runtime and language choices directly affect image size, cold-start time, memory footprint, and the developer experience for a small single-repo project that ships both a backend API server and a React SPA frontend.

Without a standardized runtime decision, the project risks:

1. **Binary bloat** — bundling a full Node.js runtime into the container image inflates the download for every HA user, especially painful on ARM devices over slow networks.
2. **Configuration drift** — mixing CommonJS and ESM, or splitting into separate `package.json` files for backend and frontend, creates import resolution headaches and divergent build pipelines.
3. **Type-safety erosion** — relaxing TypeScript strict flags to unblock quick fixes leads to silent `undefined` bugs at runtime, which are especially costly in an add-on that runs unattended and stores user data.
4. **Toolchain sprawl** — introducing separate tools for package management (npm/yarn/pnpm), bundling (webpack/vite), and runtime (Node.js) adds complexity with no clear benefit for a project of this size.

### Alternatives Considered

- **Node.js + npm/pnpm**: The industry default. Mature ecosystem, but requires shipping a ~50 MB runtime layer in the container image, has no native single-binary compile story, and would need a separate bundler (esbuild, Vite) for the frontend. TypeScript support requires `ts-node` or a compile step.
- **Deno**: Offers TypeScript-first development and a permissions model, but its npm compatibility layer is less mature, the Docker images are larger than Bun's Alpine variants, and the `compile` subcommand produces larger binaries than Bun's equivalent.
- **Go/Rust for backend + Node.js for frontend**: Would produce a small, fast backend binary, but splits the project into two languages and two toolchains. Overkill for a CRUD + enrichment add-on with 33 source files.
- **Bun**: Single tool for runtime, package manager, bundler, and TypeScript execution. Native `bun build --compile` produces a static musl binary (~25 MB) that includes the runtime — no `node_modules` needed at container runtime. Alpine-based Docker images are small. The trade-off is a younger ecosystem with occasional compatibility gaps, but for this project's dependency set (Hono, React, TanStack) everything works natively.

For House Inventory, Bun is the clear fit: it collapses five tools (Node.js, npm, tsc, esbuild, a test runner) into one, produces a single static binary for the container, and handles both backend TypeScript and frontend JSX bundling without additional configuration.

## Decision

All source code in this project MUST use **Bun** as the runtime, package manager, bundler, and binary compiler. All TypeScript MUST be written in **strict mode** with `noUncheckedIndexedAccess` enabled. The module system MUST be **ESM** (`"type": "module"` in `package.json`).

### Scope

This ADR covers:
- The JavaScript/TypeScript runtime used in development and production
- The package manager used for dependency installation
- The TypeScript configuration and strictness level
- The module system and import conventions
- The compilation target for the production binary

This ADR does NOT cover:
- The Docker container structure or base images (see ARCH-002)
- The backend HTTP framework choice (see BE-001)
- The frontend framework and routing library (see FE-001)

### Runtime: Bun

- Bun is used as the development runtime (`bun run dev`, `bun --watch`)
- Bun is used as the package manager (`bun install`, `bun.lock`)
- Bun's native bundler compiles the frontend SPA (`bun run scripts/build.ts`)
- `bun build --compile` produces a single static binary for the production container, targeting musl for Alpine compatibility (`bun-linux-x64-musl` for amd64, `bun-linux-arm64-musl` for aarch64)

### TypeScript: Strict Mode

Two `tsconfig` files enforce strict TypeScript across the entire codebase:

- **`tsconfig.json`** (backend): Includes `src/**/*.ts` and `scripts/**/*.ts`, excludes `src/frontend/`. Uses `bun-types` for Bun-specific APIs (`Bun.file`, `Database` from `bun:sqlite`, `HTMLRewriter`).
- **`tsconfig.frontend.json`** (frontend): Includes `src/frontend/**/*.ts` and `src/frontend/**/*.tsx`. Uses `DOM` and `DOM.Iterable` libs for browser APIs. Does not include `bun-types`.

Both configs share these mandatory flags:
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitOverride: true`
- `isolatedModules: true`
- `forceConsistentCasingInFileNames: true`

### Module System: ESM

- `package.json` declares `"type": "module"`
- `allowImportingTsExtensions: true` — all imports use explicit `.ts` or `.tsx` extensions
- `moduleResolution: "bundler"` — compatible with Bun's resolution algorithm
- `target: "ESNext"` and `module: "ESNext"` — no downleveling

## Do's and Don'ts

### Do

- **DO** use `bun install` for all dependency operations. Use `bun install --frozen-lockfile` in CI and Docker builds; fall back to `bun install` only when the lockfile is intentionally absent.
- **DO** use explicit `.ts` or `.tsx` file extensions in all import statements (e.g., `import { openDatabase } from "./db.ts"`).
- **DO** keep `strict: true` and `noUncheckedIndexedAccess: true` in both `tsconfig.json` and `tsconfig.frontend.json`.
- **DO** run `bun run typecheck` (which executes `tsc --noEmit` against both tsconfigs) before committing to catch type errors in both backend and frontend.
- **DO** use Bun-native APIs where they provide a clear advantage over Node.js equivalents (e.g., `Bun.file()` for file I/O, `bun:sqlite` for SQLite, `HTMLRewriter` for HTML parsing).
- **DO** keep backend and frontend `tsconfig` files separate — they target different environments with different type libraries.
- **DO** use `bun build --compile --target=bun-linux-{arch}-musl` to produce the production binary. The musl target is required for Alpine-based HA container images.
- **DO** declare the project as `"type": "module"` in `package.json`.

### Don't

- **DON'T** use `npm`, `yarn`, or `pnpm` for package management. The lockfile format is `bun.lock` and other tools cannot interpret it.
- **DON'T** disable or weaken TypeScript strict flags (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`). If a strict flag causes a type error, fix the code — do not relax the compiler.
- **DON'T** use CommonJS syntax (`require()`, `module.exports`). All modules MUST use ESM `import`/`export`.
- **DON'T** omit file extensions in import paths. Extensionless imports (e.g., `import { foo } from "./bar"`) are not permitted — always use `.ts` or `.tsx`.
- **DON'T** merge `tsconfig.json` and `tsconfig.frontend.json` into a single config. The backend requires `bun-types` (which includes Bun's global APIs) while the frontend requires `DOM` libs — these are mutually exclusive type environments.
- **DON'T** add Node.js or a Node.js-specific runtime (e.g., `ts-node`, `tsx`) as a dependency. The entire project runs on Bun.
- **DON'T** introduce a separate bundler (webpack, Vite, esbuild CLI, Rollup) for frontend builds. Bun's native bundler handles the SPA build via `scripts/build.ts`.

## Consequences

### Positive

- **Single toolchain:** Bun replaces five separate tools (Node.js runtime, npm, tsc watch, esbuild, test runner), reducing dependency surface and configuration files.
- **Small production artifact:** `bun build --compile` produces a single ~25 MB static binary with no `node_modules` directory, keeping the container image lean (~55 MB total).
- **Fast installs:** Bun's package installation is significantly faster than npm/yarn/pnpm, reducing CI build times and Docker layer rebuild time.
- **Native TypeScript:** Bun executes `.ts` files directly without a compilation step during development, enabling fast iteration with `bun --watch`.
- **Type safety:** `noUncheckedIndexedAccess` catches `undefined` values from array/object indexing at compile time, preventing a class of runtime errors that are especially dangerous in an unattended add-on managing user data.
- **Consistent imports:** Mandatory `.ts`/`.tsx` extensions eliminate ambiguity about which file an import resolves to, making the codebase grep-friendly and IDE-navigation reliable.
- **Musl compatibility:** Targeting musl ensures the compiled binary runs on Alpine Linux (the HA base image OS) without glibc dependency issues.

### Negative

- **Smaller ecosystem:** Bun is younger than Node.js. Some npm packages with native addons or Node.js-specific APIs may not work. For this project's dependency set (Hono, React, TanStack, SQLite) this has not been an issue, but it constrains future dependency choices.
- **Less community tooling:** IDE plugins, linter integrations, and debugging tools are more mature for Node.js. Bun's debugger and profiler are functional but less polished.
- **Two tsconfig maintenance:** Keeping two `tsconfig` files in sync (shared flags) requires manual attention. A flag added to one but not the other could create inconsistent behavior.

### Risks

- **Bun breaking changes:** Bun is pre-1.0 for some APIs and occasionally introduces breaking changes in minor versions. **Mitigation:** Pin the Bun version in the Dockerfile (`ARG BUN_VERSION=1.3-alpine`) and update deliberately. The `bun.lock` file ensures reproducible installs. CI builds catch regressions before they reach production.
- **musl binary compatibility:** The compiled binary targets musl, which may behave differently from glibc for edge-case libc calls. **Mitigation:** The production container runs Alpine (musl-native), so the binary matches the OS libc. Integration testing on the target image catches compatibility issues.
- **TypeScript strict mode friction:** `noUncheckedIndexedAccess` adds `| undefined` to every indexed access, which can feel verbose for simple array operations. **Mitigation:** Use type narrowing (`if (item !== undefined)`) or non-null assertions (`!`) only when the index is provably valid. The safety benefit far outweighs the verbosity cost for an unattended add-on.

## Compliance and Enforcement

### Automated Enforcement

- **Typecheck in CI:** The `build.yml` workflow runs `bun run typecheck` on every pull request, which executes `tsc --noEmit` against both `tsconfig.json` and `tsconfig.frontend.json`. A strict-mode violation fails the build.
- **Docker build:** The Dockerfile runs `bun install --frozen-lockfile` and `bun build --compile`. If a non-Bun lockfile is committed or the compile step fails, the Docker build fails.
- **Lockfile enforcement:** `bun install --frozen-lockfile` in CI rejects any `package.json` / `bun.lock` mismatch.

### Manual Enforcement

- **Code review:** Reviewers MUST verify that new imports use explicit `.ts`/`.tsx` extensions, that no `require()` calls are introduced, and that no strict flags are disabled in either tsconfig.
- **Dependency review:** When adding a new dependency, verify it works with Bun by checking the Bun compatibility tracker or testing locally before committing.

### Exceptions

Any exception to these rules (e.g., adding a Node.js polyfill for a critical dependency) MUST be approved by the project maintainer and documented as a separate ADR or an inline code comment explaining the deviation.

## References

- [Bun documentation — Runtime](https://bun.sh/docs)
- [Bun documentation — bun build --compile](https://bun.sh/docs/bundler/executables)
- [Bun documentation — Package manager](https://bun.sh/docs/install)
- [TypeScript — strict mode](https://www.typescriptlang.org/tsconfig#strict)
- [TypeScript — noUncheckedIndexedAccess](https://www.typescriptlang.org/tsconfig#noUncheckedIndexedAccess)
