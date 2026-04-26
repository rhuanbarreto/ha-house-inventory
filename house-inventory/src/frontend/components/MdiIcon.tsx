/**
 * Inline-SVG renderer for Material Design Icons.
 *
 * Dynamically resolves any `mdi:*` icon name to its SVG path using
 * the @mdi/js package, which provides all ~7 000 MDI icons as named
 * ES module exports.
 *
 * The conversion from HA's kebab-case names (e.g. "mdi:silverware-fork-knife")
 * to the @mdi/js export format ("mdiSilverwareForkKnife") is done at runtime
 * via a simple string transformation.
 *
 * SVG paths sourced from @mdi/js (Apache 2.0 — materialdesignicons.com).
 */

import * as mdiIcons from "@mdi/js";

/**
 * Convert an MDI kebab-case name to the @mdi/js camelCase export name.
 * E.g. "silverware-fork-knife" → "mdiSilverwareForkKnife"
 */
function toExportName(kebab: string): string {
  return (
    "mdi" +
    kebab
      .split("-")
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join("")
  );
}

// Build a lookup cache on first use to avoid repeated property access.
const allIcons = mdiIcons as unknown as Record<string, string>;

// Fallback: generic cube icon
const FALLBACK =
  "M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.16.12-.36.18-.57.18-.21 0-.41-.06-.57-.18l-7.9-4.44A.991.991 0 0 1 3 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44c.16-.12.36-.18.57-.18.21 0 .41.06.57.18l7.9 4.44c.32.17.53.5.53.88v9M12 4.15 5 8.09v7.82l7 3.94 7-3.94V8.09l-7-3.94Z";

interface MdiIconProps {
  /** Full MDI name, e.g. "mdi:sofa" or just "sofa" */
  name: string | null | undefined;
  /** Icon size in px (default 32) */
  size?: number;
  className?: string;
}

export function MdiIcon({ name, size = 32, className }: MdiIconProps) {
  const key = name?.replace(/^mdi:/, "") ?? "";
  const exportName = toExportName(key);
  const resolved = allIcons[exportName] ?? FALLBACK;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d={resolved} />
    </svg>
  );
}
