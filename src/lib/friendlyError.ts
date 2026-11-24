export interface FriendlyErrorInfo {
  title: string;
  message: string;
  hint: string;
  rawDetail: string;
  isTimeout: boolean;
}

/**
 * Translates raw technical LLM/HTTP/Rust errors into calm, helpful Indonesian messages
 * suitable for everyday creators, while preserving raw details behind an optional toggle.
 */
export function toFriendlyAiError(err: unknown): FriendlyErrorInfo {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err ?? "Terjadi kendala tak terduga.");
  const lower = raw.toLowerCase();

  if (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("deadline")
  ) {
    return {
      title: "Proses AI memakan waktu terlalu lama",
      message:
        "Server AI belum selesai merespons dalam batas waktu. Tenang — suara dubbing dan rencana script yang sudah jadi tetap tersimpan.",
      hint: "Klik Coba Lagi untuk melanjutkan dari tahap terakhir, atau coba versi 2D yang biasanya selesai jauh lebih cepat.",
      rawDetail: raw,
      isTimeout: true,
    };
  }

  if (
    lower.includes("connection refused") ||
    lower.includes("error sending request") ||
    lower.includes("failed to connect") ||
    lower.includes("dns error") ||
    lower.includes("network")
  ) {
    return {
      title: "Belum bisa terhubung ke layanan AI",
      message:
        "Aplikasi tidak dapat menjangkau server AI saat ini. Progress script dan suara lo tetap aman.",
      hint: "Pastikan koneksi internet atau server AI lokal lo sedang aktif, lalu klik Coba Lagi.",
      rawDetail: raw,
      isTimeout: false,
    };
  }

  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("quota") || lower.includes("resource_exhausted")) {
    return {
      title: "Layanan AI sedang ramai sementara",
      message:
        "Batas permintaan ke penyedia AI sedang penuh untuk sesaat.",
      hint: "Tunggu 10–20 detik lalu klik Coba Lagi, atau ganti ke model lain di Pengaturan AI.",
      rawDetail: raw,
      isTimeout: false,
    };
  }

  if (
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("invalid api key") ||
    lower.includes("unauthorized") ||
    lower.includes("api key belum")
  ) {
    return {
      title: "Kunci API AI perlu dicek ulang",
      message:
        "Penyedia AI menolak akses karena API Key belum diatur, salah ketik, atau sudah kedaluwarsa.",
      hint: "Buka Pengaturan AI untuk mengecek atau mengganti model — draft Wizard lo tidak akan hilang.",
      rawDetail: raw,
      isTimeout: false,
    };
  }

  if (
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("overloaded")
  ) {
    return {
      title: "Server AI sedang sibuk",
      message:
        "Server penyedia AI mengalami gangguan sementara saat menyusun hasil.",
      hint: "Klik Coba Lagi dalam beberapa detik untuk melanjutkan dari tahap terakhir.",
      rawDetail: raw,
      isTimeout: false,
    };
  }

  if (
    lower.includes("json") ||
    lower.includes("decode") ||
    lower.includes("kosong") ||
    lower.includes("terlalu pendek")
  ) {
    return {
      title: "Hasil dari AI kurang lengkap",
      message:
        "Model AI mengembalikan format yang terpotong sehingga belum bisa langsung dipakai.",
      hint: "Klik Coba Lagi agar AI menyusun ulang tahap terakhir ini secara otomatis.",
      rawDetail: raw,
      isTimeout: false,
    };
  }

  return {
    title: "Proses sempat terhenti",
    message:
      "Ada kendala sementara saat menyiapkan video. Script dan suara yang sudah jadi tetap aman tersimpan.",
    hint: "Silakan klik Coba Lagi untuk melanjutkan.",
    rawDetail: raw,
    isTimeout: false,
  };
}

/** Formats elapsed milliseconds as live stopwatch `MM:SS` (e.g. `00:24`, `01:08`). */
export function formatStopwatch(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/** Formats final generation time in friendly Indonesian (e.g. `34,8 detik` or `1 menit 12 detik`). */
export function formatGenerationDuration(ms: number): string {
  const safeMs = Math.max(100, Math.round(ms));
  if (safeMs < 60_000) {
    return `${(safeMs / 1000).toFixed(1).replace(".", ",")} detik`;
  }
  const totalSec = Math.round(safeMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return secs > 0 ? `${mins} menit ${secs} detik` : `${mins} menit`;
}
