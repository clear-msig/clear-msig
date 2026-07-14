"use client";

import { QRCodeSVG } from "qrcode.react";

export function ReceiveQrCode({
  value,
  label,
  onNode,
}: {
  value: string;
  label: string;
  onNode: (node: SVGSVGElement | null) => void;
}) {
  return (
    <QRCodeSVG
      ref={onNode}
      value={value}
      size={184}
      level="M"
      marginSize={0}
      aria-label={label}
    />
  );
}
