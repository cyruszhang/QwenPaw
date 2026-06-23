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

const DONE_DRAFT = {
  ...DRAFT,
  scenes: DRAFT.scenes.map((s) => ({ ...s, has_narration: true })),
};

const DONE_STATUS = {
  stages: {
    "0": { refs: [{ name: "boy.png" }, { name: "dock.png" }] },
    "1": {
      audio: DONE_DRAFT.scenes.map((s) => ({
        name: `${s.id}_${s.name}_narration.mp3`,
        size: 100,
        mtime: 1500,
      })),
    },
    "2": {
      frames: DONE_DRAFT.scenes.map((s) => ({
        name: `${s.id}_${s.name}_frame.png`,
        size: 100,
        mtime: 1000,
      })),
    },
    "3": {
      shots: DONE_DRAFT.scenes.map((s) => ({
        name: `${s.id}_${s.name}_raw.mp4`,
        size: 200,
        mtime: 2000,
      })),
    },
    "4": { final: [{ name: "demo_final.mp4", size: 300, mtime: 3000 }] },
  },
};

const STALE_DONE_STATUS = {
  stages: {
    ...DONE_STATUS.stages,
    "2": {
      frames: DONE_STATUS.stages["2"].frames.map((frame, index) =>
        index === 0 ? { ...frame, mtime: 4000 } : frame,
      ),
    },
    "4": { final: [{ name: "demo_final.mp4", size: 300, mtime: 5000 }] },
  },
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
  // "00 · open" appears on the tile and the scope chip — first is the tile.
  await expect(page.getByText("00 · open").first()).toBeVisible();
  await expect(page.getByPlaceholder(/Change scene|Direct the/i)).toBeVisible();
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
    .getByPlaceholder(/Change scene|Direct the/i)
    .fill("make the opening at dusk and give the boy a red jacket");
  await page.getByRole("button", { name: "Direct" }).click();

  await expect(page.getByText(/Set the opening at dusk/)).toBeVisible();
  await page.screenshot({ path: shot("03-director.png"), fullPage: true });
  expect(errors, "uncaught page errors:\n" + errors.join("\n")).toEqual([]);
});

test("a multi-scene Director edit runs as one coherent render", async ({
  page,
}) => {
  // Regression: a Director change touching 2+ scenes used to fire
  // uncoordinated per-scene runs, so the shared busy/Stop state cleared the
  // moment the FIRST (fast) scene landed — while others were still
  // rendering. Now they share one coordinated run, so Stop stays up until
  // every touched scene finishes.
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
    if (p === "/projects/demo/director" && method === "POST")
      return j({
        ok: true,
        project_id: "demo",
        draft: DRAFT,
        summary: "Recut scenes 0 and 1.",
        changes: [
          { scene_id: "00", name: "open", fields: ["scene_description"] },
          { scene_id: "01", name: "storm", fields: ["scene_description"] },
        ],
      });
    if (p.endsWith("/stage") && method === "POST") {
      const body = route.request().postDataJSON() as { only_scene?: string };
      // Scene 00 lands fast; scene 01 stays in flight.
      const delay = String(body?.only_scene) === "01" ? 3000 : 200;
      await new Promise((r) => setTimeout(r, delay));
      return j({ ok: true });
    }
    return j({});
  });
  await page.goto(harnessUrl);
  await page.getByText("Old Man & The Sea").click();
  await page
    .getByPlaceholder(/Change scene|Direct the/i)
    .fill("recut the first two scenes");
  await page.getByRole("button", { name: "Direct" }).click();
  // Fast scene (00) has finished but the slow one (01) is still rendering —
  // Stop must still be available, proving a single coherent run.
  await page.waitForTimeout(1400);
  await expect(page.getByRole("button", { name: /Stop/ })).toBeVisible();
  await page.screenshot({ path: shot("10-director-multiscene.png") });
});

