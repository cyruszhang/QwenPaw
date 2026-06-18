import { test, expect, Page } from "@playwright/test";
import * as path from "path";
import { pathToFileURL } from "url";

// Loads the REAL built panel (../dist/index.js) in the mock host
// (harness.html) and drives it with mocked /api/creator responses. The
// loop's runtime sanity check: catches "builds but doesn't render /
// doesn't behave" regressions that tsc + unit tests miss.

const harnessUrl = pathToFileURL(path.join(__dirname, "harness.html")).href;

// Screenshots land in test/screenshots/ (committed) so they ride along in
// the PR for visual review. Every run regenerates them.
const shot = (name: string) => path.join(__dirname, "screenshots", name);

const DRAFT = {
  project_id: "demo",
  global_config: {},
  assets: {
    characters: [{ id: "boy", description: "a young fisherboy" }],
    props: [],
    scene_refs: [{ id: "dock", description: "a weathered wooden dock" }],
    style: { catalog_id: "" },
  },
  scenes: [
    {
      id: "00",
      name: "open",
      duration: 8,
      scene_description:
        "A boy stands alone at the end of a misty dock at dawn, looking out to sea.",
      uses_characters: ["boy"],
      uses_scene_ref: "dock",
    },
    {
      id: "01",
      name: "storm",
      duration: 12,
      scene_description:
        "Black clouds roll in; waves heave against the pilings as the boy grips the rail.",
      uses_characters: ["boy"],
    },
    {
      id: "02",
      name: "calm",
      duration: 9,
      scene_description:
        "The storm passes; gold light breaks over a flat, glassy sea.",
      uses_characters: ["boy"],
    },
  ],
};

const FORECAST = {
  total_usd: 2.4,
  stage_0_usd: 0.5,
  stage_2_usd: 0.9,
  stage_3_usd: 1.0,
  breakdown: { characters: 1, props: 0, scene_refs: 1, scenes: 3 },
};

const DIRECTOR_RESP = {
  ok: true,
  project_id: "demo",
  draft: DRAFT,
  summary: "Set the opening at dusk and gave the boy a red jacket.",
  changes: [
    {
      scene_id: "00",
      name: "open",
      fields: ["scene_description", "regen_notes"],
      reason: "dusk + red jacket",
    },
  ],
};

async function mockApi(page: Page): Promise<void> {
  await page.route("**/mock.local/api/creator/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^\/api\/creator/, "");
    const method = route.request().method();
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (p === "/status") return json({ has_dashscope: true, has_openai: true });
    if (p === "/projects" && method === "GET")
      return json({
        projects: [
          { id: "demo", title: "Old Man & The Sea" },
          { id: "fresh", title: "Fresh story" },
        ],
      });
    if (p === "/styles")
      return json({
        styles: [
          { id: "storybook", display_name: "Storybook", description: "soft" },
          { id: "noir", display_name: "Noir", description: "moody" },
          { id: "anime", display_name: "Anime", description: "bold" },
        ],
      });
    if (p === "/projects/demo" && method === "GET")
      return json({ meta: { title: "Old Man & The Sea" }, draft: DRAFT });
    if (p === "/projects/fresh" && method === "GET")
      return json({
        meta: { title: "Fresh story" },
        draft: {
          project_id: "fresh",
          scenes: [],
          beats: [],
          assets: { characters: [], props: [], scene_refs: [], style: {} },
          global_config: {},
        },
      });
    if (p.endsWith("/cost-forecast")) return json(FORECAST);
    if (p.endsWith("/status") && p.startsWith("/projects/"))
      return json({ stages: {} });
    if (p === "/projects/demo/director" && method === "POST")
      return json(DIRECTOR_RESP);
    return json({});
  });
}

test("panel boots in the mock host and lists projects without errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page);
  await page.goto(harnessUrl);

  await expect(page.locator("#harness-error")).toHaveCount(0);
  await expect(page.getByText("Old Man & The Sea")).toBeVisible();
  await page.screenshot({ path: shot("01-project-list.png") });
  expect(errors, "uncaught page errors:\n" + errors.join("\n")).toEqual([]);
});

test("The Reel (Studio) is the default project view", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page);
  await page.goto(harnessUrl);

  await page.getByText("Old Man & The Sea").click();

  // The Reel — not the stage accordion — is the default workspace.
  await expect(page.getByText("The Reel")).toBeVisible();
  await expect(page.getByText(/in motion/)).toBeVisible();
  await expect(page.getByText("00 · open")).toBeVisible();
  await expect(page.getByPlaceholder(/Direct the film/i)).toBeVisible();
  await page.screenshot({ path: shot("02-studio-reel.png"), fullPage: true });
  expect(errors, "uncaught page errors:\n" + errors.join("\n")).toEqual([]);
});

test("the Director bar re-shoots from the Reel", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page);
  await page.goto(harnessUrl);
  await page.getByText("Old Man & The Sea").click();

  await page
    .getByPlaceholder(/Direct the film/i)
    .fill("make the opening at dusk and give the boy a red jacket");
  await page.getByRole("button", { name: "Direct" }).click();

  await expect(page.getByText(/Set the opening at dusk/)).toBeVisible();
  await page.screenshot({ path: shot("03-director.png"), fullPage: true });
  expect(errors, "uncaught page errors:\n" + errors.join("\n")).toEqual([]);
});

