import type { PawAppSdk, PawChatSession, PawChatStreamEvent } from "./sdk";

const ENGINE_BASE = "/engine/api/v1";

export interface EngineSession {
  id: string;
  agent_id: string;
  title: string;
  status: "idle" | "running";
  datasource_id?: string | null;
  chat_count: number;
  channel: string;
  created_at: string;
  updated_at: string;
}

export interface EngineChatError {
  code?: string;
  message?: string;
}

export interface EngineChat {
  id: string;
  session_id: string;
  sequence: number;
  user_input: string;
  datasource_id?: string | null;
  kind: "simple" | "planned";
  status: "created" | "running" | "completed" | "failed" | "canceled";
  last_sequence_number: number;
  started_at?: string | null;
  completed_at?: string | null;
  error?: EngineChatError | null;
}

export interface ClarificationAnswer {
  question: string;
  selected_options: string[];
  custom_text?: string | null;
}

export interface SettlementCard {
  id: string;
  session_id: string;
  source_chat_id: string;
  type: string;
  fields: Record<string, string>;
  status: "pending" | "queried" | "confirmed" | "dismissed";
  created_at: string;
  updated_at: string;
}

export interface CronSchedule {
  type: "cron" | "once";
  cron?: string | null;
  run_at?: string | null;
  timezone: string;
}

export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  message: string;
  datasource_id: string;
  channel: string;
  target_external_key?: string | null;
  session_id?: string | null;
  schedule: CronSchedule;
  created_at: string;
  updated_at: string;
}

export interface CronJobWrite {
  name: string;
  enabled?: boolean;
  message: string;
  datasource_id: string;
  channel?: string;
  session_id?: string | null;
  schedule: CronSchedule;
}

/** Engine SSE payloads reuse the host chat-stream shape plus follow-ups. */
export interface EngineStreamEvent extends PawChatStreamEvent {
  sequence_number?: number;
  session_id?: string;
  chat_id?: string;
  followup?: { chat_id?: string | null; questions: string[] };
}

export function engineSessionToChatSession(
  session: EngineSession,
): PawChatSession {
  return {
    id: session.id,
    sessionId: session.id,
    name: session.title,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    archived: false,
    pinned: false,
  };
}