test("the Director is scene-scoped and re-renders frame + motion", async ({
  page,
}) => {
  // Scene-scoped by default (a tile is selected) with a "Whole film"
  // toggle, and a Director edit re-shoots the frame AND re-animates the
  // motion (Stage 2 then Stage 3) so the clip stays in sync.
  const stages: string[] = [];
  let directBody = "";
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
    if (p === "/projects/demo/director" && method === "POST") {
      directBody = route.request().postData() || "";
      return j({
        ok: true,
        project_id: "demo",
        draft: DRAFT,
        summary: "Made scene 00 at dusk.",
        changes: [{ scene_id: "00", name: "open", fields: ["x"] }],
      });
    }
    if (p.endsWith("/stage") && method === "POST") {
      const b = route.request().postDataJSON() as { stage?: string };
      stages.push(String(b?.stage));
      return j({ ok: true });
    }
    return j({});
  });
  await page.goto(harnessUrl);
  await page.getByText("Old Man & The Sea").click();

  // Default scope is the selected scene (00 · open) with a whole-film toggle.
  await expect(page.getByText("Directing:")).toBeVisible();
  await expect(page.getByRole("button", { name: /00 · open/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Whole film" })).toBeVisible();
  await page.screenshot({ path: shot("13-director-scope.png") });

  await page
    .getByPlaceholder(/Change scene|Direct the/i)
    .fill("make it at dusk");
  await page.getByRole("button", { name: "Direct" }).click();
  await expect(page.getByText(/Made scene 00 at dusk/)).toBeVisible();
  await page.waitForTimeout(600);
  // Scope hint reached the backend, and the change rendered BOTH stages.
  expect(directBody).toContain("Focus on scene 00");
  expect(stages).toContain("2");
  expect(stages).toContain("3");
});

test("Reel continuity changes save the ledger and rerender affected scenes", async ({
  page,
}) => {
  let currentDraft = JSON.parse(JSON.stringify(DRAFT));
  let savedDraft: any = null;
  const stagePosts: any[] = [];
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
      return j({ meta: { title: "Old Man & The Sea" }, draft: currentDraft });
    if (p === "/projects/demo" && method === "PUT") {
      savedDraft = (route.request().postDataJSON() as any).draft;
      currentDraft = savedDraft;
      return j({ ok: true });
    }
    if (p.endsWith("/cost-forecast")) return j(FORECAST);
    if (p.endsWith("/status") && p.startsWith("/projects/"))
      return j({ stages: {} });
    if (p.endsWith("/stage") && method === "POST") {
      stagePosts.push(route.request().postDataJSON());
      return j({ ok: true });
    }
    return j({});
  });

  await page.goto(harnessUrl);
  await page.getByText("Old Man & The Sea").click();

  await expect(page.getByText("Continuity")).toBeVisible();
  await page
    .getByPlaceholder(/Change scene|Direct the/i)
    .fill("from here on, he carries a blue umbrella");
  await page.getByRole("button", { name: "Change state", exact: true }).click();

  await expect(page.getByText("Apply as ongoing continuity?")).toBeVisible();
  await expect(page.getByText("00, 01, 02")).toBeVisible();
  await expect(
    page.locator('input[value="carries a blue umbrella"]'),
  ).toBeVisible();
  await page.screenshot({ path: shot("15-continuity-change.png") });

  await page.getByRole("button", { name: "Apply continuity change" }).click();
  await expect.poll(() => savedDraft?.state_changes?.length || 0).toBe(1);
  expect(savedDraft.state_changes[0]).toMatchObject({
    entity: "boy",
    at_scene: "00",
    add: [
      {
        id: "carries_a_blue_umbrella",
        title: "carries a blue umbrella",
        content: "carries a blue umbrella",
      },
    ],
  });
  await expect
    .poll(() => stagePosts.filter((p) => p.stage === "2").length)
    .toBe(3);
  await expect
    .poll(() => stagePosts.filter((p) => p.stage === "3").length)
    .toBe(3);
  expect(stagePosts.map((p) => p.only_scene).sort()).toEqual([
    "00",
    "00",
    "01",
    "01",
    "02",
    "02",
  ]);
  expect(stagePosts.every((p) => p.overwrite === true)).toBe(true);
});

