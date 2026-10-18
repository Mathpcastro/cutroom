import { useEffect, useMemo, useRef, useState } from "react";
import JASSUB from "jassub";
import workerUrl from "../workers/captions.worker.ts?worker&url";
import wasmUrl from "jassub/dist/wasm/jassub-worker.wasm?url";
import modernWasmUrl from "jassub/dist/wasm/jassub-worker-modern.wasm?url";
import type { Project } from "../shared/types";
import { createCaptionAss } from "../shared/captions";
import "./caption-studio.css";

const fontAssets = import.meta.glob("../assets/fonts/*.ttf", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const fonts = Object.values(fontAssets);

/** A real libass canvas. Time is OUTPUT timeline seconds (including hooks/cuts/speed). */
export function CaptionPreview({
  project,
  time,
}: {
  project: Project;
  time: number;
}) {
  const host = useRef<HTMLDivElement>(null),
    renderer = useRef<JASSUB | null>(null);
  const latest = useRef({ project, time });
  latest.current = { project, time };
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const ass = useMemo(() => createCaptionAss(project), [project]);
  const track = useRef(ass);
  track.current = ass;
  const enabled = project.settings.captions && project.words.length > 0;
  useEffect(() => {
    if (!enabled || !host.current) return;
    let disposed = false;
    setStatus("loading");
    setError("");
    const canvas = document.createElement("canvas");
    canvas.className = "caption-ass-canvas";
    canvas.width = latest.current.project.settings.width;
    canvas.height = latest.current.project.settings.height;
    host.current.appendChild(canvas);
    let instance: JASSUB;
    const fail = (reason: unknown) => {
      if (!disposed) {
        setStatus("error");
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    try {
      instance = new JASSUB({
        canvas,
        subContent: track.current,
        workerUrl,
        wasmUrl,
        modernWasmUrl,
        fonts,
        defaultFont: "Barlow",
        queryFonts: false,
      });
      renderer.current = instance;
      instance.ready
        .then(async () => {
          if (disposed) return;
          // Preload explicitly before first frame; no network font discovery or silent fallback.
          await instance.renderer.addFonts(fonts);
          if (disposed) return;
          await instance.renderer.setTrack(track.current);
          const current = latest.current;
          await instance.manualRender(
            {
              expectedDisplayTime: performance.now(),
              width: current.project.settings.width,
              height: current.project.settings.height,
              mediaTime: current.time,
            },
            true,
          );
          if (!disposed) setStatus("ready");
        })
        .catch(fail);
      // A module/wasm load failure must be visible rather than an eternally blank preview.
      instance._worker.addEventListener("error", (event) =>
        fail(
          event.message ||
            "Não foi possível carregar o renderizador de legendas.",
        ),
      );
    } catch (reason) {
      fail(reason);
      canvas.remove();
    }
    return () => {
      disposed = true;
      if (renderer.current === instance) renderer.current = null;
      if (instance) void instance.destroy().catch(() => undefined);
      canvas.remove();
    };
  }, [enabled]);
  useEffect(() => {
    const instance = renderer.current;
    if (!instance) return;
    let cancelled = false;
    instance.ready
      .then(async () => {
        if (cancelled) return;
        await instance.renderer.setTrack(ass);
        if (cancelled) return;
        const current = latest.current;
        await instance.manualRender(
          {
            expectedDisplayTime: performance.now(),
            width: current.project.settings.width,
            height: current.project.settings.height,
            mediaTime: current.time,
          },
          true,
        );
      })
      .catch((reason) => {
        if (!cancelled) {
          setStatus("error");
          setError(String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ass]);
  useEffect(() => {
    const instance = renderer.current;
    if (instance && status === "ready")
      void instance
        .manualRender({
          expectedDisplayTime: performance.now(),
          width: project.settings.width,
          height: project.settings.height,
          mediaTime: time,
        })
        .catch((reason) => {
          setStatus("error");
          setError(String(reason));
        });
  }, [time, project.settings.width, project.settings.height, status]);
  if (!enabled) return null;
  return (
    <div
      ref={host}
      className="caption-ass-preview"
      aria-label="Legendas do projeto"
      data-renderer="jassub-libass"
      data-render-status={status}
    >
      {status === "error" && (
        <span className="caption-render-error" role="alert" title={error}>
          Falha na prévia das legendas. {error}
        </span>
      )}
    </div>
  );
}
