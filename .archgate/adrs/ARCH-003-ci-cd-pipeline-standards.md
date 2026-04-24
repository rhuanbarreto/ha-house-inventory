---
id: ARCH-003
title: CI/CD Pipeline Standards
domain: architecture
rules: true
files:
  - ".github/workflows/build.yml"
  - ".github/workflows/release.yml"
  - "house-inventory/config.yaml"
  - "house-inventory/CHANGELOG.md"
---

# CI/CD Pipeline Standards

## Context

House Inventory ships as a multi-architecture Docker image to HA users via GHCR. The CI/CD pipeline must build images for amd64 and aarch64, run type checks, and automate the release process — all without manual intervention once code merges to `main`. Getting the pipeline wrong has direct user impact: a broken aarch64 image means every Raspberry Pi and HA Green user gets a non-functional add-on.

Without standardized pipeline rules, the project risks:

1. **Silent architecture-specific breakage** — the release workflow for this project previously shipped a broken aarch64 image because the `BUILD_FROM` build argument was missing from the release matrix. The Dockerfile defaulted to the amd64 base image, and the aarch64 container failed at startup with `exec /init: exec format error`. This was a production incident that affected real users.
2. **Version drift** — hardcoding versions in workflow files instead of reading from `config.yaml` creates a mismatch between the version users see in HA and the image tag that gets pulled.
3. **Incomplete validation** — skipping typecheck or skipping an architecture in the build matrix means bugs slip through to production undetected.
4. **Accidental image pushes from PRs** — pushing images from PR builds pollutes the registry with unreviewed code and can overwrite the `:latest` tag.

### Alternatives Considered

- **HA Community Builder (ha-addon-builder)**: A pre-built GitHub Action maintained by the HA community. It handles multi-arch builds, image tagging, and GHCR push in one step. However, it abstracts away the matrix and build-arg configuration, making it harder to debug architecture-specific issues like the `BUILD_FROM` bug. It also couples the project to a third-party action's release cadence.
- **Manual release process**: Creating GitHub Releases by hand and triggering builds manually. This is error-prone and slow, especially for a solo-maintainer project. It also makes it easy to forget an architecture or skip a changelog entry.
- **Monorepo CI tool (Nx, Turborepo)**: Overkill for a single-package project with two workflows. These tools add dependency management complexity without meaningful benefit.
- **Custom matrix generation via script**: A shell script could generate the matrix JSON dynamically, ensuring `base` is always present. This adds indirection without clear value for a two-architecture matrix.

For House Inventory, explicit GitHub Actions workflows with a manually maintained matrix are the right balance: the matrix is small (2 entries), the `BUILD_FROM` requirement is critical and must be visible in code review, and the release process is fully automated from a version bump in `config.yaml`.

This decision builds on [ARCH-001 — Tech Stack and Runtime](./ARCH-001-tech-stack-and-runtime.md), which defines the typecheck command (`bun run typecheck`), and [ARCH-002 — HA Add-on Container Architecture](./ARCH-002-ha-add-on-container-architecture.md), which mandates the `BUILD_FROM` build argument and documents the production incident that motivated the pipeline rules.

## Decision

The project MUST maintain two GitHub Actions workflows: **`build.yml`** for PR validation and **`release.yml`** for automated releases. Both workflows MUST build Docker images for all supported architectures (amd64, aarch64) using an explicit matrix that includes a `base` field. The `base` field MUST be passed as the `BUILD_FROM` build argument to `docker/build-push-action`. The version source of truth MUST be the `version` field in `house-inventory/config.yaml`.

### Scope

This ADR covers:
- The structure and required fields of CI/CD workflow files
- The architecture build matrix and `BUILD_FROM` requirements
- The release automation process (version extraction, changelog, GHCR push, GitHub Release)
- The PR validation pipeline (build + typecheck)
- Image naming and tagging conventions

This ADR does NOT cover:
- The Dockerfile structure itself (see [ARCH-002](./ARCH-002-ha-add-on-container-architecture.md))
- The Bun runtime or typecheck configuration (see [ARCH-001](./ARCH-001-tech-stack-and-runtime.md))
- The add-on `config.yaml` fields beyond `version` (see [ARCH-002](./ARCH-002-ha-add-on-container-architecture.md))

### build.yml — PR Validation

Triggered on pull requests touching `house-inventory/**` or the workflow itself, plus `workflow_dispatch`. Two jobs:

1. **`build`**: Matrix job that builds Docker images for amd64 and aarch64 (no push). Uses QEMU for aarch64 cross-compilation on `ubuntu-latest` runners. Each matrix entry MUST include `arch`, `platform`, and `base` fields. Passes `BUILD_FROM=${{ matrix.base }}` as a build argument.
2. **`typecheck`**: Standalone job that runs `bun run typecheck` to validate both backend and frontend TypeScript.

