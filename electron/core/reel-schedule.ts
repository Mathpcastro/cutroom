import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "./process";

/**
 * Reels autopilot: neither Instagram nor Composio schedules posts, so the operating system opens
 * CutRoom at the right time (Task Scheduler on Windows, launchd on macOS) with SCHEDULE_FLAG and the
 * app publishes what is due. If the computer was off, the task runs when it comes back: up to 6 h
 * late it still posts; later than that it waits for the user, so nothing goes out of context.
 */
export const SCHEDULE_FLAG = "--publicar-reels";
export const LATE_LIMIT_MS = 6 * 60 * 60 * 1000;
const MIN_AHEAD_MS = 2 * 60 * 1000,
  MAX_AHEAD_MS = 120 * 24 * 60 * 60 * 1000;

export interface ScheduledReel {
  id: string;
  video: string;
  caption: string;
  account: string;
  at: string;
  status: "scheduled" | "publishing" | "published" | "late" | "failed" | "cancelled";
  error?: string;
  permalink?: string;
  /** Added by the autopilot (paused with it). */
  pilot?: boolean;
  title?: string;
}

/** Autopilot rule (Spec 3): N Reels per day (1 to 5), each at its own time, on the chosen days. */
export type PilotDays = "daily" | "alternate" | number[];
export interface PilotRule {
  times: string[];
  days: PilotDays;
}
export const DEFAULT_TIMES: Record<number, string[]> = {
  1: ["18:00"],
  2: ["12:00", "18:00"],
  3: ["09:00", "13:00", "18:00"],
  4: ["08:00", "12:00", "16:00", "20:00"],
  5: ["08:00", "11:00", "14:00", "17:00", "20:00"],
};
export const MIN_GAP_MINUTES = 60;

const minutesOf = (time: string) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) throw new Error(`Horário inválido: ${time}. Use HH:MM, por exemplo 18:00.`);
  return +m[1] * 60 + +m[2];
};

/** 1 to 5 times, sorted, at least 1 hour apart (two Reels too close compete with each other). */
export function validateTimes(times: string[]) {
  if (!times.length || times.length > 5) throw new Error("Escolha de 1 a 5 Reels por dia.");
  const sorted = [...new Set(times)].sort((a, b) => minutesOf(a) - minutesOf(b));
  if (sorted.length !== times.length) throw new Error("Dois Reels no mesmo horário: escolha horários diferentes.");
  for (let i = 1; i < sorted.length; i++)
    if (minutesOf(sorted[i]) - minutesOf(sorted[i - 1]) < MIN_GAP_MINUTES)
      throw new Error(`Deixe pelo menos 1 hora entre dois Reels do mesmo dia (${sorted[i - 1]} e ${sorted[i]} estão muito perto).`);
  return sorted;
}

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function dayAllowed(day: Date, days: PilotDays, start: Date) {
  if (days === "daily") return true;
  if (days === "alternate") {
    const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const b = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
    return Math.round((b - a) / 864e5) % 2 === 0;
  }
  return days.includes(day.getDay());
}

/**
 * The next `count` free slots of the rule after `now`, skipping slots already taken (same minute) and
 * days the user skipped. Order: day by day, time by time.
 */
export function planSlots(count: number, rule: PilotRule, now = new Date(), options: { taken?: number[]; skip?: string[]; from?: Date } = {}) {
  const times = validateTimes(rule.times).map(minutesOf);
  if (Array.isArray(rule.days) && !rule.days.length) throw new Error("Marque pelo menos um dia da semana.");
  const taken = new Set((options.taken ?? []).map((t) => Math.floor(t / 60000)));
  const skip = new Set(options.skip ?? []);
  const start = options.from ?? now;
  const first = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const out: Date[] = [];
  for (let offset = 0; out.length < count && offset < 400; offset++) {
    const day = new Date(first);
    day.setDate(first.getDate() + offset);
    if (!dayAllowed(day, rule.days, first) || skip.has(dayKey(day))) continue;
    for (const minutes of times) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
      if (at.getTime() < now.getTime() + MIN_AHEAD_MS || taken.has(Math.floor(at.getTime() / 60000))) continue;
      out.push(at);
      if (out.length === count) break;
    }
  }
  return out;
}

/** How many days the queue lasts at the rule's pace (for "Sua fila acaba em X dias"). */
export function queueEndsAt(entries: { at: string; status: string }[]) {
  const left = entries.filter((e) => e.status === "scheduled").map((e) => new Date(e.at).getTime());
  return left.length ? new Date(Math.max(...left)) : undefined;
}

