import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  AiMotionTheme,
  ByokProvider,
  ByokStatus,
  ConnectionTestResult,
  CustomDesignDirection,
  MotionSkillInfo,
  ProjectStyleReference,
  ProjectSummary,
  StoryboardBeat,
  SynkcutProject,
  WordTimestamp,
} from "../types/scene";
import { createDefaultAiMotion } from "../engine/aiMotionPresets";
import { normalizeProject } from "../engine/sceneOps";

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

export interface FootageFrameSample {
  timestampMs: number;
  dataUrl: string;
}

export async function probeMedia(path: string): Promise<MediaProbeInfo> {
  return invoke<MediaProbeInfo>("probe_media", { path });
}

export async function extractThumbnails(path: string, count = 2): Promise<string[]> {
  return invoke<string[]>("extract_thumbnails", { path, count });
}

export async function extractFootageFrames(
  path: string,
  count = 4
): Promise<FootageFrameSample[]> {
  if (!isTauriRuntime()) return [];
  return invoke<FootageFrameSample[]>("extract_footage_frames", { path, count });
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
      gemini: { configured: false, maskedKey: null, model: "gemini-3.5-flash-lite", baseUrl: null },
      openai: { configured: false, maskedKey: null, model: "gpt-4.1-mini", baseUrl: null },
      openrouter: {
        configured: false,
        maskedKey: null,
        model: "google/gemini-3-flash-preview",
        baseUrl: null,
      },
      custom: { configured: false, maskedKey: null, model: "", baseUrl: null },
    },
  };
  try {
    const raw = localStorage.getItem(BROWSER_BYOK_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      ...fallback,
      ...parsed,
      providers: {
        ...fallback.providers,
        ...(parsed.providers || {}),
      },
    };
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
  return saveProviderConfig({ provider, apiKey, setActive });
}

export async function saveProviderConfig(params: {
  provider: ByokProvider;
  apiKey?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  setActive?: boolean;
}): Promise<ByokStatus> {
  if (!isTauriRuntime()) {
    const cur = readBrowserByok();
    const prevInfo = cur.providers[params.provider] ?? {
      configured: false,
      maskedKey: null,
      model: "",
      baseUrl: null,
    };
    const trimmedKey = params.apiKey?.trim() ?? "";
    const masked = trimmedKey
      ? trimmedKey.length <= 8
        ? "••••••••"
        : `${trimmedKey.slice(0, 4)}••••${trimmedKey.slice(-4)}`
      : prevInfo.maskedKey;
    const nextModel =
      params.model !== undefined ? (params.model?.trim() ?? "") : (prevInfo.model ?? "");
    const nextBaseUrl =
      params.baseUrl !== undefined ? (params.baseUrl?.trim() || null) : (prevInfo.baseUrl ?? null);
    const configured =
      params.provider === "custom"
        ? Boolean(nextBaseUrl && nextModel)
        : Boolean(trimmedKey || prevInfo.configured);

    const next: ByokStatus = {
      ...cur,
      activeProvider: params.setActive === false ? cur.activeProvider : params.provider,
      onboardingCompleted: true,
      providers: {
        ...cur.providers,
        [params.provider]: {
          configured,
          maskedKey: masked,
          model: nextModel,
          baseUrl: nextBaseUrl,
        },
      },
    };
    localStorage.setItem(BROWSER_BYOK_KEY, JSON.stringify(next));
    return next;
  }
  return invoke<ByokStatus>("save_provider_config", {
    provider: params.provider,
    apiKey: params.apiKey?.trim() ? params.apiKey.trim() : null,
    model: params.model !== undefined ? params.model : null,
    baseUrl: params.baseUrl !== undefined ? params.baseUrl : null,
    setActive: params.setActive ?? true,
  });
}

