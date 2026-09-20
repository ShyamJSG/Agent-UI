import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CodexSummaryProvider } from "./codexProvider";

describe("CodexSummaryProvider", () => {
  it("uses an isolated app-server context and returns its agent message", async () => {
    const provider = new CodexSummaryProvider({
      executable: process.execPath,
      args: [resolve(process.cwd(), "server/test-fixtures/fake-summary-app-server.cjs")],
      cwd: process.cwd(),
    });
    await expect(provider.complete("summary input")).resolves.toContain('"kind":"no-change"');
  });
});
