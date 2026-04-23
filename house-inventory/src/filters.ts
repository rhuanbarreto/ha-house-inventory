/**
 * Heuristics to decide which HA devices represent real physical assets
 * (a Roborock, a Netatmo station) vs HA's own meta-devices (HA Core,
 * Supervisor, mobile app installs, pet profiles).
 *
 * We never drop rows — every device is stored. Non-physical ones are
 * imported with `hidden = 1` and `hidden_reason` set, so the user can
 * un-hide them from the UI if a heuristic guesses wrong.
 */

import type { HaDevice } from "./ha-client.ts";

export interface HiddenClassification {
  hidden: boolean;
  reason: string | null;
}

export function classifyDevice(device: HaDevice): HiddenClassification {
  // HA Core / Supervisor / Host / OS / Backup all report manufacturer="Home Assistant".
  if (device.manufacturer === "Home Assistant") {
    return { hidden: true, reason: "home_assistant_meta" };
  }

  // `entry_type: "service"` is HA's own flag for non-physical integrations.
  if (device.entry_type === "service") {
    return { hidden: true, reason: "service_entry" };
  }

  // HACS is a software integration, not a device.
  if (device.manufacturer === "hacs.xyz") {
    return { hidden: true, reason: "software_integration" };
  }

  // Companion mobile app installs ("iPhone", "Laptop") appear as devices,
  // but they're the *app* — not a physical asset we need to track here.
  const isMobileAppInstall =
    (device.manufacturer === "Home Assistant Community Apps" ||
      device.manufacturer === "Official apps") &&
    device.model === "Home Assistant App";
  if (isMobileAppInstall) {
    return { hidden: true, reason: "ha_mobile_app" };
  }

  // Whisker's Litter-Robot integration creates a "device" for each pet
  // profile — model looks like "Ragdoll cat" or "Brazilian_shorthair cat".
  if (
    device.manufacturer === "Whisker" &&
    (device.model?.toLowerCase().endsWith(" cat") ?? false)
  ) {
    return { hidden: true, reason: "pet_profile" };
  }

  // No manufacturer + no model is usually virtual (Sun, forecasts). BUT a
  // physical device can still have blank metadata (seen in the wild: a
  // motion sensor and a smoke detector with only a name). If the user has
  // placed it in an area, trust that it's real — keep it visible.
  if (!device.manufacturer && !device.model && !device.area_id) {
    return { hidden: true, reason: "no_identity" };
  }

  return { hidden: false, reason: null };
}
