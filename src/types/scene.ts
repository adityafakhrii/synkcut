export type ContentFormat = "ad_promo" | "education" | "storytelling" | "review";

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
  type: "hook_headline" | "notification_banner" | "promo_badge" | "doodle_highlight";
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
