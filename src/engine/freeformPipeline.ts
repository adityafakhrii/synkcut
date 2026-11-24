import type { StoryboardBeat, SynkcutProject } from "../types/scene";
import { aiRepairBeatCode, isTauriRuntime } from "../lib/tauriBridge";
import { verifyBeatCodeOffscreen } from "./freeformMotionRenderer";

export interface VerifyRepairResult {
  project: SynkcutProject;
  verifiedCount: number;
  repairedCount: number;
  fallbackCount: number;
}

/**
 * Runs the 4-frame offscreen sandbox verifier on every `custom_code` beat in a project.
 * Any beat that throws an error, triggers loop-guard, or renders blank/flat is automatically
 * sent to `ai_repair_beat_code` (up to 2 attempts) before falling back to pure brand kinetic typography.
 */
export async function verifyAndRepairProjectBeats(
  project: SynkcutProject,
  onProgress?: (status: string) => void
): Promise<VerifyRepairResult> {
  const customDesign = project.globalStyle?.customDesign ?? null;
  const accentColor =
    customDesign?.palette.accentPrimary || project.globalStyle?.accentColor || "#38E59D";
  const brandLogoUrl = project.styleReference?.logoDataUrl ?? null;
  const words = project.voiceover?.words ?? [];

  let verifiedCount = 0;
  let repairedCount = 0;
  let fallbackCount = 0;

  const nextScenes = [...project.scenes];

  for (let i = 0; i < nextScenes.length; i++) {
    const scene = nextScenes[i];
    if (scene.visualSource !== "motion" || scene.aiMotion?.engine !== "custom_code") {
      continue;
    }

    const cc = scene.aiMotion.customCode;
    let code = (cc?.code || "").trim();
    const beatMeta: StoryboardBeat = {
      id: scene.id,
      role: scene.role,
      startMs: scene.startMs,
      endMs: scene.endMs,
      text: scene.text,
      title: scene.aiMotion.title || scene.text.split(/\s+/).slice(0, 4).join(" "),
      visualConcept: cc?.visualConcept || `Visual motion kustom untuk: ${scene.text}`,
      emotionalIntent: cc?.emotionalIntent || "bold",
      skillsUsed: cc?.skillsUsed || ["motion-craft-physics", "procedural-illustration-svg"],
      transitionIn: scene.transitionIn.preset,
      sfx: scene.sfx[0]?.preset || "whoosh_fast",
    };

    onProgress?.(`Memvalidasi 4 frame Beat ${i + 1}/${nextScenes.length}...`);

    let passed = false;
    let lastErr = "";

    for (let attempt = 0; attempt < 3; attempt++) {
      if (!code) {
        lastErr = "Kode animasi beat belum dihasilkan.";
      } else {
        const check = verifyBeatCodeOffscreen({
          code,
          scene,
          allWords: words,
          accentColor,
          customDesign,
          brandLogoUrl,
        });
        if (check.ok) {
          passed = true;
          verifiedCount++;
          if (attempt > 0) repairedCount++;
          nextScenes[i] = {
            ...scene,
            aiMotion: {
              ...scene.aiMotion,
              customCode: {
                code,
                visualConcept: beatMeta.visualConcept,
                emotionalIntent: beatMeta.emotionalIntent,
                skillsUsed: beatMeta.skillsUsed,
                verified: true,
                verificationNote:
                  attempt > 0
                    ? `Diperbaiki otomatis & lolos cek 4 frame`
                    : check.warning || "Lolos cek 4 frame",
              },
            },
          };
          break;
        }
        lastErr = check.error || "Gagal validasi frame.";
      }

      // Attempt auto-repair via AI (up to 2 retries) when running in desktop Tauri runtime
      if (attempt < 2 && isTauriRuntime()) {
        onProgress?.(
          `Auto-repair Beat ${i + 1}/${nextScenes.length} (percobaan ${attempt + 1}/2)...`
        );
        try {
          const repaired = await aiRepairBeatCode({
            beat: beatMeta,
            brokenCode: code || "// empty",
            errorMessage: lastErr,
            customDesign,
            hasBrandLogo: Boolean(brandLogoUrl),
          });
          code = repaired.code;
        } catch {
          break;
        }
      } else {
        break;
      }
    }

    if (!passed) {
      fallbackCount++;
      // Clear broken code so `renderFreeformBeat` uses clean zero-dummy Kinetic Typography of the beat's REAL text
      nextScenes[i] = {
        ...scene,
        aiMotion: {
          ...scene.aiMotion,
          customCode: {
            code: "",
            visualConcept: beatMeta.visualConcept,
            emotionalIntent: beatMeta.emotionalIntent,
            skillsUsed: beatMeta.skillsUsed,
            verified: true,
            verificationNote: `Fallback Tipografi Kinetik Aman (${lastErr.slice(0, 80)})`,
          },
        },
      };
    }
  }

  return {
    project: {
      ...project,
      version: "2.0",
      scenes: nextScenes,
    },
    verifiedCount,
    repairedCount,
    fallbackCount,
  };
}