export async function fetchProviderModels(params: {
  provider: ByokProvider;
  apiKey?: string | null;
  baseUrl?: string | null;
}): Promise<string[]> {
  if (!isTauriRuntime()) {
    if (params.provider === "gemini") {
      return [
        "gemini-3.5-flash-lite",
        "gemini-3-flash-preview",
        "gemini-3.1-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-3.6-flash",
      ];
    }
    if (params.provider === "openai") {
      return ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1", "gpt-5-mini"];
    }
    if (params.provider === "openrouter") {
      return [
        "google/gemini-3.8-flash",
        "openai/gpt-4.1-mini",
        "openrouter/free",
        "anthropic/claude-sonnet-4",
      ];
    }
    return ["deepseek-chat", "llama-3.3-70b-versatile", "qwen2.5:14b"];
  }
  return invoke<string[]>("fetch_provider_models", {
    provider: params.provider,
    apiKey: params.apiKey?.trim() ? params.apiKey.trim() : null,
    baseUrl: params.baseUrl?.trim() ? params.baseUrl.trim() : null,
  });
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
        [provider]: {
          configured: false,
          maskedKey: null,
          model: provider === "custom" ? "" : cur.providers[provider]?.model,
          baseUrl: null,
        },
      },
    };
    localStorage.setItem(BROWSER_BYOK_KEY, JSON.stringify(next));
    return next;
  }
  return invoke<ByokStatus>("delete_byok_key", { provider });
}

