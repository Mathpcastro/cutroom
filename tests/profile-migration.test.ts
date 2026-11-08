import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateLegacyProfile } from "../electron/core/profile-service";
import { ProfileStore } from "../electron/core/profile-store";

const FAKE_API_KEY = "sk-test-ORBIT-recognizable-fake-key-123456";

class FakeSecretStore {
  readonly writes: string[] = [];
  constructor(private readonly values = new Map<string, string>([["voice.elevenlabs", FAKE_API_KEY]])) {}
  async get(name: string) {
    return this.values.get(name);
  }
  async set(name: string, value: string | undefined) {
    this.writes.push(name);
    if (value === undefined) this.values.delete(name);
    else this.values.set(name, value);
  }
}

const roots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "profile-migration-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function writeLegacyFiles(root: string) {
  const brand = {
    name: "Orbit Labs",
    handle: "orbitlabs",
    context: "Venda de software para equipes comerciais.",
    designKit: "Apresentação direta e confiante.",
    palette: { accent: "#7C5CFF", ink: "#141318", paper: "#F7F6F1" },
    source: "manual",
    updatedAt: "2026-11-01T12:00:00.000Z",
  };
  const voice = {
    provider: "elevenlabs",
    voices: { elevenlabs: "voice-orbit" },
    apiKey: FAKE_API_KEY,
  };
  const publish = {
    accounts: [{ id: "connection-orbit", igUserId: "178", username: "orbitlabs" }],
    defaultAccount: "connection-orbit",
    preferences: { shareToFeed: true },
    history: [],
  };
  await writeFile(join(root, "brand.json"), JSON.stringify(brand, null, 2), "utf8");
  await writeFile(join(root, "voice.json"), JSON.stringify(voice, null, 2), "utf8");
  await writeFile(join(root, "publish.json"), JSON.stringify(publish, null, 2), "utf8");
  return { brand, voice, publish };
}

describe("legacy profile migration", () => {
  it("migrates brand, voice and publishing once without copying secrets", async () => {
    const root = await temporaryRoot();
    const legacy = await writeLegacyFiles(root);
    const legacyBytes = await Promise.all(
      ["brand.json", "voice.json", "publish.json"].map((file) => readFile(join(root, file), "utf8")),
    );
    const secrets = new FakeSecretStore();
    const logs: string[] = [];
    const store = new ProfileStore(root);

    const profile = await migrateLegacyProfile({
      root,
      store,
      secrets,
      logger: (message) => logs.push(message),
    });

    expect(profile).toMatchObject({
      version: 1,
      name: "Perfil padrão",
      handle: "orbitlabs",
      voice: { provider: "elevenlabs", voiceId: "voice-orbit", credentialRef: "elevenlabs" },
      personality: {
        description: legacy.brand.context,
        presentation: legacy.brand.designKit,
      },
      brand: {
        name: "Orbit Labs",
        accent: "#7C5CFF",
        ink: "#141318",
        paper: "#F7F6F1",
      },
      instagram: {
        connectionId: "connection-orbit",
        preferences: { shareToFeed: true },
      },
      commercialGoal: legacy.brand.context,
    });
    expect(JSON.stringify(profile)).not.toContain(FAKE_API_KEY);
    expect(JSON.stringify(profile)).not.toContain("apiKey");
    expect(secrets.writes).toEqual([]);
    await expect(secrets.get("voice.elevenlabs")).resolves.toBe(FAKE_API_KEY);

    const profileJson = await readFile(join(root, "profiles", profile.id, "profile.json"), "utf8");
    expect(profileJson).not.toContain(FAKE_API_KEY);
    expect(profileJson).not.toContain("apiKey");
    const filmJson = JSON.stringify({ version: 1, id: "film-orbit", profileId: profile.id });
    await writeFile(join(root, "film-orbit.json"), filmJson, "utf8");
    expect(filmJson).not.toContain(FAKE_API_KEY);
    expect(logs.join("\n")).not.toContain(FAKE_API_KEY);
    expect(logs.join("\n")).not.toContain("apiKey");

    expect(
      await Promise.all(["brand.json", "voice.json", "publish.json"].map((file) => readFile(join(root, file), "utf8"))),
    ).toEqual(legacyBytes);
    expect(await store.list()).toHaveLength(1);
    expect((await store.getActive())?.id).toBe(profile.id);

    const firstJson = profileJson;
    const firstUpdatedAt = profile.updatedAt;
    await writeFile(
      join(root, "brand.json"),
      JSON.stringify({ ...legacy.brand, name: "Não deve migrar de novo" }),
      "utf8",
    );
    const second = await migrateLegacyProfile({ root, store, secrets, logger: (message) => logs.push(message) });
    expect(second.id).toBe(profile.id);
    expect(second.updatedAt).toBe(firstUpdatedAt);
    expect(second.brand.name).toBe("Orbit Labs");
    expect(await store.list()).toHaveLength(1);
    expect(await readFile(join(root, "profiles", profile.id, "profile.json"), "utf8")).toBe(firstJson);
    expect(await readdir(join(root, "profiles"))).not.toContain("profile.json.partial");
  });

  it("accepts legacy values without ever serializing the secret input", async () => {
    const root = await temporaryRoot();
    const secrets = new FakeSecretStore();
    const logs: string[] = [];
    const profile = await migrateLegacyProfile({
      root,
      secrets,
      brand: {
        name: "Orbit Labs",
        handle: "orbitlabs",
        context: "Objetivo comercial legado.",
        palette: { accent: "#7C5CFF", ink: "#141318", paper: "#F7F6F1" },
      },
      voice: { provider: "elevenlabs", voices: { elevenlabs: "voice-orbit" }, apiKey: FAKE_API_KEY },
      publish: { defaultAccount: "connection-orbit", preferences: { shareToFeed: false } },
      logger: (message) => logs.push(message),
    });

    expect(profile.name).toBe("Perfil padrão");
    expect(profile.voice.credentialRef).toBe("elevenlabs");
    expect(profile.instagram.preferences).toEqual({ shareToFeed: false });
    for (const value of [JSON.stringify(profile), logs.join("\n")]) expect(value).not.toContain(FAKE_API_KEY);
    expect(secrets.writes).toEqual([]);
  });
});
