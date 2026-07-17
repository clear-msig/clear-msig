export function needsWalletRuntime(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === "/welcome" ||
    pathname === "/send" ||
    pathname.startsWith("/send/") ||
    pathname === "/app" ||
    pathname.startsWith("/app/")
  );
}