test("the Director bar dictates speech into the note when supported", async ({
  page,
}) => {
  // Inject a fake Web Speech API before the bundle loads. Fake BOTH the
  // unprefixed and webkit names — the panel prefers SpeechRecognition.
  await page.addInitScript(() => {
    function Fake(this: Record<string, unknown>) {
      this.start = () => {
        setTimeout(() => {
          const onresult = this.onresult as ((e: unknown) => void) | null;
          const onend = this.onend as (() => void) | null;
          if (onresult)
            onresult({ results: [[{ transcript: "make it at dusk" }]] });
          if (onend) onend();
        }, 30);
      };
      this.stop = () => {
        const onend = this.onend as (() => void) | null;
        if (onend) onend();
      };
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = Fake;
    w.webkitSpeechRecognition = Fake;
  });
  await mockApi(page);
  await page.goto(harnessUrl);
  await page.getByText("Old Man & The Sea").click();
  const mic = page.getByRole("button", { name: "Dictate instruction" });
  await expect(mic).toBeVisible();
  await mic.click();
  await expect(page.getByPlaceholder(/Change scene|Direct the/i)).toHaveValue(
    /make it at dusk/,
  );
  await page.screenshot({ path: shot("14-voice-input.png") });
});

test("the mic is hidden when the browser has no speech API", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.webkitSpeechRecognition;
    delete w.SpeechRecognition;
  });
  await mockApi(page);
  await page.goto(harnessUrl);
  await page.getByText("Old Man & The Sea").click();
  // The Director input is there, but no mic button (graceful fallback).
  await expect(page.getByPlaceholder(/Change scene|Direct the/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Dictate instruction" }),
  ).toHaveCount(0);
});

test("a clip left stale by a frame re-shoot is flagged, not played", async ({
  page,
}) => {
  // Regression: re-shooting a frame (Stage 2) leaves the old motion clip
  // (Stage 3) on disk. The Reel used to still tag it "▶ clip" and play the
  // outdated video in the hero. With mtimes, a clip older than its frame is
  // "⟳ clip outdated" and the hero falls back to the new frame.
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
    if (p === "/projects/demo/status")
      return j({
        id: "demo",
        stages: {
          "2": {
            frames: [
              // scene 00 frame re-shot AFTER its clip -> stale clip
              { name: "00_open_frame.png", size: 100, mtime: 2000 },
              // scene 01 frame older than its clip -> valid clip
              { name: "01_storm_frame.png", size: 100, mtime: 500 },
            ],
          },
          "3": {
            shots: [
              { name: "00_open_raw.mp4", size: 200, mtime: 1000 },
              { name: "01_storm_raw.mp4", size: 200, mtime: 1500 },
            ],
          },
        },
      });
    return j({});
  });
  await page.goto(harnessUrl);
  await page.getByText("Old Man & The Sea").click();
  // Scene 00 (selected by default) has a stale clip → flagged, not "▶ clip".
  await expect(page.getByText("⟳ clip outdated")).toBeVisible();
  // Scene 01's clip is still valid → it keeps the play tag.
  await expect(page.getByText("▶ clip")).toBeVisible();
  // The hero must not play the stale clip (falls back to the frame).
  await expect(page.locator("video")).toHaveCount(0);
  await page.screenshot({ path: shot("11-stale-clip.png") });
});

