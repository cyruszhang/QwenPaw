import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import type { DataSourceMetadata } from "./api";
import {
  createEngineApi,
  engineSessionToChatSession,
  type EngineApi,
  type EngineChat,
} from "./engineApi";
import { ArrowUpIcon, ArrowUpRightIcon, EllipsisIcon, PinIcon } from "./icons";
import { useLanguage, useT } from "./language";
import { LogoMark } from "./LogoMark";
import { renderMarkdown, splitCompletionMarker } from "./markdown";
import type {
  PawAppSdk,
  PawChatHistoryMessage,
  PawChatSession,
  PawChatStreamEvent,
} from "./sdk";
import { localeTag, translate, type Language, type StringKey } from "./strings";

type TraceStatus = "running" | "completed" | "error";

interface QueryResult {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
}

interface ChatTraceItem {
  id: string;
  name: string;
  label: string;
  status: TraceStatus;
  detail?: string;
  result?: QueryResult;
}

export interface SegmentView {
  id: string;
  title: string;
  input?: string;
  behavior?: string;
  conclusion?: string;
  artifacts: string[];
  durationSeconds?: number;
}

export interface ArtifactView {
  name: string;
  path: string;
}

export interface PlanNodeView {
  id: string;
  name: string;
  description?: string;
  state?: string;
}

export interface PlanView {
  name?: string;
  nodes: PlanNodeView[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  activity?: string;
  trace?: ChatTraceItem[];
  segments?: SegmentView[];
  artifacts?: ArtifactView[];
  plan?: PlanView | null;
  streaming?: boolean;
}

const SOURCE_CONTEXT_OPEN = "<qwenpaw-data-source-context>";
const SOURCE_CONTEXT_CLOSE = "</qwenpaw-data-source-context>";
const LEGACY_SOURCE_CONTEXT_RE =
  /^Use QwenPaw-Data source .*? for this request unless the user explicitly asks for another source\.\s*/;

export interface ChatStreamState {
  textByMessage: Record<string, string>;
  messageOrder: string[];
  toolMessageIds: Record<string, string>;
  trace: ChatTraceItem[];
  segments: SegmentView[];
  artifacts: ArtifactView[];
  plan: PlanView | null;
  finalMessageId?: string;
  finalText: string;
  completed: boolean;
}

const STARTER_KEYS: StringKey[] = [
  "chat.starter.domains",
  "chat.starter.movement",
  "chat.starter.retention",
];

/** Default names a first question may overwrite, across both languages. */
const DEFAULT_SESSION_NAMES = [
  "New analysis",
  "Previous analysis",
  "New Chat",
  "新分析",
  "历史分析",
];

const TOOL_LABEL_KEYS: Record<string, StringKey> = {
  qwenpaw_data_list_domains: "tool.listDomains",
  qwenpaw_data_explore_entity: "tool.exploreEntity",
  qwenpaw_data_search_context: "tool.searchContext",
  qwenpaw_data_execute_sql: "tool.executeSql",
};

export function createChatStreamState(): ChatStreamState {
  return {
    textByMessage: {},
    messageOrder: [],
    toolMessageIds: {},
    trace: [],
    segments: [],
    artifacts: [],
    plan: null,
    finalText: "",
    completed: false,
  };
}

const SEGMENT_SPAN_RE = /<span\s+class="[^"]*">([\s\S]*?)<\/span>/g;

/** BizTrace segment bodies carry Tailwind color spans; keep the inner text. */
export function stripSegmentSpans(body: string): string {
  return body.replace(SEGMENT_SPAN_RE, "$1");
}

function toSegmentView(raw: unknown): SegmentView | null {
  const segment = recordValue(raw);
  if (!segment || typeof segment.title !== "string") return null;
  const started =
    typeof segment.started_at === "number" ? segment.started_at : undefined;
  const ended =
    typeof segment.ended_at === "number" ? segment.ended_at : undefined;
  const artifacts: string[] = [];
  if (Array.isArray(segment.artifact)) {
    for (const item of segment.artifact) {
      const artifact = recordValue(item);
      if (artifact && typeof artifact.name === "string" && artifact.name) {
        artifacts.push(artifact.name);
      }
    }
  }
  const text = (value: unknown) =>
    typeof value === "string" && value.trim()
      ? stripSegmentSpans(value)
      : undefined;
  return {
    id:
      typeof segment.segment_id === "string" && segment.segment_id
        ? segment.segment_id
        : `${segment.title}-${started ?? ""}`,
    title: segment.title,
    input: text(segment.input),
    behavior: text(segment.behavior),
    conclusion: text(segment.conclusion),
    artifacts,
    durationSeconds:
      started !== undefined && ended !== undefined && ended > started
        ? Math.round(ended - started)
        : undefined,
  };
}

function toPlanView(raw: unknown): PlanView | null {
  const snapshot = recordValue(raw);
  if (!snapshot || !Array.isArray(snapshot.nodes)) return null;
  const nodes: PlanNodeView[] = [];
  for (const item of snapshot.nodes) {
    const node = recordValue(item);
    if (!node) continue;
    const name =
      typeof node.name === "string"
        ? node.name
        : typeof node.subject === "string"
          ? node.subject
          : "";
    if (!name) continue;
    const id =
      typeof node.node_id === "string" && node.node_id
        ? node.node_id
        : typeof node.id === "string" && node.id
          ? node.id
          : `node-${nodes.length}`;
    const state =
      typeof node.state === "string"
        ? node.state
        : typeof node.status === "string"
          ? node.status
          : undefined;
    nodes.push({
      id,
      name,
      description:
        typeof node.description === "string" && node.description
          ? node.description
          : undefined,
      state,
    });
  }
  if (!nodes.length) return null;
  return {
    name: typeof snapshot.name === "string" ? snapshot.name : undefined,
    nodes,
  };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      const block = recordValue(item);
      if (!block || block.type !== "text" || block.delta === true) return "";
      return typeof block.text === "string" ? block.text : "";
    })
    .join("");
}

