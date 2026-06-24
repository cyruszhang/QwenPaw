// Ambient declarations for the QwenPaw console host API.
//
// At runtime the QwenPaw console injects a shared `window.QwenPaw`
// object; we externalize `react`/`react-dom` (see `vite.config.ts`)
// and pull React + antd off `host` instead of bundling them.

import type * as ReactNS from "react";

declare global {
  interface QwenPawHost {
    React: typeof ReactNS;
    antd: any;
    antdIcons?: any;
    getApiUrl: (path: string) => string;
    getApiToken: () => string;
  }

  interface QwenPawRoute {
    path: string;
    component: unknown;
    label?: string;
    icon?: ReactNS.ReactNode;
    priority?: number;
  }

  interface QwenPawGlobal {
    host: QwenPawHost;
    registerRoutes?: (pluginId: string, routes: QwenPawRoute[]) => void;
  }

  interface Window {
    QwenPaw: QwenPawGlobal;
  }
}

export {};
