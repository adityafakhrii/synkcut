import type { AiMotionEngine, AiMotionSpec, AiMotionTheme } from "../types/scene";

export const AI_MOTION_ENGINES: Array<{
  id: AiMotionEngine;
  label: string;
  shortDesc: string;
}> = [
  {
    id: "flow_diagram",
    label: "Flow & Diagram",
    shortDesc: "Alur sistem, siklus, viral spread, & perbandingan",
  },
  {
    id: "motion_chart",
    label: "Motion Chart",
    shortDesc: "Bar chart, line chart, & angka KPI tumbuh",
  },
  {
    id: "tech_cards",
    label: "Tech & UI Cards",
    shortDesc: "Kartu poin 1-2-3, terminal kode, & tabel VS",
  },
  {
    id: "stick_figure",
    label: "Stick-Figure Story",
    shortDesc: "Kartun analogi karakter, aksi, & balon dialog",
  },
  {
    id: "breakdown_3d",
    label: "3D Breakdown",
    shortDesc: "Bedah komponen 3D lapis demi lapis (M7)",
  },
];

export const AI_MOTION_THEMES: Array<{
  id: AiMotionTheme;
  label: string;
  bgHex: string;
  accentHex: string;
  isLight: boolean;
}> = [
  { id: "carbon", label: "Carbon", bgHex: "#0d1016", accentHex: "#10b981", isLight: false },
  { id: "paper", label: "Paper", bgHex: "#f4efe6", accentHex: "#ea580c", isLight: true },
  { id: "coral", label: "Coral", bgHex: "#c95f3c", accentHex: "#ffe2b8", isLight: false },
  { id: "mint", label: "Mint", bgHex: "#bfe8d3", accentHex: "#0d2a1f", isLight: true },
  { id: "blue", label: "Blue", bgHex: "#0a162b", accentHex: "#38bdf8", isLight: false },
];

export function isLightAiMotionTheme(theme: AiMotionTheme): boolean {
  return theme === "paper" || theme === "mint";
}

export function createDefaultAiMotion(
  engine: AiMotionEngine = "flow_diagram",
  theme: AiMotionTheme = "carbon",
  seedTitle?: string
): AiMotionSpec {
  const shortSeed = seedTitle
    ? seedTitle.trim().split(/\s+/).slice(0, 6).join(" ")
    : "";

  switch (engine) {
    case "flow_diagram":
      return {
        engine: "flow_diagram",
        theme,
        title: shortSeed || "Cara Kerja Internet",
        subtitle: "Dari klik link sampai tampil di layar",
        takeaway: "Semua terjadi kurang dari 200 milidetik",
        flow: {
          pattern: "flow",
          steps: ["Browser", "Cari DNS", "Server", "Tampil"],
          branches: 3,
          depth: 3,
          sequence: ["1", "3", "9", "27"],
          center: "Hasil",
          sources: ["Hook", "Visual", "Audio", "Pacing"],
          direction: "in",
          groups: [
            { label: "Cara Manual", value: 45, unit: "menit" },
            { label: "AI Motion", value: 3, unit: "menit" },
          ],
          highlightIndex: 1,
        },
      };

    case "motion_chart":
      return {
        engine: "motion_chart",
        theme,
        title: shortSeed || "Waktu Muat Halaman",
        subtitle: "Perbandingan latensi rata-rata",
        takeaway: "Cache lokal memangkas waktu hingga 85%",
        chart: {
          chartType: "bar",
          data: [
            { label: "Tanpa CDN", value: 480 },
            { label: "DNS Lokal", value: 210 },
            { label: "Edge CDN", value: 68 },
          ],
          prefix: "",
          suffix: " ms",
          callout: "auto",
          goodDirection: "down",
          highlightIndex: 2,
          sourceNote: "Data ilustrasi benchmark",
        },
      };

    case "tech_cards":
      return {
        engine: "tech_cards",
        theme,
        title: shortSeed || "3 Kunci Video Edukasi",
        subtitle: "Biar penonton nonton sampai habis",
        takeaway: "Mulai dari masalah, tutup dengan aksi nyata",
        techCards: {
          layout: "staggered_steps",
          cards: [
            {
              badge: "01",
              title: "Hook 3 Detik Pertama",
              detail: "Langsung lempar pertanyaan atau visual kontras.",
            },
            {
              badge: "02",
              title: "Satu Konsep per Scene",
              detail: "Jangan tumpuk 5 istilah teknis sekaligus.",
            },
            {
              badge: "03",
              title: "Analogi Visual Jelas",
              detail: "Pakai diagram, angka, atau cerita singkat.",
            },
          ],
          codeTitle: "dns-resolver.ts",
          codeLines: [
            "const ip = await dns.lookup('synkcut.id');",
            "const res = await fetch(`https://${ip}`);",
            "const html = await res.text();",
            "renderToScreen(html); // < 120ms",
          ],
          highlightLine: 1,
          leftTitle: "Cara Lama",
          leftItems: ["Edit manual 3 jam", "Install Python & CLI", "Render ulang tiap typo"],
          rightTitle: "Synkcut v1.1",
          rightItems: ["AI Motion instan", "Zero setup lokal", "Edit mikro 0 token"],
        },
      };

    case "stick_figure":
      return {
        engine: "stick_figure",
        theme: theme === "carbon" ? "paper" : theme,
        title: shortSeed || "Analogi Cara Kerja DNS",
        subtitle: "Seperti buku telepon raksasa internet",
        takeaway: "DNS menerjemahkan nama domain ke alamat IP",
        stickFigure: {
          setting: "office",
          figures: [
            { id: "kamu", kind: "person", x: 0.25, label: "Browser", facing: "right", color: "#38bdf8" },
            { id: "dns", kind: "person", x: 0.74, label: "DNS", facing: "left", color: "#10b981" },
          ],
          props: [
            { type: "desk", x: 0.24 },
            { type: "plant", x: 0.88 },
          ],
          beats: [
            {
              who: "kamu",
              action: "talk",
              atSec: 0.0,
              durationSec: 1.5,
              say: "Alamat google.com?",
            },
            {
              who: "dns",
              action: "think",
              atSec: 0.7,
              durationSec: 1.0,
              say: "Cek buku IP...",
            },
            {
              who: "dns",
              action: "idea",
              atSec: 1.6,
              durationSec: 1.8,
              say: "Ketemu! 142.250.x",
            },
            {
              who: "kamu",
              action: "cheer",
              atSec: 2.3,
              durationSec: 1.5,
              say: "Langsung buka!",
            },
          ],
          arrow: {
            fromId: "kamu",
            toId: "dns",
            atSec: 0.85,
            label: "DNS Query",
          },
        },
      };

    case "breakdown_3d":
    default:
      return {
        engine: "breakdown_3d",
        theme,
        title: shortSeed || "Inside a Smartphone",
        subtitle: "Lapisan komponen utama",
        takeaway: "Komponen padat dalam tebal 8 milimeter",
        breakdown3d: {
          spinSpeed: 0.08,
          parts: [
            { name: "Cover Glass", shape: "slab", material: "glass", level: 0 },
            { name: "OLED Display", shape: "slab", material: "black", level: 1 },
            { name: "Aluminum Frame", shape: "frame", material: "aluminum", level: 2 },
            { name: "Logic Board", shape: "slab", material: "pcb", level: 3 },
            { name: "Battery 5000mAh", shape: "slab", material: "battery", level: 4 },
          ],
        },
      };
  }
}
