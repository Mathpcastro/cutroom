import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../website/api/download.js";

const release = "https://github.com/Mathpcastro/cutroom/releases/download/v0.6.1";
const installers = {
  windows: `${release}/CutRoom.Setup.0.6.1.exe`,
  "macos-arm64": `${release}/CutRoom-0.6.1-mac-arm64.dmg`,
  "macos-x64": `${release}/CutRoom-0.6.1-mac-x64.dmg`,
};

function request(body) {
  return {
    method: "POST",
    headers: {
      origin: "https://cutroom.test",
      host: "cutroom.test",
      "x-forwarded-proto": "https",
      "content-type": "application/json",
    },
    body,
  };
}

function response() {
  return {
    headers: {},
    statusCode: 200,
    body: "",
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Vercel download route", () => {
  it.each(Object.entries(installers))("returns the selected %s installer after persistence", async (platform, downloadUrl) => {
    vi.stubEnv("CUTROOM_SITES_BYPASS_TOKEN", "test-only-token");
    const fetchMock = vi.fn(async (_url, options) => {
      expect(options.headers["OAI-Sites-Authorization"]).toBe("Bearer test-only-token");
      expect(JSON.parse(options.body).platform).toBe(platform);
      return new Response(JSON.stringify({ ok: true, downloadUrl: installers.windows }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = response();
    await handler(request({ name: "Teste", email: "test@example.com", whatsapp: "+14155552671", platform }), res);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, downloadUrl });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects unlisted platforms before contacting the private backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = response();

    await handler(request({ name: "Teste", email: "test@example.com", whatsapp: "+14155552671", platform: "linux" }), res);

    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
