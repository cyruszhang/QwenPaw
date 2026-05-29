// QwenPaw Creator console panel — full storybook-video workflow.
//
// Registered as a console route at /plugin/qwenpaw-creator/storybook
// via window.QwenPaw.registerRoutes. React and antd are provided by
// the host (vite externalizes them), so this bundle stays small.

import type * as ReactNS from "react";

const host = window.QwenPaw.host;
const React: typeof ReactNS = host.React;
const antd = host.antd;
const antdIcons = host.antdIcons ?? {};
const getApiUrl = host.getApiUrl;
const getApiToken = host.getApiToken;

const {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  List,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Steps,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message: antMessage,
} = antd;
const { Title, Paragraph, Text: AntText } = Typography;
const { TextArea } = Input;
const { Step } = Steps;

const {
  FileTextOutlined,
  CloudUploadOutlined,
  ScissorOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  CheckCircleTwoTone,
  ExclamationCircleOutlined,
} = antdIcons;

// ── auth helpers ─────────────────────────────────────────────────────

function getSelectedAgentId(): string | null {
  try {
    const raw =
      window.sessionStorage?.getItem("qwenpaw-agent-storage") ??
      window.localStorage?.getItem("qwenpaw-agent-storage");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const selected = parsed?.state?.selectedAgent;
    return typeof selected === "string" && selected ? selected : null;
  } catch {
    return null;
  }
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const t = getApiToken?.();
  if (t) headers.Authorization = `Bearer ${t}`;
  const agentId = getSelectedAgentId();
  if (agentId) headers["X-Agent-Id"] = agentId;
  return headers;
}

async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(getApiUrl(path), { headers: authHeaders() });
  const txt = await res.text();
  let data: any;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = { raw: txt };
  }
  if (!res.ok) {
    throw new Error(typeof data?.detail === "string" ? data.detail : txt);
  }
  return data;
}

