import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { configChanges, createWorkspace, isAllowedHostname, newConfig, render, reviewPages, telegramPayload, transition, validateConfig, type Event, type Workspace } from "../../packages/domain/src/index.js";

const actor = "owner-1";
function perform(state: Workspace, event: Event): Workspace {
  const result = transition(state, actor, state.revision, event);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.state;
}
const click = (state: Workspace, action: string, value = "", newHarnessId?: string) => perform(state, { type: "button", action, value, ...(newHarnessId ? { newHarnessId } : {}) });
const enter = (state: Workspace, text: string) => perform(state, { type: "text", text });
function created(): Workspace {
  let s = createWorkspace(actor);
  s = click(s, "create", "", "h_abc123"); s = click(s, "mode", "advanced"); s = click(s, "template", "research"); s = click(s, "use_name"); return click(s, "save_new");
}
function applyReviewed(s: Workspace): Workspace {
  s = click(s, "review_details");
  while (render(s, actor).rows.flat().some(b => b.action === "review_next")) s = click(s, "review_next");
  return click(s, "apply");
}

describe("configuration contract", () => {
  it("accepts all supported templates with safe defaults", () => {
    for (const mode of ["simple", "advanced"] as const) for (const template of ["research", "writing", "blank"] as const) {
      const config = newConfig("h_xyz", mode, template);
      expect(validateConfig(config)).toEqual([]);
      expect(config.policy.approvalMode).toBe("all_writes");
      expect(config.tools).toEqual({ webRead: false, notesWrite: false });
    }
  });
  it("rejects unknown properties, malformed input, disabled approvals and invalid domains", () => {
    const values: unknown[] = [null, {}, { ...newConfig("h_x"), unexpected: true }, { ...newConfig("h_x"), id: { toString: null } }, { ...newConfig("h_x"), agent: null }, { ...newConfig("h_x"), tools: null }, { ...newConfig("h_x"), policy: null }];
    for (const value of values) expect(validateConfig(value).length).toBeGreaterThan(0);
    const c = newConfig("h_x");
    expect(validateConfig({ ...c, policy: { ...c.policy, approvalMode: "never" } }).length).toBeGreaterThan(0);
    expect(validateConfig({ ...c, tools: { ...c.tools, webRead: true } }).length).toBeGreaterThan(0);
    for (const host of ["localhost", "127.0.0.1", "foo.local", "http://example.org", "*.example.org", "EXAMPLE.ORG"]) expect(isAllowedHostname(host)).toBe(false);
    expect(isAllowedHostname("docs.example.org")).toBe(true);
  });
});

