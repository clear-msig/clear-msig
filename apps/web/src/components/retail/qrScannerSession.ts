export interface QrDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

interface ScannerSessionOptions {
  video: HTMLVideoElement;
  createDetector: () => QrDetector;
  onScanning: () => void;
  onResult: (value: string) => void;
  onError: (error: unknown) => void;
}

// A session owns the camera and every pending asynchronous continuation. Closing
// a modal must invalidate it immediately, even while its exit animation runs.
export function startQrScannerSession({
  video,
  createDetector,
  onScanning,
  onResult,
  onError,
}: ScannerSessionOptions): () => void {
  let active = true;
  let stream: MediaStream | null = null;
  let frame: number | null = null;

  function stopTracks(value: MediaStream) {
    for (const track of value.getTracks()) {
      try {
        track.stop();
      } catch {
        // An already-ended track must not prevent the others from stopping.
      }
    }
  }

  function stop() {
    active = false;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (stream) {
      stopTracks(stream);
      if (video.srcObject === stream) video.srcObject = null;
      stream = null;
    }
  }

  async function start() {
    try {
      const detector = createDetector();
      const acquired = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      if (!active) {
        stopTracks(acquired);
        return;
      }
      stream = acquired;
      video.srcObject = acquired;
      video.setAttribute("playsinline", "true");
      await video.play();
      if (!active) return;
      onScanning();

      async function tick() {
        frame = null;
        if (!active) return;
        if (video.readyState >= 2) {
          let codes: { rawValue: string }[] = [];
          try {
            codes = await detector.detect(video);
          } catch {
            // Individual frames can fail to decode while the camera moves.
          }
          if (!active) return;
          const value = codes.find((code) => code.rawValue.trim())?.rawValue.trim();
          if (value) {
            stop();
            onResult(value);
            return;
          }
        }
        if (active) frame = requestAnimationFrame(tick);
      }

      frame = requestAnimationFrame(tick);
    } catch (error) {
      if (!active) return;
      stop();
      onError(error);
    }
  }

  void start();
  return stop;
}