async function apiJson<T = any>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: object,
): Promise<T> {
  const res = await fetch(getApiUrl(path), {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const txt = await res.text();
  let data: any;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = { raw: txt };
  }
  if (!res.ok) {
    throw new Error(typeof data?.detail === "string" ? data.detail : txt);
  }
  return data;
}

async function apiUpload(
  path: string,
  file: File,
  fields: Record<string, string> = {},
): Promise<any> {
  const fd = new FormData();
  fd.append("file", file);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(getApiUrl(path), {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  const txt = await res.text();
  let data: any;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = { raw: txt };
  }
  if (!res.ok) {
    throw new Error(typeof data?.detail === "string" ? data.detail : txt);
  }
  return data;
}

// ── error boundary (surfaces the actual error inline) ──────────────

class CreatorErrorBoundary extends (React.Component as any) {
  state = { error: null as Error | null, info: null as any };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: any) {
    // eslint-disable-next-line no-console
    console.error("[creator] render error:", error, info);
    this.setState({ error, info });
  }
  render() {
    const { error, info } = this.state;
    if (error) {
      return React.createElement(
        "div",
        { style: { padding: 24, maxWidth: 1100, margin: "0 auto" } },
        React.createElement(Alert, {
          type: "error", showIcon: true,
          message: "Storybook Creator panel crashed",
          description: React.createElement(
            "div",
            null,
            React.createElement("strong", null, error.message || String(error)),
            React.createElement(
              "pre",
              {
                style: {
                  marginTop: 8, padding: 8, background: "#fafafa",
                  fontSize: 11, maxHeight: 240, overflow: "auto",
                },
              },
              (error.stack || "") + "\n\n" + (info?.componentStack || ""),
            ),
            React.createElement(Button, {
              type: "primary", style: { marginTop: 8 },
              onClick: () => this.setState({ error: null, info: null }),
              children: "Try render again",
            }),
          ),
        }),
      );
    }
    return (this.props as any).children;
  }
}

// ── notifications (L1 tab title + L2 browser Notifications) ─────────

const ORIGINAL_TAB_TITLE = "Storybook Creator";

/**
 * Update the document title to reflect in-flight work.
 *   running > 0 → "(running) Storybook Creator"
 *   running 0 + ready > 0 → "(N ready) Storybook Creator"
 *   else → "Storybook Creator"
 */
function setTabBadge(running: number, ready: number): void {
  let t = ORIGINAL_TAB_TITLE;
  if (running > 0) t = `(running) ${ORIGINAL_TAB_TITLE}`;
  else if (ready > 0) t = `(${ready} ready) ${ORIGINAL_TAB_TITLE}`;
  document.title = t;
}

/**
 * Request native notification permission on the first user gesture.
 * Idempotent — safe to call from any click handler.
 */
let _NOTIF_PERM_REQUESTED = false;
function maybeRequestNotificationPermission(): void {
  if (_NOTIF_PERM_REQUESTED) return;
  _NOTIF_PERM_REQUESTED = true;
  try {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  } catch {
    /* ignore */
  }
}

/**
 * Fire a native browser notification when the tab is in the background.
 * Falls back to the in-app antMessage toast if permission is denied or
 * if the tab is already focused (no need to interrupt).
 */
function notify(
  title: string,
  body: string,
  opts: { tag?: string; level?: "info" | "success" | "warning" | "error" } = {},
): void {
  const level = opts.level ?? "success";
  // Always update the tab title so a backgrounded user sees the change.
  if (document.visibilityState !== "visible") {
    document.title = `🔔 ${title} — ${ORIGINAL_TAB_TITLE}`;
  }
  // In-app toast — works whether or not the tab is focused.
  antMessage[level](title);
  // Native notification — only when tab is backgrounded AND permission is granted.
  try {
    if (
      document.visibilityState !== "visible"
      && "Notification" in window
      && Notification.permission === "granted"
    ) {
      const n = new Notification(title, { body, tag: opts.tag });
      n.onclick = () => {
        try {
          window.focus();
          n.close();
        } catch {
          /* ignore */
        }
      };
    }
  } catch {
    /* ignore */
  }
}

// ── types ────────────────────────────────────────────────────────────

interface ProjectEntry {
  id: string;
  path: string;
  title: string;
  created_at?: string;
  scene_count: number;
}

interface Status {
  ok: boolean;
  creator_root: string;
  has_dashscope: boolean;
  has_openai: boolean;
  project_count: number;
}

interface StyleEntry {
  id: string;
  display_name: string;
  description: string;
  has_sample: boolean;
}

interface CostForecast {
  stage_0_usd: number;
  stage_2_usd: number;
  stage_3_usd: number;
  stage_4_usd: number;
  total_usd: number;
  breakdown: { characters: number; scene_refs: number; scenes: number };
}

// ── helpers ──────────────────────────────────────────────────────────

function refUrl(pid: string, name: string): string {
  // Cache-bust on each refresh so freshly-generated refs replace the
  // image instead of being served stale.
  const t = Date.now();
  return getApiUrl(`/creator/projects/${pid}/refs/${name}?t=${t}`);
}

function yamlPreview(draft: any): string {
  // Cheap YAML-ish display — JSON works as a readable fallback; the
  // backend round-trips through real PyYAML.
  try {
    return JSON.stringify(draft, null, 2);
  } catch {
    return "(unparseable)";
  }
}

// ── main page ────────────────────────────────────────────────────────

function CreatorPage(): any {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [projects, setProjects] = React.useState<ProjectEntry[]>([]);
  const [selectedPid, setSelectedPid] = React.useState<string | null>(null);
  const [styles, setStyles] = React.useState<StyleEntry[]>([]);

  const [loadingProjects, setLoadingProjects] = React.useState(false);

  const reloadStatus = React.useCallback(async () => {
    try {
      const s = await apiGet<Status>("/creator/status");
      setStatus(s);
    } catch (e: any) {
      antMessage.error(`Status check failed: ${e.message ?? e}`);
    }
  }, []);

  const reloadProjects = React.useCallback(async () => {
    setLoadingProjects(true);
    try {
      const r = await apiGet<{ projects: ProjectEntry[] }>(
        "/creator/projects",
      );
      setProjects(r.projects ?? []);
    } catch (e: any) {
      antMessage.error(`Project list failed: ${e.message ?? e}`);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const reloadStyles = React.useCallback(async () => {
    try {
      const r = await apiGet<{ styles: StyleEntry[] }>("/creator/styles");
      setStyles(r.styles ?? []);
    } catch {
      /* non-fatal */
    }
  }, []);

  React.useEffect(() => {
    reloadStatus();
    reloadProjects();
    reloadStyles();
  }, [reloadStatus, reloadProjects, reloadStyles]);

  return React.createElement(
    "div",
    { style: { padding: 24, maxWidth: 1400, margin: "0 auto" } },
    React.createElement(HeaderBar, { status, onRefresh: reloadStatus }),
    React.createElement(Row, { gutter: 24, style: { marginTop: 16 } },
      React.createElement(
        Col,
        { span: 7 },
        React.createElement(ProjectSidebar, {
          projects,
          selectedPid,
          loading: loadingProjects,
          onSelect: setSelectedPid,
          onCreate: () => setSelectedPid(null),
          onReload: reloadProjects,
          onRename: async (p: ProjectEntry) => {
            // Best default: the draft's auto-generated project_id
            // (e.g. "the_old_man_and_the_sea"); fall back to title.
            let suggested = p.title || p.id;
            try {
              const proj = await apiGet<any>(`/creator/projects/${p.id}`);
              suggested = proj?.draft?.project_id || suggested;
            } catch { /* keep title */ }
            const next = window.prompt(
              `Rename "${p.id}" — pick a new id.\n` +
              `Chinese titles auto-romanize via pinyin (e.g. 老人与海 → lao_ren_yu_hai).\n` +
              `Or paste the draft's project_id: ${suggested}`,
              suggested,
            );
            if (!next || next === p.id) return;
            try {
              const r = await apiJson("POST",
                `/creator/projects/${p.id}/rename`,
                { new_id: next.trim() });
              antMessage.success(`Renamed → ${r.id}`);
              if (selectedPid === p.id) setSelectedPid(r.id);
              reloadProjects();
            } catch (e: any) {
              antMessage.error(`Rename failed: ${e.message ?? e}`);
            }
          },
        }),
      ),
      React.createElement(
        Col,
        { span: 17 },
        selectedPid
          ? React.createElement(ProjectPane, {
              key: selectedPid,
              pid: selectedPid,
              styles,
              status,
              onChange: reloadProjects,
              onDeleted: () => {
                setSelectedPid(null);
                reloadProjects();
              },
            })
          : React.createElement(NewProjectPane, {
              styles,
              status,
              onCreated: (pid: string) => {
                setSelectedPid(pid);
                reloadProjects();
              },
            }),
      ),
    ),
  );
}

// ── header / status pills ────────────────────────────────────────────

function HeaderBar({ status, onRefresh }: any) {
  const pill = (ok: boolean, label: string) =>
    React.createElement(
      Tag,
      { color: ok ? "green" : "red", style: { marginLeft: 8 } },
      `${label}: ${ok ? "ok" : "missing"}`,
    );
  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      },
    },
    React.createElement(
      "div",
      null,
      React.createElement(
        Title,
        { level: 3, style: { margin: 0 } },
        "🎬 Storybook Creator",
      ),
      React.createElement(
        Paragraph,
        { type: "secondary", style: { margin: 0 } },
        "Upload a story → LLM decomposes it → generate anchor refs (Stage 0) → compose frames (Stage 2, gpt-image-2) → animate per scene (Stage 3: Wan / HappyHorse / Seedance) → final MP4 (Stage 4, ffmpeg).",
      ),
    ),
    React.createElement(
      Space,
      null,
      status
        ? React.createElement(
            "span",
            null,
            pill(status.has_dashscope, "DashScope"),
            pill(status.has_openai, "OpenAI"),
          )
        : React.createElement(Spin, { size: "small" }),
      React.createElement(Button, {
        icon: React.createElement(ReloadOutlined),
        onClick: onRefresh,
        size: "small",
        children: "Refresh",
      }),
    ),
  );
}

// ── left sidebar: project list + "new" ───────────────────────────────

function ProjectSidebar({
  projects,
  selectedPid,
  loading,
  onSelect,
  onCreate,
  onReload,
  onRename,
}: any) {
  return React.createElement(
    Card,
    {
      size: "small",
      title: React.createElement(
        Space,
        null,
        React.createElement(FileTextOutlined),
        "Projects",
      ),
      extra: React.createElement(
        Space,
        null,
        React.createElement(Button, {
          type: "primary",
          size: "small",
          icon: React.createElement(PlusOutlined),
          onClick: onCreate,
          children: "New",
        }),
        React.createElement(Button, {
          size: "small",
          icon: React.createElement(ReloadOutlined),
          onClick: onReload,
        }),
      ),
    },
    loading
      ? React.createElement(Spin)
      : projects.length === 0
        ? React.createElement(Empty, { description: "No projects yet" })
        : React.createElement(List, {
            size: "small",
            dataSource: projects,
            renderItem: (p: ProjectEntry) =>
              React.createElement(
                List.Item,
                {
                  key: p.id,
                  style: {
                    cursor: "pointer",
                    background: p.id === selectedPid ? "#e6f4ff" : undefined,
                    padding: "8px 12px",
                    borderRadius: 6,
                  },
                  onClick: () => onSelect(p.id),
                  actions: [
                    React.createElement(
                      Tooltip,
                      { title: "Rename project id (e.g. untitled_xxx → meaningful name)" },
                      React.createElement(Button, {
                        size: "small",
                        type: "text",
                        icon: React.createElement(EditOutlined),
                        onClick: (e: any) => {
                          e.stopPropagation();
                          onRename?.(p);
                        },
                      }),
                    ),
                  ],
                },
                React.createElement(List.Item.Meta, {
                  title: React.createElement(AntText, { strong: true }, p.title),
                  description: React.createElement(
                    AntText,
                    { type: "secondary", style: { fontSize: 12 } },
                    `${p.scene_count} scenes · ${p.id}`,
                  ),
                }),
              ),
          }),
  );
}

// ── new project pane: source upload + paste ──────────────────────────

function NewProjectPane({ styles, status, onCreated }: any) {
  const [tab, setTab] = React.useState<"paste" | "upload">("paste");
  const [text, setText] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  // Model picks chosen at the source step. Persisted to project meta
  // on save → ProjectPane hydrates Decompose form state from there →
  // Stage 00 writes the choice to global_config and every scene.
  const [frameProvider, setFrameProvider] = React.useState("gpt-image-2");
  const [videoProvider, setVideoProvider] = React.useState("wan27");

  const onPasteSubmit = async () => {
    if (text.trim().length < 30) {
      antMessage.warning("Source text seems too short — paste at least a paragraph");
      return;
    }
    setBusy(true);
    try {
      const r = await apiJson("POST", "/creator/sources/text", {
        text,
        title: title || undefined,
        frame_provider: frameProvider,
        video_provider: videoProvider,
      });
      antMessage.success(`Project created: ${r.project_id}`);
      onCreated(r.project_id);
    } catch (e: any) {
      antMessage.error(`Failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const onUploadSubmit = async () => {
    if (!file) {
      antMessage.warning("Pick a file");
      return;
    }
    setBusy(true);
    try {
      const r = await apiUpload("/creator/sources/upload", file, {
        ...(title ? { title } : {}),
        frame_provider: frameProvider,
        video_provider: videoProvider,
      });
      antMessage.success(`Project created: ${r.project_id}`);
      onCreated(r.project_id);
    } catch (e: any) {
      antMessage.error(`Failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  return React.createElement(
    Card,
    {
      title: React.createElement(
        Space,
        null,
        React.createElement(CloudUploadOutlined),
        "New storybook from source",
      ),
    },
    React.createElement(
      Steps,
      { current: 0, size: "small", style: { marginBottom: 24 } },
      React.createElement(Step, { title: "Source", icon: React.createElement(CloudUploadOutlined) }),
      React.createElement(Step, { title: "Decompose", icon: React.createElement(ScissorOutlined) }),
      React.createElement(Step, { title: "Generate refs", icon: React.createElement(PictureOutlined) }),
      React.createElement(Step, { title: "Compose frames", icon: React.createElement(PlayCircleOutlined) }),
    ),
    status && !status.has_dashscope
      ? React.createElement(Alert, {
          type: "warning",
          message: "DASHSCOPE_API_KEY missing — needed for Stage 00 decomposition (qwen-max). Set it under Environment Variables and refresh.",
          style: { marginBottom: 16 },
          showIcon: true,
        })
      : null,
    React.createElement(
      "div",
      { style: { display: "flex", gap: 12, marginBottom: 12 } },
      React.createElement(
        Button,
        {
          type: tab === "paste" ? "primary" : "default",
          onClick: () => setTab("paste"),
          children: "Paste text",
        },
      ),
      React.createElement(
        Button,
        {
          type: tab === "upload" ? "primary" : "default",
          onClick: () => setTab("upload"),
          children: "Upload file (.txt/.md/.pdf/.docx)",
        },
      ),
    ),
    React.createElement(Form, { layout: "vertical" },
      React.createElement(Form.Item, { label: "Title (optional)" },
        React.createElement(Input, {
          placeholder: "Old Man and the Sea",
          value: title,
          onChange: (e: any) => setTitle(e.target.value),
        }),
      ),
      React.createElement(Row, { gutter: 16 },
        React.createElement(Col, { span: 12 },
          React.createElement(Form.Item, {
            label: "Image model (Stage 0 refs + Stage 2 frames)",
            extra: "Routes every image-gen call for this project — character/setting/style refs (Stage 0) and per-scene frame composition (Stage 2). gpt-image-2: strong identity, ~$0.20-0.30 / frame. qwen-image: ~5× cheaper, weaker identity, 3-ref cap. Per-scene Stage 2 override available later.",
          },
            React.createElement(Select, {
              value: frameProvider,
              onChange: setFrameProvider,
              style: { width: "100%" },
              options: [
                { value: "gpt-image-2", label: "🖼️ gpt-image-2 — high quality, expensive" },
                { value: "qwen-image", label: "🪶 qwen-image-2.0-pro — ~5× cheaper" },
              ],
            }),
          ),
        ),
        React.createElement(Col, { span: 12 },
          React.createElement(Form.Item, {
            label: "Video model (Stage 3)",
            extra: "Wan 2.7 includes ambient audio. HappyHorse / Seedance are silent (narration mixed in Stage 4). Per-scene override available later.",
          },
            React.createElement(Select, {
              value: videoProvider,
              onChange: setVideoProvider,
              style: { width: "100%" },
              options: [
                { value: "wan27", label: "🎬 Wan 2.7" },
                { value: "happyhorse", label: "🐎 HappyHorse 1.0 — faster + cheaper" },
                { value: "seedance", label: "🌱 Doubao Seedance 2.0" },
              ],
            }),
          ),
        ),
      ),
      tab === "paste"
        ? React.createElement(Form.Item, { label: "Story / script / prompt", required: true },
            React.createElement(TextArea, {
              rows: 14,
              value: text,
              onChange: (e: any) => setText(e.target.value),
              placeholder: "Paste the full story, script, or narrative prompt here. The LLM will identify characters, scenes, and recurring settings, then split it into 5-8 storyboard panels.",
            }),
          )
        : React.createElement(Form.Item, { label: "File", required: true },
            React.createElement(
              Upload,
              {
                beforeUpload: (f: File) => {
                  setFile(f);
                  return false; // don't auto-upload — we POST manually
                },
                onRemove: () => setFile(null),
                maxCount: 1,
                accept: ".txt,.md,.pdf,.docx",
              },
              React.createElement(Button, { icon: React.createElement(CloudUploadOutlined) }, "Pick file"),
            ),
          ),
      React.createElement(Form.Item, null,
        React.createElement(Button, {
          type: "primary",
          loading: busy,
          onClick: tab === "paste" ? onPasteSubmit : onUploadSubmit,
          size: "large",
          children: "Save source",
        }),
      ),
    ),
    React.createElement(
      Paragraph,
      { type: "secondary", style: { fontSize: 12, marginTop: 16 } },
      `Source is saved to your workspace; nothing leaves the machine until you run Decompose (which calls DashScope qwen-max) or Stage 0/2 (which calls OpenAI gpt-image-2).`,
    ),
    styles && styles.length
      ? React.createElement(
          "div",
          { style: { marginTop: 16 } },
          React.createElement(
            Paragraph,
            { type: "secondary", style: { fontSize: 12, margin: 0 } },
            `${styles.length} style presets seeded — the LLM picks one during Decompose; you can override it in the next step.`,
          ),
        )
      : null,
  );
}

// ── project pane: workflow per loaded project ────────────────────────

function ProjectPane({ pid, styles, status, onChange, onDeleted }: any) {
  const [project, setProject] = React.useState<any>(null);
  const [forecast, setForecast] = React.useState<CostForecast | null>(null);
  const [projStatus, setProjStatus] = React.useState<any>(null);
  const [busy, setBusy] = React.useState(false);
  const [activeStage, setActiveStage] = React.useState<string | null>(null);
  const [anchorEditor, setAnchorEditor] = React.useState<{
    open: boolean;
    mode: "add" | "update";
    kind: "character" | "scene_ref";
    id: string;
    description: string;
  } | null>(null);
  const [sceneEditor, setSceneEditor] = React.useState<any>(null);
  // Live progress events from /api/creator/projects/{pid}/events (SSE).
  // Map of scene_id → {state: "running"|"done"|"failed", elapsed_s?}
  // for whichever stage is currently active.
  const [liveProgress, setLiveProgress] = React.useState<
    Record<string, { state: string; stage?: string; elapsed_s?: number }>
  >({});

  // Decompose-step form
  const [duration, setDuration] = React.useState(60);
  const [styleHint, setStyleHint] = React.useState<string | undefined>(undefined);
  const [audience, setAudience] = React.useState("general / family");
  const [voice, setVoice] = React.useState("longshu_v2");
  const [era, setEra] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [genre, setGenre] = React.useState("");
  const [tone, setTone] = React.useState("");
  const [storyAnchor, setStoryAnchor] = React.useState("");
  const [styleDirectives, setStyleDirectives] = React.useState("");
  const [worldBible, setWorldBible] = React.useState("");
  // Per-project model picks — initially chosen at the Source step and
  // persisted to meta.json. Hydrated from project.meta below so a
  // re-decompose or per-stage rerun uses the saved choice without the
  // user re-picking. Per-scene override stays in SceneEditModal.
  const [frameProvider, setFrameProvider] = React.useState("gpt-image-2");
  const [videoProvider, setVideoProvider] = React.useState("wan27");

  const reload = React.useCallback(async () => {
    try {
      const p = await apiGet(`/creator/projects/${pid}`);
      setProject(p);
    } catch (e: any) {
      antMessage.error(`Load failed: ${e.message ?? e}`);
    }
    try {
      const f = await apiGet<CostForecast>(
        `/creator/projects/${pid}/cost-forecast`,
      );
      setForecast(f);
    } catch {
      setForecast(null);
    }
    try {
      const s = await apiGet(`/creator/projects/${pid}/status`);
      setProjStatus(s);
    } catch {
      setProjStatus(null);
    }
  }, [pid]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  // Hydrate model picks from meta whenever the project changes.
  // The source step writes them to meta.json; this seeds the local
  // state so downstream decompose / per-stage runs reuse the choice.
  // Also seed from global_config (post-decompose) so re-opens after a
  // decompose pick up the value even if meta predates the feature.
  React.useEffect(() => {
    const meta = (project as any)?.meta || {};
    const gc = (project as any)?.draft?.global_config || {};
    const fp = meta.frame_provider || gc.frame_provider;
    const vp = meta.video_provider || gc.video_provider;
    if (fp) setFrameProvider(fp);
    if (vp) setVideoProvider(vp);
  }, [project]);

  // Open an SSE stream for live progress events from the pipeline.
  React.useEffect(() => {
    if (!pid) return;
    const url = getApiUrl(`/creator/projects/${pid}/events`);
    let es: EventSource | null = null;
    try {
      es = new EventSource(url, { withCredentials: false } as any);
    } catch {
      return;
    }
    es.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data);
        if (ev.kind === "scene_start" && ev.scene_id) {
          setLiveProgress((p) => ({
            ...p,
            [ev.scene_id]: { state: "running", stage: ev.stage },
          }));
        } else if (ev.kind === "scene_done" && ev.scene_id) {
          setLiveProgress((p) => ({
            ...p,
            [ev.scene_id]: {
              state: "done", stage: ev.stage, elapsed_s: ev.elapsed_s,
            },
          }));
          // The disk has a new file — refresh status to render the thumbnail.
          reload();
        } else if (ev.kind === "scene_failed" && ev.scene_id) {
          setLiveProgress((p) => ({
            ...p,
            [ev.scene_id]: { state: "failed", stage: ev.stage },
          }));
        } else if (ev.kind === "stage_done") {
          // Drop running markers when the whole stage finishes.
          setLiveProgress({});
          reload();
        }
      } catch {
        /* ignore malformed event */
      }
    };
    es.onerror = () => {
      // Browser auto-reconnects on its own; nothing to do.
    };
    return () => {
      try { es?.close(); } catch { /* ignore */ }
    };
  }, [pid, reload]);

  const onDecompose = async () => {
    maybeRequestNotificationPermission();
    setBusy(true);
    setActiveStage("decompose");
    setTabBadge(1, 0);
    try {
      const r = await apiJson("POST", `/creator/projects/${pid}/decompose`, {
        duration_target_s: duration,
        style_hint: styleHint,
        audience,
        voice,
        era: era.trim() || undefined,
        country: country.trim() || undefined,
        genre: genre.trim() || undefined,
        tone: tone.trim() || undefined,
        story_anchor: storyAnchor.trim() || undefined,
        world_bible: worldBible.trim() || undefined,
        style_directives: styleDirectives
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        frame_provider: frameProvider,
        video_provider: videoProvider,
      });
      setProject((p: any) => ({ ...(p ?? {}), draft: r.draft }));
      onChange?.();
      await reload();
      notify(
        "Decompose done",
        `Draft ready — ${
          (r.draft?.scenes?.length || 0)
        } scenes. Review before generating refs.`,
        { tag: "decompose", level: "success" },
      );
      setTabBadge(0, 1);
    } catch (e: any) {
      notify(
        "Decompose failed",
        String(e?.message ?? e).slice(0, 200),
        { tag: "decompose-err", level: "error" },
      );
      setTabBadge(0, 0);
    } finally {
      setBusy(false);
      setActiveStage(null);
    }
  };

  /**
   * Fan-out across scenes with bounded concurrency. Each scene fires
   * its own /stage POST so the per-card SSE state lights up live and
   * any one failure doesn't tank the others.
   *
   *   stage:      "2" | "3"  (the per-scene stages)
   *   concurrency how many in flight at once (rate-limit cap)
   *   overwrite   force regen of scenes that already have output
   */
  const onRunStageAllParallel = async (
    stage: string,
    overwrite: boolean = false,
  ) => {
    const scenes = (draft.scenes || []).map((s: any) => s.id);
    if (!scenes.length) return;
    const gc = draft.global_config || {};
    const conc = Math.max(1, Math.min(5, Number(gc.concurrency) || 3));
    maybeRequestNotificationPermission();
    setBusy(true);
    setActiveStage(stage);
    setTabBadge(scenes.length, 0);
    let done = 0, failed = 0;
    try {
      for (let i = 0; i < scenes.length; i += conc) {
        const batch = scenes.slice(i, i + conc);
        const results = await Promise.allSettled(
          batch.map((sid: string) =>
            apiJson("POST", `/creator/projects/${pid}/stage`, {
              stage,
              only_scene: sid,
              overwrite,
            }),
          ),
        );
        results.forEach((r: any) => r.status === "fulfilled" ? done++ : failed++);
        await reload();
      }
      notify(
        `Stage ${stage} done`,
        `${done} succeeded, ${failed} failed.`,
        { tag: `stage-${stage}`, level: failed > 0 ? "warning" : "success" },
      );
      setTabBadge(0, done);
    } catch (e: any) {
      notify(`Stage ${stage} crashed`, String(e?.message ?? e).slice(0, 200),
        { tag: `stage-${stage}-err`, level: "error" });
      setTabBadge(0, 0);
    } finally {
      setBusy(false);
      setActiveStage(null);
    }
  };

  const onRunStage = async (stage: string, extra: any = {}) => {
    maybeRequestNotificationPermission();
    setBusy(true);
    setActiveStage(stage);
    setTabBadge(1, 0);
    const stageLabel: Record<string, string> = {
      "0": "Stage 0 — anchor refs",
      "0a": "Stage 0a — character refs",
      "0b": "Stage 0b — scene refs",
      "0c": "Stage 0c — style ref",
      "1": "Stage 1 — narration",
      "2": "Stage 2 — frame compose",
      "3": "Stage 3 — animation",
      "4": "Stage 4 — final MP4",
    };
    const label = stageLabel[stage] ?? `Stage ${stage}`;
    try {
      const r = await apiJson("POST", `/creator/projects/${pid}/stage`, {
        stage,
        ...extra,
      });
      console.log("[creator] stage report", r);
      await reload();
      const sceneHint = extra?.only_scene ? ` (scene ${extra.only_scene})` : "";
      notify(
        `${label} done${sceneHint}`,
        "Click to review and continue.",
        { tag: `stage-${stage}`, level: "success" },
      );
      setTabBadge(0, 1);
    } catch (e: any) {
      notify(
        `${label} failed`,
        String(e?.message ?? e).slice(0, 200),
        { tag: `stage-${stage}-err`, level: "error" },
      );
      setTabBadge(0, 0);
    } finally {
      setBusy(false);
      setActiveStage(null);
    }
  };

  const onSaveDraft = async (newDraft: any) => {
    try {
      await apiJson("PUT", `/creator/projects/${pid}`, { draft: newDraft });
      antMessage.success("Saved.");
      await reload();
    } catch (e: any) {
      antMessage.error(`Save failed: ${e.message ?? e}`);
    }
  };

  const onPatchAnchor = async (
    op: "add" | "update" | "delete",
    kind: "character" | "scene_ref",
    id: string,
    description?: string,
  ) => {
    try {
      const r = await apiJson("PATCH", `/creator/projects/${pid}/anchors`, {
        op, kind, id, description,
      });
      antMessage.success(
        op === "delete" ? `Removed ${kind} ${id}` :
        op === "add" ? `Added ${kind} ${id}` : `Updated ${kind} ${id}`,
      );
      setProject((p: any) => ({ ...(p ?? {}), draft: r.draft }));
      onChange?.();
      await reload();
    } catch (e: any) {
      antMessage.error(`${op} failed: ${e.message ?? e}`);
    }
  };

  const onDeleteAnchor = (kind: "character" | "scene_ref", id: string) => {
    Modal.confirm({
      title: `Delete ${kind} "${id}"?`,
      content: `Removes it from the draft and strips references from every scene that used it. If a ref image was already generated, the PNG stays on disk.`,
      okType: "danger",
      onOk: () => onPatchAnchor("delete", kind, id),
    });
  };

  const onPatchScene = async (sceneId: string, patch: any) => {
    try {
      const r = await apiJson(
        "PATCH",
        `/creator/projects/${pid}/scenes/${sceneId}`,
        patch,
      );
      antMessage.success(`Saved scene ${sceneId}`);
      setProject((p: any) => ({ ...(p ?? {}), draft: r.draft }));
      onChange?.();
      await reload();
    } catch (e: any) {
      antMessage.error(`Save failed: ${e.message ?? e}`);
    }
  };

  const onDelete = () => {
    Modal.confirm({
      title: `Delete project ${pid}?`,
      content: "All refs, frames, and source files will be removed.",
      okType: "danger",
      onOk: async () => {
        try {
          await apiJson("DELETE", `/creator/projects/${pid}`);
          antMessage.success("Deleted.");
          onDeleted?.();
        } catch (e: any) {
          antMessage.error(`Delete failed: ${e.message ?? e}`);
        }
      },
    });
  };

  if (!project) {
    return React.createElement(Card, null, React.createElement(Spin));
  }

  const draft = project.draft ?? {};
  const hasDraft = Boolean(draft?.scenes?.length);

  // Current step computation
  let currentStep = 1; // source done
  if (hasDraft) currentStep = 2;
  if (
    projStatus?.stages?.["0"]?.refs?.length &&
    projStatus.stages["0"].refs.length >=
      (draft.assets?.characters?.length ?? 0) +
        (draft.assets?.scene_refs?.length ?? 0)
  ) {
    currentStep = 3;
  }
  if (projStatus?.stages?.["2"]?.frames?.length) currentStep = 4;

  return React.createElement(
    Card,
    {
      title: React.createElement(
        Space,
        null,
        React.createElement(AntText, { strong: true }, project?.meta?.title ?? pid),
        React.createElement(Tag, { color: "blue" }, pid),
      ),
      extra: React.createElement(
        Space,
        null,
        forecast
          ? React.createElement(
              Tooltip,
              {
                title: `Stage 0 refs ≈ $${forecast.stage_0_usd} (${forecast.breakdown.characters} chars + ${forecast.breakdown.scene_refs} scenes + style). Stage 2 frames ≈ $${forecast.stage_2_usd} (${forecast.breakdown.scenes} scenes). Stage 3 Wan I2V ≈ $${forecast.stage_3_usd} (${forecast.breakdown.scenes} clips).`,
              },
              React.createElement(Tag, { color: "gold" }, `≈ $${forecast.total_usd}`),
            )
          : null,
        React.createElement(Button, {
          danger: true,
          size: "small",
          icon: React.createElement(DeleteOutlined),
          onClick: onDelete,
          children: "Delete",
        }),
      ),
    },
    React.createElement(
      Steps,
      { current: currentStep, size: "small", style: { marginBottom: 24 } },
      React.createElement(Step, { title: "Source", icon: React.createElement(CloudUploadOutlined) }),
      React.createElement(Step, { title: "Decompose", icon: React.createElement(ScissorOutlined) }),
      React.createElement(Step, { title: "Generate refs", icon: React.createElement(PictureOutlined) }),
      React.createElement(Step, { title: "Compose frames", icon: React.createElement(PlayCircleOutlined) }),
    ),

    // Step 1: Decompose form (only if no draft yet)
    !hasDraft
      ? React.createElement(DecomposeForm, {
          duration, setDuration,
          styleHint, setStyleHint,
          audience, setAudience,
          voice, setVoice,
          era, setEra,
          country, setCountry,
          genre, setGenre,
          tone, setTone,
          storyAnchor, setStoryAnchor,
          styleDirectives, setStyleDirectives,
          worldBible, setWorldBible,
          frameProvider, setFrameProvider,
          videoProvider, setVideoProvider,
          styles, busy, activeStage, status,
          onSubmit: onDecompose,
        })
      : null,

    // Step 2+: Draft viewer + ref/frame galleries
    hasDraft
      ? React.createElement(DraftPanel, {
          pid,
          draft,
          projStatus,
          busy,
          activeStage,
          forecast,
          status,
          onRunStage,
          onSaveDraft,
          onReload: reload,
          onAddAnchor: (kind: "character" | "scene_ref") =>
            setAnchorEditor({
              open: true, mode: "add", kind, id: "", description: "",
            }),
          onEditAnchor: (kind: "character" | "scene_ref", a: any) =>
            setAnchorEditor({
              open: true, mode: "update", kind,
              id: a.id, description: a.description || "",
            }),
          onDeleteAnchor,
          onEditScene: (sceneId: string) => {
            const sc = (draft.scenes || []).find(
              (s: any) => s.id === sceneId,
            );
            if (sc) setSceneEditor(sc);
          },
          liveProgress,
        })
      : null,

    // Anchor add/edit modal
    anchorEditor?.open
      ? React.createElement(AnchorEditModal, {
          editor: anchorEditor,
          onCancel: () => setAnchorEditor(null),
          onSubmit: async (id: string, description: string) => {
            await onPatchAnchor(
              anchorEditor.mode, anchorEditor.kind, id, description,
            );
            setAnchorEditor(null);
          },
        })
      : null,

    // Scene editor modal
    sceneEditor
      ? React.createElement(SceneEditModal, {
          scene: sceneEditor,
          draft,
          onCancel: () => setSceneEditor(null),
          onSubmit: async (patch: any) => {
            await onPatchScene(sceneEditor.id, patch);
            setSceneEditor(null);
          },
        })
      : null,
  );
}

// ── scene edit modal ────────────────────────────────────────────────

function SceneEditModal({ scene, draft, onCancel, onSubmit }: any) {
  const [name, setName] = React.useState(scene.name ?? "");
  const [duration, setDuration] = React.useState(scene.duration ?? 10);
  const [hasNarration, setHasNarration] = React.useState(
    !!scene.has_narration,
  );
  const [standalone, setStandalone] = React.useState(!!scene.standalone);
  const [usesStyle, setUsesStyle] = React.useState(
    scene.uses_style === undefined ? true : !!scene.uses_style,
  );
  const [usesCharacters, setUsesCharacters] = React.useState<string[]>(
    Array.isArray(scene.uses_characters) ? scene.uses_characters : [],
  );
  const [usesSceneRef, setUsesSceneRef] = React.useState<string | undefined>(
    scene.uses_scene_ref || undefined,
  );
  const [sceneDescription, setSceneDescription] = React.useState(
    scene.scene_description ?? "",
  );
  const [motionPrompt, setMotionPrompt] = React.useState(
    scene.motion_prompt ?? "",
  );
  const [narration, setNarration] = React.useState(scene.narration ?? "");
  const [nCandidates, setNCandidates] = React.useState(
    scene.n_candidates ?? 1,
  );
  const [regenNotes, setRegenNotes] = React.useState(
    scene.regen_notes ?? "",
  );
  const [videoProvider, setVideoProvider] = React.useState(
    scene.video_provider ?? "wan27",
  );
  const [frameProvider, setFrameProvider] = React.useState(
    scene.frame_provider ?? "gpt-image-2",
  );
  const [submitting, setSubmitting] = React.useState(false);

  const charOptions = (draft.assets?.characters ?? []).map((c: any) => ({
    value: c.id, label: c.id,
  }));
  const refOptions = (draft.assets?.scene_refs ?? []).map((r: any) => ({
    value: r.id, label: r.id,
  }));

  return React.createElement(
    Modal,
    {
      open: true,
      title: `Edit scene ${scene.id} — ${scene.name}`,
      okText: "Save",
      confirmLoading: submitting,
      onCancel,
      onOk: async () => {
        if (!sceneDescription.trim()) {
          antMessage.warning("scene_description is required");
          return;
        }
        if (hasNarration && !narration.trim()) {
          antMessage.warning(
            "narration text is required when has_narration is on",
          );
          return;
        }
        setSubmitting(true);
        try {
          await onSubmit({
            name: name.trim() || undefined,
            duration,
            has_narration: hasNarration,
            standalone,
            uses_style: usesStyle,
            uses_characters: usesCharacters,
            uses_scene_ref: usesSceneRef || null,
            scene_description: sceneDescription.trim(),
            motion_prompt: motionPrompt.trim(),
            narration: hasNarration ? narration.trim() : "",
            n_candidates: nCandidates,
            regen_notes: regenNotes.trim(),
            video_provider: videoProvider,
            frame_provider: frameProvider,
          });
        } finally {
          setSubmitting(false);
        }
      },
      width: 800,
    },
    React.createElement(Form, { layout: "vertical" },
      React.createElement(Row, { gutter: 12 },
        React.createElement(Col, { span: 12 },
          React.createElement(Form.Item, { label: "Name (short label)" },
            React.createElement(Input, {
              value: name,
              onChange: (e: any) => setName(e.target.value),
              placeholder: "solitary_sailor",
            }),
          ),
        ),
        React.createElement(Col, { span: 6 },
          React.createElement(Form.Item, { label: "Duration (s)" },
            React.createElement(InputNumber, {
              min: 2, max: 60, value: duration,
              onChange: (v: any) => setDuration(v ?? 10),
              style: { width: "100%" },
            }),
          ),
        ),
        React.createElement(Col, { span: 6 },
          React.createElement(Form.Item, { label: "Take count (n_candidates)" },
            React.createElement(InputNumber, {
              min: 1, max: 4, value: nCandidates,
              onChange: (v: any) => setNCandidates(v ?? 1),
              style: { width: "100%" },
            }),
          ),
        ),
      ),

      React.createElement(Row, { gutter: 12 },
        React.createElement(Col, { span: 8 },
          React.createElement(Form.Item, {
            label: "Title / credits card",
            extra: "Skip Stage 0/2 conditioning — pure standalone shot",
          },
            React.createElement(antd.Switch, {
              checked: standalone,
              onChange: setStandalone,
            }),
          ),
        ),
        React.createElement(Col, { span: 8 },
          React.createElement(Form.Item, { label: "Has narration" },
            React.createElement(antd.Switch, {
              checked: hasNarration, onChange: setHasNarration,
            }),
          ),
        ),
        React.createElement(Col, { span: 8 },
          React.createElement(Form.Item, { label: "Use style anchor" },
            React.createElement(antd.Switch, {
              checked: usesStyle, onChange: setUsesStyle,
            }),
          ),
        ),
      ),

      React.createElement(Row, { gutter: 12 },
        React.createElement(Col, { span: 14 },
          React.createElement(Form.Item, {
            label: `Characters in this scene (${charOptions.length} available)`,
          },
            React.createElement(Select, {
              mode: "multiple",
              value: usesCharacters,
              onChange: setUsesCharacters,
              options: charOptions,
              placeholder: charOptions.length
                ? "Pick characters that appear in this scene"
                : "No characters in draft — add some under Anchors",
              style: { width: "100%" },
              allowClear: true,
            }),
          ),
        ),
        React.createElement(Col, { span: 10 },
          React.createElement(Form.Item, {
            label: `Setting (1 of ${refOptions.length})`,
          },
            React.createElement(Select, {
              value: usesSceneRef,
              onChange: setUsesSceneRef,
              options: [{ value: "", label: "(none)" }, ...refOptions],
              placeholder: "Pick a setting",
              style: { width: "100%" },
              allowClear: true,
            }),
          ),
        ),
      ),

      React.createElement(Form.Item, {
        label: "scene_description",
        extra: "Visual scaffold sent to gpt-image-2 for frame composition.",
        required: true,
      },
        React.createElement(TextArea, {
          rows: 5,
          value: sceneDescription,
          onChange: (e: any) => setSceneDescription(e.target.value),
        }),
      ),
      React.createElement(Form.Item, {
        label: "motion_prompt",
        extra: "Verbs + camera. Sent to the Stage 3 video model (Wan 2.7 / HappyHorse / Seedance) on top of the composed frame.",
      },
        React.createElement(TextArea, {
          rows: 3,
          value: motionPrompt,
          onChange: (e: any) => setMotionPrompt(e.target.value),
        }),
      ),
      hasNarration
        ? React.createElement(Form.Item, {
            label: "narration",
            extra: `≤ ${(duration - 1) * 18} chars (roughly — CosyVoice longshu_v2 at 1.0x). Stage 1 will warn if it overruns.`,
          },
            React.createElement(TextArea, {
              rows: 3,
              value: narration,
              onChange: (e: any) => setNarration(e.target.value),
            }),
          )
        : null,
      React.createElement(Form.Item, {
        label: "regen_notes (applied on next Stage 2 regeneration)",
        extra: "Free-text correction layered on top of scene_description. Clear to remove. Persists across runs.",
      },
        React.createElement(TextArea, {
          rows: 3,
          value: regenNotes,
          onChange: (e: any) => setRegenNotes(e.target.value),
          placeholder: "marlin should be about the same length as the skiff, not larger",
        }),
      ),
      React.createElement(Form.Item, {
        label: "frame_provider (Stage 2 override for this scene)",
        extra: "Overrides the project-wide image model just for this scene's Stage 2 frame. Stage 0 anchor refs always use the project-wide pick (set at the Source step).",
      },
        React.createElement(Select, {
          value: frameProvider,
          onChange: setFrameProvider,
          style: { width: "100%" },
          options: [
            { value: "gpt-image-2", label: "🖼️ gpt-image-2 — high quality, expensive" },
            { value: "qwen-image", label: "🪶 qwen-image-2.0-pro — ~5× cheaper" },
          ],
        }),
      ),
      React.createElement(Form.Item, {
        label: "video_provider (Stage 3)",
        extra: "Wan 2.7 — Alibaba's I2V model (default). HappyHorse 1.0 — alternative; faster + cheaper, but different style.",
      },
        React.createElement(Select, {
          value: videoProvider,
          onChange: setVideoProvider,
          style: { width: "100%" },
          options: [
            { value: "wan27", label: "🎬 Wan 2.7 — wan2.7-i2v-2026-04-25" },
            { value: "happyhorse", label: "🐎 HappyHorse 1.0 — happyhorse-1.0-i2v" },
            { value: "seedance", label: "🌱 Doubao Seedance 2.0 — doubao.doubao-seedance-2-0-260128" },
          ],
        }),
      ),
    ),
  );
}

// ── anchor edit modal ────────────────────────────────────────────────

function AnchorEditModal({ editor, onCancel, onSubmit }: any) {
  const [id, setId] = React.useState(editor.id);
  const [description, setDescription] = React.useState(editor.description);
  const [submitting, setSubmitting] = React.useState(false);
  const isEdit = editor.mode === "update";
  const kindLabel = editor.kind === "character" ? "character" : "setting";
  return React.createElement(
    Modal,
    {
      open: true,
      title: `${isEdit ? "Edit" : "Add"} ${kindLabel}`,
      okText: isEdit ? "Save" : "Add",
      confirmLoading: submitting,
      onCancel,
      onOk: async () => {
        const idClean = id.trim();
        if (!idClean) {
          antMessage.warning("id is required");
          return;
        }
        if (!description.trim()) {
          antMessage.warning("description is required");
          return;
        }
        setSubmitting(true);
        try {
          await onSubmit(idClean, description.trim());
        } finally {
          setSubmitting(false);
        }
      },
      width: 640,
    },
    React.createElement(Form, { layout: "vertical" },
      React.createElement(Form.Item, {
        label: "ID",
        extra: editor.kind === "character"
          ? `short snake_case, e.g. "marlin", "old_man"`
          : `short snake_case, e.g. "high_sea", "dock"`,
      },
        React.createElement(Input, {
          value: id,
          disabled: isEdit,
          onChange: (e: any) => setId(e.target.value),
          placeholder: editor.kind === "character" ? "marlin" : "high_sea",
        }),
      ),
      React.createElement(Form.Item, {
        label: "Description",
        extra: editor.kind === "character"
          ? "Verbatim physical description. End with 'reference sheet, not a scene.' Include every load-bearing detail (clothes, build, color)."
          : "Environmental setting only — no characters, no objects beyond the setting.",
      },
        React.createElement(TextArea, {
          rows: 8,
          value: description,
          onChange: (e: any) => setDescription(e.target.value),
          placeholder: editor.kind === "character"
            ? "A great Atlantic marlin fish, roughly 4 metres long, iridescent blue-purple along its upper body shading to silver belly, a long pointed spear-like bill, a tall sail-like dorsal fin running along its back, a sharp crescent-shaped tail fin. Reference sheet on empty pale background, soft watercolor natural-history study, not a scene."
            : "A small Cuban fishing village dock at sunset, weathered wooden planks of the pier, shoreline with low scrubby vegetation, distant village lights starting to glow, warm amber-rose sky. Wide cinematic landscape view, soft watercolor landscape painting, no characters, no boats.",
        }),
      ),
    ),
  );
}

// ── collapsible stage wrapper + right-rail ──────────────────────────

/**
 * One-line collapsible card for each pipeline stage.
 * - Header always shows status summary + cost.
 * - Body hidden when collapsed; full gallery when expanded.
 * - Has an `id` so the right-rail can scroll to it.
 */
function StageSection({
  id, stageLabel, summary, costUsd, extra, open, onToggle, children,
}: any) {
  // Open/closed is controlled by the parent (DraftPanel) so multiple
  // sections behave like an accordion — only one open at a time.
  return React.createElement(
    Card,
    {
      id,
      size: "small",
      style: { marginTop: 16 },
      title: React.createElement(
        "div",
        {
          style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" },
          onClick: () => onToggle?.(id),
        },
        React.createElement(
          AntText,
          { style: { fontSize: 14, color: "#999" } },
          open ? "▼" : "▶",
        ),
        React.createElement(AntText, { strong: true }, stageLabel),
        costUsd != null
          ? React.createElement(
              Tag, { color: "gold", style: { fontSize: 11 } },
              `≈ $${costUsd}`,
            )
          : null,
        React.createElement(
          AntText,
          { type: "secondary", style: { fontSize: 12 } },
          `· ${summary}`,
        ),
      ),
      extra: extra,
      bodyStyle: open ? undefined : { display: "none" },
    },
    children,
  );
}

/**
 * Sticky right-edge rail: jump to any stage, see status at a glance.
 * Each pill is `Stage N — ✓✓✓·· (3/5)` — green for done, grey for pending.
 */
function StageRail({ rows }: any) {
  return React.createElement(
    "div",
    {
      style: {
        position: "fixed", right: 16, top: 140, zIndex: 10,
        background: "#fff", border: "1px solid #eee", borderRadius: 8,
        padding: 8, fontSize: 12, minWidth: 140,
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
      },
    },
    React.createElement(AntText, { strong: true, style: { fontSize: 12 } }, "Stages"),
    React.createElement("div", { style: { marginTop: 6 } },
      ...rows.map((r: any) =>
        React.createElement(
          "div",
          {
            key: r.id,
            style: {
              padding: "3px 0", cursor: "pointer",
              color: r.active ? "#1a73e8" : "#555",
            },
            onClick: () => {
              const el = document.getElementById(r.id);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            },
          },
          React.createElement(
            "span",
            { style: { color: r.done === r.total && r.total > 0 ? "#52c41a" : "#999" } },
            r.done === r.total && r.total > 0 ? "✓" : "○",
          ),
          " ",
          r.label,
          r.total > 0
            ? React.createElement(
                AntText,
                { type: "secondary", style: { fontSize: 11 } },
                ` ${r.done}/${r.total}`,
              )
            : null,
        ),
      ),
    ),
  );
}

// ── settings card (post-decompose, editable global_config) ─────────

function SettingsCard({ draft, onSaveDraft }: any) {
  const gc = draft.global_config || {};
  const [era, setEra] = React.useState(gc.era || "");
  const [country, setCountry] = React.useState(gc.country || "");
  const [genre, setGenre] = React.useState(gc.genre || "");
  const [tone, setTone] = React.useState(gc.tone || "");
  const [storyAnchor, setStoryAnchor] = React.useState(gc.story_anchor || "");
  const [worldBible, setWorldBible] = React.useState(gc.world_bible || "");
  const [directives, setDirectives] = React.useState(
    Array.isArray(gc.style_directives)
      ? gc.style_directives.join("\n") : "",
  );
  const [concurrency, setConcurrency] = React.useState<number>(
    Number(gc.concurrency) || 3,
  );
  const [saving, setSaving] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  // Reset local state when the draft changes (e.g. after Re-decompose).
  React.useEffect(() => {
    const g = draft.global_config || {};
    setEra(g.era || "");
    setCountry(g.country || "");
    setGenre(g.genre || "");
    setTone(g.tone || "");
    setStoryAnchor(g.story_anchor || "");
    setWorldBible(g.world_bible || "");
    setDirectives(
      Array.isArray(g.style_directives) ? g.style_directives.join("\n") : "",
    );
    setConcurrency(Number(g.concurrency) || 3);
  }, [draft]);

  const save = async () => {
    setSaving(true);
    try {
      const next = JSON.parse(JSON.stringify(draft));
      next.global_config = next.global_config || {};
      next.global_config.era = era.trim();
      next.global_config.country = country.trim();
      next.global_config.genre = genre.trim();
      next.global_config.tone = tone.trim();
      next.global_config.story_anchor = storyAnchor.trim();
      next.global_config.world_bible = worldBible.trim();
      next.global_config.style_directives = directives
        .split("\n").map((s) => s.trim()).filter(Boolean);
      next.global_config.concurrency = Math.max(1, Math.min(5, concurrency));
      // Strip empty strings so global_config stays clean.
      for (const k of ["era", "country", "genre", "tone", "story_anchor", "world_bible"]) {
        if (!next.global_config[k]) delete next.global_config[k];
      }
      if (next.global_config.style_directives.length === 0) {
        delete next.global_config.style_directives;
      }
      await onSaveDraft(next);
      antMessage.success("Settings saved.");
    } catch (e: any) {
      antMessage.error(`Save failed: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const summary = [
    era && `era=${era}`,
    country && `country=${country}`,
    genre && `genre=${genre}`,
    tone && `tone=${tone}`,
    storyAnchor && "anchor: ✓",
    worldBible && "world: ✓",
    directives.trim() &&
      `${directives.split("\n").filter(Boolean).length} directive(s)`,
    `concurrency: ${concurrency}`,
  ].filter(Boolean).join(" · ") || "no story constraints — LLM auto-applied";

  return React.createElement(
    Card,
    {
      size: "small",
      style: { marginTop: 12 },
      title: React.createElement(
        Space, null,
        React.createElement(antd.Switch, {
          size: "small",
          checked: open,
          onChange: setOpen,
        }),
        React.createElement(AntText, { strong: true }, "Story settings"),
        React.createElement(
          AntText,
          { type: "secondary", style: { fontSize: 12 } },
          `· ${summary}`,
        ),
      ),
      extra: open
        ? React.createElement(Button, {
            type: "primary", size: "small",
            loading: saving,
            onClick: save,
            children: "Save settings",
          })
        : null,
    },
    open
      ? React.createElement(Form, { layout: "vertical", style: { marginTop: 4 } },
          React.createElement(Row, { gutter: 12 },
            React.createElement(Col, { span: 6 },
              React.createElement(Form.Item, { label: "Era" },
                React.createElement(Input, {
                  value: era, onChange: (e: any) => setEra(e.target.value),
                  placeholder: "1940s",
                }),
              ),
            ),
            React.createElement(Col, { span: 6 },
              React.createElement(Form.Item, { label: "Country" },
                React.createElement(Input, {
                  value: country,
                  onChange: (e: any) => setCountry(e.target.value),
                  placeholder: "Cuba",
                }),
              ),
            ),
            React.createElement(Col, { span: 6 },
              React.createElement(Form.Item, { label: "Genre" },
                React.createElement(Input, {
                  value: genre,
                  onChange: (e: any) => setGenre(e.target.value),
                }),
              ),
            ),
            React.createElement(Col, { span: 6 },
              React.createElement(Form.Item, { label: "Tone" },
                React.createElement(Input, {
                  value: tone,
                  onChange: (e: any) => setTone(e.target.value),
                }),
              ),
            ),
          ),
          React.createElement(Form.Item, {
            label: "Story anchor",
            extra: "Narrative context propagated to every scene. Short (≤50 words).",
          },
            React.createElement(TextArea, {
              value: storyAnchor,
              onChange: (e: any) => setStoryAnchor(e.target.value),
              rows: 2,
              placeholder: "A weathered Cuban fisherman's quiet test of endurance against the sea — dignified persistence, not defeat.",
            }),
          ),
          React.createElement(Form.Item, {
            label: "World bible (recurring set-design facts)",
            extra: "Invariants that should hold across every scene's setting + style. Stops scene-to-scene drift. 30-80 words.",
          },
            React.createElement(TextArea, {
              value: worldBible,
              onChange: (e: any) => setWorldBible(e.target.value),
              rows: 3,
              placeholder: "Set design: wooden cottage-style fence; chalk-lettered wooden signs (NO blackboards); morning sun upper-right; cottagecore palette — pastel greens, soft creams.",
            }),
          ),
          React.createElement(Form.Item, {
            label: "Style directives (one per line, ≤5)",
            extra: "Layered on every scene's compose prompt. Things like palette, physics rules, continuity.",
          },
            React.createElement(TextArea, {
              value: directives,
              onChange: (e: any) => setDirectives(e.target.value),
              rows: 3,
              placeholder: "warm amber-rose palette\nreal-world physics, no floating objects",
            }),
          ),
          React.createElement(Form.Item, {
            label: "Parallel concurrency (Stage 2 + 3 'Run all')",
            extra: "Number of scenes to fire in parallel. 1 = sequential (current default). 3-5 = fast but watch for DashScope rate limits.",
          },
            React.createElement(InputNumber, {
              min: 1, max: 5, value: concurrency,
              onChange: (v: any) => setConcurrency(Number(v) || 3),
              style: { width: 100 },
            }),
          ),
        )
      : null,
  );
}

// ── state timeline card (ledger view) ───────────────────────────────

function StateTimelineCard({ draft, onSaveDraft }: any) {
  const ledger: any[] = draft.state_changes || [];
  const chars: any[] = draft.assets?.characters ?? [];
  const refs: any[] = draft.assets?.scene_refs ?? [];
  const entities = [
    ...chars.map((c: any) => ({ id: c.id, kind: "character" })),
    ...refs.map((r: any) => ({ id: r.id, kind: "scene_ref" })),
  ];
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<any>(null);
  const [saving, setSaving] = React.useState(false);

  const groupedByEntity = entities.map((e) => ({
    entity: e,
    changes: ledger
      .filter((c) => c.entity === e.id)
      .sort((a, b) => String(a.at_scene).localeCompare(String(b.at_scene))),
  }));

  const saveLedger = async (next: any[]) => {
    setSaving(true);
    try {
      const draft2 = JSON.parse(JSON.stringify(draft));
      draft2.state_changes = next.filter((c) =>
        c && c.entity && c.at_scene
        && ((c.add && c.add.length) || (c.remove && c.remove.length) || c.reset),
      );
      await onSaveDraft(draft2);
      antMessage.success("State ledger saved.");
    } catch (e: any) {
      antMessage.error(`Save failed: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const upsertChange = async (change: any) => {
    const next = [...ledger];
    if (change._origIdx != null) {
      next[change._origIdx] = { ...change };
      delete (next[change._origIdx] as any)._origIdx;
    } else {
      next.push(change);
    }
    await saveLedger(next);
    setEditing(null);
  };

  const deleteChange = async (idx: number) => {
    const next = ledger.filter((_, i) => i !== idx);
    await saveLedger(next);
  };

  const summary = ledger.length
    ? `${ledger.length} change(s) across ${
        new Set(ledger.map((c) => c.entity)).size
      } entit(y/ies)`
    : "no state changes — characters stay at canonical state across all scenes";

  return React.createElement(
    Card,
    {
      size: "small",
      style: { marginTop: 12 },
      title: React.createElement(
        Space, null,
        React.createElement(antd.Switch, {
          size: "small", checked: open, onChange: setOpen,
        }),
        React.createElement(AntText, { strong: true }, "State timeline"),
        React.createElement(AntText,
          { type: "secondary", style: { fontSize: 12 } },
          `· ${summary}`),
      ),
      extra: open
        ? React.createElement(Button, {
            type: "dashed", size: "small",
            icon: React.createElement(PlusOutlined),
            onClick: () => setEditing({
              entity: entities[0]?.id || "", at_scene: "",
              add: [], remove: [], reset: false, note: "",
            }),
            children: "Add change",
          })
        : null,
    },
    open
      ? React.createElement("div", null,
          entities.length === 0
            ? React.createElement(Empty, {
                description: "No characters or settings yet — add some under Stage 0.",
              })
            : null,
          ...groupedByEntity.map(({ entity, changes }) =>
            React.createElement(
              "div",
              { key: entity.id, style: { marginBottom: 12 } },
              React.createElement(AntText, { strong: true, style: { fontSize: 12 } },
                `${entity.kind === "character" ? "👤" : "📍"} ${entity.id}`),
              changes.length === 0
                ? React.createElement(AntText,
                    { type: "secondary", style: { fontSize: 11, display: "block" } },
                    "  (canonical throughout — no state changes)")
                : React.createElement("div", null,
                    ...changes.map((c) => {
                      const origIdx = ledger.indexOf(c);
                      const labelParts = [
                        c.reset && "↺ RESET",
                        c.remove?.length && `− ${c.remove.join(", ")}`,
                        c.add?.length && `+ ${c.add.join(", ")}`,
                      ].filter(Boolean).join("  |  ");
                      return React.createElement(
                        "div",
                        {
                          key: origIdx,
                          style: {
                            padding: "4px 8px", marginTop: 2,
                            border: "1px solid #eee", borderRadius: 4,
                            display: "flex", alignItems: "center", gap: 8,
                          },
                        },
                        React.createElement(Tag, { color: "blue" }, `@${c.at_scene}`),
                        React.createElement(AntText, { style: { fontSize: 12, flex: 1 } },
                          labelParts || "(empty change)"),
                        c.note
                          ? React.createElement(AntText,
                              { type: "secondary", style: { fontSize: 11 } },
                              `— ${c.note}`)
                          : null,
                        React.createElement(Button, {
                          size: "small", type: "text",
                          icon: React.createElement(EditOutlined),
                          onClick: () => setEditing({ ...c, _origIdx: origIdx }),
                        }),
                        React.createElement(Button, {
                          size: "small", type: "text", danger: true,
                          icon: React.createElement(DeleteOutlined),
                          onClick: () => deleteChange(origIdx),
                        }),
                      );
                    }),
                  ),
            ),
          ),
        )
      : null,
    editing
      ? React.createElement(StateChangeEditor, {
          change: editing, entities, saving,
          onCancel: () => setEditing(null),
          onSubmit: upsertChange,
        })
      : null,
  );
}

function StateChangeEditor({ change, entities, saving, onCancel, onSubmit }: any) {
  const [entity, setEntity] = React.useState(change.entity || "");
  const [atScene, setAtScene] = React.useState(change.at_scene || "");
  const [addStr, setAddStr] = React.useState((change.add || []).join(", "));
  const [removeStr, setRemoveStr] = React.useState((change.remove || []).join(", "));
  const [reset, setReset] = React.useState(!!change.reset);
  const [note, setNote] = React.useState(change.note || "");
  return React.createElement(
    Modal,
    {
      open: true,
      title: change._origIdx != null ? "Edit state change" : "Add state change",
      confirmLoading: saving,
      onCancel,
      onOk: () => {
        if (!entity || !atScene) {
          antMessage.warning("entity and at_scene are required");
          return;
        }
        const split = (s: string) =>
          s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
        onSubmit({
          _origIdx: change._origIdx,
          entity: entity.trim(),
          at_scene: atScene.trim(),
          add: split(addStr),
          remove: split(removeStr),
          reset,
          note: note.trim(),
        });
      },
      okText: "Save",
      width: 560,
    },
    React.createElement(Form, { layout: "vertical" },
      React.createElement(Row, { gutter: 12 },
        React.createElement(Col, { span: 14 },
          React.createElement(Form.Item, { label: "Entity (character or setting)" },
            React.createElement(Select, {
              value: entity, onChange: setEntity,
              style: { width: "100%" },
              options: entities.map((e: any) => ({
                value: e.id,
                label: `${e.kind === "character" ? "👤" : "📍"} ${e.id}`,
              })),
            }),
          ),
        ),
        React.createElement(Col, { span: 10 },
          React.createElement(Form.Item, {
            label: "At scene (id like '03')",
          },
            React.createElement(Input, {
              value: atScene,
              onChange: (e: any) => setAtScene(e.target.value),
              placeholder: "03",
            }),
          ),
        ),
      ),
      React.createElement(Form.Item, {
        label: "Add states (comma-separated)",
        extra: "Persistent state set that becomes true at this scene and carries forward (e.g. 'bandaged_right_arm, tired_expression').",
      },
        React.createElement(Input, {
          value: addStr,
          onChange: (e: any) => setAddStr(e.target.value),
          placeholder: "bandaged_right_arm, tired_expression",
        }),
      ),
      React.createElement(Form.Item, {
        label: "Remove states (comma-separated)",
        extra: "States to clear at this scene (typically followed by 'add' of a new state, e.g. remove bandage and add scar).",
      },
        React.createElement(Input, {
          value: removeStr,
          onChange: (e: any) => setRemoveStr(e.target.value),
          placeholder: "bandaged_right_arm",
        }),
      ),
      React.createElement(Form.Item, { label: "Reset (clear ALL prior state for this entity)" },
        React.createElement(antd.Switch, { checked: reset, onChange: setReset }),
      ),
      React.createElement(Form.Item, { label: "Note (why this change happens — for your reference)" },
        React.createElement(Input, {
          value: note,
          onChange: (e: any) => setNote(e.target.value),
          placeholder: "carrot trips while running and bandages his arm",
        }),
      ),
    ),
  );
}

// ── decompose form ───────────────────────────────────────────────────

function DecomposeForm({
  duration, setDuration,
  styleHint, setStyleHint,
  audience, setAudience,
  voice, setVoice,
  era, setEra,
  country, setCountry,
  genre, setGenre,
  tone, setTone,
  storyAnchor, setStoryAnchor,
  styleDirectives, setStyleDirectives,
  worldBible, setWorldBible,
  frameProvider, setFrameProvider,
  videoProvider, setVideoProvider,
  styles, busy, activeStage, status,
  onSubmit,
}: any) {
  const styleOptions = (styles ?? []).map((s: StyleEntry) => ({
    label: `${s.display_name}`,
    value: s.id,
    title: s.description,
  }));
  return React.createElement(
    Form,
    { layout: "vertical" },
    React.createElement(Row, { gutter: 16 },
      React.createElement(Col, { span: 8 },
        React.createElement(Form.Item, { label: "Target duration (s)" },
          React.createElement(InputNumber, {
            min: 20,
            max: 300,
            value: duration,
            onChange: (v: any) => setDuration(v ?? 60),
            style: { width: "100%" },
          }),
        ),
      ),
      React.createElement(Col, { span: 16 },
        React.createElement(Form.Item, {
          label: "Style hint (optional — LLM picks if blank)",
        },
          React.createElement(Select, {
            allowClear: true,
            placeholder: "Let the LLM pick",
            options: styleOptions,
            value: styleHint,
            onChange: (v: any) => setStyleHint(v),
            style: { width: "100%" },
            optionFilterProp: "label",
            showSearch: true,
          }),
        ),
      ),
    ),
    React.createElement(Row, { gutter: 16 },
      React.createElement(Col, { span: 12 },
        React.createElement(Form.Item, { label: "Audience" },
          React.createElement(Input, {
            value: audience,
            onChange: (e: any) => setAudience(e.target.value),
            placeholder: "general / family",
          }),
        ),
      ),
      React.createElement(Col, { span: 12 },
        React.createElement(Form.Item, { label: "Narration voice (CosyVoice)" },
          React.createElement(Select, {
            value: voice,
            onChange: setVoice,
            options: [
              { label: "longshu_v2 (deep male)", value: "longshu_v2" },
              { label: "longwan_v2 (warm male)", value: "longwan_v2" },
              { label: "longxiaoxia_v2 (warm female)", value: "longxiaoxia_v2" },
              { label: "longxiaochun_v2 (neutral)", value: "longxiaochun_v2" },
            ],
            style: { width: "100%" },
          }),
        ),
      ),
    ),

    React.createElement(Row, { gutter: 16 },
      React.createElement(Col, { span: 12 },
        React.createElement(Form.Item, {
          label: "Image model (Stage 0 refs + Stage 2 frames)",
          extra: "Drives every image-gen call: Stage 0 anchor refs AND Stage 2 per-scene frames. Per-scene Stage 2 override available later via the pencil icon.",
        },
          React.createElement(Select, {
            value: frameProvider,
            onChange: setFrameProvider,
            style: { width: "100%" },
            options: [
              { value: "gpt-image-2", label: "🖼️ gpt-image-2 — high quality, ~$0.20-0.30 / frame" },
              { value: "qwen-image", label: "🪶 qwen-image-2.0-pro — ~5× cheaper, weaker identity" },
            ],
          }),
        ),
      ),
      React.createElement(Col, { span: 12 },
        React.createElement(Form.Item, {
          label: "Video model (Stage 3)",
          extra: "Applied to every scene; per-scene override available later via the pencil icon.",
        },
          React.createElement(Select, {
            value: videoProvider,
            onChange: setVideoProvider,
            style: { width: "100%" },
            options: [
              { value: "wan27", label: "🎬 Wan 2.7 — wan2.7-i2v-2026-04-25" },
              { value: "happyhorse", label: "🐎 HappyHorse 1.0 — faster + cheaper" },
              { value: "seedance", label: "🌱 Doubao Seedance 2.0" },
            ],
          }),
        ),
      ),
    ),

    // Optional story-level constraints. Leave blank → LLM auto-picks.
    React.createElement(
      Card,
      {
        size: "small",
        title: React.createElement(AntText, { type: "secondary" },
          "Story constraints (optional — LLM auto-picks if blank)"),
        style: { marginBottom: 12, background: "#fafafa" },
        bodyStyle: { padding: 12 },
      },
      React.createElement(Row, { gutter: 12 },
        React.createElement(Col, { span: 6 },
          React.createElement(Form.Item, { label: "Era" },
            React.createElement(Input, {
              value: era, onChange: (e: any) => setEra(e.target.value),
              placeholder: "1940s",
            }),
          ),
        ),
        React.createElement(Col, { span: 6 },
          React.createElement(Form.Item, { label: "Country" },
            React.createElement(Input, {
              value: country, onChange: (e: any) => setCountry(e.target.value),
              placeholder: "Cuba",
            }),
          ),
        ),
        React.createElement(Col, { span: 6 },
          React.createElement(Form.Item, { label: "Genre" },
            React.createElement(Input, {
              value: genre, onChange: (e: any) => setGenre(e.target.value),
              placeholder: "tragedy / triumph / coming-of-age",
            }),
          ),
        ),
        React.createElement(Col, { span: 6 },
          React.createElement(Form.Item, { label: "Tone" },
            React.createElement(Input, {
              value: tone, onChange: (e: any) => setTone(e.target.value),
              placeholder: "somber / playful / hopeful",
            }),
          ),
        ),
      ),
      React.createElement(Form.Item, {
        label: "Story anchor (overall narrative context — propagates to every scene)",
        extra: "Short — 20-50 words. Era + theme + arc. Avoid visual prose (those belong in per-scene descriptions).",
      },
        React.createElement(TextArea, {
          value: storyAnchor,
          onChange: (e: any) => setStoryAnchor(e.target.value),
          placeholder: "A weathered Cuban fisherman's quiet test of endurance against the sea — a story of dignified persistence, not defeat. 1940s coastal village setting.",
          rows: 2,
        }),
      ),
      React.createElement(Form.Item, {
        label: "World bible — recurring set-design facts (applies to every scene)",
        extra: "Short list of invariants: props that recur, exclusive lighting, palette, camera rules. Stops scene-to-scene drift (e.g. wooden sign vs blackboard, morning vs midday). 30-80 words.",
      },
        React.createElement(TextArea, {
          value: worldBible,
          onChange: (e: any) => setWorldBible(e.target.value),
          placeholder: "Set design: wooden cottage-style fence; rough dirt paths; chalk-lettered wooden signs (NO blackboards); tomato plants always on the east side; morning sun upper-right; cottagecore palette — pastel greens, soft creams, gentle yellows; medium-wide camera at child eye-level.",
          rows: 3,
        }),
      ),
      React.createElement(Form.Item, {
        label: "Style directives (one per line — applied on top of every scene)",
        extra: "e.g. 'warm amber-rose palette', 'real-world physics, no floating objects', 'same time of day across consecutive scenes'. 5 max — more is noise.",
      },
        React.createElement(TextArea, {
          value: styleDirectives,
          onChange: (e: any) => setStyleDirectives(e.target.value),
          placeholder: "warm amber-rose palette, slight desaturation\nreal-world physics, no floating objects\nconsistent low-angle morning light across coastal scenes",
          rows: 3,
        }),
      ),
    ),

    status && !status.has_dashscope
      ? React.createElement(Alert, {
          type: "warning",
          message: "DASHSCOPE_API_KEY missing — decompose will fail. Set it under Environment Variables.",
          showIcon: true,
          style: { marginBottom: 12 },
        })
      : null,
    React.createElement(Form.Item, null,
      React.createElement(Button, {
        type: "primary",
        icon: React.createElement(ScissorOutlined),
        loading: busy && activeStage === "decompose",
        onClick: onSubmit,
        size: "large",
        disabled: !status?.has_dashscope,
        children: "Decompose with LLM",
      }),
    ),
  );
}

// ── draft panel: YAML viewer + stage runners + ref/frame galleries ──

function DraftPanel({
  pid,
  draft,
  projStatus,
  busy,
  activeStage,
  forecast,
  status,
  onRunStage,
  onSaveDraft,
  onReload,
  onAddAnchor,
  onEditAnchor,
  onDeleteAnchor,
  onEditScene,
  liveProgress,
}: any) {
  // Accordion: at most one stage section open at a time. ``null`` means
  // all closed. Auto-pick the first incomplete stage on mount.
  const _defaultOpenStage = React.useMemo<string | null>(() => {
    const refsDone = (projStatus?.stages?.["0"]?.refs ?? []).length;
    const refsTotal =
      (draft.assets?.characters ?? []).length
      + (draft.assets?.scene_refs ?? []).length
      + (draft.assets?.style ? 1 : 0);
    const framesDone = (projStatus?.stages?.["2"]?.frames ?? []).length;
    const totalScenes = (draft.scenes ?? []).length;
    const shotsDone = (projStatus?.stages?.["3"]?.shots ?? []).length;
    const finalDone = (projStatus?.stages?.["4"]?.final ?? []).length;
    if (refsDone < refsTotal) return "stage-0";
    if (framesDone < totalScenes) return "stage-2";
    if (shotsDone < totalScenes) return "stage-3";
    if (finalDone === 0) return "stage-4";
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);   // compute once on mount; user toggles control thereafter
  const [openStage, setOpenStage] = React.useState<string | null>(
    _defaultOpenStage,
  );
  const toggleStage = (id: string) =>
    setOpenStage((cur: string | null) => (cur === id ? null : id));
  const [yamlMode, setYamlMode] = React.useState(false);
  const [yamlText, setYamlText] = React.useState("");
  const [savingYaml, setSavingYaml] = React.useState(false);
  const [loadingYaml, setLoadingYaml] = React.useState(false);

  // Load the on-disk YAML text (preserves comments + formatting)
  // whenever the user opens the editor.
  React.useEffect(() => {
    if (!yamlMode) return;
    let cancelled = false;
    setLoadingYaml(true);
    apiGet<{ yaml: string }>(`/creator/projects/${pid}/yaml`)
      .then((r) => { if (!cancelled) setYamlText(r.yaml ?? ""); })
      .catch((e: any) => {
        antMessage.error(`Could not load YAML: ${e.message ?? e}`);
      })
      .finally(() => { if (!cancelled) setLoadingYaml(false); });
    return () => { cancelled = true; };
  }, [yamlMode, pid]);

  const submitYaml = async (force: boolean): Promise<boolean> => {
    setSavingYaml(true);
    try {
      const res = await fetch(getApiUrl(`/creator/projects/${pid}/yaml`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ yaml: yamlText, force }),
      });
      const txt = await res.text();
      let data: any;
      try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }
      if (res.status === 409 && data?.detail?.code === "rename_detected") {
        // Confirm-then-retry-with-force.
        const renames: any[] = data.detail.renames ?? [];
        await new Promise<void>((resolve, reject) => {
          Modal.confirm({
            title: "Rename detected",
            width: 640,
            content: React.createElement(
              "div",
              null,
              React.createElement(
                Paragraph, null,
                "You changed the id/name of these anchors or scenes. The current files will become orphans — Stage 0/2/3 will treat the renamed entities as new and re-generate from scratch.",
              ),
              React.createElement(
                "ul",
                { style: { fontSize: 12 } },
                ...renames.map((r: any) =>
                  React.createElement(
                    "li",
                    { key: `${r.kind}:${r.from}` },
                    React.createElement("strong", null, `${r.kind}: `),
                    `${r.from} → ${r.to}`,
                    React.createElement(
                      AntText,
                      { type: "secondary", style: { display: "block", fontSize: 11 } },
                      `Orphan files: ${(r.orphan_files || []).join(", ")}`,
                    ),
                  ),
                ),
              ),
              React.createElement(
                Paragraph,
                { type: "secondary", style: { fontSize: 12 } },
                'Prefer to rename via the Anchor UI (per-card pencil), which handles references atomically. Click "Continue anyway" to save the YAML as-is.',
              ),
            ),
            okType: "danger",
            okText: "Continue anyway",
            cancelText: "Cancel save",
            onOk: () => resolve(),
            onCancel: () => reject(new Error("cancelled")),
          });
        });
        // Retry with force=true
        const res2 = await fetch(getApiUrl(`/creator/projects/${pid}/yaml`), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ yaml: yamlText, force: true }),
        });
        if (!res2.ok) {
          const t2 = await res2.text();
          throw new Error(t2 || `${res2.status}`);
        }
        antMessage.success("Saved with rename.");
        setYamlMode(false);
        onReload?.();
        return true;
      }
      if (!res.ok) {
        const msg =
          typeof data?.detail === "string" ? data.detail :
          typeof data?.detail?.message === "string" ? data.detail.message :
          txt;
        throw new Error(msg);
      }
      antMessage.success("Saved.");
      setYamlMode(false);
      onReload?.();
      return true;
    } catch (e: any) {
      if (e?.message !== "cancelled") {
        antMessage.error(`Save failed: ${e.message ?? e}`);
      }
      return false;
    } finally {
      setSavingYaml(false);
    }
  };

  const onSaveYaml = () => submitYaml(false);

  return React.createElement(
    "div",
    null,
    // Overview
    React.createElement(DraftSummary, {
      draft,
      forecast,
      onToggleYaml: () => setYamlMode((v: boolean) => !v),
      yamlMode,
      onSaveDraft,
    }),

    // Story-level settings (era / country / genre / tone / anchor /
    // directives) — editable after decompose. Saves into global_config.
    React.createElement(SettingsCard, {
      draft,
      onSaveDraft,
    }),

    // State timeline — timeline of per-entity state changes
    // (bandage at T03, scar at T05, etc.) — layered into every
    // affected scene's Stage 2 compose prompt.
    React.createElement(StateTimelineCard, {
      draft,
      onSaveDraft,
    }),

    // Raw YAML editor (collapsible)
    yamlMode
      ? React.createElement(
          Card,
          {
            size: "small",
            style: { marginTop: 12 },
            title: "Edit ProjectSpec (YAML)",
            extra: React.createElement(
              Space,
              null,
              React.createElement(Button, {
                size: "small",
                onClick: () => setYamlMode(false),
                children: "Cancel",
              }),
              React.createElement(Button, {
                type: "primary",
                size: "small",
                loading: savingYaml,
                disabled: loadingYaml,
                onClick: onSaveYaml,
                children: "Save YAML",
              }),
            ),
          },
          loadingYaml
            ? React.createElement(Spin)
            : React.createElement(TextArea, {
                rows: 28,
                value: yamlText,
                onChange: (e: any) => setYamlText(e.target.value),
                style: { fontFamily: "monospace", fontSize: 12 },
                spellCheck: false,
              }),
          React.createElement(
            AntText,
            { type: "secondary", style: { fontSize: 11, display: "block", marginTop: 4 } },
            "YAML is the source of truth on disk. Property edits (descriptions, prompts, scene fields) propagate to the next regen. Renaming a character / scene id will warn you — use the per-card pencil icons for safe renames.",
          ),
        )
      : null,

    // Per-stage summary counts — drives the rail + collapsible headers.
    (() => null)(),  // (no-op so the assignments below stay readable)

    // Stage 0 runner + ref gallery — collapsible
    React.createElement(StageSection, {
      id: "stage-0",
      stageLabel: "Stage 0 — anchor refs",
      summary: (() => {
        const chars = (draft.assets?.characters ?? []).length;
        const refs = (draft.assets?.scene_refs ?? []).length;
        const total = chars + refs + (draft.assets?.style ? 1 : 0);
        const done = (projStatus?.stages?.["0"]?.refs ?? []).length;
        return `${done}/${total} generated`;
      })(),
      costUsd: forecast?.stage_0_usd,
      open: openStage === "stage-0",
      onToggle: toggleStage,
      extra: React.createElement(
        Space, null,
        React.createElement(Button, {
          type: "primary",
          loading: busy && activeStage?.startsWith("0"),
          disabled: !status?.has_openai,
          onClick: () => onRunStage("0"),
          children: "Run Stage 0 (all)",
        }),
        React.createElement(Button, {
          size: "small",
          icon: React.createElement(ReloadOutlined),
          onClick: onReload,
        }),
      ),
    },
      !status?.has_openai
        ? React.createElement(Alert, {
            type: "warning",
            message: "OPENAI_API_KEY missing — needed for gpt-image-2.",
            showIcon: true, style: { marginBottom: 12 },
          })
        : null,
      React.createElement(RefGallery, {
        pid, draft, projStatus, busy, activeStage,
        onRunPiece: (kind: string, id: string) =>
          onRunStage(
            kind === "character" ? "0a" :
            kind === "scene_ref" ? "0b" : "0c",
            kind === "character" ? { only_character: id, overwrite: true } :
            kind === "scene_ref" ? { only_scene_ref: id, overwrite: true } :
            { overwrite: true },
          ),
        onAddAnchor, onEditAnchor, onDeleteAnchor,
      }),
    ),

    // Stage 1 — narration
    React.createElement(StageSection, {
      id: "stage-1",
      stageLabel: "Stage 1 — narration",
      summary: (() => {
        const narrated = (draft.scenes ?? []).filter((s: any) => s.has_narration).length;
        const done = (projStatus?.stages?.["1"]?.audio ?? []).length;
        return `${done}/${narrated} narrated`;
      })(),
      costUsd: 0,
      open: openStage === "stage-1",
      onToggle: toggleStage,
      extra: React.createElement(Button, {
        type: "primary",
        loading: busy && activeStage === "1",
        disabled: !status?.has_dashscope,
        onClick: () => onRunStage("1"),
        children: "Generate narration",
      }),
    },
      React.createElement(AudioGallery, {
        pid, draft, projStatus, busy, activeStage,
      }),
    ),

    // Stage 2 — frames
    React.createElement(StageSection, {
      id: "stage-2",
      stageLabel: "Stage 2 — compose frames",
      summary: (() => {
        const total = (draft.scenes ?? []).length;
        const done = (projStatus?.stages?.["2"]?.frames ?? []).length;
        return `${done}/${total} composed`;
      })(),
      costUsd: forecast?.stage_2_usd,
      open: openStage === "stage-2",
      onToggle: toggleStage,
      extra: React.createElement(Button, {
        type: "primary",
        loading: busy && activeStage === "2",
        disabled: !status?.has_openai,
        onClick: () => onRunStageAllParallel("2", false),
        children: `Run Stage 2 (×${Math.max(1, Math.min(5, Number((draft.global_config || {}).concurrency) || 3))})`,
      }),
    },
      React.createElement(FrameGallery, {
        pid, draft, projStatus, busy, activeStage,
        liveProgress,
        onRunOne: (sceneId: string) =>
          onRunStage("2", { only_scene: sceneId, overwrite: true }),
        onEditScene,
      }),
    ),

    // Stage 3 — animate
    React.createElement(StageSection, {
      id: "stage-3",
      stageLabel: "Stage 3 — animate",
      summary: (() => {
        const total = (draft.scenes ?? []).length;
        const done = (projStatus?.stages?.["3"]?.shots ?? []).length;
        return `${done}/${total} animated`;
      })(),
      costUsd: forecast?.stage_3_usd,
      open: openStage === "stage-3",
      onToggle: toggleStage,
      extra: React.createElement(Button, {
        type: "primary",
        danger: true,
        loading: busy && activeStage === "3",
        disabled: !status?.has_dashscope,
        onClick: () => {
          const n = draft.scenes?.length || 0;
          const conc = Math.max(1, Math.min(5,
            Number((draft.global_config || {}).concurrency) || 3));
          const wallMin = Math.ceil((n / conc) * 10);
          Modal.confirm({
            title: "Animate ALL scenes?",
            content:
              `Each scene calls the chosen video model (~$0.50, 5-15 min). ` +
              `${n} scenes at concurrency ${conc} ≈ $${forecast?.stage_3_usd ?? "?"}` +
              ` and ~${wallMin} min wall-clock. Keep this browser tab open.`,
            okType: "danger",
            okText: `Animate all (×${conc} parallel)`,
            onOk: () => { void onRunStageAllParallel("3", false); },
          });
        },
        children: "Animate all scenes",
      }),
    },
      React.createElement(ShotGallery, {
        pid, draft, projStatus, busy, activeStage,
        onRunOne: (sceneId: string) =>
          onRunStage("3", { only_scene: sceneId, overwrite: true }),
        onEditScene,
      }),
    ),

    // Stage 4 — final MP4
    React.createElement(StageSection, {
      id: "stage-4",
      stageLabel: "Stage 4 — final MP4",
      summary: (() => {
        const final = (projStatus?.stages?.["4"]?.final ?? []).length;
        return final > 0 ? "✓ assembled" : "not yet assembled";
      })(),
      costUsd: 0,
      open: openStage === "stage-4",
      onToggle: toggleStage,
      extra: React.createElement(Button, {
        type: "primary",
        loading: busy && activeStage === "4",
        onClick: () => onRunStage("4"),
        children: "Build final MP4",
      }),
    },
      React.createElement(FinalGallery, {
        pid, draft, projStatus, busy, activeStage,
      }),
    ),

    // Right-edge stage rail — sticky, click-to-jump per stage.
    React.createElement(StageRail, {
      rows: [
        {
          id: "stage-0",
          label: "Stage 0 refs",
          active: activeStage?.startsWith("0"),
          done: (projStatus?.stages?.["0"]?.refs ?? []).length,
          total: (draft.assets?.characters ?? []).length
                 + (draft.assets?.scene_refs ?? []).length
                 + (draft.assets?.style ? 1 : 0),
        },
        {
          id: "stage-1",
          label: "Stage 1 narr.",
          active: activeStage === "1",
          done: (projStatus?.stages?.["1"]?.audio ?? []).length,
          total: (draft.scenes ?? []).filter((s: any) => s.has_narration).length,
        },
        {
          id: "stage-2",
          label: "Stage 2 frames",
          active: activeStage === "2",
          done: (projStatus?.stages?.["2"]?.frames ?? []).length,
          total: (draft.scenes ?? []).length,
        },
        {
          id: "stage-3",
          label: "Stage 3 anim",
          active: activeStage === "3",
          done: (projStatus?.stages?.["3"]?.shots ?? []).length,
          total: (draft.scenes ?? []).length,
        },
        {
          id: "stage-4",
          label: "Stage 4 final",
          active: activeStage === "4",
          done: (projStatus?.stages?.["4"]?.final ?? []).length,
          total: 1,
        },
      ],
    }),

    React.createElement(
      Paragraph,
      { type: "secondary", style: { fontSize: 12, marginTop: 16 } },
      "Stage 3 takes 5–15 min per scene — you'll get a browser notification when done. Stage 4 needs ",
      React.createElement("code", null, "ffmpeg"),
      " on PATH (",
      React.createElement("code", null, "brew install ffmpeg"),
      " on macOS).",
    ),
  );
}

