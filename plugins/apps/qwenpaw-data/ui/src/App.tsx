import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createQwenPawDataApi,
  type AppStatus,
} from "./api";
import { Configure } from "./Configure";
import { DataSources } from "./DataSources";
import { EmbeddedDataConsole } from "./EmbeddedDataConsole";
import { SettingsIcon } from "./icons";
import {
  LanguageProvider,
  persistLanguage,
  resolveInitialLanguage,
} from "./language";
import type { PawAppSdk } from "./sdk";
import type { PawDependencyAction, PawDependencySnapshot } from "./sdk";
import { buildAppStatusModel } from "./status";
import {
  translate,
  type Language,
  type StringKey,
  type StringParams,
} from "./strings";

/**
 * The embedded engine console is the app surface; it ships its own
 * navigation, branding, and a DataBridge entry that opens the Context
 * console in a full tab. The plugin shell is a logo-less action strip
 * hosting only what the console does not own: runtime health and the
 * plugin's own configuration.
 */
type Page = "analysis" | "configure" | "health";

/**
 * Same-origin static build of the Context console (vendored by
 * scripts/sync-context-ui.sh); opened in a full browser tab rather than
 * embedded — the console's own DataBridge button uses the same target.
 */
const CONTEXT_CONSOLE_URL =
  "/api/frontend_plugin/qwenpaw-data/files/ui/dist/context-console/index.html#/data-source";

export function App({ paw }: { paw: PawAppSdk }) {
  const api = useMemo(() => createQwenPawDataApi(paw), [paw]);
  const [page, setPage] = useState<Page>("analysis");
  const [consoleEpoch, setConsoleEpoch] = useState(0);
  const [language, setLanguage] = useState<Language>(resolveInitialLanguage);
  const [status, setStatus] = useState<AppStatus>();
  const [dependencies, setDependencies] = useState<PawDependencySnapshot>();
  const [selectedId, setSelectedId] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [sourcesUpdatedAt, setSourcesUpdatedAt] = useState<Date>();

  const loadSources = useCallback(
    async (background = false) => {
      setSourceError("");
      try {
        await api.listDataSources();
        setSourcesUpdatedAt(new Date());
      } catch (error) {
        setSourceError(error instanceof Error ? error.message : String(error));
      }
    },
    [api],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      api.status().then((nextStatus) => {
        if (!cancelled) {
          setStatus(nextStatus);
          setDependencies(nextStatus.dependencies);
        }
      }),
      paw.storage.get<string>("selected-source", "").then((stored) => {
        if (!cancelled) setSelectedId(stored || "");
      }),
      loadSources(),
    ]);
    return () => {
      cancelled = true;
    };
  }, [api, loadSources, paw.storage]);

  useEffect(() => {
    const interval = window.setInterval(() => void loadSources(true), 5_000);
    return () => window.clearInterval(interval);
  }, [loadSources]);

  useEffect(() => {
    const subscription = paw.dependencies.subscribe(setDependencies, {
      intervalMs: 10_000,
    });
    return () => subscription.dispose();
  }, [paw.dependencies]);

  async function runDependencyAction(
    dependencyId: string,
    action: PawDependencyAction,
  ) {
    if (action === "check") {
      await paw.dependencies.check(dependencyId);
    } else {
      await paw.dependencies.action(dependencyId, action, {
        idempotencyKey: `${dependencyId}:${action}:${Date.now()}`,
      });
    }
    setDependencies(await paw.dependencies.list(true));
  }

  /** Topbar buttons toggle: reselecting returns to the analysis console. */
  function togglePage(target: Page) {
    setPage((current) => (current === target ? "analysis" : target));
  }

  function openContextConsole() {
    window.open(CONTEXT_CONSOLE_URL, "_blank", "noopener,noreferrer");
  }

  async function toggleLanguage() {
    const next = language === "zh" ? "en" : "zh";
    persistLanguage(next);
    setLanguage(next);
    // The embedded console reads the language at boot; remount it.
    setConsoleEpoch((epoch) => epoch + 1);
    await paw.toast(
      next === "zh"
        ? "界面语言已切换为中文"
        : "Interface language set to English",
      "success",
    );
  }

  const t = (key: StringKey, params?: StringParams) =>
    translate(language, key, params);

  const statusModel = buildAppStatusModel(
    status,
    dependencies,
    selectedId,
    language,
  );

  return (
    <LanguageProvider value={language}>
      <div className="qwenpaw-data-app">
        <header className="qwenpaw-data-topbar">
          <div className="qwenpaw-data-topbar__actions">
            <button
              type="button"
              className={`qwenpaw-data-topbar__status is-${statusModel.tone} ${
                page === "health" ? "is-active" : ""
              }`}
              title={t("status.openDetails")}
              aria-label={t("status.openDetails")}
              onClick={() => togglePage("health")}
            >
              <i aria-hidden="true" />
              <span>{statusModel.label}</span>
            </button>
            <button
              type="button"
              className={`qwenpaw-data-topbar__icon ${
                page === "configure" ? "is-active" : ""
              }`}
              title={t("topbar.configuration")}
              aria-label={t("topbar.configuration")}
              onClick={() => togglePage("configure")}
            >
              <SettingsIcon size={18} />
            </button>
            <button
              type="button"
              title={language === "zh" ? "Switch to English" : "切换为中文"}
              aria-label="Switch language"
              onClick={() => void toggleLanguage()}
            >
              {language === "zh" ? "中" : "EN"}
            </button>
          </div>
        </header>
        <main className="qwenpaw-data-main">
          <div hidden={page !== "analysis"}>
            <EmbeddedDataConsole
              key={`data-${consoleEpoch}`}
              route="/console"
              active={page === "analysis"}
            />
          </div>
          {page === "configure" ? (
            <Configure paw={paw} onRestart={() => void loadSources()} />
          ) : null}
          {page === "health" ? (
            <DataSources
              selectedId={selectedId}
              error={sourceError}
              onReload={() => void loadSources()}
              onOpenManage={openContextConsole}
              lastUpdatedAt={sourcesUpdatedAt}
              dependencies={dependencies?.dependencies ?? []}
              onDependencyAction={runDependencyAction}
            />
          ) : null}
        </main>
      </div>
    </LanguageProvider>
  );
}