### release.yml — Automated Release

Triggered on push to `main` touching `house-inventory/**` or the workflow itself, plus `workflow_dispatch`. Three jobs:

1. **`prepare`**: Extracts the `version` from `config.yaml`, computes the git tag (`v{version}`), checks if the tag already exists, and extracts the matching `## [{version}]` section from `CHANGELOG.md` as the release body.
2. **`build`**: Matrix job identical in structure to `build.yml`'s build job, but with `push: true`. Tags images as `:{version}` and `:latest`. Each matrix entry MUST include `arch`, `platform`, and `base` fields. Passes `BUILD_FROM=${{ matrix.base }}` as a build argument.
3. **`release`**: Creates a GitHub Release with the extracted changelog body if the tag is new. Runs only when `tag_exists == 'false'`.

### Image Naming Convention

All images MUST follow this naming pattern:
```
ghcr.io/{owner}/ha-house-inventory/{arch}-house-inventory:{version}
ghcr.io/{owner}/ha-house-inventory/{arch}-house-inventory:latest
```

This matches the `image` field in `config.yaml`: `ghcr.io/rhuanbarreto/ha-house-inventory/{arch}-house-inventory`.

### Release Process

The release process is fully automated. To ship a new version:

1. Bump `version` in `house-inventory/config.yaml`
2. Add a `## [{version}]` section to `house-inventory/CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com/) format
3. Merge the PR to `main`

The `release.yml` workflow handles everything from there: building images, pushing to GHCR, and creating the GitHub Release.

## Do's and Don'ts

### Do

- **DO** include `arch`, `platform`, and `base` fields in every architecture matrix entry in both `build.yml` and `release.yml`. The `base` field maps the architecture to the correct HA base image.
- **DO** pass `BUILD_FROM=${{ matrix.base }}` in the `build-args` section of `docker/build-push-action` in every workflow that builds Docker images.
- **DO** read the version from `house-inventory/config.yaml` in `release.yml` instead of hardcoding it. The `config.yaml` `version` field is the single source of truth.
- **DO** run `bun run typecheck` as a separate CI job on every PR to catch TypeScript errors in both backend and frontend code.
- **DO** use QEMU via `docker/setup-qemu-action` for cross-architecture builds on `ubuntu-latest` runners. Enable it conditionally (`if: matrix.arch != 'amd64'`) to skip the setup overhead for native builds.
- **DO** use GitHub Actions cache (`type=gha`) with architecture-scoped keys (`scope=${{ matrix.arch }}` or `scope=release-${{ matrix.arch }}`) to speed up rebuilds.
- **DO** pin GitHub Actions to major version tags (`@v5`, `@v3`, `@v6`) for stability while still receiving patch updates.
- **DO** add a `## [{version}]` section to `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com/) format before merging a version bump.
- **DO** set `fail-fast: false` in the build matrix so that a failure on one architecture does not cancel the other.

### Don't

- **DON'T** push Docker images from PR builds (`build.yml`). PR builds MUST use `push: false`. Only `release.yml` pushes images to GHCR.
- **DON'T** omit any supported architecture from the build matrix. Both `amd64` and `aarch64` MUST be present in every workflow that builds Docker images.
- **DON'T** omit the `base` field from a matrix entry. A missing `base` causes `BUILD_FROM` to default to the amd64 image, producing a broken container on aarch64.
- **DON'T** hardcode the version in workflow files. The version MUST be extracted from `config.yaml` at runtime.
- **DON'T** skip the typecheck job in `build.yml`. Typecheck validates both `tsconfig.json` (backend) and `tsconfig.frontend.json` (frontend) and MUST run on every PR.
- **DON'T** use `fail-fast: true` in the build matrix. Architecture-specific failures must be visible independently.
- **DON'T** create GitHub Releases manually. The `release.yml` workflow handles release creation automatically when a new version tag is detected.

## Consequences

### Positive

- **Multi-arch correctness:** The mandatory `base` field in every matrix entry eliminates the class of bugs where an architecture gets the wrong base image. The Archgate rule catches this before CI even runs.
- **Zero-touch releases:** Merging a version bump to `main` automatically builds images, pushes to GHCR, and creates a GitHub Release with changelog — no manual steps.
- **Type safety in CI:** Running `bun run typecheck` on every PR catches TypeScript errors across both backend and frontend before code reaches `main`.
- **Cross-arch validation:** QEMU-based aarch64 builds on `ubuntu-latest` verify that the compiled binary and container work on ARM without requiring ARM hardware.
- **Cache efficiency:** Architecture-scoped GHA caches (`scope=${{ matrix.arch }}`) prevent cache collisions between amd64 and aarch64 builds.
- **Independent failure visibility:** `fail-fast: false` ensures that if one architecture fails, the other still completes and reports its status independently.
- **Changelog-driven releases:** The release body is extracted from `CHANGELOG.md`, ensuring every release has documented changes visible on the GitHub Releases page.

