// Runs in the application's private Node utility process, never the UI process.
import { readFile } from "node:fs/promises";
import {
  createRenderJob,
  executeRenderJob,
  resolveConfig,
} from "@hyperframes/producer";

try {
  const spec = JSON.parse(await readFile(process.argv[2], "utf8"));
  const config = resolveConfig({
    chromePath: spec.browser,
    concurrency: 1,
    enableBrowserPool: false,
    forceScreenshot: true,
    useDrawElement: false,
    enablePageSideCompositing: false,
  });
  const job = createRenderJob({
    fps: spec.fps,
    format: "mov",
    quality: "high",
    workers: 1,
    hdrMode: "force-sdr",
    strictness: "strict",
    producerConfig: config,
  });
  await executeRenderJob(job, spec.directory, spec.output, (job, message) => {
    console.log(JSON.stringify({ progress: job.progress, label: message }));
  });
  console.log(JSON.stringify({ complete: true }));
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
