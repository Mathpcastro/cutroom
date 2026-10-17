import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export async function runProcess(
  file: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    onLine?: (line: string) => void;
    cwd?: string;
  } = {},
): Promise<string> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      windowsHide: true,
      shell: false,
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    const stop = () => {
      if (process.platform === "win32" && child.pid) {
        const killer = spawn(
          "taskkill",
          ["/pid", String(child.pid), "/t", "/f"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.on("error", () => child.kill());
      } else child.kill("SIGTERM");
    };
    options.signal?.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", (data: Buffer) => {
      output = (output + data.toString()).slice(-2_000_000);
    });
    child.stderr.on("data", (data: Buffer) => {
      errors = (errors + data.toString()).slice(-12_000);
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => options.onLine?.(line));
    child.once("error", reject);
    child.once("close", (code) => {
      options.signal?.removeEventListener("abort", stop);
      if (options.signal?.aborted) reject(new Error("Operação cancelada."));
      else if (code !== 0)
        reject(
          new Error(
            errors.trim() ||
              output.trim() ||
              `Processo encerrou com código ${code}.`,
          ),
        );
      else resolve(output);
    });
  });
}
