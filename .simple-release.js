import { readFileSync, writeFileSync } from "node:fs";

import { NpmProject } from "@simple-release/npm";

/**
 * Custom release project for the House Inventory HA add-on.
 *
 * Extends NpmProject to keep `house-inventory/config.yaml` in sync
 * with `house-inventory/package.json` during version bumps. The
 * config.yaml `version` field is what HA Supervisor reads to determine
 * the add-on version.
 *
 * Publishing is a no-op — Docker images are built and pushed by the
 * workflow steps that follow the simple-release action.
 */
class HouseInventoryProject extends NpmProject {
  constructor() {
    super({ path: "house-inventory/package.json" });
  }

  async bump(options) {
    const result = await super.bump(options);

    if (result) {
      const pkg = JSON.parse(readFileSync("house-inventory/package.json", "utf8"));
      const version = pkg.version;

      // Sync the version into config.yaml (the HA add-on manifest).
      const configPath = "house-inventory/config.yaml";
      const config = readFileSync(configPath, "utf8");
      const updated = config.replace(
        /^version:\s*"[^"]+"/m,
        `version: "${version}"`
      );

      if (updated !== config) {
        writeFileSync(configPath, updated);
        this.changedFiles.push(configPath);
      }
    }

    return result;
  }

  async publish() {
    // No-op — Docker images are published by the release workflow.
  }
}

export const project = new HouseInventoryProject();
