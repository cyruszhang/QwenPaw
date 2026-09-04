import { describe, expect, it } from "vitest";

import { localeTag, stringKeys, translate } from "./strings";

describe("string tables", () => {
  it("has a non-empty translation for every key in both languages", () => {
    for (const key of stringKeys()) {
      expect(translate("en", key), `en:${key}`).toBeTruthy();
      expect(translate("zh", key), `zh:${key}`).toBeTruthy();
    }
  });

  it("interpolates named parameters", () => {
    expect(
      translate("en", "session.actionFailed", {
        action: "pin",
        detail: "boom",
      }),
    ).toBe("Could not pin the dialogue. boom");
    expect(
      translate("zh", "status.detail.sourcesReady", { ready: 2, total: 3 }),
    ).toBe("2/3 个数据源就绪");
  });

  it("maps languages to BCP 47 locale tags", () => {
    expect(localeTag("zh")).toBe("zh-CN");
    expect(localeTag("en")).toBe("en-US");
  });
});
