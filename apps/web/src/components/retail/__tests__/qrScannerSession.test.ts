import { afterEach, describe, expect, it, vi } from "vitest";
import { startQrScannerSession } from "../qrScannerSession";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function flush() {
  // Camera acquisition and video playback each cross a promise boundary.
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

function scanner() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  const video = {
    srcObject: null,
    readyState: 2,
    setAttribute: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
  } as unknown as HTMLVideoElement;
  const detect = vi.fn().mockResolvedValue([]);
  const onScanning = vi.fn();
  const onResult = vi.fn();
  const onError = vi.fn();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  return {
    track, stream, getUserMedia, video, detect, onScanning, onResult, onError, frames,
    start: (createDetector = () => ({ detect })) => startQrScannerSession({
      video, createDetector, onScanning, onResult, onError,
    }),
    async runFrame() {
      const entry = frames.entries().next().value;
      if (!entry) throw new Error("No animation frame scheduled");
      const [id, callback] = entry;
      frames.delete(id);
      await callback(0);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("QR scanner session", () => {
  it("discards an in-flight decode after Close without rescheduling", async () => {
    const scan = scanner();
    const decode = deferred<{ rawValue: string }[]>();
    scan.detect.mockReturnValue(decode.promise);
    const stop = scan.start();
    await flush();
    const pendingFrame = scan.runFrame();
    stop();
    decode.resolve([{ rawValue: "cancelled-recipient" }]);
    await pendingFrame;
    expect(scan.onResult).not.toHaveBeenCalled();
    expect(scan.frames.size).toBe(0);
    expect(scan.track.stop).toHaveBeenCalledOnce();
    expect(scan.video.srcObject).toBeNull();
  });

  it("releases a camera permission request that resolves after Close", async () => {
    const scan = scanner();
    const permission = deferred<MediaStream>();
    scan.getUserMedia.mockReturnValue(permission.promise);
    const stop = scan.start();
    stop();
    permission.resolve(scan.stream);
    await flush();
    expect(scan.track.stop).toHaveBeenCalledOnce();
    expect(scan.video.play).not.toHaveBeenCalled();
    expect(scan.onScanning).not.toHaveBeenCalled();
    expect(scan.frames.size).toBe(0);
  });

  it("does not resume scanning when playback resolves after Close", async () => {
    const scan = scanner();
    const playback = deferred<void>();
    vi.mocked(scan.video.play).mockReturnValue(playback.promise);
    const stop = scan.start();
    await flush();
    stop();
    playback.resolve();
    await flush();
    expect(scan.onScanning).not.toHaveBeenCalled();
    expect(scan.frames.size).toBe(0);
    expect(scan.track.stop).toHaveBeenCalledOnce();
  });

  it("stops the camera before delivering exactly one trimmed result", async () => {
    const scan = scanner();
    scan.detect.mockResolvedValue([{ rawValue: "  " }, { rawValue: " recipient " }]);
    scan.onResult.mockImplementation(() => {
      expect(scan.track.stop).toHaveBeenCalledOnce();
      expect(scan.video.srcObject).toBeNull();
    });
    const stop = scan.start();
    await flush();
    await scan.runFrame();
    stop();
    expect(scan.onResult).toHaveBeenCalledExactlyOnceWith("recipient");
    expect(scan.frames.size).toBe(0);
    expect(scan.track.stop).toHaveBeenCalledOnce();
  });

  it("releases tracks and reports failed playback instead of leaving the camera on", async () => {
    const scan = scanner();
    const error = new Error("Playback unavailable");
    vi.mocked(scan.video.play).mockRejectedValue(error);
    scan.start();
    await flush();
    expect(scan.onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(scan.track.stop).toHaveBeenCalledOnce();
    expect(scan.frames.size).toBe(0);
    expect(scan.video.srcObject).toBeNull();
  });

  it("reports detector initialization failures before asking for a camera", async () => {
    const scan = scanner();
    const error = new Error("QR format unsupported");
    scan.start(() => { throw error; });
    await flush();
    expect(scan.onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(scan.getUserMedia).not.toHaveBeenCalled();
  });

  it("continues after blank or undecodable frames", async () => {
    const scan = scanner();
    scan.detect.mockResolvedValueOnce([{ rawValue: "  " }]).mockRejectedValueOnce(new Error("Blur"));
    const stop = scan.start();
    await flush();
    await scan.runFrame();
    await scan.runFrame();
    expect(scan.frames.size).toBe(1);
    expect(scan.onError).not.toHaveBeenCalled();
    expect(scan.onResult).not.toHaveBeenCalled();
    stop();
    expect(scan.frames.size).toBe(0);
  });
});
