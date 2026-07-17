/**
 * ClearCMark. The official "C" mark.
 *
 * Renders the source SVG asset shipped with the brand kit. Two
 * theme-specific variants live as static files under /public:
 *   - clearmark-dark.svg  (white arcs + green accent for dark surfaces)
 *   - clearmark-light.svg (dark arcs + green accent for light surfaces)
 *
 * Both files are the same source artwork from the brand kit; the
 * light variant differs only in the feColorMatrix filter that maps
 * the C-shape rasterised glyph to #0c0c0c instead of #ffffff. The
 * green accent segment (#6caf1c) is rendered as a separate fill in
 * both variants, so the only difference between them is the colour
 * of the top and bottom arcs.
 *
 * Use `variant="on-dark"` on the dark landing canvas. Use
 * `variant="on-light"` on a light surface (eg /app pages in light
 * theme). Wider product rollout is gated on review.
 */

import Image from "next/image";

interface ClearCMarkProps {
  size?: number;
  className?: string;
  /**
   * Which surface the mark is sitting on. Picks the SVG variant
   * whose arcs contrast with the surface.
   */
  variant?: "on-dark" | "on-light";
  /** Alt text for accessibility. Defaults to "Clear". */
  alt?: string;
}

export function ClearCMark({
  size = 40,
  className,
  variant = "on-dark",
  alt = "Clear",
}: ClearCMarkProps) {
  const src =
    variant === "on-light" ? "/clearmark-light.svg" : "/clearmark-dark.svg";
  return (
    <Image
      src={src}
      width={size}
      height={size}
      alt={alt}
      className={className}
      style={{ display: "block" }}
      draggable={false}
      unoptimized
    />
  );
}
