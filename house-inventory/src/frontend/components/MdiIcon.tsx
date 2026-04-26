/**
 * Lightweight inline-SVG renderer for Material Design Icons.
 *
 * Maps the most common `mdi:*` icon names used in HA area/floor
 * registries to inline SVG paths. Falls back to a generic "room"
 * icon for unmapped names.
 *
 * Using inline SVGs avoids pulling in the full MDI icon font (~240 KB)
 * or depending on CDN-hosted assets — keeping the bundle small per FE-001.
 *
 * SVG paths sourced from https://materialdesignicons.com/ (Apache 2.0).
 */

// All paths are for a 24×24 viewBox.
const ICON_PATHS: Record<string, string> = {
  // Rooms
  sofa: "M21 9V7c0-1.65-1.35-3-3-3H6C4.35 4 3 5.35 3 7v2c-1.65 0-3 1.35-3 3v5h2v1h2v-1h16v1h2v-1h2v-5c0-1.65-1.35-3-3-3M5 7c0-.55.45-1 1-1h12c.55 0 1 .45 1 1v2.78c-.61.55-1 1.34-1 2.22v2H6v-2c0-.88-.39-1.67-1-2.22V7m17 8H2v-2c0-.55.45-1 1-1s1 .45 1 1v1h16v-1c0-.55.45-1 1-1s1 .45 1 1v2Z",
  "silverware-fork-knife":
    "M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7m5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4Z",
  coffee: "M2 21v-1h18v1H2m2-3v-7H2V8h2V4h12v4h2v3h-2v7H4m8-14H8v3h4V4Z",
  stove:
    "M6 18v2H4v-2h2m4 0v2H8v-2h2m4 0v2h-2v-2h2m4 0v2h-2v-2h2M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m2.5 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M5 14h14v-2H5v2Z",
  "bed-double": "M19 7h-8v7H3V5H1v15h2v-3h18v3h2V11c0-2.21-1.79-4-4-4Z",
  "bed-single": "M19 7h-8v7H3V5H1v15h2v-3h18v3h2V11c0-2.21-1.79-4-4-4Z",
  bed: "M19 7h-8v7H3V5H1v15h2v-3h18v3h2V11c0-2.21-1.79-4-4-4Z",
  shower:
    "M21 14v-3c0-1.11-.89-2-2-2h-1V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v6H5c-1.11 0-2 .89-2 2v3H2v2h1.17c.41 1.17 1.52 2 2.83 2h12c1.31 0 2.42-.83 2.83-2H22v-2h-1M8 4h8v5H8V4m-2 7h12v3H6v-3m12 5H6c-.55 0-1-.45-1-1h14c0 .55-.45 1-1 1Z",
  desk: "M3 6h18v2H3V6m0 4h12v2H3v-2m0 4h18v2H3v-2m0 4h12v2H3v-2Z",
  "washing-machine":
    "M18 2.01 6 2a2 2 0 0 0-2 2v16c0 1.11.89 2 2 2h12c1.11 0 2-.89 2-2V4c0-1.11-.89-1.99-2-1.99M18 20H6v-9.5h12V20m0-12H6V4h12v4M8 5h2v2H8V5m4 0h2v2h-2V5m-1 10c2.76 0 5-2.24 5-5h-2a3 3 0 0 1-3 3 3 3 0 0 1-3-3H6c0 2.76 2.24 5 5 5Z",
  walk: "M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2M9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7Z",
  door: "M8 2v20h2v-2h4v2h2V2H8m6 8h-2v2h2V10Z",
  garage: "M20 9h-7V4H3v16h18v-9l-1-2m-8 9H7v-6h5v6m6 0h-4v-6h4v6Z",
  balcony:
    "M10 2v2H8V2h2m4 0v2h-2V2h2M5 8h14v2H5V8m0 4h2v8H5v-8m12 0h2v8h-2v-8m-4 0h2v8h-2v-8m-4 0h2v8H9v-8Z",
  mountain: "M13 2L3 17h3.34l1.33 5H20l-7-20M11 17l1.5-5.5L14 17h-3Z",
  home: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8h5Z",
  briefcase:
    "M10 2h4a2 2 0 0 1 2 2v2h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8c0-1.11.89-2 2-2h4V4c0-1.11.89-2 2-2m4 4V4h-4v2h4Z",
  "chair-rolling":
    "M22 11h-2V9a2 2 0 0 0-2-2h-4V5h2V3h-2a2 2 0 0 0-2 2v2H8a2 2 0 0 0-2 2v2H4v2h2v4a2 2 0 0 0 2 2h1v2H7v2h2a2 2 0 0 0 2-2v-2h2v2a2 2 0 0 0 2 2h2v-2h-2v-2h1a2 2 0 0 0 2-2v-4h2v-2Z",
  toilet:
    "M9 2v3H5v2h1c0 3.59 2.93 6.5 6.5 6.5H13v5.5a1.5 1.5 0 0 0 3 0V13.5c2.07 0 3.92-.83 5.28-2.18C22.46 10.14 23 8.71 23 7.15V7h-4V4H9Z",
  pool: "M2 15c1.67 0 2.5.83 4.17.83S8.83 15 10.5 15c1.67 0 2.5.83 4.17.83S17.17 15 18.83 15c1.67 0 2.5.83 4.17.83v-2c-1.67 0-2.5-.83-4.17-.83s-2.5.83-4.17.83S12.17 13 10.5 13c-1.67 0-2.5.83-4.17.83S3.83 13 2.17 13v2M2 19c1.67 0 2.5.83 4.17.83s2.5-.83 4.17-.83 2.5.83 4.17.83 2.5-.83 4.17-.83c1.67 0 2.5.83 4.17.83v-2c-1.67 0-2.5-.83-4.17-.83s-2.5.83-4.17.83S12.17 17 10.5 17c-1.67 0-2.5.83-4.17.83S3.83 17 2.17 17v2M22 5.5S20.3 4 18.5 4 15 5.5 15 5.5V10h7V5.5M8.5 3A2.5 2.5 0 0 0 6 5.5V10h5V5.5A2.5 2.5 0 0 0 8.5 3Z",
  "baby-carriage":
    "M13 2v8h8c0-4.42-3.58-8-8-8m-2 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4m6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4m1-2H9.78c-.55 0-.99-.39-1.08-.93L6.44 2H2v2h3.22l2.1 10.69A3 3 0 0 0 7 17c0 1.66 1.34 3 3 3h.08A2.99 2.99 0 0 0 13 22a2.99 2.99 0 0 0 2.92-2H17a3 3 0 0 0 3-3 3 3 0 0 0-.08-.73L21.8 12H13v2h5Z",
  hanger:
    "M12 4a3.5 3.5 0 0 0-3.5 3.5H10a2 2 0 0 1 4 0c0 .83-.67 1.5-1.5 1.5l-.5.29V12l8 5H4l8-5V9.79c1.17-.42 2-1.52 2-2.79A3.5 3.5 0 0 0 12 4M3 19h18v2H3v-2Z",
  television:
    "M21 17H3V5h18v12m0-14H3c-1.11 0-2 .89-2 2v12a2 2 0 0 0 2 2h7v2h4v-2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z",
  lamp: "M8 2h8l4 7H4l4-7m3 9v9H9v-9h2m-1 11a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2Z",
  flower:
    "M12 16a4 4 0 0 1-4-4c0-1.95 1.4-3.57 3.25-3.92a8.71 8.71 0 0 1 3.87-4.49 7.29 7.29 0 0 0-6.24 3.49A4 4 0 0 1 12 4a4 4 0 0 1 4 4c0 .34-.05.67-.13.99A4 4 0 0 1 16 12a4 4 0 0 1-4 4m-.5 2v4h1v-4h-1Z",
  tree: "M12 2L7 12h3v10h4V12h3L12 2Z",
  car: "M5 11l1.5-4.5h11L19 11H5m-1.5 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3m15 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M5 16h14v-5l-1.5-4.5H6.5L5 11v5Z",
  tools:
    "M21.71 20.29l-1.42 1.42a1 1 0 0 1-1.42 0L15 17.83A4.01 4.01 0 0 1 12 19a4 4 0 0 1-4-4c0-1.2.54-2.27 1.38-3L3 5.62 5.62 3l7 7.38A4 4 0 0 1 16 8a4 4 0 0 1 1.17 7.83l3.83 3.83Z",
};

// Common aliases — HA uses both forms
const ALIASES: Record<string, string> = {
  "sofa-outline": "sofa",
  "bed-double-outline": "bed-double",
  "bed-outline": "bed",
  "bed-king-outline": "bed-double",
  "bed-queen-outline": "bed-double",
  "silverware-variant": "silverware-fork-knife",
  silverware: "silverware-fork-knife",
  "food-fork-drink": "silverware-fork-knife",
  fridge: "stove",
  "fridge-outline": "stove",
  countertop: "stove",
  "countertop-outline": "stove",
  "desk-lamp": "lamp",
  "floor-lamp": "lamp",
  "coat-rack": "hanger",
  "door-open": "door",
  "door-closed": "door",
  "car-side": "car",
  "garage-variant": "garage",
  "home-outline": "home",
  "office-building": "briefcase",
  monitor: "television",
  "desktop-mac": "television",
  baby: "baby-carriage",
  "baby-face-outline": "baby-carriage",
  stairs: "home",
  water: "pool",
  "hot-tub": "pool",
};

// Fallback: generic room/cube icon
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
  const resolved = ICON_PATHS[key] ?? ICON_PATHS[ALIASES[key] ?? ""] ?? FALLBACK;

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
