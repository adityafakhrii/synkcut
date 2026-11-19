import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  ByokProvider,
  ByokStatus,
  ConnectionTestResult,
  ProjectSummary,
  SynkcutProject,
} from "../types/scene";

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

const BROWSER_PROJECTS_KEY = "synkcut_browser_projects_v1";
const BROWSER_BYOK_KEY = "synkcut_browser_byok_v1";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function toAssetUrl(localPath: string): string {
  if (!isTauriRuntime()) return localPath;
  return convertFileSrc(localPath);
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/* ---------------- Sidecar & Media ---------------- */

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
    filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickLocalAudio(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const selected = await open({
    multiple: false,
    title: "Pilih File Audio / Voiceover Lokal",
    filters: [{ name: "Audio", extensions: ["mp3", "wav", "m4a", "aac", "ogg"] }],
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

/* ---------------- BYOK Keyring ---------------- */

function readBrowserByok(): ByokStatus {
  const fallback: ByokStatus = {
    activeProvider: "gemini",
    onboardingCompleted: false,
    providers: {
      gemini: { configured: false, maskedKey: null },
      openai: { configured: false, maskedKey: null },
      openrouter: { configured: false, maskedKey: null },
    },
  };
  try {
    const raw = localStorage.getItem(BROWSER_BYOK_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

export async function getByokStatus(): Promise<ByokStatus> {
  if (!isTauriRuntime()) return readBrowserByok();
  return invoke<ByokStatus>("get_byok_status");
}

export async function saveByokKey(
  provider: ByokProvider,
  apiKey: string,
  setActive = true
): Promise<ByokStatus> {
  if (!isTauriRuntime()) {
    const cur = readBrowserByok();
    const trimmed = apiKey.trim();
    const masked =
      trimmed.length <= 8
        ? "••••••••"
        : `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
    const next: ByokStatus = {
      ...cur,
      activeProvider: setActive ? provider : cur.activeProvider,
      onboardingCompleted: true,
      providers: {
        ...cur.providers,
        [provider]: { configured: true, maskedKey: masked },
      },
    };
    localStorage.setItem(BROWSER_BYOK_KEY, JSON.stringify(next));
    return next;
  }
  return invoke<ByokStatus>("save_byok_key", { provider, apiKey, setActive });
}

export async function setActiveProvider(provider: ByokProvider): Promise<ByokStatus> {
  if (!isTauriRuntime()) {
    const cur = readBrowserByok();
    const next = { ...cur, activeProvider: provider };
    localStorage.setItem(BROWSER_BYOK_KEY, JSON.stringify(next));
    return next;
  }
  return invoke<ByokStatus>("set_active_provider", { provider });
}

export async function completeOnboarding(): Promise<ByokStatus> {
  if (!isTauriRuntime()) {
    const cur = readBrowserByok();
    const next = { ...cur, onboardingCompleted: true };
    localStorage.setItem(BROWSER_BYOK_KEY, JSON.stringify(next));
    return next;
  }
  return invoke<ByokStatus>("complete_onboarding");
}

export async function deleteByokKey(provider: ByokProvider): Promise<ByokStatus> {
  if (!isTauriRuntime()) {
    const cur = readBrowserByok();
    const next: ByokStatus = {
      ...cur,
      providers: {
        ...cur.providers,
        [provider]: { configured: false, maskedKey: null },
      },
    };
    localStorage.setItem(BROWSER_BYOK_KEY, JSON.stringify(next));
    return next;
  }
  return invoke<ByokStatus>("delete_byok_key", { provider });
}

export async function testByokConnection(
  provider: ByokProvider,
  apiKey?: string
): Promise<ConnectionTestResult> {
  if (!isTauriRuntime()) {
    return {
      ok: Boolean(apiKey && apiKey.trim().length >= 8),
      provider,
      latencyMs: 42,
      message:
        apiKey && apiKey.trim().length >= 8
          ? "Mode preview browser: format API Key valid (tes koneksi penuh berjalan di desktop app)."
          : "API Key terlalu pendek.",
      detail: "Browser preview",
    };
  }
  return invoke<ConnectionTestResult>("test_byok_connection", {
    provider,
    apiKey: apiKey ?? null,
  });
}

/* ---------------- Local My Projects ---------------- */

function readBrowserProjects(): Record<string, SynkcutProject> {
  try {
    const raw = localStorage.getItem(BROWSER_PROJECTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function summarizeProject(p: SynkcutProject): ProjectSummary {
  const now = new Date().toISOString();
  const firstScene = p.scenes[0];
  const firstOverlay = firstScene?.overlays?.[0];
  return {
    id: p.meta.id,
    name: p.meta.name,
    format: p.meta.format,
    captionPreset: p.globalStyle.captionPreset,
    accentColor: p.globalStyle.accentColor,
    hookText: firstScene?.text || "",
    firstOverlayType: firstOverlay?.type || null,
    firstOverlayTitle: firstOverlay?.title || null,
    firstOverlayText: firstOverlay?.text || null,
    sceneCount: p.scenes.length,
    durationMs: Math.max(0, ...p.scenes.map((s) => s.endMs)),
    hasFootage: p.scenes.some((s) => Boolean(s.media.path)),
    createdAt: p.meta.createdAt || now,
    updatedAt: p.meta.updatedAt || now,
  };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  if (!isTauriRuntime()) {
    return Object.values(readBrowserProjects())
      .map(summarizeProject)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return invoke<ProjectSummary[]>("list_projects");
}

export async function loadProject(projectId: string): Promise<SynkcutProject> {
  if (!isTauriRuntime()) {
    const map = readBrowserProjects();
    const found = map[projectId];
    if (!found) throw new Error("Proyek tidak ditemukan.");
    return found;
  }
  return invoke<SynkcutProject>("load_project", { projectId });
}

export async function saveProject(project: SynkcutProject): Promise<ProjectSummary> {
  if (!isTauriRuntime()) {
    const now = new Date().toISOString();
    const updated: SynkcutProject = {
      ...project,
      meta: {
        ...project.meta,
        createdAt: project.meta.createdAt || now,
        updatedAt: now,
      },
    };
    const map = readBrowserProjects();
    map[updated.meta.id] = updated;
    localStorage.setItem(BROWSER_PROJECTS_KEY, JSON.stringify(map));
    return summarizeProject(updated);
  }
  return invoke<ProjectSummary>("save_project", { project });
}

export async function duplicateProject(projectId: string): Promise<ProjectSummary> {
  if (!isTauriRuntime()) {
    const orig = await loadProject(projectId);
    const now = new Date().toISOString();
    const copy: SynkcutProject = {
      ...orig,
      meta: {
        ...orig.meta,
        id: `proj_${Date.now()}`,
        name: `${orig.meta.name} (Salinan)`,
        createdAt: now,
        updatedAt: now,
      },
    };
    return saveProject(copy);
  }
  return invoke<ProjectSummary>("duplicate_project", { projectId });
}

export async function renameProject(
  projectId: string,
  newName: string
): Promise<ProjectSummary> {
  if (!isTauriRuntime()) {
    const orig = await loadProject(projectId);
    return saveProject({
      ...orig,
      meta: { ...orig.meta, name: newName.trim() },
    });
  }
  return invoke<ProjectSummary>("rename_project", { projectId, newName });
}

export async function deleteProject(projectId: string): Promise<void> {
  if (!isTauriRuntime()) {
    const map = readBrowserProjects();
    delete map[projectId];
    localStorage.setItem(BROWSER_PROJECTS_KEY, JSON.stringify(map));
    return;
  }
  await invoke("delete_project", { projectId });
}
