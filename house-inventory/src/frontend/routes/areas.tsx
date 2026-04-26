/**
 * Areas page — floors with area card grids, matching the HA areas view.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { areasQuery } from "../query.ts";
import { AreaCard } from "../components/AreaCard.tsx";
import { MdiIcon } from "../components/MdiIcon.tsx";
import type { AreaItem, Floor } from "../types.ts";

export function AreasPage() {
  const { data, isLoading } = useQuery(areasQuery);

  if (isLoading || !data) return <div className="card empty">Loading…</div>;

  const { floors, areas, unassignedAssets } = data;

  // Group areas by floor
  const byFloor = new Map<string | null, AreaItem[]>();
  for (const a of areas) {
    const bucket = byFloor.get(a.floor_id);
    if (bucket) bucket.push(a);
    else byFloor.set(a.floor_id, [a]);
  }

  // Render order: known floors in (level, name) order, then "Unassigned"
  const blocks: Array<{ floor: Floor | null; areas: AreaItem[] }> = [];
  for (const f of floors) {
    const floorAreas = byFloor.get(f.id) ?? [];
    if (floorAreas.length > 0) {
      blocks.push({ floor: f, areas: floorAreas });
    }
  }
  const unassignedFloor = byFloor.get(null) ?? [];
  if (unassignedFloor.length > 0) {
    blocks.push({ floor: null, areas: unassignedFloor });
  }

  return (
    <>
      <h1>Areas</h1>
      <p className="page-subtitle">
        {areas.length} area{areas.length === 1 ? "" : "s"} across {floors.length} floor
        {floors.length === 1 ? "" : "s"} — synced from Home Assistant.
      </p>

      {blocks.length === 0 ? (
        <div className="card empty">No areas synced yet. Run a sync from the dashboard.</div>
      ) : (
        blocks.map((block) => (
          <FloorSection
            key={block.floor?.id ?? "__unassigned"}
            floor={block.floor}
            areas={block.areas}
          />
        ))
      )}

      {unassignedAssets > 0 && (
        <>
          <h2>Without an area</h2>
          <div className="card enrich-summary">
            <span>
              {unassignedAssets} asset{unassignedAssets === 1 ? "" : "s"} aren't assigned to any
              area.
            </span>
            <Link to="/assets" search={{ area: "", q: "", hidden: "0" }} className="btn">
              View them →
            </Link>
          </div>
        </>
      )}
    </>
  );
}

function FloorSection({ floor, areas }: { floor: Floor | null; areas: AreaItem[] }) {
  const totalAssets = areas.reduce((s, a) => s + a.visible_count, 0);

  return (
    <section className="floor-section">
      <h2 className="floor-header">
        {floor?.icon && <MdiIcon name={floor.icon} size={20} className="floor-header-icon" />}
        {floor?.name ?? "Unassigned"}
        <span className="floor-header-stats">
          {areas.length} area{areas.length === 1 ? "" : "s"} · {totalAssets} asset
          {totalAssets === 1 ? "" : "s"}
        </span>
      </h2>
      <div className="area-grid">
        {areas.map((a) => (
          <AreaCard key={a.id} area={a} />
        ))}
      </div>
    </section>
  );
}
