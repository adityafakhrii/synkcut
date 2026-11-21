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
import {
  isTauriRuntime,
  muxExportMp4,
  toAssetUrl,
  type AudioMixPlan,
  type ExportResult,
  type SfxMixEvent,
} from "../lib/tauriBridge";

export class ExportCancelledError extends Error {
  constructor() {
    super("Export dibatalkan oleh pengguna.");
    this.name = "ExportCancelledError";
  }
}

export interface ExportProgressUpdate {
  percent: number;
  stage: "init" | "encoding" | "muxing" | "done";
  message: string;
  currentFrame?: number;
  totalFrames?: number;
  elapsedMs?: number;
  etaMs?: number | null;
}

export interface ExportOptions {
  resolution: "1080p" | "720p";
  fps: 30 | 60;
  audioPath: string | null;
  generateDemoAudio: boolean;
  outputPath: string;
  videoElement?: HTMLVideoElement | null;
  signal?: AbortSignal;
  onProgress?: (update: ExportProgressUpdate) => void;
}

export function estimateExportSizeBytes(
  durationMs: number,
  resolution: "1080p" | "720p",
  fps: 30 | 60
): number {
  const sec = Math.max(1, durationMs / 1000);
  // Realistic H.264 high-quality bitrate estimate + 192 kbps AAC audio
  const videoBps =
    resolution === "1080p"
      ? fps === 60
        ? 11_000_000
        : 7_500_000
      : fps === 60
        ? 6_000_000
        : 4_000_000;
  const audioBps = 192_000;
  return Math.round(((videoBps + audioBps) / 8) * sec);
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

async function loadHiddenVideo(localPath: string): Promise<HTMLVideoElement | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok ? video : null);
    };

    video.addEventListener("loadeddata", () => finish(true), { once: true });
    video.addEventListener("error", () => finish(false), { once: true });
    video.src = toAssetUrl(localPath);
    video.load();
    window.setTimeout(() => finish(video.readyState >= 2), 6000);
  });
}

async function seekVideoDeterministic(video: HTMLVideoElement, targetSec: number): Promise<void> {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  const clampedSec = Math.max(0, targetSec % video.duration);
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
    window.setTimeout(done, 180);
  });
}

function buildMixPlan(project: SynkcutProject): AudioMixPlan {
  const sfxEvents: SfxMixEvent[] = [];
  for (const scene of project.scenes) {
    for (const sfx of scene.sfx) {
      if (!sfx.preset || sfx.preset === "none") continue;
      sfxEvents.push({
        preset: sfx.preset,
        timestampMs: Math.max(0, scene.startMs + (sfx.offsetMs || 0)),
        volume: sfx.volume ?? 0.65,
      });
    }
  }

  return {
    bgmPreset: project.globalStyle.bgm.preset || null,
    bgmVolume: project.globalStyle.bgm.volume ?? 0.24,
    autoDucking: project.globalStyle.bgm.autoDucking ?? true,
    sfxEvents,
  };
}

function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new ExportCancelledError();
  }
}

