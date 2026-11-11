/** Pure Relay M1 domain. Persist returned effects atomically before showing a view. */

export type Mode = "simple" | "advanced";
export type Template = "research" | "writing" | "blank";
export type ModelProfile = "balanced" | "fast";
export interface HarnessConfig {
  schemaVersion: 1;
  id: string;
  name: string;
  mode: Mode;
  agent: { instructions: string; modelProfile: ModelProfile };
  tools: { webRead: boolean; notesWrite: boolean };
  policy: {
    approvalMode: "all_writes";
    memory: "off" | "run";
    runBudgetCents: 50 | 100 | 200;
    dailyBudgetCents: 500 | 1000;
    maxSteps: 4 | 8 | 12;
    timeoutSeconds: 30 | 90 | 180;
    allowedDomains: string[];
  };
}

export type Screen = "home" | "list" | "mode" | "template" | "name" | "create_review" | "create_detail" | "detail" | "config" | "instructions" | "model" | "tools" | "domains" | "limits" | "memory" | "review" | "review_detail" | "versions" | "restore" | "restore_detail" | "help" | "export" | "demo_task" | "demo_review" | "demo_result" | "demo_history" | "demo_clear" | "connection";
export interface Harness {
  id: string;
  ownerId: string;
  activeVersion: number;
  paused: boolean;
  versions: { version: number; config: HarnessConfig }[];
}
export interface Draft {
  config: HarnessConfig;
  /** Null identifies a not-yet-created harness. */
  baseVersion: number | null;
  cursor: Screen;
  instructionReturn: "create_review" | "config";
}
export type ModelRunStatus = "pending" | "running" | "complete" | "failed";
export type ModelFailureCode = "TIMEOUT" | "CANCELLED" | "LIMIT_REACHED" | "UNAVAILABLE" | "NETWORK" | "INVALID_REQUEST" | "OUTPUT_TOO_LARGE" | "OUTPUT_UNSAFE" | "FAILED";
/** Fixed user-facing text. Provider bodies and credentials never go here. */
export const MODEL_FAILURE_TEXT: Record<ModelFailureCode, string> = {
  TIMEOUT: "The model run timed out.",
  CANCELLED: "The model run was cancelled.",
  LIMIT_REACHED: "The model provider limited this run.",
  UNAVAILABLE: "The model provider is unavailable. Try again later.",
  NETWORK: "Relay could not reach the model provider.",
  INVALID_REQUEST: "The model request was rejected.",
  OUTPUT_TOO_LARGE: "The model output was too long.",
  OUTPUT_UNSAFE: "The model output was withheld because it looked like a credential.",
  FAILED: "The model run failed.",
};
/** Visible answer cap so the Telegram panel stays inside the 4096-character limit. */
export const MODEL_OUTPUT_CHARS = 2400;
export interface DemoRun {
  id: string;
  harnessId: string;
  harnessName: string;
  harnessVersion: number;
  task: string;
  /** Absent means the original scripted example. */
  source?: "scripted" | "model";
  status?: ModelRunStatus;
  output?: string;
  timeoutSeconds?: 30 | 90 | 180;
  maxOutputTokens?: number;
  reservedCents?: number;
  startedAtMs?: number;
}
export interface Workspace {
  ownerId: string;
  revision: number;
  screen: Screen;
  selectedId: string | null;
  harnesses: Harness[];
  draft: Draft | null;
  restoreVersion: number | null;
  reviewIndex: number;
  /** Optional for compatibility with workspaces created before the demo flow. */
  demoTask?: string | null;
  demoRuns?: DemoRun[];
  selectedDemoRunId?: string | null;
  /** Run-budget reservations for one UTC day. This is not a provider invoice. */
  modelSpend?: { day: string; reservedCents: number };
}
export interface Button { label: string; action: string; value: string }
export interface View { title: string; paragraphs: string[]; rows: Button[][]; input?: { label: string; maxLength: number } }
export type Event = { type: "button"; action: string; value?: string; newHarnessId?: string; newDemoRunId?: string; modelRun?: { day: string } } | { type: "text"; text: string } | { type: "command"; command: "/start" | "/help" | "/cancel" };
export type Effect =
  | { type: "create_harness"; ownerId: string; config: HarnessConfig }
  | { type: "save_draft"; ownerId: string; draft: Draft }
  | { type: "discard_draft"; ownerId: string }
  | { type: "commit_draft"; ownerId: string; harnessId: string; baseVersion: number; config: HarnessConfig }
  | { type: "set_paused"; ownerId: string; harnessId: string; paused: boolean }
  | { type: "restore_version"; ownerId: string; harnessId: string; baseVersion: number; restoredVersion: number; config: HarnessConfig }
  | { type: "verify_demo"; ownerId: string; harnessId: string; baseVersion: number; config: HarnessConfig }
  | { type: "export_config"; ownerId: string; harnessId: string; config: HarnessConfig };
export type Transition = { ok: true; state: Workspace; effects: Effect[]; notice?: string } | { ok: false; code: string; message: string };

const secretPattern = /(?:sk-[a-z0-9_-]{16,}|\d{8,}:[a-z0-9_-]{20,})/i;
// Reject control and bidirectional override characters in user-provided text.
// eslint-disable-next-line no-control-regex
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;
const hostname = /^(?!.*(?:^|\.)localhost$)(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const localSuffix = /(?:^|\.)(?:local|internal|test|invalid)$/u;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: unknown, fields: string[]): value is Record<string, unknown> => isObject(value) && Object.keys(value).sort().join(",") === [...fields].sort().join(",");
export const isSafeText = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= max && !controls.test(value) && !secretPattern.test(value);
export const isAllowedHostname = (value: unknown): value is string => typeof value === "string" && hostname.test(value) && !localSuffix.test(value);

/**
 * Output-token cap for one Responses call.
 * Half of the run budget is treated as output spend at $30 per million tokens,
 * which is above current non-pro OpenAI text prices. The other half is left
 * for input. A model priced above that assumption can still exceed the budget.
 */
