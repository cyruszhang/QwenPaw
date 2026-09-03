import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import type { DataSourceMetadata } from "./api";
import { createEngineApi, type CronJob } from "./engineApi";
import { useT } from "./language";
import { PageHeader } from "./PageHeader";
import type { PawAppSdk } from "./sdk";

export function describeSchedule(job: CronJob): string {
  const schedule = job.schedule;
  if (schedule.type === "once") {
    const at = schedule.run_at ? new Date(schedule.run_at) : null;
    return at ? at.toLocaleString() : "once";
  }
  return `cron: ${schedule.cron ?? ""} (${schedule.timezone})`;
}

/**
 * Console cron jobs: recurring or one-shot analyses the engine runs
 * unattended through the same session/chat runtime as interactive turns.
 * IM-channel delivery needs a bound channel target and stays out of this
 * page; jobs created here always deliver to the console session.
 */
export function CronJobs({
  paw,
  sources,
}: {
  paw: PawAppSdk;
  sources: DataSourceMetadata[];
}) {
  const t = useT();
  const engine = useMemo(() => createEngineApi(paw), [paw]);
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyJobId, setBusyJobId] = useState("");
  const [creating, setCreating] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [datasourceId, setDatasourceId] = useState("");
  const [cron, setCron] = useState("0 9 * * *");

  const load = useCallback(async () => {
    setError("");
    try {
      setJobs(await engine.listCronJobs());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [engine]);

  useEffect(() => {
    void load();
  }, [load]);

  async function withJob(jobId: string, action: () => Promise<unknown>) {
    setBusyJobId(jobId);
    setError("");
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyJobId("");
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !message.trim() || !datasourceId) return;
    setCreating(true);
    setError("");
    try {
      await engine.createCronJob({
        name: name.trim(),
        message: message.trim(),
        datasource_id: datasourceId,
        channel: "console",
        schedule: { type: "cron", cron, timezone: "Asia/Shanghai" },
      });
      setName("");
      setMessage("");
      setFormOpen(false);
      await load();
      await paw.toast(t("cron.toast.created"), "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="qwenpaw-data-cron" aria-label={t("cron.aria")}>
      <PageHeader
        eyebrow={t("cron.eyebrow")}
        title={t("cron.title")}
        description={t("cron.description")}
        actions={
          <button
            type="button"
            className="qwenpaw-data-primary-button"
            onClick={() => setFormOpen((open) => !open)}
          >
            {formOpen ? t("cron.form.cancel") : t("cron.newJob")}
          </button>
        }
      />
      {error ? <div className="qwenpaw-data-cron__error">{error}</div> : null}
      {formOpen ? (
        <form className="qwenpaw-data-cron__form" onSubmit={handleCreate}>
          <label>
            <span>{t("cron.form.name")}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("cron.form.namePlaceholder")}
              required
            />
          </label>
          <label>
            <span>{t("cron.form.message")}</span>
            <textarea
              value={message}
              rows={2}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={t("cron.form.messagePlaceholder")}
              required
            />
          </label>
          <label>
            <span>{t("cron.form.datasource")}</span>
            <select
              value={datasourceId}
              onChange={(event) => setDatasourceId(event.target.value)}
              required
            >
              <option value="" disabled>
                {t("cron.form.datasourcePlaceholder")}
              </option>
              {sources.map((source) => (
                <option key={source.datasource_id} value={source.datasource_id}>
                  {source.datasource_name || source.datasource_id}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("cron.form.schedule")}</span>
            <input
              value={cron}
              onChange={(event) => setCron(event.target.value)}
              placeholder="0 9 * * *"
              required
            />
            <small>{t("cron.form.scheduleHint")}</small>
          </label>
          <div className="qwenpaw-data-cron__form-actions">
            <button
              type="submit"
              className="qwenpaw-data-primary-button"
              disabled={creating || !name.trim() || !message.trim() || !datasourceId}
            >
              {creating ? t("cron.form.creating") : t("cron.form.create")}
            </button>
          </div>
        </form>
      ) : null}
      {loading ? (
        <p className="qwenpaw-data-cron__empty">{t("cron.loading")}</p>
      ) : jobs.length === 0 ? (
        <p className="qwenpaw-data-cron__empty">{t("cron.empty")}</p>
      ) : (
        <ul className="qwenpaw-data-cron__list">
          {jobs.map((job) => (
            <li key={job.id} className={job.enabled ? "" : "is-paused"}>
              <div className="qwenpaw-data-cron__job">
                <b>{job.name}</b>
                <small>{describeSchedule(job)}</small>
                <p>{job.message}</p>
                <small>
                  {t("cron.jobMeta", {
                    datasource: job.datasource_id,
                    status: job.enabled
                      ? t("cron.status.active")
                      : t("cron.status.paused"),
                  })}
                </small>
              </div>
              <div className="qwenpaw-data-cron__actions">
                <button
                  type="button"
                  disabled={busyJobId === job.id}
                  onClick={() =>
                    void withJob(job.id, () =>
                      job.enabled
                        ? engine.pauseCronJob(job.id)
                        : engine.resumeCronJob(job.id),
                    )
                  }
                >
                  {job.enabled ? t("cron.action.pause") : t("cron.action.resume")}
                </button>
                <button
                  type="button"
                  disabled={busyJobId === job.id}
                  onClick={() =>
                    void withJob(job.id, async () => {
                      await engine.runCronJob(job.id);
                      await paw.toast(t("cron.toast.ran"), "success");
                    })
                  }
                >
                  {t("cron.action.run")}
                </button>
                <button
                  type="button"
                  className="is-danger"
                  disabled={busyJobId === job.id}
                  onClick={() =>
                    void withJob(job.id, () => engine.deleteCronJob(job.id))
                  }
                >
                  {t("cron.action.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
