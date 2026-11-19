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

export async function pickLocalVideos(): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  const selected = await open({
    multiple: true,
    title: "Pilih Satu atau Beberapa Footage Video Lokal",
    filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm"] }],
  });
  if (Array.isArray(selected)) return selected;
  return typeof selected === "string" ? [selected] : [];
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

export interface AudioPresetMeta {
  id: string;
  label: string;
  category: string;
  durationMs: number;
}

export interface AudioPackCatalog {
  sfx: AudioPresetMeta[];
  bgm: AudioPresetMeta[];
}

export interface SfxMixEvent {
  preset: string;
  timestampMs: number;
  volume: number;
}

export interface AudioMixPlan {
  bgmPreset?: string | null;
  bgmVolume?: number;
  autoDucking?: boolean;
  sfxEvents?: SfxMixEvent[];
}

export async function getAudioPackCatalog(): Promise<AudioPackCatalog> {
  if (!isTauriRuntime()) {
    return {
      sfx: [
        { id: "whoosh_fast", label: "Whoosh Cepat", category: "Transisi", durationMs: 420 },
        { id: "whoosh_soft", label: "Whoosh Halus", category: "Transisi", durationMs: 580 },
        { id: "pop_text", label: "Pop Teks", category: "Teks", durationMs: 190 },
        { id: "ding_notif", label: "Ding Notif", category: "Overlay", durationMs: 520 },
        { id: "impact_boom", label: "Impact Boom", category: "Hook", durationMs: 750 },
        { id: "riser", label: "Riser CTA", category: "CTA", durationMs: 1100 },
        { id: "camera_shutter", label: "Camera Shutter", category: "Aksi", durationMs: 240 },
        { id: "keyboard_click", label: "Keyboard Click", category: "UI", durationMs: 160 },
        { id: "cash_register", label: "Cash Register", category: "Promo", durationMs: 680 },
        { id: "vinyl_scratch", label: "Vinyl Scratch", category: "Plot Twist", durationMs: 460 },
        { id: "glitch_zap", label: "Glitch Zap", category: "Transisi", durationMs: 340 },
        { id: "swoosh_reverse", label: "Swoosh Reverse", category: "Transisi", durationMs: 620 },
      ],
      bgm: [
        { id: "upbeat_promo", label: "Upbeat Promo", category: "Iklan", durationMs: 8000 },
        { id: "lofi_education", label: "Lo-Fi Edukasi", category: "Edukasi", durationMs: 8000 },
        { id: "cinematic_story", label: "Cinematic Story", category: "Storytelling", durationMs: 8000 },
        { id: "tech_modern", label: "Tech Modern", category: "Review", durationMs: 8000 },
        { id: "trendy_funk", label: "Trendy Funk", category: "Reels", durationMs: 8000 },
        { id: "chill_aesthetic", label: "Chill Aesthetic", category: "Lifestyle", durationMs: 8000 },
      ],
    };
  }
  return invoke<AudioPackCatalog>("get_audio_pack_catalog");
}

export async function ensureAudioPackAsset(
  kind: "sfx" | "bgm",
  presetId: string
): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return invoke<string>("ensure_audio_pack_asset", { kind, presetId });
}

