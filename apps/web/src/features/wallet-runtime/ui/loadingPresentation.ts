// Visual selection only. Never use this list to authorize or redirect a route.
const PUBLIC_LOADING_PATHS = new Set([
  "/", "/connect", "/choose", "/personal", "/pro", "/agent", "/secure",
  "/p2pdefi", "/payments", "/privacy", "/security", "/changelog", "/agents",
]);

export function isPublicLoadingPresentation(pathname: string | null): boolean {
  if (!pathname || !pathname.startsWith("/") || pathname.startsWith("//") || /[?#]/.test(pathname)) return false;
  const path = pathname.replace(/\/+$/, "") || "/";
  if (PUBLIC_LOADING_PATHS.has(path)) return true;
  // Public agent profiles are exactly /agents/[name]/[slug]. Unknown paths
  // and all /app routes retain the theme-aware workspace skeleton.
  const segments = path.split("/");
  if (segments.length !== 4 || segments[1] !== "agents") return false;
  try {
    return segments.slice(2).every((segment) => {
      const value = decodeURIComponent(segment);
      return value.length > 0 && value !== "." && value !== ".." && !/[\/\\\x00-\x1f\x7f]/.test(value);
    });
  } catch {
    return false;
  }
}
