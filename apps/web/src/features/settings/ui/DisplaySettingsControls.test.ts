import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DisplaySettingsControls } from "./DisplaySettingsControls";
it("separates illustrative display currency from unchanged policy units and exposes selected preferences", () => {
  const html = renderToStaticMarkup(createElement(DisplaySettingsControls));
  expect(html).toContain("original asset and units");
  expect(html).toContain("not executable");
  expect(html).not.toContain("thresholds stay set in USD");
  expect(html).not.toContain("workstream");
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
  expect(html.match(/aria-pressed=/g)).toHaveLength(9);
});
