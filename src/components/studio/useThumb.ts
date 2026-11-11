import { useEffect, useState } from "react";
import { studioRequest } from "./salesReels";

/** Cover image of an exported video (a cached JPG made in the main process). */
export function useThumb(path?: string) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!path) return;
    let alive = true;
    studioRequest<{ url: string }>("videoThumb", { path }).then(({ url }) => alive && setSrc(url), () => undefined);
    return () => { alive = false; };
  }, [path]);
  return src;
}