function dataContent(content: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    const block = recordValue(item);
    if (!block || block.type !== "data") continue;
    const data = recordValue(block.data);
    if (data) return data;
  }
  return undefined;
}

function visibleUserText(text: string): string {
  const taggedStart = text.indexOf(SOURCE_CONTEXT_OPEN);
  if (taggedStart === 0) {
    const taggedEnd = text.indexOf(SOURCE_CONTEXT_CLOSE);
    if (taggedEnd >= 0) {
      return text.slice(taggedEnd + SOURCE_CONTEXT_CLOSE.length).trim();
    }
  }
  return text.replace(LEGACY_SOURCE_CONTEXT_RE, "").trim();
}

function finalAssistantMessage(event: PawChatStreamEvent) {
  if (!Array.isArray(event.output)) return undefined;
  for (let index = event.output.length - 1; index >= 0; index -= 1) {
    const message = recordValue(event.output[index]);
    if (!message) continue;
    if (message.type !== "message" || message.role !== "assistant") continue;
    const text = contentText(message.content);
    if (!text.trim()) continue;
    return {
      id: typeof message.id === "string" ? message.id : undefined,
      text: text.trim(),
    };
  }
  return undefined;
}

function toolLabel(name: string, language: Language = "en"): string {
  const key = TOOL_LABEL_KEYS[name];
  if (key) return translate(language, key);
  return name
    .replace(/^qwenpaw_data_/, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function parseToolOutput(
  output: unknown,
  language: Language = "en",
): {
  status: TraceStatus;
  detail?: string;
  result?: QueryResult;
} {
  if (typeof output !== "string" || !output) return { status: "completed" };
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = recordValue(JSON.parse(output));
  } catch {
    return { status: "completed" };
  }
  if (!parsed) return { status: "completed" };

  if (parsed.exec_status === "error" || parsed.error) {
    const detail = String(
      parsed.error || translate(language, "trace.queryFailed"),
    ).split("\n")[0];
    return { status: "error", detail };
  }

  if (Array.isArray(parsed.columns) && Array.isArray(parsed.rows)) {
    const columns = parsed.columns.map(String);
    const rows = parsed.rows.filter(Array.isArray) as unknown[][];
    const total =
      typeof parsed.total_row_count === "number"
        ? parsed.total_row_count
        : rows.length;
    return {
      status: "completed",
      detail: translate(language, "trace.rows", {
        count: total,
        rowWord: translate(
          language,
          total === 1 ? "trace.row" : "trace.rowPlural",
        ),
      }),
      result: {
        columns,
        rows,
        truncated: parsed.truncated === true,
      },
    };
  }

  const relevance = recordValue(parsed.relevance);
  if (typeof relevance?.status === "string") {
    return {
      status: "completed",
      detail: relevance.status.replaceAll("_", " "),
    };
  }
  return { status: "completed" };
}

function upsertTrace(
  trace: ChatTraceItem[],
  item: ChatTraceItem,
): ChatTraceItem[] {
  const index = trace.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) return [...trace, item];
  const next = [...trace];
  next[index] = { ...next[index], ...item };
  return next;
}

/** Rebuild QwenPaw Data's transcript and trace cards from QwenPaw session events. */
export function historyToChatMessages(
  history: PawChatHistoryMessage[],
  language: Language = "en",
): ChatMessage[] {
  const transcript: ChatMessage[] = [];
  const grouped = new Map<string, ChatMessage>();

  history.forEach((event, index) => {
    const role = event.role === "user" ? "user" : "assistant";
    if (role !== "user" && event.role !== "assistant") return;
    const metadata = recordValue(event.metadata);
    const originalId =
      typeof metadata?.original_id === "string"
        ? metadata.original_id
        : event.id || `history-${index}`;
    const key = `${role}:${originalId}`;
    let message = grouped.get(key);
    if (!message) {
      message = {
        id: key,
        role,
        text: "",
        trace: role === "assistant" ? [] : undefined,
        streaming: false,
      };
      grouped.set(key, message);
      transcript.push(message);
    }

    if (event.type === "message") {
      const segment = contentText(event.content).trim();
      if (!segment) return;
      if (role === "user") {
        const visible = visibleUserText(segment);
        message.text = [message.text, visible].filter(Boolean).join("\n\n");
        return;
      }
      if (message.text) {
        message.activity = [message.activity, message.text]
          .filter(Boolean)
          .join("\n\n");
      }
      message.text = segment;
      return;
    }

    if (role !== "assistant") return;
    const data = dataContent(event.content);
    if (!data) return;
    const callId = typeof data.call_id === "string" ? data.call_id : "";
    if (!callId) return;
    const existing = message.trace?.find((item) => item.id === callId);
    const name =
      typeof data.name === "string" ? data.name : existing?.name || "tool";
    if (event.type === "plugin_call") {
      message.trace = upsertTrace(message.trace || [], {
        id: callId,
        name,
        label: toolLabel(name, language),
        status: "running",
      });
      return;
    }
    if (event.type === "plugin_call_output") {
      message.trace = upsertTrace(message.trace || [], {
        id: callId,
        name,
        label: toolLabel(name, language),
        ...parseToolOutput(data.output, language),
      });
    }
  });

  return transcript
    .map((message) => ({
      ...message,
      trace: message.trace?.map((item) =>
        item.status === "running"
          ? { ...item, status: "completed" as const }
          : item,
      ),
    }))
    .filter(
      (message) =>
        Boolean(message.text) ||
        Boolean(message.activity) ||
        Boolean(message.trace?.length),
    );
}

