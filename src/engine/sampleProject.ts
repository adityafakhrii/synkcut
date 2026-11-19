import type { SynkcutProject, WordTimestamp } from "../types/scene";

function buildWordTimestamps(
  segments: Array<{ text: string; startMs: number; endMs: number }>
): WordTimestamp[] {
  const words: WordTimestamp[] = [];
  for (const seg of segments) {
    const tokens = seg.text
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length === 0) continue;
    const totalDuration = seg.endMs - seg.startMs;
    const step = totalDuration / tokens.length;
    tokens.forEach((word, idx) => {
      words.push({
        word,
        startMs: Math.round(seg.startMs + idx * step),
        endMs: Math.round(seg.startMs + (idx + 1) * step),
      });
    });
  }
  return words;
}

export function createSampleProject(): SynkcutProject {
  const scenes: SynkcutProject["scenes"] = [
    {
      id: "scene_hook",
      role: "hook",
      startMs: 0,
      endMs: 3000,
      text: "Capek ngedit video iklan berjam-jam tapi hasilnya gitu-gitu aja?",
      media: { path: null, trimStartMs: 0, fit: "cover" },
      motion: { preset: "zoom_punch", intensity: 0.85 },
      transitionIn: { preset: "hard_cut", durationMs: 0 },
      sfx: [{ preset: "impact_boom", offsetMs: 0, volume: 0.75 }],
      overlays: [
        {
          id: "ov_notif_1",
          type: "notification_banner",
          title: "Synkcut Studio · Baru saja",
          text: "3 variasi video iklan siap tayang dalam 2 menit",
          position: "top",
        },
      ],
    },
    {
      id: "scene_body",
      role: "body",
      startMs: 3000,
      endMs: 6500,
      text: "Cukup masukkan footage lokal, klik preset motion, dan suara otomatis sinkron.",
      media: { path: null, trimStartMs: 3000, fit: "cover" },
      motion: { preset: "smooth_ken_burns", intensity: 0.7 },
      transitionIn: { preset: "whip_pan", durationMs: 260 },
      sfx: [{ preset: "whoosh_fast", offsetMs: 0, volume: 0.65 }],
      overlays: [
        {
          id: "ov_badge_body",
          type: "promo_badge",
          text: "LOCAL RENDER · 0 CREDIT BURN",
          position: "top",
        },
      ],
    },
    {
      id: "scene_cta",
      role: "cta",
      startMs: 6500,
      endMs: 9000,
      text: "Coba Synkcut sekarang, produksi konten sepuluh kali lebih singkat!",
      media: { path: null, trimStartMs: 6500, fit: "cover" },
      motion: { preset: "zoom_punch", intensity: 0.75 },
      transitionIn: { preset: "pop_zoom", durationMs: 240 },
      sfx: [{ preset: "riser", offsetMs: 0, volume: 0.7 }],
      overlays: [
        {
          id: "ov_badge_cta",
          type: "promo_badge",
          text: "SYNKCUT v0.1 PoC · 1080×1920",
          position: "top",
        },
      ],
    },
  ];

  return {
    version: "1.0",
    meta: {
      id: "poc_sample_01",
      name: "Demo PoC — Promo Synkcut 9:16",
      format: "ad_promo",
      aspectRatio: "9:16",
      fps: 30,
    },
    globalStyle: {
      captionPreset: "bold_pop",
      accentColor: "#38E59D",
      showProgressBar: true,
      bgm: {
        preset: "upbeat_promo",
        volume: 0.25,
        autoDucking: true,
      },
      safeZone: "tiktok_reels",
    },
    voiceover: {
      source: "demo",
      audioPath: null,
      trimSilence: true,
      words: buildWordTimestamps(
        scenes.map((s) => ({ text: s.text, startMs: s.startMs, endMs: s.endMs }))
      ),
    },
    scenes,
  };
}

export function rebuildWordsFromScenes(project: SynkcutProject): WordTimestamp[] {
  return buildWordTimestamps(
    project.scenes.map((s) => ({ text: s.text, startMs: s.startMs, endMs: s.endMs }))
  );
}

export function getProjectDurationMs(project: SynkcutProject): number {
  if (project.scenes.length === 0) return 0;
  return Math.max(...project.scenes.map((s) => s.endMs));
}
