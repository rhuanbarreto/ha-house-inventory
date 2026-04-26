/**
 * Tests for the enrichment anti-hallucination URL validation.
 *
 * validateUrls ensures that any URL the LLM returns is either:
 *   1. Present verbatim in the search candidate set, OR
 *   2. On a known trusted domain for the manufacturer brand.
 *
 * URLs that fail both checks are nulled out — this prevents the LLM
 * from inventing plausible-looking URLs that don't actually exist.
 */

import { describe, expect, test } from "bun:test";
import { validateUrls, type EnrichedLinks } from "../enrich.ts";
import type { SearchResult } from "../search.ts";

const CANDIDATES: SearchResult[] = [
  {
    url: "https://support.roborock.com/hc/en-us/articles/123",
    title: "Roborock S8 Manual",
    snippet: "User manual for S8 Pro Ultra",
  },
  {
    url: "https://us.roborock.com/products/roborock-s8-pro-ultra",
    title: "Roborock S8 Pro Ultra",
    snippet: "Official product page",
  },
  {
    url: "https://www.amazon.com/Roborock-S8-Pro-Ultra/dp/B0C123",
    title: "Amazon listing",
    snippet: "Buy the S8 Pro Ultra",
  },
  {
    url: "https://www.manualslib.com/manual/roborock-s8.pdf",
    title: "ManualsLib Roborock",
    snippet: "Third-party manual hosting",
  },
];

function links(overrides: Partial<EnrichedLinks> = {}): EnrichedLinks {
  return {
    product_url: null,
    support_url: null,
    manual_url: null,
    firmware_url: null,
    parts_url: null,
    model_marketing_name: null,
    notes: null,
    ...overrides,
  };
}

describe("validateUrls", () => {
  test("allows URLs from the candidate set", () => {
    const result = validateUrls(
      links({
        product_url: "https://us.roborock.com/products/roborock-s8-pro-ultra",
        manual_url: "https://www.manualslib.com/manual/roborock-s8.pdf",
      }),
      CANDIDATES,
      "Roborock",
    );
    expect(result.product_url).toBe(
      "https://us.roborock.com/products/roborock-s8-pro-ultra",
    );
    expect(result.manual_url).toBe(
      "https://www.manualslib.com/manual/roborock-s8.pdf",
    );
  });

  test("allows URLs on a trusted domain even if not in candidates", () => {
    const result = validateUrls(
      links({
        support_url: "https://support.roborock.com/hc/en-us/some-other-article",
      }),
      CANDIDATES,
      "Roborock",
    );
    // support.roborock.com is trusted for Roborock
    expect(result.support_url).toBe(
      "https://support.roborock.com/hc/en-us/some-other-article",
    );
  });

  test("nulls hallucinated URLs not in candidates or trusted domains", () => {
    const result = validateUrls(
      links({
        product_url: "https://fake-roborock-site.com/s8-pro-ultra",
        firmware_url: "https://totally-made-up.com/firmware.bin",
      }),
      CANDIDATES,
      "Roborock",
    );
    expect(result.product_url).toBeNull();
    expect(result.firmware_url).toBeNull();
  });

  test("preserves non-URL fields regardless", () => {
    const result = validateUrls(
      links({
        model_marketing_name: "Roborock S8 Pro Ultra",
        notes: "Top-of-line robot vacuum with auto-empty dock",
        product_url: "https://hallucinated.example.com",
      }),
      CANDIDATES,
      "Roborock",
    );
    expect(result.model_marketing_name).toBe("Roborock S8 Pro Ultra");
    expect(result.notes).toBe(
      "Top-of-line robot vacuum with auto-empty dock",
    );
    // But the hallucinated URL is nulled:
    expect(result.product_url).toBeNull();
  });

  test("handles all-null URLs gracefully", () => {
    const result = validateUrls(links(), CANDIDATES, "Roborock");
    expect(result.product_url).toBeNull();
    expect(result.support_url).toBeNull();
    expect(result.manual_url).toBeNull();
    expect(result.firmware_url).toBeNull();
    expect(result.parts_url).toBeNull();
  });

  test("handles unknown manufacturer (no trusted domains)", () => {
    const result = validateUrls(
      links({
        product_url: "https://us.roborock.com/products/roborock-s8-pro-ultra", // in candidates
        support_url: "https://support.roborock.com/unknown-page", // trusted domain but wrong mfg
      }),
      CANDIDATES,
      "UnknownBrand",
    );
    // Candidate URL is allowed regardless of manufacturer
    expect(result.product_url).toBe(
      "https://us.roborock.com/products/roborock-s8-pro-ultra",
    );
    // Trusted domain check fails for UnknownBrand
    expect(result.support_url).toBeNull();
  });

  test("handles empty candidate set", () => {
    const result = validateUrls(
      links({
        product_url: "https://support.apple.com/iphone",
      }),
      [],
      "Apple",
    );
    // No candidates, but apple.com is trusted for Apple
    expect(result.product_url).toBe("https://support.apple.com/iphone");
  });
});