export function maxOutputTokensForBudget(runBudgetCents: number): number {
  if (runBudgetCents !== 50 && runBudgetCents !== 100 && runBudgetCents !== 200) throw new TypeError("Unsupported run budget.");
  const outputBudgetUsd = (runBudgetCents / 100) * 0.5;
  const tokens = Math.floor((outputBudgetUsd / 30) * 1_000_000);
  return Math.min(2048, Math.max(64, tokens));
}

/** Schema v1 plus application text checks; hostname syntax alone is not SSRF protection. */
export function validateConfig(value: unknown): string[] {
  const issues: string[] = [];
  if (!exact(value, ["schemaVersion", "id", "name", "mode", "agent", "tools", "policy"])) return ["Invalid configuration fields."];
  if (value.schemaVersion !== 1 || typeof value.id !== "string" || !/^h_[a-z0-9]{1,32}$/u.test(value.id)) issues.push("Invalid configuration identity.");
  if (!isSafeText(value.name, 40)) issues.push("Use a name between 1 and 40 characters.");
  if (value.mode !== "simple" && value.mode !== "advanced") issues.push("Choose Simple or Advanced.");
  if (!exact(value.agent, ["instructions", "modelProfile"]) || !isSafeText(value.agent.instructions, 2000) || (value.agent.modelProfile !== "fast" && value.agent.modelProfile !== "balanced")) issues.push("Check the agent instructions and model profile.");
  if (!exact(value.tools, ["webRead", "notesWrite"]) || typeof value.tools.webRead !== "boolean" || typeof value.tools.notesWrite !== "boolean") issues.push("Invalid tool configuration.");
  if (!exact(value.policy, ["approvalMode", "memory", "runBudgetCents", "dailyBudgetCents", "maxSteps", "timeoutSeconds", "allowedDomains"])) return [...issues, "Invalid policy fields."];
  const policy = value.policy;
  if (policy.approvalMode !== "all_writes") issues.push("Approval is required for every write.");
  if (policy.memory !== "off" && policy.memory !== "run") issues.push("Choose a valid memory setting.");
  if (![50, 100, 200].includes(policy.runBudgetCents as number) || ![500, 1000].includes(policy.dailyBudgetCents as number)) issues.push("Choose a supported budget.");
  if (![4, 8, 12].includes(policy.maxSteps as number) || ![30, 90, 180].includes(policy.timeoutSeconds as number)) issues.push("Choose supported runtime limits.");
  const domains = policy.allowedDomains;
  if (!Array.isArray(domains) || domains.length > 5 || domains.some(d => !isAllowedHostname(d)) || new Set(domains).size !== domains.length) issues.push("Use up to five unique public hostnames.");
  else if (isObject(value.tools) && value.tools.webRead === true && domains.length === 0) issues.push("Add an allowed domain before enabling web reading.");
  return issues;
}

