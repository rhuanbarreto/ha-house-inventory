/**
 * AreaCard — a single area tile in the card grid.
 *
 * Renders an icon, the area name, and an asset count subtitle.
 * Clicking the card navigates to the asset list filtered by area.
 */

import { Link } from "@tanstack/react-router";
import { MdiIcon } from "./MdiIcon.tsx";
import type { AreaItem } from "../types.ts";

interface AreaCardProps {
  area: AreaItem;
}

export function AreaCard({ area }: AreaCardProps) {
  const subtitle =
    area.visible_count > 0
      ? `${area.visible_count} asset${area.visible_count === 1 ? "" : "s"}`
      : null;

  return (
    <Link to="/assets" search={{ area: area.id, q: "", hidden: "0" }} className="area-card">
      <MdiIcon name={area.icon} size={36} className="area-card-icon" />
      <span className="area-card-name">{area.name}</span>
      {subtitle && <span className="area-card-sub">{subtitle}</span>}
    </Link>
  );
}