export async function exportProjectToMp4(
  project: SynkcutProject,
  options: ExportOptions
): Promise<ExportResult> {
  const startedAt = performance.now();
  const width = options.resolution === "1080p" ? 1080 : 720;
  const height = options.resolution === "1080p" ? 1920 : 1280;
  const fps = options.fps;
  const durationMs = getProjectDurationMs(project);
  const durationSec = durationMs / 1000;
  const totalFrames = Math.max(1, Math.ceil(durationSec * fps));

  options.onProgress?.({
    percent: 2,
    stage: "init",
    message: `Menyiapkan canvas ${width}×${height} @ ${fps}fps (${totalFrames} frame)...`,
    currentFrame: 0,
    totalFrames,
    elapsedMs: 0,
    etaMs: null,
  });

  // Preload distinct primary & secondary (Split-Screen) local video clips (skip pure AI Motion scenes)
  const pathList: string[] = [];
  for (const s of project.scenes) {
    if (s.visualSource !== "motion" && s.media.path) pathList.push(s.media.path);
    if (s.media.secondaryPath) pathList.push(s.media.secondaryPath);
  }
  const uniquePaths = Array.from(new Set(pathList));
  const videoMap = new Map<string, HTMLVideoElement>();

  try {
    for (let i = 0; i < uniquePaths.length; i++) {
      checkAborted(options.signal);
      options.onProgress?.({
        percent: 2 + Math.round(((i + 1) / Math.max(1, uniquePaths.length)) * 3),
        stage: "init",
        message: `Memuat footage lokal (${i + 1}/${uniquePaths.length})...`,
        currentFrame: 0,
        totalFrames,
        elapsedMs: performance.now() - startedAt,
        etaMs: null,
      });
      const loaded = await loadHiddenVideo(uniquePaths[i]);
      if (loaded) {
        videoMap.set(uniquePaths[i], loaded);
      }
    }

    checkAborted(options.signal);

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

    if (options.videoElement && !options.videoElement.paused) {
      options.videoElement.pause();
    }

    const encodeStartTs = performance.now();

    for (let frame = 0; frame < totalFrames; frame++) {
      checkAborted(options.signal);

      const timeSec = frame / fps;
      const timeMs = timeSec * 1000;

      const activeScene =
        project.scenes.find((s) => timeMs >= s.startMs && timeMs < s.endMs) ??
        project.scenes[project.scenes.length - 1];

      const isMotionScene = activeScene?.visualSource === "motion";
      const sceneVideo = isMotionScene
        ? null
        : (activeScene?.media.path ? videoMap.get(activeScene.media.path) : null) ??
          options.videoElement ??
          null;
      const secondaryVideo = activeScene?.media.secondaryPath
        ? videoMap.get(activeScene.media.secondaryPath) ?? null
        : null;

      if (sceneVideo && sceneVideo.readyState >= 2 && activeScene) {
        const localSceneSec =
          Math.max(0, timeMs - activeScene.startMs + (activeScene.media.trimStartMs || 0)) / 1000;
        await seekVideoDeterministic(sceneVideo, localSceneSec);
      }
      if (secondaryVideo && secondaryVideo.readyState >= 2 && activeScene) {
        const localSec = Math.max(0, timeMs - activeScene.startMs) / 1000;
        await seekVideoDeterministic(secondaryVideo, localSec);
      }

      renderProjectFrame(ctx, project, timeMs, {
        videoElement: sceneVideo,
        secondaryVideoElement: secondaryVideo,
        showSafeZone: false,
      });

      await videoSource.add(timeSec, 1 / fps, {
        keyFrame: frame % (fps * 2) === 0,
      });

      if (frame % 4 === 0 || frame === totalFrames - 1) {
        const now = performance.now();
        const elapsedMs = now - startedAt;
        const encodeElapsed = Math.max(1, now - encodeStartTs);
        const msPerFrame = encodeElapsed / (frame + 1);
        const remainingFrames = totalFrames - frame - 1;
        // Include modest ~1.8s buffer for FFmpeg audio mixing & faststart muxing
        const etaMs = Math.max(0, Math.round(remainingFrames * msPerFrame + 1800));
        const encodePct = 5 + ((frame + 1) / totalFrames) * 73;

        options.onProgress?.({
          percent: encodePct,
          stage: "encoding",
          message: `Encoding frame ${frame + 1} / ${totalFrames} (WebCodecs H.264)...`,
          currentFrame: frame + 1,
          totalFrames,
          elapsedMs,
          etaMs,
        });
      }

      // Periodically yield to UI thread so Windows WebView2 stays responsive on long 60s exports
      if (frame % 15 === 14) {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }

    videoSource.close();
    await output.finalize();

    checkAborted(options.signal);

    const buffer = target.buffer;
    if (!buffer) {
      throw new Error("Mediabunny tidak menghasilkan buffer MP4.");
    }

    const videoBytes = new Uint8Array(buffer);

    if (isTauriRuntime()) {
      options.onProgress?.({
        percent: 82,
        stage: "muxing",
        message: "FFmpeg Sidecar mencampur Voiceover, BGM Auto-Ducking, & SFX...",
        currentFrame: totalFrames,
        totalFrames,
        elapsedMs: performance.now() - startedAt,
        etaMs: 1800,
      });
      const result = await muxExportMp4({
        videoBytes,
        audioPath: options.audioPath,
        generateDemoAudio: options.generateDemoAudio,
        durationSec,
        outputPath: options.outputPath,
        mixPlan: buildMixPlan(project),
      });
      options.onProgress?.({
        percent: 100,
        stage: "done",
        message: "Export MP4 selesai!",
        currentFrame: totalFrames,
        totalFrames,
        elapsedMs: performance.now() - startedAt,
        etaMs: 0,
      });
      return result;
    }

    const blob = new Blob([videoBytes], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = options.outputPath.endsWith(".mp4")
      ? options.outputPath
      : `${options.outputPath}.mp4`;
    a.click();
    URL.revokeObjectURL(url);

    options.onProgress?.({
      percent: 100,
      stage: "done",
      message: "MP4 berhasil diunduh (mode browser).",
      currentFrame: totalFrames,
      totalFrames,
      elapsedMs: performance.now() - startedAt,
      etaMs: 0,
    });
    return {
      outputPath: options.outputPath,
      fileSizeBytes: videoBytes.byteLength,
      durationMs,
    };
  } finally {
    for (const v of videoMap.values()) {
      v.pause();
      v.src = "";
      v.load();
    }
    videoMap.clear();
  }
}
