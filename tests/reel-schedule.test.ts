import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_TIMES, dailySlots, dueReels, parseWhen, planSlots, validateTimes, windowsTaskXml, SCHEDULE_FLAG } from "../electron/core/reel-schedule";
import { readCreationPilot, writeCreationPilot } from "../electron/core/creation-pilot";
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
  it("autopilot: 1 to 5 Reels a day, each at its own time, at least 1 h apart", () => {
    expect(validateTimes(["18:00", "12:00"])).toEqual(["12:00", "18:00"]);
    expect(() => validateTimes(["12:00", "12:30"])).toThrow(/1 hora/);
    expect(() => validateTimes([])).toThrow(/1 a 5/);
    expect(() => validateTimes(["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"])).toThrow(/1 a 5/);
    const five = planSlots(10, { times: DEFAULT_TIMES[5], days: "daily" }, now);
    expect(five.map((d) => `${d.getDate()} ${d.getHours()}`)).toEqual(["7 8", "7 11", "7 14", "7 17", "7 20", "8 8", "8 11", "8 14", "8 17", "8 20"]);
    const two = planSlots(3, { times: ["12:00", "21:00"], days: "daily" }, now);
    expect(two.map((d) => `${d.getDate()} ${d.getHours()}`)).toEqual(["6 21", "7 12", "7 21"]);
  });
  it("autopilot: alternate days, weekdays, taken slots and skipped days", () => {
    const alt = planSlots(3, { times: ["18:00"], days: "alternate" }, now);
    expect(alt.map((d) => d.getDate())).toEqual([8, 10, 12]); // the 6th is past 18:00, so it starts on the 8th
    const weekdays = planSlots(3, { times: ["18:00"], days: [1, 3] }, now); // 2026-11-06 is a Friday
    expect(weekdays.map((d) => d.getDay())).toEqual([1, 3, 1]);
    const taken = planSlots(2, { times: ["18:00"], days: "daily" }, now, { taken: [new Date(2026, 10, 7, 18, 0).getTime()] });
    expect(taken.map((d) => d.getDate())).toEqual([8, 9]);
    const skipped = planSlots(2, { times: ["18:00"], days: "daily" }, now, { skip: ["2026-11-08"] });
    expect(skipped.map((d) => d.getDate())).toEqual([7, 9]);
  });
  it("autopilot: per-item captions, reorder keeps the slots, skip day moves the rest, new video goes to the first free slot", async () => {
    const { dir, video, publisher } = await setup();
    const second = path.join(dir, "b.mp4");
    await fs.writeFile(second, Buffer.alloc(1024, 2));
    const r = await publisher.scheduleSeries({ posts: [{ video, caption: "um" }, { video: second, caption: "dois" }], times: ["12:00", "18:00"], days: "daily", pilot: true, confirm: true });
    let s = await publisher.settings();
    expect(s.scheduled!.map((e) => e.caption)).toEqual(["um", "dois"]);
    const [a, b] = r.scheduled;
    await publisher.reorderScheduled({ ids: [b.id, a.id] });
    s = await publisher.settings();
    expect(s.scheduled!.find((e) => e.id === b.id)!.at).toBe(a.at);
    expect(s.scheduled!.find((e) => e.id === a.id)!.at).toBe(b.at);
    await publisher.updateScheduled({ id: a.id, caption: "novo" });
    expect((await publisher.settings()).scheduled!.find((e) => e.id === a.id)!.caption).toBe("novo");
    await publisher.setPilot({ enabled: true, times: ["12:00", "18:00"], days: "daily" });
    const firstDay = new Date(b.at);
    const key = `${firstDay.getFullYear()}-${String(firstDay.getMonth() + 1).padStart(2, "0")}-${String(firstDay.getDate()).padStart(2, "0")}`;
    await publisher.skipDay({ date: key });
    s = await publisher.settings();
    expect(s.scheduled!.every((e) => !e.at.startsWith(key) || new Date(e.at).getDate() !== firstDay.getDate())).toBe(true);
    const added = await publisher.addToPilot({ video, caption: "três", confirm: true });
    const last = Math.max(...s.scheduled!.map((e) => new Date(e.at).getTime()));
    expect(new Date(added.scheduled[0].at).getTime()).toBeGreaterThan(last);
    await fs.rm(dir, { recursive: true, force: true });
  });
  it("autopilot: a video dropped on a calendar day keeps that day and time (kanban)", async () => {
    const { dir, video, publisher } = await setup();
    const day = new Date(Date.now() + 3 * 864e5);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const r = await publisher.addToPilot({ video, caption: "x", at: `${key} 12:00`, confirm: true });
    const at = new Date(r.scheduled[0].at);
    expect([at.getDate(), at.getHours()]).toEqual([day.getDate(), 12]);
    await fs.rm(dir, { recursive: true, force: true });
  });
  it("autopilot: a paused pilot does not post its items", async () => {
    const { dir, video, publisher, posted } = await setup();
    const r = await publisher.scheduleSeries({ posts: [{ video }], times: ["18:00"], pilot: true, confirm: true });
    await publisher.setPilot({ enabled: false });
    expect(await publisher.runDue(new Date(r.scheduled[0].at).getTime() + 1000)).toEqual([]);
    expect(posted).toHaveLength(0);
    await fs.rm(dir, { recursive: true, force: true });
  });
  it("creation pilot lives in profiles/<id>/pilot.json", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "videosell-pilot-"));
    expect(await readCreationPilot(dir, "perfil")).toBeNull();
    await writeCreationPilot(dir, "perfil", { queue: [{ title: "A", brief: "pauta" }], enabled: true, time: "09:00", everyDays: 1 });
    expect((await readCreationPilot(dir, "perfil"))!.queue[0].brief).toBe("pauta");
    await expect(writeCreationPilot(dir, "../fora", { queue: [], enabled: false, time: "09:00", everyDays: 1 })).rejects.toThrow();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
