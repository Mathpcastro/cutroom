import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertProfileId } from "../../src/shared/profile";
import { creationPilotSchema, type CreationPilot } from "../../src/shared/creation-pilot";

/** `<userData>/profiles/<id>/pilot.json`, validated and written atomically. `null` = never saved (migrate). */
export async function readCreationPilot(userDir: string, profileId: string): Promise<CreationPilot | null> {
  const file = join(userDir, "profiles", assertProfileId(profileId), "pilot.json");
  try {
    return creationPilotSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}

export async function writeCreationPilot(userDir: string, profileId: string, value: unknown) {
  const pilot = creationPilotSchema.parse(value);
  const dir = join(userDir, "profiles", assertProfileId(profileId));
  await mkdir(dir, { recursive: true });
  const file = join(dir, "pilot.json");
  await writeFile(`${file}.partial`, JSON.stringify(pilot, null, 2), "utf8");
  await rename(`${file}.partial`, file);
  return pilot;
}
