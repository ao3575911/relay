import { describe, expect, it } from "vitest";
import { claimNextModelRun, createWorkspace, maxOutputTokensForBudget, MODEL_FAILURE_TEXT, render, settleModelRun, transition, type Workspace } from "../../packages/domain/src/index.js";

const actor = "owner-1";
function created(): Workspace {
  let state = createWorkspace(actor);
  const steps = [
    { type: "button" as const, action: "create", newHarnessId: "h_abc123" },
    { type: "button" as const, action: "mode", value: "simple" },
    { type: "button" as const, action: "template", value: "research" },
    { type: "button" as const, action: "use_name" },
    { type: "button" as const, action: "save_new" },
  ];
  for (const event of steps) {
    const result = transition(state, actor, state.revision, event);
    if (!result.ok) throw new Error(result.message);
    state = result.state;
  }
  return state;
}
function reviewed(task = "Plan a week"): Workspace {
  let state = created();
  for (const event of [{ type: "button" as const, action: "demo_task" }, { type: "text" as const, text: task }]) {
    const result = transition(state, actor, state.revision, event);
    if (!result.ok) throw new Error(result.message);
    state = result.state;
  }
  return state;
}

describe("model runs", () => {
  it("caps output tokens inside half of the smallest run budget at $30 per million", () => {
    expect(maxOutputTokensForBudget(50)).toBe(2048);
    expect((2048 * 30) / 1_000_000).toBeLessThan(0.25);
  });
  it("reserves the daily budget and keeps the run pending until a model answers", () => {
    const state = reviewed();
    expect(render(state, actor, { modelConfigured: true }).paragraphs.join(" ")).toContain("calls the model once");
    const result = transition(state, actor, state.revision, { type: "button", action: "demo_start", newDemoRunId: `r_${"a".repeat(24)}`, modelRun: { day: "2026-11-11" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.modelSpend).toEqual({ day: "2026-11-11", reservedCents: 50 });
    expect(result.state.demoRuns?.[0]).toMatchObject({ source: "model", status: "pending", timeoutSeconds: 90, maxOutputTokens: 2048, reservedCents: 50 });
    expect(render(result.state, actor).title).toBe("Run in progress");
    expect(render(result.state, actor).paragraphs.join(" ")).not.toContain("simulation");
  });
  it("refuses another model run once the reserved daily budget is spent", () => {
    let state = reviewed();
    state = { ...state, modelSpend: { day: "2026-11-11", reservedCents: 500 } };
    const result = transition(state, actor, state.revision, { type: "button", action: "demo_start", newDemoRunId: `r_${"b".repeat(24)}`, modelRun: { day: "2026-11-11" } });
    expect(result).toMatchObject({ ok: false, code: "BUDGET_EXCEEDED" });
    expect(state.demoRuns ?? []).toHaveLength(0);
  });
  it("does not call the provider again for a stale run, and withholds credential-like output", () => {
    const state = reviewed();
    const started = transition(state, actor, state.revision, { type: "button", action: "demo_start", newDemoRunId: `r_${"c".repeat(24)}`, modelRun: { day: "2026-11-11" } });
    if (!started.ok) throw new Error("start failed");
    const claimed = claimNextModelRun(started.state, actor, 1_000);
    expect(claimed.type).toBe("ready");
    if (claimed.type !== "ready") return;
    expect(claimNextModelRun(claimed.state, actor, 1_000).type).toBe("idle");
    const stale = claimNextModelRun(claimed.state, actor, 1_000 + 90_000 + 15_000);
    expect(stale.type).toBe("expired");
    if (stale.type !== "expired") return;
    expect(stale.state.demoRuns?.[0]?.output).toBe(MODEL_FAILURE_TEXT.TIMEOUT);
    expect(stale.state.modelSpend?.reservedCents).toBe(0);
    const settled = settleModelRun(claimed.state, actor, claimed.run.id, { status: "complete", output: "Here is sk-THIS_IS_A_FAKE_CREDENTIAL_123456789 in the answer" });
    expect(settled?.demoRuns?.[0]).toMatchObject({ status: "failed", output: MODEL_FAILURE_TEXT.OUTPUT_UNSAFE });
    const answer = settleModelRun(claimed.state, actor, claimed.run.id, { status: "complete", output: "  A short plan.  " });
    expect(answer?.demoRuns?.[0]).toMatchObject({ status: "complete", output: "A short plan." });
    expect(render(answer!, actor).paragraphs.join("\n")).toContain("A short plan.");
  });
});
