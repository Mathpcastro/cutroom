import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { dailySlots, dueReels, parseWhen, windowsTaskXml, SCHEDULE_FLAG } from "../electron/core/reel-schedule";
import { Publisher } from "../electron/core/publish";

const now = new Date(2026, 10, 6, 20, 0);

describe("reel schedule", () => {
  it("parses local times and refuses past or far dates", () => {
    expect(parseWhen("2026-11-07 18:00", now).getHours()).toBe(18);
    expect(() => parseWhen("2026-11-06 20:01", now)).toThrow(/2 minutos/);
    expect(() => parseWhen("2027-06-01 10:00", now)).toThrow(/120 dias/);
    expect(() => parseWhen("amanhã", now)).toThrow(/inválida/);
  });
  it("builds a daily series starting at the next free slot", () => {
    const slots = dailySlots(3, "18:00", now);
    expect(slots.map((d) => `${d.getDate()} ${d.getHours()}`)).toEqual(["7 18", "8 18", "9 18"]);
    expect(dailySlots(2, "21:00", now, 2).map((d) => d.getDate())).toEqual([6, 8]);
  });
  it("posts due entries and holds the ones more than 6 h late", () => {
    const at = (h: number) => new Date(now.getTime() - h * 3600e3).toISOString();
    const due = dueReels(
      [
        { id: "a", video: "", caption: "", account: "", at: at(1), status: "scheduled" },
        { id: "b", video: "", caption: "", account: "", at: at(7), status: "scheduled" },
        { id: "c", video: "", caption: "", account: "", at: at(1), status: "published" },
        { id: "d", video: "", caption: "", account: "", at: new Date(now.getTime() + 60e3).toISOString(), status: "scheduled" },
      ],
      now.getTime(),
    );
    expect(due).toEqual([{ id: "a", late: false }, { id: "b", late: true }]);
  });
  it("writes a current-user Task Scheduler entry that runs late if the PC was off", () => {
    const xml = windowsTaskXml(new Date(2026, 10, 7, 18, 0), "C:\\Program Files\\CutRoom\\CutRoom.exe", [SCHEDULE_FLAG]);
    expect(xml).toContain("<StartBoundary>2026-11-07T18:00:00</StartBoundary>");
    expect(xml).toContain("<StartWhenAvailable>true</StartWhenAvailable>");
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(xml).toContain("<Arguments>--publicar-reels</Arguments>");
  });
});

describe("reels autopilot", () => {
  async function setup() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cutroom-pub-"));
    const video = path.join(dir, "reel.mp4");
    await fs.writeFile(video, Buffer.alloc(1024, 1));
    await fs.writeFile(path.join(dir, "publish.json"), JSON.stringify({ accounts: [{ id: "ca_1", igUserId: "178", username: "omatheusdaia" }], defaultAccount: "ca_1", history: [] }));
    const posted: string[] = [];
    const fetcher = (async (url: string) => {
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
      if (url.endsWith("/files/upload/request")) return json({ new_presigned_url: "https://s.example/put", key: "k" });
      if (url === "https://s.example/put") return new Response("", { status: 200 });
      if (url.includes("PUBLISH")) {
        posted.push(url);
        return json({ successful: true, data: { id: "1790000000009" } });
      }
      if (url.includes("INSTAGRAM_POST_IG_USER_MEDIA")) return json({ successful: true, data: { id: "1790000000008" } });
      return json({ successful: true, data: { permalink: "https://instagram.com/reel/y" } });
    }) as unknown as typeof fetch;
    const wakeups: string[] = [];
    const publisher = new Publisher({
      secrets: { get: async () => "ak_test", set: async () => undefined, describe: async () => ({ "publish.composio": true }) } as never,
      userDir: dir,
      videosDir: dir,
      job: (_k, _l, run) => run(new AbortController().signal, () => undefined),
      fetcher,
      os: { add: async (id: string) => void wakeups.push(`add ${id}`), remove: async (id: string) => void wakeups.push(`remove ${id}`) } as never,
    });
    return { dir, video, publisher, posted, wakeups };
  }
  it("requires confirmation, schedules a daily series and posts each one exactly once", async () => {
    const { dir, video, publisher, posted, wakeups } = await setup();
    await expect(publisher.scheduleSeries({ posts: [{ video }], time: "18:00" })).rejects.toThrow(/confirm/);
    const r = await publisher.scheduleSeries({ posts: [{ video, caption: "Link no perfil" }, { video }], time: "18:00", confirm: true });
    expect(r.scheduled).toHaveLength(2);
    expect(wakeups.filter((w) => w.startsWith("add"))).toHaveLength(2);
    const first = new Date(r.scheduled[0].at).getTime();
    const [a, b] = await Promise.all([publisher.runDue(first + 1000), publisher.runDue(first + 1000)]);
    expect([...a, ...b]).toEqual([{ id: r.scheduled[0].id, status: "published", permalink: "https://instagram.com/reel/y" }]);
    expect(posted).toHaveLength(1);
    expect(await publisher.runDue(first + 2000)).toEqual([]);
    const settings = await publisher.settings();
    expect(settings.scheduled!.map((e) => e.status)).toEqual(["published", "scheduled"]);
    await publisher.cancelScheduled(r.scheduled[1].id);
    expect((await publisher.settings()).scheduled!.map((e) => e.status)).toEqual(["published"]);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