export async function testByokConnection(
  provider: ByokProvider,
  apiKey?: string,
  model?: string,
  baseUrl?: string
): Promise<ConnectionTestResult> {
  if (!isTauriRuntime()) {
    const ok =
      provider === "custom"
        ? Boolean(baseUrl?.trim() && model?.trim())
        : Boolean(apiKey && apiKey.trim().length >= 8);
    return {
      ok,
      provider,
      latencyMs: 42,
      message: ok
        ? "Mode preview browser: konfigurasi valid (tes koneksi penuh berjalan di desktop app)."
        : provider === "custom"
          ? "Isi Base URL dan Model ID terlebih dahulu."
          : "API Key terlalu pendek.",
      detail: "Browser preview",
      resolvedModel: model?.trim() || null,
    };
  }
  return invoke<ConnectionTestResult>("test_byok_connection", {
    provider,
    apiKey: apiKey?.trim() ? apiKey.trim() : null,
    model: model?.trim() ? model.trim() : null,
    baseUrl: baseUrl?.trim() ? baseUrl.trim() : null,
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
  frameTimestampsMs?: number[];
}

export interface StyleReferenceResult {
  sourceType: "youtube" | "images" | "local_video" | "url" | "prompt";
  url?: string | null;
  title: string;
  thumbnails: string[];
  styleDnaSummary: string;
  suggestedTheme: AiMotionTheme;
  suggestedCaption: SynkcutProject["globalStyle"]["captionPreset"];
  suggestedAccent: string;
  suggestedEngines: string[];
  layerUsed: string;
  logoDataUrl?: string | null;
  brandHeadings?: string[];
  brandColors?: string[];
  customDesign: CustomDesignDirection;
}

function makeBrowserFallbackCustomDesign(
  title: string,
  sampledColors?: string[]
): CustomDesignDirection {
  const bgTop = sampledColors?.[0] || "#0C1018";
  const accentPrimary = sampledColors?.[1] || "#38E59D";
  const accentSecondary = sampledColors?.[2] || "#F59E0B";
  return {
    name: title.slice(0, 28) || "Custom Studio Design",
    summary:
      "Arahan desain kustom dengan palet kontras tinggi, kartu kaca bersih, dan ritme 9:16 dinamis.",
    artDirectionNotes: "Gunakan palet kustom dari referensi dengan tipografi tajam & pacing cepat.",
    isLight: false,
    palette: {
      bgTop,
      bgBottom: "#161E2E",
      surfaceBg: "rgba(20,25,36,0.88)",
      surfaceBorder: "rgba(255,255,255,0.16)",
      textPrimary: "#F5F7FA",
      textSecondary: "#9BA6BA",
      accentPrimary,
      accentSecondary,
      accentInk: "#07140E",
    },
    typography: {
      headingFont: "sans",
      bodyFont: "sans",
      captionFont: "sans",
      captionUppercase: true,
    },
    visualStyle: {
      backgroundPattern: "aurora",
      cardStyle: "glass",
      cornerStyle: "rounded",
      captionLook: "bold_outline",
    },
    pacing: "balanced",
    preferredMotion: "zoom_punch",
    preferredTransition: "pop_zoom",
    preferredEngines: ["flow_diagram", "tech_cards", "motion_chart"],
  };
}

export async function analyzeDesignReference(req: {
  sourceType: "images" | "url" | "youtube" | "local_video" | "prompt";
  title?: string | null;
  url?: string | null;
  designPrompt?: string | null;
  thumbnails: string[];
  sampledColors?: string[];
}): Promise<StyleReferenceResult> {
  if (!isTauriRuntime()) {
    const title = req.title || req.url || req.designPrompt?.slice(0, 32) || "Desain Custom";
    const customDesign = makeBrowserFallbackCustomDesign(title, req.sampledColors);
    return {
      sourceType: req.sourceType,
      url: req.url ?? null,
      title,
      thumbnails: req.thumbnails.slice(0, 4),
      styleDnaSummary: customDesign.summary,
      suggestedTheme: customDesign.isLight ? "paper" : "carbon",
      suggestedCaption: "bold_pop",
      suggestedAccent: customDesign.palette.accentPrimary,
      suggestedEngines: customDesign.preferredEngines,
      layerUsed: "custom_ai",
      customDesign,
    };
  }
  return invoke<StyleReferenceResult>("analyze_design_reference", {
    req: {
      sourceType: req.sourceType,
      title: req.title ?? null,
      url: req.url ?? null,
      designPrompt: req.designPrompt ?? null,
      thumbnails: req.thumbnails,
      sampledColors: req.sampledColors ?? [],
    },
  });
}

export async function extractYoutubeStyleReference(url: string): Promise<StyleReferenceResult> {
  return analyzeDesignReference({
    sourceType: "url",
    url,
    thumbnails: [],
  });
}

export async function analyzeStyleReference(req: {
  sourceType: "images" | "local_video";
  title?: string | null;
  url?: string | null;
  thumbnails: string[];
}): Promise<StyleReferenceResult> {
  return analyzeDesignReference({
    sourceType: req.sourceType,
    title: req.title ?? null,
    url: req.url ?? null,
    thumbnails: req.thumbnails,
  });
}

export interface AssembleProjectRequest {
  projectTitle: string;
  format: string;
  hookText: string;
  bodySegments: string[];
  ctaText: string;
  rawScript?: string | null;
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
  visualMode?: "motion" | "footage" | "hybrid";
  motionTheme?: AiMotionTheme;
  preferredEngines?: string[];
  styleReference?: ProjectStyleReference | null;
  customDesign?: CustomDesignDirection | null;
  autoGenerateVoiceover?: boolean;
  ttsEngine?: "gemini" | "openai" | "windows_offline" | "auto";
  ttsVoice?: string;
  ttsTone?: string;
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
  visualMode?: "motion" | "footage" | "hybrid";
  styleReferenceSummary?: string | null;
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
  engine: "auto" | "gemini" | "openai" | "windows_offline";
}): Promise<ProcessedAudioResult> {
  if (!isTauriRuntime()) {
    const wordsRaw = params.text.trim().split(/\s+/).filter(Boolean);
    const dur = Math.max(4000, wordsRaw.length * 380);
    const step = dur / Math.max(1, wordsRaw.length);
    return {
      audioPath: "",
      durationMs: dur,
      transcript: params.text.trim(),
      words: wordsRaw.map((w, i) => ({
        word: w,
        startMs: Math.round(i * step),
        endMs: Math.round((i + 1) * step),
      })),
      providerUsed: "Browser Preview Voiceover",
      silenceTrimmed: false,
    };
  }
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
    const vMode = req.visualMode || "footage";
    const theme = req.motionTheme || "carbon";
    const engines = (
      req.preferredEngines && req.preferredEngines.length > 0
        ? req.preferredEngines
        : ["flow_diagram", "motion_chart", "tech_cards", "stick_figure"]
    ) as Array<"flow_diagram" | "motion_chart" | "tech_cards" | "stick_figure" | "breakdown_3d">;

    return {
      version: vMode === "footage" && !req.styleReference ? "1.0" : "1.1",
      meta: {
        id: `proj_${Date.now()}`,
        name: req.projectTitle || "Konten Baru",
        format: req.format as SynkcutProject["meta"]["format"],
        aspectRatio: "9:16",
        fps: 30,
        createdAt: now,
        updatedAt: now,
      },
      styleReference: req.styleReference ?? null,
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
      scenes: segments.map((s, i) => {
        const useMotion =
          vMode === "motion" || (vMode === "hybrid" && (req.footage.length === 0 || i % 2 === 1));
        return {
          id: `scene_${i + 1}`,
          role: s.role,
          startMs: i * perSeg,
          endMs: i === segments.length - 1 ? totalMs : (i + 1) * perSeg,
          text: s.text,
          visualSource: useMotion ? "motion" : "footage",
          aiMotion: useMotion
            ? createDefaultAiMotion(engines[i % engines.length], theme, s.text)
            : null,
          media: {
            path: useMotion ? null : req.footage[i % Math.max(1, req.footage.length)]?.path ?? null,
            trimStartMs: 0,
            fit: "cover",
          },
          motion: {
            preset: (useMotion ? "static_clean" : req.motionPreset) as SynkcutProject["scenes"][number]["motion"]["preset"],
            intensity: useMotion ? 0.4 : 0.78,
          },
          transitionIn: {
            preset: (i === 0 ? "hard_cut" : req.transitionPreset) as SynkcutProject["scenes"][number]["transitionIn"]["preset"],
            durationMs: i === 0 ? 0 : 240,
          },
          sfx: req.autoSfx ? [{ preset: "whoosh_fast", offsetMs: 0, volume: 0.65 }] : [],
          overlays: [],
        };
      }),
    };
  }
  const raw = await invoke<SynkcutProject>("ai_assemble_project", { req });
  return normalizeProject(raw);
}