// ── draft summary panel ──────────────────────────────────────────────

function DraftSummary({
  draft, forecast, onToggleYaml, yamlMode, onSaveDraft,
}: any) {
  const chars: any[] = draft.assets?.characters ?? [];
  const refs: any[] = draft.assets?.scene_refs ?? [];
  const scenes: any[] = draft.scenes ?? [];
  const styleId = draft.assets?.style?.catalog_id;
  const defaultProvider =
    (draft.global_config?.video_provider as string | undefined) || "wan27";
  const defaultFrameProvider =
    (draft.global_config?.frame_provider as string | undefined) || "gpt-image-2";
  const [savingProvider, setSavingProvider] = React.useState(false);
  const [savingFrameProvider, setSavingFrameProvider] = React.useState(false);

  const updateDefaultProvider = async (next: string) => {
    setSavingProvider(true);
    try {
      const newDraft = JSON.parse(JSON.stringify(draft));
      newDraft.global_config = newDraft.global_config || {};
      newDraft.global_config.video_provider = next;
      // Sync every scene's per-scene override to match the new default.
      // Without this, a Stage 3 "Animate all" still uses each scene's
      // existing (and now-stale) video_provider field. The dropdown is
      // labeled "default" but expected behavior here is "apply
      // everywhere" — overriding individual scene choices.
      let synced = 0;
      for (const s of (newDraft.scenes || [])) {
        if (s.video_provider !== next) {
          s.video_provider = next;
          synced += 1;
        }
      }
      await onSaveDraft(newDraft);
      if (synced > 0) {
        antMessage.success(
          `Default set to ${next}; ${synced} scene(s) synced.`,
        );
      }
    } catch (e: any) {
      antMessage.error(`Save failed: ${e.message ?? e}`);
    } finally {
      setSavingProvider(false);
    }
  };

  const updateDefaultFrameProvider = async (next: string) => {
    setSavingFrameProvider(true);
    try {
      const newDraft = JSON.parse(JSON.stringify(draft));
      newDraft.global_config = newDraft.global_config || {};
      newDraft.global_config.frame_provider = next;
      let synced = 0;
      for (const s of (newDraft.scenes || [])) {
        if (s.frame_provider !== next) {
          s.frame_provider = next;
          synced += 1;
        }
      }
      await onSaveDraft(newDraft);
      if (synced > 0) {
        antMessage.success(
          `Default set to ${next}; ${synced} scene(s) synced.`,
        );
      }
    } catch (e: any) {
      antMessage.error(`Save failed: ${e.message ?? e}`);
    } finally {
      setSavingFrameProvider(false);
    }
  };

  return React.createElement(
    Card,
    {
      size: "small",
      title: React.createElement(
        Space,
        { size: 8 },
        React.createElement(FileTextOutlined),
        "Draft",
        React.createElement(Tag, null, draft.project_id),
      ),
      // Right-side cluster: Stage 3 default video picker + Edit YAML.
      // Moved out of the stats row to free up space for the 4 counts.
      extra: React.createElement(
        Space,
        { size: 8 },
        React.createElement(
          Tooltip,
          {
            title:
              "Default image model — used for both Stage 0 anchor refs and Stage 2 per-scene frames. Changing this re-syncs every scene's frame_provider. Per-scene Stage 2 override via the pencil icon on each scene card.",
          },
          React.createElement(Select, {
            value: defaultFrameProvider,
            disabled: savingFrameProvider,
            onChange: updateDefaultFrameProvider,
            size: "small",
            style: { minWidth: 170 },
            options: [
              { value: "gpt-image-2", label: "🖼️ gpt-image-2" },
              { value: "qwen-image", label: "🪶 qwen-image" },
            ],
          }),
        ),
        React.createElement(
          Tooltip,
          {
            title:
              "Default Stage 3 video model. Changing this re-syncs every scene's video_provider. Per-scene override available via the pencil icon on each scene card.",
          },
          React.createElement(Select, {
            value: defaultProvider,
            disabled: savingProvider,
            onChange: updateDefaultProvider,
            size: "small",
            style: { minWidth: 180 },
            options: [
              { value: "wan27", label: "🎬 Wan 2.7" },
              { value: "happyhorse", label: "🐎 HappyHorse 1.0" },
              { value: "seedance", label: "🌱 Seedance 2.0" },
            ],
          }),
        ),
        React.createElement(Button, {
          size: "small",
          icon: React.createElement(EditOutlined),
          onClick: onToggleYaml,
          type: yamlMode ? "primary" : "default",
          children: yamlMode ? "Hide YAML" : "Edit YAML",
        }),
      ),
    },
    // Stats row — back to clean 4-up so Style name isn't truncated.
    React.createElement(Row, { gutter: 16 },
      React.createElement(Col, { span: 6 }, React.createElement(Stat, { label: "Scenes", value: scenes.length })),
      React.createElement(Col, { span: 6 }, React.createElement(Stat, { label: "Characters", value: chars.length })),
      React.createElement(Col, { span: 6 }, React.createElement(Stat, { label: "Settings", value: refs.length })),
      React.createElement(Col, { span: 6 }, React.createElement(Stat, { label: "Style", value: styleId ?? "—" })),
    ),
    forecast
      ? React.createElement(
          AntText,
          { type: "secondary", style: { fontSize: 12, display: "block", marginTop: 8 } },
          `≈ $${forecast.total_usd} total — Stage 0 $${forecast.stage_0_usd} · Stage 2 $${forecast.stage_2_usd} · Stage 3 $${forecast.stage_3_usd}`,
        )
      : null,
  );
}

