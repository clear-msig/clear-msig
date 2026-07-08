# ClearSig App Consistency Bar

ClearSig should feel calm, direct, and secure across every user action. When a
screen asks a user to move money, approve authority, connect an agent, or change
security settings, it should use the same interaction language as the rest of
the app.

## UI Primitives

- Use `Button` for user commands instead of hand-rolled button classes.
- Use `FormField`, `TextInput`, `TextArea`, and `NativeSelect` for text entry
  and native option picking.
- Use existing badge/chip primitives for compact state, not one-off pills.
- Keep cards for repeated items, modals, and framed tools. Page sections should
  stay unframed or use full-width bands.

## Typography

- Use the system sans stack through `font-sans` and `font-display`.
- Keep letter spacing at `0` unless a component has a specific established
  pattern, such as tiny uppercase page eyebrows.
- Use `font-mono` only for addresses, hashes, amounts, signatures, timestamps,
  and technical identifiers.
- Avoid hero-size type inside cards, sidebars, tool panels, and dense forms.

## Forms

- Labels use small, soft text above the control.
- Inputs, textareas, and selects use the same height, radius, border, focus ring,
  disabled state, and placeholder color.
- Money/security flows should ask in the real decision order. For example:
  choose period before amount, choose asset before amount, choose signer before
  approval.
- Placeholder text should be examples, not instructions that disappear after
  typing.

## Copy And Flow

- Prefer one primary action per step.
- Secondary actions should be quiet and explainable by their label.
- Security copy should name what is being protected without sounding scary by
  default.
- Public Agent and marketplace copy should separate paper, testnet, and live
  evidence every time performance is shown.
- Visible text must not contain mojibake or corrupted separators.

## Security UX

- Never hide approval thresholds, expiry, signer identity, destination, amount,
  asset, or chain in a signing flow.
- When the app blocks a user action, say what rule stopped it and what can be
  changed safely.
- When data is local-only or pre-alpha, say so in the same calm tone everywhere.