export function createEngineApi(paw: PawAppSdk) {
  return {
    listSessions: async (): Promise<EngineSession[]> => {
      const response = await paw.api.get<{ items: EngineSession[] }>(
        `${ENGINE_BASE}/sessions`,
        { query: { page: 1, page_size: 100 } },
      );
      return response.items ?? [];
    },
    createSession: async (options?: {
      title?: string;
      datasourceId?: string;
    }): Promise<EngineSession> => {
      const response = await paw.api.post<{ session: EngineSession }>(
        `${ENGINE_BASE}/sessions`,
        {
          ...(options?.title ? { title: options.title } : {}),
          ...(options?.datasourceId
            ? { datasource_id: options.datasourceId }
            : {}),
        },
      );
      return response.session;
    },
    renameSession: async (
      sessionId: string,
      title: string,
    ): Promise<EngineSession> => {
      const response = await paw.api.patch<{ session: EngineSession }>(
        `${ENGINE_BASE}/sessions/${encodeURIComponent(sessionId)}`,
        { title },
      );
      return response.session;
    },
    deleteSession: (sessionId: string): Promise<void> =>
      paw.api.delete<void>(
        `${ENGINE_BASE}/sessions/${encodeURIComponent(sessionId)}`,
      ),
    listChats: async (sessionId: string): Promise<EngineChat[]> => {
      const response = await paw.api.get<{ items: EngineChat[] }>(
        `${ENGINE_BASE}/sessions/${encodeURIComponent(sessionId)}/chats`,
      );
      return response.items ?? [];
    },
    createChat: async (
      sessionId: string,
      text: string,
      datasourceId?: string,
    ): Promise<EngineChat> => {
      const response = await paw.api.post<{ chat: EngineChat }>(
        `${ENGINE_BASE}/sessions/${encodeURIComponent(sessionId)}/chats`,
        {
          text,
          ...(datasourceId ? { datasource_id: datasourceId } : {}),
        },
      );
      return response.chat;
    },
    stopChat: async (
      sessionId: string,
      chatId: string,
    ): Promise<EngineChat> => {
      const response = await paw.api.post<{ chat: EngineChat }>(
        `${ENGINE_BASE}/sessions/${encodeURIComponent(sessionId)}` +
          `/chats/${encodeURIComponent(chatId)}/stop`,
      );
      return response.chat;
    },
    steerChat: (
      sessionId: string,
      chatId: string,
      text: string,
    ): Promise<void> =>
      paw.api.post<void>(
        `${ENGINE_BASE}/sessions/${encodeURIComponent(sessionId)}` +
          `/chats/${encodeURIComponent(chatId)}/steer`,
        { text },
      ),
    downloadArtifact: (sessionId: string, path: string): Promise<Blob> =>
      paw.api.download(
        `${ENGINE_BASE}/sessions/${encodeURIComponent(sessionId)}` +
          `/artifacts/file`,
        { query: { path } },
      ),
    answerClarification: (
      sessionId: string,
      chatId: string,
      clarificationId: string,
      answers: ClarificationAnswer[],
    ): Promise<void> =>
      paw.api.post<void>(
        `${ENGINE_BASE}/sessions/${encodeURIComponent(sessionId)}` +
          `/chats/${encodeURIComponent(chatId)}/clarification/answer`,
        {
          clarification_id: clarificationId,
          result: { status: "answered", answers },
        },
      ),
    listSettlementCards: async (
      sessionId: string,
      status?: string,
    ): Promise<SettlementCard[]> => {
      const response = await paw.api.get<{ cards: SettlementCard[] }>(
        `${ENGINE_BASE}/sessions/${encodeURIComponent(sessionId)}` +
          `/settlement/cards`,
        status ? { query: { status } } : undefined,
      );
      return response.cards ?? [];
    },
    confirmSettlementCard: async (
      sessionId: string,
      cardId: string,
      fields?: Record<string, string>,
    ): Promise<SettlementCard> => {
      const response = await paw.api.post<{ card: SettlementCard }>(
        `${ENGINE_BASE}/sessions/${encodeURIComponent(sessionId)}` +
          `/settlement/cards/${encodeURIComponent(cardId)}/confirm`,
        fields ? { fields } : {},
      );
      return response.card;
    },
    dismissSettlementCard: async (
      sessionId: string,
      cardId: string,
    ): Promise<SettlementCard> => {
      const response = await paw.api.post<{ card: SettlementCard }>(
        `${ENGINE_BASE}/sessions/${encodeURIComponent(sessionId)}` +
          `/settlement/cards/${encodeURIComponent(cardId)}/dismiss`,
      );
      return response.card;
    },
    listCronJobs: async (): Promise<CronJob[]> => {
      const response = await paw.api.get<{ jobs: CronJob[] }>(
        `${ENGINE_BASE}/cron/jobs`,
      );
      return response.jobs ?? [];
    },
    createCronJob: async (body: CronJobWrite): Promise<CronJob> => {
      const response = await paw.api.post<{ job: CronJob }>(
        `${ENGINE_BASE}/cron/jobs`,
        body,
      );
      return response.job;
    },
    deleteCronJob: (jobId: string): Promise<void> =>
      paw.api.delete<void>(
        `${ENGINE_BASE}/cron/jobs/${encodeURIComponent(jobId)}`,
      ),
    pauseCronJob: async (jobId: string): Promise<CronJob> => {
      const response = await paw.api.post<{ job: CronJob }>(
        `${ENGINE_BASE}/cron/jobs/${encodeURIComponent(jobId)}/pause`,
      );
      return response.job;
    },
    resumeCronJob: async (jobId: string): Promise<CronJob> => {
      const response = await paw.api.post<{ job: CronJob }>(
        `${ENGINE_BASE}/cron/jobs/${encodeURIComponent(jobId)}/resume`,
      );
      return response.job;
    },
    runCronJob: (jobId: string): Promise<void> =>
      paw.api.post<void>(
        `${ENGINE_BASE}/cron/jobs/${encodeURIComponent(jobId)}/run`,
      ),
    streamChatEvents: async function* (
      sessionId: string,
      chatId: string,
      options?: { afterSequenceNumber?: number; signal?: AbortSignal },
    ): AsyncGenerator<EngineStreamEvent> {
      const path =
        `${ENGINE_BASE}/sessions/${encodeURIComponent(sessionId)}` +
        `/chats/${encodeURIComponent(chatId)}/events`;
      const query =
        options?.afterSequenceNumber !== undefined
          ? { after_sequence_number: options.afterSequenceNumber }
          : undefined;
      for await (const frame of paw.api.events(path, {
        method: "GET",
        query,
        signal: options?.signal,
      })) {
        if (!frame.data) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(frame.data);
        } catch {
          continue;
        }
        if (typeof parsed !== "object" || parsed === null) continue;
        yield parsed as EngineStreamEvent;
      }
    },
  };
}

export type EngineApi = ReturnType<typeof createEngineApi>;
