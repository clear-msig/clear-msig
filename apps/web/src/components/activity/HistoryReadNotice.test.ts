import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { HistoryReadNotice } from "./HistoryReadNotice";
it("explains partial cached history and offers a serialized read-only refresh", () => {
  const html = renderToStaticMarkup(
    createElement(HistoryReadNotice, { refreshing: true, onRefresh() {} }),
  );
  expect(html).toContain("stale or incomplete");
  expect(html).toContain("does not mean there was no activity");
  expect(html).toContain("Totals and export are unavailable");
  expect(html).toMatch(/<button[^>]*disabled/);
});