export function newConfig(id: string, mode: Mode = "simple", template: Template = "research"): HarnessConfig {
  const templates: Record<Template, [string, string]> = {
    research: ["Scout", "Research a topic. Return a short brief with evidence, uncertainties and next steps."],
    writing: ["Scribe", "Help write clear, thoughtful text. Ask for missing context and keep the requested tone."],
    blank: ["My agent", "Help with the assigned task. State assumptions and ask before making changes."],
  };
  const entry = templates[template];
  if (!entry || !/^h_[a-z0-9]{1,32}$/u.test(id) || !["simple", "advanced"].includes(mode)) throw new TypeError("Invalid template, mode or harness ID.");
  return { schemaVersion: 1, id, name: entry[0], mode, agent: { instructions: entry[1], modelProfile: "balanced" }, tools: { webRead: false, notesWrite: false }, policy: { approvalMode: "all_writes", memory: "off", runBudgetCents: 50, dailyBudgetCents: 500, maxSteps: 8, timeoutSeconds: 90, allowedDomains: [] } };
}
export function createWorkspace(ownerId: string): Workspace {
  if (!ownerId) throw new TypeError("Owner ID is required.");
  return { ownerId, revision: 0, screen: "home", selectedId: null, harnesses: [], draft: null, restoreVersion: null, reviewIndex: 0 };
}
const button = (label: string, action: string, value = ""): Button => ({ label, action, value });
const home = () => [button("Home", "home")];
const back = () => [button("‹ Back", "back")];
const money = (n: number) => `$${(n / 100).toFixed(2)}`;
function current(w: Workspace): Harness | undefined { return w.harnesses.find(h => h.id === w.selectedId && h.ownerId === w.ownerId); }
function configOf(h: Harness): HarnessConfig | undefined { return h.versions.find(v => v.version === h.activeVersion)?.config; }
function summary(c: HarnessConfig): string {
  return `${c.mode === "simple" ? "Simple" : "Advanced"} · ${c.agent.modelProfile} model\n${money(c.policy.runBudgetCents)} / run · ${money(c.policy.dailyBudgetCents)} / day (UTC)\n${c.policy.maxSteps} steps · ${c.policy.timeoutSeconds}s active time\nWeb reading ${c.tools.webRead ? "on" : "off"} · Save notes ${c.tools.notesWrite ? "on, approval required" : "off"}\nMemory: ${c.policy.memory === "off" ? "off" : "this run only"}`;
}
function changedFields(before: HarnessConfig, after: HarnessConfig): { name: string; before: string; after: string }[] {
  const fields: [string, (c: HarnessConfig) => string | number | boolean][] = [
    ["name", c => c.name], ["mode", c => c.mode], ["instructions", c => c.agent.instructions], ["model", c => c.agent.modelProfile], ["web reading", c => c.tools.webRead], ["save notes", c => c.tools.notesWrite], ["memory", c => c.policy.memory], ["run cap", c => money(c.policy.runBudgetCents)], ["daily cap", c => money(c.policy.dailyBudgetCents)], ["steps", c => c.policy.maxSteps], ["active timeout", c => c.policy.timeoutSeconds], ["allowed domains", c => c.policy.allowedDomains.join(", ") || "none"],
  ];
  return fields.filter(([, get]) => get(before) !== get(after)).map(([name, get]) => ({ name, before: String(get(before)), after: String(get(after)) }));
}
export function configChanges(before: HarnessConfig, after: HarnessConfig): string[] {
  return changedFields(before, after).map(field => `${field.name}: ${field.before} → ${field.after}`);
}
/** Full before and after values, split on Unicode code-point boundaries. */
function splitText(value: string, maxLength = 1400): string[] {
  const chunks: string[] = []; let chunk = "";
  for (const cp of value) {
    if (chunk.length + cp.length > maxLength) { chunks.push(chunk); chunk = ""; }
    chunk += cp;
  }
  if (chunk || !chunks.length) chunks.push(chunk);
  return chunks;
}
function instructionPreview(instructions: string): string {
  return instructions.length <= 1000 ? instructions : `${splitText(instructions, 400)[0]}…\n\nPreview only; the full instructions appear during review.`;
}
function creationPages(config: HarnessConfig): string[] { return splitText(config.agent.instructions); }
export function reviewPages(before: HarnessConfig, after: HarnessConfig): string[] {
  const pages: string[] = [];
  for (const field of changedFields(before, after)) {
    if (field.before.length + field.after.length <= 1200) {
      pages.push(`${field.name}\n\nBefore:\n${field.before}\n\nAfter:\n${field.after}`);
      continue;
    }
    for (const [side, value] of [["Before", field.before], ["After", field.after]] as const) {
      const chunks = splitText(value);
      chunks.forEach((part, index) => pages.push(`${field.name} · ${side} (${index + 1}/${chunks.length})\n\n${part}`));
    }
  }
  return pages;
}
function modelResultView(run: DemoRun): View {
  const heading = `${run.harnessName} · version ${run.harnessVersion}`;
  const task = `Task:\n${run.task}`;
  const rows = [[button("Demo history", "demo_history")], home()];
  if (run.status === "pending" || run.status === "running") {
    return { title: "Run in progress", paragraphs: [heading, task, "Relay is calling the model. You can leave this screen. The result stays in demo history.", "Tools stay off."], rows };
  }
  if (run.status === "failed") {
    return { title: "Run failed", paragraphs: [heading, task, run.output ?? MODEL_FAILURE_TEXT.FAILED, "No tools were called. A failed run releases its reserved budget."], rows };
  }
  return { title: "Run complete", paragraphs: [heading, task, run.output ?? MODEL_FAILURE_TEXT.FAILED, "Tools were not called. The operator's OpenAI API key was used."], rows };
}
export interface RenderOptions { modelConfigured?: boolean }
/** A view contains semantic actions only; the adapter must issue opaque bound tokens. */
export function render(w: Workspace, actorId: string, options?: RenderOptions): View {
  if (!actorId || w.ownerId !== actorId) throw new Error("Access denied.");
  const live = options?.modelConfigured === true;
  const h = current(w), c = h && configOf(h), d = w.draft?.config;
  if (["detail", "config", "review", "review_detail", "versions", "restore", "restore_detail", "export", "demo_task", "demo_review"].includes(w.screen) && !c) throw new Error("Harness unavailable.");
  if (["mode", "template", "name", "create_review", "create_detail", "config", "instructions", "model", "tools", "domains", "limits", "memory", "review", "review_detail"].includes(w.screen) && !d) throw new Error("Draft unavailable.");
  switch (w.screen) {
    case "home": return { title: "Your agents. Your rules.", paragraphs: ["Create an agent, give it boundaries, and explore the demo workflow.", `${w.harnesses.filter(x => x.ownerId === actorId).length} harnesses · ${live ? "OpenAI API configured" : "ChatGPT not connected"}`], rows: [[button("Create harness", "create")], [button("My harnesses", "list"), button("Demo history", "demo_history")], [button("AI connection", "connection"), button("Help & safety", "help")], ...(d ? [[button("Continue draft", "continue")]] : [])] };
    case "connection": return live
      ? { title: "AI connection", paragraphs: ["OpenAI API · configured by the operator", "Runs call the Responses API with the operator's API key. Tools stay off. Sign in with ChatGPT is not connected to this bot.", "Relay reserves the harness run budget before the call. That reservation is not an invoice."], rows: [home()] }
      : { title: "AI connection", paragraphs: ["ChatGPT · not connected", "ChatGPT is the selected provider. Sign-in for an eligible account is not available in this build yet.", "The demo uses scripted responses and does not use your ChatGPT plan."], rows: [home()] };
    case "list": return { title: "My harnesses", paragraphs: ["Choose a harness to configure or pause."], rows: [...w.harnesses.filter(x => x.ownerId === actorId && configOf(x)).map(x => [button(`${configOf(x)!.name} · v${x.activeVersion}${x.paused ? " · paused" : ""}`, "open", x.id)]), [button("Create harness", "create")], home()] };
    case "mode": return { title: "How would you like to build?", paragraphs: ["Simple gives you sensible defaults. Advanced adds model, tool and runtime controls.", "Both modes configure write approvals and spending limits. Live enforcement requires a runtime."], rows: [[button("Simple · guided setup", "mode", "simple")], [button("Advanced · more control", "mode", "advanced")], home()] };
    case "template": return { title: "Choose a starting point", paragraphs: ["You can change the instructions and tools at any time."], rows: [[button("Research assistant", "template", "research")], [button("Writing partner", "template", "writing"), button("Start from scratch", "template", "blank")], back()] };
    case "name": return { title: "Give your harness a name", paragraphs: ["Keep it short and recognisable. You can use the suggestion below."], rows: [[button(`Use “${d!.name}”`, "use_name")], back()], input: { label: "Harness name", maxLength: 40 } };
    case "create_review": return { title: `Meet ${d!.name}`, paragraphs: [instructionPreview(d!.agent.instructions), summary(d!), "Your harness starts with no connected accounts. You can customise it after creation."], rows: [[d!.agent.instructions.length > 1000 ? button("Review full instructions", "create_details") : button("Create harness", "save_new")], [button("Edit instructions", "edit", "instructions"), button("Change name", "change_name")], [button("Discard draft", "discard")]] };
    case "create_detail": { const pages = creationPages(d!); const index = w.reviewIndex; if (!Number.isInteger(index) || index < 0 || index >= pages.length) throw new Error("Review page unavailable."); return { title: `Review instructions ${index + 1} of ${pages.length}`, paragraphs: [pages[index]!], rows: [[index < pages.length - 1 ? button("Next page", "create_next") : button("Create harness", "save_new")], back()] }; }
    case "detail": return { title: c!.name, paragraphs: [`${h!.paused ? "Paused · new demos blocked" : live ? "Run available · OpenAI API" : "Demo available · AI not connected"} · version ${h!.activeVersion}`, instructionPreview(c!.agent.instructions), summary(c!)], rows: [...(!h!.paused ? [[button("Try demo", "demo_task")]] : []), [button("Configure", "configure"), button(h!.paused ? "Resume harness" : "Pause harness", "pause")], [button("Versions", "versions"), button("Export config", "export")], home()] };
    case "demo_task": return { title: "Try a demo", paragraphs: live
      ? ["Enter a task or use the sample. Starting a run calls the OpenAI Responses API. Tools stay off.", "The task is stored in this workspace. Telegram messages may also retain it."]
      : ["Enter a task or use the sample. This is a scripted preview: no AI calls, tool execution or provider charges.", "Demo tasks appear in history. Telegram messages and delivery records may also retain them."], rows: [[button("Use a sample task", "demo_sample")], back()], input: { label: "Demo task", maxLength: 600 } };
    case "demo_review": {
      if (!isSafeText(w.demoTask, 600)) throw new Error("Demo task unavailable.");
      return { title: "Review demo", paragraphs: [`${c!.name} · version ${h!.activeVersion}`, `Task:\n${w.demoTask}`, live ? "Starting calls the model once. No tools will run." : "The response is scripted. No AI or tools will run."], rows: [...(!h!.paused ? [[button("Start demo", "demo_start")]] : []), back()] };
    }
    case "demo_history": {
      const runs = w.demoRuns ?? [];
      const anyModel = runs.some(run => run.source === "model");
      return { title: "Demo history", paragraphs: [runs.length ? (anyModel ? "Your latest runs, newest first." : "Your latest scripted demos, newest first.") : "No demo runs yet.", "Only the latest 10 are kept."], rows: [...runs.slice().reverse().map((run, index) => [button(`Demo ${runs.length - index} · ${run.harnessName} v${run.harnessVersion}`, "demo_open", run.id)]), ...(runs.length ? [[button("Clear demo history", "demo_clear")]] : []), home()] };
    }
    case "demo_result": {
      const run = (w.demoRuns ?? []).find(item => item.id === w.selectedDemoRunId);
      if (!run) throw new Error("Demo result unavailable.");
      if (run.source === "model") return modelResultView(run);
      return { title: "Demo complete", paragraphs: [`${run.harnessName} · version ${run.harnessVersion}`, `Task:\n${run.task}`, "Scripted example: I would clarify the goal, outline a plan, and review the result before taking action.", "This was a simulation. No AI calls, tool execution or provider charges were involved."], rows: [[button("Demo history", "demo_history")], home()] };
    }
    case "demo_clear": return { title: "Clear demo history?", paragraphs: ["This removes demo tasks and results from this workspace. Telegram messages and delivery records may remain."], rows: [[button("Clear history", "demo_clear_confirm")], back()] };
    case "config": return { title: `Configure ${d!.name}`, paragraphs: ["You are editing a draft. Review changes before applying a new version.", summary(d!)], rows: [[button("Instructions", "edit", "instructions"), button("Model", "edit", "model")], [button("Tools & access", "edit", "tools"), button("Spending & limits", "edit", "limits")], [button("Memory", "edit", "memory"), button(d!.mode === "simple" ? "Show advanced" : "Use simple view", "toggle_mode")], [button("Review changes", "review")], [button("Discard draft", "discard")]] };
    case "instructions": return { title: "What should your agent do?", paragraphs: [instructionPreview(d!.agent.instructions), "Describe its role, tone and desired output. Instructions cannot grant tool permissions."], rows: [back()], input: { label: "Agent instructions", maxLength: 2000 } };
    case "model": return { title: "Choose a model profile", paragraphs: [`Current: ${d!.agent.modelProfile}. Profiles map to operator-approved models.`], rows: [[button(`${d!.agent.modelProfile === "balanced" ? "Selected · " : ""}Balanced`, "model", "balanced")], [button(`${d!.agent.modelProfile === "fast" ? "Selected · " : ""}Fast`, "model", "fast")], back()] };
    case "tools": return { title: "Give only the access it needs", paragraphs: [`Web reading: ${d!.tools.webRead ? "on" : "off"}\nAllowed: ${d!.policy.allowedDomains.join(", ") || "none"}\nSave private notes: ${d!.tools.notesWrite ? "on" : "off"}`, "The future runtime must request approval for each note. Tools do not run in the demo."], rows: [[button(`Web reading · ${d!.tools.webRead ? "on" : "off"}`, "tool", "webRead")], [button(`Save notes · ${d!.tools.notesWrite ? "on" : "off"}`, "tool", "notesWrite")], ...(d!.mode === "advanced" ? [[button("Allowed domains", "edit", "domains")]] : []), back()] };
    case "domains": return { title: "Which sites may it read?", paragraphs: ["Enter up to five public hostnames, separated by commas. No URLs, wildcards or IP addresses.", `Current: ${d!.policy.allowedDomains.join(", ") || "none"}`], rows: [back()], input: { label: "Allowed domains", maxLength: 400 } };
    case "limits": return { title: "Set a comfortable limit", paragraphs: [summary(d!), "The future runtime must reserve an upper bound before each step. The demo has no provider charges."], rows: [[50, 100, 200].map(x => button(`${d!.policy.runBudgetCents === x ? "Selected · " : ""}${money(x)}/run`, "cap", String(x))), ...(d!.mode === "advanced" ? [[button(`Daily: ${money(d!.policy.dailyBudgetCents)}`, "daily")], [button(`Steps: ${d!.policy.maxSteps}`, "steps"), button(`Timeout: ${d!.policy.timeoutSeconds}s`, "timeout")]] : []), back()] };
    case "memory": return { title: "Choose what it remembers", paragraphs: ["Off keeps only context needed to finish the task. Run memory adds a temporary scratchpad. Neither enables memory across runs.", `Current: ${d!.policy.memory === "off" ? "off" : "this run only"}`], rows: [[button("Off", "memory", "off"), button("This run only", "memory", "run")], back()] };
    case "review": { const diff = changedFields(c!, d!); return { title: "Review your changes", paragraphs: [diff.length ? `Changed: ${diff.map(x => x.name).join(", ")}.` : "No changes yet.", "Review each complete change before applying a new version. An existing run keeps its original configuration."], rows: [...(diff.length ? [[button("Review details", "review_details")]] : []), back(), [button("Discard draft", "discard")]] }; }
    case "review_detail": { const pages = reviewPages(c!, d!); const index = w.reviewIndex; if (!Number.isInteger(index) || index < 0 || index >= pages.length) throw new Error("Review page unavailable."); return { title: `Review change ${index + 1} of ${pages.length}`, paragraphs: [pages[index]!], rows: [[index < pages.length - 1 ? button("Next change", "review_next") : button("Apply new version", "apply")], back()] }; }
    case "versions": return { title: "Version history", paragraphs: [`Active: v${h!.activeVersion}. Restoring a version creates a new version and preserves the audit trail.`], rows: [...h!.versions.slice(-6).reverse().filter(x => x.version !== h!.activeVersion).map(x => [button(`Restore v${x.version}`, "restore", String(x.version))]), back()] };
    case "restore": { const v = h!.versions.find(x => x.version === w.restoreVersion); if (!v) throw new Error("Version unavailable."); const diff = changedFields(c!, v.config); return { title: `Restore v${v.version}?`, paragraphs: [summary(v.config), diff.length ? `Changed: ${diff.map(x => x.name).join(", ")}. Review each complete change.` : "This configuration matches the active version.", `This creates v${h!.activeVersion + 1} for future runs. Running tasks keep their pinned version.`], rows: [[diff.length ? button("Review restore details", "restore_details") : button("Confirm restore", "confirm_restore")], back()] }; }
    case "restore_detail": { const v = h!.versions.find(x => x.version === w.restoreVersion); if (!v) throw new Error("Version unavailable."); const pages = reviewPages(c!, v.config); const index = w.reviewIndex; if (!Number.isInteger(index) || index < 0 || index >= pages.length) throw new Error("Review page unavailable."); return { title: `Review restore ${index + 1} of ${pages.length}`, paragraphs: [pages[index]!], rows: [[index < pages.length - 1 ? button("Next change", "restore_next") : button("Confirm restore", "confirm_restore")], back()] }; }
    case "export": return { title: "Configuration ready", paragraphs: ["The JSON export contains your configuration, including your instructions. It does not include conversation history or stored provider credentials."], rows: [back()] };
    case "help": return { title: "A little help, always here", paragraphs: ["A harness is the agent’s instructions, tools, memory and limits, together in one versioned configuration.", "Use buttons to move around. Type only when asked. Home keeps an unfinished draft so you can return later.", "Never send API keys or passwords to a bot. Bot chats are not end-to-end encrypted."], rows: [home()] };
  }
}

