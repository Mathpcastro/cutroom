import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EDITOR_TOOLS } from "../electron/core/codex";
import { DesktopMcpServer } from "../electron/core/desktop-mcp";
import { ProfileService } from "../electron/core/profile-service";
import { ProfileStore } from "../electron/core/profile-store";
import * as profileTools from "../electron/core/profile-tool-defs";

const PROFILE_TOOL_NAMES = [
  "profile_create",
  "profile_get",
  "profile_list",
  "profile_update",
  "profile_duplicate",
  "profile_delete",
  "profile_select",
  "profile_list_projects",
] as const;
const UI_CALLER = { id: "ui", authorizeProfileDelete: true } as const;
const SECRET = "sk-profile-mcp-recognizable-secret-123456";
const roots: string[] = [];
const servers: DesktopMcpServer[] = [];

type Dispatcher = (
  name: string,
  args: Record<string, unknown>,
  caller?: { id: string; authorizeProfileDelete?: boolean },
) => Promise<any>;

function dispatcher(service: ProfileService): Dispatcher {
  expect(profileTools.createProfileToolDispatcher).toBeTypeOf("function");
  return (profileTools as any).createProfileToolDispatcher(service);
}

async function temporaryService() {
  const root = await mkdtemp(join(tmpdir(), "profile-mcp-"));
  roots.push(root);
  return new ProfileService({ store: new ProfileStore(root) });
}

async function mcp(executeTool: Dispatcher) {
  const root = await mkdtemp(join(tmpdir(), "profile-mcp-server-"));
  roots.push(root);
  const server = new DesktopMcpServer(executeTool, root);
  servers.push(server);
  const url = await server.start();
  return async (name: string, args: Record<string, unknown>) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    return (await response.json()).result;
  };
}

function resultText(result: any) {
  expect(result.isError).toBeFalsy();
  return JSON.parse(result.content[0].text);
}

