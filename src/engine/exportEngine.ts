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
    window.setTimeout(() => finish(video.readyState >= 2), 4000);
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
    window.setTimeout(done, 150);
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

  // Preload distinct primary & secondary (Split-Screen) local video clips
  const pathList: string[] = [];
  for (const s of project.scenes) {
    if (s.media.path) pathList.push(s.media.path);
    if (s.media.secondaryPath) pathList.push(s.media.secondaryPath);
  }
  const uniquePaths = Array.from(new Set(pathList));
  const videoMap = new Map<string, HTMLVideoElement>();
  for (const path of uniquePaths) {
    const loaded = await loadHiddenVideo(path);
    if (loaded) {
      videoMap.set(path, loaded);
    }
  }

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

  for (let frame = 0; frame < totalFrames; frame++) {
    const timeSec = frame / fps;
    const timeMs = timeSec * 1000;

    const activeScene =
      project.scenes.find((s) => timeMs >= s.startMs && timeMs < s.endMs) ??
      project.scenes[project.scenes.length - 1];

    const sceneVideo =
      (activeScene?.media.path ? videoMap.get(activeScene.media.path) : null) ??
      options.videoElement ??
      null;
    const secondaryVideo =
      activeScene?.media.secondaryPath ? videoMap.get(activeScene.media.secondaryPath) ?? null : null;

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

  for (const v of videoMap.values()) {
    v.src = "";
    v.load();
  }

  const buffer = target.buffer;
  if (!buffer) {
    throw new Error("Mediabunny tidak menghasilkan buffer MP4.");
  }

  const videoBytes = new Uint8Array(buffer);

  if (isTauriRuntime()) {
    options.onProgress?.(
      80,
      "muxing",
      "FFmpeg Sidecar mencampur Voiceover, BGM Auto-Ducking, & SFX..."
    );
    const result = await muxExportMp4({
      videoBytes,
      audioPath: options.audioPath,
      generateDemoAudio: options.generateDemoAudio,
      durationSec,
      outputPath: options.outputPath,
      mixPlan: buildMixPlan(project),
    });
    options.onProgress?.(100, "done", "Export MP4 selesai!");
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

  options.onProgress?.(100, "done", "MP4 berhasil diunduh (mode browser).");
  return {
    outputPath: options.outputPath,
    fileSizeBytes: videoBytes.byteLength,
    durationMs,
  };
}
