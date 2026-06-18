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
