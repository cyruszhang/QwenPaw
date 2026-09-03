import { describe, expect, it } from "vitest";

import { describeSchedule } from "./CronJobs";
import { createEngineApi, type CronJob } from "./engineApi";
import { orderedFieldEntries, settlementCardTitle } from "./SettlementPanel";
import type { PawAppSdk } from "./sdk";

interface RecordedCall {
  method: string;
  path: string;
  body?: unknown;
  options?: unknown;
}

function fakePaw(responses: Record<string, unknown>) {
  const calls: RecordedCall[] = [];
  const respond = (method: string, path: string) => {
    calls.push({ method, path });
    return Promise.resolve(responses[`${method} ${path.split("?")[0]}`] ?? {});
  };
  const paw = {
    api: {
      get: (path: string, options?: unknown) => {
        calls.push({ method: "GET", path, options });
        return Promise.resolve(responses[`GET ${path}`] ?? {});
      },
      post: (path: string, body?: unknown) => {
        calls.push({ method: "POST", path, body });
        return Promise.resolve(responses[`POST ${path}`] ?? {});
      },
      delete: (path: string) => respond("DELETE", path),
      patch: (path: string, body?: unknown) => {
        calls.push({ method: "PATCH", path, body });
        return Promise.resolve(responses[`PATCH ${path}`] ?? {});
      },
      download: () => Promise.resolve(new Blob()),
      events: () => {
        throw new Error("not used in these tests");
      },
    },
  } as unknown as PawAppSdk;
  return { paw, calls };
}

describe("settlement api wrappers", () => {
  it("lists cards with the pending poll filter", async () => {
    const { paw, calls } = fakePaw({
      "GET /engine/api/v1/sessions/ses_1/settlement/cards": {
        cards: [{ id: "card_1" }],
      },
    });
    const engine = createEngineApi(paw);
    const cards = await engine.listSettlementCards("ses_1", "pending");
    expect(cards).toEqual([{ id: "card_1" }]);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].options).toEqual({ query: { status: "pending" } });
  });

  it("confirms and dismisses through the card action routes", async () => {
    const { paw, calls } = fakePaw({
      "POST /engine/api/v1/sessions/ses_1/settlement/cards/card_1/confirm": {
        ok: true,
        card: { id: "card_1", status: "confirmed" },
      },
      "POST /engine/api/v1/sessions/ses_1/settlement/cards/card_1/dismiss": {
        ok: true,
        card: { id: "card_1", status: "dismissed" },
      },
    });
    const engine = createEngineApi(paw);
    const confirmed = await engine.confirmSettlementCard("ses_1", "card_1", {
      caliber: "YTD GAAP >= 10",
    });
    expect(confirmed.status).toBe("confirmed");
    expect(calls[0].body).toEqual({ fields: { caliber: "YTD GAAP >= 10" } });
    const dismissed = await engine.dismissSettlementCard("ses_1", "card_1");
    expect(dismissed.status).toBe("dismissed");
  });
});

describe("cron api wrappers", () => {
  it("creates console jobs and maps the actions to their routes", async () => {
    const { paw, calls } = fakePaw({
      "GET /engine/api/v1/cron/jobs": { jobs: [{ id: "cron_1" }] },
      "POST /engine/api/v1/cron/jobs": { job: { id: "cron_1" } },
      "POST /engine/api/v1/cron/jobs/cron_1/pause": {
        job: { id: "cron_1", enabled: false },
      },
      "POST /engine/api/v1/cron/jobs/cron_1/resume": {
        job: { id: "cron_1", enabled: true },
      },
    });
    const engine = createEngineApi(paw);
    expect(await engine.listCronJobs()).toEqual([{ id: "cron_1" }]);
    const created = await engine.createCronJob({
      name: "daily",
      message: "summarize",
      datasource_id: "postgresql-demo-gaap",
      channel: "console",
      schedule: { type: "cron", cron: "0 9 * * *", timezone: "Asia/Shanghai" },
    });
    expect(created.id).toBe("cron_1");
    expect((await engine.pauseCronJob("cron_1")).enabled).toBe(false);
    expect((await engine.resumeCronJob("cron_1")).enabled).toBe(true);
    await engine.runCronJob("cron_1");
    await engine.deleteCronJob("cron_1");
    const paths = calls.map((call) => `${call.method} ${call.path}`);
    expect(paths).toContain("POST /engine/api/v1/cron/jobs/cron_1/run");
    expect(paths).toContain("DELETE /engine/api/v1/cron/jobs/cron_1");
  });
});

describe("settlement card presentation", () => {
  it("derives titles per card type like the Cloud console", () => {
    expect(
      settlementCardTitle({
        type: "metric_caliber",
        fields: { metric_name: "avg GAAP" },
      }),
    ).toBe("avg GAAP");
    expect(
      settlementCardTitle({
        type: "column_meaning",
        fields: { table: "dws_gaap_di", column_name: "ytd_gaap" },
      }),
    ).toBe("dws_gaap_di.ytd_gaap");
    expect(settlementCardTitle({ type: "unknown", fields: {} })).toBe("");
  });

  it("orders fields canonically and drops blank values", () => {
    const entries = orderedFieldEntries({
      type: "metric_caliber",
      fields: {
        formula_sql: "AVG(x)",
        metric_name: "m",
        caliber: "",
        extra: "kept",
      },
    });
    expect(entries).toEqual([
      ["metric_name", "m"],
      ["formula_sql", "AVG(x)"],
      ["extra", "kept"],
    ]);
  });
});

describe("cron schedule description", () => {
  it("renders cron and one-shot schedules", () => {
    const base = {
      id: "cron_1",
      name: "n",
      enabled: true,
      message: "m",
      datasource_id: "d",
      channel: "console",
      created_at: "",
      updated_at: "",
    };
    const recurring: CronJob = {
      ...base,
      schedule: { type: "cron", cron: "0 9 * * mon", timezone: "Asia/Shanghai" },
    };
    expect(describeSchedule(recurring)).toBe(
      "cron: 0 9 * * mon (Asia/Shanghai)",
    );
    const once: CronJob = {
      ...base,
      schedule: {
        type: "once",
        run_at: "2026-09-04T09:00:00+08:00",
        timezone: "Asia/Shanghai",
      },
    };
    expect(describeSchedule(once)).not.toBe("once");
  });
});