function Stat({ label, value }: any) {
  return React.createElement(
    "div",
    null,
    React.createElement(AntText, { type: "secondary", style: { fontSize: 12 } }, label),
    React.createElement(
      "div",
      { style: { fontSize: 22, fontWeight: 600, lineHeight: 1.2 } },
      String(value),
    ),
  );
}

// ── ref gallery (Stage 0) ────────────────────────────────────────────

function RefGallery({
  pid, draft, projStatus, busy, activeStage,
  onRunPiece, onAddAnchor, onEditAnchor, onDeleteAnchor,
}: any) {
  const refsByName = new Map<string, any>(
    (projStatus?.stages?.["0"]?.refs ?? []).map((r: any) => [r.name, r]),
  );
  const chars: any[] = draft.assets?.characters ?? [];
  const sRefs: any[] = draft.assets?.scene_refs ?? [];
  const style = draft.assets?.style;

  const renderItem = (it: {
    kind: string; id: string; name: string; refName: string;
    description?: string; raw?: any;
  }) => {
    const exists = refsByName.has(it.refName);
    const busyHere = busy && (
      (it.kind === "character" && activeStage === "0a") ||
      (it.kind === "scene_ref" && activeStage === "0b") ||
      (it.kind === "style" && activeStage === "0c") ||
      activeStage === "0"
    );
    return React.createElement(
      Col,
      { key: `${it.kind}:${it.id}`, span: 8 },
      React.createElement(
        Card,
        {
          size: "small",
          title: React.createElement(
            Space,
            { size: 4 },
            exists
              ? React.createElement(CheckCircleTwoTone, { twoToneColor: "#52c41a" })
              : React.createElement(ExclamationCircleOutlined, { style: { color: "#bbb" } }),
            React.createElement(AntText, { ellipsis: true, style: { maxWidth: 140 } }, it.name),
          ),
          extra: React.createElement(
            Space,
            { size: 2 },
            it.kind !== "style"
              ? React.createElement(Tooltip, { title: "Edit description" },
                  React.createElement(Button, {
                    size: "small",
                    type: "text",
                    icon: React.createElement(EditOutlined),
                    onClick: () => onEditAnchor?.(it.kind, it.raw),
                  }),
                )
              : null,
            it.kind !== "style"
              ? React.createElement(Tooltip, { title: "Delete anchor" },
                  React.createElement(Button, {
                    size: "small",
                    type: "text",
                    danger: true,
                    icon: React.createElement(DeleteOutlined),
                    onClick: () => onDeleteAnchor?.(it.kind, it.id),
                  }),
                )
              : null,
            React.createElement(Button, {
              size: "small",
              loading: busyHere,
              icon: React.createElement(ReloadOutlined),
              onClick: () => onRunPiece(it.kind, it.id),
              children: exists ? "Regen" : "Gen",
            }),
          ),
          bodyStyle: { padding: 8 },
        },
        exists
          ? React.createElement(Image, {
              src: refUrl(pid, it.refName),
              style: { width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 4 },
              fallback: "",
            })
          : React.createElement(
              "div",
              {
                style: {
                  width: "100%",
                  height: 220,
                  background: "#fafafa",
                  border: "1px dashed #d9d9d9",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#bbb",
                },
              },
              busyHere ? React.createElement(Spin) : "Not generated",
            ),
        it.description
          ? React.createElement(
              AntText,
              {
                type: "secondary",
                style: { fontSize: 11, display: "block", marginTop: 6 },
                ellipsis: { tooltip: it.description },
              },
              String(it.description).slice(0, 120),
            )
          : null,
      ),
    );
  };

  const sectionHeader = (label: string, kind: "character" | "scene_ref" | null) =>
    React.createElement(
      "div",
      {
        style: {
          marginTop: 12, marginBottom: 8,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        },
      },
      React.createElement(AntText, { strong: true }, label),
      kind
        ? React.createElement(Button, {
            size: "small",
            type: "dashed",
            icon: React.createElement(PlusOutlined),
            onClick: () => onAddAnchor?.(kind),
            children: kind === "character" ? "Add character" : "Add setting",
          })
        : null,
    );

  return React.createElement(
    "div",
    null,
    sectionHeader(`Style — anchored first so characters carry its look`, null),
    style?.catalog_id
      ? React.createElement(Row, { gutter: [12, 12] },
          renderItem({
            kind: "style",
            id: style.catalog_id,
            name: `style: ${style.catalog_id}`,
            refName: "style_ref.png",
            description: style.description,
          }),
        )
      : React.createElement(Empty, { description: "No style picked" }),

    sectionHeader(`Characters (${chars.length})`, "character"),
    chars.length
      ? React.createElement(Row, { gutter: [12, 12] },
          ...chars.map((c: any) => renderItem({
            kind: "character", id: c.id, name: c.id,
            refName: `${c.id}_ref.png`, description: c.description, raw: c,
          })),
        )
      : React.createElement(Empty, {
          description: 'No characters — click "Add character" above.',
          imageStyle: { height: 40 },
        }),

    sectionHeader(`Settings (${sRefs.length})`, "scene_ref"),
    sRefs.length
      ? React.createElement(Row, { gutter: [12, 12] },
          ...sRefs.map((r: any) => renderItem({
            kind: "scene_ref", id: r.id, name: r.id,
            refName: `scene_${r.id}_ref.png`, description: r.description, raw: r,
          })),
        )
      : React.createElement(Empty, {
          description: 'No settings — click "Add setting" above.',
          imageStyle: { height: 40 },
        }),
  );
}

