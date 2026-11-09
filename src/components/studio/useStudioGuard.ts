import { useCallback, useState } from "react";

export function useStudioGuard() {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const guard = useCallback(async (work: () => Promise<unknown>, ok?: string) => {
    setError("");
    setNotice("");
    try {
      await work();
      if (ok) setNotice(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));
    }
  }, []);

  return { error, notice, setNotice, guard };
}
