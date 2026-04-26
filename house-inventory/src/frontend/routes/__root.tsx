import { Outlet, Link, useRouterState } from "@tanstack/react-router";
import { FlashContext, useFlashState } from "../hooks/useFlash.ts";
import { FlashContainer } from "../components/Flash.tsx";

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
        </header>
        <main className="page">
          <FlashContainer />
          <Outlet />
        </main>
      </div>
    </FlashContext.Provider>
  );
}