export async function aiCopilotPatch(
  project: SynkcutProject,
  instruction: string,
  selectedSceneId?: string | null
): Promise<CopilotPatchResponse> {
  const res = await invoke<CopilotPatchResponse>("ai_copilot_patch", {
    project,
    instruction,
    selectedSceneId: selectedSceneId ?? null,
  });
  return {
    ...res,
    project: normalizeProject(res.project, project),
  };
}

/* ---------------- v2.0 Freeform AI Motion, Storyboard, Motion Skills & Remotion Export ---------------- */

export async function listMotionSkills(): Promise<MotionSkillInfo[]> {
  if (!isTauriRuntime()) return [];
  return invoke<MotionSkillInfo[]>("list_motion_skills");
}

export async function toggleMotionSkill(
  skillId: string,
  enabled: boolean
): Promise<MotionSkillInfo[]> {
  if (!isTauriRuntime()) return [];
  return invoke<MotionSkillInfo[]>("toggle_motion_skill", { skillId, enabled });
}

export async function saveCustomMotionSkill(params: {
  name: string;
  category?: string | null;
  summary?: string | null;
  source?: string | null;
  content: string;
}): Promise<MotionSkillInfo[]> {
  if (!isTauriRuntime()) return [];
  return invoke<MotionSkillInfo[]>("save_custom_motion_skill", {
    name: params.name,
    category: params.category ?? null,
    summary: params.summary ?? null,
    source: params.source ?? null,
    content: params.content,
  });
}

export async function importMotionSkillUrl(url: string): Promise<MotionSkillInfo[]> {
  if (!isTauriRuntime()) return [];
  return invoke<MotionSkillInfo[]>("import_motion_skill_url", { url });
}

export async function deleteCustomMotionSkill(skillId: string): Promise<MotionSkillInfo[]> {
  if (!isTauriRuntime()) return [];
  return invoke<MotionSkillInfo[]>("delete_custom_motion_skill", { skillId });
}