export async function muxExportMp4(params: {
  videoBytes: Uint8Array;
  audioPath: string | null;
  generateDemoAudio: boolean;
  durationSec: number;
  outputPath: string;
  mixPlan?: AudioMixPlan;
}): Promise<ExportResult> {
  return invoke<ExportResult>("mux_export_mp4", {
    videoBytes: Array.from(params.videoBytes),
    audioPath: params.audioPath,
    generateDemoAudio: params.generateDemoAudio,
    durationSec: params.durationSec,
    outputPath: params.outputPath,
    mixPlan: params.mixPlan ?? null,
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

/* ---------------- Milestone 2: AI Script, Audio Auto-Sync & Multimodal Director ---------------- */

export interface HookOption {
  id: string;
  angle: string;
  text: string;
}

export interface GeneratedScriptResponse {
  projectTitle: string;
  hooks: HookOption[];
  bodySegments: string[];
  cta: string;
  providerUsed: string;
}

export interface ProcessedAudioResult {
  audioPath: string;
  durationMs: number;
  transcript: string;
  words: Array<{ word: string; startMs: number; endMs: number }>;
  providerUsed: string;
  silenceTrimmed: boolean;
}

export interface FootageInputItem {
  path: string;
  fileName: string;
  durationMs: number;
  thumbnails: string[];
}

export interface AssembleProjectRequest {
  projectTitle: string;
  format: string;
  hookText: string;
  bodySegments: string[];
  ctaText: string;
  audioPath: string | null;
  audioSource: "tts" | "recorded" | "demo";
  trimSilence: boolean;
  durationMs: number;
  words: Array<{ word: string; startMs: number; endMs: number }>;
  footage: FootageInputItem[];
  captionPreset: string;
  accentColor: string;
  motionPreset: string;
  transitionPreset: string;
  overlayMode:
    | "auto"
    | "hook_headline"
    | "notification_banner"
    | "promo_badge"
    | "doodle_highlight"
    | "split_screen"
    | "none";
  bgmPreset: string;
  autoDucking: boolean;
  autoSfx: boolean;
}

export interface CopilotPatchResponse {
  project: SynkcutProject;
  reply: string;
  providerUsed: string;
}

export async function aiGenerateScript(req: {
  topic: string;
  format: string;
  tone: string;
  targetDurationSec: number;
}): Promise<GeneratedScriptResponse> {
  if (!isTauriRuntime()) {
    return {
      projectTitle: req.topic.slice(0, 32) || "Konten Baru",
      hooks: [
        {
          id: "h1",
          angle: "Pain Point",
          text: `Masih bingung cari cara cepat untuk ${req.topic}?`,
        },
        {
          id: "h2",
          angle: "Curiosity",
          text: `Ternyata ini rahasia di balik ${req.topic} yang jarang orang tahu!`,
        },
        {
          id: "h3",
          angle: "Bold Claim",
          text: `Stop cara lama! ${req.topic} sekarang bisa 10x lebih cepat.`,
        },
      ],
      bodySegments: [
        `Fokus pada keunggulan utama ${req.topic} dengan visual dekat yang langsung jelas.`,
        "Bandingkan hasil sebelum dan sesudah dalam tiga detik agar audiens langsung percaya.",
      ],
      cta: "Coba sekarang juga sebelum promo minggu ini berakhir!",
      providerUsed: "demo (browser preview)",
    };
  }
  return invoke<GeneratedScriptResponse>("ai_generate_script", { req });
}

export async function generateTtsAudio(params: {
  text: string;
  voiceName: string;
  tone: string;
  engine: "gemini" | "openai" | "windows_offline";
}): Promise<ProcessedAudioResult> {
  return invoke<ProcessedAudioResult>("generate_tts_audio", params);
}

export async function processUserAudio(params: {
  inputPath?: string | null;
  recordedBytes?: Uint8Array | null;
  recordedExt?: string | null;
  trimSilence: boolean;
  knownScript?: string | null;
}): Promise<ProcessedAudioResult> {
  return invoke<ProcessedAudioResult>("process_user_audio", {
    inputPath: params.inputPath ?? null,
    recordedBytes: params.recordedBytes ? Array.from(params.recordedBytes) : null,
    recordedExt: params.recordedExt ?? null,
    trimSilence: params.trimSilence,
    knownScript: params.knownScript ?? null,
  });
}

export async function aiAssembleProject(req: AssembleProjectRequest): Promise<SynkcutProject> {
  if (!isTauriRuntime()) {
    const now = new Date().toISOString();
    const totalMs = Math.max(6000, req.durationMs || 9000);
    const segments = [
      { role: "hook" as const, text: req.hookText },
      ...req.bodySegments.map((t) => ({ role: "body" as const, text: t })),
      { role: "cta" as const, text: req.ctaText },
    ];
    const perSeg = Math.round(totalMs / segments.length);
    return {
      version: "1.0",
      meta: {
        id: `proj_${Date.now()}`,
        name: req.projectTitle || "Konten Baru",
        format: req.format as SynkcutProject["meta"]["format"],
        aspectRatio: "9:16",
        fps: 30,
        createdAt: now,
        updatedAt: now,
      },
      globalStyle: {
        captionPreset: req.captionPreset as SynkcutProject["globalStyle"]["captionPreset"],
        accentColor: req.accentColor,
        showProgressBar: true,
        bgm: { preset: req.bgmPreset, volume: 0.24, autoDucking: req.autoDucking },
        safeZone: "tiktok_reels",
      },
      voiceover: {
        source: req.audioSource,
        audioPath: req.audioPath,
        trimSilence: req.trimSilence,
        words: req.words,
      },
      scenes: segments.map((s, i) => ({
        id: `scene_${i + 1}`,
        role: s.role,
        startMs: i * perSeg,
        endMs: i === segments.length - 1 ? totalMs : (i + 1) * perSeg,
        text: s.text,
        media: { path: req.footage[i % Math.max(1, req.footage.length)]?.path ?? null, trimStartMs: 0, fit: "cover" },
        motion: { preset: req.motionPreset as SynkcutProject["scenes"][number]["motion"]["preset"], intensity: 0.78 },
        transitionIn: { preset: (i === 0 ? "hard_cut" : req.transitionPreset) as SynkcutProject["scenes"][number]["transitionIn"]["preset"], durationMs: i === 0 ? 0 : 240 },
        sfx: req.autoSfx ? [{ preset: "whoosh_fast", offsetMs: 0, volume: 0.65 }] : [],
        overlays: [],
      })),
    };
  }
  return invoke<SynkcutProject>("ai_assemble_project", { req });
}

export async function aiCopilotPatch(
  project: SynkcutProject,
  instruction: string
): Promise<CopilotPatchResponse> {
  return invoke<CopilotPatchResponse>("ai_copilot_patch", { project, instruction });
}
