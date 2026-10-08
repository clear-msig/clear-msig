// Visual selection only. Never use this list to authorize or redirect a route.
const PUBLIC_LOADING_PATHS = new Set([
  "/", "/connect", "/choose", "/personal", "/pro", "/agent", "/secure",
  "/p2pdefi", "/payments", "/privacy", "/security", "/changelog", "/agents",
]);

export function isPublicLoadingPresentation(pathname: string | null): boolean {
  if (!pathname || !pathname.startsWith("/") || pathname.startsWith("//")) return false;
  const path = pathname.replace(/\/+$/, "") || "/";
  if (PUBLIC_LOADING_PATHS.has(path)) return true;
  // Public agent profiles are exactly /agents/[name]/[slug]. Unknown paths
  // and all /app routes retain the theme-aware workspace skeleton.
  return /^\/agents\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(path);
}