export interface PlanStoryboardResponse {
  beats: StoryboardBeat[];
  providerUsed: string;
}

export async function aiPlanStoryboard(req: {
  projectTitle: string;
  format: string;
  fullScript: string;
  durationMs: number;
  words: WordTimestamp[];
  customDesign?: CustomDesignDirection | null;
  styleReference?: ProjectStyleReference | null;
}): Promise<PlanStoryboardResponse> {
  if (!isTauriRuntime()) {
    const sentences = req.fullScript
      .split(/(?<=[.!?\n])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const list = sentences.length > 0 ? sentences : [req.fullScript.trim()];
    const totalMs = Math.max(4000, req.durationMs || list.length * 3200);
    const per = Math.round(totalMs / list.length);
    return {
      providerUsed: "browser preview",
      beats: list.map((txt, idx) => ({
        id: `beat_${idx + 1}`,
        role: idx === 0 ? "hook" : idx === list.length - 1 ? "cta" : "body",
        startMs: idx * per,
        endMs: idx === list.length - 1 ? totalMs : (idx + 1) * per,
        text: txt,
        title: txt.split(/\s+/).slice(0, 4).join(" "),
        visualConcept: `Ilustrasi & animasi kustom untuk: ${txt}`,
        emotionalIntent: idx === 0 ? "bold" : "playful",
        skillsUsed: ["motion-craft-physics", "procedural-illustration-svg"],
        transitionIn: idx === 0 ? "hard_cut" : "pop_zoom",
        sfx: idx === 0 ? "impact_boom" : "whoosh_fast",
      })),
    };
  }
  return invoke<PlanStoryboardResponse>("ai_plan_storyboard", {
    req: {
      projectTitle: req.projectTitle,
      format: req.format,
      fullScript: req.fullScript,
      durationMs: req.durationMs,
      words: req.words,
      customDesign: req.customDesign ?? null,
      styleReference: req.styleReference ?? null,
    },
  });
}

export async function aiGenerateBeatCodes(req: {
  projectTitle: string;
  format: string;
  beats: StoryboardBeat[];
  words: WordTimestamp[];
  customDesign?: CustomDesignDirection | null;
  styleReference?: ProjectStyleReference | null;
  audioPath: string | null;
  audioSource: "tts" | "recorded" | "demo";
  trimSilence: boolean;
  captionPreset: string;
  accentColor: string;
  bgmPreset: string;
  autoDucking: boolean;
  autoSfx: boolean;
  footage: FootageInputItem[];
  visualMode?: "motion" | "footage" | "hybrid";
}): Promise<SynkcutProject> {
  const raw = await invoke<SynkcutProject>("ai_generate_beat_codes", {
    req: {
      ...req,
      customDesign: req.customDesign ?? null,
      styleReference: req.styleReference ?? null,
    },
  });
  return normalizeProject(raw);
}

export async function aiRepairBeatCode(req: {
  beat: StoryboardBeat;
  brokenCode: string;
  errorMessage: string;
  customDesign?: CustomDesignDirection | null;
  hasBrandLogo: boolean;
}): Promise<{ code: string; providerUsed: string }> {
  return invoke<{ code: string; providerUsed: string }>("ai_repair_beat_code", {
    req: {
      beat: req.beat,
      brokenCode: req.brokenCode,
      errorMessage: req.errorMessage,
      customDesign: req.customDesign ?? null,
      hasBrandLogo: req.hasBrandLogo,
    },
  });
}

export async function pickRemotionExportFolder(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Pilih Folder Tujuan Export Proyek Remotion (.tsx)",
  });
  return typeof selected === "string" ? selected : null;
}

export async function exportRemotionProject(params: {
  targetDir: string;
  files: Array<{ relativePath: string; content: string }>;
  audioPath?: string | null;
}): Promise<string> {
  return invoke<string>("export_remotion_project", {
    targetDir: params.targetDir,
    files: params.files,
    audioPath: params.audioPath ?? null,
  });
}
