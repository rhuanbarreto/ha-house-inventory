/**
 * Areas page — floors with area tables and asset counts.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { areasQuery } from "../query.ts";
import type { AreaItem } from "../types.ts";

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
  const blocks: Array<{ name: string; areas: AreaItem[] }> = [];
  for (const f of floors) {
    const floorAreas = byFloor.get(f.id) ?? [];
    if (floorAreas.length > 0) {
      blocks.push({ name: f.name, areas: floorAreas });
    }
  }
  const unassignedFloor = byFloor.get(null) ?? [];
  if (unassignedFloor.length > 0) {
    blocks.push({ name: "Unassigned", areas: unassignedFloor });
  }

  return (
    <>
      <h1>Areas</h1>
      <p
        className="muted"
        style={{ color: "var(--text-dim)", marginTop: -8 }}
      >
        {areas.length} area{areas.length === 1 ? "" : "s"} across{" "}
        {floors.length} floor{floors.length === 1 ? "" : "s"} — synced from
        Home Assistant.
      </p>

      {blocks.length === 0 ? (
        <div className="card empty">
          No areas synced yet. Run a sync from the dashboard.
        </div>
      ) : (
        blocks.map((block) => (
          <FloorBlock
            key={block.name}
            floorName={block.name}
            areas={block.areas}
          />
        ))
      )}

      {unassignedAssets > 0 && (
        <>
          <h2>Without an area</h2>
          <div
            className="card"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>
              {unassignedAssets} asset{unassignedAssets === 1 ? "" : "s"}{" "}
              aren't assigned to any area.
            </span>
            <Link
              to="/assets"
              search={{ area: "", q: "", hidden: "0" }}
              className="btn"
            >
              View them →
            </Link>
          </div>
        </>
      )}
    </>
  );
}

function FloorBlock({
  floorName,
  areas,
}: {
  floorName: string;
  areas: AreaItem[];
}) {
  const totalVisible = areas.reduce((s, a) => s + a.visible_count, 0);
  const totalEnriched = areas.reduce((s, a) => s + a.enriched_count, 0);

  return (
    <>
      <h2>
        {floorName}
        <span
          style={{
            color: "var(--text-faint)",
            fontWeight: 400,
            fontSize: "12.5px",
            marginLeft: 8,
          }}
        >
          {areas.length} area{areas.length === 1 ? "" : "s"} · {totalVisible}{" "}
          asset{totalVisible === 1 ? "" : "s"} · {totalEnriched} enriched
        </span>
      </h2>
      <table className="rows">
        <thead>
          <tr>
            <th>Area</th>
            <th style={{ textAlign: "right" }}>Visible</th>
            <th style={{ textAlign: "right" }}>Enriched</th>
            <th style={{ textAlign: "right" }}>Hidden</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {areas.map((a) => (
            <tr key={a.id}>
              <td>
                <Link
                  to="/assets"
                  search={{ area: a.id, q: "", hidden: "0" }}
                >
                  {a.name}
                </Link>
                <span
                  className="mono"
                  style={{
                    color: "var(--text-faint)",
                    fontSize: "11.5px",
                    marginLeft: 6,
                  }}
                >
                  {a.id}
                </span>
              </td>
              <td
                style={{
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {a.visible_count}
              </td>
              <td
                style={{
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  color:
                    a.enriched_count > 0
                      ? "var(--success)"
                      : "var(--text-faint)",
                }}
              >
                {a.enriched_count}
              </td>
              <td
                style={{
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--text-faint)",
                }}
              >
                {a.hidden_count}
              </td>
              <td>
                <Link
                  to="/assets"
                  search={{ area: a.id, q: "", hidden: "0" }}
                  className="btn"
                >
                  Open →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