// ── frame gallery (Stage 2) ──────────────────────────────────────────

function AnchorTags({ scene }: any) {
  const chars: string[] = scene.uses_characters ?? [];
  const ref: string | null = scene.uses_scene_ref || null;
  const usesStyle: boolean =
    scene.uses_style === undefined ? true : !!scene.uses_style;
  if (scene.standalone && !chars.length && !ref) {
    return React.createElement(
      Tag,
      { color: "default", style: { fontSize: 10 } },
      "standalone",
    );
  }
  return React.createElement(
    "div",
    { style: { marginTop: 4, lineHeight: "20px" } },
    usesStyle
      ? React.createElement(
          Tag, { color: "purple", style: { fontSize: 10 } },
          "style",
        )
      : null,
    ref
      ? React.createElement(
          Tag, { color: "geekblue", style: { fontSize: 10 } },
          `📍 ${ref}`,
        )
      : null,
    ...chars.map((c: string) =>
      React.createElement(
        Tag,
        { key: c, color: "cyan", style: { fontSize: 10 } },
        `👤 ${c}`,
      ),
    ),
    chars.length === 0 && !ref && !scene.standalone
      ? React.createElement(
          Tag, { color: "red", style: { fontSize: 10 } },
          "⚠ no anchors",
        )
      : null,
  );
}

