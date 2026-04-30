// MemberAvatar — colored circle with two-letter initials.
//
// Until a real names/contacts layer exists, this is how members
// appear in lists, hero cards, and inline contexts. The look is
// deterministic on the Solana address (same wallet → same avatar
// everywhere) so users get a stable visual identity for each friend
// without us ever rendering a raw address.

import clsx from "clsx";
import { avatarGradient, avatarInitials } from "@/lib/retail/avatar";

interface MemberAvatarProps {
  address: string;
  /// `sm` (24px) for inline lists, `md` (32px) hero stacks, `lg`
  /// (48px) for prominent contexts (settings, member detail).
  size?: "sm" | "md" | "lg";
  /// Add a ring matching the surface so stacked avatars overlap
  /// cleanly. Pass `surface-raised` (white) when stacking on light
  /// cards, `canvas` for general bg.
  ringClass?: string;
}

const SIZE_CLASS: Record<NonNullable<MemberAvatarProps["size"]>, string> = {
  sm: "h-6 w-6 text-[9px]",
  md: "h-8 w-8 text-[11px]",
  lg: "h-12 w-12 text-base",
};

export function MemberAvatar({
  address,
  size = "sm",
  ringClass,
}: MemberAvatarProps) {
  const { from, to } = avatarGradient(address);
  const initials = avatarInitials(address);
  return (
    <span
      role="img"
      aria-label={`Member ${initials}`}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-mono font-semibold text-white",
        SIZE_CLASS[size],
        from,
        to,
        ringClass && `ring-2 ${ringClass}`,
      )}
    >
      {initials}
    </span>
  );
}

interface MemberAvatarStackProps {
  addresses: string[];
  size?: MemberAvatarProps["size"];
  /// Stop rendering after this many — anything past shows as `+N`.
  max?: number;
  /// Ring color for the overlapping border (defaults to white card).
  ringClass?: string;
}

export function MemberAvatarStack({
  addresses,
  size = "md",
  max = 4,
  ringClass = "ring-surface-raised",
}: MemberAvatarStackProps) {
  if (addresses.length === 0) return null;
  const shown = addresses.slice(0, max);
  const overflow = addresses.length - shown.length;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((addr) => (
        <MemberAvatar
          key={addr}
          address={addr}
          size={size}
          ringClass={ringClass}
        />
      ))}
      {overflow > 0 && (
        <span
          className={clsx(
            "inline-flex shrink-0 items-center justify-center rounded-full bg-surface-soft text-xs font-medium text-text-on-dark",
            SIZE_CLASS[size],
            ringClass && `ring-2 ${ringClass}`,
          )}
          aria-label={`${overflow} more members`}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
