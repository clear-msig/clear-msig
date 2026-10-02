import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import LandingPage from "./LandingPage";
import { LandingNav } from "@/components/landing/LandingChrome";
import { ProductChooser } from "@/components/product/ProductChooser";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), "src", path), "utf8");
describe("public navigation and brand surface", () => {
  it("resolves every shared homepage fragment to exactly one rendered target", () => {
    const home = renderToStaticMarkup(createElement(LandingPage));
    const nav = renderToStaticMarkup(createElement(LandingNav));
    const links = [...nav.matchAll(/href="\/#([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(["how-it-works", "products"]);
    for (const id of links)
      expect(home.match(new RegExp(`id="${id}"`, "g"))).toHaveLength(1);
    expect(nav).not.toContain("/#why");
  });
  it("keeps product selection destinations and uses the same public navigation", () => {
    const html = renderToStaticMarkup(createElement(ProductChooser));
    expect(html).toContain('href="/#how-it-works"');
    expect(html).toContain('href="/connect"');
    expect(html.match(/<li>/g)).toHaveLength(4);
    expect(html).toContain("public-brand-surface");
    expect(html).toContain("/clearmark-dark.svg");
  });
  it("scopes original dark tokens locally while retaining app light-theme support", () => {
    const css = read("app/globals.css");
    expect(css).toContain(":root,\n.public-brand-surface {");
    expect(css).toContain('[data-theme="light"] {');
    for (const path of [
      "app/security/page.tsx",
      "app/privacy/page.tsx",
      "app/connect/ConnectClient.tsx",
      "components/product/ProductSurfaceLanding.tsx",
    ])
      expect(read(path)).toContain('className="public-brand-surface ');
    expect(read("app/connect/ConnectClient.tsx")).not.toContain(
      "Use your email, your phone",
    );
    expect(read("app/connect/ConnectClient.tsx")).toContain(
      "sign-in methods available in the next step",
    );
  });
});
