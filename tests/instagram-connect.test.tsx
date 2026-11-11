import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { explainPublishError, keyFormatProblem, connectLink, Composio } from "../electron/core/composio";
import { Publisher } from "../electron/core/publish";
import { InstagramConnect, connectionStatus, explainError, type PublishState } from "../src/components/studio/InstagramConnect";

function memorySecrets() {
  const store = new Map<string, string>();
  return {
    get: async (name: string) => store.get(name),
    set: async (name: string, value?: string) => { if (value) store.set(name, value); else store.delete(name); },
    describe: async (names: string[]) => Object.fromEntries(names.map((n) => [n, store.get(n) ? `••••${store.get(n)!.slice(-4)}` : undefined])),
  };
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

function fakeFetch(accounts: { id: string; status: string; type?: string; username?: string }[], badKey = "") {
  return (async (url: string, init?: RequestInit) => {
    const key = (init?.headers as Record<string, string>)?.["x-api-key"];
    if (key === badKey) return json({ error: { message: "Invalid API key" } }, 401);
    if (url.includes("/connected_accounts?")) return json({ items: accounts.map((a) => ({ id: a.id, status: a.status })) });
    if (url.includes("INSTAGRAM_GET_USER_INFO")) {
      const id = JSON.parse(String(init!.body)).connected_account_id;
      const a = accounts.find((x) => x.id === id)!;
      return json({ successful: true, data: { id: `ig-${id}`, user_id: `ig-${id}`, username: a.username, account_type: a.type ?? "BUSINESS" } });
    }
    return json({ error: { message: "unexpected" } }, 500);
  }) as unknown as typeof fetch;
}

async function publisher(fetcher: typeof fetch) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "videosell-ig-"));
  return new Publisher({ secrets: memorySecrets() as never, userDir: dir, videosDir: dir, job: (_k, _l, run) => run(new AbortController().signal, () => {}), fetcher });
}

describe("Instagram connection (Spec 2)", () => {
  it("checks the key format before any call", () => {
    expect(keyFormatProblem("")).toMatch(/Cole/);
    expect(keyFormatProblem("uak_abcdefghijklmn")).toMatch(/pessoal/);
    expect(keyFormatProblem("ak_ abc")).toMatch(/espaços/);
    expect(keyFormatProblem("ak_abcdefghijklmnop")).toBe("");
  });

  it("does not save a key that Composio refuses", async () => {
    const pub = await publisher(fakeFetch([], "ak_badbadbadbadbad"));
    await expect(pub.setKey("ak_badbadbadbadbad")).rejects.toThrow(/não foi aceita/);
    expect((await pub.settings()).hasKey).toBe(false);
  });

  it("keeps expired and personal accounts with the reason, and shows only the last 4 characters of the key", async () => {
    const pub = await publisher(fakeFetch([
      { id: "ca_1", status: "ACTIVE", username: "marca" },
      { id: "ca_2", status: "ACTIVE", username: "pessoal", type: "PERSONAL" },
      { id: "ca_3", status: "EXPIRED" },
    ]));
    const s = await pub.setKey("ak_goodgoodgood1234");
    expect(s.accounts.map((a) => a.username)).toEqual(["marca"]);
    expect(s.unusable.map((a) => a.problem)).toEqual(["personal", "expired"]);
    expect(s.unusable[0].message).toMatch(/@pessoal é uma conta pessoal/);
    expect(s.keyHint).toBe("••••1234");
    expect(JSON.stringify(s)).not.toContain("goodgood");
  });

  it("maps known failures to Portuguese with an action and never shows the key", () => {
    expect(explainPublishError(new Error("Sem conexão com o Composio: fetch failed")).action).toBe("Tentar de novo");
    const e = explainPublishError(new Error("Invalid API key: ak_secret123456"));
    expect(e.details).not.toContain("secret");
    expect(explainError(new Error("Essa chave não foi aceita. Confira")).action).toBe("key");
    expect(explainError(new Error("A conexão com @x expirou.")).action).toBe("connect");
  });

  it("falls back to the dashboard when the link API is not available", async () => {
    const composio = new Composio("ak_test12345678", (async () => json({ error: { message: "nope" } }, 404)) as unknown as typeof fetch);
    expect(await connectLink(composio, "videosell")).toEqual({ url: "https://platform.composio.dev", mode: "dashboard" });
    const linked = new Composio("ak_test12345678", (async (url: string) =>
      url.includes("/auth_configs") ? json({ items: [{ id: "ac_1" }] }) : json({ redirect_url: "https://connect.composio.dev/x" })) as unknown as typeof fetch);
    expect(await connectLink(linked, "videosell")).toEqual({ url: "https://connect.composio.dev/x", mode: "link" });
  });

  it("summarises the connection for the sidebar indicator", () => {
    expect(connectionStatus(null).level).toBe("off");
    const ready: PublishState = { hasKey: true, accounts: [{ id: "a", username: "marca" }], defaultAccount: "a", history: [] };
    expect(connectionStatus(ready)).toMatchObject({ level: "ready", label: "@marca" });
    expect(connectionStatus({ ...ready, accounts: [] }).level).toBe("warning");
  });

  it("opens the step that is missing", async () => {
    const states: PublishState[] = [
      { hasKey: false, accounts: [], history: [] },
      { hasKey: true, keyHint: "••••1234", accounts: [], unusable: [{ id: "x", username: "velha", problem: "expired", message: "A conexão com @velha expirou." }], history: [] },
      { hasKey: true, keyHint: "••••1234", accounts: [{ id: "a", username: "marca" }], defaultAccount: "a", history: [] },
    ];
    const texts: string[] = [];
    for (const state of states) {
      const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
      Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
      (window as unknown as { cutroom: unknown }).cutroom = { request: async () => state };
      const root = createRoot(window.document.getElementById("root") as unknown as HTMLElement);
      await act(async () => { root.render(<InstagramConnect />); });
      await act(async () => { await Promise.resolve(); });
      texts.push(window.document.getElementById("root")!.textContent ?? "");
      await act(async () => root.unmount());
    }
    expect(texts[0]).toContain("O Composio é o serviço que liga o Videosell ao seu Instagram");
    expect(texts[1]).toContain("A conexão com @velha expirou.");
    expect(texts[1]).toContain("Reconectar");
    expect(texts[1]).toContain("••••1234");
    expect(texts[2]).toContain("Pronta para postar");
    expect(texts.join(" ")).not.toContain("ak_");
  });
});