export function reduceChatStreamEvent(
  state: ChatStreamState,
  event: PawChatStreamEvent,
  language: Language = "en",
): ChatStreamState {
  let next = state;

  if (event.type === "text" && typeof event.text === "string") {
    const messageId = event.msg_id || "assistant";
    const existing = state.textByMessage[messageId] || "";
    const text =
      event.delta === true ? existing + event.text : existing || event.text;
    next = {
      ...next,
      textByMessage: { ...next.textByMessage, [messageId]: text },
      messageOrder: next.messageOrder.includes(messageId)
        ? next.messageOrder
        : [...next.messageOrder, messageId],
    };
  }

  if (event.type === "data") {
    const data = recordValue(event.data);
    if (data) {
      const eventMessageId = event.msg_id || "";
      const explicitCallId =
        typeof data.call_id === "string" ? data.call_id : undefined;
      const callId =
        explicitCallId || next.toolMessageIds[eventMessageId] || undefined;
      const name = typeof data.name === "string" ? data.name : undefined;

      if (callId && eventMessageId) {
        next = {
          ...next,
          toolMessageIds: {
            ...next.toolMessageIds,
            [eventMessageId]: callId,
          },
        };
      }

      if (callId && name) {
        const hasOutput = Object.prototype.hasOwnProperty.call(data, "output");
        const parsed =
          hasOutput && event.status === "completed"
            ? parseToolOutput(data.output, language)
            : { status: "running" as const };
        next = {
          ...next,
          trace: upsertTrace(next.trace, {
            id: callId,
            name,
            label: toolLabel(name, language),
            ...parsed,
          }),
        };
      }
    }
  }

  if (event.object === "segment") {
    const view = toSegmentView((event as Record<string, unknown>).segment);
    if (view && !next.segments.some((item) => item.id === view.id)) {
      next = { ...next, segments: [...next.segments, view] };
    }
  }

  if (event.object === "artifact.registered") {
    const artifact = recordValue(
      (event as Record<string, unknown>).artifact,
    );
    const path = artifact && typeof artifact.path === "string" ? artifact.path : "";
    if (path && !next.artifacts.some((item) => item.path === path)) {
      const name =
        artifact && typeof artifact.name === "string" && artifact.name
          ? artifact.name
          : path.split("/").at(-1) || path;
      next = { ...next, artifacts: [...next.artifacts, { name, path }] };
    }
  }

  if (event.object === "task_status") {
    const plan = toPlanView(
      (event as Record<string, unknown>).graph_snapshot,
    );
    if (plan) {
      next = { ...next, plan };
    }
  }

  if (event.object === "response" && event.status === "completed") {
    const final = finalAssistantMessage(event);
    const fallbackId = next.messageOrder.at(-1);
    next = {
      ...next,
      finalMessageId: final?.id || fallbackId,
      finalText:
        final?.text || (fallbackId ? next.textByMessage[fallbackId] || "" : ""),
      completed: true,
      trace: next.trace.map((item) =>
        item.status === "running" ? { ...item, status: "completed" } : item,
      ),
    };
  }

  return next;
}

export function finalizeChatStreamState(
  state: ChatStreamState,
  fallbackText: string,
): ChatStreamState {
  if (state.completed) return state;
  const fallbackId = state.messageOrder.at(-1);
  return {
    ...state,
    completed: true,
    finalMessageId: fallbackId,
    finalText:
      (fallbackId && state.textByMessage[fallbackId]) || fallbackText,
    trace: state.trace.map((item) =>
      item.status === "running"
        ? { ...item, status: "completed" as const }
        : item,
    ),
  };
}

export interface ClarificationOption {
  label: string;
  description?: string;
}

export interface ClarificationQuestion {
  question: string;
  description?: string;
  multiSelect: boolean;
  options: ClarificationOption[];
}

export interface ClarificationRequest {
  id: string;
  title: string;
  questions: ClarificationQuestion[];
}

/** Parse an ask_user_question plugin_call message into a clarification card. */
export function parseClarificationRequest(
  event: PawChatStreamEvent,
): ClarificationRequest | null {
  if (
    event.object !== "message" ||
    event.type !== "plugin_call" ||
    event.status !== "completed"
  ) {
    return null;
  }
  const content = Array.isArray(event.content) ? event.content : [];
  for (const item of content) {
    const block = recordValue(item);
    if (!block || block.type !== "data") continue;
    const data = recordValue(block.data);
    if (!data || data.name !== "ask_user_question") continue;
    const callId = typeof data.call_id === "string" ? data.call_id : "";
    if (!callId) continue;
    let parsed: unknown = data.arguments;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return null;
      }
    }
    const args = recordValue(parsed);
    if (!args || !Array.isArray(args.questions)) return null;
    const questions: ClarificationQuestion[] = [];
    for (const raw of args.questions) {
      const question = recordValue(raw);
      if (!question || typeof question.question !== "string") return null;
      const options: ClarificationOption[] = [];
      if (!Array.isArray(question.options) || question.options.length === 0) {
        return null;
      }
      for (const rawOption of question.options) {
        const option = recordValue(rawOption);
        if (!option || typeof option.label !== "string") return null;
        options.push({
          label: option.label,
          description:
            typeof option.description === "string"
              ? option.description
              : undefined,
        });
      }
      questions.push({
        question: question.question,
        description:
          typeof question.description === "string"
            ? question.description
            : undefined,
        multiSelect: question.multiSelect === true,
        options,
      });
    }
    if (!questions.length) return null;
    return {
      id: callId,
      title: typeof args.title === "string" ? args.title : "",
      questions,
    };
  }
  return null;
}


function chatFailureError(chat: EngineChat): Error {
  return Object.assign(new Error(chat.error?.message || "analysis failed"), {
    code: chat.error?.code || "",
  });
}

