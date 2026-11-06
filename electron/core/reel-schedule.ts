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
