import { test, expect, Page } from "@playwright/test";
import * as path from "path";
import { pathToFileURL } from "url";

// Loads the REAL built panel (../dist/index.js) in the mock host
// (harness.html) and drives it with mocked /api/creator responses. This
// is the loop's runtime sanity check: it catches "builds but doesn't
// render / doesn't behave" regressions that tsc + unit tests miss.

const harnessUrl = pathToFileURL(path.join(__dirname, "harness.html")).href;

const DRAFT = {
  project_id: "demo",
  global_config: {},
  assets: {
    characters: [{ id: "boy", description: "a young boy" }],
    props: [],
    scene_refs: [{ id: "dock", description: "a wooden dock" }],
    style: { catalog_id: "" },
  },
  scenes: [
    {
      id: "00",
      name: "open",
      duration: 8,
      scene_description: "a boy on a dock",
      has_narration: true,
      narration: "Once, by the sea...",
      motion_prompt: "slow push-in",
      uses_characters: ["boy"],
      uses_props: [],
      uses_scene_ref: "dock",
    },
    {
      id: "01",
      name: "storm",
      duration: 10,
      scene_description: "waves rise",
      uses_characters: ["boy"],
    },
  ],
};

const FORECAST = {
  total_usd: 1,
  stage_0_usd: 0.5,
  stage_2_usd: 0.3,
  stage_3_usd: 0.2,
  breakdown: { characters: 1, props: 0, scene_refs: 1, scenes: 2 },
};

const DIRECTOR_RESP = {
  ok: true,
  project_id: "demo",
  draft: DRAFT,
  summary: "Set scene 00 at dusk and gave the boy a red jacket.",
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
          { id: "demo", title: "Demo project", updated_at: "2026-06-17" },
        ],
      });
    if (p === "/styles") return json({ styles: [] });
    if (p === "/projects/demo" && method === "GET")
      return json({ meta: { title: "Demo project" }, draft: DRAFT });
    if (p === "/projects/demo/cost-forecast") return json(FORECAST);
    if (p === "/projects/demo/status") return json({ stages: {} });
    if (p === "/projects/demo/director" && method === "POST")
      return json(DIRECTOR_RESP);
    // Anything else: empty 200 so no call hangs or throws.
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

  // The bundle registered its route and rendered the real UI.
  await expect(page.locator("#harness-error")).toHaveCount(0);
  await expect(page.getByText("Demo project")).toBeVisible();
  expect(errors, "uncaught page errors:\n" + errors.join("\n")).toEqual([]);
});

test("selecting a project renders the scene workspace without errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page);
  await page.goto(harnessUrl);

  await page.getByText("Demo project").click();

  // The draft workspace mounts: the stage accordion + scene-count summary
  // from the loaded draft (2 scenes) are rendered.
  await expect(page.getByText("Meta settings")).toBeVisible();
  await expect(page.getByText(/2 scenes/)).toBeVisible();
  expect(errors, "uncaught page errors:\n" + errors.join("\n")).toEqual([]);
});

test("director chat applies an instruction and shows the changelog", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page);
  await page.goto(harnessUrl);

  await page.getByText("Demo project").click();

  // The Director panel renders for a scene-bearing project.
  await expect(page.getByText("Director").first()).toBeVisible();

  await page
    .getByPlaceholder(/dusk/i)
    .fill("make scene 1 at dusk and give the boy a red jacket");
  await page.getByRole("button", { name: "Send" }).click();

  // The transcript shows the summary + a changed-scene chip ("00 open").
  await expect(page.getByText(/Set scene 00 at dusk/)).toBeVisible();
  await expect(page.getByText("00 open")).toBeVisible();
  expect(errors, "uncaught page errors:\n" + errors.join("\n")).toEqual([]);
});
