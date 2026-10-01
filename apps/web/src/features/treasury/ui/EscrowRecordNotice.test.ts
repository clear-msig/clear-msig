import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { EscrowRecordNotice } from "./EscrowRecordNotice";
it("separates editable project records from custody and execution evidence", () => {
  const html = renderToStaticMarkup(createElement(EscrowRecordNotice));
  expect(html).toContain("does not deposit, lock, release, or return funds");
  expect(html).toContain("not verified on-chain balances");
  expect(html).toContain("separate signed proposal and successful execution");
});
