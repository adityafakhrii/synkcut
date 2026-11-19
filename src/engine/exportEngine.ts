import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  canEncodeVideo,
} from "mediabunny";
import type { SynkcutProject } from "../types/scene";
import { renderProjectFrame } from "./canvasRenderer";
import { getProjectDurationMs } from "./sampleProject";
import { isTauriRuntime, muxExportMp4, type ExportResult } from "../lib/tauriBridge";

export interface ExportOptions {
  resolution: "1080p" | "720p";
  fps: 30 | 60;
  audioPath: string | null;
  generateDemoAudio: boolean;
  outputPath: string;
  videoElement?: HTMLVideoElement | null;
  onProgress?: (percent: number, stage: string, message: string) => void;
}

export async function checkWebCodecsSupport(): Promise<{
  supported: boolean;
  avcSupported: boolean;
}> {
  const supported = typeof window !== "undefined" && "VideoEncoder" in window;
  if (!supported) {
    return { supported: false, avcSupported: false };
  }
  try {
    const avcSupported = await canEncodeVideo("avc");
    return { supported: true, avcSupported };
  } catch {
    return { supported: true, avcSupported: false };
  }
}

async function seekVideoDeterministic(video: HTMLVideoElement, targetSec: number): Promise<void> {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  const clampedSec = targetSec % video.duration;
  if (Math.abs(video.currentTime - clampedSec) < 0.008) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done, { once: true });
    video.currentTime = clampedSec;
    // Safety timeout in case WebView2 skips a seeked event for identical frames
    window.setTimeout(done, 150);
  });
}

export async function exportProjectToMp4(
  project: SynkcutProject,
  options: ExportOptions
): Promise<ExportResult> {
  const width = options.resolution === "1080p" ? 1080 : 720;
  const height = options.resolution === "1080p" ? 1920 : 1280;
  const fps = options.fps;
  const durationMs = getProjectDurationMs(project);
  const durationSec = durationMs / 1000;
  const totalFrames = Math.max(1, Math.ceil(durationSec * fps));

  options.onProgress?.(2, "init", `Menyiapkan canvas ${width}×${height} @ ${fps}fps...`);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new Error("Gagal membuat Canvas 2D context untuk export.");
  }

  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });

  const videoSource = new CanvasSource(canvas, {
    codec: "avc",
    bitrate: QUALITY_HIGH,
  });

  output.addVideoTrack(videoSource, { frameRate: fps });
  await output.start();

  // Pause live playback if a local video element is attached
  if (options.videoElement && !options.videoElement.paused) {
    options.videoElement.pause();
  }

  for (let frame = 0; frame < totalFrames; frame++) {
    const timeSec = frame / fps;
    const timeMs = timeSec * 1000;

    if (options.videoElement && options.videoElement.readyState >= 2) {
      await seekVideoDeterministic(options.videoElement, timeSec);
    }

    renderProjectFrame(ctx, project, timeMs, {
      videoElement: options.videoElement,
      showSafeZone: false,
    });

    await videoSource.add(timeSec, 1 / fps, {
      keyFrame: frame % (fps * 2) === 0,
    });

    if (frame % 4 === 0 || frame === totalFrames - 1) {
      const encodePct = 5 + ((frame + 1) / totalFrames) * 72;
      options.onProgress?.(
        encodePct,
        "encoding",
        `Encoding frame ${frame + 1} / ${totalFrames} (WebCodecs H.264)...`
      );
    }
  }

  videoSource.close();
  await output.finalize();

  const buffer = target.buffer;
  if (!buffer) {
    throw new Error("Mediabunny tidak menghasilkan buffer MP4.");
  }

  const videoBytes = new Uint8Array(buffer);

  if (isTauriRuntime()) {
    options.onProgress?.(
      80,
      "muxing",
      "Mengirim video ke Rust & FFmpeg Sidecar untuk muxing audio..."
    );
    const result = await muxExportMp4({
      videoBytes,
      audioPath: options.audioPath,
      generateDemoAudio: options.generateDemoAudio,
      durationSec,
      outputPath: options.outputPath,
    });
    options.onProgress?.(100, "done", "Export MP4 selesai!");
    return result;
  }

  // Fallback for pure browser preview mode
  const blob = new Blob([videoBytes], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = options.outputPath.endsWith(".mp4")
    ? options.outputPath
    : `${options.outputPath}.mp4`;
  a.click();
  URL.revokeObjectURL(url);

  options.onProgress?.(100, "done", "MP4 berhasil diunduh (mode browser).");
  return {
    outputPath: options.outputPath,
    fileSizeBytes: videoBytes.byteLength,
    durationMs,
  };
}
