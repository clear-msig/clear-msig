"use client";

// Quiet probe for an already-paired Ledger device. Uses
// `navigator.hid.getDevices()` (no permission prompt — only returns
// devices the user has previously authorised this site to talk to).
// Lets /connect promote the Ledger CTA from a footer link to a
// prominent banner when we can SEE a hardware wallet plugged in.
//
// What this is NOT: discovery via `requestDevice()` (that fires a
// browser modal). We only check for ALREADY-paired devices to avoid
// surprising users who haven't opted into hardware-wallet flow.

import { useEffect, useState } from "react";

/// Ledger Nano S/S+/X all share USB vendor ID 0x2c97. Filtering by
/// vendor avoids false positives from other HID devices the user
/// may have authorised.
const LEDGER_VENDOR_ID = 0x2c97;

interface HidDeviceLike {
  vendorId?: number;
  productName?: string;
}

interface NavigatorHidLike {
  getDevices: () => Promise<HidDeviceLike[]>;
  addEventListener?: (type: string, handler: () => void) => void;
  removeEventListener?: (type: string, handler: () => void) => void;
}

function getHid(): NavigatorHidLike | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as unknown as { hid?: NavigatorHidLike };
  return nav.hid ?? null;
}

export function useLedgerPresence(): {
  /// True when the browser has WebHID at all.
  supported: boolean;
  /// True when at least one previously-paired Ledger is currently
  /// connected. Re-evaluated on `connect` / `disconnect` events
  /// fired by the WebHID API itself.
  detected: boolean;
} {
  const [supported, setSupported] = useState(false);
  const [detected, setDetected] = useState(false);

  useEffect(() => {
    const hid = getHid();
    if (!hid) {
      setSupported(false);
      return;
    }
    setSupported(true);

    let cancelled = false;
    const refresh = async () => {
      try {
        const devices = await hid.getDevices();
        if (cancelled) return;
        setDetected(
          devices.some((d) => d.vendorId === LEDGER_VENDOR_ID),
        );
      } catch {
        if (!cancelled) setDetected(false);
      }
    };
    void refresh();

    // WebHID emits `connect` / `disconnect` when devices are
    // plugged in or removed. Listen so the banner flips
    // immediately without a page reload.
    hid.addEventListener?.("connect", refresh);
    hid.addEventListener?.("disconnect", refresh);

    return () => {
      cancelled = true;
      hid.removeEventListener?.("connect", refresh);
      hid.removeEventListener?.("disconnect", refresh);
    };
  }, []);

  return { supported, detected };
}
