/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "release-matrix-base-field": {
      description:
        "release.yml matrix entries MUST include a 'base' field mapping each architecture " +
        "to the correct HA base image. Missing 'base' causes BUILD_FROM to default to amd64, " +
        "producing broken aarch64 images.",
      async check(ctx) {
        const files = await ctx.glob(".github/workflows/release.yml");
        if (files.length === 0) {
          ctx.report.info({
            message: "No release.yml found at .github/workflows/release.yml",
          });
          return;
        }

        const content = await ctx.readFile(".github/workflows/release.yml");
        const lines = content.split("\n");

        // Find matrix include blocks and check each entry has a 'base' field.
        // We look for "- arch:" lines within a matrix section and verify a
        // "base:" line follows before the next "- arch:" or section end.
        let inMatrix = false;
        let inBuildJob = false;
        let currentArchLine = -1;
        let currentArch = "";
        let foundBase = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const trimmed = line.trim();

          // Detect we're in the build job (the one that pushes images)
          if (/^\s{2}build:/.test(line) || /^\s{2}build\s*:/.test(line)) {
            inBuildJob = true;
            inMatrix = false;
          }

          // Detect matrix section within build job
          if (inBuildJob && trimmed === "include:") {
            inMatrix = true;
            continue;
          }

          // Detect end of build job (next top-level job)
          if (inBuildJob && /^\s{2}\w+:/.test(line) && !line.includes("build")) {
            // Flush last entry
            if (currentArchLine >= 0 && !foundBase) {
              ctx.report.violation({
                message:
                  `release.yml matrix entry for '${currentArch}' is missing 'base' field. ` +
                  "Each architecture MUST map to its HA base image (e.g., ghcr.io/home-assistant/aarch64-base:3.19).",
                file: ".github/workflows/release.yml",
                line: currentArchLine + 1,
                fix: `Add 'base: ghcr.io/home-assistant/${currentArch}-base:3.19' to this matrix entry`,
              });
            }
            inBuildJob = false;
            inMatrix = false;
            currentArchLine = -1;
          }

          if (!inMatrix) continue;

          // Detect a new matrix entry
          const archMatch = trimmed.match(/^-\s*arch:\s*(\S+)/);
          if (archMatch) {
            // Flush previous entry
            if (currentArchLine >= 0 && !foundBase) {
              ctx.report.violation({
                message:
                  `release.yml matrix entry for '${currentArch}' is missing 'base' field. ` +
                  "Each architecture MUST map to its HA base image.",
                file: ".github/workflows/release.yml",
                line: currentArchLine + 1,
                fix: `Add 'base: ghcr.io/home-assistant/${currentArch}-base:3.19' to this matrix entry`,
              });
            }
            currentArch = archMatch[1]!;
            currentArchLine = i;
            foundBase = false;
            continue;
          }

          // Check for base field within current entry
          if (currentArchLine >= 0 && /^\s+base:\s*\S+/.test(trimmed)) {
            foundBase = true;
          }

          // Detect steps: which means matrix section is over
          if (trimmed === "steps:") {
            // Flush last entry
            if (currentArchLine >= 0 && !foundBase) {
              ctx.report.violation({
                message:
                  `release.yml matrix entry for '${currentArch}' is missing 'base' field. ` +
                  "Each architecture MUST map to its HA base image.",
                file: ".github/workflows/release.yml",
                line: currentArchLine + 1,
                fix: `Add 'base: ghcr.io/home-assistant/${currentArch}-base:3.19' to this matrix entry`,
              });
            }
            inMatrix = false;
            currentArchLine = -1;
          }
        }
      },
    },

    "release-build-from-arg": {
      description:
        "release.yml MUST pass BUILD_FROM=${{ matrix.base }} in the build-args of " +
        "docker/build-push-action. Without this, the Dockerfile defaults to amd64-base " +
        "for all architectures.",
      async check(ctx) {
        const files = await ctx.glob(".github/workflows/release.yml");
        if (files.length === 0) {
          ctx.report.info({
            message: "No release.yml found at .github/workflows/release.yml",
          });
          return;
        }

        const content = await ctx.readFile(".github/workflows/release.yml");

        // Check that BUILD_FROM appears in a build-args block
        const hasBuildFrom = /build-args:\s*\|?\s*\n\s*BUILD_FROM=/.test(content) ||
          /build-args:\s*BUILD_FROM=/.test(content);

        if (!hasBuildFrom) {
          // Find the build-push-action line for a useful line number
          const lines = content.split("\n");
          let actionLine = 0;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]!.includes("docker/build-push-action")) {
              actionLine = i + 1;
              break;
            }
          }

          ctx.report.violation({
            message:
              "release.yml does not pass BUILD_FROM in build-args for docker/build-push-action. " +
              "This causes the Dockerfile to default to the amd64 base image for all architectures, " +
              "producing broken aarch64 containers.",
            file: ".github/workflows/release.yml",
            line: actionLine || undefined,
            fix: 'Add to build-push-action:\n  build-args: |\n    BUILD_FROM=${{ matrix.base }}',
          });
        }
      },
    },
  },
} satisfies RuleSet;
