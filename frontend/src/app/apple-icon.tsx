// iOS add-to-home-screen icon. Same glyph as the favicon but at the
// 180×180 size iOS expects; rounded corners are added by Safari at
// install time, so we draw a flat tile.

import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 120,
          fontWeight: 800,
          letterSpacing: -4,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        ⌘
      </div>
    ),
    size
  );
}
