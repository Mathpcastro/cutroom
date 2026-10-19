import { mkdir, mkdtemp, stat, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Project } from "../../src/shared/types";
import { motionCacheKey, motionDocument } from "./motion-document";
import { motionBrowser, motionPackageInfo } from "./motion-package";
import { ffmpegPath, ffprobePath } from "./media";
import { runProcess } from "./process";

export interface RenderedMotion {
  id: string;
  path: string;
}
export async function renderMotions(
  project: Project,
  options: {
    cache: string;
    packages: string;
    resources: string;
    worker: string;
    signal?: AbortSignal;
    onProgress: (p: number, label: string) => void;
  },
): Promise<RenderedMotion[]> {
  const scenes = project.motions ?? [];
  if (!scenes.length) return [];
  if (!(await motionPackageInfo(options.packages)).installed)
    throw new Error(
      "Instale Efeitos e animações na aba Pacotes antes de exportar este projeto.",
    );
  await mkdir(options.cache, { recursive: true });
  const result: RenderedMotion[] = [];
  for (let i = 0; i < scenes.length; i++) {
    options.signal?.throwIfAborted();
    const scene = scenes[i],
      key = motionCacheKey(scene, project.settings),
      output = join(options.cache, `${key}.mov`);
    const cached = await stat(output).then(
      (s) => s.size > 0,
      () => false,
    );
    if (!cached) {
      const work = await mkdtemp(join(options.cache, ".render-"));
      try {
        await writeFile(
          join(work, "index.html"),
          await motionDocument(
            scene,
            project.settings,
            options.resources,
            false,
          ),
        );
        const spec = join(work, "request.json"),
          staged = join(work, "scene.mov");
        await writeFile(
          spec,
          JSON.stringify({
            browser: motionBrowser(options.packages),
            fps: project.settings.fps,
            directory: work,
            output: staged,
          }),
        );
        await runProcess(process.execPath, [options.worker, spec], {
          signal: options.signal,
          cwd: work,
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            HYPERFRAMES_FFMPEG_PATH: ffmpegPath,
            HYPERFRAMES_FFPROBE_PATH: ffprobePath,
          },
          onLine: (line) => {
            try {
              const p = JSON.parse(line);
              if (typeof p.progress === "number")
                options.onProgress(
                  ((i + p.progress / 100) / scenes.length) * 100,
                  `Renderizando ${scene.name}…`,
                );
            } catch {
              /* SDK logs aren't progress messages. */
            }
          },
        });
        options.signal?.throwIfAborted();
        if (!(await stat(staged)).size)
          throw new Error("O renderizador não gerou a cena.");
        await rename(staged, output);
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    }
    result.push({ id: scene.id, path: output });
    options.onProgress(
      ((i + 1) / scenes.length) * 100,
      cached ? `Reutilizando ${scene.name}.` : `${scene.name} renderizada.`,
    );
  }
  return result;
}