const draftScreens = new Set<Screen>(["mode", "template", "name", "create_review", "create_detail", "config", "instructions", "model", "tools", "domains", "limits", "memory", "review", "review_detail"]);
const fail = (code: string, message: string): Transition => ({ ok: false, code, message });

/**
 * Compute one owner-scoped transition with optimistic revision checking.
 * Persist the returned state, draft and effects in one transaction with the
 * consumed callback and inbox update. Never display success before commit.
 */
export function transition(previous: Workspace, actorId: string, expectedRevision: number, event: Event): Transition {
  if (!actorId || actorId !== previous.ownerId) return fail("AUTH_DENIED", "Return to your own workspace.");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== previous.revision) return fail("MENU_STALE", "That button is out of date. Open the latest menu.");
  if (!event || typeof event !== "object") return fail("ACTION_UNAVAILABLE", "That action is unavailable in this menu.");
  const state = structuredClone(previous);
  const effects: Effect[] = [];
  const h = current(state), c = h && configOf(h), draft = state.draft, d = draft?.config;
  let notice: string | undefined;
  if (event.type === "command") {
    state.demoTask = null;
    if (event.command === "/start") state.screen = "home";
    else if (event.command === "/help") state.screen = "help";
    else if (event.command === "/cancel") { state.screen = "home"; notice = state.draft ? "Your draft is saved. Use Continue draft when you are ready." : "You’re back at Home."; }
    else return fail("ACTION_UNAVAILABLE", "That command is unavailable.");
  } else if (event.type === "text") {
    const input = render(state, actorId).input;
    if (!input) return fail("INPUT_INVALID", "Choose a button first, then type when asked.");
    if (typeof event.text !== "string" || secretPattern.test(event.text)) return fail("INPUT_INVALID", "That looks like a credential. It was not saved.");
    if (!isSafeText(event.text, input.maxLength)) return fail("INPUT_INVALID", `Enter 1–${input.maxLength} characters without hidden control characters.`);
    const text = event.text.trim();
    if (state.screen === "name" && d) { d.name = text; state.screen = "create_review"; }
    else if (state.screen === "instructions" && d && draft) { d.agent.instructions = text; state.screen = draft.instructionReturn; }
    else if (state.screen === "demo_task") { state.demoTask = text; state.screen = "demo_review"; }
    else if (state.screen === "domains" && d) {
      const domains = text.split(",").map(x => x.trim().toLowerCase());
      if (domains.length > 5 || domains.some(x => !isAllowedHostname(x)) || new Set(domains).size !== domains.length) return fail("INPUT_INVALID", "Use 1–5 unique public hostnames, such as docs.example.org.");
      d.policy.allowedDomains = domains; state.screen = "tools";
    } else return fail("INPUT_INVALID", "Choose a button first, then type when asked.");
  } else if (event.type === "button") {
    const value = event.value ?? "";
    const allowed = render(state, actorId).rows.flat().some(b => b.action === event.action && b.value === value);
    if (!allowed && !(event.action === "home" && value === "")) return fail("ACTION_UNAVAILABLE", "That action is unavailable in this menu.");
    switch (event.action) {
      case "home": state.demoTask = null; state.screen = "home"; break;
      case "list": state.screen = "list"; break;
      case "help": state.screen = "help"; break;
      case "connection": state.demoTask = null; state.screen = "connection"; break;
      case "demo_task": if (!h || !c || h.paused) return fail("ACTION_UNAVAILABLE", "Resume this harness before starting a demo."); state.demoTask = null; state.screen = "demo_task"; break;
      case "demo_sample": state.demoTask = "Help me plan a productive week."; state.screen = "demo_review"; break;
      case "demo_start": {
        const id = event.newDemoRunId;
        if (!h || !c || h.paused || !isSafeText(state.demoTask, 600)) return fail("ACTION_UNAVAILABLE", "This demo is unavailable. Open the latest menu.");
        if (typeof id !== "string" || !/^r_[a-f0-9]{24}$/u.test(id) || (state.demoRuns ?? []).some(run => run.id === id)) return fail("INPUT_INVALID", "Could not start this demo. Try again.");
        const run: DemoRun = { id, harnessId: h.id, harnessName: c.name, harnessVersion: h.activeVersion, task: state.demoTask };
        if (event.modelRun) {
          if (!/^\d{4}-\d{2}-\d{2}$/u.test(event.modelRun.day)) return fail("INPUT_INVALID", "Could not start this run. Try again.");
          if (c.policy.maxSteps < 1) return fail("ACTION_UNAVAILABLE", "This harness has no steps left for a run.");
          const spent = state.modelSpend?.day === event.modelRun.day ? state.modelSpend.reservedCents : 0;
          if (spent + c.policy.runBudgetCents > c.policy.dailyBudgetCents) return fail("BUDGET_EXCEEDED", "This run would pass the daily budget. Raise the limit or try again tomorrow.");
          run.source = "model";
          run.status = "pending";
          run.timeoutSeconds = c.policy.timeoutSeconds;
          run.maxOutputTokens = maxOutputTokensForBudget(c.policy.runBudgetCents);
          run.reservedCents = c.policy.runBudgetCents;
          state.modelSpend = { day: event.modelRun.day, reservedCents: spent + c.policy.runBudgetCents };
        }
        state.demoRuns = [...(state.demoRuns ?? []), run].slice(-10);
        state.selectedDemoRunId = id; state.demoTask = null; state.screen = "demo_result";
        effects.push({ type: "verify_demo", ownerId: actorId, harnessId: h.id, baseVersion: h.activeVersion, config: structuredClone(c) }); break;
      }
      case "demo_history": state.screen = "demo_history"; break;
      case "demo_open": if (!(state.demoRuns ?? []).some(run => run.id === value)) return fail("ACTION_UNAVAILABLE", "That demo is unavailable."); state.selectedDemoRunId = value; state.screen = "demo_result"; break;
      case "demo_clear": state.screen = "demo_clear"; break;
      case "demo_clear_confirm": state.demoRuns = []; state.selectedDemoRunId = null; state.demoTask = null; state.screen = "demo_history"; notice = "Demo history cleared."; break;
      case "open": {
        const target = state.harnesses.find(x => x.id === value && x.ownerId === actorId);
        if (!target || !configOf(target)) return fail("AUTH_DENIED", "Return to your own workspace.");
        state.selectedId = target.id; state.screen = "detail"; break;
      }
      case "continue":
        if (!draft) return fail("ACTION_UNAVAILABLE", "There is no draft to continue.");
        if (draft.baseVersion !== null) state.selectedId = draft.config.id;
        state.screen = draft.cursor; break;
      case "create": {
        if (draft) return fail("DRAFT_EXISTS", "Continue or discard your existing draft first.");
        const id = event.newHarnessId;
        if (typeof id !== "string" || !/^h_[a-z0-9]{1,32}$/u.test(id) || state.harnesses.some(x => x.id === id)) return fail("INPUT_INVALID", "Could not create a new harness. Try again.");
        state.draft = { config: newConfig(id), baseVersion: null, cursor: "mode", instructionReturn: "create_review" }; state.screen = "mode"; break;
      }
      case "mode": if (!d || (value !== "simple" && value !== "advanced")) return fail("INPUT_INVALID", "Choose a valid mode."); d.mode = value; state.screen = "template"; break;
      case "template": {
        if (!d || !(value === "research" || value === "writing" || value === "blank")) return fail("INPUT_INVALID", "Choose a valid template.");
        const template = newConfig(d.id, d.mode, value); d.name = template.name; d.agent.instructions = template.agent.instructions; state.screen = "name"; break;
      }
      case "use_name": state.screen = "create_review"; break;
      case "change_name": state.screen = "name"; break;
      case "create_details": state.reviewIndex = 0; state.screen = "create_detail"; break;
      case "create_next": if (!d || state.reviewIndex >= creationPages(d).length - 1) return fail("ACTION_UNAVAILABLE", "There are no more instructions to review."); state.reviewIndex++; break;
      case "discard":
        state.draft = null; state.screen = h ? "detail" : "home"; effects.push({ type: "discard_draft", ownerId: actorId }); notice = "Draft discarded. Your saved configuration is unchanged."; break;
      case "save_new": {
        if (!d || draft?.baseVersion !== null || validateConfig(d).length) return fail("INPUT_INVALID", "Review the draft before creating it.");
        if (d.agent.instructions.length > 1000 && (state.screen !== "create_detail" || state.reviewIndex !== creationPages(d).length - 1)) return fail("ACTION_UNAVAILABLE", "Review the complete instructions before creating the harness.");
        if (state.harnesses.some(x => x.id === d.id)) return fail("VERSION_CONFLICT", "This harness already exists. Open the latest menu.");
        const config = structuredClone(d);
        state.harnesses.push({ id: d.id, ownerId: actorId, activeVersion: 1, paused: false, versions: [{ version: 1, config }] });
        state.selectedId = d.id; state.draft = null; state.screen = "detail"; effects.push({ type: "create_harness", ownerId: actorId, config }, { type: "discard_draft", ownerId: actorId }); notice = "Harness saved. Try the demo or configure it."; break;
      }
      case "configure":
        if (!h || !c) return fail("AUTH_DENIED", "Return to your own workspace.");
        if (draft && draft.config.id !== h.id) return fail("DRAFT_EXISTS", "Finish or discard your other draft first.");
        if (!draft) state.draft = { config: structuredClone(c), baseVersion: h.activeVersion, cursor: "config", instructionReturn: "config" };
        state.screen = "config"; break;
      case "edit":
        if (!draft || !["instructions", "model", "tools", "domains", "limits", "memory"].includes(value)) return fail("ACTION_UNAVAILABLE", "That action is unavailable.");
        draft.instructionReturn = draft.baseVersion === null ? "create_review" : "config"; state.screen = value as Screen; break;
      case "back": {
        const backMap: Partial<Record<Screen, Screen>> = { template: "mode", name: "template", create_detail: "create_review", instructions: draft?.instructionReturn, model: "config", tools: "config", domains: "tools", limits: "config", memory: "config", review: "config", review_detail: "review", versions: "detail", restore: "versions", restore_detail: "restore", export: "detail", demo_task: "detail", demo_review: "demo_task", demo_clear: "demo_history" };
        const next = backMap[state.screen]; if (!next) return fail("ACTION_UNAVAILABLE", "That action is unavailable."); if (state.screen === "demo_review" || state.screen === "demo_task") state.demoTask = null; state.screen = next; break;
      }
      case "toggle_mode": if (d) d.mode = d.mode === "simple" ? "advanced" : "simple"; break;
      case "model": if (d && (value === "balanced" || value === "fast")) d.agent.modelProfile = value; break;
      case "tool":
        if (!d || (value !== "webRead" && value !== "notesWrite")) return fail("INPUT_INVALID", "Choose a valid tool.");
        d.tools[value] = !d.tools[value]; if (value === "webRead" && d.tools.webRead && !d.policy.allowedDomains.length) d.policy.allowedDomains = ["docs.example.org"]; break;
      case "cap": if (d && ["50", "100", "200"].includes(value)) d.policy.runBudgetCents = Number(value) as 50 | 100 | 200; break;
      case "daily": if (d) d.policy.dailyBudgetCents = d.policy.dailyBudgetCents === 500 ? 1000 : 500; break;
      case "steps": if (d) d.policy.maxSteps = d.policy.maxSteps === 4 ? 8 : d.policy.maxSteps === 8 ? 12 : 4; break;
      case "timeout": if (d) d.policy.timeoutSeconds = d.policy.timeoutSeconds === 30 ? 90 : d.policy.timeoutSeconds === 90 ? 180 : 30; break;
      case "memory": if (d && (value === "off" || value === "run")) d.policy.memory = value; break;
      case "review": if (!d || validateConfig(d).length) return fail("INPUT_INVALID", "Check your draft before reviewing it."); state.reviewIndex = 0; state.screen = "review"; break;
      case "review_details": state.reviewIndex = 0; state.screen = "review_detail"; break;
      case "review_next": if (!c || !d || state.reviewIndex >= reviewPages(c, d).length - 1) return fail("ACTION_UNAVAILABLE", "There are no more changes to review."); state.reviewIndex++; break;
      case "apply": {
        if (!h || !c || !d || !draft || draft.baseVersion === null || d.id !== h.id || validateConfig(d).length) return fail("INPUT_INVALID", "Check your draft before applying it.");
        if (draft.baseVersion !== h.activeVersion) return fail("VERSION_CONFLICT", "The saved configuration changed. Review the latest version.");
        if (state.screen !== "review_detail" || !reviewPages(c, d).length || state.reviewIndex !== reviewPages(c, d).length - 1) return fail("ACTION_UNAVAILABLE", "Review every change before applying it.");
        const config = structuredClone(d), baseVersion = h.activeVersion;
        h.activeVersion++; h.versions.push({ version: h.activeVersion, config }); state.draft = null; state.screen = "detail";
        effects.push({ type: "commit_draft", ownerId: actorId, harnessId: h.id, baseVersion, config }, { type: "discard_draft", ownerId: actorId }); notice = `Version ${h.activeVersion} applies to future runs.`; break;
      }
      case "pause": if (!h) return fail("AUTH_DENIED", "Return to your own workspace."); h.paused = !h.paused; effects.push({ type: "set_paused", ownerId: actorId, harnessId: h.id, paused: h.paused }); notice = h.paused ? "New runs are blocked. A tool already started may still finish." : "Harness resumed."; break;
      case "versions": state.screen = "versions"; break;
      case "restore": if (!h || !h.versions.some(v => v.version === Number(value))) return fail("ACTION_UNAVAILABLE", "That version is unavailable."); state.restoreVersion = Number(value); state.reviewIndex = 0; state.screen = "restore"; break;
      case "restore_details": state.reviewIndex = 0; state.screen = "restore_detail"; break;
      case "restore_next": { const v = h?.versions.find(x => x.version === state.restoreVersion); if (!v || !c || state.reviewIndex >= reviewPages(c, v.config).length - 1) return fail("ACTION_UNAVAILABLE", "There are no more changes to review."); state.reviewIndex++; break; }
      case "confirm_restore": {
        const version = h?.versions.find(v => v.version === state.restoreVersion);
        if (!h || !version || validateConfig(version.config).length) return fail("ACTION_UNAVAILABLE", "That version is unavailable.");
        const pages = c ? reviewPages(c, version.config) : [];
        if (pages.length && (state.screen !== "restore_detail" || state.reviewIndex !== pages.length - 1)) return fail("ACTION_UNAVAILABLE", "Review every change before restoring this version.");
        const config = structuredClone(version.config), baseVersion = h.activeVersion;
        h.activeVersion++; h.versions.push({ version: h.activeVersion, config }); state.screen = "detail";
        effects.push({ type: "restore_version", ownerId: actorId, harnessId: h.id, baseVersion, restoredVersion: version.version, config }); notice = `Restored as version ${h.activeVersion}.`; break;
      }
      case "export": if (!h || !c) return fail("AUTH_DENIED", "Return to your own workspace."); state.screen = "export"; effects.push({ type: "export_config", ownerId: actorId, harnessId: h.id, config: structuredClone(c) }); break;
      default: return fail("ACTION_UNAVAILABLE", "That action is unavailable in this menu.");
    }
  } else return fail("ACTION_UNAVAILABLE", "That action is unavailable in this menu.");
  if (state.draft && draftScreens.has(state.screen)) state.draft.cursor = state.screen;
  if (state.draft) effects.push({ type: "save_draft", ownerId: actorId, draft: structuredClone(state.draft) });
  state.revision++;
  return { ok: true, state, effects, ...(notice ? { notice } : {}) };
}

