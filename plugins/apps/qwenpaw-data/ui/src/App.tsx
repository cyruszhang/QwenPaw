import { useEffect, useState } from "react";

import { Configure } from "./Configure";
import { EmbeddedDataConsole } from "./EmbeddedDataConsole";
import {
  LanguageProvider,
  resolveInitialLanguage,
} from "./language";
import type { PawAppSdk } from "./sdk";
import { type Language } from "./strings";

/**
 * The embedded engine console owns the entire app surface: navigation,
 * branding, language, model setup (Agent Configuration), and channels.
 * The only native remnant is the app-level configuration (context
 * service mode, restarts), which the console's settings menu requests
 * via postMessage and the shell renders as an overlay.
 */
const OPEN_APP_CONFIG_MESSAGE = "qwenpaw-data:open-app-config";

export function App({ paw }: { paw: PawAppSdk }) {
  const [configureOpen, setConfigureOpen] = useState(false);
  const [language, setLanguage] = useState<Language>(resolveInitialLanguage);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const type = (event.data as { type?: string } | null)?.type;
      if (type === OPEN_APP_CONFIG_MESSAGE) {
        // The console owns the language toggle; pick up its latest choice.
        setLanguage(resolveInitialLanguage());
        setConfigureOpen(true);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <LanguageProvider value={language}>
      <div className="qwenpaw-data-app">
        <main className="qwenpaw-data-main">
          <EmbeddedDataConsole route="/console" active={!configureOpen} />
          {configureOpen ? (
            <div className="qwenpaw-data-config-overlay">
              <button
                type="button"
                className="qwenpaw-data-config-overlay__close"
                aria-label={language === "zh" ? "关闭配置" : "Close configuration"}
                title={language === "zh" ? "关闭配置" : "Close configuration"}
                onClick={() => setConfigureOpen(false)}
              >
                ×
              </button>
              <Configure paw={paw} onRestart={() => undefined} />
            </div>
          ) : null}
        </main>
      </div>
    </LanguageProvider>
  );
}
