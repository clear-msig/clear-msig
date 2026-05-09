// Brand mark - two interlocking circles in accent green.
//
// Replaces the generic wallet-icon-in-pill we shipped for the first
// month. The wallet emoji is what every fintech default screen uses
// before they hire a designer; this mark says "shared" without
// needing words. Two circles, slightly offset, with the intersection
// rendered as a subtle highlight. Sized via the `size` prop; defaults
// to 12px to fit inside the brand pill (h-5 w-5 wrapper).
//
// Usage:
//   <BrandMark size={12} />        // pill-sized
//   <BrandMark size={16} />        // sidebar / drawer
//   <BrandMark size={28} />        // marketing surfaces
//
// Color comes from the parent's `text-` class via `currentColor`.

interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 12, className }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Clear"
    >
      {/* Left circle */}
      <circle
        cx="9"
        cy="12"
        r="5.25"
        stroke="currentColor"
        strokeWidth="2.4"
        fill="none"
      />
      {/* Right circle */}
      <circle
        cx="15"
        cy="12"
        r="5.25"
        stroke="currentColor"
        strokeWidth="2.4"
        fill="none"
      />
      {/* Intersection - solid lens for emphasis */}
      <path
        d="M 12 7.04 A 5.25 5.25 0 0 1 12 16.96 A 5.25 5.25 0 0 1 12 7.04 Z"
        fill="currentColor"
        opacity="0.4"
      />
    </svg>
  );
}