export type ModelClaim =
  | { type: "idle" }
  | { type: "expired"; state: Workspace; runId: string }
  | { type: "ready"; state: Workspace; run: { id: string; task: string; instructions: string; timeoutMs: number; maxOutputTokens: number } };

function releaseReservation(state: Workspace, run: DemoRun): void {
  if (!state.modelSpend || !run.reservedCents) return;
  state.modelSpend = { day: state.modelSpend.day, reservedCents: Math.max(0, state.modelSpend.reservedCents - run.reservedCents) };
}
function fitModelOutput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const chars = Array.from(trimmed);
  const limited = chars.length > MODEL_OUTPUT_CHARS ? `${chars.slice(0, MODEL_OUTPUT_CHARS - 1).join("")}…` : trimmed;
  return isSafeText(limited, MODEL_OUTPUT_CHARS) ? limited : null;
}

/** Claim at most one model run. A stale running run is failed and is not sent again. */
export function claimNextModelRun(previous: Workspace, actorId: string, nowMs: number): ModelClaim {
  if (!actorId || previous.ownerId !== actorId) throw new Error("Access denied.");
  if (!Number.isFinite(nowMs)) throw new TypeError("Clock value is required.");
  const state = structuredClone(previous);
  const running = (state.demoRuns ?? []).find(run => run.source === "model" && run.status === "running");
  if (running) {
    const timeoutMs = (running.timeoutSeconds ?? 90) * 1000;
    const started = running.startedAtMs ?? 0;
    if (started + timeoutMs + 15_000 > nowMs) return { type: "idle" };
    running.status = "failed";
    running.output = MODEL_FAILURE_TEXT.TIMEOUT;
    releaseReservation(state, running);
    state.revision++;
    return { type: "expired", state, runId: running.id };
  }
  const pending = (state.demoRuns ?? []).find(run => run.source === "model" && run.status === "pending");
  if (!pending) return { type: "idle" };
  const harness = state.harnesses.find(item => item.id === pending.harnessId && item.ownerId === actorId);
  const config = harness?.versions.find(version => version.version === pending.harnessVersion)?.config;
  if (!harness || harness.paused || !config || validateConfig(config).length) {
    pending.status = "failed";
    pending.output = MODEL_FAILURE_TEXT.FAILED;
    releaseReservation(state, pending);
    state.revision++;
    return { type: "expired", state, runId: pending.id };
  }
  pending.status = "running";
  pending.startedAtMs = nowMs;
  state.revision++;
  return { type: "ready", state, run: { id: pending.id, task: pending.task, instructions: config.agent.instructions, timeoutMs: (pending.timeoutSeconds ?? config.policy.timeoutSeconds) * 1000, maxOutputTokens: pending.maxOutputTokens ?? maxOutputTokensForBudget(config.policy.runBudgetCents) } };
}

