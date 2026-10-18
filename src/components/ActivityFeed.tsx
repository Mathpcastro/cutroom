import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleStop,
  CircleAlert,
  LoaderCircle,
} from "lucide-react";
import type { AppSnapshot } from "../shared/types";

const labels = {
  running: "Em andamento",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
};
export function ActivityFeed({
  state,
  compact = false,
}: {
  state: AppSnapshot;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const activities = state.activities || [];
  const running =
    state.jobs.some((job) => job.status === "running") ||
    activities.some((activity) => activity.status === "running");
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const terminalRows = [
    ...state.jobs.map((job) => ({ type: "job" as const, item: job })),
    ...activities.map((activity) => ({
      type: "activity" as const,
      item: activity,
    })),
  ].sort(
    (a, b) =>
      Date.parse(a.item.finishedAt || a.item.startedAt || "1970-01-01") -
      Date.parse(b.item.finishedAt || b.item.startedAt || "1970-01-01"),
  );
  const newest = terminalRows.at(-1);
  const latestRunningActivity = activities
    .filter((activity) => activity.status === "running")
    .at(-1);
  const runningJobs = state.jobs.filter((job) => job.status === "running");
  const currentJob = runningJobs.at(-1);
  const activityRows = expanded
    ? activities.slice(-12).reverse()
    : !currentJob && latestRunningActivity
      ? [latestRunningActivity]
      : !running && !state.busy && newest?.type === "activity"
        ? [newest.item]
        : [];
  const jobRows = expanded
    ? [...state.jobs].reverse().slice(0, 8)
    : currentJob
      ? [currentJob]
      : !running && !state.busy && newest?.type === "job"
        ? [newest.item]
        : [];
  const latestSystem = state.messages
    .filter((message) => message.role === "system" && message.text.trim())
    .at(-1);
  const summary =
    !running &&
    !state.busy &&
    newest?.item.status === "completed" &&
    latestSystem &&
    Date.parse(latestSystem.createdAt) >=
      Date.parse(newest.item.startedAt || "1970-01-01") &&
    !/^\s*(erro|falh|não foi possível|cancelad)/i.test(latestSystem.text)
      ? latestSystem
      : undefined;
  const summaryAlreadyVisible =
    !!summary &&
    (jobRows.some((job) => job.label.trim() === summary.text.trim()) ||
      activityRows.some(
        (activity) =>
          activity.label.trim() === summary.text.trim() ||
          activity.detail?.trim() === summary.text.trim(),
      ));
  const rows = [
    ...jobRows.map((item) => ({ type: "job" as const, item })),
    ...activityRows.map((item) => ({ type: "activity" as const, item })),
  ];
  if (!rows.length && !state.busy) return null;
  if (!rows.length)
    rows.push({
      type: "activity",
      item: {
        id: "preparing",
        kind: "turn",
        label: "Preparando solicitação…",
        status: "running",
        startedAt: "",
      },
    });
  const icon = (status: string) =>
    status === "running" ? (
      <LoaderCircle size={14} className="spin" />
    ) : status === "completed" ? (
      <Check size={14} />
    ) : status === "failed" ? (
      <CircleAlert size={14} />
    ) : (
      <CircleStop size={14} />
    );
  return (
    <section
      className={`activity-feed ${compact ? "compact" : ""} ${!expanded ? (running || state.busy ? "is-live" : "is-idle") : ""}`}
      aria-label="Atividade em tempo real"
    >
      <div className="activity-feed-heading">
        <strong>
          {running || state.busy ? "Em execução" : "Última atividade"}
        </strong>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {expanded ? "Recolher" : "Histórico"}
          <ChevronDown size={12} />
        </button>
      </div>
      <div
        className="activity-feed-rows"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {rows.map((row) => {
          const item = row.item;
          const progress = row.type === "job" ? row.item.progress : undefined;
          const detail = row.type === "job" ? row.item.error : row.item.detail;
          const seconds = Math.max(
            0,
            Math.floor(
              ((item.finishedAt ? Date.parse(item.finishedAt) : now) -
                Date.parse(item.startedAt || "")) /
                1000,
            ),
          );
          return (
            <article
              className={`activity-row ${item.status}`}
              key={expanded ? `${row.type}:${item.id}` : "current"}
            >
              <div className="activity-icon">{icon(item.status)}</div>
              <div className="activity-copy">
                <strong title={item.label}>{item.label}</strong>
                <small>
                  {labels[item.status]}
                  {item.status === "running" &&
                  progress !== undefined &&
                  progress > 0
                    ? ` · ${Math.round(progress)}%`
                    : row.type === "activity" && Number.isFinite(seconds)
                      ? ` · ${seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}min ${seconds % 60}s`}`
                      : ""}
                </small>
                {item.status === "running" &&
                  (!expanded || row.type === "job") && (
                    <progress
                      max={100}
                      value={
                        progress !== undefined && progress > 0
                          ? progress
                          : undefined
                      }
                      aria-label={item.label}
                    />
                  )}
                {detail &&
                  (expanded ||
                    item.status === "failed" ||
                    row.type === "job") && <p>{detail}</p>}
              </div>
            </article>
          );
        })}
      </div>
      {expanded && summary && !summaryAlreadyVisible && (
        <div className="activity-result">
          <Check size={13} />
          <p>{summary.text}</p>
        </div>
      )}
    </section>
  );
}
