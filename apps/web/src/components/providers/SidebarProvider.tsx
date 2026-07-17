"use client";

// SidebarProvider - shared state for the workspace sidebar.
//
// Two pieces of state live here:
//
//   1. `expanded` - desktop only. When true, the sidebar shows full
//      content (16rem). When false, it collapses to a rail (4rem)
//      that shows icons. Persisted to localStorage so user preference
//      survives reloads.
//
//   2. `mobileOpen` - mobile only. The drawer overlay's open state.
//      Not persisted; resets each session.
//
// HeaderBar is rendered both inside the workspace shell (where this
// provider exists) AND on the public landing page (where it doesn't).
// `useSidebar()` returns null when no provider is mounted, so HeaderBar
// can safely call it on every page without conditional imports.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

type SidebarContextValue = {
  expanded: boolean;
  mobileOpen: boolean;
  toggleExpanded: () => void;
  openMobile: () => void;
  closeMobile: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

const STORAGE_KEY = "clear.sidebar.expanded.v1";

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Hydrate from localStorage on first client render. SSR keeps the
  // default expanded state so first paint matches the most-common
  // case; one-frame correction is fine for a navigation chrome.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "0") setExpanded(false);
    } catch {
      /* private mode / sandboxed iframe - fall back to default */
    }
  }, []);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  const openMobile = useCallback(() => setMobileOpen(true), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <SidebarContext.Provider
      value={{ expanded, mobileOpen, toggleExpanded, openMobile, closeMobile }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

/// Returns null when no SidebarProvider is mounted. Callers that may
/// run outside the workspace shell (HeaderBar) must handle the null
/// case; callers that always run inside the shell (WorkspaceSidebar,
/// WorkspaceShell) can safely assume non-null.
export function useSidebar(): SidebarContextValue | null {
  return useContext(SidebarContext);
}
