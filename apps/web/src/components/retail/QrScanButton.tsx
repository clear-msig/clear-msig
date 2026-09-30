"use client";

// QR scanner button - opens the device camera, detects a QR code,
// returns the decoded string to the parent. Uses the native
// `BarcodeDetector` API + `navigator.mediaDevices.getUserMedia`.
// Feature-detect support rather than relying on browser versions. Browsers
// without BarcodeDetector or camera access fall back to manual paste.
//
// Why this matters for a multisig: cross-device flows. An admin
// composes a proposal on desktop, hands their phone to a collaborator
// to sign in their own wallet, and a QR is the friction-free way to
// transfer the recipient address between the two contexts.

import { useCallback, useEffect, useRef, useState } from "react";
import { QrCode, X, Camera, Loader2 } from "lucide-react";
import { motion, AnimatePresence, useIsPresent } from "framer-motion";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import { startQrScannerSession, type QrDetector } from "./qrScannerSession";

interface QrScanButtonProps {
  /// Called once with the decoded QR string. Modal auto-closes.
  /// Caller decides whether to validate / route.
  onResult: (value: string) => void;
  /// Optional title shown above the camera preview.
  title?: string;
  /// Optional className to style the trigger button itself.
  className?: string;
  /// Aria-label for the trigger; defaults to "Scan QR code".
  ariaLabel?: string;
}

// Minimal shape of the BarcodeDetector global. Typed locally to
// avoid pulling DOM lib types we don't otherwise need.
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): QrDetector;
}

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as {
    BarcodeDetector?: BarcodeDetectorCtor;
  }).BarcodeDetector;
  return ctor ?? null;
}

export function QrScanButton({
  onResult,
  title = "Scan a QR code",
  className,
  ariaLabel = "Scan QR code",
}: QrScanButtonProps) {
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);

  // Run the support probe on mount so SSR doesn't try to read
  // `window.BarcodeDetector`. Hides the button entirely if absent
  // - we don't want to dangle an affordance that does nothing.
  useEffect(() => {
    setSupported(!!getBarcodeDetectorCtor() && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  if (!supported) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={ariaLabel}
        title={ariaLabel}
        className={
          className ??
          "inline-flex h-tap w-tap shrink-0 items-center justify-center rounded-full border border-border-soft bg-surface-raised text-text-soft " +
            "transition-[border-color,color,transform] duration-base ease-out-soft " +
            "hover:-translate-y-0.5 hover:text-accent " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <QrCode className="h-4 w-4" aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <ScannerModal
            title={title}
            onClose={() => setOpen(false)}
            onResult={(v) => {
              setOpen(false);
              onResult(v);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

interface ScannerModalProps {
  title: string;
  onClose: () => void;
  onResult: (value: string) => void;
}

function ScannerModal({ title, onClose, onResult }: ScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef<() => void>(() => {});
  const onResultRef = useRef(onResult);
  const isPresent = useIsPresent();
  const [status, setStatus] = useState<"requesting" | "scanning" | "denied" | "error">(
    "requesting",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useBodyScrollLock(isPresent);
  useFocusTrap(dialogRef, isPresent);

  // Parents often pass inline callbacks. Updating a recipient or any unrelated
  // form field must not tear down and reacquire an already-running camera.
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const close = useCallback(() => {
    stopRef.current();
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isPresent) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, isPresent]);

  useEffect(() => {
    const video = videoRef.current;
    if (!isPresent || !video) return;
    setStatus("requesting");
    setErrorMsg(null);
    const stop = startQrScannerSession({
      video,
      createDetector: () => {
        const Ctor = getBarcodeDetectorCtor();
        if (!Ctor) throw new Error("Your browser doesn't support QR scanning.");
        return new Ctor({ formats: ["qr_code"] });
      },
      onScanning: () => setStatus("scanning"),
      onResult: (value) => onResultRef.current(value),
      onError: (error) => {
        const e = error as { name?: string; message?: string };
        if (e?.name === "NotAllowedError") {
          setStatus("denied");
          setErrorMsg("Camera permission was blocked.");
        } else {
          setStatus("error");
          setErrorMsg(e?.message ?? "Couldn't open the camera.");
        }
      },
    });
    stopRef.current = stop;
    return stop;
  }, [isPresent]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[200] bg-text-strong/40 backdrop-blur-sm"
        onClick={close}
        aria-hidden="true"
      />
      <motion.div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="fixed left-1/2 top-1/2 z-[201] w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-card border border-border-soft bg-surface-raised shadow-card-raised"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border-soft px-4 py-3">
          <p className="font-display text-sm font-medium text-text-strong">
            {title}
          </p>
          <button
            type="button"
            onClick={close}
            data-dialog-initial-focus
            aria-label="Close scanner"
            className="inline-flex h-11 w-11 items-center justify-center rounded-soft text-text-soft transition-colors hover:bg-canvas hover:text-text-strong"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="relative aspect-square w-full bg-text-strong">
          <video
            ref={videoRef}
            aria-label="Camera preview"
            muted
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Reticle - pure decoration, helps the user aim. */}
          {status === "scanning" && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-2/3 w-2/3 rounded-card border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
          )}
          {(status === "requesting" ||
            status === "denied" ||
            status === "error") && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white">
              {status === "requesting" && (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  <p className="text-sm">Asking for camera access…</p>
                </>
              )}
              {status === "denied" && (
                <>
                  <Camera className="h-5 w-5" aria-hidden="true" />
                  <p className="text-sm font-medium">
                    Camera permission was blocked.
                  </p>
                  <p className="max-w-[28ch] text-xs text-white/70">
                    Allow camera in your browser settings, then try again.
                  </p>
                </>
              )}
              {status === "error" && (
                <>
                  <Camera className="h-5 w-5" aria-hidden="true" />
                  <p className="text-sm font-medium">Scanner unavailable</p>
                  {errorMsg && (
                    <p className="max-w-[32ch] text-xs text-white/70">
                      {errorMsg}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <div className="px-4 py-3 text-center text-xs text-text-soft">
          Point the camera at a wallet QR code.
        </div>
      </motion.div>
    </>
  );
}
