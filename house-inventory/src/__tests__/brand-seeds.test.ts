/**
 * Tests for brand-seed lookups and trusted-domain validation.
 *
 * These are used by the enrichment anti-hallucination layer to allow
 * URLs from known manufacturer domains even if they didn't appear in
 * search results.
 */

import { describe, expect, test } from "bun:test";
import { getBrandSeed, isTrustedDomain } from "../brand-seeds.ts";

describe("getBrandSeed", () => {
  test("returns seed for known brand (case-insensitive)", () => {
    const seed = getBrandSeed("Apple");
    expect(seed).not.toBeNull();
    expect(seed?.support_url).toBe("https://support.apple.com");
  });

  test("returns seed for known brand (lowercase)", () => {
    const seed = getBrandSeed("roborock");
    expect(seed).not.toBeNull();
    expect(seed?.product_url).toBe("https://us.roborock.com");
  });

  test("strips 'Inc.' suffix", () => {
    const seed = getBrandSeed("Apple Inc.");
    expect(seed).not.toBeNull();
  });

  test("strips 'Corp.' suffix", () => {
    const seed = getBrandSeed("Google Corp.");
    expect(seed).not.toBeNull();
  });

  test("strips 'AB' suffix (IKEA)", () => {
    const seed = getBrandSeed("IKEA of Sweden AB");
    // Normalises to "ikea of sweden" which has its own entry
    const seed2 = getBrandSeed("IKEA of Sweden");
    expect(seed2).not.toBeNull();
    expect(seed2?.product_url).toBe("https://www.ikea.com");
  });

  test("returns null for unknown brand", () => {
    const seed = getBrandSeed("UnknownBrandXYZ");
    expect(seed).toBeNull();
  });

  test("handles empty string", () => {
    const seed = getBrandSeed("");
    expect(seed).toBeNull();
  });

  test("handles whitespace-padded input", () => {
    const seed = getBrandSeed("  Samsung  ");
    expect(seed).not.toBeNull();
    expect(seed?.product_url).toBe("https://www.samsung.com");
  });
});

describe("isTrustedDomain", () => {
  test("exact domain match is trusted", () => {
    expect(isTrustedDomain("https://support.apple.com/en-us/HT201222", "Apple")).toBe(true);
  });

  test("subdomain of trusted domain is trusted", () => {
    expect(isTrustedDomain("https://www.samsung.com/us/smartphones", "Samsung")).toBe(true);
  });

  test("unrelated domain is not trusted", () => {
    expect(isTrustedDomain("https://www.amazon.com/apple-iphone", "Apple")).toBe(false);
  });

  test("unknown manufacturer is never trusted", () => {
    expect(isTrustedDomain("https://example.com", "UnknownBrand")).toBe(false);
  });

  test("invalid URL returns false", () => {
    expect(isTrustedDomain("not-a-url", "Apple")).toBe(false);
  });

  test("similar but different domain is not trusted", () => {
    // "apple-support.com" is NOT "apple.com"
    expect(isTrustedDomain("https://apple-support.com/fake", "Apple")).toBe(false);
  });

  test("Roborock support subdomain is trusted", () => {
    expect(
      isTrustedDomain("https://support.roborock.com/hc/en-us", "Roborock"),
    ).toBe(true);
  });

  test("Whisker's litter-robot.com is trusted", () => {
    expect(
      isTrustedDomain("https://www.litter-robot.com/litter-robot-4.html", "Whisker"),
    ).toBe(true);
  });
});
