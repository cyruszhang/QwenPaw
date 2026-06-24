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
  PushpinOutlined,
  ReloadOutlined,
  SoundOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  EyeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  CheckCircleTwoTone,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  VideoCameraOutlined,
  AppstoreOutlined,
  OrderedListOutlined,
  ExportOutlined,
  RightOutlined,
  AudioOutlined,
  SettingOutlined,
} = antdIcons;
const FoldIcon = MenuFoldOutlined ?? FileTextOutlined;
const UnfoldIcon = MenuUnfoldOutlined ?? FileTextOutlined;
const PreviewIcon = EyeOutlined ?? PictureOutlined;
const StudioModeIcon =
  AppstoreOutlined ?? VideoCameraOutlined ?? PlayCircleOutlined;
const ClassicModeIcon = OrderedListOutlined ?? FileTextOutlined;
const ReelHeaderIcon = VideoCameraOutlined ?? PlayCircleOutlined;
const OpenClassicIcon = ExportOutlined ?? ClassicModeIcon;
const ForwardIcon = RightOutlined ?? PlayCircleOutlined;
const DirectorIcon = EditOutlined ?? VideoCameraOutlined ?? FileTextOutlined;
const SceneScopeIcon = ReelHeaderIcon;
const DictateIcon = AudioOutlined ?? SoundOutlined ?? FileTextOutlined;
const AdvancedOptionsIcon = SettingOutlined ?? FileTextOutlined;
const AnchorStageIcon =
  PushpinOutlined ?? CloudUploadOutlined ?? FileTextOutlined;
const NarrationStageIcon = SoundOutlined ?? FileTextOutlined;
const MotionStageIcon = VideoCameraOutlined ?? PlayCircleOutlined;
const FinalStageIcon =
  CheckCircleOutlined ?? CheckCircleTwoTone ?? ScissorOutlined;

