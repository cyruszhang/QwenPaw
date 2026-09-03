import { describe, expect, it } from "vitest";

import {
  createChatStreamState,
  finalizeChatStreamState,
  parseClarificationRequest,
  previewKindForArtifact,
  reduceChatStreamEvent,
  replayChatTranscript,
} from "./ChatWorkspace";
import type { EngineApi, EngineChat, EngineStreamEvent } from "./engineApi";

const ASK_USER_QUESTION_EVENT: EngineStreamEvent = {
  object: "message",
  id: "msg_1",
  type: "plugin_call",
  status: "completed",
  content: [
    {
      object: "content",
      type: "data",
      data: {
        call_id: "call_1",
        name: "ask_user_question",
        arguments: JSON.stringify({
          title: "口径确认",
          questions: [
            {
              question: "取哪种口径?",
              multiSelect: false,
              options: [
                { label: "GAAP" },
                { label: "Non-GAAP", description: "调整后" },
              ],
            },
            {
              question: "包含哪些地区?",
              multiSelect: true,
              options: [{ label: "国内" }, { label: "海外" }],
            },
          ],
        }),
      },
    },
  ],
};

describe("engine clarification parsing", () => {
  it("parses an ask_user_question plugin call into a card request", () => {
    const request = parseClarificationRequest(ASK_USER_QUESTION_EVENT);
    expect(request).not.toBeNull();
    expect(request?.id).toBe("call_1");
    expect(request?.title).toBe("口径确认");
    expect(request?.questions).toHaveLength(2);
    expect(request?.questions[0].multiSelect).toBe(false);
    expect(request?.questions[0].options.map((o) => o.label)).toEqual([
      "GAAP",
      "Non-GAAP",
    ]);
    expect(request?.questions[1].multiSelect).toBe(true);
  });

  it("ignores other plugin calls and malformed payloads", () => {
    expect(
      parseClarificationRequest({
        object: "message",
        type: "plugin_call",
        status: "completed",
        content: [
          {
            object: "content",
            type: "data",
            data: { call_id: "call_2", name: "execute_sql", arguments: "{}" },
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseClarificationRequest({
        object: "message",
        type: "message",
        status: "completed",
      }),
    ).toBeNull();
    expect(
      parseClarificationRequest({
        object: "message",
        type: "plugin_call",
        status: "completed",
        content: [
          {
            object: "content",
            type: "data",
            data: {
              call_id: "call_3",
              name: "ask_user_question",
              arguments: JSON.stringify({
                title: "t",
                questions: [{ question: "q", multiSelect: false, options: [] }],
              }),
            },
          },
        ],
      }),
    ).toBeNull();
  });
});

describe("finalizeChatStreamState", () => {
  it("seals an unfinished stream with the fallback text", () => {
    let state = createChatStreamState();
    state = reduceChatStreamEvent(state, {
      object: "content",
      type: "text",
      delta: true,
      msg_id: "m1",
      text: "部分回答",
    });
    const sealed = finalizeChatStreamState(state, "fallback");
    expect(sealed.completed).toBe(true);
    expect(sealed.finalText).toBe("部分回答");
    expect(finalizeChatStreamState(sealed, "other")).toBe(sealed);
  });

  it("uses the fallback when no text streamed", () => {
    const sealed = finalizeChatStreamState(createChatStreamState(), "已停止");
    expect(sealed.finalText).toBe("已停止");
  });
});

describe("replayChatTranscript", () => {
  function engineWithEvents(events: EngineStreamEvent[]): EngineApi {
    return {
      streamChatEvents: async function* () {
        for (const event of events) yield event;
      },
    } as unknown as EngineApi;
  }

  const baseChat: EngineChat = {
    id: "chat_1",
    session_id: "ses_1",
    sequence: 1,
    user_input: "GMV 口径是什么",
    kind: "simple",
    status: "completed",
    last_sequence_number: 5,
  };

  it("rebuilds a finished chat as a user/assistant pair", async () => {
    const engine = engineWithEvents([
      {
        object: "content",
        type: "text",
        delta: true,
        msg_id: "m1",
        text: "支付口径",
      },
      { object: "followup.generated", followup: { questions: ["然后呢?"] } },
      {
        object: "response",
        status: "completed",
        output: [],
      },
    ]);
    const messages = await replayChatTranscript(
      engine,
      baseChat,
      "zh",
      "无文本回复",
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", text: "GMV 口径是什么" });
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].streaming).toBe(false);
    expect(messages[1].text).toBe("支付口径");
  });

  it("surfaces the stored failure for failed chats", async () => {
    const engine = engineWithEvents([]);
    const messages = await replayChatTranscript(
      engine,
      {
        ...baseChat,
        status: "failed",
        error: { code: "VALIDATION", message: "模型不可用" },
      },
      "zh",
      "无文本回复",
    );
    expect(messages[1].text).toContain("模型不可用");
  });
});

describe("console-grade turn rendering", () => {
  it("collects segments, artifacts and the plan from engine frames", () => {
    let state = createChatStreamState();
    state = reduceChatStreamEvent(state, {
      object: "task_status",
      event_type: "graph_updated",
      graph_snapshot: {
        name: "GMV 波动分析",
        nodes: [
          { node_id: "n1", name: "取数", description: "拉取指标" },
          { node_id: "n2", name: "下钻", state: "in_progress" },
        ],
      },
    } as never);
    state = reduceChatStreamEvent(state, {
      object: "segment",
      segment: {
        segment_id: "seg_1",
        title: "取数",
        behavior: "运行 SQL",
        conclusion: '增长 <span class="text-green-600 font-bold">12%</span>',
        artifact: [
          {
            name: "chart.png",
            description: "趋势图",
            relative_path: "graph_1/chart.png",
          },
        ],
        started_at: 10,
        ended_at: 25,
        coverage: { start_seq: 0, end_seq: 3 },
      },
    } as never);
    // duplicate segment ids collapse
    state = reduceChatStreamEvent(state, {
      object: "segment",
      segment: {
        segment_id: "seg_1",
        title: "取数",
        coverage: { start_seq: 0, end_seq: 3 },
      },
    } as never);
    state = reduceChatStreamEvent(state, {
      object: "artifact.registered",
      artifact: { name: "chart.png", path: "chart.png" },
    } as never);
    state = reduceChatStreamEvent(state, {
      object: "artifact.registered",
      artifact: { name: "chart.png", path: "chart.png" },
    } as never);

    expect(state.plan?.name).toBe("GMV 波动分析");
    expect(state.plan?.nodes.map((n) => n.state)).toEqual([
      undefined,
      "in_progress",
    ]);
    expect(state.segments).toHaveLength(1);
    expect(state.segments[0].conclusion).toBe("增长 12%");
    expect(state.segments[0].durationSeconds).toBe(15);
    expect(state.segments[0].artifacts).toEqual([
      { name: "chart.png", description: "趋势图", path: "graph_1/chart.png" },
    ]);
    expect(state.artifacts).toEqual([{ name: "chart.png", path: "chart.png" }]);
  });

  it("ignores malformed segment and plan payloads", () => {
    let state = createChatStreamState();
    state = reduceChatStreamEvent(state, {
      object: "segment",
      segment: { no_title: true },
    } as never);
    state = reduceChatStreamEvent(state, {
      object: "task_status",
      event_type: "graph_updated",
      graph_snapshot: { nodes: "nope" },
    } as never);
    state = reduceChatStreamEvent(state, {
      object: "artifact.registered",
      artifact: {},
    } as never);
    expect(state.segments).toEqual([]);
    expect(state.plan).toBeNull();
    expect(state.artifacts).toEqual([]);
  });
});

describe("artifact preview kinds", () => {
  it("maps extensions to preview strategies", () => {
    expect(previewKindForArtifact("report.html")).toBe("iframe");
    expect(previewKindForArtifact("map.SVG")).toBe("iframe");
    expect(previewKindForArtifact("trend.png")).toBe("image");
    expect(previewKindForArtifact("daily.csv")).toBe("text");
    expect(previewKindForArtifact("build_sections.py")).toBeNull();
  });
});