/** Record the outcome of a run that this process already claimed. Returns null if it is no longer running. */
export function settleModelRun(previous: Workspace, actorId: string, runId: string, settlement: { status: "complete"; output: string } | { status: "failed"; code: ModelFailureCode }): Workspace | null {
  if (!actorId || previous.ownerId !== actorId) throw new Error("Access denied.");
  const state = structuredClone(previous);
  const run = (state.demoRuns ?? []).find(item => item.id === runId && item.source === "model" && item.status === "running");
  if (!run) return null;
  if (settlement.status === "failed") {
    run.status = "failed";
    run.output = MODEL_FAILURE_TEXT[settlement.code];
    releaseReservation(state, run);
  } else {
    const output = fitModelOutput(settlement.output);
    if (!output) {
      run.status = "failed";
      run.output = MODEL_FAILURE_TEXT.OUTPUT_UNSAFE;
      releaseReservation(state, run);
    } else {
      run.status = "complete";
      run.output = output;
    }
  }
  state.revision++;
  return state;
}

export function escapeTelegram(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Issue each token in persistent storage bound to owner/chat/message/action/revision. */
export function telegramPayload(view: View, tokenFor: (button: Button) => string): { text: string; parse_mode: "HTML"; link_preview_options: { is_disabled: true }; reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] } } {
  const plain = [view.title, ...view.paragraphs].join("\n\n");
  if (plain.length > 4096) throw new RangeError("Telegram message is too long.");
  const text = `<b>${escapeTelegram(view.title)}</b>\n\n${view.paragraphs.map(escapeTelegram).join("\n\n")}`;
  const used = new Set<string>();
  const inline_keyboard = view.rows.map(row => row.map(b => {
    const token = tokenFor(b);
    if (!/^cb:[A-Za-z0-9_-]{32}$/u.test(token) || new TextEncoder().encode(token).length > 64) throw new Error("Callback token must be an opaque 24-byte base64url token.");
    if (used.has(token)) throw new Error("Callback tokens must be unique within a view.");
    used.add(token);
    return { text: b.label, callback_data: token };
  }));
  return { text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard } };
}