/** Rebuild one finished chat's transcript from its persisted event stream. */
export async function replayChatTranscript(
  engine: EngineApi,
  chat: EngineChat,
  language: Language,
  fallbackText: string,
): Promise<ChatMessage[]> {
  let state = createChatStreamState();
  for await (const event of engine.streamChatEvents(
    chat.session_id,
    chat.id,
  )) {
    if (event.object === "followup.generated") continue;
    state = reduceChatStreamEvent(state, event, language);
  }
  state = finalizeChatStreamState(
    state,
    chat.status === "failed"
      ? analysisErrorMessage(chatFailureError(chat), language)
      : fallbackText,
  );
  return [
    { id: `user-${chat.id}`, role: "user", text: chat.user_input },
    {
      id: `assistant-${chat.id}`,
      role: "assistant",
      text: "",
      trace: [],
      ...streamMessagePatch(state),
      streaming: false,
    },
  ];
}


function streamMessagePatch(state: ChatStreamState): Partial<ChatMessage> {
  const finalId = state.finalMessageId;
  const activity = state.messageOrder
    .filter((messageId) => !state.completed || messageId !== finalId)
    .map((messageId) => state.textByMessage[messageId])
    .join("")
    .trim();
  return {
    text: state.finalText,
    activity,
    trace: state.trace,
    segments: state.segments,
    artifacts: state.artifacts,
    plan: state.plan,
    streaming: !state.completed,
  };
}

export function analysisErrorMessage(
  error: unknown,
  language: Language = "en",
): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code || "")
      : "";
  if (code === "MODEL_NOT_CONFIGURED") {
    return translate(language, "error.modelNotConfigured");
  }
  if (code === "UNAUTHORIZED_MODEL_ACCESS") {
    return translate(language, "error.modelUnauthorized");
  }
  const detail = error instanceof Error ? error.message : String(error);
  if (/not found in config/i.test(detail)) {
    return translate(language, "error.agentReloading");
  }
  return translate(language, "error.analysisFallback", { detail });
}

