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
        flash("ok", `Synced — +${r.devicesAdded} added, ${r.devicesUpdated} updated`);
      }
      qc.invalidateQueries({ queryKey: keys.dashboard });
    },
    onError: (e) => flash("err", e.message),
  });

  const batchMutation = useMutation({
    mutationFn: (n: number) => api.enrichBatch(n),
    onSuccess: (_, n) => {
      flash("ok", `Batch of ${n} started in the background — refreshing automatically`);
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
  const hasLlm = llmEntityId !== null;
  const batchDisabled = !hasLlm || enrichStatus.total_eligible === 0 || inFlight !== null;

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
        <StatCard label="Areas" value={totals.areas} sub="from Home Assistant" />
        <StatCard
          label="Mode"
          value={data.mode}
          sub={
            <>
              data at <code>{data.dataDir}</code>
            </>
          }
          small
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
        <div className="card-actions">
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
            <p className="m-0">
              Selected: <code>{llmEntityId}</code>
            </p>
            <p className="muted hint">
              Change on the <Link to="/llm">LLM page</Link>.
            </p>
          </>
        ) : (
          <p className="m-0">
            No LLM configured yet. <Link to="/llm">Pick or create one</Link> to enable enrichment.
          </p>
        )}
      </div>

      <h2>Enrichment progress</h2>
      <div className="card">
        {inFlight && (
          <div className="flash info inflight">
            <span className="spinner" aria-hidden="true" />
            Running a batch of {inFlight.max} · started {rel(inFlight.startedAt)}. Auto-refreshing.
          </div>
        )}
        <div className="enrich-summary">
          <div>
            <div className="enrich-headline">
              {enriched} / {totalForBar} <span className="enrich-headline-label">enriched</span>
            </div>
            <div className="muted caption">
              {enrichStatus.never_attempted} never attempted · {enrichStatus.stale} stale (&gt;30d)
              · {enrichStatus.failed_in_backoff} failed (in backoff)
            </div>
            {enrichStatus.last_success_at && (
              <div className="muted caption-faint">
                Last success: {rel(enrichStatus.last_success_at)}
              </div>
            )}
          </div>
          <div className="btn-group">
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
            <div className="skeleton skeleton-label" />
            <div className="skeleton skeleton-value" />
          </div>
        ))}
      </div>
    </>
  );
}
