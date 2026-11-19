export type ContentFormat = "ad_promo" | "education" | "storytelling" | "review";

export type ByokProvider = "gemini" | "openai" | "openrouter";

export type CaptionPreset =
  | "bold_pop"
  | "clean_minimal"
  | "kinetic_punch"
  | "luxury_editorial"
  | "neon_tech";

export type MotionPreset =
  | "zoom_punch"
  | "smooth_ken_burns"
  | "shake_impact"
  | "slide_reveal"
  | "static_clean";

export type TransitionPreset =
  | "hard_cut"
  | "whip_pan"
  | "pop_zoom"
  | "glitch_flash"
  | "smooth_crossfade";

export type SceneRole = "hook" | "body" | "cta";

export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

export interface SceneOverlay {
  id: string;
  type:
    | "hook_headline"
    | "notification_banner"
    | "promo_badge"
    | "doodle_highlight"
    | "split_screen";
  title?: string;
  text: string;
  position: "top" | "center" | "bottom";
}

export interface SceneSfx {
  preset: string;
  offsetMs: number;
  volume: number;
}

export interface SceneItem {
  id: string;
  role: SceneRole;
  startMs: number;
  endMs: number;
  text: string;
  media: {
    path: string | null;
    secondaryPath?: string | null;
    trimStartMs: number;
    fit: "cover" | "contain";
  };
  motion: {
    preset: MotionPreset;
    intensity: number;
  };
  transitionIn: {
    preset: TransitionPreset;
    durationMs: number;
  };
  sfx: SceneSfx[];
  overlays: SceneOverlay[];
}

export interface SynkcutProject {
  version: "1.0";
  meta: {
    id: string;
    name: string;
    format: ContentFormat;
    aspectRatio: "9:16";
    fps: 30 | 60;
    createdAt?: string;
    updatedAt?: string;
  };
  globalStyle: {
    captionPreset: CaptionPreset;
    accentColor: string;
    showProgressBar: boolean;
    bgm: {
      preset: string;
      volume: number;
      autoDucking: boolean;
    };
    safeZone: "tiktok_reels" | "none";
  };
  voiceover: {
    source: "tts" | "recorded" | "demo";
    audioPath: string | null;
    trimSilence: boolean;
    words: WordTimestamp[];
  };
  scenes: SceneItem[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  format: ContentFormat;
  captionPreset: CaptionPreset;
  accentColor: string;
  hookText: string;
  firstOverlayType: string | null;
  firstOverlayTitle: string | null;
  firstOverlayText: string | null;
  sceneCount: number;
  durationMs: number;
  hasFootage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderKeyInfo {
  configured: boolean;
  maskedKey: string | null;
}

export interface ByokStatus {
  activeProvider: ByokProvider;
  onboardingCompleted: boolean;
  providers: Record<ByokProvider, ProviderKeyInfo>;
}

export interface ConnectionTestResult {
  ok: boolean;
  provider: ByokProvider;
  latencyMs: number;
  message: string;
  detail: string | null;
}

export const CONTENT_FORMAT_LABELS: Record<
  ContentFormat,
  { label: string; shortDesc: string; structure: string }
> = {
  ad_promo: {
    label: "Iklan / Promo",
    shortDesc: "Jualan produk, flash sale, atau penawaran jasa",
    structure: "Hook Masalah → Demo & Bukti → CTA",
  },
  education: {
    label: "Edukasi / Tips",
    shortDesc: "Tutorial singkat, poin 1-2-3, atau insight cepat",
    structure: "Hook Penasaran → Poin Inti → Save / Share",
  },
  storytelling: {
    label: "Storytelling",
    shortDesc: "Cerita pengalaman, opini tajam, atau studi kasus",
    structure: "Hook Relatable → Cerita → Payoff",
  },
  review: {
    label: "Review / Unboxing",
    shortDesc: "Kesan pertama, detail produk, dan rekomendasi jujur",
    structure: "Hook Kesan → Highlight → Verdict",
  },
};