test("Classic toggle restores the stage-accordion view", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page);
  await page.goto(harnessUrl);
  await page.getByText("Old Man & The Sea").click();

  await page.getByRole("button", { name: "Classic", exact: true }).click();
  await expect(page.getByText("Meta settings")).toBeVisible();
  await page.screenshot({ path: shot("04-classic.png"), fullPage: true });
  expect(errors, "uncaught page errors:\n" + errors.join("\n")).toEqual([]);
});

test("'Make my film' entry hides the dials behind Advanced", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page);
  await page.goto(harnessUrl);

  await page.getByText("Fresh story").click();

  // One CTA + a Vibe swatch; the 12 dials are hidden by default.
  await expect(page.getByText("Make your film")).toBeVisible();
  await page.screenshot({ path: shot("05-make-film.png"), fullPage: true });
  await expect(page.getByText("Make my film")).toBeVisible();
  await expect(page.getByText("Target duration (s)")).toBeHidden();

  // Advanced reveals the full form.
  await page.getByText(/Advanced options/).click();
  await expect(page.getByText("Target duration (s)")).toBeVisible();
  expect(errors, "uncaught page errors:\n" + errors.join("\n")).toEqual([]);
});

test("'Make my film' auto-chains decompose → craft", async ({ page }) => {
  const calls: string[] = [];
  await page.route("**/mock.local/api/creator/**", async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/api\/creator/, "");
    const method = route.request().method();
    const j = (b: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(b),
      });
    const emptyDraft = {
      project_id: "fresh",
      scenes: [],
      beats: [],
      assets: { characters: [], props: [], scene_refs: [], style: {} },
      global_config: {},
    };
    if (p === "/status") return j({ has_dashscope: true, has_openai: true });
    if (p === "/projects")
      return j({ projects: [{ id: "fresh", title: "Fresh story" }] });
    if (p === "/styles") return j({ styles: [] });
    if (p === "/projects/fresh" && method === "GET")
      return j({ meta: { title: "Fresh story" }, draft: emptyDraft });
    if (p.endsWith("/decompose") && method === "POST") {
      calls.push("decompose");
      return j({
        draft: { ...emptyDraft, beats: [{ id: "00", name: "open" }] },
      });
    }
    if (p.endsWith("/craft") && method === "POST") {
      calls.push("craft");
      return j({
        draft: {
          ...emptyDraft,
          beats: [{ id: "00", name: "open" }],
          scenes: [
            { id: "00", name: "open", duration: 8, scene_description: "x" },
          ],
        },
      });
    }
    if (p.endsWith("/cost-forecast")) return j(FORECAST);
    if (p.endsWith("/status") && p.startsWith("/projects/"))
      return j({ stages: {} });
    return j({});
  });
  await page.goto(harnessUrl);
  await page.getByText("Fresh story").click();
  await page.getByText("Make my film").click();

  // One click chains Pass 1 then Pass 2 — no manual beat-gate / craft step.
  await expect.poll(() => calls).toContain("decompose");
  await expect.poll(() => calls).toContain("craft");
});

test("Render film opens a budget gate with Draft vs Full", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page);
  await page.goto(harnessUrl);
  await page.getByText("Old Man & The Sea").click();

  await page.getByRole("button", { name: /Render film/ }).click();

  // One cost confirm before any paid render — Draft (frames) vs Full.
  await expect(page.getByText("Make the film?")).toBeVisible();
  await expect(page.getByText(/Draft — frames only/)).toBeVisible();
  await expect(page.getByText(/Full film/)).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("06-budget-gate.png") });
  expect(errors, "uncaught page errors:\n" + errors.join("\n")).toEqual([]);
});

test("budget gate never claims $0 when the cost forecast is unavailable", async ({
  page,
}) => {
  // Regression: if /cost-forecast fails, the gate used to render "≈ $0",
  // telling the user a paid render is free. It must say so honestly.
  await page.route("**/mock.local/api/creator/**", async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/api\/creator/, "");
    const method = route.request().method();
    const j = (b: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(b),
      });
    if (p === "/status") return j({ has_dashscope: true, has_openai: true });
    if (p === "/projects")
      return j({ projects: [{ id: "demo", title: "Old Man & The Sea" }] });
    if (p === "/styles") return j({ styles: [] });
    if (p === "/projects/demo" && method === "GET")
      return j({ meta: { title: "Old Man & The Sea" }, draft: DRAFT });
    if (p.endsWith("/cost-forecast"))
      return route.fulfill({ status: 500, body: "{}" }); // forecast failed
    if (p.endsWith("/status") && p.startsWith("/projects/"))
      return j({ stages: {} });
    return j({});
  });
  await page.goto(harnessUrl);
  await page.getByText("Old Man & The Sea").click();
  await page.getByRole("button", { name: /Render film/ }).click();
  await expect(page.getByText("Make the film?")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("09-budget-no-forecast.png") });
  // The deceptive "$0" must be gone; an honest fallback takes its place.
  await expect(page.getByText(/≈ \$0/)).toHaveCount(0);
  await expect(
    page.getByText(/cost estimate unavailable/).first(),
  ).toBeVisible();
});

