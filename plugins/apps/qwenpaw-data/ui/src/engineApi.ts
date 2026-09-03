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
          `/artifacts/file?path=${encodeURIComponent(path)}`,
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
