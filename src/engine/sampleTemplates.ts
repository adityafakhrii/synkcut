import type { ContentFormat, SynkcutProject } from "../types/scene";
import { createBreakdown3DPreset, createDefaultAiMotion } from "./aiMotionPresets";
import { rebuildWordsFromScenes } from "./sampleProject";

export interface SampleTemplate {
  id: string;
  title: string;
  format: ContentFormat;
  summary: string;
  captionLabel: string;
  motionLabel: string;
  durationLabel: string;
  isAiMotion?: boolean;
  roles: Array<"hook" | "body" | "cta">;
  buildProject: (customName?: string) => SynkcutProject;
}

function makeProjectId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export const BUILTIN_SAMPLES: SampleTemplate[] = [
  {
    id: "sample_ai_motion_internet",
    title: "Cara Kerja Internet (AI Motion)",
    format: "education",
    summary:
      "Tanpa footage kamera — full animasi 2D native: diagram alur DNS, grafik Edge CDN, terminal kode, & cerita stick-figure.",
    captionLabel: "Bold Pop",
    motionLabel: "AI Motion 2D (4 Engine)",
    durationLabel: "00:15.2",
    isAiMotion: true,
    roles: ["hook", "body", "body", "cta"],
    buildProject: (customName) => {
      const now = new Date().toISOString();
      const s1Motion = createDefaultAiMotion("flow_diagram", "carbon", "Cara Kerja Internet");
      const s2Motion = createDefaultAiMotion("motion_chart", "paper", "Waktu Muat Halaman");
      const s3Motion = createDefaultAiMotion("tech_cards", "blue", "Alur Request Browser");
      s3Motion.subtitle = "Dari lookup DNS sampai halaman dirender";
      if (s3Motion.techCards) s3Motion.techCards.layout = "terminal_code";
      const s4Motion = createDefaultAiMotion("stick_figure", "mint", "Analogi DNS Internet");

      const base: SynkcutProject = {
        version: "1.1",
        meta: {
          id: makeProjectId("proj"),
          name: customName || "Cara Kerja Internet (AI Motion)",
          format: "education",
          aspectRatio: "9:16",
          fps: 30,
          createdAt: now,
          updatedAt: now,
        },
        globalStyle: {
          captionPreset: "bold_pop",
          accentColor: "#38E59D",
          showProgressBar: true,
          bgm: { preset: "tech_modern", volume: 0.22, autoDucking: true },
          safeZone: "tiktok_reels",
        },
        voiceover: { source: "demo", audioPath: null, trimSilence: true, words: [] },
        scenes: [
          {
            id: "scene_1",
            role: "hook",
            startMs: 0,
            endMs: 3600,
            text: "Pernah kepikiran gimana satu klik bisa buka website dalam sekejap?",
            visualSource: "motion",
            aiMotion: s1Motion,
            media: { path: null, trimStartMs: 0, fit: "cover" },
            motion: { preset: "static_clean", intensity: 0.4 },
            transitionIn: { preset: "hard_cut", durationMs: 0 },
            sfx: [{ preset: "whoosh_fast", offsetMs: 0, volume: 0.6 }],
            overlays: [],
          },
          {
            id: "scene_2",
            role: "body",
            startMs: 3600,
            endMs: 7400,
            text: "Dengan Edge CDN waktu muat halaman turun drastis ke 68 milidetik.",
            visualSource: "motion",
            aiMotion: s2Motion,
            media: { path: null, trimStartMs: 0, fit: "cover" },
            motion: { preset: "static_clean", intensity: 0.4 },
            transitionIn: { preset: "pop_zoom", durationMs: 240 },
            sfx: [{ preset: "pop_text", offsetMs: 0, volume: 0.55 }],
            overlays: [],
          },
          {
            id: "scene_3",
            role: "body",
            startMs: 7400,
            endMs: 11200,
            text: "Di balik layar browser cukup jalankan empat langkah jaringan ini.",
            visualSource: "motion",
            aiMotion: s3Motion,
            media: { path: null, trimStartMs: 0, fit: "cover" },
            motion: { preset: "static_clean", intensity: 0.4 },
            transitionIn: { preset: "smooth_crossfade", durationMs: 240 },
            sfx: [{ preset: "keyboard_click", offsetMs: 0, volume: 0.55 }],
            overlays: [],
          },
          {
            id: "scene_4",
            role: "cta",
            startMs: 11200,
            endMs: 15200,
            text: "Singkatnya DNS itu seperti buku telepon raksasa internet yang serba cepat.",
            visualSource: "motion",
            aiMotion: s4Motion,
            media: { path: null, trimStartMs: 0, fit: "cover" },
            motion: { preset: "static_clean", intensity: 0.4 },
            transitionIn: { preset: "whip_pan", durationMs: 240 },
            sfx: [{ preset: "ding_notif", offsetMs: 0, volume: 0.6 }],
            overlays: [],
          },
        ],
      };
      base.voiceover.words = rebuildWordsFromScenes(base);
      return base;
    },
  },
  {
    id: "sample_ai_motion_3d_smartphone",
    title: "Bedah Isi Smartphone 3D",
    format: "review",
    summary:
      "Teardown 3D WebGL real-time 6 lapis komponen HP + perbandingan benchmark & kartu ringkasan teknis, 100% lokal.",
    captionLabel: "Neon Tech",
    motionLabel: "3D Breakdown + Chart",
    durationLabel: "00:12.6",
    isAiMotion: true,
    roles: ["hook", "body", "cta"],
    buildProject: (customName) => {
      const now = new Date().toISOString();
      const phone3d = createBreakdown3DPreset("smartphone");
      const chartSpec = createDefaultAiMotion("motion_chart", "carbon", "Efisiensi Baterai 5000mAh");
      if (chartSpec.chart) {
        chartSpec.chart.chartType = "bar";
        chartSpec.chart.data = [
          { label: "Chip Lama", value: 11 },
          { label: "Generasi Lalu", value: 15 },
          { label: "Flagship Baru", value: 21 },
        ];
        chartSpec.chart.suffix = " jam";
        chartSpec.chart.goodDirection = "up";
        chartSpec.chart.highlightIndex = 2;
      }
      const vsSpec = createDefaultAiMotion("tech_cards", "blue", "Kenapa Bisa Setipis 8mm?");
      vsSpec.subtitle = "Perbandingan arsitektur tumpukan internal";
      if (vsSpec.techCards) {
        vsSpec.techCards.layout = "comparison_split";
        vsSpec.techCards.leftTitle = "HP Lama";
        vsSpec.techCards.leftItems = ["PCB lebar 2 lapis", "Baterai terpisah tebal", "Frame plastik rongga"];
        vsSpec.techCards.rightTitle = "Flagship 3D";
        vsSpec.techCards.rightItems = ["Logic board bertingkat", "Sel Li-ion rapat 5000mAh", "Unibody titanium presisi"];
      }

      const base: SynkcutProject = {
        version: "1.1",
        meta: {
          id: makeProjectId("proj"),
          name: customName || "Bedah Isi Smartphone 3D",
          format: "review",
          aspectRatio: "9:16",
          fps: 30,
          createdAt: now,
          updatedAt: now,
        },
        globalStyle: {
          captionPreset: "neon_tech",
          accentColor: "#38E59D",
          showProgressBar: true,
          bgm: { preset: "tech_modern", volume: 0.24, autoDucking: true },
          safeZone: "tiktok_reels",
        },
        voiceover: { source: "demo", audioPath: null, trimSilence: true, words: [] },
        scenes: [
          {
            id: "scene_1",
            role: "hook",
            startMs: 0,
            endMs: 4800,
            text: "Pernah lihat enam lapisan komponen di dalam HP setipis delapan milimeter?",
            visualSource: "motion",
            aiMotion: {
              engine: "breakdown_3d",
              theme: "carbon",
              title: phone3d.title,
              subtitle: phone3d.subtitle,
              takeaway: phone3d.takeaway,
              breakdown3d: phone3d.config,
            },
            media: { path: null, trimStartMs: 0, fit: "cover" },
            motion: { preset: "static_clean", intensity: 0.4 },
            transitionIn: { preset: "hard_cut", durationMs: 0 },
            sfx: [{ preset: "impact_boom", offsetMs: 0, volume: 0.65 }],
            overlays: [],
          },
          {
            id: "scene_2",
            role: "body",
            startMs: 4800,
            endMs: 8800,
            text: "Berkat efisiensi chip baru, baterai lima ribu mAh tahan sampai dua puluh satu jam.",
            visualSource: "motion",
            aiMotion: chartSpec,
            media: { path: null, trimStartMs: 0, fit: "cover" },
            motion: { preset: "static_clean", intensity: 0.4 },
            transitionIn: { preset: "pop_zoom", durationMs: 240 },
            sfx: [{ preset: "whoosh_fast", offsetMs: 0, volume: 0.6 }],
            overlays: [],
          },
          {
            id: "scene_3",
            role: "cta",
            startMs: 8800,
            endMs: 12600,
            text: "Produk teknologi apa lagi yang mau kita bedah tiga dimensi besok?",
            visualSource: "motion",
            aiMotion: vsSpec,
            media: { path: null, trimStartMs: 0, fit: "cover" },
            motion: { preset: "static_clean", intensity: 0.4 },
            transitionIn: { preset: "whip_pan", durationMs: 240 },
            sfx: [{ preset: "ding_notif", offsetMs: 0, volume: 0.6 }],
            overlays: [],
          },
        ],
      };
      base.voiceover.words = rebuildWordsFromScenes(base);
      return base;
    },
  },
  {
    id: "sample_ad_promo",
    title: "Promo Produk Kilat",
    format: "ad_promo",
    summary: "Buka dengan notifikasi pop-up, lanjut demo cepat, tutup dengan promo CTA tegas.",
    captionLabel: "Bold Pop",
    motionLabel: "Zoom Punch",
    durationLabel: "00:09.0",
    roles: ["hook", "body", "cta"],
    buildProject: (customName) => {
      const now = new Date().toISOString();
      const base: SynkcutProject = {
        version: "1.0",
        meta: {
          id: makeProjectId("proj"),
          name: customName || "Promo Produk Kilat",
          format: "ad_promo",
          aspectRatio: "9:16",
          fps: 30,
          createdAt: now,
          updatedAt: now,
        },
        globalStyle: {
          captionPreset: "bold_pop",
          accentColor: "#38E59D",
          showProgressBar: true,
          bgm: { preset: "upbeat_promo", volume: 0.25, autoDucking: true },
          safeZone: "tiktok_reels",
        },
        voiceover: { source: "demo", audioPath: null, trimSilence: true, words: [] },
        scenes: [
          {
            id: "scene_1",
            role: "hook",
            startMs: 0,
            endMs: 3000,
            text: "Capek iklan boncos terus padahal produk lo sebenarnya bagus?",
            media: { path: null, trimStartMs: 0, fit: "cover" },
            motion: { preset: "zoom_punch", intensity: 0.85 },
            transitionIn: { preset: "hard_cut", durationMs: 0 },
            sfx: [{ preset: "impact_boom", offsetMs: 0, volume: 0.75 }],
            overlays: [
              {
                id: "ov_1",
                type: "notification_banner",
                title: "Order Masuk · Baru saja",
                text: "3 variasi video iklan baru langsung naik ROAS 2x",
                position: "top",
              },
            ],
          },
          {
            id: "scene_2",
            role: "body",
            startMs: 3000,
            endMs: 6500,
            text: "Cukup ganti tiga detik pertama dengan visual tajam dan subtitle sinkron.",
            media: { path: null, trimStartMs: 3000, fit: "cover" },
            motion: { preset: "smooth_ken_burns", intensity: 0.7 },
            transitionIn: { preset: "whip_pan", durationMs: 250 },
            sfx: [{ preset: "whoosh_fast", offsetMs: 0, volume: 0.65 }],
            overlays: [
              {
                id: "ov_2",
                type: "split_screen",
                text: "DEMO PRODUK · DETAIL",
                position: "center",
              },
            ],
          },
          {
            id: "scene_3",
            role: "cta",
            startMs: 6500,
            endMs: 9000,
            text: "Klik keranjang sekarang sebelum promo minggu ini berakhir!",
            media: { path: null, trimStartMs: 6500, fit: "cover" },
            motion: { preset: "zoom_punch", intensity: 0.75 },
            transitionIn: { preset: "pop_zoom", durationMs: 220 },
            sfx: [{ preset: "cash_register", offsetMs: 0, volume: 0.7 }],
            overlays: [
              {
                id: "ov_3",
                type: "promo_badge",
                text: "DISKON 40% HARI INI",
                position: "top",
              },
            ],
          },
        ],
      };
      base.voiceover.words = rebuildWordsFromScenes(base);
      return base;
    },
  },
  {
    id: "sample_education",
    title: "3 Tips Edukasi Cepat",
    format: "education",
    summary: "Ritme terstruktur untuk konten tips, tutorial singkat, dan edukasi audiens.",
    captionLabel: "Clean Minimal",
    motionLabel: "Ken Burns",
    durationLabel: "00:11.0",
    roles: ["hook", "body", "body", "cta"],
    buildProject: (customName) => {
      const now = new Date().toISOString();
      const base: SynkcutProject = {
        version: "1.0",
        meta: {
          id: makeProjectId("proj"),
          name: customName || "3 Tips Edukasi Cepat",
          format: "education",
          aspectRatio: "9:16",
          fps: 30,
          createdAt: now,
          updatedAt: now,
        },
        globalStyle: {
          captionPreset: "clean_minimal",
          accentColor: "#38BDF8",
          showProgressBar: true,
          bgm: { preset: "lofi_education", volume: 0.22, autoDucking: true },
          safeZone: "tiktok_reels",
        },
        voiceover: { source: "demo", audioPath: null, trimSilence: true, words: [] },
        scenes: [
          {
            id: "scene_1",
            role: "hook",
            startMs: 0,
            endMs: 2600,
            text: "Tiga kesalahan sepele yang bikin konten Reels lo sepi penonton.",
            media: { path: null, trimStartMs: 0, fit: "cover" },
            motion: { preset: "slide_reveal", intensity: 0.7 },
            transitionIn: { preset: "hard_cut", durationMs: 0 },
            sfx: [{ preset: "ding_notif", offsetMs: 0, volume: 0.6 }],
            overlays: [
              { id: "ov_edu_1", type: "hook_headline", text: "3 Kesalahan Bikin Reels Sepi", position: "top" },
            ],
          },
          {
            id: "scene_2",
            role: "body",
            startMs: 2600,
            endMs: 5600,
            text: "Pertama, pembukaan terlalu lama dan tanpa teks pengait di detik awal.",
            media: { path: null, trimStartMs: 2600, fit: "cover" },
            motion: { preset: "smooth_ken_burns", intensity: 0.65 },
            transitionIn: { preset: "hard_cut", durationMs: 0 },
            sfx: [{ preset: "pop_text", offsetMs: 0, volume: 0.55 }],
            overlays: [
              { id: "ov_edu_2", type: "doodle_highlight", text: "HOOK 3 DETIK WAJIB", position: "top" },
            ],
          },
          {
            id: "scene_3",
            role: "body",
            startMs: 5600,
            endMs: 8600,
            text: "Kedua, jeda napas dibiarkan kosong sehingga pacing terasa lambat.",
            media: { path: null, trimStartMs: 5600, fit: "cover" },
            motion: { preset: "smooth_ken_burns", intensity: 0.65 },
            transitionIn: { preset: "whip_pan", durationMs: 200 },
            sfx: [{ preset: "whoosh_soft", offsetMs: 0, volume: 0.55 }],
            overlays: [
              { id: "ov_edu_3", type: "promo_badge", text: "POIN #2 · PACING PADAT", position: "top" },
            ],
          },
          {
            id: "scene_4",
            role: "cta",
            startMs: 8600,
            endMs: 11000,
            text: "Save video ini biar nggak lupa pas ngedit konten berikutnya!",
            media: { path: null, trimStartMs: 8600, fit: "cover" },
            motion: { preset: "zoom_punch", intensity: 0.6 },
            transitionIn: { preset: "smooth_crossfade", durationMs: 220 },
            sfx: [{ preset: "ding_notif", offsetMs: 0, volume: 0.6 }],
            overlays: [
              { id: "ov_edu_4", type: "promo_badge", text: "SAVE & SHARE", position: "top" },
            ],
          },
        ],
      };
      base.voiceover.words = rebuildWordsFromScenes(base);
      return base;
    },
  },
  {
    id: "sample_storytelling",
    title: "Storytelling Editorial",
    format: "storytelling",
    summary: "Gaya tipografi serif rapi & gerak halus untuk cerita brand atau opini personal.",
    captionLabel: "Luxury Editorial",
    motionLabel: "Ken Burns",
    durationLabel: "00:09.5",
    roles: ["hook", "body", "cta"],
    buildProject: (customName) => {
      const now = new Date().toISOString();
      const base: SynkcutProject = {
        version: "1.0",
        meta: {
          id: makeProjectId("proj"),
          name: customName || "Storytelling Editorial",
          format: "storytelling",
          aspectRatio: "9:16",
          fps: 30,
          createdAt: now,
          updatedAt: now,
        },
        globalStyle: {
          captionPreset: "luxury_editorial",
          accentColor: "#F59E0B",
          showProgressBar: true,
          bgm: { preset: "cinematic_story", volume: 0.2, autoDucking: true },
          safeZone: "tiktok_reels",
        },
        voiceover: { source: "demo", audioPath: null, trimSilence: true, words: [] },
        scenes: [
          {
            id: "scene_1",
            role: "hook",
            startMs: 0,
            endMs: 3200,
            text: "Awalnya kami cuma jual sepuluh cup kopi sehari dari garasi rumah.",
            media: { path: null, trimStartMs: 0, fit: "cover" },
            motion: { preset: "smooth_ken_burns", intensity: 0.6 },
            transitionIn: { preset: "smooth_crossfade", durationMs: 300 },
            sfx: [],
            overlays: [],
          },
          {
            id: "scene_2",
            role: "body",
            startMs: 3200,
            endMs: 6800,
            text: "Semuanya berubah saat kami mulai konsisten bercerita lewat satu video pendek setiap pagi.",
            media: { path: null, trimStartMs: 3200, fit: "cover" },
            motion: { preset: "smooth_ken_burns", intensity: 0.7 },
            transitionIn: { preset: "smooth_crossfade", durationMs: 280 },
            sfx: [{ preset: "whoosh_soft", offsetMs: 0, volume: 0.45 }],
            overlays: [],
          },
          {
            id: "scene_3",
            role: "cta",
            startMs: 6800,
            endMs: 9500,
            text: "Menurut lo, cerita apa yang paling menarik untuk dibahas besok?",
            media: { path: null, trimStartMs: 6800, fit: "cover" },
            motion: { preset: "static_clean", intensity: 0.5 },
            transitionIn: { preset: "smooth_crossfade", durationMs: 260 },
            sfx: [],
            overlays: [
              { id: "ov_st_1", type: "promo_badge", text: "TULIS DI KOMENTAR", position: "top" },
            ],
          },
        ],
      };
      base.voiceover.words = rebuildWordsFromScenes(base);
      return base;
    },
  },
  {
    id: "sample_review",
    title: "Review & Unboxing Jujur",
    format: "review",
    summary: "Teks kinetik besar 2 kata per hentakan dengan tempo cepat untuk review gadget/produk.",
    captionLabel: "Kinetic Punch",
    motionLabel: "Shake Impact",
    durationLabel: "00:09.0",
    roles: ["hook", "body", "cta"],
    buildProject: (customName) => {
      const now = new Date().toISOString();
      const base: SynkcutProject = {
        version: "1.0",
        meta: {
          id: makeProjectId("proj"),
          name: customName || "Review & Unboxing Jujur",
          format: "review",
          aspectRatio: "9:16",
          fps: 30,
          createdAt: now,
          updatedAt: now,
        },
        globalStyle: {
          captionPreset: "kinetic_punch",
          accentColor: "#34D399",
          showProgressBar: true,
          bgm: { preset: "tech_modern", volume: 0.24, autoDucking: true },
          safeZone: "tiktok_reels",
        },
        voiceover: { source: "demo", audioPath: null, trimSilence: true, words: [] },
        scenes: [
          {
            id: "scene_1",
            role: "hook",
            startMs: 0,
            endMs: 2800,
            text: "Jujur, awalnya gue ragu barang seharga ini beneran awet.",
            media: { path: null, trimStartMs: 0, fit: "cover" },
            motion: { preset: "shake_impact", intensity: 0.8 },
            transitionIn: { preset: "hard_cut", durationMs: 0 },
            sfx: [{ preset: "impact_boom", offsetMs: 0, volume: 0.7 }],
            overlays: [
              { id: "ov_rev_1", type: "doodle_highlight", text: "HONEST REVIEW 3 MINGGU", position: "top" },
            ],
          },
          {
            id: "scene_2",
            role: "body",
            startMs: 2800,
            endMs: 6300,
            text: "Tapi setelah tiga minggu dipakai kerja harian, performanya stabil dan super ringan.",
            media: { path: null, trimStartMs: 2800, fit: "cover" },
            motion: { preset: "zoom_punch", intensity: 0.75 },
            transitionIn: { preset: "glitch_flash", durationMs: 200 },
            sfx: [{ preset: "glitch_zap", offsetMs: 0, volume: 0.6 }],
            overlays: [
              { id: "ov_rev_2", type: "split_screen", text: "TES 3 MINGGU · DETAIL", position: "center" },
            ],
          },
          {
            id: "scene_3",
            role: "cta",
            startMs: 6300,
            endMs: 9000,
            text: "Skor akhir sembilan per sepuluh, cek link di bio kalau penasaran.",
            media: { path: null, trimStartMs: 6300, fit: "cover" },
            motion: { preset: "zoom_punch", intensity: 0.7 },
            transitionIn: { preset: "pop_zoom", durationMs: 200 },
            sfx: [{ preset: "ding_notif", offsetMs: 0, volume: 0.65 }],
            overlays: [
              { id: "ov_rev_3", type: "promo_badge", text: "SKOR 9/10 · WORTH IT", position: "top" },
            ],
          },
        ],
      };
      base.voiceover.words = rebuildWordsFromScenes(base);
      return base;
    },
  },
  {
    id: "sample_before_after",
    title: "Testimoni & Before–After",
    format: "ad_promo",
    summary: "Buka dengan split-screen perbandingan, kuatkan bukti chat notif, tutup dengan CTA kilat.",
    captionLabel: "Neon Tech",
    motionLabel: "Slide Reveal",
    durationLabel: "00:09.0",
    roles: ["hook", "body", "cta"],
    buildProject: (customName) => {
      const now = new Date().toISOString();
      const base: SynkcutProject = {
        version: "1.0",
        meta: {
          id: makeProjectId("proj"),
          name: customName || "Testimoni & Before–After",
          format: "ad_promo",
          aspectRatio: "9:16",
          fps: 30,
          createdAt: now,
          updatedAt: now,
        },
        globalStyle: {
          captionPreset: "neon_tech",
          accentColor: "#38E59D",
          showProgressBar: true,
          bgm: { preset: "trendy_funk", volume: 0.24, autoDucking: true },
          safeZone: "tiktok_reels",
        },
        voiceover: { source: "demo", audioPath: null, trimSilence: true, words: [] },
        scenes: [
          {
            id: "scene_1",
            role: "hook",
            startMs: 0,
            endMs: 3000,
            text: "Lihat bedanya sebelum dan sesudah pakai racikan visual ini dalam dua menit.",
            media: { path: null, secondaryPath: null, trimStartMs: 0, fit: "cover" },
            motion: { preset: "slide_reveal", intensity: 0.78 },
            transitionIn: { preset: "hard_cut", durationMs: 0 },
            sfx: [{ preset: "impact_boom", offsetMs: 0, volume: 0.7 }],
            overlays: [
              {
                id: "ov_ba_1",
                type: "split_screen",
                text: "BEFORE VS AFTER",
                position: "center",
              },
            ],
          },
          {
            id: "scene_2",
            role: "body",
            startMs: 3000,
            endMs: 6200,
            text: "Puluhan pelanggan langsung kirim chat repeat order di minggu pertama.",
            media: { path: null, secondaryPath: null, trimStartMs: 3000, fit: "cover" },
            motion: { preset: "zoom_punch", intensity: 0.72 },
            transitionIn: { preset: "whip_pan", durationMs: 240 },
            sfx: [{ preset: "ding_notif", offsetMs: 0, volume: 0.65 }],
            overlays: [
              {
                id: "ov_ba_2",
                type: "notification_banner",
                title: "Chat Pembeli · Baru saja",
                text: "Kak repeat order 3 paket lagi ya, hasilnya mantap banget!",
                position: "top",
              },
            ],
          },
          {
            id: "scene_3",
            role: "cta",
            startMs: 6200,
            endMs: 9000,
            text: "Ambil promo bundel hari ini sebelum stok batch sekarang habis!",
            media: { path: null, secondaryPath: null, trimStartMs: 6200, fit: "cover" },
            motion: { preset: "zoom_punch", intensity: 0.76 },
            transitionIn: { preset: "pop_zoom", durationMs: 220 },
            sfx: [{ preset: "cash_register", offsetMs: 0, volume: 0.7 }],
            overlays: [
              {
                id: "ov_ba_3",
                type: "promo_badge",
                text: "STOK TERBATAS · ORDER SEKARANG",
                position: "top",
              },
            ],
          },
        ],
      };
      base.voiceover.words = rebuildWordsFromScenes(base);
      return base;
    },
  },
];

export function createBlankProjectForFormat(format: ContentFormat): SynkcutProject {
  const sample = BUILTIN_SAMPLES.find((s) => s.format === format) ?? BUILTIN_SAMPLES[0];
  const labelMap: Record<ContentFormat, string> = {
    ad_promo: "Iklan Baru",
    education: "Edukasi Baru",
    storytelling: "Cerita Baru",
    review: "Review Baru",
  };
  return sample.buildProject(labelMap[format]);
}
