import { useEffect, useRef, useState } from "react";
import { HyperframesPlayer } from "@hyperframes/player";
import type { MotionScene, Project } from "../shared/types";
import { motionLocalTime } from "../shared/motions";
import "./motion-studio.css";

function ScenePreview({
  scene,
  project,
  time,
}: {
  scene: MotionScene;
  project: Project;
  time: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<HyperframesPlayer | null>(null);
  const current = useRef({ scene, time });
  current.current = { scene, time };
  const active = time >= scene.start && time < scene.end;
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const signature = JSON.stringify([
    scene,
    project.settings.width,
    project.settings.height,
    project.settings.fps,
  ]);
  useEffect(() => {
    if (!host.current || !window.cutroom) return;
    let disposed = false;
    let instance: HyperframesPlayer | undefined;
    setStatus("loading");
    const timeout = window.setTimeout(() => {
      if (!disposed) setStatus("error");
    }, 12000);
    void window.cutroom
      .request<{ url: string }>("getMotionPreview", { id: scene.id })
      .then(({ url }) => {
        if (disposed || !host.current) return;
        instance = new HyperframesPlayer();
        // Remove origin privileges before any untrusted content is assigned or connected.
        instance.setAttribute("sandbox-origin", "");
        instance.iframeElement.sandbox.value = "allow-scripts";
        // Chromium paints an opaque canvas when the parent's dark color scheme
        // differs from a transparent document. Match the composition's scheme.
        instance.iframeElement.style.colorScheme = "normal";
        instance.iframeElement.style.background = "transparent";
        instance.setAttribute("width", String(project.settings.width));
        instance.setAttribute("height", String(project.settings.height));
        instance.setAttribute("muted", "");
        instance.setAttribute("audio-locked", "");
        instance.setAttribute("disable-click-to-play", "");
        instance.setAttribute("assets-loading-ui", "none");
        instance.setAttribute("shader-loading", "none");
        instance.setAttribute("aria-hidden", "true");
        instance.addEventListener("ready", () => {
          if (disposed || !instance) return;
          instance.pause();
          instance.seek(
            motionLocalTime(current.current.scene, current.current.time),
          );
          window.clearTimeout(timeout);
          setStatus("ready");
        });
        instance.addEventListener("error", () => {
          if (!disposed) {
            window.clearTimeout(timeout);
            setStatus("error");
          }
        });
        instance.setAttribute("src", url);
        player.current = instance;
        host.current.replaceChildren(instance);
      })
      .catch(() => {
        if (!disposed) {
          window.clearTimeout(timeout);
          setStatus("error");
        }
      });
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      instance?.remove();
      if (player.current === instance) player.current = null;
    };
  }, [signature]);
  useEffect(() => {
    const instance = player.current;
    if (instance?.ready) instance.seek(motionLocalTime(scene, time));
  }, [time, scene]);
  return (
    <div
      className={`motion-preview ${scene.mode === "fullscreen" ? "is-fullscreen" : ""}`}
      data-motion-id={scene.id}
      data-status={status}
      data-active={active}
      style={{ visibility: active ? "visible" : "hidden" }}
      aria-label={`Animação: ${scene.name}`}
    >
      <div className="motion-preview-host" ref={host} />
      {status === "error" && (
        <span className="motion-preview-error" role="status">
          Não foi possível carregar a animação. O vídeo continua disponível.
        </span>
      )}
    </div>
  );
}

export function MotionPreview({
  project,
  time,
}: {
  project: Project;
  time: number;
}) {
  const scenes = project.motions ?? [];
  // Warm just the next nearby scene; its player remains paused and invisible.
  const next = scenes
    .filter((scene) => scene.start > time && scene.start <= time + 1)
    .sort((a, b) => a.start - b.start)[0];
  return (
    <>
      {scenes
        .filter(
          (scene) =>
            (time >= scene.start && time < scene.end) || scene.id === next?.id,
        )
        .map((scene) => (
          <ScenePreview
            key={scene.id}
            scene={scene}
            project={project}
            time={time}
          />
        ))}
    </>
  );
}
