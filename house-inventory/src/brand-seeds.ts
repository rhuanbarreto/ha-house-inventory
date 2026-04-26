/**
 * Brand-specific "portal" URL seeds.
 *
 * For well-known manufacturers we feed the LLM a short list of authoritative
 * support / product / parts URLs that are true for the entire brand. These
 * supplement DDG results (and compensate for results that bury the real
 * support page under blog posts).
 *
 * Matching is case-insensitive and handles a few known aliases
 * (e.g. "Apple Inc.", "Google Inc." → "google", "Inc."-stripped).
 *
 * Add brands as we encounter them. This file is the single source of truth
 * and is intentionally small — not an attempt to catalogue every vendor on
 * earth, just the ones that actually appear in the user's inventory and
 * benefit from direct lookup.
 */

export interface BrandSeed {
  product_url?: string;
  support_url?: string;
  parts_url?: string;
  firmware_url?: string;
  /** Domains the LLM may cite even if they didn't appear in DDG results. */
  trusted_domains: string[];
}

/** Canonical keys are lowercase, "Inc."/"AB" stripped. */
const SEEDS: Record<string, BrandSeed> = {
  apple: {
    product_url: "https://www.apple.com",
    support_url: "https://support.apple.com",
    trusted_domains: ["apple.com", "support.apple.com"],
  },
  roborock: {
    product_url: "https://us.roborock.com",
    support_url: "https://support.roborock.com",
    parts_url: "https://us.roborock.com/pages/parts-accessories",
    trusted_domains: ["roborock.com", "support.roborock.com"],
  },
  netatmo: {
    product_url: "https://www.netatmo.com",
    support_url: "https://help.netatmo.com",
    trusted_domains: ["netatmo.com"],
  },
  bosch: {
    product_url: "https://www.bosch-home.com",
    support_url: "https://www.bosch-home.com/service-customer",
    trusted_domains: ["bosch-home.com", "bosch.com"],
  },
  "ikea of sweden": {
    product_url: "https://www.ikea.com",
    support_url: "https://www.ikea.com/customer-service",
    trusted_domains: ["ikea.com"],
  },
  ikea: {
    product_url: "https://www.ikea.com",
    support_url: "https://www.ikea.com/customer-service",
    trusted_domains: ["ikea.com"],
  },
  whisker: {
    product_url: "https://www.litter-robot.com",
    support_url: "https://support.litter-robot.com",
    parts_url: "https://www.litter-robot.com/accessories.html",
    trusted_domains: ["litter-robot.com", "support.litter-robot.com", "whisker.com"],
  },
  google: {
    product_url: "https://store.google.com",
    support_url: "https://support.google.com",
    trusted_domains: ["google.com", "support.google.com", "store.google.com"],
  },
  samsung: {
    product_url: "https://www.samsung.com",
    support_url: "https://www.samsung.com/us/support",
    trusted_domains: ["samsung.com"],
  },
  xiaomi: {
    product_url: "https://www.mi.com",
    support_url: "https://www.mi.com/global/support",
    trusted_domains: ["mi.com", "xiaomi.com"],
  },
  philips: {
    product_url: "https://www.philips.com",
    support_url: "https://www.philips.com/c-w/support-home.html",
    trusted_domains: ["philips.com", "usa.philips.com"],
  },
  dyson: {
    product_url: "https://www.dyson.com",
    support_url: "https://www.dyson.com/support",
    trusted_domains: ["dyson.com"],
  },
  miele: {
    product_url: "https://www.miele.com",
    support_url: "https://www.miele.com/en/com/service.htm",
    trusted_domains: ["miele.com"],
  },
};

export function getBrandSeed(manufacturer: string): BrandSeed | null {
  const key = normalise(manufacturer);
  return SEEDS[key] ?? null;
}

export function isTrustedDomain(url: string, manufacturer: string): boolean {
  const seed = getBrandSeed(manufacturer);
  if (!seed) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return seed.trusted_domains.some((d) => host === d || host.endsWith(`.${d}`));
}

function normalise(manufacturer: string): string {
  return manufacturer
    .trim()
    .toLowerCase()
    .replace(/\s+(inc\.?|corp\.?|corporation|llc|ltd\.?|ab|s\.?a\.?)$/, "")
    .replace(/\s+/g, " ");
}