test("Classic toggle restores the stage-accordion view", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page);
  await page.goto(harnessUrl);
  await page.getByText("Old Man & The Sea").click();
  const modeShell = page.getByTestId("creator-mode-shell");
  await expect(modeShell).toBeVisible();
  await expect(page.getByTestId("studio-view")).toBeVisible();
  await expect(page.getByTestId("classic-view")).toHaveCount(0);
  await page.waitForTimeout(220);
  const studioBox = await modeShell.boundingBox();

  await page.getByRole("tab", { name: "Classic", exact: true }).click();
  const classicBox = await modeShell.boundingBox();
  expect(classicBox?.width ?? 0).toBeCloseTo(studioBox?.width ?? 0, 0);
  await expect(page.getByTestId("studio-view")).toHaveCount(1);
  await expect(page.getByTestId("studio-view")).toBeHidden();
  await expect(page.getByTestId("classic-view")).toBeVisible();
  await expect(page.getByText("Meta settings")).toBeVisible();
  await expect(page.getByText("Storyboard", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run anchors" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run narration" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Run frames" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run motion" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run final" })).toBeVisible();
  await expect(page.getByText("Animate missing")).toHaveCount(0);
  await page.screenshot({ path: shot("04-classic.png"), fullPage: true });
  await page.getByRole("tab", { name: "Studio", exact: true }).click();
  await expect(page.getByTestId("studio-view")).toBeVisible();
  await expect(page.getByTestId("classic-view")).toBeHidden();
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

test("Reel CTA opens an intent gate with Storyboard, Animated, and Final", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page);
  await page.goto(harnessUrl);
  await page.getByText("Old Man & The Sea").click();

  await page
    .getByRole("button", { name: /storyboard/i })
    .first()
    .click();

  // One cost confirm before paid work, but now framed around user intent.
  await expect(page.getByText("Choose the next pass")).toBeVisible();
  await expect(page.getByText(/Storyboard draft/)).toBeVisible();
  await expect(page.getByText(/Animated reel/)).toBeVisible();
  await expect(page.getByText(/Final cut/)).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("06-budget-gate.png") });
  expect(errors, "uncaught page errors:\n" + errors.join("\n")).toEqual([]);
});

test("completed Reel shows ready state instead of zero-cost render choices", async ({
  page,
}) => {
  const stagePosts: unknown[] = [];
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
      return j({ projects: [{ id: "done", title: "Finished film" }] });
    if (p === "/styles") return j({ styles: [] });
    if (p === "/projects/done" && method === "GET")
      return j({ meta: { title: "Finished film" }, draft: DONE_DRAFT });
    if (p === "/projects/done/status") return j(DONE_STATUS);
    if (p.endsWith("/cost-forecast")) return j(FORECAST);
    if (p === "/projects/done/stage" && method === "POST") {
      stagePosts.push(route.request().postDataJSON());
      return j({ ok: true });
    }
    return j({});
  });
  await page.goto(harnessUrl);
  await page.getByText("Finished film").click();

  await expect(page.getByRole("button", { name: /Final ready/ })).toBeVisible();
  await page.getByRole("button", { name: /Final ready/ }).click();
  await expect(page.getByText("Final cut is ready").first()).toBeVisible();
  await expect(page.getByText(/No missing anchors/)).toBeVisible();
  await expect(page.getByText(/≈ \$0\.00/)).toHaveCount(0);
  await expect(page.getByText("Storyboard draft")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Tweak with Director/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Re-render anyway/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Re-render anyway/ }).click();
  await expect(page.getByText("Re-render final cut?")).toBeVisible();
  expect(stagePosts).toEqual([]);
  await page.getByRole("button", { name: /^Cancel$/ }).click();
  await expect(page.getByText("Re-render final cut?")).toHaveCount(0);

  await page.getByRole("button", { name: /Tweak with Director/ }).click();
  await expect(
    page.getByRole("button", { name: /Tweak with Director/ }),
  ).toBeHidden();
  await expect(page.getByPlaceholder(/Change scene/)).toBeFocused();

  await page.getByRole("button", { name: /Final ready/ }).click();
  await page.getByRole("button", { name: /Re-render anyway/ }).click();
  await page.getByRole("button", { name: /Re-render final cut/ }).click();
  await expect
    .poll(() => stagePosts)
    .toEqual([{ stage: "4", overwrite: true }]);
});

