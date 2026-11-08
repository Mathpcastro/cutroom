import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Films } from "../electron/core/film";
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
    const films = new Films(
      join(root, "Films"),
      resolve("resources/film-kit"),
      createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js"),
    );
    const film = await films.create({
      name: "Film Orbit",
      brand: {
        name: profile.brand.name,
        handle: profile.handle,
        context: profile.commercialGoal,
        palette: {
          accent: profile.brand.accent,
          ink: profile.brand.ink,
          paper: profile.brand.paper,
        },
        source: "manual",
        updatedAt: profile.updatedAt,
      },
    });
    await store.linkProject(profile.id, film.id);
    const filmJson = await readFile(join(film.path, "film.json"), "utf8");
    const filmBrand = await readFile(join(film.path, "brand.js"), "utf8");
    expect(film.id).toBe("film-orbit");
    expect(await store.listProjects(profile.id)).toEqual([film.id]);
    expect(filmJson).not.toContain(FAKE_API_KEY);
    expect(filmBrand).not.toContain(FAKE_API_KEY);
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

  it("keeps only allowlisted legacy preferences and discards every unknown key recursively", async () => {
    const root = await temporaryRoot();
    const logs: string[] = [];
    const sensitive = Object.fromEntries(
      [
        "apiKey",
        "api-key",
        "api_key",
        "api key",
        "secret",
        "clientSecret",
        "client-secret",
        "client secret",
        "password",
        "passphrase",
        "pass-phrase",
        "passwd",
        "pwd",
        "token",
        "accessToken",
        "access_token",
        "accessKey",
        "access_key",
        "clientKey",
        "client-key",
        "client_key",
        "signingKey",
        "signing-key",
        "signing_key",
        "encryptionKey",
        "refreshToken",
        "refresh token",
        "credential",
        "credentials",
        "credential-id",
        "authorization",
        "auth",
        "cookie",
        "session",
        "privateKey",
        "private_key",
        "bearer",
        "bearer-token",
        "totallyUnknown",
      ].map((key) => [key, FAKE_API_KEY]),
    );
    const publish = {
      defaultAccount: "connection-orbit",
      preferences: {
        shareToFeed: false,
        ...sensitive,
        credentialRef: "not-allowed-in-free-preferences",
        accounts: [
          {
            id: "connection-orbit",
            userId: "",
            igUserId: 0,
            username: "",
            status: null,
            nested: { auth: FAKE_API_KEY },
            clientKey: FAKE_API_KEY,
          },
          { id: "connection-two", username: "orbit", signing_key: FAKE_API_KEY },
          { username: "missing-required-id", keep: "discard" },
        ],
        nested: { keep: "unknown-container" },
      },
    };
    const legacyPublishBytes = JSON.stringify(publish, null, 2);
    await writeFile(join(root, "publish.json"), legacyPublishBytes, "utf8");

    const profile = await migrateLegacyProfile({
      root,
      secrets: new FakeSecretStore(),
      brand: {
        name: "Orbit Labs",
        handle: "orbitlabs",
        context: "Objetivo comercial legado.",
        palette: { accent: "#7C5CFF", ink: "#141318", paper: "#F7F6F1" },
      },
      voice: { provider: "elevenlabs", voices: { elevenlabs: "voice-orbit" }, apiKey: FAKE_API_KEY },
      logger: (message) => logs.push(message),
    });

    expect(profile.voice.credentialRef).toBe("elevenlabs");
    expect(profile.instagram.preferences).toEqual({
      shareToFeed: false,
      accounts: [
        { id: "connection-orbit", userId: "", igUserId: 0, username: "", status: null },
        { id: "connection-two", username: "orbit" },
      ],
    });
    expect(await readFile(join(root, "publish.json"), "utf8")).toBe(legacyPublishBytes);
    expect(logs.join("\n")).not.toContain(FAKE_API_KEY);
    expect(JSON.stringify(profile)).not.toContain(FAKE_API_KEY);
  });

  it("discards entire legacy account fields with array accessors, toJSON or cycles", async () => {
    const withToJson = [{ id: "connection-orbit" }];
    Object.defineProperty(withToJson, "toJSON", {
      enumerable: false,
      value: () => ({ totallyUnknown: FAKE_API_KEY }),
    });
    const withGetter: unknown[] = [];
    Object.defineProperty(withGetter, "0", {
      enumerable: true,
      get: () => ({ id: "connection-orbit", username: FAKE_API_KEY }),
    });
    const cyclic: unknown[] = [{ id: "connection-orbit" }];
    cyclic.push(cyclic);

    for (const accounts of [withToJson, withGetter, cyclic]) {
      const root = await temporaryRoot();
      const logs: string[] = [];
      const profile = await migrateLegacyProfile({
        root,
        secrets: new FakeSecretStore(),
        brand: {
          name: "Orbit Labs",
          handle: "orbitlabs",
          context: "Objetivo comercial legado.",
          palette: { accent: "#7C5CFF", ink: "#141318", paper: "#F7F6F1" },
        },
        voice: { provider: "elevenlabs", voices: { elevenlabs: "voice-orbit" } },
        publish: { preferences: { accounts } },
        logger: (message) => logs.push(message),
      });

      expect(profile.instagram.preferences).toEqual({});
      const persisted = await readFile(join(root, "profiles", profile.id, "profile.json"), "utf8");
      expect(persisted).not.toContain(FAKE_API_KEY);
      expect(logs.join("\n")).not.toContain(FAKE_API_KEY);
    }
  });
});
