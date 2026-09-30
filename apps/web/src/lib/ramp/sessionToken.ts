"use client";

// Keep the Dynamic SDK in its existing wallet runtime chunk. Read the accessor
// on each request so login, logout, account changes, and refreshes take effect.
let tokenGetter: () => string | undefined = () => undefined;

export function configureRampTokenGetter(getter: () => string | undefined): void {
  tokenGetter = getter;
}

export function getRampAuthToken(): string | undefined {
  return tokenGetter();
}