afterEach(async () => {
  servers.splice(0).forEach((server) => server.close());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("creator profile tool contract", () => {
  it("registers every profile tool exactly once with strict object schemas", () => {
    const names = EDITOR_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of PROFILE_TOOL_NAMES) {
      expect(names.filter((candidate) => candidate === name)).toHaveLength(1);
      const tool = EDITOR_TOOLS.find((candidate) => candidate.name === name)!;
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    }
  });

  it("requires exact DELETE confirmation and accepts no paths, credentials or publishing actions", () => {
    const removal = EDITOR_TOOLS.find((tool) => tool.name === "profile_delete");
    expect(removal?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        profileId: { type: "string" },
        confirmation: { const: "DELETE" },
      },
      required: ["profileId", "confirmation"],
      additionalProperties: false,
    });
    expect(Object.keys(removal?.inputSchema.properties ?? {})).toEqual([
      "profileId",
      "confirmation",
    ]);
    for (const name of PROFILE_TOOL_NAMES) {
      const tool = EDITOR_TOOLS.find((candidate) => candidate.name === name);
      const serialized = JSON.stringify(tool?.inputSchema);
      expect(serialized).not.toMatch(/destination|credentialValue|publish|instagramAction/);
    }
  });

  it("uses the same ProfileService methods for direct UI calls and real Desktop MCP calls", async () => {
    const service = await temporaryService();
    const spies = {
      create: vi.spyOn(service, "create"),
      get: vi.spyOn(service, "get"),
      list: vi.spyOn(service, "list"),
      update: vi.spyOn(service, "update"),
      setActive: vi.spyOn(service, "setActive"),
      listProjects: vi.spyOn(service, "listProjects"),
      delete: vi.spyOn(service, "delete"),
    };
    const call = dispatcher(service);
    const remote = await mcp(call);

    const created = await call("profile_create", { name: "Orbit", handle: "orbit" });
    const duplicate = await call("profile_duplicate", {
      profileId: created.id,
      name: "Orbit Copy",
      handle: "orbit-copy",
    });
    const updated = await call("profile_update", {
      profileId: created.id,
      patch: { brand: { accent: "#123456" } },
    });
    await service.linkProject(created.id, "film-orbit");

    expect(resultText(await remote("profile_list", {}))).toHaveLength(2);
    expect(resultText(await remote("profile_get", { profileId: created.id })).brand.accent).toBe("#123456");
    expect(resultText(await remote("profile_list_projects", { profileId: created.id }))).toEqual(["film-orbit"]);
    await remote("profile_select", { profileId: duplicate.id });
    expect((await service.getActive())?.id).toBe(duplicate.id);
    await call("profile_delete", { profileId: duplicate.id, confirmation: "DELETE" }, UI_CALLER);

    expect(updated.brand.accent).toBe("#123456");
    expect(spies.create).toHaveBeenCalledTimes(2);
    expect(spies.get).toHaveBeenCalled();
    expect(spies.list).toHaveBeenCalled();
    expect(spies.update).toHaveBeenCalledWith(created.id, { brand: { accent: "#123456" } });
    expect(spies.setActive).toHaveBeenCalledWith(duplicate.id);
    expect(spies.listProjects).toHaveBeenCalledWith(created.id);
    expect(spies.delete).toHaveBeenCalledWith(duplicate.id, "DELETE");
  });

  it("duplicates safe profile data without credentials, connections or projects", async () => {
    const service = await temporaryService();
    const call = dispatcher(service);
    const source = await service.create({
      name: "Orbit",
      handle: "orbit",
      defaultAvatar: { avatarId: "avatar-orbit", revision: 2, hash: "a".repeat(64) },
      voice: { provider: "elevenlabs", voiceId: "voice-orbit", credentialRef: "elevenlabs" },
      personality: { description: "Direta", presentation: "Confiante" },
      brand: { name: "Orbit", accent: "#123456", ink: "#111111", paper: "#FFFFFF" },
      instagram: {
        connectionId: "connection-orbit",
        preferences: { shareToFeed: false, accounts: [{ id: "connection-orbit", username: "orbit" }] },
      },
      commercialGoal: "Vender software",
    });
    await service.linkProject(source.id, "film-orbit");

    const copy = await call("profile_duplicate", {
      profileId: source.id,
      name: "Orbit Copy",
      handle: "orbit-copy",
    });

    expect(copy.id).toBe("orbit-copy");
    expect(copy.brand).toEqual(source.brand);
    expect(copy.defaultAvatar).toEqual(source.defaultAvatar);
    expect(copy.personality).toEqual(source.personality);
    expect(copy.preferences).toEqual(source.preferences);
    expect(copy.instagram).toEqual({ preferences: source.instagram.preferences });
    expect(copy.voice).toEqual({ provider: "elevenlabs", voiceId: "voice-orbit" });
    expect(copy.commercialGoal).toBe(source.commercialGoal);
    expect(copy.createdAt).not.toBe(source.createdAt);
    expect(await service.listProjects(copy.id)).toEqual([]);
    expect(JSON.stringify(copy)).not.toContain("credentialRef");
    expect(JSON.stringify(copy)).not.toContain(SECRET);
  });

  it("always blocks deletion without exact confirmation and explicit caller authorization", async () => {
    const service = await temporaryService();
    const call = dispatcher(service);
    const profile = await service.create({ name: "Orbit", handle: "orbit" });

    await expect(
      call("profile_delete", { profileId: profile.id, confirmation: "DELETE" }),
    ).rejects.toThrow(/caller|autoriz/i);
    await expect(
      call("profile_delete", { profileId: profile.id, confirmation: "REMOVE" }, UI_CALLER),
    ).rejects.toThrow();
    await expect(
      call(
        "profile_delete",
        { profileId: profile.id, confirmation: "DELETE", destination: "../outside" },
        UI_CALLER,
      ),
    ).rejects.toThrow();
    expect(await service.get(profile.id)).toMatchObject({ id: profile.id });

    await call("profile_delete", { profileId: profile.id, confirmation: "DELETE" }, UI_CALLER);
    await expect(service.get(profile.id)).rejects.toThrow(/encontr|not found/i);
  });

  it("rejects undeclared fields and secret values without persisting or echoing them", async () => {
    const service = await temporaryService();
    const call = dispatcher(service);
    let error: unknown;
    try {
      await call("profile_create", {
        name: "Orbit",
        handle: "orbit",
        credentialValue: SECRET,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(SECRET);
    expect(await service.list()).toEqual([]);

    const profile = await service.create({ name: "Orbit", handle: "orbit" });
    await expect(
      call("profile_update", {
        profileId: profile.id,
        patch: { instagram: { action: "publish", credentialValue: SECRET } },
      }),
    ).rejects.toThrow();
    await expect(
      call("profile_duplicate", {
        profileId: profile.id,
        name: "Copy",
        handle: "copy",
        destination: "../outside",
      }),
    ).rejects.toThrow();
    expect((await service.get(profile.id)).instagram).toEqual({ preferences: {} });
  });

  it("wires typed studioProfiles IPC and MCP through the single profile dispatcher", async () => {
    const [main, preload, types] = await Promise.all(
      ["../electron/main.ts", "../electron/preload.ts", "../src/shared/types.ts"].map((path) =>
        readFile(new URL(path, import.meta.url), "utf8"),
      ),
    );
    expect(main).toContain("createProfileToolDispatcher");
    expect(main).toContain("if (isProfileTool(name)) return dispatchProfileTool(name, args);");
    expect(main).toContain('case "profileDelete"');
    expect(main).toContain("authorizeProfileDelete: true");
    expect(preload).toContain("studioProfiles");
    expect(types).toContain("studioProfiles");
    for (const method of ["list", "get", "create", "update", "duplicate", "select", "remove"]) {
      expect(preload).toMatch(new RegExp(`${method}:`));
    }
  });
});