/** ISO ("2026-11-08T18:00") or "2026-11-08 18:00" in local time. */
export function parseWhen(value: string, now = new Date()) {
  const raw = String(value ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(raw);
  const date = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : new Date(raw);
  if (!raw || Number.isNaN(date.getTime())) throw new Error("Data inválida. Use, por exemplo, 2026-11-08 18:00.");
  if (date.getTime() < now.getTime() + MIN_AHEAD_MS) throw new Error("Agende para pelo menos 2 minutos no futuro.");
  if (date.getTime() > now.getTime() + MAX_AHEAD_MS) throw new Error("Agende para no máximo 120 dias à frente.");
  return date;
}

/** A daily series: one Reel per day at `time` (HH:MM), starting at the first such time after now. */
export function dailySlots(count: number, time: string, now = new Date(), everyDays = 1) {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) throw new Error("Horário inválido. Use HH:MM, por exemplo 18:00.");
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2]);
  if (first.getTime() < now.getTime() + MIN_AHEAD_MS) first.setDate(first.getDate() + 1);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(first);
    d.setDate(first.getDate() + i * Math.max(1, everyDays));
    return d;
  });
}

/** Due entries: "post" goes out now, "late" passed the limit and waits for the user. */
export function dueReels(entries: ScheduledReel[], now = Date.now()) {
  return entries
    .filter((e) => e.status === "scheduled" && new Date(e.at).getTime() <= now)
    .map((e) => ({ id: e.id, late: now - new Date(e.at).getTime() > LATE_LIMIT_MS }));
}

const pad = (n: number) => String(n).padStart(2, "0");
const localStamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const quote = (a: string) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

/** Current-user task, no admin; StartWhenAvailable runs it later if the PC was off. */
export function windowsTaskXml(at: Date, exe: string, args: string[]) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>CutRoom: publicar um Reels agendado no Instagram</Description></RegistrationInfo>
  <Triggers><TimeTrigger><StartBoundary>${localStamp(at)}</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>${xml(exe)}</Command><Arguments>${xml(args.map(quote).join(" "))}</Arguments></Exec></Actions>
</Task>
`;
}

export function macPlist(label: string, at: Date, exe: string, args: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key><array>${[exe, ...args].map((a) => `<string>${xml(a)}</string>`).join("")}</array>
  <key>StartCalendarInterval</key><dict>
    <key>Month</key><integer>${at.getMonth() + 1}</integer><key>Day</key><integer>${at.getDate()}</integer>
    <key>Hour</key><integer>${at.getHours()}</integer><key>Minute</key><integer>${at.getMinutes()}</integer>
  </dict>
</dict></plist>
`;
}

/** Registers / removes the OS wake-up for one scheduled Reel. Failures are reported, never fatal. */
export class OsReelScheduler {
  constructor(
    private exe: string,
    private args: string[] = [SCHEDULE_FLAG],
  ) {}
  private name(id: string) {
    return `CutRoom\\reel-${id}`;
  }
  async add(id: string, at: Date) {
    if (process.platform === "win32") {
      const file = join(tmpdir(), `cutroom-reel-${id}.xml`);
      // schtasks wants the XML in UTF-16 LE with BOM.
      await writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(windowsTaskXml(at, this.exe, this.args), "utf16le")]));
      try {
        await runProcess("schtasks", ["/Create", "/TN", this.name(id), "/XML", file, "/F"]);
      } finally {
        await rm(file, { force: true });
      }
    } else if (process.platform === "darwin") {
      const dir = join(homedir(), "Library", "LaunchAgents"),
        label = `app.cutroom.reel.${id}`,
        file = join(dir, `${label}.plist`);
      await mkdir(dir, { recursive: true });
      await writeFile(file, macPlist(label, at, this.exe, this.args), "utf8");
      await runProcess("launchctl", ["load", file]).catch(() => undefined);
    }
  }
  async remove(id: string) {
    if (process.platform === "win32") await runProcess("schtasks", ["/Delete", "/TN", this.name(id), "/F"]).catch(() => undefined);
    else if (process.platform === "darwin") {
      const file = join(homedir(), "Library", "LaunchAgents", `app.cutroom.reel.${id}.plist`);
      await runProcess("launchctl", ["unload", file]).catch(() => undefined);
      await rm(file, { force: true });
    }
  }
}
