import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
import ConnectPage from "./ConnectClient";
it("renders the sign-in explanation visibly before client motion or authentication loads", () => {
  const html = renderToStaticMarkup(createElement(ConnectPage));
  expect(html).toContain("Sign in");
  expect(html).toContain("Money you decide");
  expect(html).not.toContain("opacity:0");
});