test("stale Reel clips hide no-op Storyboard and refresh with overwrite", async ({
  page,
}) => {
  const stagePosts: unknown[] = [];
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
      return j({ projects: [{ id: "stale", title: "Stale film" }] });
    if (p === "/styles") return j({ styles: [] });
    if (p === "/projects/stale" && method === "GET")
      return j({ meta: { title: "Stale film" }, draft: DONE_DRAFT });
    if (p === "/projects/stale/status") return j(STALE_DONE_STATUS);
    if (p.endsWith("/cost-forecast")) return j(FORECAST);
    if (p === "/projects/stale/stage" && method === "POST") {
      stagePosts.push(route.request().postDataJSON());
      return j({ ok: true });
    }
    return j({});
  });
  await page.goto(harnessUrl);
  await page.getByText("Stale film").click();

  await expect(page.getByText(/1 outdated/).first()).toBeVisible();
  await expect(page.getByText(/final outdated/).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Refresh clips/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Refresh clips/ }).click();

  await expect(page.getByText("Choose the next pass")).toBeVisible();
  await expect(page.getByText("Storyboard draft")).toHaveCount(0);
  await expect(page.getByText("Animated reel")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Final cut/ })).toBeVisible();
  await expect(page.getByText("Final cut is ready")).toHaveCount(0);
  await expect(page.getByText(/≈ \$0\.00/)).toHaveCount(0);

  await page.getByRole("button", { name: /Animated reel/ }).click();
  await expect
    .poll(() => stagePosts)
    .toEqual([{ stage: "3", only_scene: "00", overwrite: true }]);
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
  await page
    .getByRole("button", { name: /storyboard/i })
    .first()
    .click();
  await expect(page.getByText("Choose the next pass")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("09-budget-no-forecast.png") });
  // The deceptive "$0" must be gone; an honest fallback takes its place.
  await expect(page.getByText(/≈ \$0/)).toHaveCount(0);
  await expect(page.getByText(/estimate unavailable/).first()).toBeVisible();
});

test("a Shoot that produces no frame surfaces an error, not silent success", async ({
  page,
}) => {
  // Regression: Stage 2 used to return 200 even when it produced no image
  // (e.g. a scene whose Stage-0 references were never generated), so a
  // failed "Shoot" looked like "nothing happened". Now the backend 422s
  // and the UI shows it (toast + alert), even down in the Reel strip.
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
      return j({
        stages: {
          "0": { refs: [{ name: "boy.png" }, { name: "dock.png" }] },
        },
      });
    if (p.endsWith("/stage") && method === "POST")
      return route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          detail:
            "No frames were produced — generate the reference images " +
            "first (run the anchors / Stage 0). scene 00: no refs",
        }),
      });
    return j({});
  });
  await page.goto(harnessUrl);
  await page.getByText("Old Man & The Sea").click();
  await page.getByRole("button", { name: /Shoot/ }).first().click();
  // The failure is surfaced (the Alert title), not swallowed.
  await expect(page.getByText(/frame compose failed/i).first()).toBeVisible();
  await page.screenshot({ path: shot("12-shoot-error.png") });
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
  await page
    .getByRole("button", { name: /storyboard/i })
    .first()
    .click();
  await page.getByRole("button", { name: /Animated reel/ }).click();

  // The render is in flight → a Stop button appears; clicking it cancels.
  await expect(page.getByRole("button", { name: /Stop/ })).toBeVisible();
  await expect(page.getByText("Choose the next pass")).toBeHidden();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("07-rendering-stop.png") });
  await page.getByRole("button", { name: /Stop/ }).click();
  await expect.poll(() => calls).toContain("cancel");
});

test("Stop during an Animated render does not roll into the motion stage", async ({
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
      return j({
        stages: {
          "0": { refs: [{ name: "boy.png" }, { name: "dock.png" }] },
        },
      });
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
  await page
    .getByRole("button", { name: /storyboard/i })
    .first()
    .click();
  await page.getByRole("button", { name: /Animated reel/ }).click();
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
