import { useEffect, useRef, useState } from "react";
import type {
  AvatarProofSheet,
  AvatarSheetArtifact,
} from "../../../electron/core/avatar-render";
import type { AvatarCreatorAPI } from "../../shared/types";

interface AvatarCanvasProps {
  api: AvatarCreatorAPI;
  avatarId: string;
  revision: number;
  sheet: AvatarProofSheet;
  path: string;
  artifact: AvatarSheetArtifact;
  alt: string;
  compact?: boolean;
}

/** Displays only a contained, service-verified native PNG at an integer scale. */
export function AvatarCanvas({
  api,
  avatarId,
  revision,
  sheet,
  path,
  artifact,
  alt,
  compact = false,
}: AvatarCanvasProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [dataUrl, setDataUrl] = useState("");
  const [error, setError] = useState("");
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let active = true;
    setDataUrl("");
    setError("");
    void api.readArtifact({ avatarId, revision, path }).then((result) => {
      if (active) setDataUrl(result.dataUrl);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      active = false;
    };
  }, [api, avatarId, revision, path]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => {
      const available = Math.max(1, frame.clientWidth - (compact ? 24 : 48));
      const fit = Math.max(1, Math.floor(available / artifact.nativeWidth));
      setScale(compact ? Math.min(5, fit) : Math.min(3, fit));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [artifact.nativeWidth, compact]);

  return (
    <div
      ref={frameRef}
      className={`avatar-canvas${compact ? " avatar-canvas-compact" : ""}`}
      data-sheet={sheet}
    >
      {error && <p className="avatar-error" role="alert">{error}</p>}
      {!error && !dataUrl && <p className="avatar-loading" role="status">Lendo PNG da revisão…</p>}
      {dataUrl && (
        <div
          className="avatar-canvas-scroll"
          style={{ minWidth: artifact.nativeWidth * scale }}
        >
          <img
            src={dataUrl}
            alt={alt}
            width={artifact.nativeWidth}
            height={artifact.nativeHeight}
            style={{
              width: artifact.nativeWidth * scale,
              height: artifact.nativeHeight * scale,
              imageRendering: "pixelated",
            }}
            draggable={false}
          />
        </div>
      )}
    </div>
  );
}
