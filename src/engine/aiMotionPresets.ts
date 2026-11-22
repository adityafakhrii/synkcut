import type {
  AiMotionEngine,
  AiMotionSpec,
  AiMotionTheme,
  Breakdown3DConfig,
  Breakdown3DPresetId,
} from "../types/scene";

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
    shortDesc: "Bedah komponen 3D real-time lapis demi lapis",
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
    default: {
      const preset = createBreakdown3DPreset("smartphone");
      return {
        engine: "breakdown_3d",
        theme,
        title: shortSeed || preset.title,
        subtitle: preset.subtitle,
        takeaway: preset.takeaway,
        breakdown3d: preset.config,
      };
    }
  }
}

export const BREAKDOWN_3D_SHAPES: Array<{ id: string; label: string }> = [
  { id: "slab", label: "Slab (Rounded)" },
  { id: "frame", label: "Frame (Hollow)" },
  { id: "box", label: "Box" },
  { id: "cylinder", label: "Cylinder / Disc" },
  { id: "ring", label: "Ring" },
  { id: "lens", label: "Camera Lens" },
  { id: "capsule", label: "Capsule" },
  { id: "torus", label: "Torus / Cushion" },
  { id: "sphere", label: "Sphere" },
  { id: "cone", label: "Cone" },
];

export const BREAKDOWN_3D_MATERIALS: Array<{ id: string; label: string }> = [
  { id: "glass", label: "Glass (Clearcoat)" },
  { id: "screen", label: "OLED Screen" },
  { id: "aluminum", label: "Aluminum / Metal" },
  { id: "steel", label: "Brushed Steel" },
  { id: "gold", label: "Gold Metallic" },
  { id: "copper", label: "Copper" },
  { id: "pcb", label: "PCB Circuit" },
  { id: "battery", label: "Li-ion Battery" },
  { id: "coil", label: "Copper Coil" },
  { id: "lens", label: "Optical Lens" },
  { id: "ceramic", label: "Ceramic" },
  { id: "rubber", label: "Matte Rubber" },
  { id: "plastic", label: "Studio Plastic" },
  { id: "black", label: "Anodized Black" },
  { id: "white", label: "Matte White" },
  { id: "wood", label: "Wood Grain" },
  { id: "emissive", label: "Emissive Glow" },
];

