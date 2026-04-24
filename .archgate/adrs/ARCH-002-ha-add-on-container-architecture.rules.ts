/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "dockerfile-build-from": {
      description:
        "The Dockerfile runtime stage MUST use FROM ${BUILD_FROM}, not a hardcoded HA base image. " +
        "Hardcoding causes exec format errors on non-matching architectures.",
      async check(ctx) {
        const dockerfiles = await ctx.glob("house-inventory/Dockerfile");
        if (dockerfiles.length === 0) {
          ctx.report.info({
            message: "No Dockerfile found at house-inventory/Dockerfile",
          });
          return;
        }

        const content = await ctx.readFile("house-inventory/Dockerfile");
        const lines = content.split("\n");

        // Check that BUILD_FROM is declared as an ARG
        const hasBuildFromArg = lines.some((line) =>
          /^\s*ARG\s+BUILD_FROM\s*=/.test(line),
        );
        if (!hasBuildFromArg) {
          ctx.report.violation({
            message:
              "Dockerfile is missing 'ARG BUILD_FROM=...' declaration. " +
              "The runtime stage base image must be parameterized via BUILD_FROM.",
            file: "house-inventory/Dockerfile",
          });
          return;
        }

        // Find all FROM lines that are NOT the builder stage (i.e., not aliased AS builder)
        // and verify they use ${BUILD_FROM}
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!.trim();
          // Match FROM lines, skip builder stage and comment lines
          if (!line.startsWith("FROM ") && !line.startsWith("FROM\t")) continue;
          if (line.includes(" AS builder") || line.includes(" as builder")) continue;
          if (/^#/.test(line)) continue;

          // The runtime FROM must reference BUILD_FROM
          if (!line.includes("${BUILD_FROM}") && !line.includes("$BUILD_FROM")) {
            ctx.report.violation({
              message:
                `Runtime stage FROM does not use \${BUILD_FROM}: "${line}". ` +
                "Hardcoding a base image causes exec format errors on non-matching architectures.",
              file: "house-inventory/Dockerfile",
              line: i + 1,
              fix: "Change the runtime FROM to: FROM ${BUILD_FROM}",
            });
          }
        }
      },
    },

    "config-init-false": {
      description:
        "config.yaml MUST set init: false. The HA base image provides s6-overlay; " +
        "setting init: true conflicts with it.",
      async check(ctx) {
        const configs = await ctx.glob("house-inventory/config.yaml");
        if (configs.length === 0) {
          ctx.report.info({
            message: "No config.yaml found at house-inventory/config.yaml",
          });
          return;
        }

        const content = await ctx.readFile("house-inventory/config.yaml");
        const lines = content.split("\n");

        let foundInit = false;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const match = line.match(/^init:\s*(.+)$/);
          if (match) {
            foundInit = true;
            const value = match[1]!.trim();
            if (value !== "false") {
              ctx.report.violation({
                message:
                  `config.yaml sets init: ${value}, but it MUST be init: false. ` +
                  "The HA base image provides s6-overlay as the init system.",
                file: "house-inventory/config.yaml",
                line: i + 1,
                fix: "Change to: init: false",
              });
            }
          }
        }

        if (!foundInit) {
          ctx.report.violation({
            message:
              "config.yaml is missing the 'init' field. Add 'init: false' to delegate " +
              "to the HA base image's s6-overlay init system.",
            file: "house-inventory/config.yaml",
            fix: "Add: init: false",
          });
        }
      },
    },
  },
} satisfies RuleSet;
