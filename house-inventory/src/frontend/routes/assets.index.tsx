/**
 * Asset list page — search, filter by area/hidden, tabular display.
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { assetListQuery } from "../query.ts";
import { Tag } from "../components/Tag.tsx";

export function AssetListPage() {
  const search = useSearch({ from: "/assets" });
  const navigate = useNavigate();

  const params = {
    q: search.q || undefined,
    area: search.area || undefined,
    hidden: search.hidden || "0",
  };
  const { data, isLoading } = useQuery(assetListQuery(params));

  // Local form state for the toolbar (committed on Apply)
  const [localQ, setLocalQ] = useState(search.q ?? "");
  const [localArea, setLocalArea] = useState(search.area ?? "");
  const [localHidden, setLocalHidden] = useState(search.hidden ?? "0");

  // We need areas for the filter dropdown — fetch them from the area list
  const { data: areaData } = useQuery({
    queryKey: ["areas-for-filter"],
    queryFn: async () => {
      const res = await fetch(
        `${(await import("../api.ts")).getBaseUrl()}/api/areas`,
      );
      if (!res.ok) return { areas: [] };
      const json = await res.json();
      return json as { areas: Array<{ id: string; name: string }> };
    },
    staleTime: 60_000,
  });

  const areas = areaData?.areas ?? [];

  const showHidden = params.hidden === "1";

  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    navigate({
      to: "/assets",
      search: {
        q: localQ || "",
        area: localArea || "",
        hidden: localHidden,
      },
    });
  };

  return (
    <>
      <h1>{showHidden ? "Hidden assets" : "Assets"}</h1>

      <form className="toolbar" onSubmit={applyFilters}>
        <input
          type="search"
          name="q"
          placeholder="Search name, manufacturer, model…"
          value={localQ}
          onChange={(e) => setLocalQ(e.target.value)}
        />
        <select
          name="area"
          value={localArea}
          onChange={(e) => setLocalArea(e.target.value)}
        >
          <option value="">All areas</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          name="hidden"
          value={localHidden}
          onChange={(e) => setLocalHidden(e.target.value)}
        >
          <option value="0">Visible</option>
          <option value="1">Hidden</option>
        </select>
        <button className="btn" type="submit">
          Apply
        </button>
        <div className="spacer" />
        <Link to="/assets/new" className="btn primary">
          + Add manual asset
        </Link>
      </form>

      {isLoading ? (
        <div className="card empty">Loading…</div>
      ) : !data || data.assets.length === 0 ? (
        <div className="card empty">No assets match.</div>
      ) : (
        <>
          <table className="rows">
            <thead>
              <tr>
                <th>Name</th>
                <th>Manufacturer</th>
                <th>Model</th>
                <th>Area</th>
                <th>Source</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.assets.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to="/assets/$id" params={{ id: r.id }}>
                      {r.name}
                    </Link>
                  </td>
                  <td className={r.manufacturer ? "" : "muted"}>
                    {r.manufacturer ?? "—"}
                  </td>
                  <td
                    className={r.model ? "mono" : "muted"}
                    style={{ fontSize: "12.5px" }}
                  >
                    {r.model ?? "—"}
                  </td>
                  <td className={r.area_id ? "" : "muted"}>
                    {r.area_name ?? r.area_id ?? "—"}
                  </td>
                  <td>
                    <Tag variant={r.source === "manual" ? "accent" : "default"}>
                      {r.source === "manual" ? "manual" : "home_assistant"}
                    </Tag>
                  </td>
                  <td>
                    <Link
                      to="/assets/$id"
                      params={{ id: r.id }}
                      className="btn"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pager">
            {data.count} result{data.count === 1 ? "" : "s"}
          </div>
        </>
      )}
    </>
  );
}