export const BREAKDOWN_3D_PRESETS: Array<{
  id: Exclude<Breakdown3DPresetId, "custom">;
  label: string;
  title: string;
  subtitle: string;
  takeaway: string;
  config: Breakdown3DConfig;
}> = [
  {
    id: "smartphone",
    label: "Smartphone Flagship",
    title: "Bedah Isi Smartphone",
    subtitle: "6 lapisan komponen di bodi setebal 8mm",
    takeaway: "Presisi mikro dari kaca hingga coil MagSafe",
    config: {
      presetId: "smartphone",
      axis: "y",
      spin: 0.72,
      spinSpeed: 0.14,
      elevation0: 36,
      elevation1: 22,
      parts: [
        {
          name: "Cover Glass",
          shape: "slab",
          size: [72, 1.4, 148],
          pos: [0, 8.6, 0],
          radius: 10,
          material: "glass",
          color: "#dbeafe",
          level: 5,
        },
        {
          name: "OLED Display",
          shape: "slab",
          size: [69, 1.8, 144],
          pos: [0, 6.6, 0],
          radius: 9,
          material: "screen",
          level: 4,
        },
        {
          name: "Titanium Frame",
          shape: "frame",
          size: [74, 5.6, 150],
          pos: [0, 1.6, 0],
          radius: 11,
          wall: 3.6,
          material: "aluminum",
          color: "#94a3b8",
          level: 3,
        },
        {
          name: "Logic Board SoC",
          shape: "slab",
          size: [60, 1.8, 56],
          pos: [0, 3.8, -36],
          radius: 4,
          material: "pcb",
          level: 2,
        },
        {
          name: "Li-ion 5000mAh",
          shape: "slab",
          size: [56, 4.0, 76],
          pos: [0, 2.0, 22],
          radius: 4,
          material: "battery",
          text: "5000 mAh|Li-ion Polymer",
          level: 1,
        },
        {
          name: "MagSafe Coil",
          shape: "cylinder",
          size: [50, 1.4, 50],
          pos: [0, 0.2, 10],
          radius: 25,
          material: "coil",
          level: 0,
        },
      ],
    },
  },
  {
    id: "laptop",
    label: "Laptop Ultrabook",
    title: "Anatomi Laptop Tipis",
    subtitle: "Arsitektur pendingin & chip modern",
    takeaway: "Desain unibody memadatkan tenaga desktop",
    config: {
      presetId: "laptop",
      axis: "y",
      spin: 0.78,
      spinSpeed: 0.13,
      elevation0: 36,
      elevation1: 23,
      parts: [
        {
          name: "Retina Display",
          shape: "slab",
          size: [146, 2.6, 98],
          pos: [0, 11.8, 0],
          radius: 6,
          material: "screen",
          level: 4,
        },
        {
          name: "Unibody Chassis",
          shape: "frame",
          size: [150, 6.8, 102],
          pos: [0, 4.4, 0],
          radius: 7,
          wall: 6.5,
          material: "aluminum",
          color: "#cbd5e1",
          level: 3,
        },
        {
          name: "Mainboard & SoC",
          shape: "slab",
          size: [130, 2.2, 46],
          pos: [0, 5.6, -22],
          radius: 3,
          material: "pcb",
          level: 2,
        },
        {
          name: "Cooling Blower",
          shape: "ring",
          size: [40, 4.0, 40],
          pos: [34, 4.0, -20],
          radius: 20,
          inner: 13,
          material: "steel",
          color: "#64748b",
          level: 1,
        },
        {
          name: "Battery 70Wh",
          shape: "slab",
          size: [126, 4.6, 42],
          pos: [0, 1.0, 22],
          radius: 4,
          material: "battery",
          text: "70 Wh|6-Cell Pack",
          level: 0,
        },
      ],
    },
  },
  {
    id: "earbuds",
    label: "Earbuds TWS Pro",
    title: "Rahasia Earbuds ANC",
    subtitle: "Driver 11mm & chip peredam bising",
    takeaway: "Audio hi-res dalam ruang kurang dari 3cm",
    config: {
      presetId: "earbuds",
      axis: "y",
      spin: 0.65,
      spinSpeed: 0.18,
      elevation0: 34,
      elevation1: 22,
      parts: [
        {
          name: "Silicone Ear Tip",
          shape: "torus",
          size: [22, 6.5, 22],
          pos: [0, 23, 0],
          radius: 11,
          material: "rubber",
          color: "#e2e8f0",
          level: 4,
        },
        {
          name: "Acoustic Shell",
          shape: "capsule",
          size: [20, 16, 20],
          pos: [0, 12, 0],
          material: "ceramic",
          color: "#f8fafc",
          level: 3,
        },
        {
          name: "11mm Copper Driver",
          shape: "cylinder",
          size: [16, 3.0, 16],
          pos: [0, 9.5, 0],
          radius: 8,
          material: "coil",
          level: 2,
        },
        {
          name: "ANC Audio PCB",
          shape: "cylinder",
          size: [15, 2.0, 15],
          pos: [0, 6.0, 0],
          radius: 7.5,
          material: "pcb",
          level: 1,
        },
        {
          name: "Micro Lithium Cell",
          shape: "cylinder",
          size: [12, 8.0, 12],
          pos: [0, 0, 0],
          radius: 6,
          material: "gold",
          level: 0,
        },
      ],
    },
  },
  {
    id: "smartwatch",
    label: "Smartwatch Titanium",
    title: "Isi Dalam Smartwatch",
    subtitle: "Sensor optik & layar safir tangguh",
    takeaway: "Komputer mini lengkap di pergelangan tangan",
    config: {
      presetId: "smartwatch",
      axis: "y",
      spin: 0.72,
      spinSpeed: 0.15,
      elevation0: 38,
      elevation1: 23,
      parts: [
        {
          name: "Sapphire Glass",
          shape: "slab",
          size: [42, 2.0, 48],
          pos: [0, 11.4, 0],
          radius: 11,
          material: "glass",
          color: "#e0f2fe",
          level: 4,
        },
        {
          name: "AMOLED Display",
          shape: "slab",
          size: [38, 1.6, 44],
          pos: [0, 9.5, 0],
          radius: 9,
          material: "screen",
          level: 3,
        },
        {
          name: "Titanium Case",
          shape: "frame",
          size: [44, 8.2, 50],
          pos: [0, 2.2, 0],
          radius: 12,
          wall: 4.2,
          material: "aluminum",
          color: "#a8a29e",
          level: 2,
        },
        {
          name: "SiP Chip Board",
          shape: "slab",
          size: [32, 2.0, 34],
          pos: [0, 5.0, 0],
          radius: 5,
          material: "pcb",
          level: 1,
        },
        {
          name: "Heart Rate Sensor",
          shape: "lens",
          size: [24, 3.6, 24],
          pos: [0, 0, 0],
          radius: 11,
          material: "lens",
          level: 0,
        },
      ],
    },
  },
];

export function createBreakdown3DPreset(
  presetId: Exclude<Breakdown3DPresetId, "custom"> = "smartphone"
) {
  const found =
    BREAKDOWN_3D_PRESETS.find((p) => p.id === presetId) ?? BREAKDOWN_3D_PRESETS[0];
  return {
    title: found.title,
    subtitle: found.subtitle,
    takeaway: found.takeaway,
    config: JSON.parse(JSON.stringify(found.config)) as Breakdown3DConfig,
  };
}