### Negative

- **QEMU build speed:** Cross-compiling aarch64 on amd64 runners via QEMU is significantly slower (3-5x) than native ARM builds. This increases CI time for every PR and release.
- **Matrix duplication:** The architecture-to-base-image mapping is duplicated between `build.yml` and `release.yml`. Changes to the base image version must be updated in both files.
- **Manual changelog maintenance:** The changelog must be manually written before each release. Forgetting to add a section results in a generic "Release {version}" body on the GitHub Release.

### Risks

- **GHCR outage during release:** If GHCR is down when `release.yml` pushes images, the release partially fails (GitHub Release created but images missing). **Mitigation:** `workflow_dispatch` allows re-running the release workflow manually. The `tag_exists` check prevents duplicate releases, so re-running is safe.
- **Base image version drift:** When HA updates their base images (e.g., from `3.19` to `3.20`), both workflow files must be updated in sync with the Dockerfile. **Mitigation:** The `base` field values are visible in code review. A Renovate bot or Dependabot configuration can automate base image update PRs.
- **QEMU instability:** QEMU-based cross-compilation occasionally produces flaky builds due to emulation edge cases. **Mitigation:** `fail-fast: false` isolates failures. Re-running the workflow usually resolves transient QEMU issues. The build step uses Docker Buildx with BuildKit, which has robust QEMU integration.

## Implementation Pattern

### Required Matrix Structure

Every workflow that builds Docker images MUST use this matrix structure:

```yaml
# Good: every entry has arch, platform, AND base
strategy:
  fail-fast: false
  matrix:
    include:
      - arch: amd64
        platform: linux/amd64
        base: ghcr.io/home-assistant/amd64-base:3.19
      - arch: aarch64
        platform: linux/arm64
        base: ghcr.io/home-assistant/aarch64-base:3.19
```

```yaml
# Bad: missing base field — causes exec format error on aarch64
strategy:
  matrix:
    include:
      - arch: amd64
        platform: linux/amd64
      - arch: aarch64
        platform: linux/arm64
```

### Required build-args

```yaml
# Good: BUILD_FROM passed from matrix.base
- uses: docker/build-push-action@v6
  with:
    build-args: |
      BUILD_FROM=${{ matrix.base }}
```

```yaml
# Bad: no build-args — Dockerfile defaults to amd64-base for all architectures
- uses: docker/build-push-action@v6
  with:
    context: ./house-inventory
    # missing build-args!
```

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule `release-matrix-base-field`:** Verifies that `release.yml` matrix entries include a `base` field for each architecture. Runs on every `archgate check`.
- **Archgate rule `release-build-from-arg`:** Verifies that `release.yml` passes `BUILD_FROM` in the `build-args` section of `docker/build-push-action`. Runs on every `archgate check`.
- **CI itself:** `build.yml` builds both architectures on every PR. A missing `BUILD_FROM` causes the Docker build to use the wrong base image, which is caught if the build fails (though the failure may be subtle — hence the Archgate rules as the primary check).

### Manual Enforcement

- **Code review for workflow changes:** Any PR modifying `.github/workflows/*.yml` MUST be reviewed for: (1) presence of `base` in every matrix entry, (2) `BUILD_FROM=${{ matrix.base }}` in `build-args`, (3) `push: false` in `build.yml` and `push: true` in `release.yml`.
- **Release checklist:** Before merging a version bump, verify that `CHANGELOG.md` has a `## [{version}]` section matching the version in `config.yaml`.

### Exceptions

Adding a new workflow that builds Docker images (e.g., a nightly build) MUST follow the same matrix and `BUILD_FROM` conventions documented here. Any deviation MUST be approved by the project maintainer and documented as a comment in the workflow file.

## References

- [ARCH-001 — Tech Stack and Runtime](./ARCH-001-tech-stack-and-runtime.md)
- [ARCH-002 — HA Add-on Container Architecture](./ARCH-002-ha-add-on-container-architecture.md)
- [GitHub Actions — Using a matrix for your jobs](https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs)
- [docker/build-push-action](https://github.com/docker/build-push-action)
- [docker/setup-qemu-action](https://github.com/docker/setup-qemu-action)
- [Keep a Changelog](https://keepachangelog.com/)
- [Semver](https://semver.org/)
