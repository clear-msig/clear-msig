import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormField, NativeSelect, TextArea, TextInput } from "../FormField";

describe("shared field accessibility", () => {
  it("exposes invalid input state without relying on border color", () => {
    const markup = renderToStaticMarkup(createElement(TextInput, { invalid: true, "aria-label": "Amount" }));
    expect(markup).toContain('aria-invalid="true"');
  });

  it.each([TextInput, TextArea, NativeSelect])("links the visible label and error to shared controls %#", (Control) => {
    const child = Control === NativeSelect
      ? createElement(NativeSelect, null, createElement("option", { value: "SOL" }, "SOL"))
      : Control === TextArea ? createElement(TextArea) : createElement(TextInput);
    const markup = renderToStaticMarkup(createElement(FormField, { label: "Amount", error: "Enter a positive amount", as: "div" } as Parameters<typeof FormField>[0], child));
    const labelId = markup.match(/aria-labelledby="([^"]+)"/)?.[1];
    const errorId = markup.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(labelId).toBeTruthy();
    expect(errorId).toBeTruthy();
    expect(markup).toContain(`id="${labelId}"`);
    expect(markup).toContain(`id="${errorId}"`);
    expect(markup).toContain('aria-invalid="true"');
  });

  it("preserves a caller's accessible name and additional description", () => {
    const child = createElement(TextInput, { "aria-label": "Amount in SOL", "aria-describedby": "balance-help" });
    const markup = renderToStaticMarkup(createElement(FormField, { label: "Amount", hint: "Up to 9 decimals" } as Parameters<typeof FormField>[0], child));
    expect(markup).toContain('aria-label="Amount in SOL"');
    expect(markup).not.toContain("aria-labelledby");
    expect(markup).toMatch(/aria-describedby="balance-help [^"]+-description"/);
    expect(markup).not.toContain("aria-invalid");
  });
});
