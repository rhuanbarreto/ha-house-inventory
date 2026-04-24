/**
 * New manual asset form.
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, getBaseUrl } from "../api.ts";
import { useFlash } from "../hooks/useFlash.ts";

export function AssetNewPage() {
  const { flash } = useFlash();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [category, setCategory] = useState("");
  const [areaId, setAreaId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [warrantyUntil, setWarrantyUntil] = useState("");
  const [notes, setNotes] = useState("");

  // Fetch areas for the dropdown
  const { data: areaData } = useQuery({
    queryKey: ["areas-for-new"],
    queryFn: async () => {
      const res = await fetch(`${getBaseUrl()}/api/areas`);
      if (!res.ok) return { areas: [] };
      const json = await res.json();
      return json as { areas: Array<{ id: string; name: string }> };
    },
    staleTime: 60_000,
  });
  const areas = areaData?.areas ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      api.createAsset({
        name: name.trim(),
        manufacturer: manufacturer.trim() || null,
        model: model.trim() || null,
        category: category.trim() || null,
        area_id: areaId || null,
        purchase_date: purchaseDate || null,
        purchase_price: purchasePrice.trim() || null,
        warranty_until: warrantyUntil || null,
        notes: notes.trim() || null,
      }),
    onSuccess: (r) => {
      flash("ok", `Created ${name.trim()}`);
      navigate({ to: "/assets/$id", params: { id: r.id } });
    },
    onError: (e) => flash("err", e.message),
  });

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <Link to="/assets" search={{ q: "", area: "", hidden: "0" }} style={{ color: "var(--text-dim)" }}>
          ← Assets
        </Link>
      </div>
      <h1>Add manual asset</h1>
      <p
        className="muted"
        style={{ color: "var(--text-dim)", marginTop: -8 }}
      >
        For things that aren't on Home Assistant — furniture, dumb appliances,
        tools.
      </p>

      <form
        className="card form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) {
            flash("err", "Name is required");
            return;
          }
          mutation.mutate();
        }}
      >
        <label>
          <span>Name *</span>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Living room sofa, Bosch washing machine"
          />
        </label>
        <label>
          <span>Manufacturer</span>
          <input
            type="text"
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
            placeholder="Bosch"
          />
        </label>
        <label>
          <span>Model</span>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="WAW28460GB"
          />
        </label>
        <label>
          <span>Category</span>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="appliance, furniture, tool, …"
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
          <input
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
          />
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
          />
        </label>
        <div className="actions">
          <button
            className="btn primary"
            type="submit"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Creating…" : "Create"}
          </button>
          <Link to="/assets" search={{ q: "", area: "", hidden: "0" }} className="btn">
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
