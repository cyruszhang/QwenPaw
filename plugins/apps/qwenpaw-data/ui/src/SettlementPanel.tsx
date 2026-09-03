import { useCallback, useEffect, useRef, useState } from "react";

import type { SettlementCard } from "./engineApi";
import { useT } from "./language";
import type { StringKey } from "./strings";

const POLL_INTERVAL_MS = 20_000;

const TYPE_LABEL_KEYS: Record<string, StringKey> = {
  metric_caliber: "settlement.type.metricCaliber",
  dimension_def: "settlement.type.dimensionDef",
  column_meaning: "settlement.type.columnMeaning",
  dataset_usage: "settlement.type.datasetUsage",
};

/** Canonical field order per card type, mirroring the Cloud console UX. */
const FIELD_ORDER: Record<string, string[]> = {
  metric_caliber: ["metric_name", "caliber", "domain", "table", "formula_sql"],
  dimension_def: [
    "dimension_name",
    "bind_column",
    "value_samples",
    "domain",
    "table",
  ],
  column_meaning: ["column_name", "meaning", "table", "domain"],
  dataset_usage: ["use_case", "recommended_dataset", "domain"],
};

export function settlementCardTitle(card: {
  type: string;
  fields?: Record<string, string>;
}): string {
  const fields = card.fields ?? {};
  switch (card.type) {
    case "metric_caliber":
      return fields.metric_name || "";
    case "dimension_def":
      return fields.dimension_name || "";
    case "column_meaning":
      return fields.column_name
        ? `${fields.table ? `${fields.table}.` : ""}${fields.column_name}`
        : "";
    case "dataset_usage":
      return fields.use_case || fields.recommended_dataset || "";
    default:
      return "";
  }
}

export function orderedFieldEntries(card: {
  type: string;
  fields?: Record<string, string>;
}): Array<[string, string]> {
  const fields = card.fields ?? {};
  const preferred = FIELD_ORDER[card.type] ?? [];
  const keys = [...new Set([...preferred, ...Object.keys(fields)])];
  return keys
    .filter((key) => String(fields[key] ?? "").trim())
    .map((key) => [key, fields[key] ?? ""]);
}

export interface SettlementApi {
  listSettlementCards(
    sessionId: string,
    status?: string,
  ): Promise<SettlementCard[]>;
  confirmSettlementCard(
    sessionId: string,
    cardId: string,
    fields?: Record<string, string>,
  ): Promise<SettlementCard>;
  dismissSettlementCard(
    sessionId: string,
    cardId: string,
  ): Promise<SettlementCard>;
}

/**
 * Knowledge-settlement cards for the active session.
 *
 * The engine's detector proposes durable business knowledge (metric
 * calibers, dimension definitions, ...) after completed turns; the panel
 * polls the `status=pending` endpoint, whose contract also returns
 * previously queried-but-unanswered cards, and lets the analyst confirm
 * (triggering the CM write-back) or dismiss each proposal.
 */
export function SettlementPanel({
  api,
  sessionId,
  refreshToken,
  onError,
}: {
  api: SettlementApi;
  sessionId: string;
  /** Bump to force an immediate refresh (e.g. when a turn completes). */
  refreshToken: number;
  onError?(error: unknown): void;
}) {
  const t = useT();
  const [cards, setCards] = useState<SettlementCard[]>([]);
  const [busyCardId, setBusyCardId] = useState("");
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setCards([]);
      return;
    }
    try {
      const next = await api.listSettlementCards(sessionId, "pending");
      if (sessionRef.current === sessionId) setCards(next);
    } catch (error) {
      onError?.(error);
    }
  }, [api, sessionId, onError]);

  useEffect(() => {
    setCards([]);
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh, refreshToken]);

  async function resolve(card: SettlementCard, action: "confirm" | "dismiss") {
    setBusyCardId(card.id);
    try {
      if (action === "confirm") {
        await api.confirmSettlementCard(sessionId, card.id);
      } else {
        await api.dismissSettlementCard(sessionId, card.id);
      }
      setCards((current) => current.filter((item) => item.id !== card.id));
    } catch (error) {
      onError?.(error);
    } finally {
      setBusyCardId("");
    }
  }

  if (!cards.length) return null;

  return (
    <section
      className="qwenpaw-data-settlement"
      aria-label={t("settlement.aria")}
    >
      <header>
        <b>{t("settlement.title")}</b>
        <small>{t("settlement.subtitle")}</small>
      </header>
      <ul>
        {cards.map((card) => {
          const labelKey = TYPE_LABEL_KEYS[card.type];
          const title = settlementCardTitle(card);
          return (
            <li key={card.id}>
              <div className="qwenpaw-data-settlement__type">
                <em>{labelKey ? t(labelKey) : card.type}</em>
                {title ? <b>{title}</b> : null}
              </div>
              <dl>
                {orderedFieldEntries(card).map(([name, value]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="qwenpaw-data-settlement__actions">
                <button
                  type="button"
                  disabled={busyCardId === card.id}
                  onClick={() => void resolve(card, "confirm")}
                >
                  {t("settlement.confirm")}
                </button>
                <button
                  type="button"
                  className="is-secondary"
                  disabled={busyCardId === card.id}
                  onClick={() => void resolve(card, "dismiss")}
                >
                  {t("settlement.dismiss")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
