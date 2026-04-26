/**
 * Asset detail page — facts, edit form, links, files, action buttons.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { assetDetailQuery, areasQuery, keys } from "../query.ts";
import { api, getBaseUrl } from "../api.ts";
import { useFlash } from "../hooks/useFlash.ts";
import { Tag } from "../components/Tag.tsx";
import { FactList } from "../components/FactList.tsx";
import { rel, formatBytes } from "../lib/relative-time.ts";

const KIND_LABELS: Record<string, string> = {
  product: "Product",
  support: "Support",
  manual: "Manual",
  firmware: "Firmware",
  parts: "Parts",
  datasheet: "Datasheet",
  other: "Other",
};

export function AssetDetailPage() {
  const { id } = useParams({ from: "/assets/$id" });
  const { data, isLoading } = useQuery(assetDetailQuery(id));

  if (isLoading || !data) return <div className="card empty">Loading…</div>;

  const { asset, links, files } = data;

  return (
    <>
      <div className="breadcrumb-bar">
        <Link to="/assets" search={{ q: "", area: "", hidden: "0" }} className="link-dim">
          ← Assets
        </Link>
      </div>

      <div className="detail-header">
        <div>
          <h1 className="m-0">{asset.name}</h1>
          <div className="muted caption">
            {asset.manufacturer ?? "unknown"} ·{" "}
            <span className="mono">{asset.model ?? "no model"}</span>
            {asset.hidden ? (
              <>
                {" "}
                · <Tag variant="warn">hidden ({asset.hidden_reason ?? "manual"})</Tag>
              </>
            ) : null}
          </div>
        </div>
        <ActionButtons asset={asset} />
      </div>

      <div className="detail-columns">
        <section>
          <h2>Facts</h2>
          <div className="card">
            <FactList
              facts={[
                {
                  label: "Source",
                  value: (
                    <Tag variant={asset.source === "manual" ? "accent" : "default"}>
                      {asset.source}
                    </Tag>
                  ),
                },
                ...(asset.ha_device_id
                  ? [
                      {
                        label: "HA device",
                        value: <span className="mono-sm">{asset.ha_device_id}</span>,
                      },
                    ]
                  : []),
                { label: "Area", value: asset.area_id ?? "—" },
                { label: "Manufacturer", value: asset.manufacturer ?? "—" },
                {
                  label: "Model",
                  value: <span className="mono-sm">{asset.model ?? "—"}</span>,
                },
                {
                  label: "Model ID",
                  value: <span className="mono-sm">{asset.model_id ?? "—"}</span>,
                },
                { label: "SW", value: asset.sw_version ?? "—" },
                { label: "HW", value: asset.hw_version ?? "—" },
                { label: "Serial", value: asset.serial_number ?? "—" },
                { label: "Last seen", value: rel(asset.last_seen_at) },
                {
                  label: "Enriched",
                  value: asset.last_enrichment_success_at ? (
                    <>
                      <Tag variant="good">ok</Tag> {rel(asset.last_enrichment_success_at)}
                    </>
                  ) : asset.last_enrichment_error ? (
                    <>
                      <Tag variant="danger">error</Tag> {asset.last_enrichment_error}
                    </>
                  ) : (
                    <span className="muted text-faint">never</span>
                  ),
                },
              ]}
            />
          </div>

          <h2>Inventory fields</h2>
          <EditForm asset={asset} />
        </section>

        <section>
          <h2>Links</h2>
          <div className="card">
            {links.length === 0 ? (
              <div className="empty compact">No links yet. Click Enrich to generate.</div>
            ) : (
              <div className="links-list">
                {links.map((l) => (
                  <div key={l.id}>
                    <span className="kind">{KIND_LABELS[l.kind] ?? l.kind}</span>
                    <a href={l.url} target="_blank" rel="noopener noreferrer">
                      {l.url}
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>

          <h2>Files</h2>
          <div className="card">
            {files.length === 0 ? (
              <div className="empty compact">No files downloaded yet.</div>
            ) : (
              <table className="rows flat">
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>Size</th>
                    <th>Downloaded</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <Tag variant="accent">{f.kind}</Tag>
                      </td>
                      <td>{formatBytes(f.bytes)}</td>
                      <td className="muted">{rel(f.downloaded_at)}</td>
                      <td>
                        <a
                          className="btn"
                          href={`${getBaseUrl()}/api/files/${f.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open PDF
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

// -- Action buttons -----------------------------------------------------------

function ActionButtons({
  asset,
}: {
  asset: {
    id: string;
    source: string;
    hidden: number;
    manufacturer: string | null;
    model: string | null;
  };
}) {
  const { flash } = useFlash();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const enrichMut = useMutation({
    mutationFn: () => api.enrichAsset(asset.id),
    onSuccess: (r) => {
      const linkCount = Object.values(r.links).filter((v) => typeof v === "string").length;
      flash(
        "ok",
        `Enriched (${r.cache}) — ${linkCount} links${r.manual_downloaded ? ", manual PDF saved" : ""}`,
      );
      qc.invalidateQueries({ queryKey: keys.assets.detail(asset.id) });
    },
    onError: (e) => flash("err", e.message),
  });

  const toggleMut = useMutation({
    mutationFn: () => api.toggleHidden(asset.id),
    onSuccess: (r) => {
      flash("ok", r.hidden ? "Hidden" : "Unhidden");
      qc.invalidateQueries({ queryKey: keys.assets.detail(asset.id) });
      qc.invalidateQueries({ queryKey: keys.assets.all });
    },
    onError: (e) => flash("err", e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.deleteAsset(asset.id),
    onSuccess: () => {
      flash("ok", "Deleted");
      qc.invalidateQueries({ queryKey: keys.assets.all });
      navigate({ to: "/assets", search: { q: "", area: "", hidden: "0" } });
    },
    onError: (e) => flash("err", e.message),
  });

  return (
    <div className="row-actions">
      <button
        className="btn primary"
        onClick={() => enrichMut.mutate()}
        disabled={enrichMut.isPending || !asset.manufacturer || !asset.model}
        title={!asset.manufacturer || !asset.model ? "No manufacturer/model to enrich" : undefined}
      >
        {enrichMut.isPending ? "Enriching…" : "⚡ Enrich"}
      </button>
      <button className="btn" onClick={() => toggleMut.mutate()} disabled={toggleMut.isPending}>
        {asset.hidden ? "Unhide" : "Hide"}
      </button>
      {asset.source === "manual" && (
        <button
          className="btn danger"
          onClick={() => {
            if (confirm("Delete this manual asset?")) deleteMut.mutate();
          }}
          disabled={deleteMut.isPending}
        >
          Delete
        </button>
      )}
    </div>
  );
}

// -- Edit form ----------------------------------------------------------------

function EditForm({
  asset,
}: {
  asset: {
    id: string;
    category: string | null;
    area_id: string | null;
    purchase_date: string | null;
    purchase_price_cents: number | null;
    warranty_until: string | null;
    notes: string | null;
  };
}) {
  const { flash } = useFlash();
  const qc = useQueryClient();

  const [category, setCategory] = useState(asset.category ?? "");
  const [areaId, setAreaId] = useState(asset.area_id ?? "");
  const [purchaseDate, setPurchaseDate] = useState(asset.purchase_date ?? "");
  const [purchasePrice, setPurchasePrice] = useState(
    asset.purchase_price_cents != null ? (asset.purchase_price_cents / 100).toFixed(2) : "",
  );
  const [warrantyUntil, setWarrantyUntil] = useState(asset.warranty_until ?? "");
  const [notes, setNotes] = useState(asset.notes ?? "");

  // Fetch areas for the dropdown via the shared query definition
  const { data: areaData } = useQuery(areasQuery);
  const areas = areaData?.areas ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      api.updateAsset(asset.id, {
        category: category || null,
        area_id: areaId || null,
        purchase_date: purchaseDate || null,
        purchase_price: purchasePrice || null,
        warranty_until: warrantyUntil || null,
        notes: notes || null,
      }),
    onSuccess: () => {
      flash("ok", "Saved");
      qc.invalidateQueries({ queryKey: keys.assets.detail(asset.id) });
    },
    onError: (e) => flash("err", e.message),
  });

  return (
    <form
      className="card form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <label>
        <span>Category</span>
        <input
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. appliance, electronics"
        />
      </label>
      <label>
        <span>Area</span>
        <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          <option value="">—</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Purchase date</span>
        <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
      </label>
      <label>
        <span>Purchase price</span>
        <input
          type="text"
          value={purchasePrice}
          onChange={(e) => setPurchasePrice(e.target.value)}
          placeholder="e.g. 499.00"
        />
      </label>
      <label>
        <span>Warranty until</span>
        <input
          type="date"
          value={warrantyUntil}
          onChange={(e) => setWarrantyUntil(e.target.value)}
        />
      </label>
      <label>
        <span>Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything else worth remembering about this asset"
        />
      </label>
      <div className="actions">
        <button className="btn primary" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
