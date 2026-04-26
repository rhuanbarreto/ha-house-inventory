import { Outlet, Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FlashContext, useFlashState } from "../hooks/useFlash.ts";
import { FlashContainer } from "../components/Flash.tsx";
import { enrichInFlightQuery, enrichStatusQuery } from "../query.ts";
import { rel } from "../lib/relative-time.ts";

export function RootLayout() {
  const flash = useFlashState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const navLink = (to: string, label: string) => {
    // Check if current path matches this nav item
    const isActive = to === "/" ? pathname === "/" || pathname === "" : pathname.startsWith(to);
    return (
      <Link to={to} className={isActive ? "active" : undefined}>
        {label}
      </Link>
    );
  };

  return (
    <FlashContext.Provider value={flash}>
      <div className="app">
        <header className="top">
          <div className="brand">House Inventory</div>
          <nav>
            {navLink("/", "Areas")}
            {navLink("/assets", "Assets")}
            {navLink("/dashboard", "Dashboard")}
            {navLink("/llm", "LLM")}
          </nav>
          <EnrichmentIndicator />
        </header>
        <main className="page">
          <FlashContainer />
          <Outlet />
        </main>
      </div>
    </FlashContext.Provider>
  );
}

/** Global enrichment status chip — visible from every page. */
function EnrichmentIndicator() {
  const { data: inFlightData } = useQuery(enrichInFlightQuery);
  const { data: statusData } = useQuery(enrichStatusQuery);

  const inFlight = inFlightData?.inFlight ?? null;
  const eligible = statusData?.total_eligible ?? 0;

  // Batch is running — show spinner + count
  if (inFlight) {
    return (
      <Link to="/dashboard" className="enrich-indicator running">
        <span className="spinner-sm" aria-hidden="true" />
        Enriching {inFlight.max} · {rel(inFlight.startedAt)}
      </Link>
    );
  }

  // Nothing running, but assets are pending
  if (eligible > 0) {
    return (
      <Link to="/dashboard" className="enrich-indicator pending">
        {eligible} pending enrichment
      </Link>
    );
  }

  // Everything is enriched or no assets
  return null;
}
