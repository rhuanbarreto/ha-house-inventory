/**
 * Tests for device classification heuristics.
 *
 * The classifyDevice function decides which HA devices represent real
 * physical assets vs HA meta-devices (supervisor, mobile apps, pets).
 */

import { describe, expect, test } from "bun:test";
import { classifyDevice } from "../filters.ts";
import type { HaDevice } from "../ha-client.ts";

/** Minimal stub device with required fields. */
function device(overrides: Partial<HaDevice> = {}): HaDevice {
  return {
    id: "test_device_1",
    name: "Test Device",
    name_by_user: null,
    manufacturer: "Acme Corp",
    model: "Widget Pro",
    model_id: null,
    sw_version: null,
    hw_version: null,
    serial_number: null,
    identifiers: [],
    connections: [],
    area_id: null,
    disabled_by: null,
    entry_type: null,
    ...overrides,
  };
}

describe("classifyDevice", () => {
  // ---- Visible (real) devices ----

  test("real device with manufacturer and model is visible", () => {
    const result = classifyDevice(device());
    expect(result.hidden).toBe(false);
    expect(result.reason).toBeNull();
  });

  test("device with area but no manufacturer/model stays visible", () => {
    const result = classifyDevice(
      device({ manufacturer: null, model: null, area_id: "kitchen" }),
    );
    expect(result.hidden).toBe(false);
  });

  test("Whisker device that is NOT a cat profile stays visible", () => {
    const result = classifyDevice(
      device({ manufacturer: "Whisker", model: "Litter-Robot 4" }),
    );
    expect(result.hidden).toBe(false);
  });

  // ---- Hidden: Home Assistant meta-devices ----

  test("HA Core device is hidden", () => {
    const result = classifyDevice(
      device({ manufacturer: "Home Assistant", model: "Core" }),
    );
    expect(result.hidden).toBe(true);
    expect(result.reason).toBe("home_assistant_meta");
  });

  test("HA Supervisor device is hidden", () => {
    const result = classifyDevice(
      device({ manufacturer: "Home Assistant", model: "Supervisor" }),
    );
    expect(result.hidden).toBe(true);
    expect(result.reason).toBe("home_assistant_meta");
  });

  // ---- Hidden: Service entries ----

  test("entry_type=service is hidden", () => {
    const result = classifyDevice(
      device({ entry_type: "service", manufacturer: "Sun", model: "Solar" }),
    );
    expect(result.hidden).toBe(true);
    expect(result.reason).toBe("service_entry");
  });

  // ---- Hidden: HACS ----

  test("HACS integration is hidden", () => {
    const result = classifyDevice(
      device({ manufacturer: "hacs.xyz", model: "HACS" }),
    );
    expect(result.hidden).toBe(true);
    expect(result.reason).toBe("software_integration");
  });

  // ---- Hidden: Mobile app installs ----

  test("official companion app install is hidden", () => {
    const result = classifyDevice(
      device({
        manufacturer: "Official apps",
        model: "Home Assistant App",
        name: "iPhone",
      }),
    );
    expect(result.hidden).toBe(true);
    expect(result.reason).toBe("ha_mobile_app");
  });

  test("community companion app install is hidden", () => {
    const result = classifyDevice(
      device({
        manufacturer: "Home Assistant Community Apps",
        model: "Home Assistant App",
        name: "Android Tablet",
      }),
    );
    expect(result.hidden).toBe(true);
    expect(result.reason).toBe("ha_mobile_app");
  });

  // ---- Hidden: Whisker pet profiles ----

  test("Whisker cat profile is hidden", () => {
    const result = classifyDevice(
      device({ manufacturer: "Whisker", model: "Ragdoll cat" }),
    );
    expect(result.hidden).toBe(true);
    expect(result.reason).toBe("pet_profile");
  });

  test("Whisker cat profile (different breed) is hidden", () => {
    const result = classifyDevice(
      device({ manufacturer: "Whisker", model: "Brazilian_shorthair cat" }),
    );
    expect(result.hidden).toBe(true);
    expect(result.reason).toBe("pet_profile");
  });

  // ---- Hidden: No identity ----

  test("device with no manufacturer, no model, no area is hidden", () => {
    const result = classifyDevice(
      device({ manufacturer: null, model: null, area_id: null }),
    );
    expect(result.hidden).toBe(true);
    expect(result.reason).toBe("no_identity");
  });
});