function ResultTable({ result }: { result: QueryResult }) {
  const t = useT();
  if (!result.columns.length || !result.rows.length) return null;
  return (
    <div className="qwenpaw-data-trace-result">
      <table>
        <thead>
          <tr>
            {result.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.slice(0, 100).map((row, rowIndex) => (
            <tr key={rowIndex}>
              {result.columns.map((_, columnIndex) => (
                <td key={columnIndex}>{String(row[columnIndex] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.truncated || result.rows.length > 100 ? (
        <small>
          {t("trace.showingRows", {
            count: Math.min(result.rows.length, 100),
          })}
        </small>
      ) : null}
    </div>
  );
}

function AnalysisTrace({ message }: { message: ChatMessage }) {
  const t = useT();
  const trace = message.trace || [];
  if (!message.activity && trace.length === 0) return null;
  return (
    <details className="qwenpaw-data-analysis-trace" open={message.streaming}>
      <summary>
        <span className={message.streaming ? "is-running" : ""} />
        {message.streaming
          ? t("trace.live")
          : t("trace.steps", {
              count: trace.length,
              stepWord: t(
                trace.length === 1 ? "trace.step" : "trace.stepPlural",
              ),
            })}
      </summary>
      <div className="qwenpaw-data-analysis-trace__body">
        {message.activity ? (
          <div className="qwenpaw-data-analysis-trace__narrative">
            {message.activity}
          </div>
        ) : null}
        {trace.length ? (
          <ol>
            {trace.map((item) => (
              <li className={`is-${item.status}`} key={item.id}>
                <i />
                <div>
                  <b>{item.label}</b>
                  {item.detail ? <small>{item.detail}</small> : null}
                  {item.result ? <ResultTable result={item.result} /> : null}
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </details>
  );
}

/** Pinned dialogues first, then most recently updated. */
export function sortChatSessions(sessions: PawChatSession[]): PawChatSession[] {
  return [...sessions].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });
}

/** Which dialogue becomes active after one is archived or deleted. */
export function nextActiveSessionId(
  sessions: PawChatSession[],
  removedSessionId: string,
  activeSessionId: string,
): string {
  if (removedSessionId !== activeSessionId) return activeSessionId;
  const remaining = sortChatSessions(sessions).filter(
    (session) => session.sessionId !== removedSessionId,
  );
  return remaining[0]?.sessionId || "";
}

function sessionTimestamp(value: string, language: Language = "en"): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(localeTag(language), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DialogueHistory({
  sessions,
  activeSessionId,
  busy,
  creating,
  showPinArchive = true,
  onCreate,
  onSelect,
  onTogglePin,
  onRename,
  onArchive,
  onDelete,
}: {
  sessions: PawChatSession[];
  activeSessionId: string;
  busy: boolean;
  creating: boolean;
  showPinArchive?: boolean;
  onCreate(): void;
  onSelect(sessionId: string): void;
  onTogglePin(session: PawChatSession): void;
  onRename(session: PawChatSession, name: string): void;
  onArchive(session: PawChatSession): void;
  onDelete(session: PawChatSession): void;
}) {
  const [menuFor, setMenuFor] = useState("");
  const [renamingId, setRenamingId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const language = useLanguage();
  const t = useT();
  const ordered = sortChatSessions(sessions);

  function closeMenu() {
    setMenuFor("");
    setConfirmDeleteId("");
  }

  function submitRename(session: PawChatSession) {
    const clean = renameDraft.trim();
    setRenamingId("");
    if (clean && clean !== session.name) onRename(session, clean);
  }

  return (
    <aside className="qwenpaw-data-history" aria-label={t("history.aria")}>
      <header className="qwenpaw-data-history__header">
        <b>{t("history.sessions")}</b>
        <button
          type="button"
          className="qwenpaw-data-new-chat"
          disabled={busy || creating}
          onClick={onCreate}
        >
          {creating ? t("history.creating") : t("history.newChat")}
        </button>
      </header>
      <ul className="qwenpaw-data-history__list">
        {ordered.map((session) => {
          const isActive = session.sessionId === activeSessionId;
          const isLegacy = session.id === "legacy";
          return (
            <li
              key={session.id}
              className={[
                "qwenpaw-data-history__item",
                isActive ? "is-active" : "",
                session.pinned ? "is-pinned" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {renamingId === session.id ? (
                <form
                  className="qwenpaw-data-history__rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitRename(session);
                  }}
                >
                  <input
                    autoFocus
                    aria-label={t("history.dialogueName")}
                    value={renameDraft}
                    maxLength={80}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={() => submitRename(session)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setRenamingId("");
                    }}
                  />
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="qwenpaw-data-history__open"
                    disabled={busy}
                    onClick={() => onSelect(session.sessionId)}
                  >
                    <b>
                      {session.pinned ? (
                        <i aria-label="Pinned">
                          <PinIcon size={12} />
                        </i>
                      ) : null}
                      {session.name}
                    </b>
                    <small>
                      {sessionTimestamp(session.updatedAt, language)}
                    </small>
                  </button>
                  {isLegacy ? null : (
                    <button
                      type="button"
                      className="qwenpaw-data-history__more"
                      aria-label={t("history.actionsFor", {
                        name: session.name,
                      })}
                      aria-expanded={menuFor === session.id}
                      onClick={() =>
                        menuFor === session.id
                          ? closeMenu()
                          : setMenuFor(session.id)
                      }
                    >
                      <EllipsisIcon size={14} />
                    </button>
                  )}
                  {menuFor === session.id ? (
                    <>
                      <div
                        className="qwenpaw-data-history__backdrop"
                        onClick={closeMenu}
                      />
                      <div className="qwenpaw-data-history__menu" role="menu">
                        {showPinArchive ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              closeMenu();
                              onTogglePin(session);
                            }}
                          >
                            {session.pinned
                              ? t("history.unpin")
                              : t("history.pin")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            closeMenu();
                            setRenameDraft(session.name);
                            setRenamingId(session.id);
                          }}
                        >
                          {t("history.rename")}
                        </button>
                        {showPinArchive ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              closeMenu();
                              onArchive(session);
                            }}
                          >
                            {t("history.archive")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          role="menuitem"
                          className="is-danger"
                          onClick={() => {
                            if (confirmDeleteId !== session.id) {
                              setConfirmDeleteId(session.id);
                              return;
                            }
                            closeMenu();
                            onDelete(session);
                          }}
                        >
                          {confirmDeleteId === session.id
                            ? t("history.confirmDelete")
                            : t("history.delete")}
                        </button>
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function AssistantBody({ text }: { text: string }) {
  const { body, marker } = splitCompletionMarker(text);
  return (
    <>
      <div className="qwenpaw-data-message__body qwenpaw-data-message__body--rich">
        {renderMarkdown(body)}
      </div>
      {marker ? (
        <div className="qwenpaw-data-run-summary">
          <i aria-hidden="true" />
          <span>{marker}</span>
        </div>
      ) : null}
    </>
  );
}

function PlanPanel({ plan }: { plan?: PlanView | null }) {
  const t = useT();
  if (!plan || !plan.nodes.length) return null;
  return (
    <details className="qwenpaw-data-plan" open>
      <summary>
        {t("plan.title")}
        {plan.name ? <em> · {plan.name}</em> : null}
      </summary>
      <ol>
        {plan.nodes.map((node) => (
          <li key={node.id}>
            <span className="qwenpaw-data-plan__name">{node.name}</span>
            {node.state ? (
              <i className={`qwenpaw-data-plan__state is-${node.state}`}>
                {node.state}
              </i>
            ) : null}
            {node.description ? <small>{node.description}</small> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

function SegmentTimeline({ segments }: { segments?: SegmentView[] }) {
  const t = useT();
  if (!segments || !segments.length) return null;
  return (
    <div className="qwenpaw-data-segments" aria-label={t("segments.aria")}>
      {segments.map((segment) => (
        <details key={segment.id} className="qwenpaw-data-segment">
          <summary>
            <span>{segment.title}</span>
            {segment.durationSeconds !== undefined ? (
              <em>
                {t("segments.duration", {
                  seconds: String(segment.durationSeconds),
                })}
              </em>
            ) : null}
          </summary>
          {segment.conclusion ? (
            <p className="qwenpaw-data-segment__conclusion">
              {segment.conclusion}
            </p>
          ) : null}
          {segment.behavior ? <small>{segment.behavior}</small> : null}
          {segment.artifacts.length ? (
            <div className="qwenpaw-data-segment__artifacts">
              {segment.artifacts.map((name) => (
                <code key={name}>{name}</code>
              ))}
            </div>
          ) : null}
        </details>
      ))}
    </div>
  );
}

function ArtifactStrip({
  artifacts,
  onDownload,
}: {
  artifacts?: ArtifactView[];
  onDownload(artifact: ArtifactView): void;
}) {
  const t = useT();
  if (!artifacts || !artifacts.length) return null;
  return (
    <div className="qwenpaw-data-artifacts" aria-label={t("artifacts.aria")}>
      <span>{t("artifacts.title")}</span>
      {artifacts.map((artifact) => (
        <button
          key={artifact.path}
          type="button"
          title={artifact.path}
          onClick={() => onDownload(artifact)}
        >
          {artifact.name}
        </button>
      ))}
    </div>
  );
}

function ClarificationCard({
  request,
  onSubmit,
}: {
  request: ClarificationRequest;
  onSubmit(selections: string[][]): void;
}) {
  const t = useT();
  const [selections, setSelections] = useState<string[][]>(() =>
    request.questions.map(() => []),
  );

  function toggle(questionIndex: number, label: string) {
    setSelections((current) =>
      current.map((selected, index) => {
        if (index !== questionIndex) return selected;
        const question = request.questions[questionIndex];
        if (question.multiSelect) {
          return selected.includes(label)
            ? selected.filter((item) => item !== label)
            : [...selected, label];
        }
        return selected.includes(label) ? [] : [label];
      }),
    );
  }

  const answered = selections.every((selected) => selected.length > 0);

  return (
    <div
      className="qwenpaw-data-clarification"
      role="group"
      aria-label={t("clarification.aria")}
    >
      <header>{request.title || t("clarification.title")}</header>
      {request.questions.map((question, questionIndex) => (
        <div
          key={`${questionIndex}-${question.question}`}
          className="qwenpaw-data-clarification__question"
        >
          <p>{question.question}</p>
          {question.description ? <small>{question.description}</small> : null}
          <div className="qwenpaw-data-clarification__options">
            {question.options.map((option) => {
              const selected =
                selections[questionIndex]?.includes(option.label) ?? false;
              return (
                <button
                  key={option.label}
                  type="button"
                  className={selected ? "is-selected" : ""}
                  aria-pressed={selected}
                  title={option.description || undefined}
                  onClick={() => toggle(questionIndex, option.label)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <footer>
        <button
          type="button"
          disabled={!answered}
          onClick={() => onSubmit(selections)}
        >
          {t("clarification.submit")}
        </button>
      </footer>
    </div>
  );
}

export function ChatWorkspace({
  paw,
  selectedSource,
  sources,
  selectedSourceId,
  onSelectSource,
}: {
  paw: PawAppSdk;
  selectedSource?: DataSourceMetadata;
  sources: DataSourceMetadata[];
  selectedSourceId: string;
  onSelectSource(id: string): void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<PawChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [creatingSession, setCreatingSession] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [followups, setFollowups] = useState<string[]>([]);
  const [clarification, setClarification] =
    useState<ClarificationRequest | null>(null);
  const engine = useMemo(() => createEngineApi(paw), [paw]);
  const activeTurnRef = useRef<{ sessionId: string; chatId: string } | null>(
    null,
  );
  const language = useLanguage();
  const t = useT();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const activeSession = sessions.find(
    (session) => session.sessionId === activeSessionId,
  );

  useEffect(() => {
    let cancelled = false;
    void paw.storage
      .get<boolean>("chat-history-open", true)
      .then((open) => {
        if (!cancelled) setHistoryOpen(open !== false);
      })
      .catch(() => undefined);
    void Promise.all([
      engine.listSessions(),
      paw.storage.get<string>("active-chat-session", ""),
    ])
      .then(async ([available, storedSessionId]) => {
        if (cancelled) return;
        let next = available.map(engineSessionToChatSession);
        if (next.length === 0) {
          next = [
            engineSessionToChatSession(
              await engine.createSession({
                title: t("history.newAnalysis"),
              }),
            ),
          ];
        }
        if (cancelled) return;
        setSessions(next);
        const selected = next.some(
          (session) => session.sessionId === storedSessionId,
        )
          ? storedSessionId
          : next[0].sessionId;
        setActiveSessionId(selected);
      })
      .catch((error) => {
        if (cancelled) return;
        setRestoring(false);
        void paw
          .toast(
            t("session.engineUnavailable", {
              detail: error instanceof Error ? error.message : String(error),
            }),
            "warning",
          )
          .catch(() => undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [paw]);

  useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    setRestoring(true);
    setMessages([]);
    setFollowups([]);
    void paw.storage
      .set("active-chat-session", activeSessionId)
      .catch(() => undefined);
    void (async () => {
      const chats = await engine.listChats(activeSessionId);
      const recent = chats.slice(-20);
      const restored: ChatMessage[] = [];
      let runningChat: EngineChat | undefined;
      for (const chat of recent) {
        if (cancelled) return;
        if (chat.status === "created" || chat.status === "running") {
          runningChat = chat;
          restored.push(
            { id: `user-${chat.id}`, role: "user", text: chat.user_input },
            {
              id: `assistant-${chat.id}`,
              role: "assistant",
              text: "",
              trace: [],
              streaming: true,
            },
          );
          break;
        }
        restored.push(
          ...(await replayChatTranscript(
            engine,
            chat,
            language,
            t("chat.noTextResponse"),
          )),
        );
      }
      if (cancelled) return;
      setMessages(restored);
      setRestoring(false);
      if (runningChat) {
        setSending(true);
        void consumeChatStream(
          activeSessionId,
          runningChat.id,
          `assistant-${runningChat.id}`,
        ).finally(() => {
          if (!cancelled) setSending(false);
        });
      }
    })().catch(() => {
      if (!cancelled) {
        setRestoring(false);
        void paw
          .toast(t("session.restoreFailed"), "warning")
          .catch(() => undefined);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, paw]);

  useEffect(() => {
    if (!sending || !conversationRef.current) return;
    conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    if (restoring || !conversationRef.current) return;
    conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
  }, [restoring]);

  async function createDialogue() {
    if (sending || creatingSession) return;
    setCreatingSession(true);
    try {
      const created = engineSessionToChatSession(
        await engine.createSession({ title: t("history.newAnalysis") }),
      );
      setSessions((current) => [created, ...current]);
      setActiveSessionId(created.sessionId);
    } catch (error) {
      await paw.toast(
        t("session.createFailed", {
          detail: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    } finally {
      setCreatingSession(false);
    }
  }

  function switchDialogue(sessionId: string) {
    if (!sessionId || sessionId === activeSessionId || sending) return;
    setActiveSessionId(sessionId);
  }

  function updateSession(updated: PawChatSession) {
    setSessions((current) =>
      current.map((session) => (session.id === updated.id ? updated : session)),
    );
  }

  function toggleHistory() {
    setHistoryOpen((open) => {
      void paw.storage.set("chat-history-open", !open).catch(() => undefined);
      return !open;
    });
  }

  async function sessionActionFailed(actionKey: StringKey, error: unknown) {
    await paw.toast(
      t("session.actionFailed", {
        action: t(actionKey),
        detail: error instanceof Error ? error.message : String(error),
      }),
      "error",
    );
  }

  function renameDialogue(session: PawChatSession, name: string) {
    void engine
      .renameSession(session.id, name)
      .then((updated) => updateSession(engineSessionToChatSession(updated)))
      .catch(
        (error) => void sessionActionFailed("session.action.rename", error),
      );
  }

  async function dropDialogue(session: PawChatSession) {
    const nextActive = nextActiveSessionId(
      sessions,
      session.sessionId,
      activeSessionId,
    );
    setSessions((current) =>
      current.filter((candidate) => candidate.id !== session.id),
    );
    if (nextActive === activeSessionId) return;
    if (nextActive) {
      setActiveSessionId(nextActive);
      return;
    }
    // The last dialogue is gone; keep the workspace usable with a fresh one.
    try {
      const created = engineSessionToChatSession(
        await engine.createSession({ title: t("history.newAnalysis") }),
      );
      setSessions([created]);
      setActiveSessionId(created.sessionId);
    } catch (error) {
      await sessionActionFailed("session.action.replace", error);
    }
  }

  function deleteDialogue(session: PawChatSession) {
    void engine
      .deleteSession(session.id)
      .then(() => dropDialogue(session))
      .catch(
        (error) => void sessionActionFailed("session.action.delete", error),
      );
  }

  async function consumeChatStream(
    sessionId: string,
    chatId: string,
    assistantId: string,
  ): Promise<void> {
    let streamState = createChatStreamState();
    activeTurnRef.current = { sessionId, chatId };

    function applyPatch() {
      const patch = streamMessagePatch(streamState);
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, ...patch } : message,
        ),
      );
    }

    try {
      for await (const event of engine.streamChatEvents(sessionId, chatId)) {
        if (event.object === "followup.generated") {
          const questions = event.followup?.questions ?? [];
          if (questions.length) setFollowups(questions.slice(0, 4));
          continue;
        }
        const clarificationRequest = parseClarificationRequest(event);
        if (clarificationRequest) {
          setClarification(clarificationRequest);
        }
        streamState = reduceChatStreamEvent(streamState, event, language);
        if (event.object === "response" && event.status === "failed") {
          const failure = recordValue(event.error);
          streamState = finalizeChatStreamState(
            streamState,
            analysisErrorMessage(
              Object.assign(
                new Error(String(failure?.message || "analysis failed")),
                { code: String(failure?.code || "") },
              ),
              language,
            ),
          );
        }
        if (event.object === "response" && event.status === "cancelled") {
          streamState = finalizeChatStreamState(
            streamState,
            t("chat.stopped"),
          );
        }
        if (
          event.object === "response" &&
          ["completed", "failed", "cancelled"].includes(event.status ?? "")
        ) {
          setClarification(null);
        }
        applyPatch();
      }
      if (!streamState.completed) {
        streamState = finalizeChatStreamState(
          streamState,
          t("chat.noTextResponse"),
        );
        applyPatch();
      }
    } finally {
      activeTurnRef.current = null;
      setClarification(null);
    }
  }

  async function stopAnalysis() {
    const target = activeTurnRef.current;
    if (!target) return;
    try {
      await engine.stopChat(target.sessionId, target.chatId);
    } catch {
      // The turn may already be terminal; the stream settles either way.
    }
  }

  async function downloadArtifact(artifact: ArtifactView) {
    if (!activeSessionId) return;
    try {
      const blob = await engine.downloadArtifact(activeSessionId, artifact.path);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = artifact.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      void paw
        .toast(
          t("artifacts.downloadFailed", {
            detail: error instanceof Error ? error.message : String(error),
          }),
          "error",
        )
        .catch(() => undefined);
    }
  }

  async function submitClarification(
    request: ClarificationRequest,
    selections: string[][],
  ) {
    const target = activeTurnRef.current;
    if (!target) return;
    setClarification(null);
    try {
      await engine.answerClarification(
        target.sessionId,
        target.chatId,
        request.id,
        request.questions.map((question, index) => ({
          question: question.question,
          selected_options: selections[index] ?? [],
          custom_text: null,
        })),
      );
    } catch (error) {
      void paw
        .toast(
          t("clarification.answerFailed", {
            detail: error instanceof Error ? error.message : String(error),
          }),
          "error",
        )
        .catch(() => undefined);
    }
  }

  async function steer(text: string) {
    const target = activeTurnRef.current;
    if (!target) return;
    setDraft("");
    setMessages((current) => [
      ...current,
      {
        id: `steer-${Date.now()}`,
        role: "user",
        text,
      },
    ]);
    try {
      await engine.steerChat(target.sessionId, target.chatId, text);
    } catch (error) {
      void paw
        .toast(
          t("chat.steerFailed", {
            detail: error instanceof Error ? error.message : String(error),
          }),
          "warning",
        )
        .catch(() => undefined);
    }
  }

  async function submit(question: string) {
    const clean = question.trim();
    if (!clean || restoring || !activeSessionId) return;
    if (sending) {
      // A turn is running: route the message as steering guidance.
      if (activeTurnRef.current) await steer(clean);
      return;
    }
    const sessionForTurn = activeSessionId;
    const shouldNameSession =
      messages.length === 0 &&
      activeSession &&
      DEFAULT_SESSION_NAMES.includes(activeSession.name);
    const now = Date.now();
    const userMessage: ChatMessage = {
      id: `user-${now}`,
      role: "user",
      text: clean,
    };
    setDraft("");
    setFollowups([]);
    setSending(true);
    if (shouldNameSession && activeSession) {
      void engine
        .renameSession(activeSession.id, clean.slice(0, 64))
        .then((updated) => updateSession(engineSessionToChatSession(updated)))
        .catch(() => undefined);
    }
    try {
      const chat = await engine.createChat(
        sessionForTurn,
        clean,
        selectedSource?.datasource_id,
      );
      const assistantId = `assistant-${chat.id}`;
      setMessages((current) => [
        ...current,
        userMessage,
        {
          id: assistantId,
          role: "assistant",
          text: "",
          trace: [],
          streaming: true,
        },
      ]);
      await consumeChatStream(sessionForTurn, chat.id, assistantId);
    } catch (error) {
      const assistantId = `assistant-${now}`;
      setMessages((current) => [
        ...current,
        userMessage,
        {
          id: assistantId,
          role: "assistant",
          text: analysisErrorMessage(error, language),
          streaming: false,
        },
      ]);
      await paw.toast(t("chat.analysisFailed"), "error");
    } finally {
      setSending(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(draft);
  }

  return (
    <section
      className={`qwenpaw-data-chat ${historyOpen ? "has-history" : ""}`.trim()}
      aria-label={t("chat.aria")}
    >
      <div className="qwenpaw-data-chat__main">
        <div className="qwenpaw-data-chat__topline qwenpaw-data-chat__toolbar">
          <div className="qwenpaw-data-chat__controls">
            <label className="qwenpaw-data-source-pill qwenpaw-data-source-pill--select">
              <span className="qwenpaw-data-source-pill__dot" />
              <select
                aria-label={t("chat.sourceSelect")}
                value={selectedSourceId}
                onChange={(event) => onSelectSource(event.target.value)}
              >
                <option value="">{t("chat.allContext")}</option>
                {sources.map((source) => (
                  <option
                    key={source.datasource_id}
                    value={source.datasource_id}
                  >
                    {source.datasource_name || source.datasource_id}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div
          className="qwenpaw-data-conversation"
          aria-live="polite"
          ref={conversationRef}
        >
          {restoring ? (
            <div className="qwenpaw-data-welcome">
              <h2>{t("chat.restoring")}</h2>
            </div>
          ) : messages.length === 0 ? (
            <div className="qwenpaw-data-welcome">
              <div className="qwenpaw-data-welcome__mark">
                <LogoMark />
              </div>
              <h2>{t("chat.welcomeTitle")}</h2>
              <p>{t("chat.welcomeBody")}</p>
              <div className="qwenpaw-data-starters">
                {STARTER_KEYS.map((starterKey) => {
                  const starter = t(starterKey);
                  return (
                    <button
                      key={starterKey}
                      type="button"
                      disabled={restoring}
                      onClick={() => void submit(starter)}
                    >
                      <span>{starter}</span>
                      <b aria-hidden="true">
                        <ArrowUpRightIcon size={12} />
                      </b>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="qwenpaw-data-messages">
              {messages.map((message) => (
                <article
                  className={`qwenpaw-data-message qwenpaw-data-message--${message.role}`}
                  key={message.id}
                >
                  <div className="qwenpaw-data-message__role">
                    {message.role === "user" ? t("chat.you") : "QwenPaw-Data"}
                  </div>
                  {message.role === "assistant" ? (
                    <>
                      <PlanPanel plan={message.plan} />
                      <AnalysisTrace message={message} />
                      <SegmentTimeline segments={message.segments} />
                      {message.text ? (
                        <AssistantBody text={message.text} />
                      ) : message.streaming && !message.activity ? (
                        <div
                          className="qwenpaw-data-thinking"
                          aria-label={t("chat.analyzing")}
                        >
                          <i /> <i /> <i />
                        </div>
                      ) : null}
                      <ArtifactStrip
                        artifacts={message.artifacts}
                        onDownload={(artifact) =>
                          void downloadArtifact(artifact)
                        }
                      />
                    </>
                  ) : (
                    <div className="qwenpaw-data-message__body">
                      {message.text}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>

        <form className="qwenpaw-data-composer" onSubmit={handleSubmit}>
          {clarification ? (
            <ClarificationCard
              request={clarification}
              onSubmit={(selections) =>
                void submitClarification(clarification, selections)
              }
            />
          ) : null}
          {followups.length && !sending && !restoring ? (
            <div
              className="qwenpaw-data-followups"
              aria-label={t("chat.followupsAria")}
            >
              {followups.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => void submit(question)}
                >
                  <span>{question}</span>
                  <b aria-hidden="true">
                    <ArrowUpRightIcon size={12} />
                  </b>
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            ref={inputRef}
            value={draft}
            rows={2}
            disabled={restoring || !activeSessionId}
            placeholder={
              sending ? t("chat.steerPlaceholder") : t("chat.placeholder")
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit(draft);
              }
            }}
          />
          {sending ? (
            <button
              type="button"
              className="qwenpaw-data-composer__stop"
              onClick={() => void stopAnalysis()}
              aria-label={t("chat.stop")}
            >
              <span aria-hidden="true">■</span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim() || sending || restoring}
              aria-label={t("chat.send")}
            >
              <ArrowUpIcon size={16} />
            </button>
          )}
          <div className="qwenpaw-data-composer__hint">{t("chat.hint")}</div>
        </form>
      </div>
      <div className="qwenpaw-data-history-rail">
        <button
          type="button"
          className="qwenpaw-data-history-tab"
          aria-expanded={historyOpen}
          aria-label={historyOpen ? t("history.collapse") : t("history.expand")}
          onClick={toggleHistory}
        >
          <i aria-hidden="true">{historyOpen ? "›" : "‹"}</i>
          <span>{t("history.sessions")}</span>
        </button>
        {historyOpen ? (
          <DialogueHistory
            sessions={sessions}
            activeSessionId={activeSessionId}
            busy={sending || restoring}
            creating={creatingSession}
            showPinArchive={false}
            onCreate={() => void createDialogue()}
            onSelect={switchDialogue}
            onTogglePin={() => undefined}
            onRename={renameDialogue}
            onArchive={() => undefined}
            onDelete={deleteDialogue}
          />
        ) : null}
      </div>
    </section>
  );
}
