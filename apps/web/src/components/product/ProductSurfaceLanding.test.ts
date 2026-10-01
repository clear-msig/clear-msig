import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ProductSurfaceLanding } from "./ProductSurfaceLanding";
import { productSurfaceById } from "@/lib/productSurfaces";
it("discloses agent execution gating in both selection copy and product presentation", () => {
  expect(productSurfaceById("agent").summary).toContain(
    "External trading execution remains gated",
  );
  const html = renderToStaticMarkup(
    createElement(ProductSurfaceLanding, { id: "agent" }),
  );
  expect(html).toContain("External trading is blocked");
  expect(html).toContain("Test funds only");
  expect(html).toContain("Illustrative preview");
  expect(html).not.toContain("Live desk");
  expect(html).not.toContain("Watch trades");
});
