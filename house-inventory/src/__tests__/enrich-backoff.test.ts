/**
 * Tests for the progressive enrichment backoff.
 *
 * The backoff function uses exponential delay based on the number of
 * failed enrichment attempts per asset. This prevents hot-looping on
 * assets that consistently fail (e.g., no DDG results, LLM timeout)
 * while still retrying eventually.
 */

import { describe, expect, test } from "bun:test";
import { backoffMs } from "../enrich-batch.ts";

describe("backoffMs", () => {
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  test("first attempt uses base backoff (6h)", () => {
    expect(backoffMs(0)).toBe(6 * HOUR);
    expect(backoffMs(1)).toBe(6 * HOUR);
  });

  test("second attempt doubles (12h)", () => {
    expect(backoffMs(2)).toBe(12 * HOUR);
  });

  test("third attempt quadruples (24h)", () => {
    expect(backoffMs(3)).toBe(24 * HOUR);
  });

  test("fourth attempt is 48h", () => {
    expect(backoffMs(4)).toBe(48 * HOUR);
  });

  test("caps at ~8 days regardless of attempts", () => {
    const maxBackoff = 8 * DAY;
    expect(backoffMs(10)).toBe(maxBackoff);
    expect(backoffMs(20)).toBe(maxBackoff);
    expect(backoffMs(100)).toBe(maxBackoff);
  });

  test("backoff is monotonically increasing up to the cap", () => {
    let prev = 0;
    for (let i = 0; i <= 12; i++) {
      const current = backoffMs(i);
      expect(current).toBeGreaterThanOrEqual(prev);
      prev = current;
    }
  });
});
