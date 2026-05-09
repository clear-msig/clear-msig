// Browser favicon - generated at build time via Next.js' ImageResponse
// metadata convention. Solid brand-green tile with a stylised glyph;
// keeps the bundle lighter than shipping a PNG and stays crisp at any
// rasterised size.

import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#16a34a",
          color: "white",
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: -1,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        ⌘
      </div>
    ),
    size
  );
}