describe("workspace transitions", () => {
  it("creates an owner-scoped version with durable effects", () => {
    let s = createWorkspace(actor);
    const start = transition(s, actor, s.revision, { type: "button", action: "create", newHarnessId: "h_abc123" });
    expect(start.ok).toBe(true);
    if (!start.ok) throw new Error(start.message);
    expect(start.effects[0]?.type).toBe("save_draft");
    expect(s.draft).toBeNull();
    s = click(start.state, "mode", "simple"); s = click(s, "template", "research"); s = click(s, "use_name");
    const result = transition(s, actor, s.revision, { type: "button", action: "save_new" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.effects.map(e => e.type)).toEqual(["create_harness", "discard_draft"]);
    expect(result.state.harnesses[0]?.activeVersion).toBe(1);
    expect(result.state.harnesses[0]?.ownerId).toBe(actor);
  });
  it("does not leak or mutate on cross-owner, stale or forged actions", () => {
    const s = created(), before = structuredClone(s);
    expect(transition(s, "owner-2", s.revision, { type: "button", action: "pause" })).toMatchObject({ ok: false, code: "AUTH_DENIED" });
    expect(transition(s, actor, s.revision - 1, { type: "button", action: "pause" })).toMatchObject({ ok: false, code: "MENU_STALE" });
    expect(transition(s, actor, s.revision, { type: "button", action: "apply" })).toMatchObject({ ok: false });
    expect(() => render(s, "owner-2")).toThrow("Access denied");
    expect(s).toEqual(before);
  });
  it("does not let the owner open another owner's harness in a malformed mixed snapshot", () => {
    const s = createWorkspace(actor);
    const other = created().harnesses[0]!;
    s.harnesses.push({ ...other, ownerId: "owner-2" }); s.screen = "list";
    expect(render(s, actor).rows.flat().some(b => b.action === "open")).toBe(false);
    expect(transition(s, actor, s.revision, { type: "button", action: "open", value: other.id })).toMatchObject({ ok: false });
  });
  it("preserves an unfinished wizard through home and /cancel", () => {
    let s = click(createWorkspace(actor), "create", "", "h_new"); s = click(s, "mode", "advanced");
    s = perform(s, { type: "command", command: "/cancel" });
    expect(s.screen).toBe("home"); expect(s.draft?.config.mode).toBe("advanced");
    s = click(s, "continue"); expect(s.screen).toBe("template");
    s = perform(s, { type: "command", command: "/help" }); expect(s.screen).toBe("help");
    s = perform(s, { type: "command", command: "/start" }); expect(s.screen).toBe("home");
  });
  it("refuses to persist a credential or control characters", () => {
    let s = click(createWorkspace(actor), "create", "", "h_new"); s = click(s, "mode", "simple"); s = click(s, "template", "blank");
    const fakeKey = "sk-THIS_IS_A_FAKE_CREDENTIAL_123456789";
    for (const text of [fakeKey, "bad\u202ename", " ", "x".repeat(41)]) {
      const result = transition(s, actor, s.revision, { type: "text", text });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(fakeKey);
      expect(JSON.stringify(s)).not.toContain(fakeKey);
    }
  });
  it("creates an immutable new version only after an explicit review", () => {
    let s = created(); const original = structuredClone(s.harnesses[0]!.versions[0]!.config);
    s = click(s, "configure"); s = click(s, "edit", "model"); s = click(s, "model", "fast"); s = click(s, "back"); s = click(s, "review");
    expect(transition(s, actor, s.revision, { type: "button", action: "apply" }).ok).toBe(false);
    s = applyReviewed(s);
    expect(s.harnesses[0]!.activeVersion).toBe(2);
    expect(s.harnesses[0]!.versions[0]!.config).toEqual(original);
    expect(s.harnesses[0]!.versions[1]!.config.agent.modelProfile).toBe("fast");
  });
  it("rejects conflicting draft versions", () => {
    let s = created(); s = click(s, "configure"); s = click(s, "toggle_mode"); s = click(s, "review"); s = click(s, "review_details");
    const h = s.harnesses[0]!; h.versions.push({ version: 2, config: structuredClone(h.versions[0]!.config) }); h.activeVersion = 2;
    const result = transition(s, actor, s.revision, { type: "button", action: "apply" });
    expect(result).toMatchObject({ ok: false, code: "VERSION_CONFLICT" });
    expect(h.versions).toHaveLength(2);
  });
  it("restores history as a new version and keeps previous versions", () => {
    let s = created(); s = click(s, "configure"); s = click(s, "toggle_mode"); s = click(s, "review"); s = applyReviewed(s);
    s = click(s, "versions"); s = click(s, "restore", "1");
    expect(transition(s, actor, s.revision, { type: "button", action: "confirm_restore" }).ok).toBe(false);
    s = click(s, "restore_details");
    while (render(s, actor).rows.flat().some(b => b.action === "restore_next")) s = click(s, "restore_next");
    s = click(s, "confirm_restore");
    expect(s.harnesses[0]!.activeVersion).toBe(3);
    expect(s.harnesses[0]!.versions.map(v => v.version)).toEqual([1, 2, 3]);
    expect(s.harnesses[0]!.versions[2]!.config.mode).toBe("advanced");
  });
});

describe("scripted demo runs", () => {
  const start = (s: Workspace, n: number) => perform(s, { type: "button", action: "demo_start", newDemoRunId: `r_${n.toString(16).padStart(24, "0")}` });
  it("requires review and confirmation, captures the harness version, and clears history", () => {
    let s = created();
    expect(transition(s, actor, s.revision, { type: "button", action: "demo_start", newDemoRunId: `r_${"a".repeat(24)}` }).ok).toBe(false);
    s = click(s, "demo_task"); s = enter(s, "Plan <today> & tomorrow");
    expect(s.demoRuns ?? []).toHaveLength(0);
    expect(render(s, actor).paragraphs.join(" ")).toContain("scripted");
    s = start(s, 1);
    expect(s.demoRuns?.[0]).toMatchObject({ harnessId: "h_abc123", harnessVersion: 1, task: "Plan <today> & tomorrow" });
    const result = telegramPayload(render(s, actor), (() => { let i = 0; return () => `cb:${Buffer.alloc(24, ++i).toString("base64url")}`; })());
    expect(result.text).toContain("&lt;today&gt; &amp; tomorrow");
    expect(result.text).toContain("simulation");
    s = click(s, "demo_history"); s = click(s, "demo_clear"); s = click(s, "demo_clear_confirm");
    expect(s.demoRuns).toEqual([]); expect(JSON.stringify(s)).not.toContain("Plan <today>");
  });
  it("keeps only ten demos, rejects forged IDs, and blocks paused and cross-owner actions", () => {
    let s = created();
    for (let i = 1; i <= 11; i++) {
      s = click(s, "demo_task"); s = click(s, "demo_sample"); s = start(s, i);
      s = click(s, "home"); s = click(s, "list"); s = click(s, "open", "h_abc123");
    }
    expect(s.demoRuns).toHaveLength(10); expect(s.demoRuns?.[0]?.id).toBe(`r_${"2".padStart(24, "0")}`);
    expect(transition(s, "other-owner", s.revision, { type: "button", action: "demo_task" })).toMatchObject({ ok: false, code: "AUTH_DENIED" });
    s = click(s, "pause"); expect(render(s, actor).rows.flat().some(b => b.action === "demo_task")).toBe(false);
    expect(transition(s, actor, s.revision, { type: "button", action: "demo_task" }).ok).toBe(false);
    s = click(s, "home"); s = click(s, "demo_history");
    expect(transition(s, actor, s.revision, { type: "button", action: "demo_open", value: `r_${"f".repeat(24)}` }).ok).toBe(false);
  });
  it("rejects credentials and oversized tasks without saving them", () => {
    const s = click(created(), "demo_task");
    for (const text of ["sk-THIS_IS_A_FAKE_CREDENTIAL_123456789", "x".repeat(601), "x\u202ey"]) {
      const result = transition(s, actor, s.revision, { type: "text", text });
      expect(result.ok).toBe(false); expect(JSON.stringify(s)).not.toContain(text);
    }
  });
});

it("shows ChatGPT as selected but not connected", () => {
  const s = click(createWorkspace(actor), "connection");
  expect(render(s, actor).paragraphs.join(" ")).toContain("ChatGPT · not connected");
  expect(render(s, actor).paragraphs.join(" ")).toContain("scripted responses");
});

describe("complete configuration review", () => {
  it("exposes every character of long instruction and allowlist changes, without invalid Telegram messages", () => {
    const oldConfig = newConfig("h_x"); const changed = structuredClone(oldConfig);
    oldConfig.agent.instructions = "😀".repeat(2000);
    changed.agent.instructions = `${"😀".repeat(1999)}🚀`;
    changed.tools.webRead = true;
    changed.policy.allowedDomains = Array.from({ length: 5 }, (_, i) => `${"a".repeat(62)}.${"b".repeat(62)}.${"c".repeat(62)}.${"d".repeat(58)}${i}.com`);
    expect(validateConfig(changed)).toEqual([]);
    const pages = reviewPages(oldConfig, changed);
    const after = pages.filter(p => p.startsWith("instructions · After")).map(p => p.slice(p.indexOf("\n\n") + 2)).join("");
    expect(after).toBe(changed.agent.instructions);
    expect(pages.join("\n")).toContain(changed.policy.allowedDomains[4]);
    expect(configChanges(oldConfig, changed).join("\n")).toContain(changed.policy.allowedDomains[4]);
    expect(pages.every(p => p.length < 4096)).toBe(true);
  });
  it("requires every long instruction page before creating the harness", () => {
    let s = click(createWorkspace(actor), "create", "", "h_long"); s = click(s, "mode", "simple"); s = click(s, "template", "blank"); s = click(s, "use_name"); s = click(s, "edit", "instructions"); s = enter(s, "😀".repeat(2000));
    expect(s.screen).toBe("create_review");
    expect(transition(s, actor, s.revision, { type: "button", action: "save_new" }).ok).toBe(false);
    s = click(s, "create_details"); let pages = 1;
    while (render(s, actor).rows.flat().some(b => b.action === "create_next")) {
      expect(transition(s, actor, s.revision, { type: "button", action: "save_new" }).ok).toBe(false);
      s = click(s, "create_next"); pages++;
    }
    expect(pages).toBeGreaterThan(1); s = click(s, "save_new"); expect(s.harnesses[0]!.versions[0]!.config.agent.instructions).toBe("😀".repeat(2000));
  });
  it("keeps callback payloads opaque and escapes HTML", () => {
    const view = { title: "<agent>", paragraphs: ["A & B"], rows: [[{ label: "Save", action: "save", value: "private" }, { label: "Home", action: "home", value: "" }]] };
    let i = 0;
    const payload = telegramPayload(view, () => `cb:${Buffer.alloc(24, ++i).toString("base64url")}`);
    expect(payload.text).toBe("<b>&lt;agent&gt;</b>\n\nA &amp; B");
    expect(JSON.stringify(payload)).not.toContain("private");
    expect(() => telegramPayload(view, () => "save:private")).toThrow();
    expect(() => telegramPayload(view, () => `cb:${"a".repeat(32)}`)).toThrow("unique");
  });
});
