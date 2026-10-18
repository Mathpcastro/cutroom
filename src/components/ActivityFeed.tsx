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
  const activityRows = expanded
    ? activities.slice(-12).reverse()
    : latestRunningActivity
      ? [latestRunningActivity]
      : !running && !state.busy && newest?.type === "activity"
        ? [newest.item]
        : [];
  const runningJobs = state.jobs.filter((job) => job.status === "running");
  const jobRows = expanded
    ? [...state.jobs].reverse().slice(0, 8)
    : runningJobs.length
      ? runningJobs
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
  if (!jobRows.length && !activityRows.length && !state.busy) return null;
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
      className={`activity-feed ${compact ? "compact" : ""} ${!running && !state.busy && !expanded ? "is-idle" : ""}`}
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
        {jobRows.map((job) => (
          <article className={`activity-row ${job.status}`} key={job.id}>
            <div className="activity-icon">{icon(job.status)}</div>
            <div className="activity-copy">
              <strong>{job.label}</strong>
              <small>
                {labels[job.status]}
                {job.status === "running" && job.progress > 0
                  ? ` · ${Math.round(job.progress)}%`
                  : ""}
              </small>
              {job.status === "running" && (
                <progress
                  max={100}
                  value={job.progress > 0 ? job.progress : undefined}
                  aria-label={job.label}
                />
              )}
              {job.error && <p>{job.error}</p>}
            </div>
          </article>
        ))}
        {activityRows.map((activity) => {
          const seconds = Math.max(
            0,
            Math.floor(
              ((activity.finishedAt ? Date.parse(activity.finishedAt) : now) -
                Date.parse(activity.startedAt)) /
                1000,
            ),
          );
          return (
            <article
              className={`activity-row ${activity.status}`}
              key={activity.id}
            >
              <div className="activity-icon">{icon(activity.status)}</div>
              <div className="activity-copy">
                <strong>{activity.label}</strong>
                <small>
                  {labels[activity.status]}
                  {Number.isFinite(seconds)
                    ? ` · ${seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}min ${seconds % 60}s`}`
                    : ""}
                </small>
                {activity.detail &&
                  (expanded ||
                    activity.status === "running" ||
                    activity.status === "failed") && <p>{activity.detail}</p>}
              </div>
            </article>
          );
        })}
        {!jobRows.length && !activityRows.length && state.busy && (
          <article className="activity-row running">
            <LoaderCircle size={14} className="spin" />
            <div className="activity-copy">
              <strong>Preparando solicitação…</strong>
              <small>Aguardando evento do processo local</small>
            </div>
          </article>
        )}
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