test("Stop appears during render and cancels it", async ({ page }) => {
  const calls: string[] = [];
  await page.route("**/mock.local/api/creator/**", async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/api\/creator/, "");
    const method = route.request().method();
    const j = (b: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(b),
      });
    if (p === "/status") return j({ has_dashscope: true, has_openai: true });
    if (p === "/projects")
      return j({ projects: [{ id: "demo", title: "Old Man & The Sea" }] });
    if (p === "/styles") return j({ styles: [] });
    if (p === "/projects/demo" && method === "GET")
      return j({ meta: { title: "Old Man & The Sea" }, draft: DRAFT });
    if (p.endsWith("/cost-forecast")) return j(FORECAST);
    if (p.endsWith("/status") && p.startsWith("/projects/"))
      return j({ stages: {} });
    if (p.endsWith("/stage") && method === "POST") {
      calls.push("stage");
      await new Promise((r) => setTimeout(r, 3000)); // keep render in flight
      return j({ ok: true });
    }
    if (p.endsWith("/cancel") && method === "POST") {
      calls.push("cancel");
      return j({ ok: true, cancelling: true });
    }
    return j({});
  });
  await page.goto(harnessUrl);
  await page.getByText("Old Man & The Sea").click();
  await page.getByRole("button", { name: /Render film/ }).click();
  await page.getByRole("button", { name: /Full film/ }).click();

  // The render is in flight → a Stop button appears; clicking it cancels.
  await expect(page.getByRole("button", { name: /Stop/ })).toBeVisible();
  await expect(page.getByText("Make the film?")).toBeHidden();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("07-rendering-stop.png") });
  await page.getByRole("button", { name: /Stop/ }).click();
  await expect.poll(() => calls).toContain("cancel");
});

test("Stop during a Full render does not roll into the motion stage", async ({
  page,
}) => {
  // Regression: hitting Stop while frames (Stage 2) are rendering must not
  // proceed to the pricey motion step (Stage 3). The per-scene fan-out plus
  // the backend clearing its cancel flag per /stage POST means the client
  // brake is what actually stops it.
  const stages: string[] = [];
  await page.route("**/mock.local/api/creator/**", async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/api\/creator/, "");
    const method = route.request().method();
    const j = (b: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(b),
      });
    if (p === "/status") return j({ has_dashscope: true, has_openai: true });
    if (p === "/projects")
      return j({ projects: [{ id: "demo", title: "Old Man & The Sea" }] });
    if (p === "/styles") return j({ styles: [] });
    if (p === "/projects/demo" && method === "GET")
      return j({ meta: { title: "Old Man & The Sea" }, draft: DRAFT });
    if (p.endsWith("/cost-forecast")) return j(FORECAST);
    if (p.endsWith("/status") && p.startsWith("/projects/"))
      return j({ stages: {} });
    if (p.endsWith("/stage") && method === "POST") {
      const body = route.request().postDataJSON() as { stage?: string };
      stages.push(String(body?.stage));
      await new Promise((r) => setTimeout(r, 2500)); // keep frames in flight
      return j({ ok: true });
    }
    if (p.endsWith("/cancel") && method === "POST")
      return j({ ok: true, cancelling: true });
    return j({});
  });
  await page.goto(harnessUrl);
  await page.getByText("Old Man & The Sea").click();
  await page.getByRole("button", { name: /Render film/ }).click();
  await page.getByRole("button", { name: /Full film/ }).click();
  // Stop while the frame stage is still in flight.
  await page.getByRole("button", { name: /Stop/ }).click();
  // Let the in-flight frame batch resolve and give renderFilm a chance to
  // (wrongly) launch Stage 3 if the guard regressed.
  await page.waitForTimeout(4000);
  expect(stages).toContain("2");
  expect(stages).not.toContain("3");
});

test("a cost-forecast without a breakdown does not crash the panel", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/mock.local/api/creator/**", async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/api\/creator/, "");
    const j = (b: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(b),
      });
    if (p === "/status") return j({ has_dashscope: true, has_openai: true });
    if (p === "/projects")
      return j({ projects: [{ id: "demo", title: "Old Man & The Sea" }] });
    if (p === "/styles") return j({ styles: [] });
    if (p === "/projects/demo")
      return j({ meta: { title: "Old Man & The Sea" }, draft: DRAFT });
    if (p.endsWith("/cost-forecast")) return j({ total_usd: 1 }); // no breakdown
    if (p.endsWith("/status") && p.startsWith("/projects/"))
      return j({ stages: {} });
    return j({});
  });
  await page.goto(harnessUrl);
  await page.getByText("Old Man & The Sea").click();

  await expect(page.getByText("The Reel")).toBeVisible();
  await expect(page.locator("#harness-error")).toHaveCount(0);
  expect(errors, "uncaught page errors:\n" + errors.join("\n")).toEqual([]);
});
