/**
 * Dashboard page — stats, last sync, LLM status, enrichment progress.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dashboardQuery, enrichInFlightQuery, keys } from "../query.ts";
import { api } from "../api.ts";
import { useFlash } from "../hooks/useFlash.ts";
import { StatCard } from "../components/StatCard.tsx";
import { ProgressBar } from "../components/ProgressBar.tsx";
import { Tag } from "../components/Tag.tsx";
import { rel } from "../lib/relative-time.ts";
import { Link } from "@tanstack/react-router";

export function DashboardPage() {
  const qc = useQueryClient();
  const { flash } = useFlash();
  const { data, isLoading } = useQuery(dashboardQuery);
  const { data: inFlightData } = useQuery(enrichInFlightQuery);

  const inFlight = inFlightData?.inFlight ?? data?.inFlight ?? null;

  const syncMutation = useMutation({
    mutationFn: () => api.sync(),
    onSuccess: (r) => {
      if (r.error) {
        flash("err", `Sync failed — ${r.error}`);
      } else {
        flash(
          "ok",
          `Synced — +${r.devicesAdded} added, ${r.devicesUpdated} updated`,
        );
      }
      qc.invalidateQueries({ queryKey: keys.dashboard });
    },
    onError: (e) => flash("err", e.message),
  });

  const batchMutation = useMutation({
    mutationFn: (n: number) => api.enrichBatch(n),
    onSuccess: (_, n) => {
      flash(
        "ok",
        `Batch of ${n} started in the background — refreshing automatically`,
      );
      qc.invalidateQueries({ queryKey: keys.dashboard });
      qc.invalidateQueries({ queryKey: keys.enrichInFlight });
    },
    onError: (e) => flash("err", e.message),
  });

  if (isLoading || !data) {
    return <DashboardSkeleton />;
  }

  const { totals, lastSync, llmEntityId, enrichStatus, enriched } = data;
  const totalForBar = enrichStatus.total_eligible + enriched;
  const pct = totalForBar === 0 ? 0 : Math.round((enriched / totalForBar) * 100);
  const hasLlm = llmEntityId !== null;
  const batchDisabled =
    !hasLlm || enrichStatus.total_eligible === 0 || inFlight !== null;

  return (
    <>
      <h1>Dashboard</h1>

      <div className="grid-stats">
        <StatCard
          label="Visible assets"
          value={totals.visible}
          sub={`${totals.hidden} hidden · ${totals.manual} manual`}
        />
        <StatCard
          label="Enriched with links"
          value={totals.with_links}
          sub={`${totals.with_pdf} with manual PDF`}
        />
        <StatCard
          label="Areas"
          value={totals.areas}
          sub="from Home Assistant"
        />
        <StatCard
          label="Mode"
          value={data.mode}
          sub={
            <>
              data at <code>{data.dataDir}</code>
            </>
          }
          style={{ fontSize: 14 }}
        />
      </div>

      <h2>Last HA sync</h2>
      <div className="card">
        {lastSync ? (
          <dl className="facts">
            <dt>Started</dt>
            <dd>{rel(lastSync.started_at)}</dd>
            <dt>Duration</dt>
            <dd>
              {lastSync.finished_at
                ? `${Math.max(0, Date.parse(lastSync.finished_at) - Date.parse(lastSync.started_at))} ms`
                : "in progress"}
            </dd>
            <dt>Result</dt>
            <dd>
              {lastSync.error ? (
                <>
                  <Tag variant="danger">error</Tag> {lastSync.error}
                </>
              ) : (
                <>
                  <Tag variant="good">ok</Tag> +{lastSync.devices_added} added,{" "}
                  {lastSync.devices_updated} updated
                </>
              )}
            </dd>
          </dl>
        ) : (
          <div className="empty">no syncs yet</div>
        )}
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button
            className="btn"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      <h2>LLM for enrichment</h2>
      <div className="card">
        {llmEntityId ? (
          <>
            <p style={{ margin: 0 }}>
              Selected: <code>{llmEntityId}</code>
            </p>
            <p
              className="muted"
              style={{ margin: "6px 0 0", color: "var(--text-dim)", fontSize: "12.5px" }}
            >
              Change on the <Link to="/llm">LLM page</Link>.
            </p>
          </>
        ) : (
          <p style={{ margin: 0 }}>
            No LLM configured yet.{" "}
            <Link to="/llm">Pick or create one</Link> to enable enrichment.
          </p>
        )}
      </div>

      <h2>Enrichment progress</h2>
      <div className="card">
        {inFlight && (
          <div
            className="flash info"
            style={{
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span className="spinner" aria-hidden="true" />
            Running a batch of {inFlight.max} · started{" "}
            {rel(inFlight.startedAt)}. Auto-refreshing.
          </div>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.02em",
              }}
            >
              {enriched} / {totalForBar}{" "}
              <span
                style={{
                  color: "var(--text-faint)",
                  fontWeight: 400,
                  fontSize: 14,
                }}
              >
                enriched
              </span>
            </div>
            <div
              className="muted"
              style={{ color: "var(--text-dim)", fontSize: "12.5px", marginTop: 4 }}
            >
              {enrichStatus.never_attempted} never attempted ·{" "}
              {enrichStatus.stale} stale (&gt;30d) ·{" "}
              {enrichStatus.failed_in_backoff} failed (in backoff)
            </div>
            {enrichStatus.last_success_at && (
              <div
                className="muted"
                style={{
                  color: "var(--text-faint)",
                  fontSize: "12.5px",
                  marginTop: 4,
                }}
              >
                Last success: {rel(enrichStatus.last_success_at)}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="btn"
              disabled={batchDisabled || batchMutation.isPending}
              onClick={() => batchMutation.mutate(3)}
            >
              Enrich 3
            </button>
            <button
              className="btn primary"
              disabled={batchDisabled || batchMutation.isPending}
              onClick={() => batchMutation.mutate(10)}
            >
              Enrich 10
            </button>
          </div>
        </div>
        <ProgressBar
          value={enriched}
          max={totalForBar}
          label="Background tick runs every 10 min · 3 assets at a time · DDG + AI Task throttled."
        />
      </div>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <h1>Dashboard</h1>
      <div className="grid-stats">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="stat">
            <div className="skeleton" style={{ width: 80, height: 12 }} />
            <div
              className="skeleton"
              style={{ width: 48, height: 28, marginTop: 8 }}
            />
          </div>
        ))}
      </div>
    </>
  );
}
