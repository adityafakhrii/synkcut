import type { StoryboardBeat, SynkcutProject } from "../types/scene";
import {
  aiCritique3dFrames,
  aiRepair3dDiorama,
  aiRepairBeatCode,
  aiRepairHyperframeVideo,
  captureHyperframePoster,
  isTauriRuntime,
} from "../lib/tauriBridge";
import { verifyBeatCodeOffscreen } from "./freeformMotionRenderer";
import { verifyDiorama3DOffscreen } from "./diorama3dRenderer";
import {
  buildPlayableHyperframeHtml,
  isHyperframeProject,
  verifyHyperframeOffscreen,
} from "./hyperframeRuntime";

export interface VerifyRepairResult {
  project: SynkcutProject;
  verifiedCount: number;
  repairedCount: number;
  fallbackCount: number;
}

/**
 * Runs the 4-frame offscreen sandbox verifier on:
 * - Unified `world3d` / `diorama_3d` scenes (WebGL PBR verifier + auto-repair via `ai_repair_3d_diorama`)
 * - Every `custom_code` 2D beat (Canvas 2D verifier + auto-repair via `ai_repair_beat_code`)
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

  let nextWorld3d = project.world3d ? { ...project.world3d } : null;
  const nextScenes = [...project.scenes];

  // 0. Verify v3.0 Unified HyperFrames composition (HTML + Three.js + GSAP + SVG + Impeccable)
  if (isHyperframeProject(project) && project.hyperframe) {
    let html = project.hyperframe.html;
    let lintFixes = project.hyperframe.lintFixes ?? [];
    let passedHf = false;
    let lastErrHf = "";

    onProgress?.("Memvalidasi 5 titik waktu HyperFrames (WebGL + GSAP + Impeccable)...");

    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate: SynkcutProject = {
        ...project,
        hyperframe: { ...project.hyperframe, html, lintFixes },
      };
      const check = await verifyHyperframeOffscreen(candidate);
      if (check.ok) {
        passedHf = true;
        verifiedCount++;
        if (attempt > 0) repairedCount++;
        break;
      }
      lastErrHf = check.error || "Error runtime pada komposisi HyperFrames.";
      if (attempt < 2 && isTauriRuntime()) {
        onProgress?.(`Auto-repair HyperFrames (percobaan ${attempt + 1}/2)...`);
        try {
          const repaired = await aiRepairHyperframeVideo({
            projectTitle: project.meta.name,
            brokenHtml: html,
            errorMessage: lastErrHf,
          });
          html = repaired.html;
          lintFixes = Array.from(new Set([...lintFixes, ...(repaired.lintFixes ?? [])]));
        } catch {
          break;
        }
      } else {
        break;
      }
    }

    const updatedProject: SynkcutProject = {
      ...project,
      version: "3.0",
      hyperframe: {
        ...project.hyperframe,
        html,
        lintFixes,
        verified: passedHf,
        verificationNote: passedHf
          ? repairedCount > 0
            ? "HyperFrames dipoles & lolos cek 5-frame"
            : "Lolos cek 5-frame HyperFrames + Impeccable"
          : `Peringatan verifikasi: ${lastErrHf.slice(0, 90)}`,
      },
    };

    // Capture real 1-second video frame thumbnail via Rust Headless CDP!
    if (isTauriRuntime() && !updatedProject.meta.posterDataUrl) {
      onProgress?.("Mengambil thumbnail preview detik ke-1...");
      const posterHtml = buildPlayableHyperframeHtml(updatedProject, "./vendor/");
      const poster = await captureHyperframePoster({ html: posterHtml, timeSec: 1.0 });
      if (poster) {
        updatedProject.meta = { ...updatedProject.meta, posterDataUrl: poster };
      }
    }

    return {
      project: updatedProject,
      verifiedCount,
      repairedCount,
      fallbackCount: passedHf ? 0 : 1,
    };
  }

  // 1. Verify unified 3D Diorama world if present
  const hasDioramaScenes = nextScenes.some(
    (s) => s.visualSource === "motion" && s.aiMotion?.engine === "diorama_3d"
  );
  if (hasDioramaScenes && nextWorld3d) {
    let setupCode = (nextWorld3d.setupCode || "").trim();
    let animateCode = (nextWorld3d.animateCode || "").trim();
    const worldPreset = nextWorld3d.worldPreset || "ground_cutaway";
    const beatsSummary = nextScenes
      .map((s, idx) => `#${idx + 1}: ${s.aiMotion?.title || s.text.slice(0, 48)}`)
      .join(" | ");

    onProgress?.("Memvalidasi 4 frame WebGL 3D Diorama...");

    let passed3d = false;
    let lastErr3d = "";
    let lastSnapshots: string[] = [];
    let visionChecked = false;

    for (let attempt = 0; attempt < 3; attempt++) {
      if (!setupCode || !animateCode) {
        lastErr3d = "Kode 3D Diorama belum lengkap.";
      } else {
        const check = verifyDiorama3DOffscreen({
          setupCode,
          animateCode,
          worldPreset,
          project,
        });
        if (check.snapshots && check.snapshots.length > 0) {
          lastSnapshots = check.snapshots;
        }
        if (check.ok) {
          // Antigravity-style Vision Self-Check on the first passing render!
          if (!visionChecked && isTauriRuntime() && lastSnapshots.length > 0 && attempt < 2) {
            visionChecked = true;
            onProgress?.("Inspeksi visual 3D (cek sudut kamera & kejernihan gambar)...");
            try {
              const critique = await aiCritique3dFrames({
                projectTitle: project.meta.name,
                worldSummary: nextWorld3d.summary || project.meta.name,
                frames: lastSnapshots,
              });
              if (!critique.skipped && !critique.ok && (critique.issue || critique.fixHint)) {
                lastErr3d = `Kritik Visual AI: ${critique.issue || "Komposisi kamera/objek kurang jelas"}. Perbaikan: ${critique.fixHint || "Perjelas objek utama & hilangkan penghalang kamera."}`;
                onProgress?.("Memperbaiki komposisi kamera & kualitas visual 3D otomatis...");
                try {
                  const repaired = await aiRepair3dDiorama({
                    projectTitle: project.meta.name,
                    worldPreset,
                    brokenSetupCode: setupCode,
                    brokenAnimateCode: animateCode,
                    errorMessage: lastErr3d,
                    beatsSummary,
                    previewFrames: lastSnapshots,
                  });
                  setupCode = repaired.setupCode;
                  animateCode = repaired.animateCode;
                  continue;
                } catch {
                  // If visual polish repair fails, keep the valid rendered 3D instead of falling back to 2D text!
                }
              }
            } catch {
              // Vision critique is best-effort and never blocks valid 3D output
            }
          }

          passed3d = true;
          verifiedCount++;
          if (attempt > 0) repairedCount++;
          const note =
            attempt > 0
              ? "3D Diorama dipoles otomatis & lolos cek visual WebGL"
              : check.warning || "Lolos cek visual 4 frame WebGL 3D";
          nextWorld3d = {
            ...nextWorld3d,
            setupCode,
            animateCode,
            verified: true,
            verificationNote: note,
          };
          for (let i = 0; i < nextScenes.length; i++) {
            if (nextScenes[i].aiMotion?.engine === "diorama_3d") {
              nextScenes[i] = {
                ...nextScenes[i],
                aiMotion: {
                  ...nextScenes[i].aiMotion!,
                  diorama3d: {
                    ...nextScenes[i].aiMotion!.diorama3d!,
                    verified: true,
                    verificationNote: note,
                  },
                },
              };
            }
          }
          break;
        }
        lastErr3d = check.error || "Gagal validasi 4 frame WebGL.";
      }

      if (attempt < 2 && isTauriRuntime()) {
        onProgress?.(`Auto-repair 3D Diorama (percobaan ${attempt + 1}/2)...`);
        try {
          const repaired = await aiRepair3dDiorama({
            projectTitle: project.meta.name,
            worldPreset,
            brokenSetupCode: setupCode || "// empty",
            brokenAnimateCode: animateCode || "// empty",
            errorMessage: lastErr3d,
            beatsSummary,
            previewFrames: lastSnapshots,
          });
          setupCode = repaired.setupCode;
          animateCode = repaired.animateCode;
        } catch {
          break;
        }
      } else {
        break;
      }
    }

    if (!passed3d) {
      fallbackCount++;
      const note = `Fallback Tipografi Kinetik Aman (${lastErr3d.slice(0, 72)})`;
      nextWorld3d = {
        ...nextWorld3d,
        setupCode: "",
        animateCode: "",
        verified: true,
        verificationNote: note,
      };
      for (let i = 0; i < nextScenes.length; i++) {
        if (nextScenes[i].aiMotion?.engine === "diorama_3d") {
          nextScenes[i] = {
            ...nextScenes[i],
            aiMotion: {
              ...nextScenes[i].aiMotion!,
              diorama3d: {
                ...nextScenes[i].aiMotion!.diorama3d!,
                verified: true,
                verificationNote: note,
              },
            },
          };
        }
      }
    }
  }

  // 2. Verify every 2D `custom_code` beat
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
      version: hasDioramaScenes || nextWorld3d ? "2.1" : "2.0",
      world3d: nextWorld3d,
      scenes: nextScenes,
    },
    verifiedCount,
    repairedCount,
    fallbackCount,
  };
}