function DirectorBoardIcon({
  size = 20,
  strokeWidth = 1.8,
}: {
  size?: number;
  strokeWidth?: number;
}): any {
  const stroke = {
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  return React.createElement(
    "svg",
    {
      "aria-hidden": true,
      focusable: false,
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      style: { display: "block" },
    },
    React.createElement("path", {
      d: "M4.25 9h15.5v9.25a1.5 1.5 0 0 1-1.5 1.5H5.75a1.5 1.5 0 0 1-1.5-1.5V9Z",
      ...stroke,
    }),
    React.createElement("path", {
      d: "m4.25 9 1.2-4.2a1.5 1.5 0 0 1 1.9-1l10.8 3.08A1.9 1.9 0 0 1 19.75 9",
      ...stroke,
    }),
    React.createElement("path", { d: "M8.25 4.15 6.8 9", ...stroke }),
    React.createElement("path", { d: "M12.2 5.28 10.8 9", ...stroke }),
    React.createElement("path", { d: "M16.15 6.4 14.8 9", ...stroke }),
    React.createElement("path", { d: "M4.25 12.55h15.5", ...stroke }),
    React.createElement("path", { d: "M8 16h5.6", ...stroke }),
  );
}

function StorybookSidebarIcon(): any {
  return React.createElement(DirectorBoardIcon, {
    size: 20,
    strokeWidth: 1.8,
  });
}

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

function parseMaybeJson(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function compactApiError(error: any): string {
  const raw = String(error?.message ?? error ?? "Unknown error").trim();
  const detail = raw
    .replace(/^Error:\s*/i, "")
    .replace(/^stage\s+([.\d]+)\s+failed:\s*/i, "Stage $1 failed: ");

  const taskMatch = detail.match(/task failed:\s*(\{.*\})\s*$/s);
  if (taskMatch) {
    const outer = parseMaybeJson(taskMatch[1]);
    const nested =
      typeof outer?.message === "string" ? parseMaybeJson(outer.message) : null;
    const provider = nested?.error;
    if (provider?.message) {
      const code = provider.code || outer?.code;
      return `${code ? `${code}: ` : ""}${provider.message}`;
    }
    if (outer?.message) return String(outer.message);
  }

  const json = parseMaybeJson(detail);
  if (typeof json?.detail === "string") return json.detail;
  if (Array.isArray(json?.detail)) {
    return json.detail
      .map((item: any) => item?.msg || item?.message || JSON.stringify(item))
      .join("; ");
  }
  return detail || "Unknown error";
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
          type: "error",
          showIcon: true,
          message: "Storybook Creator panel crashed",
          description: React.createElement(
            "div",
            null,
            React.createElement("strong", null, error.message || String(error)),
            React.createElement(
              "pre",
              {
                style: {
                  marginTop: 8,
                  padding: 8,
                  background: "#fafafa",
                  fontSize: 11,
                  maxHeight: 240,
                  overflow: "auto",
                },
              },
              (error.stack || "") + "\n\n" + (info?.componentStack || ""),
            ),
            React.createElement(Button, {
              type: "primary",
              style: { marginTop: 8 },
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
      document.visibilityState !== "visible" &&
      "Notification" in window &&
      Notification.permission === "granted"
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
  sample_ref?: string;
}

type AnchorKind = "character" | "prop" | "scene_ref";

interface CostForecast {
  stage_0_usd: number;
  stage_2_usd: number;
  stage_3_usd: number;
  stage_4_usd: number;
  total_usd: number;
  breakdown: {
    characters: number;
    props?: number;
    scene_refs: number;
    scenes: number;
  };
}

// ── helpers ──────────────────────────────────────────────────────────

function refUrl(
  pid: string,
  name: string,
  version: string | number = "",
): string {
  // Cache-bust ONLY when the underlying file changes — pass the file's
  // `size` (from /status) as the version. Was previously `?t=Date.now()`
  // on every call, which made every render of every gallery re-fetch
  // every thumbnail; for 8+ scenes that saturated Chrome's 6-connection
  // -per-origin limit, causing /stage POSTs to stall waiting for a slot.
  // Stable version → browser caches the asset → connection pool stays
  // available for the real RPCs.
  const v =
    version === "" || version == null
      ? ""
      : `?v=${encodeURIComponent(String(version))}`;
  return getApiUrl(`/creator/projects/${pid}/refs/${name}${v}`);
}

function takeUrl(
  pid: string,
  name: string,
  version: string | number = "",
): string {
  const v =
    version === "" || version == null
      ? ""
      : `?v=${encodeURIComponent(String(version))}`;
  return getApiUrl(`/creator/projects/${pid}/takes/${name}${v}`);
}

function styleSampleUrl(styleId: string): string {
  return getApiUrl(`/creator/styles/${encodeURIComponent(styleId)}/sample`);
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

function useViewportWidth(): number {
  const [width, setWidth] = React.useState(() => window.innerWidth);
  React.useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

// ── main page ────────────────────────────────────────────────────────

function CreatorPage(): any {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [projects, setProjects] = React.useState<ProjectEntry[]>([]);
  const [selectedPid, setSelectedPid] = React.useState<string | null>(null);
  const [styles, setStyles] = React.useState<StyleEntry[]>([]);
  const [projectsCollapsed, setProjectsCollapsed] = React.useState(false);
  const [stageRows, setStageRows] = React.useState<any[] | null>(null);
  const viewportWidth = useViewportWidth();
  const effectiveProjectsCollapsed = projectsCollapsed || viewportWidth < 900;
  const pageRef = React.useRef<HTMLDivElement | null>(null);

  const [loadingProjects, setLoadingProjects] = React.useState(false);

  React.useEffect(() => {
    // Reserve the vertical scrollbar gutter on the embedded host chain too.
    // In QwenPaw the plugin may be mounted inside a nested scroll container,
    // so document-level gutter alone still lets centered content drift when
    // Classic is tall enough to add the scrollbar.
    const targets: HTMLElement[] = [];
    const addTarget = (el: HTMLElement | null | undefined) => {
      if (el && !targets.includes(el)) targets.push(el);
    };
    addTarget(document.documentElement);
    addTarget(document.body);
    let node = pageRef.current;
    while (node) {
      addTarget(node);
      if (node === document.body) break;
      node = node.parentElement;
    }

    const previous = targets.map((el) => ({
      el,
      gutter: el.style.getPropertyValue("scrollbar-gutter"),
    }));
    targets.forEach((el) =>
      el.style.setProperty("scrollbar-gutter", "stable both-edges"),
    );
    return () => {
      for (const { el, gutter } of previous) {
        if (gutter) {
          el.style.setProperty("scrollbar-gutter", gutter);
        } else {
          el.style.removeProperty("scrollbar-gutter");
        }
      }
    };
  }, []);

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
      const r = await apiGet<{ projects: ProjectEntry[] }>("/creator/projects");
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

  React.useEffect(() => {
    setProjectsCollapsed(Boolean(selectedPid));
  }, [selectedPid]);

  const selectProject = React.useCallback((pid: string) => {
    setSelectedPid(pid);
    setProjectsCollapsed(true);
  }, []);

  const createProject = React.useCallback(() => {
    setSelectedPid(null);
    setProjectsCollapsed(false);
    setStageRows(null);
  }, []);

  const updateStageRows = React.useCallback((rows: any[] | null) => {
    setStageRows(rows);
  }, []);

  return React.createElement(
    "div",
    {
      ref: pageRef,
      "data-testid": "creator-page-shell",
      style: { padding: 24, maxWidth: 1560, margin: "0 auto" },
    },
    React.createElement(HeaderBar, { status, onRefresh: reloadStatus }),
    React.createElement(
      "div",
      {
        style: {
          display: "grid",
          gridTemplateColumns: effectiveProjectsCollapsed
            ? "56px minmax(0, 1fr)"
            : "320px minmax(0, 1fr)",
          gap: effectiveProjectsCollapsed ? 16 : 24,
          alignItems: "start",
          marginTop: 16,
          transition: "grid-template-columns 160ms ease, gap 160ms ease",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            minWidth: 0,
            ...(effectiveProjectsCollapsed
              ? {
                  position: "sticky",
                  top: 12,
                  zIndex: 4,
                  alignSelf: "start",
                }
              : {}),
          },
        },
        React.createElement(ProjectSidebar, {
          projects,
          selectedPid,
          loading: loadingProjects,
          collapsed: effectiveProjectsCollapsed,
          stageRows: effectiveProjectsCollapsed ? stageRows : null,
          collapseLocked: viewportWidth < 900,
          onToggleCollapsed: () => setProjectsCollapsed((v) => !v),
          onSelect: selectProject,
          onCreate: createProject,
          onReload: reloadProjects,
          onRename: async (p: ProjectEntry) => {
            const next = window.prompt(
              `Rename "${p.id}" — pick a new id.\n` +
                "Chinese titles auto-romanize via pinyin " +
                "(e.g. 老人与海 → lao_ren_yu_hai).",
              p.id,
            );
            if (!next || next === p.id) return;
            try {
              const r = await apiJson(
                "POST",
                `/creator/projects/${p.id}/rename`,
                { new_id: next.trim() },
              );
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
        "div",
        { style: { minWidth: 0 } },
        selectedPid
          ? React.createElement(ProjectPane, {
              key: selectedPid,
              pid: selectedPid,
              styles,
              status,
              onStageRowsChange: updateStageRows,
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
      `${label} Key: ${ok ? "OK" : "missing"}`,
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
        React.createElement(
          "span",
          {
            style: {
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              letterSpacing: 0,
            },
          },
          React.createElement(
            "span",
            {
              style: {
                width: 32,
                height: 32,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#202124",
                flex: "0 0 auto",
              },
            },
            React.createElement(DirectorBoardIcon, {
              size: 32,
              strokeWidth: 1.9,
            }),
          ),
          "Storybook Creator",
        ),
      ),
      React.createElement(
        Paragraph,
        { type: "secondary", style: { margin: 0 } },
        "Story in, living picture book out. Shape the scenes, paint the frames, stitch the little film.",
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
  collapsed,
  stageRows,
  collapseLocked,
  onToggleCollapsed,
  onSelect,
  onCreate,
  onReload,
  onRename,
}: any) {
  const selectedProject = projects.find(
    (p: ProjectEntry) => p.id === selectedPid,
  );
  const selectedLabel = selectedProject
    ? selectedProject.title || selectedProject.id
    : "";
  const selectedLabelHasCjk =
    /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(
      selectedLabel,
    );
  const railLabel =
    selectedLabelHasCjk && selectedLabel.length > 9
      ? `${selectedLabel.slice(0, 8)}…`
      : selectedLabel;

  if (collapsed) {
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(
        Card,
        {
          size: "small",
          bodyStyle: {
            padding: 8,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          },
        },
        React.createElement(
          Tooltip,
          {
            title: collapseLocked
              ? "Widen the window to show projects"
              : "Show projects",
          },
          React.createElement(Button, {
            size: "small",
            type: "text",
            icon: React.createElement(UnfoldIcon),
            onClick: onToggleCollapsed,
            disabled: collapseLocked,
          }),
        ),
        React.createElement(
          Tooltip,
          { title: "New storybook" },
          React.createElement(Button, {
            size: "small",
            type: "primary",
            icon: React.createElement(PlusOutlined),
            onClick: onCreate,
          }),
        ),
        React.createElement(
          Tooltip,
          { title: "Refresh projects" },
          React.createElement(Button, {
            size: "small",
            type: "text",
            icon: React.createElement(ReloadOutlined),
            onClick: onReload,
            loading,
          }),
        ),
        selectedProject
          ? React.createElement(
              Tooltip,
              { title: selectedLabel },
              React.createElement(
                "div",
                {
                  style: {
                    writingMode: "vertical-rl",
                    textOrientation: selectedLabelHasCjk ? "upright" : "mixed",
                    maxHeight: 220,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "#8c8c8c",
                    fontSize: 12,
                    fontWeight: 600,
                    lineHeight: 1.25,
                    marginTop: 8,
                  },
                },
                railLabel,
              ),
            )
          : null,
      ),
      stageRows?.length
        ? React.createElement(
            "div",
            {
              style: {
                position: "sticky",
                top: 12,
                zIndex: 3,
              },
            },
            React.createElement(StageRail, { rows: stageRows, inline: true }),
          )
        : null,
    );
  }

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
        React.createElement(
          Tooltip,
          { title: "Collapse projects" },
          React.createElement(Button, {
            size: "small",
            icon: React.createElement(FoldIcon),
            onClick: onToggleCollapsed,
          }),
        ),
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
                    {
                      title:
                        "Rename project id (e.g. untitled_xxx → meaningful name)",
                    },
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
      antMessage.warning(
        "Source text seems too short — paste at least a paragraph",
      );
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
      style: { borderRadius: 8, overflow: "hidden" },
      headStyle: { background: "#fcfcfd", minHeight: 56 },
      title: React.createElement(
        Space,
        null,
        React.createElement(CloudUploadOutlined),
        "New storybook from source",
      ),
    },
    React.createElement(
      Steps,
      {
        current: 0,
        size: "small",
        style: {
          margin: "6px 0 22px",
          padding: "12px 16px",
          border: "1px solid #f0f0f0",
          borderRadius: 8,
          background: "#fcfcfd",
        },
      },
      React.createElement(Step, {
        title: "Source",
        icon: React.createElement(CloudUploadOutlined),
      }),
      React.createElement(Step, {
        title: "Storyboard",
        icon: React.createElement(ScissorOutlined),
      }),
      React.createElement(Step, {
        title: "Anchors",
        icon: React.createElement(PictureOutlined),
      }),
      React.createElement(Step, {
        title: "Frames",
        icon: React.createElement(PlayCircleOutlined),
      }),
    ),
    status && !status.has_dashscope
      ? React.createElement(Alert, {
          type: "warning",
          message:
            "DASHSCOPE_API_KEY missing — needed for Stage 00 decomposition (qwen-max). Set it under Environment Variables and refresh.",
          style: { marginBottom: 16 },
          showIcon: true,
        })
      : null,
    React.createElement(
      "div",
      { style: { display: "flex", gap: 12, marginBottom: 12 } },
      React.createElement(Button, {
        type: tab === "paste" ? "primary" : "default",
        onClick: () => setTab("paste"),
        children: "Paste text",
      }),
      React.createElement(Button, {
        type: tab === "upload" ? "primary" : "default",
        onClick: () => setTab("upload"),
        children: "Upload file (.txt/.md/.pdf/.docx)",
      }),
    ),
    React.createElement(
      Form,
      { layout: "vertical" },
      React.createElement(
        Form.Item,
        { label: "Title (optional)" },
        React.createElement(Input, {
          placeholder: "Old Man and the Sea",
          value: title,
          onChange: (e: any) => setTitle(e.target.value),
        }),
      ),
      React.createElement(
        Row,
        { gutter: 16 },
        React.createElement(
          Col,
          { span: 12 },
          React.createElement(
            Form.Item,
            { label: "Image model" },
            React.createElement(Select, {
              value: frameProvider,
              onChange: setFrameProvider,
              style: { width: "100%" },
              options: [
                {
                  value: "gpt-image-2-dashscope",
                  label: "gpt-image-2 (dashscope)",
                },
                { value: "gpt-image-2", label: "gpt-image-2 (openai)" },
                { value: "qwen-image", label: "qwen-image-2.0-pro" },
              ],
            }),
          ),
        ),
        React.createElement(
          Col,
          { span: 12 },
          React.createElement(
            Form.Item,
            { label: "Video model" },
            React.createElement(Select, {
              value: videoProvider,
              onChange: setVideoProvider,
              style: { width: "100%" },
              options: [
                { value: "wan27", label: "Wan 2.7" },
                { value: "happyhorse", label: "HappyHorse 2.0" },
                { value: "seedance", label: "Seedance 2.0" },
              ],
            }),
          ),
        ),
      ),
      tab === "paste"
        ? React.createElement(
            Form.Item,
            { label: "Story / script / prompt", required: true },
            React.createElement(TextArea, {
              rows: 14,
              value: text,
              onChange: (e: any) => setText(e.target.value),
              placeholder:
                "Paste the full story, script, or narrative prompt here. The LLM will identify characters, scenes, and recurring settings, then split it into 5-8 storyboard panels.",
            }),
          )
        : React.createElement(
            Form.Item,
            { label: "File", required: true },
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
              React.createElement(
                Button,
                { icon: React.createElement(CloudUploadOutlined) },
                "Pick file",
              ),
            ),
          ),
      React.createElement(
        Form.Item,
        null,
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
      "Saved locally. Generation starts when you run a stage.",
    ),
  );
}

// ── project pane: workflow per loaded project ────────────────────────

function ProjectPane({
  pid,
  styles,
  status,
  onStageRowsChange,
  onChange,
  onDeleted,
}: any) {
  const [project, setProject] = React.useState<any>(null);
  const [forecast, setForecast] = React.useState<CostForecast | null>(null);
  const [projStatus, setProjStatus] = React.useState<any>(null);
  // "The Reel" Studio view (new fluid UX) vs the classic stage accordion.
  // Studio is the default; the classic panel stays one click away.
  const [studioMode, setStudioMode] = React.useState(true);
  const [classicMounted, setClassicMounted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [activeStage, setActiveStage] = React.useState<string | null>(null);
  const [pendingSceneRun, setPendingSceneRun] = React.useState<{
    stage: string;
    sceneId?: string;
  } | null>(null);
  const [runError, setRunError] = React.useState<{
    title: string;
    message: string;
  } | null>(null);
  const [anchorEditor, setAnchorEditor] = React.useState<{
    open: boolean;
    mode: "add" | "update";
    kind: AnchorKind;
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
  // Live Pass-1 decompose stream — the producer's raw draft text as the
  // LLM generates it, pushed over SSE (decompose_start / _progress /
  // _done). Lets the user watch the beat sheet being written instead of
  // staring at a spinner. Cleared once the structured beats render.
  const [decomposeStream, setDecomposeStream] = React.useState("");
  const [decomposeStreaming, setDecomposeStreaming] = React.useState(false);

  // Decompose-step form
  const [duration, setDuration] = React.useState(60);
  const [styleHint, setStyleHint] = React.useState<string | undefined>(
    undefined,
  );
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
  // Optional explicit beat-count override (Pass 1 of decomposition).
  // Empty = auto-derive from duration_target_s in the backend prompt.
  const [targetScenes, setTargetScenes] = React.useState<number | undefined>(
    undefined,
  );

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
              state: "done",
              stage: ev.stage,
              elapsed_s: ev.elapsed_s,
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
        } else if (ev.kind === "stage_cancelled") {
          // The stage stopped early on a cancel request.
          setLiveProgress({});
          setBusy(false);
          setActiveStage(null);
          antMessage.info("Render stopped.");
          reload();
        } else if (ev.kind === "decompose_start") {
          setDecomposeStreaming(true);
          setDecomposeStream("");
        } else if (ev.kind === "decompose_progress") {
          // Each event carries the FULL accumulated draft text (the
          // backend coalesces deltas into drop-robust snapshots), so a
          // plain assignment always converges on the latest state.
          if (typeof ev.text === "string") setDecomposeStream(ev.text);
        } else if (
          ev.kind === "decompose_done" ||
          ev.kind === "decompose_failed"
        ) {
          setDecomposeStreaming(false);
        }
      } catch {
        /* ignore malformed event */
      }
    };
    es.onerror = () => {
      // Browser auto-reconnects on its own; nothing to do.
    };
    return () => {
      try {
        es?.close();
      } catch {
        /* ignore */
      }
    };
  }, [pid, reload]);

  const onDecompose = async () => {
    maybeRequestNotificationPermission();
    setBusy(true);
    setActiveStage("decompose");
    setRunError(null);
    setTabBadge(1, 0);
    // Show the live panel immediately — don't wait for the first SSE
    // event, which can race the EventSource (re)connect.
    setDecomposeStreaming(true);
    setDecomposeStream("");
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
        target_scenes: targetScenes,
      });
      setProject((p: any) => ({ ...(p ?? {}), draft: r.draft }));
      onChange?.();
      await reload();
      notify(
        "Decompose done",
        `Draft ready — ${
          r.draft?.scenes?.length || 0
        } scenes. Review before generating refs.`,
        { tag: "decompose", level: "success" },
      );
      setTabBadge(0, 1);
      return r.draft;
    } catch (e: any) {
      const msg = compactApiError(e);
      setRunError({ title: "Decompose failed", message: msg });
      notify("Decompose failed", msg.slice(0, 200), {
        tag: "decompose-err",
        level: "error",
      });
      setTabBadge(0, 0);
    } finally {
      setBusy(false);
      setActiveStage(null);
      setDecomposeStreaming(false);
    }
  };

  /**
   * Pass 2 of the two-pass decomposition. Reads beats from the
   * current draft (optionally with caller-supplied edits) and asks
   * the backend to craft full per-scene specifications.
   */
  const onCraft = async (editedBeats?: any[]) => {
    maybeRequestNotificationPermission();
    setBusy(true);
    setActiveStage("craft");
    setRunError(null);
    setTabBadge(1, 0);
    try {
      const r = await apiJson("POST", `/creator/projects/${pid}/craft`, {
        beats: editedBeats ?? undefined,
      });
      setProject((p: any) => ({ ...(p ?? {}), draft: r.draft }));
      onChange?.();
      await reload();
      notify(
        "Craft done",
        `Scenes generated — ${r.draft?.scenes?.length || 0} scenes ready.`,
        { tag: "craft", level: "success" },
      );
      setTabBadge(0, 1);
    } catch (e: any) {
      const msg = compactApiError(e);
      setRunError({ title: "Craft failed", message: msg });
      notify("Craft failed", msg.slice(0, 200), {
        tag: "craft-err",
        level: "error",
      });
      setTabBadge(0, 0);
    } finally {
      setBusy(false);
      setActiveStage(null);
    }
  };

  /**
   * "Make my film": auto-chain Pass 1 (decompose) → Pass 2 (craft) so the
   * user lands in the Reel with a full storyboard — no manual beat-gate /
   * "craft scenes" step. The paid render stages stay behind the Reel's
   * own controls (a later slice gates them with a budget confirm).
   */
  const onMakeFilm = async () => {
    const draft = await onDecompose();
    const hasBeats =
      !!draft && ((draft.beats || []).length || (draft.scenes || []).length);
    if (hasBeats && !(draft.scenes || []).length) {
      await onCraft();
    }
  };

  // Cooperative cancel flag for the parallel render. The backend clears its
  // own per-project flag at the start of every /stage POST, so for the
  // per-scene fan-out (one POST per scene) that flag can't stop the run on
  // its own. This client-side ref is the real brake: onCancel raises it,
  // the batch loop stops launching new shots, and renderFilm refuses to
  // start the (pricey) motion stage after a Stop.
  const cancelRef = React.useRef(false);

  /**
   * Stop a running render. Cooperative — the backend stage loops check
   * the flag between scenes and stop before starting more (paid) work;
   * an in-flight shot still finishes. The stage_cancelled SSE event then
   * clears the busy state.
   */
  const onCancel = async () => {
    // Raise the client brake first so any in-flight batch loop stops
    // launching new shots even if the network call lags.
    cancelRef.current = true;
    try {
      await apiJson("POST", `/creator/projects/${pid}/cancel`, {});
      antMessage.info("Stopping after the current shots…");
    } catch (e: any) {
      antMessage.error(`Stop failed: ${compactApiError(e)}`);
    }
  };

  /**
   * Director: apply one natural-language instruction to the scene specs.
   * Spec-only — updates the draft, then the user re-rolls affected
   * scenes (the inline Re-roll) to render the change. Throws on error so
   * the DirectorChat panel can surface it inline; returns the summary +
   * per-scene changelog for the transcript on success.
   */
  const onDirector = async (message: string) => {
    const r = await apiJson("POST", `/creator/projects/${pid}/director`, {
      message,
    });
    setProject((p: any) => ({ ...(p ?? {}), draft: r.draft }));
    onChange?.();
    await reload();
    return {
      summary: (r.summary as string) || "",
      changes: (r.changes || []) as any[],
    };
  };

  /**
   * Auto-fix loop: validate → regen failing scenes with VLM failure
   * reasons appended to regen_notes → revalidate. Caps at maxIters.
   * Each Stage 2 regen is paid ($0.20-0.30 on gpt-image-2 / ~$0.04
   * on qwen-image / DashScope), so the UI confirms cost first.
   */
  const onAutofix = async (maxIters: number = 2) => {
    maybeRequestNotificationPermission();
    setBusy(true);
    setActiveStage("autofix");
    setRunError(null);
    setTabBadge(1, 0);
    try {
      const r = await apiJson("POST", `/creator/projects/${pid}/autofix`, {
        max_iters: maxIters,
      });
      const last = (r.iterations || []).slice(-1)[0] || {};
      const checked = last.scenes_checked || 0;
      const passed = last.scenes_passed || 0;
      const failed = last.scenes_failed || 0;
      await reload();
      notify(
        "Auto-fix done",
        `After ${(r.iterations || []).length} iter(s): ` +
          `${passed}/${checked} scenes pass` +
          (failed > 0 ? ` (${failed} still failing)` : ""),
        {
          tag: "autofix",
          level: failed > 0 ? "warning" : "success",
        },
      );
      setTabBadge(0, 1);
    } catch (e: any) {
      const msg = compactApiError(e);
      setRunError({ title: "Auto-fix failed", message: msg });
      notify("Auto-fix failed", msg.slice(0, 200), {
        tag: "autofix-err",
        level: "error",
      });
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
    sceneIds: string[] | null = null,
  ) => {
    const allIds = (draft.scenes || []).map((s: any) => s.id);
    // Optional subset (e.g. just the scenes a Director edit touched) so
    // multi-scene re-rolls share ONE coordinated busy/Stop lifecycle
    // instead of firing uncoordinated per-scene runs.
    const scenes =
      sceneIds && sceneIds.length
        ? allIds.filter((id: string) => sceneIds.includes(id))
        : allIds;
    if (!scenes.length) return { done: 0, failed: 0, cancelled: false };
    const gc = draft.global_config || {};
    const conc = Math.max(1, Math.min(5, Number(gc.concurrency) || 5));
    maybeRequestNotificationPermission();
    cancelRef.current = false;
    setBusy(true);
    setActiveStage(stage);
    setRunError(null);
    setTabBadge(scenes.length, 0);
    let done = 0,
      failed = 0;
    const failureMessages: string[] = [];
    try {
      for (let i = 0; i < scenes.length; i += conc) {
        // Stop launching new shots once the user hits Stop; the batch
        // already in flight finishes, nothing past it starts.
        if (cancelRef.current) break;
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
        results.forEach((r: any, idx: number) => {
          if (r.status === "fulfilled") {
            done++;
          } else {
            failed++;
            failureMessages.push(
              `Scene ${batch[idx]}: ${compactApiError(r.reason)}`,
            );
          }
        });
        await reload();
      }
      if (failed > 0) {
        const unique = Array.from(new Set(failureMessages)).slice(0, 8);
        setRunError({
          title: `Stage ${stage} completed with ${failed} failure${
            failed === 1 ? "" : "s"
          }`,
          message: unique.join("\n\n"),
        });
      }
      notify(
        cancelRef.current ? `Stage ${stage} stopped` : `Stage ${stage} done`,
        cancelRef.current
          ? `${done} shot${done === 1 ? "" : "s"} finished before you stopped.`
          : `${done} succeeded, ${failed} failed.`,
        {
          tag: `stage-${stage}`,
          level: failed > 0 ? "warning" : "success",
        },
      );
      setTabBadge(0, done);
    } catch (e: any) {
      const msg = compactApiError(e);
      setRunError({ title: `Stage ${stage} crashed`, message: msg });
      notify(`Stage ${stage} crashed`, msg.slice(0, 200), {
        tag: `stage-${stage}-err`,
        level: "error",
      });
      setTabBadge(0, 0);
    } finally {
      setBusy(false);
      setActiveStage(null);
    }
    return { done, failed, cancelled: cancelRef.current };
  };

  const onRunStage = async (stage: string, extra: any = {}) => {
    maybeRequestNotificationPermission();
    setBusy(true);
    setActiveStage(stage);
    setRunError(null);
    setPendingSceneRun(
      extra?.only_scene ? { stage, sceneId: String(extra.only_scene) } : null,
    );
    setTabBadge(1, 0);
    const stageLabel: Record<string, string> = {
      "0": "Stage 0 — anchor refs",
      "0a": "Stage 0a — character refs",
      "0b": "Stage 0b — scene refs",
      "0c": "Stage 0c — style ref",
      "1": "Stage 1 — narration",
      "2": "Stage 2 — frame compose",
      "2.5": "Stage 2.5 — validate frames",
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
      notify(`${label} done${sceneHint}`, "Click to review and continue.", {
        tag: `stage-${stage}`,
        level: "success",
      });
      setTabBadge(0, 1);
    } catch (e: any) {
      const msg = compactApiError(e);
      setRunError({ title: `${label} failed`, message: msg });
      // In-app toast too — the error Alert renders at the panel top, which
      // is off-screen when the user is down in the Reel strip clicking
      // "Shoot". Without this a failed run looks like "nothing happened".
      antMessage.error(`${label} failed: ${msg.slice(0, 160)}`);
      notify(`${label} failed`, msg.slice(0, 200), {
        tag: `stage-${stage}-err`,
        level: "error",
      });
      setTabBadge(0, 0);
    } finally {
      setBusy(false);
      setActiveStage(null);
      setPendingSceneRun(null);
    }
  };

  const onSaveDraft = async (
    newDraft: any,
    opts: { quiet?: boolean; reload?: boolean } = {},
  ) => {
    try {
      await apiJson("PUT", `/creator/projects/${pid}`, { draft: newDraft });
      if (!opts.quiet) antMessage.success("Saved.");
      if (opts.reload !== false) await reload();
    } catch (e: any) {
      antMessage.error(`Save failed: ${e.message ?? e}`);
      throw e;
    }
  };

  const onPatchAnchor = async (
    op: "add" | "update" | "delete",
    kind: AnchorKind,
    id: string,
    description?: string,
  ) => {
    try {
      const r = await apiJson("PATCH", `/creator/projects/${pid}/anchors`, {
        op,
        kind,
        id,
        description,
      });
      antMessage.success(
        op === "delete"
          ? `Removed ${kind} ${id}`
          : op === "add"
          ? `Added ${kind} ${id}`
          : `Updated ${kind} ${id}`,
      );
      setProject((p: any) => ({ ...(p ?? {}), draft: r.draft }));
      onChange?.();
      await reload();
    } catch (e: any) {
      antMessage.error(`${op} failed: ${e.message ?? e}`);
    }
  };

  const onDeleteAnchor = (kind: AnchorKind, id: string) => {
    Modal.confirm({
      title: `Delete ${kind} "${id}"?`,
      content: `Removes it from the draft and strips references from every scene that used it. If a ref image was already generated, the PNG stays on disk.`,
      okType: "danger",
      onOk: () => onPatchAnchor("delete", kind, id),
    });
  };

  const onPatchScene = async (
    sceneId: string,
    patch: any,
    opts: { quiet?: boolean; reload?: boolean; updateProject?: boolean } = {},
  ) => {
    const applyPatch = async (payload: any) =>
      apiJson("PATCH", `/creator/projects/${pid}/scenes/${sceneId}`, payload);
    try {
      let r: any;
      try {
        r = await applyPatch(patch);
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        const extraForbidden = msg.includes("extra_forbidden");
        const legacyPatch = { ...patch };
        let removedLegacyField = false;
        if (
          extraForbidden &&
          Object.prototype.hasOwnProperty.call(
            legacyPatch,
            "video_regen_notes",
          ) &&
          msg.includes("video_regen_notes")
        ) {
          delete legacyPatch.video_regen_notes;
          removedLegacyField = true;
        }
        if (
          extraForbidden &&
          Object.prototype.hasOwnProperty.call(legacyPatch, "uses_props") &&
          msg.includes("uses_props")
        ) {
          delete legacyPatch.uses_props;
          removedLegacyField = true;
        }
        if (!removedLegacyField) throw e;
        r = await applyPatch(legacyPatch);
        if (!opts.quiet) {
          antMessage.warning(
            "Scene saved. Restart QwenPaw to enable the newest scene fields.",
          );
        }
      }
      if (!opts.quiet) antMessage.success(`Saved scene ${sceneId}`);
      if (opts.updateProject !== false) {
        setProject((p: any) => ({ ...(p ?? {}), draft: r.draft }));
        onChange?.();
      }
      if (opts.reload !== false) await reload();
    } catch (e: any) {
      antMessage.error(`Save failed: ${e.message ?? e}`);
      throw e;
    }
  };

  const onSelectTake = async (
    stage: "2" | "3",
    sceneId: string,
    takeId: string,
  ) => {
    try {
      await apiJson("POST", `/creator/projects/${pid}/takes/select`, {
        stage,
        scene_id: sceneId,
        take_id: takeId,
      });
      antMessage.success(`Restored take ${takeId}`);
      await reload();
    } catch (e: any) {
      antMessage.error(`Restore failed: ${e.message ?? e}`);
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

  const sidebarDraft = project?.draft ?? {};
  const sidebarStageRows = React.useMemo(
    () => buildStageRows(sidebarDraft, projStatus, activeStage),
    [sidebarDraft, projStatus, activeStage],
  );
  React.useEffect(() => {
    const hasScenes = (sidebarDraft?.scenes ?? []).length > 0;
    // Keep the collapsed sidebar chrome stable while switching Studio/Classic.
    onStageRowsChange?.(hasScenes ? sidebarStageRows : null);
  }, [sidebarDraft, sidebarStageRows, onStageRowsChange]);
  React.useEffect(() => () => onStageRowsChange?.(null), [onStageRowsChange]);

  if (!project) {
    return React.createElement(Card, null, React.createElement(Spin));
  }

  const draft = project.draft ?? {};
  // Two-pass decompose: a project can have beats (Pass 1 done) before
  // it has scenes (Pass 2 craft). Either is enough to leave the
  // initial Decompose form behind and show the next stage
  // (BeatSheetView if only beats, DraftPanel if scenes are crafted).
  const hasDraft = Boolean(draft?.beats?.length || draft?.scenes?.length);

  // Current step computation
  let currentStep = 1; // source done
  if (hasDraft) currentStep = 2;
  if (
    projStatus?.stages?.["0"]?.refs?.length &&
    projStatus.stages["0"].refs.length >=
      (draft.assets?.characters?.length ?? 0) +
        (draft.assets?.props?.length ?? 0) +
        (draft.assets?.scene_refs?.length ?? 0)
  ) {
    currentStep = 3;
  }
  if (projStatus?.stages?.["2"]?.frames?.length) currentStep = 4;

  const modeToggleButton = (
    active: boolean,
    label: string,
    Icon: any,
    onClick: () => void,
  ) =>
    React.createElement(
      "button",
      {
        type: "button",
        role: "tab",
        "aria-label": label,
        "aria-pressed": active,
        "aria-selected": active,
        onClick,
        style: {
          appearance: "none",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          border: `1px solid ${active ? "#ff7a00" : "transparent"}`,
          borderRadius: 7,
          background: active ? "#ff7a00" : "transparent",
          color: active ? "#1f2328" : "#2b2f36",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: active ? 700 : 600,
          height: 32,
          letterSpacing: 0,
          lineHeight: 1,
          padding: "0 13px",
          whiteSpace: "nowrap",
        },
      },
      React.createElement(Icon, {
        "aria-hidden": true,
        style: {
          fontSize: 14,
          lineHeight: 1,
        },
      }),
      label,
    );
  const openClassicMode = () => {
    setClassicMounted(true);
    setStudioMode(false);
  };
  const openStudioMode = () => setStudioMode(true);

  return React.createElement(
    Card,
    {
      style: { borderRadius: 8, overflow: "hidden" },
      headStyle: { background: "#fcfcfd", minHeight: 56 },
      title: React.createElement(
        Space,
        null,
        React.createElement(
          AntText,
          { strong: true },
          project?.meta?.title ?? pid,
        ),
        React.createElement(
          Tooltip,
          { title: "Project folder id" },
          React.createElement(Tag, { color: "blue" }, `folder: ${pid}`),
        ),
      ),
      extra: React.createElement(
        Space,
        null,
        React.createElement(Button, {
          danger: true,
          size: "small",
          icon: React.createElement(DeleteOutlined),
          onClick: onDelete,
          children: "Delete",
        }),
      ),
    },
    !hasDraft
      ? React.createElement(
          Steps,
          {
            current: currentStep,
            size: "small",
            style: {
              margin: "6px 0 22px",
              padding: "12px 16px",
              border: "1px solid #f0f0f0",
              borderRadius: 8,
              background: "#fcfcfd",
            },
          },
          React.createElement(Step, {
            title: "Source",
            icon: React.createElement(CloudUploadOutlined),
          }),
          React.createElement(Step, {
            title: "Storyboard",
            icon: React.createElement(ScissorOutlined),
          }),
          React.createElement(Step, {
            title: "Anchors",
            icon: React.createElement(PictureOutlined),
          }),
          React.createElement(Step, {
            title: "Frames",
            icon: React.createElement(PlayCircleOutlined),
          }),
        )
      : null,

    runError
      ? React.createElement(Alert, {
          type: "error",
          showIcon: true,
          closable: true,
          onClose: () => setRunError(null),
          message: runError.title,
          description: React.createElement(
            "pre",
            {
              style: {
                margin: 0,
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                lineHeight: 1.45,
              },
            },
            runError.message,
          ),
          style: { margin: "0 0 16px" },
        })
      : null,

    // Live Pass-1 stream — watch the producer draft the beat sheet.
    React.createElement(LiveDecomposePanel, {
      show: decomposeStreaming || (busy && activeStage === "decompose"),
      text: decomposeStream,
      streaming: decomposeStreaming,
    }),

    // Step 1: Decompose form (only if no draft yet)
    !hasDraft
      ? React.createElement(DecomposeForm, {
          duration,
          setDuration,
          styleHint,
          setStyleHint,
          audience,
          setAudience,
          voice,
          setVoice,
          era,
          setEra,
          country,
          setCountry,
          genre,
          setGenre,
          tone,
          setTone,
          storyAnchor,
          setStoryAnchor,
          styleDirectives,
          setStyleDirectives,
          worldBible,
          setWorldBible,
          frameProvider,
          setFrameProvider,
          videoProvider,
          setVideoProvider,
          targetScenes,
          setTargetScenes,
          styles,
          busy,
          activeStage,
          status,
          onSubmit: onDecompose,
          onMakeFilm,
        })
      : null,

    // Step 1.5: Beat sheet review (Pass 1 done, Pass 2 not yet run).
    // Crafted projects skip this branch because draft.scenes is populated.
    hasDraft &&
      (draft.beats || []).length > 0 &&
      (draft.scenes || []).length === 0
      ? React.createElement(BeatSheetView, {
          draft,
          busy,
          activeStage,
          onCraft,
        })
      : null,

    // Step 2+: Draft viewer + ref/frame galleries
    hasDraft && (draft.scenes || []).length > 0
      ? React.createElement(
          "div",
          {
            "data-testid": "creator-mode-shell",
            style: {
              width: "100%",
              maxWidth: 1360,
              margin: "0 auto",
            },
          },
          React.createElement(
            "div",
            {
              role: "tablist",
              "aria-label": "Project view",
              style: {
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                marginBottom: 14,
                padding: 4,
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                background: "#fff",
                boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04)",
              },
            },
            modeToggleButton(
              studioMode,
              "Studio",
              StudioModeIcon,
              openStudioMode,
            ),
            modeToggleButton(
              !studioMode,
              "Classic",
              ClassicModeIcon,
              openClassicMode,
            ),
          ),
          React.createElement(
            "div",
            {
              "data-testid": "studio-view",
              hidden: !studioMode,
              style: { display: studioMode ? "block" : "none" },
            },
            React.createElement(ReelView, {
              key: `reel-${pid}`,
              pid,
              draft,
              projStatus,
              liveProgress,
              forecast,
              busy,
              activeStage,
              pendingSceneRun,
              onRunStage,
              onRunOne: (sid: string) =>
                onRunStage("2", { only_scene: sid, overwrite: true }),
              onRunStageAllParallel,
              onRerollScenes: (ids: string[]) =>
                onRunStageAllParallel("2", true, ids),
              // A Director edit re-shoots the frame AND re-animates the
              // motion so the playing clip stays in sync — one coordinated
              // run, and Stop still halts before Stage 3.
              onRerollScenesFull: async (ids: string[]) => {
                const r2 = await onRunStageAllParallel("2", true, ids);
                if (!r2?.cancelled) {
                  await onRunStageAllParallel("3", true, ids);
                }
              },
              onDirector,
              onSaveDraft,
              onCancel,
              onSwitchClassic: openClassicMode,
            }),
          ),
          classicMounted
            ? React.createElement(
                "div",
                {
                  "data-testid": "classic-view",
                  hidden: studioMode,
                  style: { display: studioMode ? "none" : "block" },
                },
                React.createElement(DraftPanel, {
                  key: `draft-${pid}`,
                  pid,
                  draft,
                  styles,
                  projStatus,
                  busy,
                  activeStage,
                  pendingSceneRun,
                  forecast,
                  status,
                  onRunStage,
                  onRunStageAllParallel,
                  onAutofix,
                  onDirector,
                  onSaveDraft,
                  onPatchScene,
                  onSelectTake,
                  onReload: reload,
                  onAddAnchor: (kind: AnchorKind) =>
                    setAnchorEditor({
                      open: true,
                      mode: "add",
                      kind,
                      id: "",
                      description: "",
                    }),
                  onEditAnchor: (kind: AnchorKind, a: any) =>
                    setAnchorEditor({
                      open: true,
                      mode: "update",
                      kind,
                      id: a.id,
                      description: a.description || "",
                    }),
                  onDeleteAnchor,
                  onEditScene: (sceneId: string) => {
                    const sc = (draft.scenes || []).find(
                      (s: any) => s.id === sceneId,
                    );
                    if (sc) setSceneEditor(sc);
                  },
                  liveProgress,
                }),
              )
            : null,
        )
      : null,

    // Anchor add/edit modal
    anchorEditor?.open
      ? React.createElement(AnchorEditModal, {
          editor: anchorEditor,
          onCancel: () => setAnchorEditor(null),
          onSubmit: async (id: string, description: string) => {
            await onPatchAnchor(
              anchorEditor.mode,
              anchorEditor.kind,
              id,
              description,
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
          onAutoSave: (patch: any) =>
            onPatchScene(sceneEditor.id, patch, {
              quiet: true,
              reload: false,
            }),
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

function SceneEditModal({ scene, draft, onCancel, onSubmit, onAutoSave }: any) {
  const [name, setName] = React.useState(scene.name ?? "");
  const [duration, setDuration] = React.useState(scene.duration ?? 10);
  const [hasNarration, setHasNarration] = React.useState(!!scene.has_narration);
  const [standalone, setStandalone] = React.useState(!!scene.standalone);
  const [usesStyle, setUsesStyle] = React.useState(
    scene.uses_style === undefined ? true : !!scene.uses_style,
  );
  const [usesCharacters, setUsesCharacters] = React.useState<string[]>(
    Array.isArray(scene.uses_characters) ? scene.uses_characters : [],
  );
  const [usesProps, setUsesProps] = React.useState<string[]>(
    Array.isArray(scene.uses_props) ? scene.uses_props : [],
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
  const [nCandidates, setNCandidates] = React.useState(scene.n_candidates ?? 1);
  const [regenNotes, setRegenNotes] = React.useState(scene.regen_notes ?? "");
  const [videoRegenNotes, setVideoRegenNotes] = React.useState(
    scene.video_regen_notes ?? "",
  );
  const [videoProvider, setVideoProvider] = React.useState(
    scene.video_provider ?? "wan27",
  );
  const [frameProvider, setFrameProvider] = React.useState(
    scene.frame_provider ?? "gpt-image-2",
  );
  const [submitting, setSubmitting] = React.useState(false);

  const charOptions = (draft.assets?.characters ?? []).map((c: any) => ({
    value: c.id,
    label: c.id,
  }));
  const propOptions = (draft.assets?.props ?? []).map((p: any) => ({
    value: p.id,
    label: p.id,
  }));
  const refOptions = (draft.assets?.scene_refs ?? []).map((r: any) => ({
    value: r.id,
    label: r.id,
  }));
  const itemStyle = { marginBottom: 14 };
  const compactItemStyle = { marginBottom: 10 };
  const switchItemStyle = { marginBottom: 4 };
  const [autoSaving, setAutoSaving] = React.useState(false);
  const lastSavedSignatureRef = React.useRef("");

  const currentPatch = React.useCallback(() => {
    const patch: any = {
      name: name.trim() || undefined,
      duration,
      has_narration: hasNarration,
      standalone,
      uses_style: usesStyle,
      uses_characters: usesCharacters,
      uses_props: usesProps,
      uses_scene_ref: usesSceneRef || null,
      scene_description: sceneDescription.trim(),
      motion_prompt: motionPrompt.trim(),
      narration: hasNarration ? narration.trim() : "",
      n_candidates: nCandidates,
      regen_notes: regenNotes.trim(),
      video_provider: videoProvider,
      frame_provider: frameProvider,
    };
    if (videoRegenNotes.trim() || scene.video_regen_notes) {
      patch.video_regen_notes = videoRegenNotes.trim();
    }
    return patch;
  }, [
    name,
    duration,
    hasNarration,
    standalone,
    usesStyle,
    usesCharacters,
    usesProps,
    usesSceneRef,
    sceneDescription,
    motionPrompt,
    narration,
    nCandidates,
    regenNotes,
    videoRegenNotes,
    videoProvider,
    frameProvider,
    scene.video_regen_notes,
  ]);

  React.useEffect(() => {
    lastSavedSignatureRef.current = JSON.stringify(currentPatch());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id]);

  React.useEffect(() => {
    const patch = currentPatch();
    if (!patch.scene_description.trim()) return;
    if (hasNarration && !String(patch.narration || "").trim()) return;
    const signature = JSON.stringify(patch);
    if (signature === lastSavedSignatureRef.current) return;
    const timer = window.setTimeout(async () => {
      setAutoSaving(true);
      try {
        await onAutoSave?.(patch);
        lastSavedSignatureRef.current = signature;
      } catch {
        // onAutoSave surfaces the error toast.
      } finally {
        setAutoSaving(false);
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [currentPatch, hasNarration, onAutoSave]);

  return React.createElement(
    Modal,
    {
      open: true,
      title: `Edit scene ${scene.id} — ${scene.name}`,
      okText: "Done",
      confirmLoading: submitting || autoSaving,
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
          const patch = currentPatch();
          await onAutoSave?.(patch);
          lastSavedSignatureRef.current = JSON.stringify(patch);
          onCancel?.();
        } finally {
          setSubmitting(false);
        }
      },
      width: 880,
      style: { top: 32 },
      bodyStyle: {
        maxHeight: "calc(100vh - 180px)",
        overflowX: "hidden",
        overflowY: "auto",
        paddingTop: 8,
      },
    },
    React.createElement(
      Form,
      {
        layout: "vertical",
        size: "middle",
        style: { overflowX: "hidden" },
      },
      React.createElement(
        Row,
        { gutter: [16, 4] },
        React.createElement(
          Col,
          { span: 14 },
          React.createElement(
            Form.Item,
            { label: "Name", style: itemStyle },
            React.createElement(Input, {
              value: name,
              onChange: (e: any) => setName(e.target.value),
              placeholder: "solitary_sailor",
            }),
          ),
        ),
        React.createElement(
          Col,
          { span: 5 },
          React.createElement(
            Form.Item,
            { label: "Duration", style: itemStyle },
            React.createElement(InputNumber, {
              addonAfter: "s",
              min: 2,
              max: 60,
              value: duration,
              onChange: (v: any) => setDuration(v ?? 10),
              style: { width: "100%" },
            }),
          ),
        ),
        React.createElement(
          Col,
          { span: 5 },
          React.createElement(
            Form.Item,
            { label: "Takes", style: itemStyle },
            React.createElement(InputNumber, {
              min: 1,
              max: 4,
              value: nCandidates,
              onChange: (v: any) => setNCandidates(v ?? 1),
              style: { width: "100%" },
            }),
          ),
        ),
      ),

      React.createElement(
        Row,
        { gutter: [16, 0], style: { marginBottom: 12 } },
        React.createElement(
          Col,
          { span: 8 },
          React.createElement(
            Form.Item,
            {
              label: "Title card",
              extra: "Standalone shot; skips Stage 0/2 conditioning.",
              style: switchItemStyle,
            },
            React.createElement(antd.Switch, {
              size: "small",
              checked: standalone,
              onChange: setStandalone,
            }),
          ),
        ),
        React.createElement(
          Col,
          { span: 8 },
          React.createElement(
            Form.Item,
            { label: "Narration", style: switchItemStyle },
            React.createElement(antd.Switch, {
              size: "small",
              checked: hasNarration,
              onChange: setHasNarration,
            }),
          ),
        ),
        React.createElement(
          Col,
          { span: 8 },
          React.createElement(
            Form.Item,
            { label: "Style anchor", style: switchItemStyle },
            React.createElement(antd.Switch, {
              size: "small",
              checked: usesStyle,
              onChange: setUsesStyle,
            }),
          ),
        ),
      ),

      React.createElement(
        Row,
        { gutter: [16, 4] },
        React.createElement(
          Col,
          { span: 8 },
          React.createElement(
            Form.Item,
            {
              label: `Characters (${charOptions.length} available)`,
              style: itemStyle,
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
        React.createElement(
          Col,
          { span: 8 },
          React.createElement(
            Form.Item,
            {
              label: `Props (${propOptions.length} available)`,
              style: itemStyle,
            },
            React.createElement(Select, {
              mode: "multiple",
              value: usesProps,
              onChange: setUsesProps,
              options: propOptions,
              placeholder: propOptions.length
                ? "Pick key props in this scene"
                : "No props in draft — add some under Anchors",
              style: { width: "100%" },
              allowClear: true,
            }),
          ),
        ),
        React.createElement(
          Col,
          { span: 8 },
          React.createElement(
            Form.Item,
            {
              label: `Setting (1 of ${refOptions.length})`,
              style: itemStyle,
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

      React.createElement(
        Form.Item,
        {
          label: "Scene description",
          extra: "Visual scaffold for Stage 2 frame composition.",
          required: true,
          style: itemStyle,
        },
        React.createElement(TextArea, {
          rows: 4,
          value: sceneDescription,
          onChange: (e: any) => setSceneDescription(e.target.value),
        }),
      ),
      React.createElement(
        Form.Item,
        {
          label: "Motion prompt",
          extra: "Action and camera direction for the Stage 3 video model.",
          style: itemStyle,
        },
        React.createElement(TextArea, {
          rows: 3,
          value: motionPrompt,
          onChange: (e: any) => setMotionPrompt(e.target.value),
        }),
      ),
      hasNarration
        ? React.createElement(
            Form.Item,
            {
              label: "Narration text",
              extra: `≤ ${
                (duration - 1) * 18
              } chars (roughly — CosyVoice longshu_v2 at 1.0x). Stage 1 will warn if it overruns.`,
              style: itemStyle,
            },
            React.createElement(TextArea, {
              rows: 3,
              value: narration,
              onChange: (e: any) => setNarration(e.target.value),
            }),
          )
        : null,
      React.createElement(
        Form.Item,
        {
          label: "Frame regeneration notes",
          extra:
            "Optional correction applied on the next Stage 2 frame regeneration.",
          style: itemStyle,
        },
        React.createElement(TextArea, {
          rows: 2,
          value: regenNotes,
          onChange: (e: any) => setRegenNotes(e.target.value),
          placeholder:
            "marlin should be about the same length as the skiff, not larger",
        }),
      ),
      React.createElement(
        Form.Item,
        {
          label: "Video regeneration notes",
          extra:
            "Optional correction applied on the next Stage 3 video regeneration.",
          style: itemStyle,
        },
        React.createElement(TextArea, {
          rows: 2,
          value: videoRegenNotes,
          onChange: (e: any) => setVideoRegenNotes(e.target.value),
          placeholder:
            "slower camera push, less flapping, keep the subject centered",
        }),
      ),
      React.createElement(
        Row,
        { gutter: [16, 0] },
        React.createElement(
          Col,
          { span: 12 },
          React.createElement(
            Form.Item,
            {
              label: "Image model",
              style: compactItemStyle,
            },
            React.createElement(Select, {
              value: frameProvider,
              onChange: setFrameProvider,
              style: { width: "100%" },
              options: [
                {
                  value: "gpt-image-2-dashscope",
                  label: "gpt-image-2 (dashscope)",
                },
                { value: "gpt-image-2", label: "gpt-image-2 (openai)" },
                { value: "qwen-image", label: "qwen-image-2.0-pro" },
              ],
            }),
          ),
        ),
        React.createElement(
          Col,
          { span: 12 },
          React.createElement(
            Form.Item,
            {
              label: "Video model",
              style: compactItemStyle,
            },
            React.createElement(Select, {
              value: videoProvider,
              onChange: setVideoProvider,
              style: { width: "100%" },
              options: [
                { value: "wan27", label: "Wan 2.7" },
                { value: "happyhorse", label: "HappyHorse 2.0" },
                { value: "seedance", label: "Seedance 2.0" },
              ],
            }),
          ),
        ),
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
  const kindLabel =
    editor.kind === "character"
      ? "character"
      : editor.kind === "prop"
      ? "prop"
      : "setting";
  return React.createElement(
    Modal,
    {
      open: true,
      title: `${isEdit ? "Edit" : "Add"} ${kindLabel}`,
      okText: isEdit ? "Done" : "Add",
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
    React.createElement(
      Form,
      { layout: "vertical" },
      React.createElement(
        Form.Item,
        {
          label: "ID",
          extra:
            editor.kind === "character"
              ? `short snake_case, e.g. "marlin", "old_man"`
              : editor.kind === "prop"
              ? `short snake_case, e.g. "brass_scale", "red_book"`
              : `short snake_case, e.g. "high_sea", "dock"`,
        },
        React.createElement(Input, {
          value: id,
          disabled: isEdit,
          onChange: (e: any) => setId(e.target.value),
          placeholder:
            editor.kind === "character"
              ? "marlin"
              : editor.kind === "prop"
              ? "brass_scale"
              : "high_sea",
        }),
      ),
      React.createElement(
        Form.Item,
        {
          label: "Description",
          extra:
            editor.kind === "character"
              ? "Verbatim physical description. Include every load-bearing detail; Stage 0 renders a multi-angle reference sheet."
              : editor.kind === "prop"
              ? "Portable key object / 道具. Include material, color, scale, markings, wear, and distinctive details."
              : "Environmental setting only — no characters, no key props beyond the setting.",
        },
        React.createElement(TextArea, {
          rows: 8,
          value: description,
          onChange: (e: any) => setDescription(e.target.value),
          placeholder:
            editor.kind === "character"
              ? "A great Atlantic marlin fish, roughly 4 metres long, iridescent blue-purple along its upper body shading to silver belly, a long pointed spear-like bill, a tall sail-like dorsal fin running along its back, a sharp crescent-shaped tail fin. Reference sheet on empty pale background, soft watercolor natural-history study, not a scene."
              : editor.kind === "prop"
              ? "An old brass balance scale with two shallow round pans hanging from dark cords, a scratched central beam, tarnished gold metal, tiny dents along the pan rims, compact enough for a small bird to use. Multi-angle prop reference sheet, not a scene."
              : "A small Cuban fishing village dock at sunset, weathered wooden planks of the pier, shoreline with low scrubby vegetation, distant village lights starting to glow, warm amber-rose sky. Wide cinematic landscape view, soft watercolor landscape painting, no characters, no key props.",
        }),
      ),
    ),
  );
}

// ── collapsible stage wrapper + right-rail ──────────────────────────

/**
 * One-line collapsible card for each pipeline stage.
 * - Header always shows the status summary.
 * - Body hidden when collapsed; full gallery when expanded.
 * - Has an `id` so the right-rail can scroll to it.
 */
function StageSection({
  id,
  stageLabel,
  summary,
  extra,
  open,
  onToggle,
  children,
}: any) {
  // Open/closed is controlled by the parent (DraftPanel) so multiple
  // sections behave like an accordion — only one open at a time.
  return React.createElement(
    Card,
    {
      id,
      size: "small",
      style: {
        marginTop: 14,
        borderRadius: 8,
        overflow: "hidden",
        borderColor: open ? "#eadfd4" : "#ececec",
        boxShadow: open ? "0 1px 4px rgba(20, 20, 20, 0.04)" : "none",
      },
      headStyle: {
        minHeight: 50,
        padding: "0 16px",
        background: open ? "#fffaf5" : "#fcfcfd",
        borderBottom: open ? "1px solid #f0e8dd" : 0,
      },
      title: React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            minWidth: 0,
          },
          onClick: () => onToggle?.(id),
        },
        React.createElement(
          "span",
          {
            style: {
              width: 18,
              height: 18,
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: open ? "#d46b08" : "#8c8c8c",
              background: open ? "#fff1e6" : "#f3f3f3",
              fontSize: 11,
              lineHeight: "18px",
              flex: "0 0 auto",
            },
          },
          open ? "▼" : "▶",
        ),
        React.createElement(
          AntText,
          { strong: true, style: { whiteSpace: "nowrap" } },
          stageLabel,
        ),
        React.createElement(
          AntText,
          {
            type: "secondary",
            style: {
              fontSize: 12,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            },
          },
          `· ${summary}`,
        ),
      ),
      extra: extra,
      bodyStyle: open ? { padding: 16 } : { display: "none", padding: 0 },
    },
    children,
  );
}

function buildStageRows(
  draft: any,
  projStatus: any,
  activeStage: string | null,
) {
  return [
    {
      id: "stage-meta",
      label: "Project setup",
      icon: FileTextOutlined,
      active: activeStage === "meta",
      done: 1,
      total: 1,
    },
    {
      id: "stage-0",
      label: "Anchors",
      icon: AnchorStageIcon,
      active: activeStage?.startsWith("0"),
      done: (projStatus?.stages?.["0"]?.refs ?? []).length,
      total:
        (draft.assets?.characters ?? []).length +
        (draft.assets?.props ?? []).length +
        (draft.assets?.scene_refs ?? []).length +
        (draft.assets?.style ? 1 : 0),
    },
    {
      id: "stage-1",
      label: "Narration",
      icon: NarrationStageIcon,
      active: activeStage === "1",
      done: (projStatus?.stages?.["1"]?.audio ?? []).length,
      total: (draft.scenes ?? []).filter((s: any) => s.has_narration).length,
    },
    {
      id: "stage-2",
      label: "Frames",
      icon: PictureOutlined,
      active: activeStage === "2",
      done: (projStatus?.stages?.["2"]?.frames ?? []).length,
      total: (draft.scenes ?? []).length,
    },
    {
      id: "stage-3",
      label: "Motion",
      icon: MotionStageIcon,
      active: activeStage === "3",
      done: (projStatus?.stages?.["3"]?.shots ?? []).length,
      total: (draft.scenes ?? []).length,
    },
    {
      id: "stage-4",
      label: "Final film",
      icon: FinalStageIcon,
      active: activeStage === "4",
      done: (projStatus?.stages?.["4"]?.final ?? []).length,
      total: 1,
    },
  ];
}

function stageRailState(row: any) {
  const total = Number(row.total) || 0;
  const done = Math.min(Number(row.done) || 0, total);
  if (row.active) {
    return {
      label: "Working",
      color: "#1677ff",
      bg: "#e6f4ff",
      border: "#91caff",
      progress: total > 0 ? done / total : 0,
      compact: "run",
    };
  }
  if (total <= 0) {
    return {
      label: "No work",
      color: "#8c8c8c",
      bg: "#fafafa",
      border: "#eeeeee",
      progress: 0,
      compact: "—",
    };
  }
  if (done >= total) {
    return {
      label: "Ready",
      color: "#52c41a",
      bg: "#f6ffed",
      border: "#b7eb8f",
      progress: 1,
      compact: "✓",
    };
  }
  if (done > 0) {
    return {
      label: "Partial",
      color: "#d48806",
      bg: "#fffbe6",
      border: "#ffe58f",
      progress: done / total,
      compact: `${done}/${total}`,
    };
  }
  return {
    label: "Needed",
    color: "#8c8c8c",
    bg: "#ffffff",
    border: "#eeeeee",
    progress: 0,
    compact: `${done}/${total}`,
  };
}

function stageRailTooltip(row: any, state: any): string {
  const total = Number(row.total) || 0;
  const progress = total > 0 ? `${row.done}/${row.total}` : state.label;
  return `${row.label}: ${progress} · ${state.label}`;
}

/**
 * Compact stage snapshot used under the collapsed project strip.
 */
function StageRail({ rows, inline = false }: any) {
  const [expanded, setExpanded] = React.useState(false);
  const jumpToStage = (id: string) => {
    window.dispatchEvent(
      new CustomEvent("qwenpaw:open-stage", { detail: { id } }),
    );
    window.setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  if (inline) {
    return React.createElement(
      Card,
      {
        size: "small",
        style: { marginTop: 10, borderRadius: 8 },
        bodyStyle: {
          padding: "8px 6px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
        },
      },
      ...rows.map((r: any) => {
        const state = stageRailState(r);
        const Icon = r.icon || FileTextOutlined;
        const title = stageRailTooltip(r, state);
        return React.createElement(
          Tooltip,
          { key: r.id, title, placement: "right" },
          React.createElement(
            "button",
            {
              type: "button",
              onClick: () => jumpToStage(r.id),
              style: {
                width: 42,
                minHeight: 42,
                borderRadius: 8,
                border: `1px solid ${state.border}`,
                background: state.bg,
                color: state.color,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                padding: "4px 3px",
                fontSize: 9,
                fontWeight: 700,
                lineHeight: 1,
              },
            },
            React.createElement(Icon, {
              style: { fontSize: 15, lineHeight: 1 },
            }),
            React.createElement(
              "span",
              {
                style: {
                  color: state.color,
                  fontSize: 9,
                  fontVariantNumeric: "tabular-nums",
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                },
              },
              state.compact,
            ),
            React.createElement(
              "span",
              {
                style: {
                  width: 28,
                  height: 3,
                  borderRadius: 999,
                  background: "#edf0f4",
                  display: "block",
                  overflow: "hidden",
                },
              },
              React.createElement("span", {
                style: {
                  width: `${Math.round(state.progress * 100)}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: state.color,
                  display: "block",
                },
              }),
            ),
          ),
        );
      }),
    );
  }

  return React.createElement(
    "div",
    {
      style: {
        position: "fixed",
        right: 10,
        top: 152,
        zIndex: 10,
        pointerEvents: "none",
      },
    },
    React.createElement(
      "div",
      {
        onMouseEnter: () => setExpanded(true),
        onMouseLeave: () => setExpanded(false),
        onFocus: () => setExpanded(true),
        onBlur: (e: any) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setExpanded(false);
        },
        style: {
          pointerEvents: "auto",
          background: "#fff",
          border: "1px solid #e8e8e8",
          borderRadius: 8,
          boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
          minWidth: expanded ? 154 : 38,
          padding: expanded ? 8 : 6,
          transition: "min-width 140ms ease, padding 140ms ease",
        },
      },
      expanded
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement(
              AntText,
              {
                strong: true,
                style: { display: "block", fontSize: 12, marginBottom: 6 },
              },
              "Stages",
            ),
            ...rows.map((r: any) => {
              const state = stageRailState(r);
              const Icon = r.icon || FileTextOutlined;
              return React.createElement(
                "button",
                {
                  key: r.id,
                  type: "button",
                  onClick: () => jumpToStage(r.id),
                  style: {
                    alignItems: "center",
                    background: r.active ? "#e6f4ff" : "transparent",
                    border: 0,
                    borderRadius: 6,
                    color: r.active ? "#1677ff" : "#444",
                    cursor: "pointer",
                    display: "flex",
                    fontSize: 12,
                    gap: 7,
                    lineHeight: 1.4,
                    margin: 0,
                    padding: "5px 6px",
                    textAlign: "left",
                    width: "100%",
                  },
                  title: stageRailTooltip(r, state),
                },
                React.createElement(Icon, {
                  style: {
                    color: state.color,
                    flex: "0 0 auto",
                    fontSize: 14,
                    lineHeight: 1,
                  },
                }),
                React.createElement(
                  "span",
                  {
                    style: {
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    },
                  },
                  r.label,
                ),
                React.createElement(
                  "span",
                  {
                    style: {
                      color: state.color,
                      fontSize: 10,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      textTransform: "uppercase",
                      whiteSpace: "nowrap",
                    },
                  },
                  r.total > 0 ? `${r.done}/${r.total}` : state.label,
                ),
              );
            }),
          )
        : React.createElement(
            Tooltip,
            { title: "Stages", placement: "left" },
            React.createElement(Button, {
              size: "small",
              type: rows.some((r: any) => r.active) ? "primary" : "default",
              icon: React.createElement(PlayCircleOutlined),
              onClick: () => setExpanded(true),
              style: { width: 28, height: 28, padding: 0 },
            }),
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
    Array.isArray(gc.style_directives) ? gc.style_directives.join("\n") : "",
  );
  const [concurrency, setConcurrency] = React.useState<number>(
    Number(gc.concurrency) || 5,
  );
  const [saving, setSaving] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const lastSavedSettingsRef = React.useRef("");

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
    setConcurrency(Number(g.concurrency) || 5);
    lastSavedSettingsRef.current = "";
  }, [draft]);

  const buildNextDraft = React.useCallback(() => {
    const next = JSON.parse(JSON.stringify(draft));
    next.global_config = next.global_config || {};
    next.global_config.era = era.trim();
    next.global_config.country = country.trim();
    next.global_config.genre = genre.trim();
    next.global_config.tone = tone.trim();
    next.global_config.story_anchor = storyAnchor.trim();
    next.global_config.world_bible = worldBible.trim();
    next.global_config.style_directives = directives
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    next.global_config.concurrency = Math.max(1, Math.min(5, concurrency));
    for (const k of [
      "era",
      "country",
      "genre",
      "tone",
      "story_anchor",
      "world_bible",
    ]) {
      if (!next.global_config[k]) delete next.global_config[k];
    }
    if (next.global_config.style_directives.length === 0) {
      delete next.global_config.style_directives;
    }
    return next;
  }, [
    draft,
    era,
    country,
    genre,
    tone,
    storyAnchor,
    worldBible,
    directives,
    concurrency,
  ]);

  const save = async (quiet = false) => {
    setSaving(true);
    try {
      const next = buildNextDraft();
      const signature = JSON.stringify(next.global_config || {});
      await onSaveDraft(next, { quiet: true, reload: !quiet });
      lastSavedSettingsRef.current = signature;
      if (!quiet) antMessage.success("Settings saved.");
    } catch (e: any) {
      antMessage.error(`Save failed: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  React.useEffect(() => {
    const next = buildNextDraft();
    const signature = JSON.stringify(next.global_config || {});
    if (!lastSavedSettingsRef.current) {
      lastSavedSettingsRef.current = signature;
      return undefined;
    }
    if (signature === lastSavedSettingsRef.current) return undefined;
    const timer = window.setTimeout(() => {
      void save(true);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [buildNextDraft]);

  const summary =
    [
      era && `era=${era}`,
      country && `country=${country}`,
      genre && `genre=${genre}`,
      tone && `tone=${tone}`,
      storyAnchor && "anchor: ✓",
      worldBible && "world: ✓",
      directives.trim() &&
        `${directives.split("\n").filter(Boolean).length} directive(s)`,
      `concurrency: ${concurrency}`,
    ]
      .filter(Boolean)
      .join(" · ") || "no story constraints — LLM auto-applied";

  return React.createElement(
    Card,
    {
      size: "small",
      style: {
        marginTop: 12,
        borderRadius: 8,
        overflow: "hidden",
        borderColor: open ? "#e6e6e6" : "#eeeeee",
      },
      headStyle: {
        minHeight: 46,
        padding: "0 16px",
        background: "#fcfcfd",
        borderBottom: open ? "1px solid #f0f0f0" : 0,
      },
      bodyStyle: open ? { padding: 16 } : { display: "none", padding: 0 },
      title: React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            minWidth: 0,
          },
          onClick: () => setOpen(!open),
        },
        React.createElement(
          "span",
          {
            style: {
              width: 18,
              height: 18,
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: open ? "#595959" : "#8c8c8c",
              background: "#f3f3f3",
              fontSize: 11,
              flex: "0 0 auto",
            },
          },
          open ? "▼" : "▶",
        ),
        React.createElement(AntText, { strong: true }, "Story settings"),
        React.createElement(
          AntText,
          {
            type: "secondary",
            style: {
              fontSize: 12,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            },
          },
          `· ${summary}`,
        ),
      ),
      extra:
        open && saving
          ? React.createElement(
              AntText,
              { type: "secondary", style: { fontSize: 12 } },
              "Autosaving...",
            )
          : null,
    },
    open
      ? React.createElement(
          Form,
          { layout: "vertical", style: { marginTop: 4 } },
          (() => {
            // Evidence quotes from Pass 1: when LLM inferred a
            // constraint, it cites the source. We render it below
            // each field so the user can verify the inference.
            const ev = (draft.global_config || {})._constraint_evidence || {};
            const evidenceExtra = (key: string, baseHint?: string) => {
              const quote = ev[key];
              if (!quote) return baseHint;
              return React.createElement(
                "div",
                null,
                React.createElement(
                  AntText,
                  {
                    type: "secondary",
                    style: { fontSize: 11, fontStyle: "italic" },
                  },
                  `🔍 inferred from source: "${quote}"`,
                ),
                baseHint
                  ? React.createElement(
                      "div",
                      { style: { fontSize: 11, marginTop: 2 } },
                      baseHint,
                    )
                  : null,
              );
            };
            return React.createElement(
              React.Fragment,
              null,
              React.createElement(
                Row,
                { gutter: 12 },
                React.createElement(
                  Col,
                  { span: 6 },
                  React.createElement(
                    Form.Item,
                    {
                      label: "Era",
                      extra: evidenceExtra("era"),
                    },
                    React.createElement(Input, {
                      value: era,
                      onChange: (e: any) => setEra(e.target.value),
                      placeholder: "1940s",
                    }),
                  ),
                ),
                React.createElement(
                  Col,
                  { span: 6 },
                  React.createElement(
                    Form.Item,
                    {
                      label: "Country",
                      extra: evidenceExtra("country"),
                    },
                    React.createElement(Input, {
                      value: country,
                      onChange: (e: any) => setCountry(e.target.value),
                      placeholder: "Cuba",
                    }),
                  ),
                ),
                React.createElement(
                  Col,
                  { span: 6 },
                  React.createElement(
                    Form.Item,
                    {
                      label: "Genre",
                      extra: evidenceExtra("genre"),
                    },
                    React.createElement(Input, {
                      value: genre,
                      onChange: (e: any) => setGenre(e.target.value),
                    }),
                  ),
                ),
                React.createElement(
                  Col,
                  { span: 6 },
                  React.createElement(
                    Form.Item,
                    {
                      label: "Tone",
                      extra: evidenceExtra("tone"),
                    },
                    React.createElement(Input, {
                      value: tone,
                      onChange: (e: any) => setTone(e.target.value),
                    }),
                  ),
                ),
              ),
              React.createElement(
                Form.Item,
                {
                  label: "Story anchor",
                  extra: evidenceExtra(
                    "story_anchor",
                    "Narrative context propagated to every scene. Short (≤50 words).",
                  ),
                },
                React.createElement(TextArea, {
                  value: storyAnchor,
                  onChange: (e: any) => setStoryAnchor(e.target.value),
                  rows: 2,
                  placeholder:
                    "A weathered Cuban fisherman's quiet test of endurance against the sea — dignified persistence, not defeat.",
                }),
              ),
              React.createElement(
                Form.Item,
                {
                  label: "World bible (recurring set-design facts)",
                  extra: evidenceExtra(
                    "world_bible",
                    "Invariants that should hold across every scene's setting + style. Stops scene-to-scene drift. 30-80 words.",
                  ),
                },
                React.createElement(TextArea, {
                  value: worldBible,
                  onChange: (e: any) => setWorldBible(e.target.value),
                  rows: 3,
                  placeholder:
                    "Set design: wooden cottage-style fence; chalk-lettered wooden signs (NO blackboards); morning sun upper-right; cottagecore palette — pastel greens, soft creams.",
                }),
              ),
              React.createElement(
                Form.Item,
                {
                  label: "Style directives (one per line, ≤5)",
                  extra: evidenceExtra(
                    "style_directives",
                    "Layered on every scene's compose prompt. Things like palette, physics rules, continuity.",
                  ),
                },
                React.createElement(TextArea, {
                  value: directives,
                  onChange: (e: any) => setDirectives(e.target.value),
                  rows: 3,
                  placeholder:
                    "warm amber-rose palette\nreal-world physics, no floating objects",
                }),
              ),
            );
          })(),
          React.createElement(
            Form.Item,
            {
              label: "Parallel concurrency (Stage 2 + 3 'Run all')",
              extra:
                "Number of scenes to fire in parallel. 1 = sequential (current default). 3-5 = fast but watch for DashScope rate limits.",
            },
            React.createElement(InputNumber, {
              min: 1,
              max: 5,
              value: concurrency,
              onChange: (v: any) => setConcurrency(Number(v) || 5),
              style: { width: 100 },
            }),
          ),
        )
      : null,
  );
}

// ── state timeline card (ledger view) ───────────────────────────────

function slugStateId(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const ascii = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 48)
    .replace(/_+$/g, "");
  if (ascii) return ascii;
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `state_${Math.abs(hash).toString(36)}`;
}

function humanizeStateId(value: string): string {
  return String(value || "")
    .replace(/_/g, " ")
    .trim();
}

function stateRecordId(state: any): string {
  if (typeof state === "string") return state.trim();
  return String(state?.id || state?.title || state?.content || "").trim();
}

function normalizeStateRecord(state: any): any {
  if (typeof state === "string") {
    const id = slugStateId(state);
    const title = humanizeStateId(id || state);
    return { id, title, content: title };
  }
  const title = String(state?.title || state?.id || "").trim();
  const content = String(
    state?.content || state?.title || state?.id || "",
  ).trim();
  const id = slugStateId(state?.id || title || content);
  return { id, title: title || humanizeStateId(id), content };
}

function stateRecordLabel(state: any): string {
  const rec = normalizeStateRecord(state);
  return rec.title && rec.title !== rec.id
    ? `${rec.title} (${rec.id})`
    : rec.id;
}

function sceneIdOf(scene: any): string {
  return String(scene?.id ?? scene?.scene_id ?? "").trim();
}

function sceneLabel(scene: any): string {
  const id = sceneIdOf(scene);
  const title = String(
    scene?.title || scene?.name || scene?.summary || "",
  ).trim();
  return title ? `${id} — ${title}` : id;
}

function humanizeId(value: string): string {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function compactText(value: string, max = 76): string {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}...`;
}

function activeStatesForChange(
  ledger: any[],
  entity: string,
  atScene: string,
  originalIndex?: number,
): any[] {
  const active = new Map<string, any>();
  ledger.forEach((ch, idx) => {
    if (idx === originalIndex) return;
    if (ch?.entity !== entity) return;
    if (!ch?.at_scene || String(ch.at_scene) > String(atScene)) return;
    if (ch.reset) active.clear();
    (ch.remove || []).forEach((state: any) =>
      active.delete(stateRecordId(state)),
    );
    (ch.add || []).forEach((state: any) => {
      const rec = normalizeStateRecord(state);
      if (rec.id) active.set(rec.id, rec);
    });
  });
  return [...active.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeIdList(value: any): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || "").trim()).filter(Boolean);
  }
  const single = String(value || "").trim();
  return single ? [single] : [];
}

function draftContinuityEntities(draft: any): any[] {
  const chars: any[] = draft?.assets?.characters ?? [];
  const props: any[] = draft?.assets?.props ?? [];
  const refs: any[] = draft?.assets?.scene_refs ?? [];
  return [
    ...chars.map((c: any) => ({
      id: String(c.id || "").trim(),
      kind: "character",
      label: humanizeId(c.id),
      description: String(c.description || ""),
    })),
    ...props.map((p: any) => ({
      id: String(p.id || "").trim(),
      kind: "prop",
      label: humanizeId(p.id),
      description: String(p.description || ""),
    })),
    ...refs.map((r: any) => ({
      id: String(r.id || "").trim(),
      kind: "scene_ref",
      label: humanizeId(r.id),
      description: String(r.description || ""),
    })),
  ].filter((e: any) => e.id);
}

function sceneContinuityEntityIds(scene: any): string[] {
  return Array.from(
    new Set([
      ...normalizeIdList(scene?.uses_characters),
      ...normalizeIdList(scene?.uses_props),
      ...normalizeIdList(scene?.uses_scene_ref),
    ]),
  );
}

function sceneUsesContinuityEntity(scene: any, entityId: string): boolean {
  return sceneContinuityEntityIds(scene).includes(entityId);
}

function continuityGroupsForScene(draft: any, scene: any): any[] {
  if (!scene) return [];
  const entities = draftContinuityEntities(draft);
  const entityById = new Map(entities.map((e: any) => [e.id, e]));
  const ids = sceneContinuityEntityIds(scene);
  return ids
    .map((id) => {
      const entity = entityById.get(id) || {
        id,
        kind: "entity",
        label: humanizeId(id),
      };
      return {
        entity,
        states: activeStatesForChange(
          draft?.state_changes || [],
          id,
          sceneIdOf(scene),
        ),
      };
    })
    .filter((group: any) => group.entity?.id);
}

function affectedScenesForContinuityChange(
  draft: any,
  entityId: string,
  atScene: string,
): any[] {
  const scenes: any[] = draft?.scenes ?? [];
  return scenes.filter((scene: any) => {
    const sid = sceneIdOf(scene);
    return sid && sid >= atScene && sceneUsesContinuityEntity(scene, entityId);
  });
}

function continuityEntityMatchesText(entity: any, text: string): boolean {
  const haystack = String(text || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  if (!haystack) return false;
  const description = String(entity?.description || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  const needles = [
    entity?.id,
    entity?.label,
    humanizeId(entity?.id || ""),
    entity?.description,
  ]
    .map((value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  if (needles.some((needle) => haystack.includes(needle))) return true;
  if (
    entity?.kind === "character" &&
    /\bold\s+man\b/.test(haystack) &&
    /\b(?:elderly|older|aged|weathered)\b/.test(description)
  ) {
    return true;
  }
  if (
    entity?.kind === "character" &&
    /\bboy\b/.test(haystack) &&
    /\b(?:boy|young)\b/.test(description)
  ) {
    return true;
  }
  return false;
}

function preferredContinuityEntity(
  draft: any,
  scene: any,
  instruction: string = "",
): string {
  const sceneIds = sceneContinuityEntityIds(scene);
  const entities = draftContinuityEntities(draft);
  const byId = new Map(entities.map((entity: any) => [entity.id, entity]));
  const sceneEntities = sceneIds
    .map((id) => byId.get(id) || { id, label: humanizeId(id) })
    .filter(Boolean);
  const matchedSceneEntity = sceneEntities.find((entity: any) =>
    continuityEntityMatchesText(entity, instruction),
  );
  if (matchedSceneEntity?.id) return matchedSceneEntity.id;
  const matchedAnyEntity = entities.find((entity: any) =>
    continuityEntityMatchesText(entity, instruction),
  );
  if (matchedAnyEntity?.id) return matchedAnyEntity.id;
  if (sceneIds.length) return sceneIds[0];
  return entities[0]?.id || "";
}

function looksLikeContinuityIntent(text: string): boolean {
  return /(?:state\s+change|change\s+(?:his|her|their|the)?\s*state|from\s+(?:here|now|this\s+point)\s+on|going\s+forward|onward|for\s+the\s+rest|keeps?\s+|continues?\s+|until\s+scene|after\s+this)/i.test(
    text,
  );
}

function stateTitleFromInstruction(text: string): string {
  const cleaned = String(text || "")
    .replace(
      /^\s*(?:from\s+(?:here|now|this\s+point)\s+on|going\s+forward|onward),?\s*/i,
      "",
    )
    .replace(/^\s*(?:make|have|give)\s+/i, "")
    .replace(/^\s*(?:he|she|they|it|him|her|them|the\s+\w+)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return compactText(cleaned || text, 48);
}

function continuityChangeCount(draft: any): number {
  return (draft?.state_changes || []).filter(
    (c: any) =>
      c?.entity &&
      c?.at_scene &&
      ((c.add && c.add.length) || (c.remove && c.remove.length) || c.reset),
  ).length;
}

function continuityEntityKindLabel(kind: string): string {
  if (kind === "character") return "character";
  if (kind === "prop") return "prop";
  if (kind === "scene_ref") return "setting";
  return "entity";
}

function StateTimelineCard({ draft, onSaveDraft }: any) {
  const ledger: any[] = draft.state_changes || [];
  const chars: any[] = draft.assets?.characters ?? [];
  const props: any[] = draft.assets?.props ?? [];
  const refs: any[] = draft.assets?.scene_refs ?? [];
  const scenes: any[] = draft.scenes ?? [];
  const entities = [
    ...chars.map((c: any) => ({ id: c.id, kind: "character" })),
    ...props.map((p: any) => ({ id: p.id, kind: "prop" })),
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

  const saveLedger = async (next: any[], quiet = false) => {
    setSaving(true);
    try {
      const draft2 = JSON.parse(JSON.stringify(draft));
      draft2.state_changes = next.filter(
        (c) =>
          c &&
          c.entity &&
          c.at_scene &&
          ((c.add && c.add.length) || (c.remove && c.remove.length) || c.reset),
      );
      await onSaveDraft(draft2, { quiet: true, reload: !quiet });
      if (!quiet) antMessage.success("State ledger saved.");
    } catch (e: any) {
      antMessage.error(`Save failed: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const upsertChange = async (change: any, close = true) => {
    const next = [...ledger];
    let savedIdx = change._origIdx;
    if (change._origIdx != null) {
      next[change._origIdx] = { ...change };
      delete (next[change._origIdx] as any)._origIdx;
    } else {
      savedIdx = next.length;
      next.push(change);
    }
    await saveLedger(next, !close);
    if (close) setEditing(null);
    else if (change._origIdx == null && savedIdx != null) {
      setEditing({ ...change, _origIdx: savedIdx });
    }
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
      style: {
        marginTop: 12,
        borderRadius: 8,
        overflow: "hidden",
        borderColor: open ? "#e6e6e6" : "#eeeeee",
      },
      headStyle: {
        minHeight: 46,
        padding: "0 16px",
        background: "#fcfcfd",
        borderBottom: open ? "1px solid #f0f0f0" : 0,
      },
      bodyStyle: open ? { padding: 16 } : { display: "none", padding: 0 },
      title: React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            minWidth: 0,
          },
          onClick: () => setOpen(!open),
        },
        React.createElement(
          "span",
          {
            style: {
              width: 18,
              height: 18,
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: open ? "#595959" : "#8c8c8c",
              background: "#f3f3f3",
              fontSize: 11,
              flex: "0 0 auto",
            },
          },
          open ? "▼" : "▶",
        ),
        React.createElement(AntText, { strong: true }, "State timeline"),
        React.createElement(
          AntText,
          {
            type: "secondary",
            style: {
              fontSize: 12,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            },
          },
          `· ${summary}`,
        ),
      ),
      extra: open
        ? React.createElement(Button, {
            type: "dashed",
            size: "small",
            icon: React.createElement(PlusOutlined),
            onClick: () =>
              setEditing({
                entity: entities[0]?.id || "",
                at_scene: sceneIdOf(scenes[0]),
                add: [{ id: "", title: "", content: "" }],
                remove: [],
                reset: false,
                note: "",
              }),
            children: "Add change",
          })
        : null,
    },
    open
      ? React.createElement(
          "div",
          null,
          entities.length === 0
            ? React.createElement(Empty, {
                description:
                  "No characters or settings yet — add some under Stage 0.",
              })
            : null,
          ...groupedByEntity.map(({ entity, changes }) =>
            React.createElement(
              "div",
              { key: entity.id, style: { marginBottom: 12 } },
              React.createElement(
                AntText,
                { strong: true, style: { fontSize: 12 } },
                `${
                  entity.kind === "character"
                    ? "character"
                    : entity.kind === "prop"
                    ? "prop"
                    : "setting"
                }: ${entity.id}`,
              ),
              changes.length === 0
                ? React.createElement(
                    AntText,
                    {
                      type: "secondary",
                      style: { fontSize: 11, display: "block" },
                    },
                    "  (canonical throughout — no state changes)",
                  )
                : React.createElement(
                    "div",
                    null,
                    ...changes.map((c) => {
                      const origIdx = ledger.indexOf(c);
                      const labelParts = [
                        c.reset && "↺ RESET",
                        c.remove?.length &&
                          `− ${c.remove.map(stateRecordId).join(", ")}`,
                        c.add?.length &&
                          `+ ${c.add.map(stateRecordLabel).join(", ")}`,
                      ]
                        .filter(Boolean)
                        .join("  |  ");
                      return React.createElement(
                        "div",
                        {
                          key: origIdx,
                          style: {
                            padding: "4px 8px",
                            marginTop: 2,
                            border: "1px solid #eee",
                            borderRadius: 4,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          },
                        },
                        React.createElement(
                          Tag,
                          { color: "blue" },
                          `@${c.at_scene}`,
                        ),
                        React.createElement(
                          AntText,
                          { style: { fontSize: 12, flex: 1 } },
                          labelParts || "(empty change)",
                        ),
                        c.note
                          ? React.createElement(
                              AntText,
                              { type: "secondary", style: { fontSize: 11 } },
                              `— ${c.note}`,
                            )
                          : null,
                        React.createElement(Button, {
                          size: "small",
                          type: "text",
                          icon: React.createElement(EditOutlined),
                          onClick: () =>
                            setEditing({ ...c, _origIdx: origIdx }),
                        }),
                        React.createElement(Button, {
                          size: "small",
                          type: "text",
                          danger: true,
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
          change: editing,
          entities,
          scenes,
          ledger,
          saving,
          onCancel: () => setEditing(null),
          onSubmit: upsertChange,
          onAutoSubmit: (changePatch: any) => upsertChange(changePatch, false),
        })
      : null,
  );
}

function StateChangeEditor({
  change,
  entities,
  scenes,
  ledger,
  saving,
  onCancel,
  onSubmit,
  onAutoSubmit,
}: any) {
  const [entity, setEntity] = React.useState(change.entity || "");
  const [atScene, setAtScene] = React.useState(
    change.at_scene || sceneIdOf(scenes[0]),
  );
  const initialAddStates = (change.add || []).length
    ? (change.add || []).map(normalizeStateRecord)
    : [{ id: "", title: "", content: "" }];
  const [addStates, setAddStates] = React.useState<any[]>(initialAddStates);
  const [removeStates, setRemoveStates] = React.useState<string[]>(
    (change.remove || []).map(stateRecordId).map(slugStateId).filter(Boolean),
  );
  const [reset, setReset] = React.useState(!!change.reset);
  const [note, setNote] = React.useState(change.note || "");
  const sceneOptions = scenes
    .map((scene: any) => ({
      value: sceneIdOf(scene),
      label: sceneLabel(scene),
    }))
    .filter((option: any) => option.value);
  const activeStates = activeStatesForChange(
    ledger || [],
    entity,
    atScene,
    change._origIdx,
  );
  const removeOptions = [
    ...activeStates,
    ...removeStates.map((id) => ({
      id,
      title: humanizeStateId(id),
      content: "",
    })),
  ]
    .filter((state: any) => state?.id)
    .reduce((acc: any[], state: any) => {
      if (!acc.some((item) => item.id === state.id)) acc.push(state);
      return acc;
    }, [])
    .sort((a: any, b: any) => a.id.localeCompare(b.id))
    .map((state: any) => ({
      value: state.id,
      label:
        state.title && state.title !== state.id
          ? `${state.title} (${state.id})`
          : state.id,
    }));
  const updateAddState = (idx: number, patch: any) =>
    setAddStates((states: any[]) =>
      states.map((state, i) => {
        if (i !== idx) return state;
        const next = { ...state, ...patch };
        if (Object.prototype.hasOwnProperty.call(patch, "title")) {
          next.id = slugStateId(patch.title);
        }
        return next;
      }),
    );
  const removeAddState = (idx: number) =>
    setAddStates((states: any[]) => states.filter((_, i) => i !== idx));
  const appendAddState = () =>
    setAddStates((states: any[]) => [
      ...states,
      { id: "", title: "", content: "" },
    ]);
  const lastAutoSaveRef = React.useRef("");
  const buildChange = React.useCallback(() => {
    const normalizedAdds = addStates
      .map(normalizeStateRecord)
      .filter((state: any) => state.id || state.title || state.content);
    return {
      _origIdx: change._origIdx,
      entity: entity.trim(),
      at_scene: atScene.trim(),
      add: normalizedAdds,
      remove: removeStates,
      reset,
      note: note.trim(),
    };
  }, [addStates, atScene, change._origIdx, entity, note, removeStates, reset]);
  React.useEffect(() => {
    lastAutoSaveRef.current = JSON.stringify(buildChange());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change._origIdx]);
  React.useEffect(() => {
    const next = buildChange();
    if (!next.entity || !next.at_scene) return undefined;
    const incomplete = next.add.some(
      (state: any) => !state.title.trim() || !state.content.trim(),
    );
    if (incomplete) return undefined;
    if (!next.add.length && !next.remove.length && !next.reset) {
      return undefined;
    }
    const signature = JSON.stringify(next);
    if (signature === lastAutoSaveRef.current) return undefined;
    const timer = window.setTimeout(async () => {
      await onAutoSubmit?.(next);
      lastAutoSaveRef.current = signature;
    }, 800);
    return () => window.clearTimeout(timer);
  }, [buildChange, onAutoSubmit]);
  return React.createElement(
    Modal,
    {
      open: true,
      title: change._origIdx != null ? "Edit state change" : "Add state change",
      confirmLoading: saving,
      onCancel,
      onOk: async () => {
        if (!entity || !atScene) {
          antMessage.warning("entity and at_scene are required");
          return;
        }
        const next = buildChange();
        const incomplete = next.add.some(
          (state: any) => !state.title.trim() || !state.content.trim(),
        );
        if (incomplete) {
          antMessage.warning("Each added state needs a title and content.");
          return;
        }
        await onSubmit(next);
      },
      okText: "Done",
      width: 560,
    },
    React.createElement(
      Form,
      { layout: "vertical" },
      React.createElement(
        Row,
        { gutter: 12 },
        React.createElement(
          Col,
          { span: 14 },
          React.createElement(
            Form.Item,
            { label: "Entity (character or setting)" },
            React.createElement(Select, {
              value: entity,
              onChange: setEntity,
              style: { width: "100%" },
              options: entities.map((e: any) => ({
                value: e.id,
                label: `${e.kind === "character" ? "👤" : "📍"} ${e.id}`,
              })),
            }),
          ),
        ),
        React.createElement(
          Col,
          { span: 10 },
          React.createElement(
            Form.Item,
            {
              label: "At scene",
            },
            React.createElement(Select, {
              value: atScene,
              onChange: setAtScene,
              showSearch: true,
              optionFilterProp: "label",
              style: { width: "100%" },
              options: sceneOptions,
              placeholder: "Choose scene",
            }),
          ),
        ),
      ),
      React.createElement(
        Form.Item,
        {
          label: "Add states",
          extra:
            "Title becomes the concise state id; content is used in Stage 2 prompting.",
        },
        React.createElement(
          "div",
          { style: { display: "grid", gap: 8 } },
          ...addStates.map((state: any, idx: number) =>
            React.createElement(
              "div",
              {
                key: idx,
                style: {
                  border: "1px solid #f0f0f0",
                  borderRadius: 6,
                  padding: 8,
                },
              },
              React.createElement(
                Row,
                { gutter: 8 },
                React.createElement(
                  Col,
                  { span: 14 },
                  React.createElement(Input, {
                    value: state.title,
                    onChange: (e: any) =>
                      updateAddState(idx, { title: e.target.value }),
                    placeholder: "Title, e.g. distressed hair",
                  }),
                ),
                React.createElement(
                  Col,
                  { span: 8 },
                  React.createElement(
                    Tooltip,
                    { title: state.id || "ID generated from title" },
                    React.createElement(
                      Tag,
                      {
                        style: {
                          display: "block",
                          lineHeight: "30px",
                          marginRight: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        },
                      },
                      state.id || "state_id",
                    ),
                  ),
                ),
                React.createElement(
                  Col,
                  { span: 2 },
                  React.createElement(Button, {
                    danger: true,
                    icon: React.createElement(DeleteOutlined),
                    onClick: () => removeAddState(idx),
                    size: "small",
                    type: "text",
                  }),
                ),
              ),
              React.createElement(TextArea, {
                value: state.content,
                onChange: (e: any) =>
                  updateAddState(idx, { content: e.target.value }),
                placeholder:
                  "Content used for generation, e.g. Sparrow's head feathers are ruffled and yellowed, making him look distressed.",
                rows: 2,
                style: { marginTop: 8 },
              }),
            ),
          ),
          React.createElement(Button, {
            icon: React.createElement(PlusOutlined),
            onClick: appendAddState,
            size: "small",
            type: "dashed",
            children: "Add state",
          }),
        ),
      ),
      React.createElement(
        Form.Item,
        {
          label: "Remove states",
          extra: activeStates.length
            ? "Pick from states already active for this entity at this point in the story."
            : "No prior active states for this entity before this scene.",
        },
        React.createElement(Select, {
          mode: "multiple",
          value: removeStates,
          onChange: setRemoveStates,
          options: removeOptions,
          disabled: removeOptions.length === 0,
          placeholder: "Choose states to remove",
          style: { width: "100%" },
        }),
      ),
      React.createElement(
        Form.Item,
        { label: "Reset (clear ALL prior state for this entity)" },
        React.createElement(antd.Switch, {
          checked: reset,
          onChange: setReset,
        }),
      ),
      React.createElement(
        Form.Item,
        { label: "Note (why this change happens — for your reference)" },
        React.createElement(Input, {
          value: note,
          onChange: (e: any) => setNote(e.target.value),
          placeholder: "carrot trips while running and bandages his arm",
        }),
      ),
    ),
  );
}

function StyleSwatchPicker({ styles, value, onChange }: any) {
  const list: StyleEntry[] = styles ?? [];
  if (!list.length) return null;
  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        gap: 8,
        overflowX: "auto",
        paddingTop: 8,
        paddingBottom: 2,
      },
    },
    ...list.map((style) => {
      const selected = value === style.id;
      const label = compactText(
        String(style.display_name || style.id).replace(/\s*\([^)]*\)\s*/g, " "),
        26,
      );
      return React.createElement(
        Tooltip,
        {
          key: style.id,
          title: style.description || style.display_name || style.id,
        },
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => onChange?.(style.id),
            style: {
              width: 112,
              flex: "0 0 auto",
              border: selected ? "2px solid #ff7a00" : "1px solid #d9d9d9",
              borderRadius: 6,
              padding: 4,
              background: selected ? "#fff7e6" : "#fff",
              cursor: "pointer",
              textAlign: "left",
            },
          },
          style.has_sample
            ? React.createElement("img", {
                src: styleSampleUrl(style.id),
                alt: label,
                onError: (e: any) => {
                  e.currentTarget.style.opacity = "0.15";
                },
                style: {
                  width: "100%",
                  aspectRatio: "1 / 1",
                  objectFit: "cover",
                  borderRadius: 4,
                  display: "block",
                  background: "#f5f5f5",
                },
              })
            : React.createElement(
                "div",
                {
                  style: {
                    width: "100%",
                    aspectRatio: "1 / 1",
                    borderRadius: 4,
                    background: "#fafafa",
                    border: "1px dashed #d9d9d9",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#999",
                    fontSize: 11,
                    textAlign: "center",
                    padding: 6,
                  },
                },
                "sample pending",
              ),
          React.createElement(
            "div",
            {
              style: {
                marginTop: 4,
                fontSize: 11,
                fontWeight: selected ? 600 : 400,
                lineHeight: 1.2,
                minHeight: 26,
              },
            },
            label,
          ),
        ),
      );
    }),
  );
}

// ── decompose form ───────────────────────────────────────────────────

// Zero-config entry: lead with one "Make my film" CTA + a Vibe swatch;
// every other dial lives behind the Advanced toggle (smart defaults do
// the rest — the LLM auto-extracts era/genre/tone, providers/voice/beat
// count all default).
function MakeFilmHero({
  styles,
  styleHint,
  setStyleHint,
  busy,
  activeStage,
  status,
  onSubmit,
  onMakeFilm,
  showAdvanced,
  setShowAdvanced,
}: any) {
  const ready = !!status?.has_dashscope;
  return React.createElement(
    "div",
    { style: { padding: "6px 0 16px" } },
    React.createElement(
      Title,
      { level: 4, style: { marginBottom: 4 } },
      "Make your film",
    ),
    React.createElement(
      Paragraph,
      { type: "secondary", style: { marginBottom: 14 } },
      "We storyboard it, cast it, shoot the frames, animate, and stitch the " +
        "cut — you just press go. Pick a vibe (optional), then make it.",
    ),
    React.createElement(
      AntText,
      {
        strong: true,
        style: { fontSize: 12, display: "block", marginBottom: 6 },
      },
      "Vibe",
    ),
    React.createElement(StyleSwatchPicker, {
      styles,
      value: styleHint,
      onChange: setStyleHint,
    }),
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginTop: 18,
        },
      },
      React.createElement(Button, {
        type: "primary",
        size: "large",
        loading: busy && activeStage === "decompose",
        disabled: !ready,
        icon: React.createElement(StudioModeIcon),
        onClick: onMakeFilm || onSubmit,
        children: "Make my film",
      }),
      React.createElement(Button, {
        type: "text",
        size: "small",
        icon: React.createElement(AdvancedOptionsIcon),
        onClick: () => setShowAdvanced(!showAdvanced),
        style: { color: "#8b96b4" },
        children: showAdvanced ? "Hide advanced options" : "Advanced options",
      }),
    ),
    !ready
      ? React.createElement(
          AntText,
          {
            type: "warning",
            style: { fontSize: 11, display: "block", marginTop: 8 },
          },
          "DASHSCOPE_API_KEY missing — set it under Environment Variables.",
        )
      : null,
  );
}

function DecomposeForm({
  duration,
  setDuration,
  styleHint,
  setStyleHint,
  audience,
  setAudience,
  voice,
  setVoice,
  era,
  setEra,
  country,
  setCountry,
  genre,
  setGenre,
  tone,
  setTone,
  storyAnchor,
  setStoryAnchor,
  styleDirectives,
  setStyleDirectives,
  worldBible,
  setWorldBible,
  frameProvider,
  setFrameProvider,
  videoProvider,
  setVideoProvider,
  targetScenes,
  setTargetScenes,
  styles,
  busy,
  activeStage,
  status,
  onSubmit,
  onMakeFilm,
}: any) {
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const styleOptions = (styles ?? []).map((s: StyleEntry) => ({
    label: `${s.display_name}`,
    value: s.id,
    title: s.description,
  }));
  return React.createElement(
    Form,
    { layout: "vertical" },
    React.createElement(MakeFilmHero, {
      styles,
      styleHint,
      setStyleHint,
      busy,
      activeStage,
      status,
      onSubmit,
      onMakeFilm,
      showAdvanced,
      setShowAdvanced,
    }),
    React.createElement(
      "div",
      { style: { display: showAdvanced ? "block" : "none" } },
      React.createElement(
        Row,
        { gutter: 16 },
        React.createElement(
          Col,
          { span: 6 },
          React.createElement(
            Form.Item,
            { label: "Target duration (s)" },
            React.createElement(InputNumber, {
              min: 20,
              max: 600,
              value: duration,
              onChange: (v: any) => setDuration(v ?? 60),
              style: { width: "100%" },
            }),
          ),
        ),
        React.createElement(
          Col,
          { span: 6 },
          React.createElement(
            Form.Item,
            {
              label: "Beat count (optional)",
              extra:
                "Empty = auto from duration. Override to force more/fewer beats — useful for long stories that the LLM would otherwise compress.",
            },
            React.createElement(InputNumber, {
              min: 3,
              max: 60,
              value: targetScenes ?? null,
              onChange: (v: any) =>
                setTargetScenes(v == null ? undefined : Number(v)),
              placeholder: "auto",
              style: { width: "100%" },
            }),
          ),
        ),
        React.createElement(
          Col,
          { span: 12 },
          React.createElement(
            Form.Item,
            {
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
            React.createElement(StyleSwatchPicker, {
              styles,
              value: styleHint,
              onChange: setStyleHint,
            }),
          ),
        ),
      ),
      React.createElement(
        Row,
        { gutter: 16 },
        React.createElement(
          Col,
          { span: 12 },
          React.createElement(
            Form.Item,
            { label: "Audience" },
            React.createElement(Input, {
              value: audience,
              onChange: (e: any) => setAudience(e.target.value),
              placeholder: "general / family",
            }),
          ),
        ),
        React.createElement(
          Col,
          { span: 12 },
          React.createElement(
            Form.Item,
            { label: "Narration voice (CosyVoice)" },
            React.createElement(Select, {
              value: voice,
              onChange: setVoice,
              options: [
                { label: "longshu_v2 (deep male)", value: "longshu_v2" },
                { label: "longwan_v2 (warm male)", value: "longwan_v2" },
                {
                  label: "longxiaoxia_v2 (warm female)",
                  value: "longxiaoxia_v2",
                },
                {
                  label: "longxiaochun_v2 (neutral)",
                  value: "longxiaochun_v2",
                },
              ],
              style: { width: "100%" },
            }),
          ),
        ),
      ),

      React.createElement(
        Row,
        { gutter: 16 },
        React.createElement(
          Col,
          { span: 12 },
          React.createElement(
            Form.Item,
            { label: "Image model" },
            React.createElement(Select, {
              value: frameProvider,
              onChange: setFrameProvider,
              style: { width: "100%" },
              options: [
                {
                  value: "gpt-image-2-dashscope",
                  label: "gpt-image-2 (dashscope)",
                },
                { value: "gpt-image-2", label: "gpt-image-2 (openai)" },
                { value: "qwen-image", label: "qwen-image-2.0-pro" },
              ],
            }),
          ),
        ),
        React.createElement(
          Col,
          { span: 12 },
          React.createElement(
            Form.Item,
            { label: "Video model" },
            React.createElement(Select, {
              value: videoProvider,
              onChange: setVideoProvider,
              style: { width: "100%" },
              options: [
                { value: "wan27", label: "Wan 2.7" },
                { value: "happyhorse", label: "HappyHorse 2.0" },
                { value: "seedance", label: "Seedance 2.0" },
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
          title: React.createElement(
            AntText,
            { type: "secondary" },
            "Story constraints (optional — LLM auto-picks if blank)",
          ),
          style: { marginBottom: 12, background: "#fafafa" },
          bodyStyle: { padding: 12 },
        },
        React.createElement(
          Row,
          { gutter: 12 },
          React.createElement(
            Col,
            { span: 6 },
            React.createElement(
              Form.Item,
              { label: "Era" },
              React.createElement(Input, {
                value: era,
                onChange: (e: any) => setEra(e.target.value),
                placeholder: "1940s",
              }),
            ),
          ),
          React.createElement(
            Col,
            { span: 6 },
            React.createElement(
              Form.Item,
              { label: "Country" },
              React.createElement(Input, {
                value: country,
                onChange: (e: any) => setCountry(e.target.value),
                placeholder: "Cuba",
              }),
            ),
          ),
          React.createElement(
            Col,
            { span: 6 },
            React.createElement(
              Form.Item,
              { label: "Genre" },
              React.createElement(Input, {
                value: genre,
                onChange: (e: any) => setGenre(e.target.value),
                placeholder: "tragedy / triumph / coming-of-age",
              }),
            ),
          ),
          React.createElement(
            Col,
            { span: 6 },
            React.createElement(
              Form.Item,
              { label: "Tone" },
              React.createElement(Input, {
                value: tone,
                onChange: (e: any) => setTone(e.target.value),
                placeholder: "somber / playful / hopeful",
              }),
            ),
          ),
        ),
        React.createElement(
          Form.Item,
          {
            label:
              "Story anchor (overall narrative context — propagates to every scene)",
            extra:
              "Short — 20-50 words. Era + theme + arc. Avoid visual prose (those belong in per-scene descriptions).",
          },
          React.createElement(TextArea, {
            value: storyAnchor,
            onChange: (e: any) => setStoryAnchor(e.target.value),
            placeholder:
              "A weathered Cuban fisherman's quiet test of endurance against the sea — a story of dignified persistence, not defeat. 1940s coastal village setting.",
            rows: 2,
          }),
        ),
        React.createElement(
          Form.Item,
          {
            label:
              "World bible — recurring set-design facts (applies to every scene)",
            extra:
              "Short list of invariants: props that recur, exclusive lighting, palette, camera rules. Stops scene-to-scene drift (e.g. wooden sign vs blackboard, morning vs midday). 30-80 words.",
          },
          React.createElement(TextArea, {
            value: worldBible,
            onChange: (e: any) => setWorldBible(e.target.value),
            placeholder:
              "Set design: wooden cottage-style fence; rough dirt paths; chalk-lettered wooden signs (NO blackboards); tomato plants always on the east side; morning sun upper-right; cottagecore palette — pastel greens, soft creams, gentle yellows; medium-wide camera at child eye-level.",
            rows: 3,
          }),
        ),
        React.createElement(
          Form.Item,
          {
            label:
              "Style directives (one per line — applied on top of every scene)",
            extra:
              "e.g. 'warm amber-rose palette', 'real-world physics, no floating objects', 'same time of day across consecutive scenes'. 5 max — more is noise.",
          },
          React.createElement(TextArea, {
            value: styleDirectives,
            onChange: (e: any) => setStyleDirectives(e.target.value),
            placeholder:
              "warm amber-rose palette, slight desaturation\nreal-world physics, no floating objects\nconsistent low-angle morning light across coastal scenes",
            rows: 3,
          }),
        ),
      ),

      status && !status.has_dashscope
        ? React.createElement(Alert, {
            type: "warning",
            message:
              "DASHSCOPE_API_KEY missing — decompose will fail. Set it under Environment Variables.",
            showIcon: true,
            style: { marginBottom: 12 },
          })
        : null,
      React.createElement(
        Form.Item,
        null,
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
    ),
  );
}

// ── beat sheet view: HITL gate between decompose (Pass 1) and craft (Pass 2) ──

/**
 * Live Pass-1 decompose stream. While the producer LLM drafts the beat
 * sheet, the backend streams the raw draft-in-progress over SSE
 * (decompose_progress events each carry the FULL accumulated text). We
 * render it growing in a scrolling mono panel — the user watches the
 * work happen instead of staring at an opaque spinner. Auto-scrolls to
 * the tail as text arrives.
 */
function LiveDecomposePanel({ show, text, streaming }: any) {
  const preRef = React.useRef<any>(null);
  React.useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);
  if (!show) return null;
  const chars = (text || "").length;
  return React.createElement(
    Card,
    {
      size: "small",
      style: { margin: "0 0 16px", borderRadius: 8, background: "#0b1021" },
      bodyStyle: { padding: 14 },
    },
    React.createElement(
      Space,
      { style: { marginBottom: 8 } },
      React.createElement(Spin, { size: "small" }),
      React.createElement(
        AntText,
        { style: { color: "#cdd3e1" }, strong: true },
        streaming ? "Producer is drafting the beat sheet…" : "Finishing up…",
      ),
      chars
        ? React.createElement(Tag, { color: "blue" }, `${chars} chars`)
        : null,
    ),
    React.createElement(
      "pre",
      {
        ref: preRef,
        style: {
          margin: 0,
          maxHeight: 220,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.5,
          color: "#9fb0d0",
        },
      },
      text || "Waiting for the model to start streaming…",
    ),
  );
}

function BeatSheetView({ draft, busy, activeStage, onCraft }: any) {
  const beats: any[] = draft.beats || [];
  const chars: any[] = draft.assets?.characters || [];
  const props: any[] = draft.assets?.props || [];
  const scene_refs: any[] = draft.assets?.scene_refs || [];
  const styleId = draft.assets?.style?.catalog_id;
  const isCrafting = busy && activeStage === "craft";

  // Locally-edited beats — copy out so user edits don't mutate the
  // server-returned draft directly. POSTed via onCraft on click.
  const [edited, setEdited] = React.useState<any[]>(beats);
  React.useEffect(() => {
    setEdited(beats);
  }, [draft.beats]);

  const updateBeat = (idx: number, patch: any) => {
    setEdited((prev) =>
      prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    );
  };
  const deleteBeat = (idx: number) => {
    setEdited((prev) => prev.filter((_, i) => i !== idx));
  };
  const moveBeat = (idx: number, dir: -1 | 1) => {
    setEdited((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };
  const addBeat = () => {
    setEdited((prev) => [
      ...prev,
      {
        name: `new_beat_${prev.length}`,
        summary: "",
        chars_used: [],
        props_used: [],
        setting_used: null,
        est_seconds: 8,
        has_narration: true,
      },
    ]);
  };

  const totalSeconds = edited.reduce(
    (s, b) => s + Number(b.est_seconds || 8),
    0,
  );

  return React.createElement(
    Card,
    {
      size: "small",
      title: React.createElement(
        Space,
        null,
        React.createElement(ScissorOutlined),
        "Beat sheet — review before crafting scenes",
      ),
      style: { marginTop: 16 },
      extra: React.createElement(Button, {
        type: "primary",
        loading: isCrafting,
        disabled: !edited.length,
        size: "large",
        icon: React.createElement(PlayCircleOutlined),
        onClick: () => onCraft(edited),
        children: `Craft ${edited.length} scene${
          edited.length === 1 ? "" : "s"
        }`,
      }),
    },
    // Anchor summary — small, since the next pass will show them in detail.
    React.createElement(
      Paragraph,
      { type: "secondary", style: { fontSize: 12 } },
      `Anchors locked: ${chars.length} character(s), ${props.length} prop(s), ${
        scene_refs.length
      } setting(s), style "${styleId || "?"}". `,
      `Total estimated runtime: ${totalSeconds}s across ${edited.length} beat(s).`,
    ),

    // Beat list — one row per beat, inline-editable.
    edited.length === 0
      ? React.createElement(Empty, {
          description: "No beats. Add one or re-decompose from the source.",
        })
      : React.createElement(
          Space,
          {
            direction: "vertical",
            size: 8,
            style: { width: "100%" },
          },
          ...edited.map((b, idx) =>
            React.createElement(
              Card,
              {
                key: idx,
                size: "small",
                bodyStyle: { padding: 12 },
                style: { background: "#fafafa" },
                title: React.createElement(
                  Space,
                  { size: 8 },
                  React.createElement(
                    AntText,
                    { strong: true, style: { fontSize: 13 } },
                    `Beat ${idx + 1}`,
                  ),
                  React.createElement(Input, {
                    size: "small",
                    value: b.name,
                    onChange: (e: any) =>
                      updateBeat(idx, { name: e.target.value }),
                    placeholder: "beat name (snake_case)",
                    style: { width: 240 },
                  }),
                ),
                extra: React.createElement(
                  Space,
                  { size: 2 },
                  React.createElement(
                    Tooltip,
                    { title: "Move up" },
                    React.createElement(Button, {
                      size: "small",
                      type: "text",
                      disabled: idx === 0,
                      icon: React.createElement(
                        AntText,
                        { style: { fontSize: 14 } },
                        "↑",
                      ),
                      onClick: () => moveBeat(idx, -1),
                    }),
                  ),
                  React.createElement(
                    Tooltip,
                    { title: "Move down" },
                    React.createElement(Button, {
                      size: "small",
                      type: "text",
                      disabled: idx === edited.length - 1,
                      icon: React.createElement(
                        AntText,
                        { style: { fontSize: 14 } },
                        "↓",
                      ),
                      onClick: () => moveBeat(idx, 1),
                    }),
                  ),
                  React.createElement(
                    Tooltip,
                    { title: "Delete beat" },
                    React.createElement(Button, {
                      size: "small",
                      type: "text",
                      danger: true,
                      icon: React.createElement(DeleteOutlined),
                      onClick: () => deleteBeat(idx),
                    }),
                  ),
                ),
              },
              // Summary: full-width textarea, the most important field.
              React.createElement(TextArea, {
                value: b.summary,
                onChange: (e: any) =>
                  updateBeat(idx, { summary: e.target.value }),
                placeholder:
                  "1-3 sentence summary of what happens in this beat",
                autoSize: { minRows: 2, maxRows: 5 },
                style: { marginBottom: 8 },
              }),
              // Anchors + duration in a row beneath the summary.
              React.createElement(
                Row,
                { gutter: 8, align: "middle" },
                React.createElement(
                  Col,
                  { span: 6 },
                  React.createElement(
                    AntText,
                    {
                      type: "secondary",
                      style: {
                        fontSize: 11,
                        display: "block",
                        marginBottom: 2,
                      },
                    },
                    "characters in this beat",
                  ),
                  React.createElement(Select, {
                    mode: "multiple",
                    allowClear: true,
                    placeholder: chars.length
                      ? "select characters"
                      : "(no characters defined)",
                    // Defensive: a string value would split into
                    // letter-tags under mode=multiple; always coerce to
                    // an array. (Belt-and-suspenders vs the data fix.)
                    value: Array.isArray(b.chars_used)
                      ? b.chars_used
                      : b.chars_used
                      ? [b.chars_used]
                      : [],
                    onChange: (v: any) => updateBeat(idx, { chars_used: v }),
                    options: chars.map((c: any) => ({
                      value: c.id,
                      label: c.id,
                      title: c.description || c.id,
                    })),
                    style: { width: "100%" },
                    disabled: !chars.length,
                  }),
                ),
                React.createElement(
                  Col,
                  { span: 6 },
                  React.createElement(
                    AntText,
                    {
                      type: "secondary",
                      style: {
                        fontSize: 11,
                        display: "block",
                        marginBottom: 2,
                      },
                    },
                    "props in this beat",
                  ),
                  React.createElement(Select, {
                    mode: "multiple",
                    allowClear: true,
                    placeholder: props.length
                      ? "select props"
                      : "(no props defined)",
                    value: Array.isArray(b.props_used)
                      ? b.props_used
                      : b.props_used
                      ? [b.props_used]
                      : [],
                    onChange: (v: any) => updateBeat(idx, { props_used: v }),
                    options: props.map((p: any) => ({
                      value: p.id,
                      label: p.id,
                      title: p.description || p.id,
                    })),
                    style: { width: "100%" },
                    disabled: !props.length,
                  }),
                ),
                React.createElement(
                  Col,
                  { span: 6 },
                  React.createElement(
                    AntText,
                    {
                      type: "secondary",
                      style: {
                        fontSize: 11,
                        display: "block",
                        marginBottom: 2,
                      },
                    },
                    "setting",
                  ),
                  React.createElement(Select, {
                    allowClear: true,
                    placeholder: scene_refs.length
                      ? "select setting"
                      : "(no settings defined)",
                    value: b.setting_used || undefined,
                    onChange: (v: any) =>
                      updateBeat(idx, { setting_used: v || null }),
                    options: scene_refs.map((r: any) => ({
                      value: r.id,
                      label: r.id,
                      title: r.description || r.id,
                    })),
                    style: { width: "100%" },
                    disabled: !scene_refs.length,
                  }),
                ),
                React.createElement(
                  Col,
                  { span: 3 },
                  React.createElement(
                    AntText,
                    {
                      type: "secondary",
                      style: {
                        fontSize: 11,
                        display: "block",
                        marginBottom: 2,
                      },
                    },
                    "duration (s)",
                  ),
                  React.createElement(InputNumber, {
                    min: 3,
                    max: 30,
                    value: b.est_seconds,
                    onChange: (v: any) =>
                      updateBeat(idx, { est_seconds: v ?? 8 }),
                    style: { width: "100%" },
                  }),
                ),
                React.createElement(
                  Col,
                  { span: 3 },
                  React.createElement(
                    AntText,
                    {
                      type: "secondary",
                      style: {
                        fontSize: 11,
                        display: "block",
                        marginBottom: 2,
                      },
                    },
                    "narration",
                  ),
                  React.createElement(antd.Switch, {
                    checked: !!b.has_narration,
                    onChange: (v: any) =>
                      updateBeat(idx, { has_narration: !!v }),
                  }),
                ),
              ),
            ),
          ),
        ),
    React.createElement(
      "div",
      { style: { marginTop: 12, textAlign: "center" } },
      React.createElement(Button, {
        size: "small",
        icon: React.createElement(PlusOutlined),
        onClick: addBeat,
        children: "Add beat",
      }),
    ),
    React.createElement(
      Paragraph,
      {
        type: "secondary",
        style: { fontSize: 11, marginTop: 16 },
      },
      "Crafting scenes from the beats is one LLM call per project — costs ~$0.05 in tokens. Beats can be re-edited and re-crafted as often as needed; existing per-scene refs/frames stay on disk.",
    ),
  );
}

// ── draft panel: YAML viewer + stage runners + ref/frame galleries ──

// Director chat: type a free-form instruction ("scene 1 at dusk, red
// jacket"), the backend translates it into per-scene spec patches and
// applies them. Spec-only — the transcript shows which scenes changed,
// and the user re-rolls those scenes (inline Re-roll) to render it.
function DirectorChat({ draft, onDirector }: any) {
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [log, setLog] = React.useState<any[]>([]);
  const [open, setOpen] = React.useState(true);
  if (!(draft?.scenes || []).length) return null;

  const send = async () => {
    const msg = input.trim();
    if (!msg || busy) return;
    setBusy(true);
    try {
      const r = await onDirector(msg);
      const changes = r?.changes || [];
      setLog((prev) => [
        ...prev,
        { message: msg, summary: r?.summary || "", changes },
      ]);
      setInput("");
      antMessage.success(
        changes.length
          ? `Updated ${changes.length} scene${
              changes.length > 1 ? "s" : ""
            } — re-roll to render.`
          : "No scenes changed.",
      );
    } catch (e: any) {
      antMessage.error(`Director failed: ${compactApiError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return React.createElement(
    Card,
    {
      size: "small",
      style: { marginBottom: 12, borderRadius: 8, borderColor: "#e6dcff" },
      headStyle: { background: "#faf7ff", minHeight: 44 },
      title: React.createElement(
        Space,
        { size: 6 },
        React.createElement(DirectorIcon, {
          style: { color: "#6d28d9", fontSize: 15 },
        }),
        React.createElement(AntText, { strong: true }, "Director"),
        React.createElement(
          AntText,
          { type: "secondary", style: { fontSize: 11, fontWeight: 400 } },
          "— describe a change in plain language",
        ),
      ),
      extra: React.createElement(Button, {
        size: "small",
        type: "text",
        onClick: () => setOpen((v) => !v),
        children: open ? "Hide" : "Show",
      }),
    },
    open
      ? React.createElement(
          "div",
          null,
          log.length
            ? React.createElement(
                "div",
                {
                  style: {
                    maxHeight: 220,
                    overflow: "auto",
                    marginBottom: 8,
                  },
                },
                ...log.map((entry: any, i: number) =>
                  React.createElement(
                    "div",
                    {
                      key: i,
                      style: {
                        marginBottom: 8,
                        paddingBottom: 8,
                        borderBottom: "1px dashed #f0f0f0",
                      },
                    },
                    React.createElement(
                      AntText,
                      { style: { fontSize: 12 } },
                      React.createElement(
                        "span",
                        { style: { color: "#7a5af0" } },
                        "› ",
                      ),
                      entry.message,
                    ),
                    React.createElement(
                      "div",
                      { style: { marginTop: 2 } },
                      React.createElement(
                        AntText,
                        { type: "secondary", style: { fontSize: 12 } },
                        entry.summary || "(no summary)",
                      ),
                    ),
                    entry.changes && entry.changes.length
                      ? React.createElement(
                          "div",
                          { style: { marginTop: 4 } },
                          ...entry.changes.map((c: any, j: number) =>
                            React.createElement(
                              Tooltip,
                              {
                                key: j,
                                title: `${(c.fields || []).join(", ")}${
                                  c.reason ? " — " + c.reason : ""
                                }`,
                              },
                              React.createElement(
                                Tag,
                                {
                                  color: "purple",
                                  style: { fontSize: 10, marginBottom: 2 },
                                },
                                `${c.scene_id}${c.name ? " " + c.name : ""}`,
                              ),
                            ),
                          ),
                        )
                      : React.createElement(
                          AntText,
                          { type: "secondary", style: { fontSize: 11 } },
                          "no scenes changed",
                        ),
                  ),
                ),
              )
            : null,
          React.createElement(TextArea, {
            value: input,
            onChange: (e: any) => setInput(e.target.value),
            onKeyDown: (e: any) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            },
            placeholder:
              'e.g. "make scene 1 at dusk and give the boy a red jacket"',
            autoSize: { minRows: 2, maxRows: 5 },
            disabled: busy,
            style: { fontSize: 12 },
          }),
          React.createElement(
            "div",
            {
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 6,
              },
            },
            React.createElement(
              AntText,
              { type: "secondary", style: { fontSize: 10 } },
              "Edits the spec only — re-roll affected scenes to render. " +
                "⌘/Ctrl+Enter to send.",
            ),
            React.createElement(Button, {
              type: "primary",
              size: "small",
              loading: busy,
              disabled: !input.trim(),
              onClick: () => void send(),
              children: "Send",
            }),
          ),
        )
      : null,
  );
}

// ═══════════════════════════════════════════════════════════════════
// "The Reel" — the Studio view. A self-assembling horizontal film strip
// that replaces the stage-by-stage accordion. Each scene is a living
// tile that climbs a maturity ladder (scripted → framed → in motion) as
// the existing SSE pipeline events land; you refine by TALKING to the
// Director bar, which patches the spec and auto-re-rolls only the
// affected scenes. Rides entirely on existing endpoints + the SSE bus.
// ═══════════════════════════════════════════════════════════════════

type ReelRunMode = "storyboard" | "animated" | "final";

interface ReelWorkflowState {
  sceneCount: number;
  requiredAnchors: number;
  readyAnchors: number;
  anchorsReady: boolean;
  nFramed: number;
  nMoving: number;
  staleClips: number;
  missingAnchors: number;
  missingFrames: number;
  missingMotion: number;
  missingFrameSceneIds: string[];
  staleClipSceneIds: string[];
  motionSceneIds: string[];
  narrationNeeded: number;
  narrationReady: boolean;
  hasFinal: boolean;
  finalReady: boolean;
  finalStale: boolean;
  readyForReview: boolean;
  primaryMode: ReelRunMode;
  primaryLabel: string;
  statusLine: string;
}

function stageAssets(projStatus: any, stage: string, key: string): any[] {
  return projStatus?.stages?.[stage]?.[key] ?? [];
}

function styleAnchorRequired(draft: any): boolean {
  const style = draft?.assets?.style;
  if (!style) return false;
  return Boolean(
    style.catalog_id ||
      style.reference_image ||
      style.positive_template ||
      style.negative_prompt,
  );
}

function sceneAssetBase(scene: any): string {
  return `${scene.id}_${scene.name}`;
}

function expectedFrameName(scene: any): string {
  return `${sceneAssetBase(scene)}_frame.png`;
}

function expectedShotName(scene: any): string {
  return `${sceneAssetBase(scene)}_raw.mp4`;
}

function expectedAudioName(scene: any): string {
  return `${sceneAssetBase(scene)}_narration.mp3`;
}

function assetMap(items: any[]): Map<string, any> {
  return new Map((items ?? []).map((r: any) => [r.name, r]));
}

function maxMtime(items: any[]): number {
  return Math.max(0, ...(items ?? []).map((r: any) => Number(r?.mtime) || 0));
}

function deriveReelWorkflowState(
  draft: any,
  projStatus: any,
): ReelWorkflowState {
  const scenes: any[] = draft?.scenes ?? [];
  const assets = draft?.assets ?? {};
  const frames = assetMap(stageAssets(projStatus, "2", "frames"));
  const shots = assetMap(stageAssets(projStatus, "3", "shots"));
  const audio = assetMap(stageAssets(projStatus, "1", "audio"));
  const finals = stageAssets(projStatus, "4", "final");

  const requiredAnchors =
    (assets.characters ?? []).length +
    (assets.props ?? []).length +
    (assets.scene_refs ?? []).length +
    (styleAnchorRequired(draft) ? 1 : 0);
  const readyAnchors = stageAssets(projStatus, "0", "refs").length;
  const anchorsReady = requiredAnchors === 0 || readyAnchors >= requiredAnchors;

  let nFramed = 0;
  let nMoving = 0;
  let staleClips = 0;
  const missingFrameSceneIds: string[] = [];
  const staleClipSceneIds: string[] = [];
  const motionSceneIds: string[] = [];
  for (const scene of scenes) {
    const frame = frames.get(expectedFrameName(scene));
    const shot = shots.get(expectedShotName(scene));
    if (frame) nFramed++;
    else missingFrameSceneIds.push(String(scene.id));
    if (frame && shot && Number(frame.mtime) > Number(shot.mtime)) {
      staleClips++;
      staleClipSceneIds.push(String(scene.id));
    } else if (frame && shot) {
      nMoving++;
    } else {
      motionSceneIds.push(String(scene.id));
    }
  }

  const narratedScenes = scenes.filter((s: any) => s.has_narration);
  const narrationNeeded = narratedScenes.length;
  const narrationDone = narratedScenes.filter((s: any) =>
    audio.has(expectedAudioName(s)),
  ).length;
  const narrationReady =
    narrationNeeded === 0 || narrationDone >= narrationNeeded;

  const missingAnchors = Math.max(0, requiredAnchors - readyAnchors);
  const missingFrames = Math.max(0, scenes.length - nFramed);
  const missingMotion = Math.max(0, scenes.length - nMoving);
  const inputMtime = Math.max(
    maxMtime(stageAssets(projStatus, "2", "frames")),
    maxMtime(stageAssets(projStatus, "3", "shots")),
    maxMtime(stageAssets(projStatus, "1", "audio")),
  );
  const finalMtime = maxMtime(finals);
  const hasFinal = Boolean(finals.length);
  const finalStale = Boolean(
    hasFinal &&
      ((inputMtime && inputMtime > finalMtime) ||
        missingFrames > 0 ||
        missingMotion > 0 ||
        staleClips > 0 ||
        !narrationReady),
  );
  const finalReady = Boolean(
    hasFinal &&
      !finalStale &&
      missingFrames === 0 &&
      missingMotion === 0 &&
      staleClips === 0 &&
      narrationReady,
  );
  const readyForReview = Boolean(
    scenes.length &&
      anchorsReady &&
      missingFrames === 0 &&
      missingMotion === 0 &&
      finalReady,
  );

  let primaryMode: ReelRunMode = "storyboard";
  let primaryLabel = "Shoot storyboard";
  if (scenes.length === 0) {
    primaryLabel = "Storyboard first";
  } else if (readyForReview) {
    primaryMode = "final";
    primaryLabel = "Final ready";
  } else if (!anchorsReady || missingFrames > 0) {
    primaryMode = "storyboard";
    primaryLabel = !anchorsReady
      ? "Prep & shoot storyboard"
      : "Shoot storyboard";
  } else if (staleClips > 0 || missingMotion > 0) {
    primaryMode = "animated";
    primaryLabel = staleClips > 0 ? "Refresh clips" : "Animate reel";
  } else if (!narrationReady || !finalReady) {
    primaryMode = "final";
    primaryLabel = finalStale ? "Refresh final cut" : "Assemble final cut";
  }

  const bits = [
    requiredAnchors > 0
      ? `${Math.min(readyAnchors, requiredAnchors)}/${requiredAnchors} anchors`
      : null,
    `${nFramed}/${scenes.length} framed`,
    `${nMoving}/${scenes.length} in motion`,
    staleClips > 0 ? `${staleClips} outdated` : null,
    narrationNeeded > 0 ? `${narrationDone}/${narrationNeeded} voiced` : null,
    finalReady ? "final ready" : finalStale ? "final outdated" : null,
  ].filter(Boolean);

  return {
    sceneCount: scenes.length,
    requiredAnchors,
    readyAnchors,
    anchorsReady,
    nFramed,
    nMoving,
    staleClips,
    missingAnchors,
    missingFrames,
    missingMotion,
    missingFrameSceneIds,
    staleClipSceneIds,
    motionSceneIds,
    narrationNeeded,
    narrationReady,
    hasFinal,
    finalReady,
    finalStale,
    readyForReview,
    primaryMode,
    primaryLabel,
    statusLine: bits.join(" · "),
  };
}

function reelModeCost(
  mode: ReelRunMode,
  workflow: ReelWorkflowState,
  forecast: CostForecast | null,
): string {
  if (!forecast) return "estimate unavailable";
  let cost = 0;
  if (workflow.missingAnchors > 0) {
    const forecastAnchors =
      (forecast.breakdown?.characters ?? 0) +
      (forecast.breakdown?.props ?? 0) +
      (forecast.breakdown?.scene_refs ?? 0) +
      1;
    cost +=
      (forecast.stage_0_usd || 0) *
      (workflow.missingAnchors / Math.max(1, forecastAnchors));
  }
  const sceneTotal = Math.max(
    1,
    forecast.breakdown?.scenes ?? workflow.sceneCount,
  );
  cost += (forecast.stage_2_usd || 0) * (workflow.missingFrames / sceneTotal);
  if (mode === "animated" || mode === "final") {
    cost += (forecast.stage_3_usd || 0) * (workflow.missingMotion / sceneTotal);
  }
  return `≈ $${cost.toFixed(2)}`;
}

function MaturityLadder({ framed, moving, running }: any) {
  const rungs = [
    { on: true, label: "scripted" },
    { on: framed, label: "framed" },
    { on: moving, label: "in motion" },
  ];
  return React.createElement(
    "div",
    { style: { display: "flex", gap: 3, marginTop: 7 } },
    ...rungs.map((r, i) =>
      React.createElement("div", {
        key: i,
        title: r.label,
        style: {
          flex: 1,
          height: 3,
          borderRadius: 2,
          background: r.on ? "#8b6dff" : "rgba(255,255,255,0.13)",
          boxShadow: running && r.on ? "0 0 7px #8b6dff" : "none",
          transition: "background .4s, box-shadow .4s",
        },
      }),
    ),
  );
}

function SceneTile({
  pid,
  scene,
  frameAsset,
  shotAsset,
  shotStale,
  live,
  selected,
  busyHere,
  onSelect,
  onReroll,
}: any) {
  const framed = Boolean(frameAsset);
  // A clip left over from a since-replaced frame isn't a real "in motion"
  // state — show it as needing a re-animate, not a playable clip.
  const moving = Boolean(shotAsset) && !shotStale;
  const stale = Boolean(shotAsset) && Boolean(shotStale);
  const running = busyHere || live?.state === "running";
  const failed = live?.state === "failed";
  const frameName = expectedFrameName(scene);
  const thumb = framed ? refUrl(pid, frameName, frameAsset?.size) : null;
  return React.createElement(
    "div",
    {
      onClick: () => onSelect(scene.id),
      style: {
        flex: "0 0 176px",
        cursor: "pointer",
        borderRadius: 10,
        overflow: "hidden",
        border: selected
          ? "2px solid #8b6dff"
          : "2px solid rgba(255,255,255,0.06)",
        background: "#161a27",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          position: "relative",
          width: "100%",
          height: 112,
          background: thumb
            ? "#000"
            : "linear-gradient(135deg,#222a40,#12141f)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        },
      },
      thumb
        ? React.createElement("img", {
            src: thumb,
            style: {
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: running ? "saturate(.45) blur(1px)" : "none",
              transition: "filter .6s",
            },
          })
        : React.createElement(
            "div",
            {
              style: {
                color: "#7d88a6",
                fontSize: 10,
                lineHeight: 1.4,
                padding: 10,
                textAlign: "center",
              },
            },
            String(scene.scene_description || scene.name || "").slice(0, 90),
          ),
      moving
        ? React.createElement(
            Tag,
            {
              color: "blue",
              style: {
                position: "absolute",
                top: 6,
                left: 6,
                margin: 0,
                fontSize: 9,
              },
            },
            "▶ clip",
          )
        : null,
      stale
        ? React.createElement(
            Tooltip,
            { title: "The frame changed — re-animate to refresh the clip" },
            React.createElement(
              Tag,
              {
                color: "orange",
                style: {
                  position: "absolute",
                  top: 6,
                  left: 6,
                  margin: 0,
                  fontSize: 9,
                },
              },
              "⟳ clip outdated",
            ),
          )
        : null,
      running
        ? React.createElement(
            Tag,
            {
              color: "processing",
              style: {
                position: "absolute",
                top: 6,
                right: 6,
                margin: 0,
                fontSize: 9,
              },
            },
            "● working",
          )
        : null,
      failed
        ? React.createElement(
            Tag,
            {
              color: "red",
              style: {
                position: "absolute",
                top: 6,
                right: 6,
                margin: 0,
                fontSize: 9,
              },
            },
            "failed",
          )
        : null,
    ),
    React.createElement(
      "div",
      { style: { padding: "7px 9px 9px" } },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 6,
          },
        },
        React.createElement(
          AntText,
          {
            style: {
              color: "#dfe4f1",
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            },
          },
          `${scene.id} · ${scene.name}`,
        ),
        React.createElement(
          AntText,
          { style: { color: "#6f7a96", fontSize: 10 } },
          `${scene.duration || 8}s`,
        ),
      ),
      React.createElement(MaturityLadder, { framed, moving, running }),
      React.createElement(
        Tooltip,
        { title: "Re-shoot this scene" },
        React.createElement(Button, {
          size: "small",
          type: "text",
          loading: running,
          icon: React.createElement(ReloadOutlined),
          onClick: (e: any) => {
            e.stopPropagation();
            onReroll(scene.id);
          },
          style: { color: "#9aa6c4", padding: "0 4px", marginTop: 4 },
          children: framed ? "Re-shoot" : "Shoot",
        }),
      ),
    ),
  );
}

function ReelContinuityRail({
  draft,
  scene,
  open,
  onToggle,
  onChangeState,
}: any) {
  if (!scene) return null;
  const groups = continuityGroupsForScene(draft, scene);
  const hasActiveState = groups.some((g: any) => (g.states || []).length);
  const activeStateCount = groups.reduce(
    (total: number, group: any) => total + (group.states || []).length,
    0,
  );
  const summary = groups.length
    ? `${groups.length} tracked · ${
        activeStateCount > 0 ? `${activeStateCount} active` : "canonical"
      }`
    : "No scene anchors";
  return React.createElement(
    "div",
    {
      style: {
        border: "1px solid #283147",
        background: "#111722",
        borderRadius: 10,
        padding: 12,
        marginBottom: 14,
      },
    },
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: open && groups.length ? 10 : 0,
        },
      },
      React.createElement(
        Space,
        { size: 8 },
        React.createElement(
          AntText,
          { style: { color: "#f3f4f6", fontWeight: 700 } },
          "Continuity",
        ),
        React.createElement(
          Tag,
          {
            color: hasActiveState ? "success" : "default",
            style: { margin: 0 },
          },
          hasActiveState ? "state visible" : "canonical",
        ),
        React.createElement(
          AntText,
          { style: { color: "#68748d", fontSize: 12 } },
          summary,
        ),
      ),
      React.createElement(
        Space,
        { size: 8 },
        React.createElement(Button, {
          size: "small",
          type: "text",
          onClick: onToggle,
          style: { color: "#9aa4bf", fontWeight: 700 },
          children: open ? "Hide details" : "Details",
        }),
        React.createElement(Button, {
          size: "small",
          onClick: onChangeState,
          style: {
            borderColor: "#f97316",
            color: "#ffb072",
            background: "rgba(249,115,22,0.08)",
          },
          children: "Change state from here",
        }),
      ),
    ),
    open && groups.length
      ? React.createElement(
          "div",
          { style: { display: "grid", gap: 8 } },
          ...groups.map((group: any) =>
            React.createElement(
              "div",
              {
                key: group.entity.id,
                style: {
                  display: "grid",
                  gridTemplateColumns: "116px minmax(0, 1fr)",
                  gap: 10,
                  alignItems: "start",
                  minWidth: 0,
                },
              },
              React.createElement(
                "div",
                { style: { minWidth: 0 } },
                React.createElement(
                  AntText,
                  {
                    style: {
                      color: "#dfe4f1",
                      display: "block",
                      fontSize: 12,
                      fontWeight: 700,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    },
                    title: group.entity.id,
                  },
                  group.entity.label || group.entity.id,
                ),
                React.createElement(
                  AntText,
                  { style: { color: "#68748d", fontSize: 10 } },
                  continuityEntityKindLabel(group.entity.kind),
                ),
              ),
              React.createElement(
                "div",
                {
                  style: {
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    minWidth: 0,
                  },
                },
                ...((group.states || []).length
                  ? (group.states || []).map((state: any) =>
                      React.createElement(
                        Tag,
                        {
                          key: state.id,
                          color: "orange",
                          style: {
                            margin: 0,
                            maxWidth: "100%",
                            whiteSpace: "normal",
                            overflowWrap: "anywhere",
                          },
                        },
                        state.title || state.id,
                      ),
                    )
                  : [
                      React.createElement(
                        Tag,
                        {
                          key: "canonical",
                          style: { margin: 0, color: "#8791a8" },
                        },
                        "canonical state",
                      ),
                    ]),
              ),
            ),
          ),
        )
      : open
      ? React.createElement(
          AntText,
          { style: { color: "#68748d", fontSize: 12 } },
          "No referenced character, prop, or setting on this scene yet.",
        )
      : null,
  );
}

function sceneSpanLabel(scenes: any[]): string {
  const ids = scenes.map(sceneIdOf).filter(Boolean);
  if (!ids.length) return "no scenes";
  if (ids.length <= 5) return ids.join(", ");
  return `${ids.slice(0, 3).join(", ")} +${ids.length - 3} more`;
}

function continuityEntityDisplayName(draft: any, entityId: string): string {
  const entity = draftContinuityEntities(draft).find(
    (e: any) => e.id === entityId,
  );
  return entity?.label || humanizeId(entityId) || entityId;
}

function continuityCurrentStateLabel(draft: any, change: any): string {
  const active = activeStatesForChange(
    draft?.state_changes || [],
    String(change?.entity || ""),
    String(change?.at_scene || ""),
  );
  if (!active.length) return "canonical";
  return compactText(
    active
      .map((state: any) => state.title || state.id)
      .filter(Boolean)
      .join(", "),
    42,
  );
}

function StateChangePreviewCard({
  draft,
  change,
  affectedScenes,
  entityOptions,
  sceneOptions,
  adjustOpen,
  saving,
  hasFinal,
  onPatch,
  onApply,
  onCancel,
  onSceneOnly,
  onToggleAdjust,
}: any) {
  if (!change) return null;
  const entity = String(change.entity || "");
  const title = String(change.title || "").trim();
  const content = String(change.content || "").trim();
  const entityLabel = continuityEntityDisplayName(draft, entity);
  const before = continuityCurrentStateLabel(draft, change);
  const after = compactText(title || content || "new state", 46);
  const affectedLabel = sceneSpanLabel(affectedScenes || []);
  const affectedCount = (affectedScenes || []).length;
  const canApply = Boolean(entity && change.at_scene && title && content);
  const planLine = affectedCount
    ? `Affects ${affectedLabel} · re-shoots frames + motion${
        hasFinal ? " · final cut will need refresh" : ""
      }`
    : "No downstream scene references this entity yet.";

  return React.createElement(
    "div",
    {
      style: {
        marginTop: 10,
        border: "1px solid rgba(249,115,22,0.35)",
        borderLeft: "4px solid #f97316",
        background: "#111722",
        borderRadius: 10,
        padding: "10px 12px",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: 12,
          alignItems: "start",
        },
      },
      React.createElement(
        "div",
        { style: { minWidth: 0 } },
        React.createElement(
          AntText,
          {
            style: {
              color: "#fed7aa",
              display: "block",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.2,
              textTransform: "uppercase",
            },
          },
          "State change preview",
        ),
        React.createElement(
          AntText,
          {
            style: {
              color: "#f8fafc",
              display: "block",
              fontSize: 14,
              fontWeight: 800,
              marginTop: 3,
              overflowWrap: "anywhere",
            },
          },
          `${entityLabel} · ${before} → ${after}`,
        ),
        React.createElement(
          AntText,
          {
            style: {
              color: affectedCount ? "#aeb6cc" : "#fbbf24",
              display: "block",
              fontSize: 12,
              marginTop: 4,
              overflowWrap: "anywhere",
            },
          },
          planLine,
        ),
      ),
      React.createElement(
        Space,
        { size: 8, wrap: true, style: { justifyContent: "flex-end" } },
        React.createElement(Button, {
          size: "small",
          type: "text",
          onClick: onCancel,
          style: { color: "#9aa4bf" },
          children: "Cancel",
        }),
        React.createElement(Button, {
          size: "small",
          onClick: onToggleAdjust,
          style: {
            background: "#151b28",
            borderColor: "#334155",
            color: "#dbeafe",
          },
          children: adjustOpen ? "Hide options" : "Adjust scope",
        }),
        React.createElement(Button, {
          size: "small",
          type: "primary",
          loading: saving,
          disabled: !canApply || !affectedCount,
          onClick: onApply,
          style: { background: "#f97316" },
          children: "Apply change",
        }),
      ),
    ),
    adjustOpen
      ? React.createElement(
          "div",
          {
            style: {
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid rgba(148,163,184,0.22)",
            },
          },
          React.createElement(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "minmax(180px, 1fr) minmax(160px, 0.75fr)",
                gap: 10,
              },
            },
            React.createElement(
              Form.Item,
              {
                label: React.createElement(
                  AntText,
                  { style: { color: "#cbd5e1" } },
                  "Entity",
                ),
                style: { marginBottom: 10 },
              },
              React.createElement(Select, {
                value: change.entity,
                options: entityOptions,
                showSearch: true,
                optionFilterProp: "label",
                style: { width: "100%" },
                onChange: (entity: string) => onPatch({ entity }),
              }),
            ),
            React.createElement(
              Form.Item,
              {
                label: React.createElement(
                  AntText,
                  { style: { color: "#cbd5e1" } },
                  "Starts",
                ),
                style: { marginBottom: 10 },
              },
              React.createElement(Select, {
                value: change.at_scene,
                options: sceneOptions,
                showSearch: true,
                optionFilterProp: "label",
                style: { width: "100%" },
                onChange: (at_scene: string) => onPatch({ at_scene }),
              }),
            ),
          ),
          React.createElement(
            Form.Item,
            {
              label: React.createElement(
                AntText,
                { style: { color: "#cbd5e1" } },
                "State label",
              ),
              style: { marginBottom: 10 },
            },
            React.createElement(Input, {
              value: change.title,
              placeholder: "carrying blue umbrella",
              onChange: (e: any) => onPatch({ title: e.target.value }),
            }),
          ),
          React.createElement(
            Form.Item,
            {
              label: React.createElement(
                AntText,
                { style: { color: "#cbd5e1" } },
                "Prompt fact",
              ),
              style: { marginBottom: 10 },
            },
            React.createElement(TextArea, {
              rows: 2,
              value: change.content,
              placeholder:
                "Lin Hao carries a blue umbrella in every referenced scene.",
              onChange: (e: any) =>
                onPatch({ content: e.target.value, note: e.target.value }),
            }),
          ),
          React.createElement(
            "div",
            {
              style: {
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "center",
              },
            },
            React.createElement(
              AntText,
              { style: { color: "#6f7a96", fontSize: 11 } },
              affectedCount
                ? `${affectedCount} scene${
                    affectedCount === 1 ? "" : "s"
                  } will be re-rendered.`
                : "Pick an entity used by later scenes to create a carry-forward state.",
            ),
            React.createElement(Button, {
              size: "small",
              onClick: onSceneOnly,
              disabled: saving,
              children: "Make scene-only edit",
            }),
          ),
        )
      : null,
  );
}

function ReelView({
  pid,
  draft,
  projStatus,
  liveProgress,
  forecast,
  busy,
  activeStage,
  pendingSceneRun,
  onRunStage,
  onRunOne,
  onRunStageAllParallel,
  onRerollScenes,
  onRerollScenesFull,
  onDirector,
  onSaveDraft,
  onCancel,
  onSwitchClassic,
}: any) {
  const scenes: any[] = draft.scenes || [];
  const [selectedId, setSelectedId] = React.useState<string>(
    scenes[0]?.id ?? "",
  );
  const [note, setNote] = React.useState("");
  const [directing, setDirecting] = React.useState(false);
  const [log, setLog] = React.useState<any[]>([]);
  const [budgetOpen, setBudgetOpen] = React.useState(false);
  const [focusDirectorAfterBudget, setFocusDirectorAfterBudget] =
    React.useState(false);
  const [readyOverrideConfirm, setReadyOverrideConfirm] = React.useState(false);
  const [rendering, setRendering] = React.useState(false);
  const [continuityDraft, setContinuityDraft] = React.useState<any>(null);
  const [continuityOpen, setContinuityOpen] = React.useState(false);
  const [continuityAdjustOpen, setContinuityAdjustOpen] = React.useState(false);
  const [continuitySaving, setContinuitySaving] = React.useState(false);
  // Director scope: "scene" targets the selected tile (default — click a
  // tile, talk to it); "film" lets one instruction touch the whole story.
  const [scope, setScope] = React.useState<"scene" | "film">("scene");
  // Voice input: dictate the instruction. Web Speech API where available
  // (Chrome/Edge/Safari); the mic just hides where it isn't.
  const [listening, setListening] = React.useState(false);
  const recogRef = React.useRef<any>(null);
  const directorInputRef = React.useRef<any>(null);
  const SpeechRec =
    typeof window !== "undefined"
      ? (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition
      : null;
  const speechSupported = !!SpeechRec;
  React.useEffect(() => {
    if (looksLikeContinuityIntent(note)) setContinuityOpen(true);
  }, [note]);
  React.useEffect(() => {
    if (budgetOpen || !focusDirectorAfterBudget) return undefined;
    const timer = window.setTimeout(() => {
      const target = directorInputRef.current;
      if (target?.focus) target.focus();
      else target?.input?.focus?.();
      setFocusDirectorAfterBudget(false);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [budgetOpen, focusDirectorAfterBudget]);

  const workflow = React.useMemo(
    () => deriveReelWorkflowState(draft, projStatus),
    [draft, projStatus],
  );
  const uniqSceneIds = (...groups: string[][]): string[] =>
    Array.from(new Set(groups.flat().filter(Boolean)));
  const storyboardSceneIds = workflow.missingFrameSceneIds;
  const animationSceneIds = uniqSceneIds(
    workflow.motionSceneIds,
    workflow.staleClipSceneIds,
    workflow.missingFrameSceneIds,
  );
  const hasStoryboardWork =
    workflow.missingAnchors > 0 || workflow.missingFrames > 0;
  const hasAnimationWork =
    workflow.missingFrames > 0 ||
    workflow.missingMotion > 0 ||
    workflow.staleClips > 0;
  const hasFinalWork =
    hasAnimationWork ||
    !workflow.narrationReady ||
    !workflow.finalReady ||
    workflow.finalStale;
  const closeBudget = () => {
    setReadyOverrideConfirm(false);
    setBudgetOpen(false);
  };

  // Budget gate: run the user's intent, while the Reel decides the needed
  // production stages. Storyboard = anchors + frames. Animated adds motion.
  // Final cut also creates narration when needed and assembles Stage 4.
  const renderFilm = async (mode: ReelRunMode) => {
    closeBudget();
    setRendering(true);
    try {
      if (
        mode === "final" &&
        workflow.narrationNeeded &&
        !workflow.narrationReady
      ) {
        await onRunStage?.("1");
      }
      if (!workflow.anchorsReady && workflow.requiredAnchors > 0) {
        await onRunStage?.("0");
      }

      if (storyboardSceneIds.length) {
        const r2 = await onRunStageAllParallel?.(
          "2",
          false,
          storyboardSceneIds,
        );
        // Don't roll into pricier downstream work if the user hit Stop or if
        // frame generation failed; a partial storyboard needs review first.
        if (r2?.cancelled || r2?.failed) return;
      }

      if (mode === "animated" || mode === "final") {
        if (animationSceneIds.length) {
          const r3 = await onRunStageAllParallel?.(
            "3",
            workflow.staleClipSceneIds.length > 0 ||
              workflow.missingFrameSceneIds.length > 0,
            animationSceneIds,
          );
          if (r3?.cancelled || r3?.failed) return;
        }
      }

      if (mode === "final") {
        await onRunStage?.("4", { overwrite: workflow.finalStale });
      }
    } finally {
      setRendering(false);
    }
  };
  const tweakReadyCut = () => {
    setFocusDirectorAfterBudget(true);
    closeBudget();
  };
  const rebuildReadyCut = async () => {
    closeBudget();
    setRendering(true);
    try {
      await onRunStage?.("4", { overwrite: true });
    } finally {
      setRendering(false);
    }
  };

  const frames = assetMap(stageAssets(projStatus, "2", "frames"));
  const shots = assetMap(stageAssets(projStatus, "3", "shots"));
  const assetFor = (s: any) => {
    const frame = frames.get(expectedFrameName(s));
    const shot = shots.get(expectedShotName(s));
    // A motion clip is animated FROM a frame; if the frame was re-shot
    // afterwards (newer mtime) the clip no longer matches it — treat it
    // as stale so we don't play/flaunt an outdated video.
    const shotStale = Boolean(
      frame && shot && frame.mtime && shot.mtime && frame.mtime > shot.mtime,
    );
    return { frame, shot, shotStale };
  };

  const live = liveProgress || {};

  const selected = scenes.find((s) => s.id === selectedId) || scenes[0];
  const selAsset = selected
    ? assetFor(selected)
    : { frame: null, shot: null, shotStale: false };
  const continuityN = continuityChangeCount(draft);
  const reelStatusLine = [
    workflow.statusLine,
    continuityN > 0
      ? `${continuityN} continuity change${continuityN === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const continuityEntities = draftContinuityEntities(draft);
  const continuityEntityOptions = continuityEntities.map((e: any) => ({
    value: e.id,
    label: `${continuityEntityKindLabel(e.kind)}: ${e.id}`,
  }));
  const continuitySceneOptions = scenes
    .map((scene: any) => ({
      value: sceneIdOf(scene),
      label: sceneLabel(scene),
    }))
    .filter((option: any) => option.value);
  const affectedContinuityScenes = continuityDraft
    ? affectedScenesForContinuityChange(
        draft,
        continuityDraft.entity,
        continuityDraft.at_scene,
      )
    : [];
  const closeContinuityDraft = () => {
    setContinuityDraft(null);
    setContinuityAdjustOpen(false);
  };
  const patchContinuityDraft = (patch: any) =>
    setContinuityDraft((cur: any) => (cur ? { ...cur, ...patch } : cur));

  const toggleMic = () => {
    if (!speechSupported) return;
    if (listening) {
      try {
        recogRef.current && recogRef.current.stop();
      } catch {
        /* ignore */
      }
      return;
    }
    let rec: any;
    try {
      rec = new SpeechRec();
    } catch {
      return;
    }
    rec.interimResults = true;
    rec.continuous = false;
    // Keep anything already typed; dictation appends to it.
    const base = note ? note.replace(/\s+$/, "") + " " : "";
    rec.onresult = (ev: any) => {
      let txt = "";
      for (let i = 0; i < ev.results.length; i++) {
        txt += ev.results[i][0].transcript;
      }
      setNote(base + txt);
    };
    rec.onend = () => {
      setListening(false);
      recogRef.current = null;
    };
    rec.onerror = () => {
      setListening(false);
      recogRef.current = null;
    };
    recogRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
      recogRef.current = null;
    }
  };

  const openContinuityDraft = (instruction: string = "") => {
    setContinuityOpen(true);
    setContinuityAdjustOpen(false);
    if (!selected) {
      antMessage.warning("Pick a scene first.");
      return;
    }
    const entity = preferredContinuityEntity(draft, selected, instruction);
    if (!entity) {
      antMessage.warning(
        "Add or reference a character, prop, or setting before changing state.",
      );
      return;
    }
    const title = stateTitleFromInstruction(instruction);
    const content = title || instruction.trim();
    setContinuityDraft({
      entity,
      at_scene: sceneIdOf(selected),
      title,
      content,
      note: instruction.trim(),
    });
  };

  const applyContinuityDraft = async () => {
    if (!continuityDraft || continuitySaving) return;
    if (!onSaveDraft) {
      antMessage.warning("State changes are unavailable in this view.");
      return;
    }
    const entity = String(continuityDraft.entity || "").trim();
    const atScene = String(continuityDraft.at_scene || "").trim();
    const title = String(continuityDraft.title || "").trim();
    const content = String(continuityDraft.content || "").trim();
    if (!entity || !atScene || !title || !content) {
      antMessage.warning(
        "Entity, start scene, title, and prompt are required.",
      );
      return;
    }
    const affectedIds = affectedContinuityScenes
      .map((scene: any) => sceneIdOf(scene))
      .filter(Boolean);
    if (!affectedIds.length) {
      antMessage.warning(
        "No downstream scenes reference that entity. Add it to a scene first.",
      );
      return;
    }
    setContinuitySaving(true);
    try {
      const change = {
        entity,
        at_scene: atScene,
        add: [
          {
            id: slugStateId(title),
            title,
            content,
          },
        ],
        remove: [],
        reset: false,
        note: String(continuityDraft.note || content).trim(),
      };
      const nextDraft = JSON.parse(JSON.stringify(draft));
      nextDraft.state_changes = [...(nextDraft.state_changes || []), change];
      await onSaveDraft?.(nextDraft, { quiet: true });
      closeContinuityDraft();
      setNote("");
      setLog((p) => [
        ...p,
        {
          msg: content,
          summary: `Added ongoing state for ${entity}; re-rendering ${
            affectedIds.length
          } affected scene${affectedIds.length === 1 ? "" : "s"}.`,
          changes: affectedIds.map((sceneId: string) => ({
            scene_id: sceneId,
          })),
        },
      ]);
      if (onRerollScenesFull) await onRerollScenesFull(affectedIds);
      else if (onRerollScenes) await onRerollScenes(affectedIds);
      else for (const id of affectedIds) await onRunOne(id);
      antMessage.success(
        `Continuity saved; re-rendering ${affectedIds.length} affected scene${
          affectedIds.length === 1 ? "" : "s"
        }.`,
      );
    } catch (e: any) {
      antMessage.error(`Continuity update failed: ${compactApiError(e)}`);
    } finally {
      setContinuitySaving(false);
    }
  };

  const direct = async (bypassContinuity: boolean = false) => {
    const msg = note.trim();
    if (!msg || directing) return;
    if (
      !bypassContinuity &&
      scope === "scene" &&
      selected &&
      continuityEntities.length &&
      looksLikeContinuityIntent(msg)
    ) {
      openContinuityDraft(msg);
      return;
    }
    setDirecting(true);
    try {
      // Scene-scoped by default: focus the instruction on the selected
      // tile so the user can just talk to "this scene". Still lets them
      // name another scene explicitly (the model honours that over the
      // focus hint). "Whole film" scope sends the message unscoped.
      const sel = scenes.find((s) => s.id === selectedId);
      const scoped =
        scope === "scene" && sel
          ? `Focus on scene ${sel.id} (${sel.name}). If I do not name a ` +
            `different scene, apply this only to scene ${sel.id}. ` +
            `Instruction: ${msg}`
          : msg;
      const r = await onDirector(scoped);
      const changes = r?.changes || [];
      setLog((p) => [...p, { msg, summary: r?.summary || "", changes }]);
      setNote("");
      // Auto-chain the render the user used to do by hand. ONE coordinated
      // run so busy/Stop stay coherent across a multi-scene edit. Per the
      // chosen behaviour, a Director edit re-shoots the frame AND
      // re-animates the motion so the playing clip stays in sync.
      const changedIds = changes.map((c: any) => c.scene_id).filter(Boolean);
      if (changedIds.length) {
        if (onRerollScenesFull) onRerollScenesFull(changedIds);
        else if (onRerollScenes) onRerollScenes(changedIds);
        else for (const id of changedIds) onRunOne(id);
      }
      antMessage.success(
        changes.length
          ? `Re-rendering ${changes.length} scene${
              changes.length > 1 ? "s" : ""
            } (frame + motion)…`
          : "No scenes changed.",
      );
    } catch (e: any) {
      antMessage.error(`Director failed: ${compactApiError(e)}`);
    } finally {
      setDirecting(false);
    }
  };

  const unit = (count: number, singular: string, plural?: string) =>
    `${count} ${count === 1 ? singular : plural || `${singular}s`}`;
  const joinList = (parts: Array<string | null>) => {
    const xs = parts.filter(Boolean) as string[];
    if (xs.length <= 1) return xs.join("");
    if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
    return `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`;
  };
  const compactList = (parts: Array<string | null>) =>
    (parts.filter(Boolean) as string[]).join(", ");
  const createStep = (parts: Array<string | null>) => {
    const xs = parts.filter(Boolean);
    return xs.length ? `Create ${compactList(xs)}` : null;
  };
  const lowerFirst = (text: string | null) =>
    text ? text.charAt(0).toLowerCase() + text.slice(1) : null;
  const joinSteps = (steps: Array<string | null>) =>
    (steps.filter(Boolean) as string[])
      .map((step, index) => (index === 0 ? step : lowerFirst(step)))
      .join(", then ");
  const storyboardUnits = [
    workflow.missingAnchors > 0
      ? unit(workflow.missingAnchors, "anchor")
      : null,
    workflow.missingFrames > 0 ? unit(workflow.missingFrames, "frame") : null,
  ];
  const storyboardDetail = `Create ${joinList(storyboardUnits)}`;
  const motionDetail =
    workflow.staleClips > 0 && workflow.missingMotion > workflow.staleClips
      ? `Create or refresh ${unit(workflow.missingMotion, "motion clip")}`
      : workflow.staleClips > 0
      ? `Refresh ${unit(workflow.staleClips, "outdated clip")}`
      : workflow.missingMotion > 0
      ? `Create ${unit(workflow.missingMotion, "motion clip")}`
      : null;
  const animatedDetail = joinSteps([createStep(storyboardUnits), motionDetail]);
  const hasFinalPrepWork = hasAnimationWork || !workflow.narrationReady;
  const finalCutAction = !workflow.hasFinal
    ? `${hasFinalPrepWork ? "assemble" : "Assemble"} final cut`
    : workflow.finalStale
    ? `${hasFinalPrepWork ? "refresh" : "Refresh"} final cut`
    : !workflow.finalReady
    ? `${hasFinalPrepWork ? "assemble" : "Assemble"} final cut`
    : null;
  const finalCreateUnits = [
    !workflow.narrationReady ? "narration" : null,
    ...storyboardUnits,
  ];
  const finalDetail = joinSteps([
    createStep(finalCreateUnits),
    motionDetail,
    finalCutAction,
  ]);
  const modeButton = (mode: ReelRunMode, label: string, detail: string) => {
    const selected = workflow.primaryMode === mode;
    const estimate = reelModeCost(mode, workflow, forecast);
    const estimateUnavailable = !forecast;
    return React.createElement("button", {
      type: "button",
      onClick: () => void renderFilm(mode),
      style: {
        width: "100%",
        minHeight: 74,
        padding: "14px 18px",
        borderRadius: 10,
        border: selected ? "1px solid #f97316" : "1px solid #e6e8ec",
        background: selected ? "#fff7ed" : "#ffffff",
        boxShadow: selected ? "inset 4px 0 0 #f97316" : "none",
        cursor: "pointer",
        textAlign: "left",
        font: "inherit",
      },
      children: React.createElement(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            alignItems: "start",
            gap: 16,
          },
        },
        React.createElement(
          "div",
          { style: { minWidth: 0 } },
          React.createElement(
            "strong",
            {
              style: {
                color: "#1f2328",
                display: "block",
                fontSize: 17,
                lineHeight: 1.25,
              },
            },
            label,
          ),
          React.createElement(
            "span",
            {
              style: {
                color: "#6b7280",
                display: "block",
                fontSize: 13,
                lineHeight: 1.35,
                marginTop: 5,
                overflowWrap: "anywhere",
                whiteSpace: "normal",
              },
            },
            detail,
          ),
        ),
        React.createElement(
          "span",
          {
            style: {
              color: "#1f2328",
              fontSize: estimateUnavailable ? 14 : 17,
              fontWeight: 700,
              lineHeight: 1.25,
              whiteSpace: "nowrap",
            },
          },
          estimate,
        ),
      ),
    });
  };
  const modeButtons = [
    hasStoryboardWork
      ? modeButton("storyboard", "Storyboard draft", storyboardDetail)
      : null,
    hasAnimationWork
      ? modeButton("animated", "Animated reel", animatedDetail)
      : null,
    hasFinalWork ? modeButton("final", "Final cut", finalDetail) : null,
  ].filter(Boolean);

  return React.createElement(
    "div",
    {
      style: {
        background: "#0d1018",
        borderRadius: 12,
        padding: 18,
        color: "#dfe4f1",
      },
    },
    // ── header: title + progress + roll-all + classic toggle ──
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 14,
        },
      },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 11,
            minWidth: 0,
            flexWrap: "wrap",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              color: "#f8fafc",
              flex: "0 0 auto",
            },
          },
          React.createElement(
            "span",
            {
              style: {
                width: 26,
                height: 26,
                borderRadius: 8,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(249, 115, 22, 0.14)",
                border: "1px solid rgba(249, 115, 22, 0.35)",
                color: "#fb923c",
                fontSize: 15,
                flex: "0 0 auto",
              },
            },
            React.createElement(ReelHeaderIcon),
          ),
          React.createElement(
            "span",
            {
              style: {
                fontSize: 18,
                fontWeight: 800,
                letterSpacing: 0,
                lineHeight: 1,
              },
            },
            "The Reel",
          ),
        ),
        React.createElement(
          AntText,
          {
            style: {
              color: "#9aa4bf",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0,
              lineHeight: 1.4,
            },
          },
          reelStatusLine,
        ),
      ),
      React.createElement(
        Space,
        { size: 8 },
        rendering || (busy && (activeStage === "2" || activeStage === "3"))
          ? React.createElement(Button, {
              danger: true,
              onClick: onCancel,
              children: "■ Stop",
            })
          : null,
        React.createElement(Button, {
          type: "primary",
          ghost: true,
          loading:
            (busy && (activeStage === "2" || activeStage === "3")) || rendering,
          disabled: !scenes.length,
          onClick: () => {
            setReadyOverrideConfirm(false);
            setBudgetOpen(true);
          },
          children: React.createElement(
            "span",
            {
              style: {
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                letterSpacing: 0,
              },
            },
            workflow.primaryLabel,
            React.createElement(ForwardIcon, { style: { fontSize: 12 } }),
          ),
        }),
        React.createElement(Button, {
          size: "small",
          icon: React.createElement(OpenClassicIcon),
          onClick: onSwitchClassic,
          style: {
            background: "#151b28",
            borderColor: "#2b3448",
            color: "#aeb6cc",
            fontWeight: 700,
            letterSpacing: 0,
          },
          children: "Classic editor",
        }),
      ),
    ),
    // ── hero: the selected scene, big ──
    selected
      ? React.createElement(
          "div",
          {
            style: {
              borderRadius: 10,
              overflow: "hidden",
              background: "#000",
              marginBottom: 14,
              maxHeight: 360,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            },
          },
          selAsset.shot && !selAsset.shotStale
            ? React.createElement("video", {
                src: refUrl(pid, expectedShotName(selected)),
                controls: true,
                style: { width: "100%", maxHeight: 360 },
              })
            : selAsset.frame
            ? React.createElement("img", {
                src: refUrl(
                  pid,
                  expectedFrameName(selected),
                  selAsset.frame?.size,
                ),
                style: { width: "100%", maxHeight: 360, objectFit: "contain" },
              })
            : React.createElement(
                "div",
                {
                  style: {
                    height: 200,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#7d88a6",
                    padding: 20,
                    textAlign: "center",
                  },
                },
                String(
                  selected.scene_description || "Not shot yet — re-shoot it.",
                ),
              ),
        )
      : null,
    selected
      ? React.createElement(ReelContinuityRail, {
          draft,
          scene: selected,
          open: continuityOpen,
          onToggle: () => setContinuityOpen((value) => !value),
          onChangeState: () => openContinuityDraft(note.trim()),
        })
      : null,
    // ── the strip ──
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          gap: 10,
          overflowX: "auto",
          paddingBottom: 8,
        },
      },
      ...scenes.map((s) => {
        const a = assetFor(s);
        const busyHere =
          pendingSceneRun?.sceneId === s.id || live[s.id]?.state === "running";
        return React.createElement(SceneTile, {
          key: s.id,
          pid,
          scene: s,
          frameAsset: a.frame,
          shotAsset: a.shot,
          shotStale: a.shotStale,
          live: live[s.id],
          busyHere,
          selected: s.id === selectedId,
          onSelect: setSelectedId,
          onReroll: onRunOne,
        });
      }),
    ),
    // ── director bar ──
    log.length
      ? React.createElement(
          "div",
          {
            style: {
              marginTop: 12,
              maxHeight: 90,
              overflow: "auto",
              fontSize: 12,
            },
          },
          ...log
            .slice(-3)
            .map((e: any, i: number) =>
              React.createElement(
                "div",
                { key: i, style: { marginBottom: 4 } },
                React.createElement(
                  AntText,
                  { style: { color: "#8b6dff" } },
                  "› ",
                ),
                React.createElement(
                  AntText,
                  { style: { color: "#aeb6cc" } },
                  `${e.msg} — `,
                ),
                React.createElement(
                  AntText,
                  { style: { color: "#6f7a96" } },
                  e.summary || "(no change)",
                ),
              ),
            ),
        )
      : null,
    // ── scope toggle: this scene (default) vs the whole film ──
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 12,
          marginBottom: 6,
        },
      },
      React.createElement(
        AntText,
        { style: { color: "#6f7a96", fontSize: 11 } },
        "Directing:",
      ),
      React.createElement(Button, {
        size: "small",
        type: scope === "scene" ? "primary" : "default",
        ghost: scope === "scene",
        icon: selected ? React.createElement(SceneScopeIcon) : null,
        disabled: !selected,
        onClick: () => setScope("scene"),
        children: selected ? `${selected.id} · ${selected.name}` : "This scene",
      }),
      React.createElement(Button, {
        size: "small",
        type: scope === "film" ? "primary" : "default",
        ghost: scope === "film",
        onClick: () => setScope("film"),
        children: "Whole film",
      }),
    ),
    React.createElement(
      "div",
      { style: { display: "flex", gap: 8 } },
      speechSupported
        ? React.createElement(
            Tooltip,
            {
              title: listening
                ? "Listening… click to stop"
                : "Dictate your instruction",
            },
            React.createElement(Button, {
              type: listening ? "primary" : "default",
              danger: listening,
              "aria-label": listening
                ? "Stop dictation"
                : "Dictate instruction",
              icon: React.createElement(DictateIcon),
              disabled: directing,
              onClick: toggleMic,
              children: listening ? "rec" : null,
            }),
          )
        : null,
      React.createElement(Input, {
        ref: directorInputRef,
        value: note,
        onChange: (e: any) => setNote(e.target.value),
        onPressEnter: () => void direct(),
        placeholder:
          scope === "scene" && selected
            ? `Change scene ${selected.id} · ${selected.name} — e.g. "make it at dusk, red jacket"`
            : 'Direct the whole film — e.g. "make scene 1 at dusk, give the boy a red jacket"',
        disabled: directing,
        style: {
          background: "#161a27",
          borderColor: "#2a3148",
          color: "#dfe4f1",
        },
      }),
      React.createElement(Button, {
        disabled: !selected || directing,
        onClick: () => openContinuityDraft(note.trim()),
        style: {
          borderColor: "#f97316",
          background: "#f97316",
          color: "#111827",
          fontWeight: 700,
        },
        children: "Change state",
      }),
      React.createElement(Button, {
        type: "primary",
        loading: directing,
        disabled: !note.trim(),
        onClick: () => void direct(),
        children: "Direct",
      }),
    ),
    React.createElement(
      AntText,
      {
        style: {
          color: "#5b647d",
          fontSize: 10,
          display: "block",
          marginTop: 6,
        },
      },
      scope === "scene" && selected
        ? `Talking to scene ${selected.id}. I edit its script, then re-shoot its frame + motion. Click another tile to direct it, or switch to “Whole film”.`
        : "Talking to the whole film. I edit the script of the scenes you mean, then re-shoot their frame + motion.",
    ),
    React.createElement(StateChangePreviewCard, {
      draft,
      change: continuityDraft,
      affectedScenes: affectedContinuityScenes,
      entityOptions: continuityEntityOptions,
      sceneOptions: continuitySceneOptions,
      adjustOpen: continuityAdjustOpen,
      saving: continuitySaving,
      hasFinal: workflow.hasFinal,
      onPatch: patchContinuityDraft,
      onApply: () => void applyContinuityDraft(),
      onCancel: closeContinuityDraft,
      onSceneOnly: () => {
        closeContinuityDraft();
        void direct(true);
      },
      onToggleAdjust: () => setContinuityAdjustOpen((value) => !value),
    }),
    // ── budget gate: one cost confirm before any paid render ──
    React.createElement(
      Modal,
      {
        open: budgetOpen,
        focusTriggerAfterClose: false,
        title: workflow.readyForReview
          ? "Final cut is ready"
          : "Choose the next pass",
        onCancel: closeBudget,
        footer: null,
        width: 520,
      },
      React.createElement(
        Paragraph,
        { type: "secondary", style: { marginBottom: 16 } },
        `${scenes.length} scene${scenes.length === 1 ? "" : "s"} · ` +
          (reelStatusLine || "ready"),
      ),
      workflow.readyForReview
        ? React.createElement(
            Space,
            { direction: "vertical", style: { width: "100%" }, size: 12 },
            React.createElement(Alert, {
              type: "success",
              showIcon: true,
              message: "Final cut is ready",
              description:
                "No missing anchors, frames, motion, narration, or assembly. You can still tweak with Director or re-shoot a scene; changes will mark the final cut outdated until it is rebuilt.",
            }),
            React.createElement(
              "div",
              {
                style: {
                  display: "grid",
                  gap: 10,
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  width: "100%",
                },
              },
              React.createElement(Button, {
                block: true,
                size: "large",
                type: "primary",
                onClick: tweakReadyCut,
                children: "Tweak with Director",
              }),
              React.createElement(Button, {
                block: true,
                size: "large",
                onClick: () => setReadyOverrideConfirm(true),
                children: "Re-render anyway",
              }),
            ),
            readyOverrideConfirm
              ? React.createElement(
                  Space,
                  {
                    direction: "vertical",
                    style: { width: "100%" },
                    size: 10,
                  },
                  React.createElement(Alert, {
                    type: "warning",
                    showIcon: true,
                    message: "Re-render final cut?",
                    description:
                      "This will overwrite the current final video using the existing frames, motion clips, and narration.",
                  }),
                  React.createElement(
                    "div",
                    {
                      style: {
                        display: "grid",
                        gap: 10,
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        width: "100%",
                      },
                    },
                    React.createElement(Button, {
                      block: true,
                      size: "large",
                      onClick: () => setReadyOverrideConfirm(false),
                      children: "Cancel",
                    }),
                    React.createElement(Button, {
                      block: true,
                      size: "large",
                      danger: true,
                      loading: rendering || (busy && activeStage === "4"),
                      onClick: () => void rebuildReadyCut(),
                      children: "Re-render final cut",
                    }),
                  ),
                )
              : null,
          )
        : React.createElement(
            Space,
            { direction: "vertical", style: { width: "100%" }, size: 10 },
            // Never imply "free" when the forecast failed to load — a
            // missing estimate is "unavailable", not "$0".
            ...modeButtons,
            continuityN > 0 && (hasStoryboardWork || hasAnimationWork)
              ? React.createElement(Alert, {
                  key: "continuity-scope",
                  type: "success",
                  showIcon: true,
                  message: "Ready scenes stay untouched",
                  description:
                    "The Reel only runs scenes that are missing or stale; continuity edits re-render the scenes that reference the changed entity.",
                })
              : null,
          ),
    ),
  );
}

function DraftPanel({
  pid,
  draft,
  styles,
  projStatus,
  busy,
  activeStage,
  pendingSceneRun,
  forecast,
  status,
  onRunStage,
  onRunStageAllParallel,
  onAutofix,
  onDirector,
  onSaveDraft,
  onPatchScene,
  onSelectTake,
  onReload,
  onAddAnchor,
  onEditAnchor,
  onDeleteAnchor,
  onEditScene,
  liveProgress,
}: any) {
  // Accordion: at most one workspace section open at a time. ``null`` means
  // all closed. Start with metadata because it frames the project defaults.
  const _defaultOpenStage = React.useMemo<string | null>(() => {
    return "stage-meta";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // compute once on mount; user toggles control thereafter
  const [openStage, setOpenStage] = React.useState<string | null>(
    _defaultOpenStage,
  );
  const toggleStage = (id: string) =>
    setOpenStage((cur: string | null) => (cur === id ? null : id));
  React.useEffect(() => {
    const onOpenStage = (event: Event) => {
      const id = (event as CustomEvent)?.detail?.id;
      if (typeof id !== "string" || !id.startsWith("stage-")) return;
      setOpenStage(id);
    };
    window.addEventListener("qwenpaw:open-stage", onOpenStage);
    return () => window.removeEventListener("qwenpaw:open-stage", onOpenStage);
  }, []);
  const [yamlMode, setYamlMode] = React.useState(false);
  const [yamlText, setYamlText] = React.useState("");
  const [savingYaml, setSavingYaml] = React.useState(false);
  const [loadingYaml, setLoadingYaml] = React.useState(false);
  const metaStyleId = draft.assets?.style?.catalog_id
    ? String(draft.assets.style.catalog_id)
    : "";
  const metaStyle = (styles ?? []).find(
    (s: StyleEntry) => s.id === metaStyleId,
  );
  const metaSummary = [
    `${(draft.scenes ?? []).length} scenes`,
    `${(draft.assets?.characters ?? []).length} characters`,
    `${(draft.assets?.props ?? []).length} props`,
    `${(draft.assets?.scene_refs ?? []).length} settings`,
    metaStyleId
      ? String(metaStyle?.display_name || humanizeId(metaStyleId))
          .replace(/\s*\([^)]*\)\s*/g, " ")
          .trim()
      : "no style",
  ].join(" · ");
  const classicPrimary = (props: any) =>
    React.createElement(Button, {
      ...props,
      style: {
        minWidth: 116,
        background: props?.disabled ? "#f5f5f5" : "#ff7a00",
        borderColor: props?.disabled ? "#d9d9d9" : "#ff7a00",
        color: props?.disabled ? "rgba(0,0,0,0.25)" : "#1f2328",
        fontWeight: 600,
        boxShadow: "none",
        ...(props?.style || {}),
      },
    });
  const classicSecondary = (props: any) =>
    React.createElement(Button, {
      ...props,
      style: {
        minWidth: 92,
        ...(props?.style || {}),
      },
    });

  // Load the on-disk YAML text (preserves comments + formatting)
  // whenever the user opens the editor.
  React.useEffect(() => {
    if (!yamlMode) return;
    let cancelled = false;
    setLoadingYaml(true);
    apiGet<{ yaml: string }>(`/creator/projects/${pid}/yaml`)
      .then((r) => {
        if (!cancelled) setYamlText(r.yaml ?? "");
      })
      .catch((e: any) => {
        antMessage.error(`Could not load YAML: ${e.message ?? e}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingYaml(false);
      });
    return () => {
      cancelled = true;
    };
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
      try {
        data = txt ? JSON.parse(txt) : null;
      } catch {
        data = { raw: txt };
      }
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
                Paragraph,
                null,
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
                      {
                        type: "secondary",
                        style: { display: "block", fontSize: 11 },
                      },
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
          typeof data?.detail === "string"
            ? data.detail
            : typeof data?.detail?.message === "string"
            ? data.detail.message
            : txt;
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
    React.createElement(DirectorChat, { draft, onDirector }),
    React.createElement(
      StageSection,
      {
        id: "stage-meta",
        stageLabel: "Meta settings",
        summary: metaSummary,
        open: openStage === "stage-meta",
        onToggle: toggleStage,
      },
      React.createElement(DraftSummary, {
        draft,
        styles,
        onSaveDraft,
      }),
      React.createElement(SettingsCard, {
        draft,
        onSaveDraft,
      }),
      React.createElement(StateTimelineCard, {
        draft,
        onSaveDraft,
      }),
      React.createElement(Card, {
        size: "small",
        style: {
          marginTop: 12,
          borderRadius: 8,
          overflow: "hidden",
          borderColor: yamlMode ? "#eadfd4" : "#eeeeee",
        },
        headStyle: {
          minHeight: 46,
          padding: "0 16px",
          background: yamlMode ? "#fffaf5" : "#fcfcfd",
          borderBottom: 0,
        },
        bodyStyle: { display: "none", padding: 0 },
        title: React.createElement(
          Space,
          { size: 8 },
          React.createElement(FileTextOutlined),
          React.createElement(AntText, { strong: true }, "Project YAML"),
          React.createElement(
            AntText,
            { type: "secondary", style: { fontSize: 12 } },
            "· raw draft source",
          ),
        ),
        extra: React.createElement(Button, {
          size: "small",
          icon: React.createElement(EditOutlined),
          onClick: () => setYamlMode((v: boolean) => !v),
          type: yamlMode ? "primary" : "default",
          children: yamlMode ? "Hide YAML" : "Edit YAML",
        }),
      }),
      yamlMode
        ? React.createElement(
            Card,
            {
              size: "small",
              style: { marginTop: 12, borderRadius: 8, overflow: "hidden" },
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
              {
                type: "secondary",
                style: { fontSize: 11, display: "block", marginTop: 4 },
              },
              "YAML is the source of truth on disk. Property edits (descriptions, prompts, scene fields) propagate to the next regen. Renaming a character / scene id will warn you — use the per-card pencil icons for safe renames.",
            ),
          )
        : null,
    ),

    // Stage 0 runner + ref gallery — collapsible
    React.createElement(
      StageSection,
      {
        id: "stage-0",
        stageLabel: "Anchors",
        summary: (() => {
          const chars = (draft.assets?.characters ?? []).length;
          const props = (draft.assets?.props ?? []).length;
          const refs = (draft.assets?.scene_refs ?? []).length;
          const total = chars + props + refs + (draft.assets?.style ? 1 : 0);
          const done = (projStatus?.stages?.["0"]?.refs ?? []).length;
          return `${done}/${total} ready`;
        })(),
        open: openStage === "stage-0",
        onToggle: toggleStage,
        extra: (() => {
          // Stage 0 respects frame_provider. Three options: gpt-image-2
          // (OpenAI direct, OPENAI_API_KEY), gpt-image-2-dashscope
          // (Aliyun eval cluster, DASHSCOPE_API_KEY), qwen-image
          // (DASHSCOPE_API_KEY). Disable when the relevant key is missing.
          const fp =
            (draft.global_config || {}).frame_provider || "gpt-image-2";
          const needsDashScope =
            fp === "qwen-image" || fp === "gpt-image-2-dashscope";
          const keyMissing = needsDashScope
            ? !status?.has_dashscope
            : !status?.has_openai;
          const missingLabel = needsDashScope
            ? "DASHSCOPE_API_KEY missing — set it in Environment Variables"
            : "OPENAI_API_KEY missing — set it in Environment Variables";
          return React.createElement(
            Space,
            null,
            React.createElement(
              Tooltip,
              { title: keyMissing ? missingLabel : "" },
              classicPrimary({
                loading: busy && activeStage?.startsWith("0"),
                disabled: keyMissing,
                onClick: () => onRunStage("0"),
                children: "Run anchors",
              }),
            ),
            React.createElement(
              Tooltip,
              { title: "Refresh stage status" },
              React.createElement(Button, {
                size: "small",
                icon: React.createElement(ReloadOutlined),
                onClick: onReload,
              }),
            ),
          );
        })(),
      },
      (() => {
        const fp = (draft.global_config || {}).frame_provider || "gpt-image-2";
        const needsDashScope =
          fp === "qwen-image" || fp === "gpt-image-2-dashscope";
        const keyMissing = needsDashScope
          ? !status?.has_dashscope
          : !status?.has_openai;
        const needLabel = needsDashScope
          ? `DASHSCOPE_API_KEY missing — needed for ${fp}.`
          : "OPENAI_API_KEY missing — needed for gpt-image-2.";
        return keyMissing
          ? React.createElement(Alert, {
              type: "warning",
              message: needLabel,
              showIcon: true,
              style: { marginBottom: 12 },
            })
          : null;
      })(),
      React.createElement(RefGallery, {
        pid,
        draft,
        styles,
        projStatus,
        busy,
        activeStage,
        onRunPiece: (kind: string, id: string) =>
          onRunStage(
            kind === "character"
              ? "0a"
              : kind === "prop"
              ? "0a"
              : kind === "scene_ref"
              ? "0b"
              : "0c",
            kind === "character"
              ? { only_character: id, overwrite: true }
              : kind === "prop"
              ? { only_prop: id, overwrite: true }
              : kind === "scene_ref"
              ? { only_scene_ref: id, overwrite: true }
              : { overwrite: true },
          ),
        onAddAnchor,
        onEditAnchor,
        onDeleteAnchor,
      }),
    ),

    // Stage 1 — narration
    React.createElement(
      StageSection,
      {
        id: "stage-1",
        stageLabel: "Narration",
        summary: (() => {
          const narrated = (draft.scenes ?? []).filter(
            (s: any) => s.has_narration,
          ).length;
          const done = (projStatus?.stages?.["1"]?.audio ?? []).length;
          return `${done}/${narrated} voiced`;
        })(),
        open: openStage === "stage-1",
        onToggle: toggleStage,
        extra: classicPrimary({
          loading: busy && activeStage === "1",
          disabled: !status?.has_dashscope,
          onClick: () => onRunStage("1"),
          children: "Run narration",
        }),
      },
      React.createElement(AudioGallery, {
        pid,
        draft,
        projStatus,
        busy,
        activeStage,
      }),
    ),

    // Stage 2 — frames
    React.createElement(
      StageSection,
      {
        id: "stage-2",
        stageLabel: "Frames",
        summary: (() => {
          const total = (draft.scenes ?? []).length;
          const done = (projStatus?.stages?.["2"]?.frames ?? []).length;
          return `${done}/${total} ready`;
        })(),
        open: openStage === "stage-2",
        onToggle: toggleStage,
        extra: (() => {
          // Disable the button when the key for the project's actual
          // frame_provider is missing. gpt-image-2-dashscope and
          // qwen-image both need a DashScope key; gpt-image-2 (direct)
          // needs the OpenAI key.
          const fp =
            (draft.global_config || {}).frame_provider || "gpt-image-2";
          const needsDashScope =
            fp === "qwen-image" || fp === "gpt-image-2-dashscope";
          const keyMissing = needsDashScope
            ? !status?.has_dashscope
            : !status?.has_openai;
          const missingLabel = needsDashScope
            ? "DASHSCOPE_API_KEY missing — set it in Environment Variables"
            : "OPENAI_API_KEY missing — set it in Environment Variables";
          const conc = Math.max(
            1,
            Math.min(5, Number((draft.global_config || {}).concurrency) || 5),
          );
          // Validate / Auto-fix need DashScope (Qwen-VL) regardless of
          // which image provider was used to compose the frames.
          const validateDisabled = !status?.has_dashscope;
          const validateTitle = validateDisabled
            ? "DASHSCOPE_API_KEY missing — needed for frame checks"
            : "Review the current frames against scene rules";
          // Count failing scenes from the saved validation report
          // (read out of projStatus). Drives the auto-fix label.
          const vr = projStatus?.stages?.["2.5"]?.report || {};
          const failingCount = Object.entries(vr).filter(
            ([k, v]: [string, any]) =>
              k !== "_summary" &&
              v &&
              v.passed === false &&
              (v.rule_count || 0) > 0,
          ).length;
          return React.createElement(
            Space,
            { size: 6 },
            React.createElement(
              Tooltip,
              {
                title: keyMissing
                  ? missingLabel
                  : `Run missing frames. Up to ${conc} run in parallel.`,
              },
              classicPrimary({
                loading: busy && activeStage === "2",
                disabled: keyMissing,
                onClick: () => onRunStageAllParallel("2", false),
                children: "Run frames",
              }),
            ),
            React.createElement(
              Tooltip,
              { title: validateTitle },
              classicSecondary({
                loading: busy && activeStage === "2.5",
                disabled: validateDisabled,
                onClick: () => onRunStage("2.5"),
                children: "Review",
              }),
            ),
            React.createElement(
              Tooltip,
              {
                title:
                  failingCount > 0
                    ? `Regenerate ${failingCount} flagged frame(s) with correction notes.`
                    : "Review frames first; flagged frames can be repaired here.",
              },
              classicSecondary({
                loading: busy && activeStage === "autofix",
                disabled: validateDisabled || failingCount === 0,
                danger: failingCount > 0,
                onClick: () => onAutofix?.(2),
                children:
                  failingCount > 0 ? `Repair ${failingCount}` : "Repair",
              }),
            ),
          );
        })(),
      },
      React.createElement(FrameGallery, {
        pid,
        draft,
        projStatus,
        busy,
        activeStage,
        pendingSceneRun,
        liveProgress,
        onRunOne: (sceneId: string) =>
          onRunStage("2", { only_scene: sceneId, overwrite: true }),
        onEditScene,
        onPatchScene,
        onSelectTake,
      }),
    ),

    // Stage 3 — animate
    React.createElement(
      StageSection,
      {
        id: "stage-3",
        stageLabel: "Motion",
        summary: (() => {
          const total = (draft.scenes ?? []).length;
          const done = (projStatus?.stages?.["3"]?.shots ?? []).length;
          return `${done}/${total} moving`;
        })(),
        open: openStage === "stage-3",
        onToggle: toggleStage,
        extra: classicPrimary({
          loading: busy && activeStage === "3",
          disabled: !status?.has_dashscope,
          onClick: () => {
            const n = draft.scenes?.length || 0;
            const conc = Math.max(
              1,
              Math.min(5, Number((draft.global_config || {}).concurrency) || 5),
            );
            const wallMin = Math.ceil((n / conc) * 10);
            Modal.confirm({
              title: "Run motion?",
              content:
                `Each scene calls the chosen video model (~$0.50, 5-15 min). ` +
                `${n} scenes at concurrency ${conc} ≈ $${
                  forecast?.stage_3_usd ?? "?"
                }` +
                ` and ~${wallMin} min wall-clock. Keep this browser tab open.`,
              okText: "Run motion",
              onOk: () => {
                void onRunStageAllParallel("3", false);
              },
            });
          },
          children: "Run motion",
        }),
      },
      React.createElement(ShotGallery, {
        pid,
        draft,
        projStatus,
        busy,
        activeStage,
        pendingSceneRun,
        liveProgress,
        onRunOne: (sceneId: string) =>
          onRunStage("3", { only_scene: sceneId, overwrite: true }),
        onEditScene,
        onPatchScene,
        onSelectTake,
      }),
    ),

    // Stage 4 — final MP4
    React.createElement(
      StageSection,
      {
        id: "stage-4",
        stageLabel: "Final film",
        summary: (() => {
          const final = (projStatus?.stages?.["4"]?.final ?? []).length;
          return final > 0 ? "ready" : "not assembled";
        })(),
        open: openStage === "stage-4",
        onToggle: toggleStage,
        extra: classicPrimary({
          loading: busy && activeStage === "4",
          onClick: () => onRunStage("4"),
          children: "Run final",
        }),
      },
      React.createElement(FinalGallery, {
        pid,
        draft,
        projStatus,
        busy,
        activeStage,
      }),
    ),

    React.createElement(
      Paragraph,
      { type: "secondary", style: { fontSize: 12, marginTop: 16 } },
      "Motion is slow; final film needs ",
      React.createElement("code", null, "ffmpeg"),
      ".",
    ),
  );
}

// ── draft summary panel ──────────────────────────────────────────────

function DraftSummary({ draft, styles, onSaveDraft }: any) {
  const chars: any[] = draft.assets?.characters ?? [];
  const props: any[] = draft.assets?.props ?? [];
  const refs: any[] = draft.assets?.scene_refs ?? [];
  const scenes: any[] = draft.scenes ?? [];
  const styleAsset = draft.assets?.style;
  const styleId = styleAsset?.catalog_id;
  const catalogStyle = (styles ?? []).find((s: StyleEntry) => s.id === styleId);
  const styleDescription = String(
    styleAsset?.description ||
      catalogStyle?.description ||
      styleAsset?.positive_template ||
      "",
  ).trim();
  const styleName = String(catalogStyle?.display_name || "").trim();
  const styleDisplay = styleName
    ? compactText(styleName.replace(/\s*\([^)]*\)\s*/g, " "), 52)
    : styleDescription
    ? compactText(styleDescription.replace(/\{prompt\}\.?\s*/i, "").trim(), 52)
    : styleId
    ? humanizeId(styleId)
    : "—";
  const styleTooltip = [
    styleName || null,
    styleDescription || null,
    styleId ? `Style ID: ${styleId}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const defaultProvider =
    (draft.global_config?.video_provider as string | undefined) || "wan27";
  const defaultFrameProvider =
    (draft.global_config?.frame_provider as string | undefined) ||
    "gpt-image-2";
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
      for (const s of newDraft.scenes || []) {
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
      for (const s of newDraft.scenes || []) {
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
        "Overview",
      ),
    },
    React.createElement(
      "div",
      {
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(220px, 1fr))",
          gap: 12,
          alignItems: "end",
          padding: "10px 12px 12px",
          marginBottom: 14,
          border: "1px solid #eeeeee",
          borderRadius: 8,
          background: "#fafafa",
        },
      },
      React.createElement(
        "label",
        { style: { display: "block", minWidth: 0 } },
        React.createElement(
          AntText,
          {
            style: {
              color: "#595959",
              fontSize: 12,
              fontWeight: 600,
              display: "block",
              marginBottom: 4,
            },
          },
          "Image model",
        ),
        React.createElement(Select, {
          value: defaultFrameProvider,
          disabled: savingFrameProvider,
          onChange: updateDefaultFrameProvider,
          size: "middle",
          style: { width: "100%" },
          options: [
            {
              value: "gpt-image-2-dashscope",
              label: "gpt-image-2 (dashscope)",
            },
            { value: "gpt-image-2", label: "gpt-image-2 (openai)" },
            { value: "qwen-image", label: "qwen-image-2.0-pro" },
          ],
        }),
      ),
      React.createElement(
        "label",
        { style: { display: "block", minWidth: 0 } },
        React.createElement(
          AntText,
          {
            style: {
              color: "#595959",
              fontSize: 12,
              fontWeight: 600,
              display: "block",
              marginBottom: 4,
            },
          },
          "Video model",
        ),
        React.createElement(Select, {
          value: defaultProvider,
          disabled: savingProvider,
          onChange: updateDefaultProvider,
          size: "middle",
          style: { width: "100%" },
          options: [
            { value: "wan27", label: "Wan 2.7" },
            { value: "happyhorse", label: "HappyHorse 2.0" },
            { value: "seedance", label: "Seedance 2.0" },
          ],
        }),
      ),
    ),
    // Stats row.
    React.createElement(
      Row,
      { gutter: 16 },
      React.createElement(
        Col,
        { span: 5 },
        React.createElement(Stat, { label: "Scenes", value: scenes.length }),
      ),
      React.createElement(
        Col,
        { span: 5 },
        React.createElement(Stat, { label: "Characters", value: chars.length }),
      ),
      React.createElement(
        Col,
        { span: 4 },
        React.createElement(Stat, { label: "Props", value: props.length }),
      ),
      React.createElement(
        Col,
        { span: 4 },
        React.createElement(Stat, { label: "Settings", value: refs.length }),
      ),
      React.createElement(
        Col,
        { span: 6 },
        React.createElement(
          Tooltip,
          { title: styleTooltip || undefined },
          React.createElement(
            "div",
            null,
            React.createElement(Stat, {
              label: "Style",
              value: styleDisplay,
              title: styleTooltip || styleDisplay,
            }),
          ),
        ),
      ),
    ),
  );
}

function Stat({ label, value, title }: any) {
  return React.createElement(
    "div",
    null,
    React.createElement(
      AntText,
      { type: "secondary", style: { fontSize: 12 } },
      label,
    ),
    React.createElement(
      "div",
      {
        title,
        style: {
          fontSize: 22,
          fontWeight: 600,
          lineHeight: 1.2,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        },
      },
      String(value),
    ),
  );
}

// ── ref gallery (Stage 0) ────────────────────────────────────────────

function RefGallery({
  pid,
  draft,
  styles,
  projStatus,
  busy,
  activeStage,
  onRunPiece,
  onAddAnchor,
  onEditAnchor,
  onDeleteAnchor,
}: any) {
  const refsByName = new Map<string, any>(
    (projStatus?.stages?.["0"]?.refs ?? []).map((r: any) => [r.name, r]),
  );
  const chars: any[] = draft.assets?.characters ?? [];
  const props: any[] = draft.assets?.props ?? [];
  const sRefs: any[] = draft.assets?.scene_refs ?? [];
  const style = draft.assets?.style;
  const catalogStyle = (styles ?? []).find(
    (s: StyleEntry) => s.id === style?.catalog_id,
  );
  const styleName = String(catalogStyle?.display_name || "").trim();
  const styleLabel = styleName
    ? compactText(styleName.replace(/\s*\([^)]*\)\s*/g, " "), 48)
    : style?.catalog_id
    ? humanizeId(style.catalog_id)
    : "";
  const styleDescription = String(
    style?.description || catalogStyle?.description || "",
  ).trim();

  const renderItem = (it: {
    kind: string;
    id: string;
    name: string;
    refName: string;
    description?: string;
    raw?: any;
  }) => {
    const exists = refsByName.has(it.refName);
    const busyHere =
      busy &&
      ((it.kind === "character" && activeStage === "0a") ||
        (it.kind === "prop" && activeStage === "0a") ||
        (it.kind === "scene_ref" && activeStage === "0b") ||
        (it.kind === "style" && activeStage === "0c") ||
        activeStage === "0");
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
              ? React.createElement(CheckCircleTwoTone, {
                  twoToneColor: "#52c41a",
                })
              : React.createElement(ExclamationCircleOutlined, {
                  style: { color: "#bbb" },
                }),
            React.createElement(
              AntText,
              { ellipsis: true, style: { maxWidth: 140 } },
              it.name,
            ),
          ),
          extra: React.createElement(
            Space,
            { size: 2 },
            it.kind !== "style"
              ? React.createElement(
                  Tooltip,
                  { title: "Edit description" },
                  React.createElement(Button, {
                    size: "small",
                    type: "text",
                    icon: React.createElement(EditOutlined),
                    onClick: () => onEditAnchor?.(it.kind, it.raw),
                  }),
                )
              : null,
            it.kind !== "style"
              ? React.createElement(
                  Tooltip,
                  { title: "Delete anchor" },
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
              src: refUrl(pid, it.refName, refsByName.get(it.refName)?.size),
              style: {
                width: "100%",
                maxHeight: 220,
                objectFit: "cover",
                borderRadius: 4,
              },
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

  const sectionHeader = (label: string, kind: AnchorKind | null) =>
    React.createElement(
      "div",
      {
        style: {
          marginTop: 12,
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        },
      },
      React.createElement(AntText, { strong: true }, label),
      kind
        ? React.createElement(Button, {
            size: "small",
            type: "dashed",
            icon: React.createElement(PlusOutlined),
            onClick: () => onAddAnchor?.(kind),
            children:
              kind === "character"
                ? "Add character"
                : kind === "prop"
                ? "Add prop"
                : "Add setting",
          })
        : null,
    );

  return React.createElement(
    "div",
    null,
    sectionHeader("Style anchor", null),
    style?.catalog_id
      ? React.createElement(
          Row,
          { gutter: [12, 12] },
          renderItem({
            kind: "style",
            id: style.catalog_id,
            name: styleLabel,
            refName: "style_ref.png",
            description: styleDescription || `Style ID: ${style.catalog_id}`,
          }),
        )
      : React.createElement(Empty, { description: "No style picked" }),

    sectionHeader(`Characters (${chars.length})`, "character"),
    chars.length
      ? React.createElement(
          Row,
          { gutter: [12, 12] },
          ...chars.map((c: any) =>
            renderItem({
              kind: "character",
              id: c.id,
              name: c.id,
              refName: `${c.id}_ref.png`,
              description: c.description,
              raw: c,
            }),
          ),
        )
      : React.createElement(Empty, {
          description: 'No characters — click "Add character" above.',
          imageStyle: { height: 40 },
        }),

    sectionHeader(`Props (${props.length})`, "prop"),
    props.length
      ? React.createElement(
          Row,
          { gutter: [12, 12] },
          ...props.map((p: any) =>
            renderItem({
              kind: "prop",
              id: p.id,
              name: p.id,
              refName: `prop_${p.id}_ref.png`,
              description: p.description,
              raw: p,
            }),
          ),
        )
      : React.createElement(Empty, {
          description: 'No props — click "Add prop" above.',
          imageStyle: { height: 40 },
        }),

    sectionHeader(`Settings (${sRefs.length})`, "scene_ref"),
    sRefs.length
      ? React.createElement(
          Row,
          { gutter: [12, 12] },
          ...sRefs.map((r: any) =>
            renderItem({
              kind: "scene_ref",
              id: r.id,
              name: r.id,
              refName: `scene_${r.id}_ref.png`,
              description: r.description,
              raw: r,
            }),
          ),
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
  const props: string[] = scene.uses_props ?? [];
  const ref: string | null = scene.uses_scene_ref || null;
  const usesStyle: boolean =
    scene.uses_style === undefined ? true : !!scene.uses_style;
  if (scene.standalone && !chars.length && !props.length && !ref) {
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
          Tag,
          { color: "purple", style: { fontSize: 10 } },
          "style",
        )
      : null,
    ref
      ? React.createElement(
          Tag,
          { color: "geekblue", style: { fontSize: 10 } },
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
    ...props.map((p: string) =>
      React.createElement(
        Tag,
        { key: p, color: "lime", style: { fontSize: 10 } },
        `prop ${p}`,
      ),
    ),
    chars.length === 0 && props.length === 0 && !ref && !scene.standalone
      ? React.createElement(
          Tag,
          { color: "red", style: { fontSize: 10 } },
          "⚠ no anchors",
        )
      : null,
  );
}

// ⌘+Enter (mac) / Ctrl+Enter (win/linux) inside a notes box fires an
// inline re-roll. Pure so the chord rule stays obvious + testable.
function isRerollChord(e: any): boolean {
  return !!e && e.key === "Enter" && (e.metaKey || e.ctrlKey);
}

function RegenNotesBox({
  scene,
  field,
  placeholder,
  savedLabel,
  onPatchScene,
  // Optional inline re-roll. When provided, the box shows a Re-roll
  // button (and accepts ⌘/Ctrl+Enter) that persists the current note
  // and then regenerates just this scene — fusing the old two-step
  // "save the note, then hunt for the header Regen button" flow into a
  // single gesture, right where the user is typing.
  onReroll,
  rerollBusy,
  rerollDisabled,
  rerollLabel,
}: any) {
  const initialValue = String(scene?.[field] ?? "");
  const [value, setValue] = React.useState<string>(initialValue);
  const [savedValue, setSavedValue] = React.useState<string>(initialValue);
  const [saving, setSaving] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => {
    const next = String(scene?.[field] ?? "");
    if (focused || value !== savedValue) return;
    setValue(next);
    setSavedValue(next);
    // Only external scene data should resync the controlled input. Including
    // local value/savedValue here makes autosave snap active typing back to
    // the stale parent draft after a save resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id, scene?.[field], field]);
  React.useEffect(() => {
    const next = String(scene?.[field] ?? "");
    setValue(next);
    setSavedValue(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id, field]);
  const dirty = value !== savedValue;
  React.useEffect(() => {
    if (!dirty) return undefined;
    const timer = window.setTimeout(async () => {
      setSaving(true);
      try {
        await onPatchScene?.(
          scene.id ?? scene.scene_id,
          { [field]: value },
          { quiet: true, reload: false, updateProject: false },
        );
        setSavedValue(value);
      } catch {
        // onPatchScene owns the visible error.
      } finally {
        setSaving(false);
      }
    }, 550);
    return () => window.clearTimeout(timer);
  }, [dirty, field, onPatchScene, scene.id, scene.scene_id, value]);
  const flush = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await onPatchScene?.(
        scene.id ?? scene.scene_id,
        { [field]: value },
        { quiet: true, reload: false, updateProject: false },
      );
      setSavedValue(value);
    } catch {
      // onPatchScene owns the visible error.
    } finally {
      setSaving(false);
    }
  };
  // Persist the latest note, THEN re-roll this scene. We PATCH the
  // current value explicitly (not via flush, which no-ops when a
  // debounced autosave is mid-flight) so the backend Stage-2/3 run
  // reads exactly what the user just typed. Abort the re-roll if the
  // save fails — better to leave the old frame than regen blindly.
  const doReroll = async () => {
    if (!onReroll || rerollBusy || rerollDisabled) return;
    if (value !== savedValue) {
      setSaving(true);
      try {
        await onPatchScene?.(
          scene.id ?? scene.scene_id,
          { [field]: value },
          { quiet: true, reload: false, updateProject: false },
        );
        setSavedValue(value);
      } catch {
        return; // onPatchScene surfaced the error
      } finally {
        setSaving(false);
      }
    }
    await onReroll();
  };
  return React.createElement(
    "div",
    { style: { marginTop: 6 } },
    React.createElement(TextArea, {
      value,
      onChange: (e: any) => setValue(e.target.value),
      onFocus: () => setFocused(true),
      onBlur: () => {
        setFocused(false);
        void flush();
      },
      onKeyDown: onReroll
        ? (e: any) => {
            if (isRerollChord(e)) {
              e.preventDefault();
              void doReroll();
            }
          }
        : undefined,
      placeholder,
      autoSize: { minRows: 1, maxRows: 4 },
      style: { fontSize: 11, background: dirty ? "#fffbe6" : undefined },
    }),
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginTop: 2,
        },
      },
      React.createElement(
        "span",
        { style: { lineHeight: 1.2 } },
        dirty
          ? React.createElement(
              AntText,
              { type: "warning", style: { fontSize: 10 } },
              saving ? "saving..." : "autosaves shortly",
            )
          : savedValue
          ? React.createElement(
              AntText,
              { type: "secondary", style: { fontSize: 10 } },
              savedLabel,
            )
          : null,
      ),
      onReroll
        ? React.createElement(
            Tooltip,
            {
              title:
                "Save this note and re-roll just this scene (⌘/Ctrl+Enter)",
            },
            React.createElement(Button, {
              size: "small",
              type: "primary",
              ghost: true,
              loading: !!rerollBusy,
              disabled: !!rerollDisabled,
              icon: React.createElement(ReloadOutlined),
              onClick: () => void doReroll(),
              children: rerollLabel || "Re-roll",
            }),
          )
        : null,
    ),
  );
}

function MediaTakeSelector({
  pid,
  stage,
  sceneId,
  asset,
  media,
  onSelectTake,
}: any) {
  const takes = asset?.takes ?? [];
  if (!takes.length) return null;
  const active = asset?.active_take || takes.find((t: any) => t.active);
  const activeId = active?.id || takes[takes.length - 1]?.id;
  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        gap: 6,
        alignItems: "center",
        marginTop: 6,
      },
    },
    React.createElement(
      Tag,
      { color: "blue", style: { margin: 0 } },
      `take ${active?.take ?? takes.length}/${takes.length}`,
    ),
    React.createElement(Select, {
      size: "small",
      value: activeId,
      style: { minWidth: 110 },
      onChange: (takeId: string) => onSelectTake?.(stage, sceneId, takeId),
      options: takes.map((t: any) => ({
        value: t.id,
        label: `Take ${t.take}${t.active ? " • active" : ""}`,
        title: t.note || t.created_at,
      })),
    }),
    React.createElement(
      Tooltip,
      {
        title: active?.name
          ? React.createElement(media === "video" ? "video" : "img", {
              src: takeUrl(pid, active.name, active.size),
              controls: media === "video" ? true : undefined,
              style: {
                maxWidth: 220,
                maxHeight: 160,
                objectFit: "cover",
                background: media === "video" ? "#000" : undefined,
              },
            })
          : undefined,
      },
      React.createElement(Button, {
        size: "small",
        type: "text",
        icon: React.createElement(PreviewIcon),
      }),
    ),
  );
}

function FrameGallery({
  pid,
  draft,
  projStatus,
  busy,
  activeStage,
  pendingSceneRun,
  onRunOne,
  onEditScene,
  liveProgress,
  onPatchScene,
  onSelectTake,
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
      const frameAsset = framesByName.get(refName);
      const exists = Boolean(frameAsset);
      const livePhase = live[s.id]?.state; // 'running' | 'done' | 'failed'
      const liveStageMatch = live[s.id]?.stage === "2";
      const liveBusy = liveStageMatch && livePhase === "running";
      const pendingBusy =
        pendingSceneRun?.stage === "2" && pendingSceneRun?.sceneId === s.id;
      const stageBusy = busy && activeStage === "2";
      const busyHere =
        liveBusy || pendingBusy || (stageBusy && !pendingSceneRun?.sceneId);
      const dimmed = stageBusy && !busyHere;
      const hasNotes = !!(s.regen_notes && s.regen_notes.trim());
      return React.createElement(
        Col,
        { key: s.id, span: 12 },
        React.createElement(
          Card,
          {
            size: "small",
            title: React.createElement(
              Space,
              { size: 4 },
              exists
                ? React.createElement(CheckCircleTwoTone, {
                    twoToneColor: "#52c41a",
                  })
                : React.createElement(ExclamationCircleOutlined, {
                    style: { color: "#bbb" },
                  }),
              `${s.id} — ${s.name}`,
              React.createElement(Tag, null, `${s.duration}s`),
              (() => {
                const fp = s.frame_provider || "gpt-image-2";
                const tagSpec =
                  fp === "qwen-image"
                    ? { color: "cyan", label: "🪶 qwen" }
                    : { color: "purple", label: "🖼️ gpt" };
                return React.createElement(
                  Tag,
                  { color: tagSpec.color, style: { fontSize: 10 } },
                  tagSpec.label,
                );
              })(),
              (() => {
                // Validation badge from the Stage 2.5 report.
                const vr = projStatus?.stages?.["2.5"]?.report || {};
                const myReport = vr[s.id];
                if (!myReport || (myReport.rule_count || 0) === 0) return null;
                const passed = myReport.passed;
                const failures = (myReport.failures || []).length;
                const total = myReport.rule_count || 0;
                const tooltipBody = passed
                  ? `All ${total} validation rule(s) pass`
                  : `${failures}/${total} rule(s) failed:\n` +
                    (myReport.failures || [])
                      .slice(0, 5)
                      .map((f: any) => `• ${f.rule}`)
                      .join("\n");
                return React.createElement(
                  Tooltip,
                  { title: tooltipBody },
                  React.createElement(
                    Tag,
                    {
                      color: passed ? "green" : "red",
                      style: { fontSize: 10 },
                    },
                    passed ? `✓ ${total}` : `✗ ${failures}/${total}`,
                  ),
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
              Space,
              { size: 2 },
              React.createElement(
                Tooltip,
                { title: "Edit scene" },
                React.createElement(Button, {
                  size: "small",
                  type: "text",
                  icon: React.createElement(EditOutlined),
                  disabled: dimmed,
                  onClick: () => onEditScene?.(s.id),
                }),
              ),
              React.createElement(Button, {
                size: "small",
                loading: busyHere,
                disabled: dimmed,
                icon: React.createElement(ReloadOutlined),
                onClick: () => onRunOne(s.id),
                children: exists
                  ? hasNotes
                    ? "Regen w/ note"
                    : "Regen"
                  : "Gen",
                type: hasNotes ? "primary" : "default",
              }),
            ),
            style: dimmed ? { opacity: 0.45 } : undefined,
            bodyStyle: { padding: 8 },
          },
          exists
            ? React.createElement(Image, {
                src: refUrl(pid, refName, frameAsset?.size),
                style: {
                  width: "100%",
                  maxHeight: 360,
                  objectFit: "cover",
                  borderRadius: 4,
                },
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
          exists
            ? React.createElement(MediaTakeSelector, {
                pid,
                stage: "2",
                sceneId: s.id,
                asset: frameAsset,
                media: "image",
                onSelectTake,
              })
            : null,
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
                  Tag,
                  { color: "blue", style: { fontSize: 10 } },
                  "narration",
                ),
                React.createElement(
                  AntText,
                  { type: "secondary", style: { fontSize: 11 } },
                  String(s.narration).slice(0, 80),
                ),
              )
            : null,
          React.createElement(RegenNotesBox, {
            scene: s,
            field: "regen_notes",
            placeholder:
              'Frame notes for next Regen — e.g. "marlin smaller, no hat band"',
            savedLabel: "will be applied on next frame Regen",
            onPatchScene,
            onReroll: () => onRunOne(s.id),
            rerollBusy: busyHere,
            rerollDisabled: dimmed,
            rerollLabel: exists ? "Re-roll frame" : "Compose",
          }),
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
              Space,
              null,
              exists
                ? React.createElement(CheckCircleTwoTone, {
                    twoToneColor: "#52c41a",
                  })
                : React.createElement(ExclamationCircleOutlined, {
                    style: { color: "#bbb" },
                  }),
              `${sid} — ${s.name}`,
              React.createElement(Tag, null, `${s.duration}s`),
            ),
            bodyStyle: { padding: 8 },
          },
          exists
            ? React.createElement("audio", {
                controls: true,
                src: refUrl(pid, name, audioByName.get(name)?.size),
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
  pid,
  draft,
  projStatus,
  busy,
  activeStage,
  pendingSceneRun,
  liveProgress,
  onRunOne,
  onEditScene,
  onPatchScene,
  onSelectTake,
}: any) {
  const live = liveProgress || {};
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
      const shotAsset = shotsByName.get(refName);
      const exists = Boolean(shotAsset);
      const livePhase = live[sid]?.state;
      const liveStageMatch = live[sid]?.stage === "3";
      const liveBusy = liveStageMatch && livePhase === "running";
      const pendingBusy =
        pendingSceneRun?.stage === "3" && pendingSceneRun?.sceneId === sid;
      const stageBusy = busy && activeStage === "3";
      const busyHere =
        liveBusy || pendingBusy || (stageBusy && !pendingSceneRun?.sceneId);
      const dimmed = stageBusy && !busyHere;
      const hasVideoNotes = !!(
        s.video_regen_notes && s.video_regen_notes.trim()
      );
      return React.createElement(
        Col,
        { key: sid, span: 12 },
        React.createElement(
          Card,
          {
            size: "small",
            title: React.createElement(
              Space,
              { size: 4 },
              exists
                ? React.createElement(CheckCircleTwoTone, {
                    twoToneColor: "#52c41a",
                  })
                : React.createElement(ExclamationCircleOutlined, {
                    style: { color: "#bbb" },
                  }),
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
              Space,
              { size: 2 },
              React.createElement(
                Tooltip,
                { title: "Edit scene" },
                React.createElement(Button, {
                  size: "small",
                  type: "text",
                  icon: React.createElement(EditOutlined),
                  disabled: dimmed,
                  onClick: () => onEditScene?.(sid),
                }),
              ),
              React.createElement(Button, {
                size: "small",
                loading: busyHere,
                disabled: dimmed,
                icon: React.createElement(ReloadOutlined),
                onClick: () => onRunOne(sid),
                children: exists
                  ? hasVideoNotes
                    ? "Regen w/ note"
                    : "Regen"
                  : "Animate",
                type: hasVideoNotes ? "primary" : "default",
              }),
            ),
            style: dimmed ? { opacity: 0.45 } : undefined,
            bodyStyle: { padding: 8 },
          },
          exists
            ? React.createElement("video", {
                src: refUrl(pid, refName, shotAsset?.size),
                controls: true,
                preload: "metadata",
                style: {
                  width: "100%",
                  maxHeight: 360,
                  borderRadius: 4,
                  background: "#000",
                },
              })
            : React.createElement(
                "div",
                {
                  style: {
                    width: "100%",
                    height: 200,
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
          exists
            ? React.createElement(MediaTakeSelector, {
                pid,
                stage: "3",
                sceneId: sid,
                asset: shotAsset,
                media: "video",
                onSelectTake,
              })
            : null,
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
          React.createElement(RegenNotesBox, {
            scene: { ...s, id: sid },
            field: "video_regen_notes",
            placeholder:
              'Video notes for next Regen — e.g. "slower pan, keep subject centered"',
            savedLabel: "will be applied on next video Regen",
            onPatchScene,
            onReroll: () => onRunOne(sid),
            rerollBusy: busyHere,
            rerollDisabled: dimmed,
            rerollLabel: exists ? "Re-roll motion" : "Animate",
          }),
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
      description:
        'Run "Build final MP4" once all scenes are animated and narration is generated.',
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
          src: refUrl(pid, f.name, f.size),
          controls: true,
          preload: "metadata",
          style: {
            width: "100%",
            maxHeight: 480,
            borderRadius: 4,
            background: "#000",
          },
        }),
        React.createElement(
          AntText,
          {
            type: "secondary",
            style: { fontSize: 11, display: "block", marginTop: 4 },
          },
          React.createElement(
            "a",
            {
              href: refUrl(pid, f.name, f.size),
              download: f.name,
            },
            "Download",
          ),
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
    CreatorErrorBoundary,
    null,
    React.createElement(CreatorPage),
  );
}

const STORYBOOK_ROUTE_ID =
  "legacy:qwenpaw-creator:plugin/qwenpaw-creator/storybook";
const STORYBOOK_ROUTE_PATH = "/plugin/qwenpaw-creator/storybook";
const STORYBOOK_ROUTE_LABEL = "Storybook Creator";
const STORYBOOK_ROUTE_FALLBACK_ICON = React.createElement(DirectorBoardIcon, {
  size: 20,
  strokeWidth: 1.8,
});

class QwenPawCreatorPlugin {
  readonly id = "qwenpaw-creator";
  private replaceSidebarMenu(): boolean {
    const menu = (window.QwenPaw as any).menu;
    if (!menu?.replace) return false;
    menu.replace(this.id, STORYBOOK_ROUTE_ID, {
      id: STORYBOOK_ROUTE_ID,
      location: "primary.settings",
      parentId: "plugins-group",
      label: STORYBOOK_ROUTE_LABEL,
      icon: StorybookSidebarIcon,
      route: STORYBOOK_ROUTE_ID,
      order: 50,
    });
    return true;
  }

  setup(): void {
    window.QwenPaw.registerRoutes?.(this.id, [
      {
        path: STORYBOOK_ROUTE_PATH,
        component: CreatorPageWithBoundary,
        label: STORYBOOK_ROUTE_LABEL,
        icon: STORYBOOK_ROUTE_FALLBACK_ICON,
        priority: 50,
      },
    ]);
    if (this.replaceSidebarMenu()) return;

    let attempts = 0;
    const retryReplace = () => {
      attempts += 1;
      if (this.replaceSidebarMenu() || attempts >= 10) return;
      window.setTimeout(retryReplace, 50);
    };
    window.setTimeout(retryReplace, 0);
  }
}

new QwenPawCreatorPlugin().setup();
