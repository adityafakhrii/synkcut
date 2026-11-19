import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

export interface SidecarStatus {
  ffmpegReady: boolean;
  ffprobeReady: boolean;
  ffmpegVersion: string;
  ffprobeVersion: string;
  isLgpl: boolean;
  error: string | null;
}

export interface MediaProbeInfo {
  path: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string;
}

export interface ExportProgressEvent {
  stage: string;
  percent: number;
  message: string;
}

export interface ExportResult {
  outputPath: string;
  fileSizeBytes: number;
  durationMs: number;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function toAssetUrl(localPath: string): string {
  if (!isTauriRuntime()) return localPath;
  return convertFileSrc(localPath);
}

export async function checkSidecars(): Promise<SidecarStatus> {
  if (!isTauriRuntime()) {
    return {
      ffmpegReady: false,
      ffprobeReady: false,
      ffmpegVersion: "Browser preview mode (jalankan via `npm run tauri dev`)",
      ffprobeVersion: "",
      isLgpl: false,
      error: "Tauri runtime tidak aktif",
    };
  }
  return invoke<SidecarStatus>("check_sidecars");
}

export async function pickLocalVideo(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const selected = await open({
    multiple: false,
    title: "Pilih Footage Video Lokal",
    filters: [
      {
        name: "Video",
        extensions: ["mp4", "mov", "mkv", "webm"],
      },
    ],
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickLocalAudio(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const selected = await open({
    multiple: false,
    title: "Pilih File Audio / Voiceover Lokal",
    filters: [
      {
        name: "Audio",
        extensions: ["mp3", "wav", "m4a", "aac", "ogg"],
      },
    ],
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickExportSavePath(defaultName: string): Promise<string | null> {
  if (!isTauriRuntime()) return `${defaultName}.mp4`;
  const selected = await save({
    title: "Simpan Hasil Export MP4",
    defaultPath: `${defaultName}.mp4`,
    filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
  });
  return selected ?? null;
}

export async function probeMedia(path: string): Promise<MediaProbeInfo> {
  return invoke<MediaProbeInfo>("probe_media", { path });
}

export async function extractThumbnails(path: string, count = 2): Promise<string[]> {
  return invoke<string[]>("extract_thumbnails", { path, count });
}

export async function muxExportMp4(params: {
  videoBytes: Uint8Array;
  audioPath: string | null;
  generateDemoAudio: boolean;
  durationSec: number;
  outputPath: string;
}): Promise<ExportResult> {
  return invoke<ExportResult>("mux_export_mp4", {
    videoBytes: Array.from(params.videoBytes),
    audioPath: params.audioPath,
    generateDemoAudio: params.generateDemoAudio,
    durationSec: params.durationSec,
    outputPath: params.outputPath,
  });
}

export async function revealInExplorer(path: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("reveal_in_explorer", { path });
}

export async function listenExportProgress(
  cb: (event: ExportProgressEvent) => void
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<ExportProgressEvent>("export-progress", (ev) => cb(ev.payload));
}
