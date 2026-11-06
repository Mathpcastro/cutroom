import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Composio, friendly, publishReel, toolData } from "../electron/core/composio";

function fakeComposio() {
  const calls: { url: string; body?: any }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    if (url.endsWith("/files/upload/request")) return json({ new_presigned_url: "https://storage.example/put", key: "uploads/v.mp4" });
    if (url === "https://storage.example/put") return new Response("", { status: 200 });
    if (url.includes("INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH")) return json({ successful: true, data: JSON.stringify({ id: "1790000000002" }) });
    if (url.includes("INSTAGRAM_POST_IG_USER_MEDIA")) return json({ successful: true, data: { id: "1790000000001" } });
    if (url.includes("INSTAGRAM_GET_IG_MEDIA")) return json({ successful: true, data: { id: "1790000000002", permalink: "https://instagram.com/reel/x" } });
    return new Response(JSON.stringify({ error: { message: "unexpected" } }), { status: 500 });
  }) as unknown as typeof fetch;
  return { calls, composio: new Composio("ak_test", fetcher) };
}

describe("composio reels", () => {
  it("uploads the MP4, creates a REELS container and publishes it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cutroom-reel-"));
    const video = path.join(dir, "filme.mp4");
    await fs.writeFile(video, Buffer.alloc(2048, 1));
    const { calls, composio } = fakeComposio();
    const steps: string[] = [];
    const r = await publishReel({ composio, account: { id: "ca_1", igUserId: "178", username: "omatheusdaia" }, video, caption: "Teste", onStep: (s) => steps.push(s) });
    expect(r).toMatchObject({ mediaId: "1790000000002", permalink: "https://instagram.com/reel/x", username: "omatheusdaia" });
    const create = calls.find((c) => c.url.endsWith("/tools/execute/INSTAGRAM_POST_IG_USER_MEDIA"))!;
    expect(create.body.arguments).toMatchObject({ ig_user_id: "178", media_type: "REELS", caption: "Teste", video_file: { name: "filme.mp4", mimetype: "video/mp4", s3key: "uploads/v.mp4" } });
    const publish = calls.find((c) => c.url.includes("PUBLISH"))!;
    expect(publish.body.arguments).toMatchObject({ creation_id: "1790000000001", max_wait_seconds: 300 });
    expect(calls.find((c) => c.url.endsWith("/files/upload/request"))!.body).toMatchObject({ tool_slug: "INSTAGRAM_POST_IG_USER_MEDIA", mimetype: "video/mp4" });
    expect(steps.join(" ")).toMatch(/Enviando.*Criando.*Esperando/);
    await fs.rm(dir, { recursive: true, force: true });
  });
  it("refuses non-MP4 files and accounts without an Instagram id", async () => {
    const { composio } = fakeComposio();
    await expect(publishReel({ composio, account: { id: "ca_1" }, video: "x.mp4" })).rejects.toThrow(/Escolha uma conta/);
  });
  it("explains key and account errors and unwraps tool data", () => {
    expect(friendly("Invalid API key: ak_**12", 401).code).toBe("key");
    expect(friendly("Only business or creator accounts").code).toBe("account");
    expect(toolData({ data: '{"id":"5"}', successful: true })).toEqual({ id: "5" });
    expect(() => new Composio("")).toThrow(/chave/);
  });
});
