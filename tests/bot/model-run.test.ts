import { describe, expect, it, vi } from "vitest";
import { ChatGptError } from "../../packages/chatgpt/src/index.js";
import { executePendingModelRun } from "../../apps/bot/src/model-run.js";
import { createWorkspace, MODEL_FAILURE_TEXT, transition, type Workspace } from "../../packages/domain/src/index.js";
import type { Json, RelayStore } from "../../packages/storage/src/index.js";

const ownerId = "owner-1";
function pendingWorkspace(): Workspace {
  let state = createWorkspace(ownerId);
  const events = [
    { type: "button" as const, action: "create", newHarnessId: "h_abc123" },
    { type: "button" as const, action: "mode", value: "simple" },
    { type: "button" as const, action: "template", value: "research" },
    { type: "button" as const, action: "use_name" },
    { type: "button" as const, action: "save_new" },
    { type: "button" as const, action: "demo_task" },
    { type: "text" as const, text: "Plan a week" },
    { type: "button" as const, action: "demo_start", newDemoRunId: `r_${"a".repeat(24)}`, modelRun: { day: "2026-11-11" } },
  ];
  for (const event of events) {
    const result = transition(state, ownerId, state.revision, event);
    if (!result.ok) throw new Error(result.message);
    state = result.state;
  }
  return state;
}
function memoryStore(workspace: Workspace) {
  let revision = workspace.revision;
  let stored = { workspace, panelMessageId: "42" };
  const outbox: { key: string; payload: Json }[] = [];
  const tx = {
    async getWorkspace() { return { state: structuredClone(stored) as unknown as Json, revision }; },
    async saveWorkspace(state: Json, expected: number) {
      if (expected !== revision) throw new Error("conflict");
      stored = structuredClone(state) as unknown as typeof stored;
      revision += 1;
      return revision;
    },
    async enqueueOutbox(key: string, payload: Json) { outbox.push({ key, payload }); return true; },
  };
  const store = {
    async listOwnerIds() { return [ownerId]; },
    async getPrivateChatId() { return "123"; },
    async withOwner<T>(_owner: string, operation: (transaction: typeof tx) => Promise<T>) { return operation(tx); },
  };
  return { store: store as unknown as RelayStore, outbox, read: () => stored.workspace };
}

describe("model run executor", () => {
  it("calls the provider once and stores the answer", async () => {
    const { store, outbox, read } = memoryStore(pendingWorkspace());
    const generate = vi.fn(async () => "Ship the notes.");
    expect(await executePendingModelRun(store, "gpt-6-luna", generate, 5_000)).toBe("settled");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-6-luna", task: "Plan a week", timeoutMs: 90_000, maxOutputTokens: 2048 }));
    expect(read().demoRuns?.[0]).toMatchObject({ status: "complete", output: "Ship the notes." });
    expect(outbox[0]?.payload).toMatchObject({ kind: "edit_panel_view", chatId: "123", messageId: "42" });
    expect(await executePendingModelRun(store, "gpt-6-luna", generate, 5_000)).toBe("idle");
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("records a redacted failure and does not retry the provider", async () => {
    const { store, read } = memoryStore(pendingWorkspace());
    const generate = vi.fn(async () => { throw new ChatGptError("TIMEOUT"); });
    await executePendingModelRun(store, "gpt-6-luna", generate, 5_000);
    expect(read().demoRuns?.[0]?.output).toBe(MODEL_FAILURE_TEXT.TIMEOUT);
    expect(read().modelSpend?.reservedCents).toBe(0);
    await executePendingModelRun(store, "gpt-6-luna", generate, 6_000);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
