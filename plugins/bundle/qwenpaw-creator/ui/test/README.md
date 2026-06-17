# Panel smoke harness (Playwright)

A runtime sanity check for the Creator console panel. It loads the **real
built bundle** (`../dist/index.js`) inside a faithful mock of the QwenPaw
console host and drives it with **mocked `/api/creator` responses** — no
backend, no API keys, no cost. It catches "builds but doesn't render /
doesn't behave" regressions that `tsc` and unit tests can't.

## Run

```bash
cd plugins/bundle/qwenpaw-creator/ui
npm install
npx playwright install chromium   # first time only (CI runs this too)
npm run test:e2e                  # builds the bundle, then runs the smoke tests
```

`test:e2e` runs `vite build` first so the harness always loads a fresh
`dist/index.js`.

## How it works

- `test/harness.html` — sets up `window.QwenPaw.host` from the installed
  React + antd + icons (exactly the contract the console provides at
  runtime: `host.{React, antd, antdIcons, getApiUrl, getApiToken}`),
  stubs `EventSource`, loads the built bundle, and renders the route the
  panel registers via `registerRoutes`.
- `test/smoke.spec.ts` — intercepts `**/mock.local/api/creator/**` with
  `page.route` and serves canned fixtures, then asserts the panel renders
  and behaves. Uncaught page errors fail the test.

## Extending it (per feature)

Each new panel feature should add an assertion here. Pattern:

1. Add/extend the mocked endpoint(s) in `mockApi()`.
2. Drive the UI (`getByText` / `getByRole` / `getByPlaceholder`) and
   assert the resulting DOM.

For SSE-driven features (live decompose, stage progress, cancel), push
events through the `EventSource` stub: the harness records instances on
`window.__esInstances`; call `inst.__emit({kind: "...", ...})` from
`page.evaluate` to simulate server events.