function FrameRegenNotes({ pid, scene, onSaved }: any) {
  const [value, setValue] = React.useState<string>(scene.regen_notes ?? "");
  const [savedValue, setSavedValue] = React.useState<string>(
    scene.regen_notes ?? "",
  );
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    setValue(scene.regen_notes ?? "");
    setSavedValue(scene.regen_notes ?? "");
  }, [scene.regen_notes]);
  const dirty = value !== savedValue;
  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await apiJson(
        "PATCH",
        `/creator/projects/${pid}/scenes/${scene.id}`,
        { regen_notes: value },
      );
      setSavedValue(value);
      onSaved?.(value);
    } catch (e: any) {
      antMessage.error(`Note save failed: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };
  return React.createElement(
    "div",
    { style: { marginTop: 6 } },
    React.createElement(TextArea, {
      value,
      onChange: (e: any) => setValue(e.target.value),
      onBlur: save,
      placeholder: "Notes for next Regen — e.g. \"marlin smaller, no hat band\"",
      autoSize: { minRows: 1, maxRows: 4 },
      style: { fontSize: 11, background: dirty ? "#fffbe6" : undefined },
      disabled: saving,
    }),
    dirty
      ? React.createElement(
          AntText,
          { type: "warning", style: { fontSize: 10 } },
          "unsaved · click outside to save",
        )
      : savedValue
        ? React.createElement(
            AntText,
            { type: "secondary", style: { fontSize: 10 } },
            "will be applied on next Regen",
          )
        : null,
  );
}

function FrameGallery({
  pid, draft, projStatus, busy, activeStage, onRunOne, onEditScene, liveProgress,
}: any) {
  const live = liveProgress || {};
  const framesByName = new Map<string, any>(
    (projStatus?.stages?.["2"]?.frames ?? []).map((r: any) => [r.name, r]),
  );
  const scenes: any[] = draft.scenes ?? [];
  if (!scenes.length) {
    return React.createElement(Empty, { description: "No scenes in draft." });
  }
  return React.createElement(
    Row,
    { gutter: [12, 12] },
    ...scenes.map((s: any) => {
      const refName = `${s.id}_${s.name}_frame.png`;
      const exists = framesByName.has(refName);
      const livePhase = live[s.id]?.state;  // 'running' | 'done' | 'failed'
      const liveStageMatch = live[s.id]?.stage === "2";
      const liveBusy = liveStageMatch && livePhase === "running";
      const busyHere = liveBusy || (busy && activeStage === "2");
      const hasNotes = !!(s.regen_notes && s.regen_notes.trim());
      return React.createElement(
        Col,
        { key: s.id, span: 12 },
        React.createElement(
          Card,
          {
            size: "small",
            title: React.createElement(
              Space, { size: 4 },
              exists
                ? React.createElement(CheckCircleTwoTone, { twoToneColor: "#52c41a" })
                : React.createElement(ExclamationCircleOutlined, { style: { color: "#bbb" } }),
              `${s.id} — ${s.name}`,
              React.createElement(Tag, null, `${s.duration}s`),
              (() => {
                const fp = s.frame_provider || "gpt-image-2";
                const tagSpec = fp === "qwen-image"
                  ? { color: "cyan", label: "🪶 qwen" }
                  : { color: "purple", label: "🖼️ gpt" };
                return React.createElement(
                  Tag,
                  { color: tagSpec.color, style: { fontSize: 10 } },
                  tagSpec.label,
                );
              })(),
              liveBusy
                ? React.createElement(
                    Tag,
                    { color: "processing", style: { fontSize: 10 } },
                    "● composing",
                  )
                : null,
              hasNotes
                ? React.createElement(
                    Tooltip,
                    { title: `Will apply: ${s.regen_notes}` },
                    React.createElement(
                      Tag,
                      { color: "orange", style: { fontSize: 10 } },
                      "📝 note",
                    ),
                  )
                : null,
            ),
            extra: React.createElement(
              Space, { size: 2 },
              React.createElement(Tooltip, { title: "Edit scene" },
                React.createElement(Button, {
                  size: "small",
                  type: "text",
                  icon: React.createElement(EditOutlined),
                  onClick: () => onEditScene?.(s.id),
                }),
              ),
              React.createElement(Button, {
                size: "small",
                loading: busyHere,
                icon: React.createElement(ReloadOutlined),
                onClick: () => onRunOne(s.id),
                children: exists
                  ? (hasNotes ? "Regen w/ note" : "Regen")
                  : "Gen",
                type: hasNotes ? "primary" : "default",
              }),
            ),
            bodyStyle: { padding: 8 },
          },
          exists
            ? React.createElement(Image, {
                src: refUrl(pid, refName),
                style: { width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 4 },
                fallback: "",
              })
            : React.createElement(
                "div",
                {
                  style: {
                    width: "100%",
                    height: 360,
                    background: "#fafafa",
                    border: "1px dashed #d9d9d9",
                    borderRadius: 4,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#bbb",
                  },
                },
                busyHere ? React.createElement(Spin) : "Not composed",
              ),
          React.createElement(AnchorTags, { scene: s }),
          s.scene_description
            ? React.createElement(
                AntText,
                {
                  type: "secondary",
                  style: { fontSize: 11, display: "block", marginTop: 4 },
                  ellipsis: { tooltip: s.scene_description },
                },
                String(s.scene_description).slice(0, 120),
              )
            : null,
          s.narration
            ? React.createElement(
                "div",
                { style: { marginTop: 4 } },
                React.createElement(
                  Tag, { color: "blue", style: { fontSize: 10 } },
                  "narration",
                ),
                React.createElement(
                  AntText,
                  { type: "secondary", style: { fontSize: 11 } },
                  String(s.narration).slice(0, 80),
                ),
              )
            : null,
          React.createElement(FrameRegenNotes, { pid, scene: s }),
        ),
      );
    }),
  );
}

// ── audio gallery (Stage 1) ──────────────────────────────────────────

function AudioGallery({ pid, draft, projStatus, busy, activeStage }: any) {
  const audioByName = new Map<string, any>(
    (projStatus?.stages?.["1"]?.audio ?? []).map((r: any) => [r.name, r]),
  );
  const narratedScenes = (draft.scenes ?? []).filter(
    (s: any) => s.has_narration,
  );
  if (!narratedScenes.length) {
    return React.createElement(Empty, {
      description: "No narrated scenes — Stage 1 has nothing to do.",
      imageStyle: { height: 40 },
    });
  }
  const busyHere = busy && activeStage === "1";
  return React.createElement(
    Row,
    { gutter: [12, 12] },
    ...narratedScenes.map((s: any) => {
      const sid = s.id ?? s.scene_id;
      const name = `${sid}_${s.name}_narration.mp3`;
      const exists = audioByName.has(name);
      return React.createElement(
        Col,
        { key: sid, span: 12 },
        React.createElement(
          Card,
          {
            size: "small",
            title: React.createElement(
              Space, null,
              exists
                ? React.createElement(CheckCircleTwoTone, { twoToneColor: "#52c41a" })
                : React.createElement(ExclamationCircleOutlined, { style: { color: "#bbb" } }),
              `${sid} — ${s.name}`,
              React.createElement(Tag, null, `${s.duration}s`),
            ),
            bodyStyle: { padding: 8 },
          },
          exists
            ? React.createElement("audio", {
                controls: true,
                src: refUrl(pid, name),
                style: { width: "100%" },
              })
            : React.createElement(
                AntText,
                { type: "secondary", style: { fontSize: 11 } },
                busyHere ? "Generating..." : "Not generated",
              ),
          React.createElement(
            AntText,
            {
              type: "secondary",
              style: { fontSize: 11, display: "block", marginTop: 4 },
              ellipsis: { tooltip: s.narration },
            },
            String(s.narration || "").slice(0, 100),
          ),
        ),
      );
    }),
  );
}

// ── shot gallery (Stage 3) — Wan 2.7 I2V ─────────────────────────────

function ShotGallery({
  pid, draft, projStatus, busy, activeStage, onRunOne, onEditScene,
}: any) {
  const shotsByName = new Map<string, any>(
    (projStatus?.stages?.["3"]?.shots ?? []).map((r: any) => [r.name, r]),
  );
  const scenes: any[] = draft.scenes ?? [];
  if (!scenes.length) {
    return React.createElement(Empty, { description: "No scenes." });
  }
  return React.createElement(
    Row,
    { gutter: [12, 12] },
    ...scenes.map((s: any) => {
      const sid = s.id ?? s.scene_id;
      const refName = `${sid}_${s.name}_raw.mp4`;
      const exists = shotsByName.has(refName);
      const busyHere = busy && activeStage === "3";
      return React.createElement(
        Col,
        { key: sid, span: 12 },
        React.createElement(
          Card,
          {
            size: "small",
            title: React.createElement(
              Space, { size: 4 },
              exists
                ? React.createElement(CheckCircleTwoTone, { twoToneColor: "#52c41a" })
                : React.createElement(ExclamationCircleOutlined, { style: { color: "#bbb" } }),
              `${sid} — ${s.name}`,
              React.createElement(Tag, null, `${s.duration}s`),
              (() => {
                const vp = s.video_provider || "wan27";
                const tagSpec =
                  vp === "happyhorse"
                    ? { color: "magenta", label: "🐎 happyhorse" }
                    : vp === "seedance"
                      ? { color: "green", label: "🌱 seedance" }
                      : { color: "blue", label: "🎬 wan2.7" };
                return React.createElement(
                  Tag,
                  { color: tagSpec.color, style: { fontSize: 10 } },
                  tagSpec.label,
                );
              })(),
            ),
            extra: React.createElement(
              Space, { size: 2 },
              React.createElement(Tooltip, { title: "Edit scene" },
                React.createElement(Button, {
                  size: "small",
                  type: "text",
                  icon: React.createElement(EditOutlined),
                  onClick: () => onEditScene?.(sid),
                }),
              ),
              React.createElement(Button, {
                size: "small",
                loading: busyHere,
                icon: React.createElement(ReloadOutlined),
                onClick: () => onRunOne(sid),
                children: exists ? "Regen" : "Animate",
              }),
            ),
            bodyStyle: { padding: 8 },
          },
          exists
            ? React.createElement("video", {
                src: refUrl(pid, refName),
                controls: true,
                preload: "metadata",
                style: { width: "100%", maxHeight: 360, borderRadius: 4, background: "#000" },
              })
            : React.createElement(
                "div",
                {
                  style: {
                    width: "100%", height: 200,
                    background: "#fafafa",
                    border: "1px dashed #d9d9d9",
                    borderRadius: 4,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#bbb",
                  },
                },
                busyHere
                  ? React.createElement(
                      "div",
                      { style: { textAlign: "center" } },
                      React.createElement(Spin),
                      React.createElement(
                        "div",
                        { style: { fontSize: 11, marginTop: 8 } },
                        "5-15 min · keep tab open",
                      ),
                    )
                  : "Not animated",
              ),
          React.createElement(AnchorTags, {
            scene: { ...s, id: sid },
          }),
          s.motion_prompt
            ? React.createElement(
                AntText,
                {
                  type: "secondary",
                  style: { fontSize: 11, display: "block", marginTop: 4 },
                  ellipsis: { tooltip: s.motion_prompt },
                },
                String(s.motion_prompt).slice(0, 100),
              )
            : null,
        ),
      );
    }),
  );
}

// ── final MP4 gallery (Stage 4) ──────────────────────────────────────

function FinalGallery({ pid, draft, projStatus, busy, activeStage }: any) {
  const finals: any[] = projStatus?.stages?.["4"]?.final ?? [];
  const busyHere = busy && activeStage === "4";
  if (busyHere && finals.length === 0) {
    return React.createElement(
      "div",
      { style: { padding: 24, textAlign: "center" } },
      React.createElement(Spin),
      React.createElement(
        "div",
        { style: { marginTop: 12, color: "#888" } },
        "Stitching scenes with ffmpeg (1-2 min)...",
      ),
    );
  }
  if (!finals.length) {
    return React.createElement(Empty, {
      description: 'Run "Build final MP4" once all scenes are animated and narration is generated.',
    });
  }
  return React.createElement(
    "div",
    null,
    ...finals.map((f: any) =>
      React.createElement(
        Card,
        {
          key: f.name,
          size: "small",
          title: f.name,
          extra: React.createElement(
            AntText,
            { type: "secondary", style: { fontSize: 12 } },
            `${(f.size / 1e6).toFixed(1)} MB`,
          ),
          style: { marginBottom: 8 },
        },
        React.createElement("video", {
          src: refUrl(pid, f.name),
          controls: true,
          preload: "metadata",
          style: { width: "100%", maxHeight: 480, borderRadius: 4, background: "#000" },
        }),
        React.createElement(
          AntText,
          { type: "secondary", style: { fontSize: 11, display: "block", marginTop: 4 } },
          React.createElement("a", {
            href: refUrl(pid, f.name),
            download: f.name,
          }, "Download"),
        ),
      ),
    ),
  );
}

// ── route registration ───────────────────────────────────────────────

// Wrap CreatorPage in our error boundary so a render crash surfaces
// the stack trace inline instead of being swallowed by the console's
// generic "Something went wrong" page.
function CreatorPageWithBoundary(): any {
  return React.createElement(
    CreatorErrorBoundary, null,
    React.createElement(CreatorPage),
  );
}

class QwenPawCreatorPlugin {
  readonly id = "qwenpaw-creator";
  setup(): void {
    window.QwenPaw.registerRoutes?.(this.id, [
      {
        path: "/plugin/qwenpaw-creator/storybook",
        component: CreatorPageWithBoundary,
        label: "Storybook Creator",
        icon: "🎬",
        priority: 50,
      },
    ]);
  }
}

new QwenPawCreatorPlugin().setup();
