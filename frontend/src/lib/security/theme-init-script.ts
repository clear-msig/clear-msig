// Inline boot script - runs SYNCHRONOUSLY on the first paint to set
// the right `data-theme` attribute on <html> before React hydrates.
// Without this, users with a stored "light" preference would see a
// dark flash for 1-2 frames while React boots, and the SSR'd dark
// markup would mismatch the client's "light" attribute → React 19
// hydration error.
//
// Embedded as a string in app/layout.tsx via a <Script
// strategy="beforeInteractive">. Keep it tiny - it ships in every
// HTML response and runs before anything else.
//
// The init script reads localStorage + matchMedia and writes the
// matching theme before React hydrates.

export const STORAGE_KEY = "clear.theme.v1";
export const FORCE_DARK_PATHS: string[] = [];

export const THEME_INIT_SCRIPT = `(function(){try{
var v=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
var t=(v==="light"||v==="dark")?v:(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");
document.documentElement.setAttribute("data-theme",t);
}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();`;
