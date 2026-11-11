/** Deterministic, offline interaction model. This is not a security boundary. */
export const ACTIVE = new Set(["running", "awaiting_approval", "writing"]);
export const FAULTS = [
  "none",
  "provider",
  "budget",
  "expired",
  "delivery",
  "unknown",
];
const SCREENS = new Set([
  "home",
  "list",
  "detail",
  "mode",
  "template",
  "name",
  "create-review",
  "config",
  "instructions",
  "model",
  "tools",
  "domains",
  "limits",
  "memory",
  "review",
  "versions",
  "restore",
  "prompt",
  "run-review",
  "run",
  "approvals",
  "history",
  "help",
  "export",
  "pause-all",
]);
const DRAFT_SCREENS = new Set([
  "mode",
  "template",
  "name",
  "create-review",
  "config",
  "instructions",
  "model",
  "tools",
  "domains",
  "limits",
  "memory",
  "review",
]);
const clone = (value) => structuredClone(value);
const b = (label, action, value = "", tone = "") => ({
  label,
  action,
  value: String(value),
  tone,
});
export const money = (cents) => `$${(cents / 100).toFixed(2)}`;
export const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const secretPattern = /(?:sk-[a-z0-9_-]{16,}|\d{8,}:[a-z0-9_-]{20,})/i;
const forbidden =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;
const length = (value) => Array.from(value).length;
const validTime = (value) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const validText = (value, max) =>
  typeof value === "string" &&
  length(value.trim()) >= 1 &&
  length(value) <= max &&
  !forbidden.test(value) &&
  !secretPattern.test(value);
const domainOK = (d) =>
  typeof d === "string" &&
  d.length <= 253 &&
  /^(?!.*(?:^|\.)localhost$)(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(
    d,
  ) &&
  !/(?:^|\.)(?:local|internal|test|invalid)$/u.test(d);
const keyset = (obj, keys) =>
  obj &&
  typeof obj === "object" &&
  !Array.isArray(obj) &&
  Object.keys(obj).sort().join(",") === [...keys].sort().join(",");

export function validateConfig(c) {
  const errors = [];
  if (
    !keyset(c, [
      "schemaVersion",
      "id",
      "name",
      "mode",
      "agent",
      "tools",
      "policy",
    ])
  )
    return ["Invalid configuration fields."];
  if (
    c.schemaVersion !== 1 ||
    typeof c.id !== "string" ||
    !/^h_[a-z0-9]{1,32}$/u.test(c.id)
  )
    errors.push("Invalid configuration identity.");
  if (!validText(c.name, 40))
    errors.push("Use a name between 1 and 40 characters.");
  if (!["simple", "advanced"].includes(c.mode))
    errors.push("Choose Simple or Advanced.");
  if (
    !keyset(c.agent, ["instructions", "modelProfile"]) ||
    !validText(c.agent.instructions, 2000) ||
    !["balanced", "fast"].includes(c.agent.modelProfile)
  )
    errors.push("Check the agent instructions and model profile.");
  if (
    !keyset(c.tools, ["webRead", "notesWrite"]) ||
    typeof c.tools.webRead !== "boolean" ||
    typeof c.tools.notesWrite !== "boolean"
  )
    errors.push("Invalid tool configuration.");
  const p = c.policy;
  if (
    !keyset(p, [
      "approvalMode",
      "memory",
      "runBudgetCents",
      "dailyBudgetCents",
      "maxSteps",
      "timeoutSeconds",
      "allowedDomains",
    ])
  )
    return [...errors, "Invalid policy fields."];
  if (p.approvalMode !== "all_writes")
    errors.push("Approval is required for every write.");
  if (!["off", "run"].includes(p.memory))
    errors.push("Choose a valid memory setting.");
  if (
    ![50, 100, 200].includes(p.runBudgetCents) ||
    ![500, 1000].includes(p.dailyBudgetCents)
  )
    errors.push("Choose a supported budget.");
  if (
    ![4, 8, 12].includes(p.maxSteps) ||
    ![30, 90, 180].includes(p.timeoutSeconds)
  )
    errors.push("Choose supported runtime limits.");
  if (
    !Array.isArray(p.allowedDomains) ||
    p.allowedDomains.length > 5 ||
    p.allowedDomains.some((d) => !domainOK(d)) ||
    new Set(p.allowedDomains).size !== p.allowedDomains.length
  )
    errors.push("Use up to five unique public hostnames.");
  if (
    c.tools?.webRead &&
    Array.isArray(p.allowedDomains) &&
    p.allowedDomains.length === 0
  )
    errors.push("Add an allowed domain before enabling web reading.");
  return errors;
}

export function sampleConfig(id = "h_atlas") {
  return {
    schemaVersion: 1,
    id,
    name: "Atlas",
    mode: "simple",
    agent: {
      instructions:
        "Turn a question into a concise research brief. Separate evidence, assumptions and next steps.",
      modelProfile: "balanced",
    },
    tools: { webRead: false, notesWrite: false },
    policy: {
      approvalMode: "all_writes",
      memory: "off",
      runBudgetCents: 50,
      dailyBudgetCents: 500,
      maxSteps: 8,
      timeoutSeconds: 90,
      allowedDomains: [],
    },
  };
}

export function createState(now = Date.now()) {
  return {
    schemaVersion: 1,
    revision: 0,
    screen: "home",
    selectedId: "h_atlas",
    selectedRunId: null,
    harnesses: [
      {
        id: "h_atlas",
        activeVersion: 1,
        paused: false,
        versions: [{ version: 1, config: sampleConfig() }],
      },
    ],
    draft: null,
    draftBase: null,
    draftReturn: "config",
    draftCursor: null,
    task: "",
    restoreVersion: null,
    runs: [],
    nextId: 2,
    nextRun: 1,
    fault: "none",
    events: [{ at: now, text: "Demo workspace opened", kind: "info" }],
  };
}

export const selectedHarness = (s) =>
  s.harnesses.find((h) => h.id === s.selectedId);
export const activeConfig = (h) =>
  h?.versions.find((v) => v.version === h.activeVersion)?.config;
export const selectedRun = (s) => s.runs.find((r) => r.id === s.selectedRunId);
const currentConfig = (s) => activeConfig(selectedHarness(s));
const log = (s, text, now, kind = "info") => {
  s.events.push({ at: now, text, kind });
  s.events = s.events.slice(-60);
};
const go = (s, screen) => {
  s.screen = screen;
};
const record = (s) => selectedRun(s);
const day = (now) => new Date(now).toISOString().slice(0, 10);
const dayUsed = (s, id, now) =>
  s.runs
    .filter((r) => r.harnessId === id && r.day === day(now))
    .reduce((sum, r) => sum + r.costCents + r.reservedCents, 0);
const runStatus = (status) =>
  ({
    running: "Working",
    awaiting_approval: "Needs your approval",
    writing: "Saving approved note",
    succeeded: "Completed",
    failed: "Could not complete",
    blocked: "Stopped at budget check",
    cancelled: "Stopped",
    denied: "Permission declined",
    expired: "Approval expired",
    needs_review: "Outcome needs checking",
  })[status] ?? status;
const summary = (c) =>
  `${c.mode === "simple" ? "Simple" : "Advanced"} · ${c.agent.modelProfile} model\n${money(c.policy.runBudgetCents)} / run · ${money(c.policy.dailyBudgetCents)} / day (UTC)\n${c.policy.maxSteps} steps · ${c.policy.timeoutSeconds}s active time\nWeb reading ${c.tools.webRead ? "on" : "off"} · Save notes ${c.tools.notesWrite ? "on, approval required" : "off"}\nMemory: ${c.policy.memory === "off" ? "off" : "this run only"}`;
export function changes(before, after) {
  const fields = [
    ["name", (c) => c.name],
    ["mode", (c) => c.mode],
    ["instructions", (c) => c.agent.instructions],
    ["model", (c) => c.agent.modelProfile],
    ["web reading", (c) => c.tools.webRead],
    ["save notes", (c) => c.tools.notesWrite],
    ["memory", (c) => c.policy.memory],
    ["run cap", (c) => money(c.policy.runBudgetCents)],
    ["daily cap", (c) => money(c.policy.dailyBudgetCents)],
    ["steps", (c) => c.policy.maxSteps],
    ["active timeout", (c) => c.policy.timeoutSeconds],
    ["allowed domains", (c) => c.policy.allowedDomains.join(", ") || "none"],
  ];
  return fields
    .filter(([, get]) => get(before) !== get(after))
    .map(
      ([name, get]) =>
        `${name}: ${String(get(before)).slice(0, 90)} → ${String(get(after)).slice(0, 90)}`,
    );
}

/** One view describes both the browser preview and Telegram's inline keyboard. */
export function view(s, now = Date.now()) {
  const h = selectedHarness(s),
    c = currentConfig(s),
    d = s.draft,
    r = record(s);
  const home = [b("Home", "home")],
    back = [b("‹ Back", "detail")];
  const v = {
    title: "",
    paragraphs: [],
    rows: [],
    eyebrow: "RELAY",
    input: null,
  };
  const set = (title, paragraphs, rows, eyebrow = "RELAY") =>
    Object.assign(v, { title, paragraphs, rows, eyebrow });
  switch (s.screen) {
    case "home":
      set(
        "Your agents. Your rules.",
        [
          "Create an agent, give it boundaries, and stay in control of every run.",
          `${s.harnesses.length} harness${s.harnesses.length === 1 ? "" : "es"} · ${s.runs.filter((x) => x.status === "awaiting_approval").length} awaiting approval\nAll runs in this preview are simulated.`,
        ],
        [
          [b("Create harness", "create", "", "primary")],
          [b("My harnesses", "list"), b("Approvals", "approvals")],
          [b("Run history", "history"), b("Help & safety", "help")],
          ...(d ? [[b("Continue draft", "continue")]] : []),
        ],
        "YOUR WORKSPACE",
      );
      break;
    case "list":
      set(
        "My harnesses",
        ["Choose a harness to run, configure or pause."],
        [
          ...s.harnesses.map((x) => [
            b(
              `${activeConfig(x).name} · v${x.activeVersion}${x.paused ? " · paused" : ""}`,
              "open",
              x.id,
            ),
          ]),
          [b("Create harness", "create")],
          home,
        ],
      );
      break;
    case "detail":
      set(
        c.name,
        [
          `${h.paused ? "Paused · new runs blocked" : "Ready when you are"} · version ${h.activeVersion}`,
          c.agent.instructions,
          summary(c),
        ],
        [
          [b("Run a task", "prompt", "", "primary")],
          [
            b("Configure", "configure"),
            b(h.paused ? "Resume harness" : "Pause harness", "pause"),
          ],
          [b("Versions", "versions"), b("Run history", "history")],
          [b("Export config", "export"), b("Home", "home")],
        ],
        "HARNESS",
      );
      break;
    case "mode":
      set(
        "How would you like to build?",
        [
          "Simple gives you sensible defaults. Advanced adds model, tool and runtime controls.",
          "Both modes require approval for writes and enforce a spending limit.",
        ],
        [
          [b("Simple · guided setup", "mode", "simple", "primary")],
          [b("Advanced · more control", "mode", "advanced")],
          home,
        ],
        "CREATE · 1 OF 4",
      );
      break;
    case "template":
      set(
        "Choose a starting point",
        ["You can change the instructions and tools at any time."],
        [
          [b("Research assistant", "template", "research")],
          [
            b("Writing partner", "template", "writing"),
            b("Start from scratch", "template", "blank"),
          ],
          [b("‹ Back", "back-mode")],
        ],
        "CREATE · 2 OF 4",
      );
      break;
    case "name":
      set(
        "Give your harness a name",
        ["Keep it short and recognisable. You can use the suggestion below."],
        [[b(`Use “${d.name}”`, "use-name")], [b("‹ Back", "back-template")]],
        "CREATE · 3 OF 4",
      );
      v.input = {
        placeholder: "e.g. Research companion",
        maxLength: 40,
        label: "Harness name",
      };
      break;
    case "create-review":
      set(
        `Meet ${d.name}`,
        [
          d.agent.instructions,
          summary(d),
          "Your harness will start with no connected accounts. You can customise it after creation.",
        ],
        [
          [b("Create harness", "save-new", "", "primary")],
          [
            b("Edit instructions", "edit", "instructions"),
            b("Change name", "back-name"),
          ],
          [b("Discard draft", "discard")],
        ],
        "CREATE · 4 OF 4",
      );
      break;
    case "config":
      set(
        `Configure ${d.name}`,
        [
          "You are editing a draft. Review the changes before applying a new version.",
          summary(d),
        ],
        [
          [
            b("Instructions", "edit", "instructions"),
            b("Model", "edit", "model"),
          ],
          [
            b("Tools & access", "edit", "tools"),
            b("Spending & limits", "edit", "limits"),
          ],
          [
            b("Memory", "edit", "memory"),
            b(
              d.mode === "simple" ? "Show advanced" : "Use simple view",
              "toggle-mode",
            ),
          ],
          [b("Review changes", "review", "", "primary")],
          [b("Discard draft", "discard")],
        ],
        "DRAFT",
      );
      break;
    case "instructions":
      set(
        "What should your agent do?",
        [
          d.agent.instructions,
          "Describe its role, tone and desired output. Instructions cannot grant tool permissions.",
        ],
        [[b("‹ Back", "draft-back")]],
        "AGENT INSTRUCTIONS",
      );
      v.input = {
        placeholder: "Write clear instructions…",
        maxLength: 2000,
        label: "Agent instructions",
      };
      break;
    case "model":
      set(
        "Choose a model profile",
        [
          `Current: ${d.agent.modelProfile}. Profiles map to operator-approved models during the live build.`,
          "This preview does not contact a model provider.",
        ],
        [
          [
            b(
              `${d.agent.modelProfile === "balanced" ? "Selected · " : ""}Balanced`,
              "model",
              "balanced",
            ),
          ],
          [
            b(
              `${d.agent.modelProfile === "fast" ? "Selected · " : ""}Fast`,
              "model",
              "fast",
            ),
          ],
          [b("‹ Back", "draft-back")],
        ],
        "MODEL",
      );
      break;
    case "tools":
      set(
        "Give only the access it needs",
        [
          `Web reading: ${d.tools.webRead ? "on" : "off"}\nAllowed: ${d.policy.allowedDomains.join(", ") || "none"}\nSave private notes: ${d.tools.notesWrite ? "on" : "off"}`,
          "Every note requires your approval. Web reading uses sample data in this demo.",
        ],
        [
          [
            b(
              `Web reading · ${d.tools.webRead ? "on" : "off"}`,
              "tool",
              "webRead",
            ),
          ],
          [
            b(
              `Save notes · ${d.tools.notesWrite ? "on" : "off"}`,
              "tool",
              "notesWrite",
            ),
          ],
          ...(d.mode === "advanced"
            ? [[b("Allowed domains", "edit", "domains")]]
            : []),
          [b("‹ Back", "draft-back")],
        ],
        "TOOLS & ACCESS",
      );
      break;
    case "domains":
      set(
        "Which sites may it read?",
        [
          "Enter up to five public hostnames, separated by commas. No URLs, wildcards or IP addresses.",
          `Current: ${d.policy.allowedDomains.join(", ") || "none"}`,
        ],
        [[b("‹ Back", "edit", "tools")]],
        "ADVANCED · DOMAINS",
      );
      v.input = {
        placeholder: "docs.example.org, example.com",
        maxLength: 400,
        label: "Allowed domains",
      };
      break;
    case "limits":
      set(
        "Set a comfortable limit",
        [
          summary(d),
          "The runtime reserves an upper bound before each step. A run stops when its next step will not fit.",
        ],
        [
          [50, 100, 200].map((x) =>
            b(
              `${d.policy.runBudgetCents === x ? "Selected · " : ""}${money(x)}/run`,
              "cap",
              x,
            ),
          ),
          ...(d.mode === "advanced"
            ? [
                [b(`Daily: ${money(d.policy.dailyBudgetCents)}`, "daily")],
                [
                  b(`Steps: ${d.policy.maxSteps}`, "steps"),
                  b(`Timeout: ${d.policy.timeoutSeconds}s`, "timeout"),
                ],
              ]
            : []),
          [b("‹ Back", "draft-back")],
        ],
        "SPENDING & LIMITS",
      );
      break;
    case "memory":
      set(
        "Choose what it remembers",
        [
          "Off keeps only context needed to finish the task. Run memory adds a temporary scratchpad. Both are cleared when the run ends; neither enables memory across runs.",
          `Current: ${d.policy.memory === "off" ? "off" : "this run only"}`,
        ],
        [
          [b("Off", "memory", "off"), b("This run only", "memory", "run")],
          [b("‹ Back", "draft-back")],
        ],
        "MEMORY",
      );
      break;
    case "review": {
      const diff = changes(c, d);
      set(
        "Review your changes",
        [
          diff.length ? diff.join("\n") : "No changes yet.",
          "A new version applies to future runs. An existing run keeps its original configuration.",
        ],
        [
          ...(diff.length
            ? [[b("Apply new version", "apply", "", "primary")]]
            : []),
          [b("‹ Keep editing", "draft-back")],
          [b("Discard draft", "discard")],
        ],
        "REVIEW",
      );
      break;
    }
    case "versions":
      set(
        "Version history",
        [
          `Active: v${h.activeVersion}. Restoring a version creates a new version and preserves the audit trail.`,
        ],
        [
          ...h.versions
            .slice(-6)
            .reverse()
            .filter((x) => x.version !== h.activeVersion)
            .map((x) => [b(`Restore v${x.version}`, "restore", x.version)]),
          back,
        ],
        "CONFIGURATION",
      );
      break;
    case "restore": {
      const previous = h.versions.find(
        (x) => x.version === s.restoreVersion,
      ).config;
      set(
        `Restore v${s.restoreVersion}?`,
        [
          summary(previous),
          `This creates v${h.activeVersion + 1} for future runs. Running tasks keep their pinned version.`,
        ],
        [
          [b("Confirm restore", "confirm-restore", "", "primary")],
          [b("‹ Back", "versions")],
        ],
        "REVIEW RESTORE",
      );
      break;
    }
    case "prompt":
      set(
        "What would you like done?",
        [
          `${c.name} · version ${h.activeVersion}`,
          "Describe one task. This preview returns a labelled sample result.",
        ],
        [[b("Try a sample task", "sample-task")], back],
        "NEW RUN",
      );
      v.input = {
        placeholder: "e.g. Make a launch checklist",
        maxLength: 600,
        label: "Task description",
      };
      break;
    case "run-review":
      set(
        "Ready to run?",
        [
          s.task,
          `${c.name} · v${h.activeVersion}\nMaximum ${money(c.policy.runBudgetCents)} · ${c.policy.maxSteps} steps · ${c.policy.timeoutSeconds}s\n${c.tools.notesWrite ? "Saving a note will require your approval." : "No write tools enabled."}`,
          "All costs and results are simulated.",
        ],
        [
          [b("Start demo run", "start", "", "primary")],
          [b("Edit task", "prompt"), b("Cancel", "detail")],
        ],
        "REVIEW RUN",
      );
      break;
    case "run": {
      if (!r) {
        set(
          "No run selected",
          ["Open your run history."],
          [[b("Run history", "history")], home],
        );
        break;
      }
      const info = `${r.id} · config v${r.configVersion} · ${money(r.costCents)} simulated`;
      const rows = [];
      let paragraphs = [info];
      if (r.status === "awaiting_approval") {
        paragraphs.push(
          `Allow one private note?\nDestination: private/summary\nContent: ${r.noteContent}`,
          `This permission expires in ${Math.max(0, Math.ceil((r.approval.expiresAt - now) / 60000))} min. It is valid for this exact note only.`,
        );
        rows.push([
          b("Approve once", "approve", "", "primary"),
          b("Decline", "deny"),
        ]);
      } else if (r.status === "running" || r.status === "writing") {
        paragraphs.push(
          r.status === "writing"
            ? "Your exact approved note is being saved."
            : "Checking the task against your limits. You can stop this run.",
        );
        rows.push([b("Stop run", "cancel-run", "", "danger")]);
      } else if (r.status === "succeeded") {
        paragraphs.push(
          `SIMULATED RESULT\n${r.result}`,
          `${r.effects} private note${r.effects === 1 ? "" : "s"} saved in this demo. No external system was contacted.`,
        );
        if (r.delivery === "failed") {
          paragraphs.push(
            "Telegram delivery failed in this scenario. The completed result is still available.",
          );
          rows.push([b("Retry delivery only", "redeliver")]);
        }
      } else if (r.status === "needs_review") {
        paragraphs.push(
          "The note tool accepted the request, but its response was lost. It may already be saved. Do not repeat the write.",
        );
        rows.push([b("Check saved note · demo", "reconcile")]);
      } else {
        paragraphs.push(
          {
            blocked:
              "The next step would exceed your spending limit. No tool ran.",
            failed:
              "The model provider timed out. No write was attempted. Any known usage remains accounted for.",
            expired: "The approval window closed. The note was not saved.",
            denied: "You declined this write. The note was not saved.",
            cancelled:
              "No more steps will run. Any work already completed stays in the record.",
          }[r.status],
        );
        if (r.status === "failed")
          rows.push([b("Review a new run", "retry-run")]);
      }
      rows.push([b("Harness", "detail"), b("Run history", "history")]);
      set(
        runStatus(r.status),
        paragraphs,
        rows,
        r.status === "awaiting_approval" ? "YOUR DECISION" : "RUN STATUS",
      );
      break;
    }
    case "approvals": {
      const pending = s.runs.filter((x) => x.status === "awaiting_approval");
      set(
        "Your approvals",
        [
          pending.length
            ? "Review each action before allowing it."
            : "You’re all caught up. No pending approvals.",
        ],
        [
          ...pending.map((x) => [
            b(`${x.id} · save one note`, "open-run", x.id),
          ]),
          home,
        ],
        "APPROVAL INBOX",
      );
      break;
    }
    case "history":
      set(
        "Run history",
        [
          s.runs.length
            ? "Costs below are simulated. Open a run for its result and configuration version."
            : "Your first run will appear here.",
        ],
        [
          ...s.runs
            .slice(-8)
            .reverse()
            .map((x) => [
              b(`${x.id} · ${runStatus(x.status)}`, "open-run", x.id),
            ]),
          home,
        ],
        "ACTIVITY",
      );
      break;
    case "help":
      set(
        "A little help, always here",
        [
          "A harness is the agent’s instructions, tools, memory and limits, together in one versioned configuration.",
          "Use buttons to move around. Type only when asked. Home keeps an unfinished draft so you can return later.",
          "Never send API keys or passwords to a bot. Bot chats are not end-to-end encrypted. This local demo accepts no credentials.",
        ],
        [home],
        "HELP & SAFETY",
      );
      break;
    case "export":
      set(
        "Configuration ready",
        [
          "A JSON file has been prepared for download. It contains the configuration only, with no conversation history or credentials.",
        ],
        [back],
        "EXPORT",
      );
      break;
    case "pause-all":
      set(
        "Pause all harnesses?",
        [
          "This blocks new runs and stops the demo’s active tasks. Completed work cannot be undone.",
        ],
        [[b("Pause all now", "confirm-pause-all", "", "danger")], home],
        "WORKSPACE CONTROL",
      );
      break;
    default:
      throw new Error("Unknown prototype screen");
  }
  return v;
}

const finish = (s, r, status, now) => {
  r.status = status;
  r.reservedCents = 0;
  if (r.approval && status !== "awaiting_approval") r.approval.closed = true;
  if (status === "succeeded" && r.fault === "delivery") r.delivery = "failed";
  log(
    s,
    `${r.id}: ${runStatus(status)}`,
    now,
    ["failed", "blocked", "needs_review"].includes(status) ? "warning" : "info",
  );
};

/** Safe failures leave the previous state untouched; clocks are injectable for expiry tests. */
export function step(previous, event, now = Date.now()) {
  if (!event || typeof event !== "object")
    return { state: previous, notice: "That action is unavailable." };
  if (!validTime(now))
    return { state: previous, notice: "The clock is unavailable. Try again." };
  const s = clone(previous);
  let notice = "";
  if (event.type === "tick") {
    let changed = false;
    for (const r of s.runs) {
      if (r.status === "awaiting_approval" && now >= r.approval.expiresAt) {
        finish(s, r, "expired", now);
        changed = true;
      }
    }
    if (!changed) return { state: previous, notice: "" };
  } else if (event.type === "advance") {
    const r = s.runs.find((x) => x.id === event.runId);
    if (!r || !["running", "writing"].includes(r.status))
      return { state: previous, notice: "" };
    if (now >= r.deadline) {
      finish(s, r, "failed", now);
      r.errorCode = "RUN_TIMEOUT";
    } else if (r.status === "writing") {
      r.costCents = 12;
      if (r.fault === "unknown") {
        r.effects = 0;
        r.errorCode = "OUTCOME_UNKNOWN";
        finish(s, r, "needs_review", now);
      } else {
        r.effects = 1;
        finish(s, r, "succeeded", now);
      }
    } else if (r.fault === "provider") {
      r.costCents = 2;
      r.errorCode = "PROVIDER_TIMEOUT";
      finish(s, r, "failed", now);
    } else {
      r.costCents = 8;
      r.reservedCents = 12;
      if (r.config.tools.notesWrite) {
        r.status = "awaiting_approval";
        r.remainingMs = Math.max(0, r.deadline - now);
        r.approval = {
          expiresAt: now + (r.fault === "expired" ? 0 : 600000),
          closed: false,
          decidedAt: null,
          noteContent: r.noteContent,
        };
        log(s, `${r.id}: one exact note requires approval`, now);
        if (r.fault === "expired") finish(s, r, "expired", now);
      } else {
        finish(s, r, "succeeded", now);
        if (r.fault === "delivery") {
          r.delivery = "failed";
          notice =
            "Delivery failed in this demo. The completed result is safe in Run history.";
        }
      }
    }
  } else if (event.type === "fault") {
    if (!FAULTS.includes(event.fault))
      return { state: previous, notice: "Unknown demo scenario." };
    s.fault = event.fault;
    notice =
      event.fault === "none"
        ? "Next run: normal scenario."
        : "Scenario applies to the next run. No live services are involved.";
  } else {
    if (event.revision !== previous.revision)
      return {
        state: previous,
        notice: "That button is out of date. Use the latest menu.",
      };
    if (event.type === "text") {
      const input = view(s, now).input;
      if (!input)
        return {
          state: previous,
          notice: "Choose a button first, then type when asked.",
        };
      if (typeof event.text !== "string" || secretPattern.test(event.text))
        return {
          state: previous,
          notice:
            "That looks like a credential. It was not saved. Use sample text here.",
        };
      if (!validText(event.text, input.maxLength))
        return {
          state: previous,
          notice: `Enter 1–${input.maxLength} characters without hidden control characters.`,
        };
      const text = event.text.trim();
      if (s.screen === "name") {
        s.draft.name = text;
        go(s, "create-review");
      } else if (s.screen === "instructions") {
        s.draft.agent.instructions = text;
        go(s, s.draftReturn);
      } else if (s.screen === "prompt") {
        s.task = text;
        go(s, "run-review");
      } else if (s.screen === "domains") {
        const domains = text.split(",").map((x) => x.trim().toLowerCase());
        if (
          domains.length > 5 ||
          domains.some((x) => !domainOK(x)) ||
          new Set(domains).size !== domains.length
        )
          return {
            state: previous,
            notice:
              "Use 1–5 unique public hostnames, such as docs.example.org.",
          };
        s.draft.policy.allowedDomains = domains;
        go(s, "tools");
      }
    } else if (event.type === "action") {
      const allowed = view(s, now)
        .rows.flat()
        .some(
          (x) =>
            x.action === event.action && x.value === String(event.value ?? ""),
        );
      if (!allowed && !["home", "pause-all"].includes(event.action))
        return {
          state: previous,
          notice: "That action is unavailable in this menu.",
        };
      const h = selectedHarness(s),
        c = currentConfig(s),
        d = s.draft,
        r = record(s),
        value = String(event.value ?? "");
      switch (event.action) {
        case "home":
          go(s, "home");
          break;
        case "list":
          go(s, "list");
          break;
        case "detail":
          go(s, "detail");
          break;
        case "help":
          go(s, "help");
          break;
        case "history":
          go(s, "history");
          break;
        case "approvals":
          go(s, "approvals");
          break;
        case "open":
          s.selectedId = value;
          go(s, "detail");
          break;
        case "open-run":
          s.selectedRunId = value;
          s.selectedId = record(s).harnessId;
          go(s, "run");
          break;
        case "continue":
          if (s.draftBase !== null) s.selectedId = s.draft.id;
          go(s, s.draftCursor);
          break;
        case "create":
          if (d)
            return {
              state: previous,
              notice:
                "Continue or discard your existing draft before creating another.",
            };
          if (s.harnesses.length >= 30)
            return {
              state: previous,
              notice:
                "This demo supports 30 harnesses. Reset the demo to start fresh.",
            };
          s.draft = sampleConfig(`h_${s.nextId}`);
          s.draft.name = "Scout";
          s.draftBase = null;
          go(s, "mode");
          break;
        case "mode":
          d.mode = value;
          go(s, "template");
          break;
        case "back-mode":
          go(s, "mode");
          break;
        case "back-template":
          go(s, "template");
          break;
        case "back-name":
          go(s, "name");
          break;
        case "template": {
          const templates = {
            research: [
              "Scout",
              "Research a topic. Return a short brief with evidence, uncertainties and next steps.",
            ],
            writing: [
              "Scribe",
              "Help write clear, thoughtful text. Ask for missing context and keep the requested tone.",
            ],
            blank: [
              "My agent",
              "Help with the assigned task. State assumptions and ask before making changes.",
            ],
          };
          [d.name, d.agent.instructions] = templates[value];
          go(s, "name");
          break;
        }
        case "use-name":
          go(s, "create-review");
          break;
        case "discard":
          s.draft = null;
          s.draftBase = null;
          go(s, "detail");
          notice = "Draft discarded. Your saved configuration is unchanged.";
          break;
        case "save-new": {
          const errors = validateConfig(d);
          if (errors.length) return { state: previous, notice: errors[0] };
          s.harnesses.push({
            id: d.id,
            activeVersion: 1,
            paused: false,
            versions: [{ version: 1, config: clone(d) }],
          });
          s.selectedId = d.id;
          s.nextId++;
          s.draft = null;
          s.draftBase = null;
          go(s, "detail");
          log(s, `Created ${currentConfig(s).name} v1`, now);
          notice = "Your harness is ready. Try a sample run.";
          break;
        }
        case "configure":
          if (d && d.id !== h.id)
            return {
              state: previous,
              notice: "Finish or discard your other draft first.",
            };
          if (!d) {
            s.draft = clone(c);
            s.draftBase = h.activeVersion;
          }
          go(s, "config");
          break;
        case "edit":
          s.draftReturn = s.draftBase === null ? "create-review" : "config";
          go(s, value);
          break;
        case "draft-back":
          go(s, s.draftBase === null ? "create-review" : "config");
          break;
        case "toggle-mode":
          d.mode = d.mode === "simple" ? "advanced" : "simple";
          break;
        case "model":
          d.agent.modelProfile = value;
          break;
        case "tool":
          d.tools[value] = !d.tools[value];
          if (
            value === "webRead" &&
            d.tools.webRead &&
            !d.policy.allowedDomains.length
          )
            d.policy.allowedDomains = ["docs.example.org"];
          break;
        case "cap":
          d.policy.runBudgetCents = Number(value);
          break;
        case "daily":
          d.policy.dailyBudgetCents =
            d.policy.dailyBudgetCents === 500 ? 1000 : 500;
          break;
        case "steps":
          d.policy.maxSteps = { 4: 8, 8: 12, 12: 4 }[d.policy.maxSteps];
          break;
        case "timeout":
          d.policy.timeoutSeconds = { 30: 90, 90: 180, 180: 30 }[
            d.policy.timeoutSeconds
          ];
          break;
        case "memory":
          d.policy.memory = value;
          break;
        case "review":
          go(s, "review");
          break;
        case "apply": {
          if (h.activeVersion !== s.draftBase)
            return {
              state: previous,
              notice:
                "The saved configuration changed. Discard this draft and start a fresh edit.",
            };
          if (d.id !== h.id)
            return {
              state: previous,
              notice:
                "Open the harness that owns this draft before applying it.",
            };
          const errors = validateConfig(d);
          if (errors.length) return { state: previous, notice: errors[0] };
          if (h.versions.length >= 100)
            return {
              state: previous,
              notice:
                "The demo version limit was reached. Export your config before resetting.",
            };
          h.activeVersion++;
          h.versions.push({ version: h.activeVersion, config: clone(d) });
          s.draft = null;
          s.draftBase = null;
          go(s, "detail");
          log(s, `Applied ${c.name} v${h.activeVersion}`, now);
          notice = `Version ${h.activeVersion} applies to future runs.`;
          break;
        }
        case "versions":
          go(s, "versions");
          break;
        case "restore":
          s.restoreVersion = Number(value);
          go(s, "restore");
          break;
        case "confirm-restore": {
          if (h.versions.length >= 100)
            return {
              state: previous,
              notice: "The demo version limit was reached.",
            };
          const previousConfig = h.versions.find(
            (x) => x.version === s.restoreVersion,
          ).config;
          h.activeVersion++;
          h.versions.push({
            version: h.activeVersion,
            config: clone(previousConfig),
          });
          go(s, "detail");
          log(s, `Restored v${s.restoreVersion} as v${h.activeVersion}`, now);
          notice = `Restored as version ${h.activeVersion}.`;
          break;
        }
        case "pause":
          h.paused = !h.paused;
          if (h.paused)
            s.runs
              .filter((x) => x.harnessId === h.id && ACTIVE.has(x.status))
              .forEach((x) => finish(s, x, "cancelled", now));
          log(s, `${c.name} ${h.paused ? "paused" : "resumed"}`, now);
          notice = h.paused
            ? "Harness paused. New runs are blocked."
            : "Harness resumed.";
          break;
        case "pause-all":
          go(s, "pause-all");
          break;
        case "confirm-pause-all":
          s.harnesses.forEach((x) => {
            x.paused = true;
          });
          s.runs
            .filter((x) => ACTIVE.has(x.status))
            .forEach((x) => finish(s, x, "cancelled", now));
          go(s, "home");
          log(s, "All harnesses paused", now, "warning");
          notice = "All harnesses paused.";
          break;
        case "prompt":
          if (h.paused)
            return {
              state: previous,
              notice:
                "This harness is paused. Resume it before starting a run.",
            };
          go(s, "prompt");
          break;
        case "sample-task":
          s.task = "Create a concise checklist for launching my first agent.";
          go(s, "run-review");
          break;
        case "start": {
          if (h.paused)
            return {
              state: previous,
              notice: "This harness is paused. Resume it first.",
            };
          if (s.runs.some((x) => ACTIVE.has(x.status)))
            return {
              state: previous,
              notice:
                "This demo runs one task at a time. Finish or stop the active task first.",
            };
          if (s.runs.some((x) => x.status === "needs_review"))
            return {
              state: previous,
              notice:
                "Check the unresolved tool outcome before starting another run.",
            };
          if (s.runs.length >= 100)
            return {
              state: previous,
              notice:
                "This demo stores 100 runs. Export your config before resetting.",
            };
          if (!validText(s.task, 600))
            return {
              state: previous,
              notice: "Add a valid task before running.",
            };
          const fault = s.fault;
          s.fault = "none";
          const reserve = fault === "budget" ? c.policy.runBudgetCents + 1 : 20;
          const next = {
            id: `R${String(s.nextRun++).padStart(3, "0")}`,
            harnessId: h.id,
            configVersion: h.activeVersion,
            config: clone(c),
            task: s.task,
            status: "running",
            costCents: 0,
            reservedCents: 20,
            effects: 0,
            fault,
            day: day(now),
            startedAt: now,
            deadline: now + c.policy.timeoutSeconds * 1000,
            approval: null,
            delivery: "ok",
            errorCode: null,
            result: `Task: ${s.task}\n\n1. Define the outcome and a small acceptance check.\n2. Enable only the tools the task needs.\n3. Test one bounded run, then review its result.\n\nSample fixture only; no AI inference or web research was performed.`,
            noteContent: `Checklist for: ${s.task}`,
          };
          if (
            reserve > c.policy.runBudgetCents ||
            dayUsed(s, h.id, now) + reserve > c.policy.dailyBudgetCents
          ) {
            next.status = "blocked";
            next.reservedCents = 0;
            next.errorCode = "BUDGET_EXCEEDED";
          }
          s.runs.push(next);
          s.selectedRunId = next.id;
          go(s, "run");
          log(
            s,
            `${next.id}: ${runStatus(next.status)} · pinned v${h.activeVersion}`,
            now,
            next.status === "blocked" ? "warning" : "info",
          );
          break;
        }
        case "approve":
          if (now >= r.approval.expiresAt) {
            finish(s, r, "expired", now);
            notice = "This approval expired. The note was not saved.";
            break;
          }
          if (
            r.approval.closed ||
            r.approval.noteContent !== r.noteContent ||
            !r.config.tools.notesWrite ||
            h.paused
          )
            return {
              state: previous,
              notice: "This write permission is no longer valid.",
            };
          r.approval.closed = true;
          r.approval.decidedAt = now;
          r.status = "writing";
          r.deadline = now + r.remainingMs;
          log(s, `${r.id}: exact note approved once`, now);
          break;
        case "deny":
          finish(s, r, "denied", now);
          break;
        case "cancel-run":
          finish(s, r, "cancelled", now);
          break;
        case "retry-run":
          s.task = r.task;
          s.selectedId = r.harnessId;
          go(s, "run-review");
          break;
        case "redeliver":
          r.delivery = "ok";
          notice = "Demo result delivered again. The task was not repeated.";
          log(s, `${r.id}: result delivery retried, no tools repeated`, now);
          break;
        case "reconcile":
          r.effects = 1;
          finish(s, r, "succeeded", now);
          notice =
            "Demo receipt confirms one saved note. No write was repeated.";
          break;
        case "export":
          go(s, "export");
          break;
        default:
          return { state: previous, notice: "That action is unavailable." };
      }
    } else return { state: previous, notice: "That action is unavailable." };
  }
  if (s.draft && DRAFT_SCREENS.has(s.screen)) s.draftCursor = s.screen;
  if (!s.draft) s.draftCursor = null;
  s.revision++;
  return { state: s, notice };
}

export function telegramPayload(s, now = Date.now()) {
  const v = view(s, now);
  const text = `<b>${escapeHTML(v.title)}</b>\n\n${v.paragraphs.map(escapeHTML).join("\n\n")}`;
  if ([v.title, ...v.paragraphs].join("\n\n").length > 4096)
    throw new Error(
      "Prototype screen exceeds the conservative Telegram text limit.",
    );
  const inline_keyboard = v.rows.map((row) =>
    row.map((x) => {
      const callback_data = `d:${s.revision}:${x.action}:${x.value}`;
      if (new TextEncoder().encode(callback_data).length > 64)
        throw new Error("Prototype callback exceeds Telegram limit.");
      return { text: x.label, callback_data };
    }),
  );
  return {
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard },
  };
}

/** Reject malformed persisted demos; never treat browser state as production identity. */
export function decodeSnapshot(raw) {
  try {
    if (typeof raw !== "string" || raw.length > 1500000) return null;
    const s = JSON.parse(raw);
    if (
      !s ||
      s.schemaVersion !== 1 ||
      !SCREENS.has(s.screen) ||
      !Number.isSafeInteger(s.revision) ||
      s.revision < 0 ||
      !Number.isSafeInteger(s.nextId) ||
      s.nextId < 2 ||
      !Number.isSafeInteger(s.nextRun) ||
      s.nextRun < 1 ||
      !FAULTS.includes(s.fault)
    )
      return null;
    if (
      !Array.isArray(s.harnesses) ||
      s.harnesses.length < 1 ||
      s.harnesses.length > 30 ||
      new Set(s.harnesses.map((h) => h.id)).size !== s.harnesses.length
    )
      return null;
    for (const h of s.harnesses) {
      if (
        typeof h.id !== "string" ||
        !/^h_[a-z0-9]{1,32}$/u.test(h.id) ||
        typeof h.paused !== "boolean" ||
        !Array.isArray(h.versions) ||
        h.versions.length < 1 ||
        h.versions.length > 100 ||
        h.activeVersion !== h.versions.length
      )
        return null;
      if (
        h.versions.some(
          (v, i) =>
            v.version !== i + 1 ||
            v.config.id !== h.id ||
            validateConfig(v.config).length,
        )
      )
        return null;
    }
    if (
      !selectedHarness(s) ||
      typeof s.task !== "string" ||
      length(s.task) > 600 ||
      secretPattern.test(s.task) ||
      !["config", "create-review"].includes(s.draftReturn)
    )
      return null;
    if (
      s.draft !== null &&
      (validateConfig(s.draft).length ||
        !DRAFT_SCREENS.has(s.draftCursor) ||
        (s.draftBase !== null &&
          (!Number.isInteger(s.draftBase) ||
            !s.harnesses.some((h) => h.id === s.draft.id))))
    )
      return null;
    if (s.draft === null && (s.draftBase !== null || s.draftCursor !== null))
      return null;
    if (
      [
        "mode",
        "template",
        "name",
        "create-review",
        "config",
        "instructions",
        "model",
        "tools",
        "domains",
        "limits",
        "memory",
        "review",
      ].includes(s.screen) &&
      !s.draft
    )
      return null;
    if (
      s.screen === "restore" &&
      !selectedHarness(s).versions.some((v) => v.version === s.restoreVersion)
    )
      return null;
    if (
      !Array.isArray(s.runs) ||
      s.runs.length > 100 ||
      new Set(s.runs.map((r) => r.id)).size !== s.runs.length
    )
      return null;
    const statuses = [
      "running",
      "awaiting_approval",
      "writing",
      "succeeded",
      "failed",
      "blocked",
      "cancelled",
      "denied",
      "expired",
      "needs_review",
    ];
    for (const r of s.runs) {
      if (
        !/^R\d{3}$/u.test(r.id) ||
        !s.harnesses.some(
          (h) =>
            h.id === r.harnessId &&
            h.versions.some(
              (v) =>
                v.version === r.configVersion &&
                JSON.stringify(v.config) === JSON.stringify(r.config),
            ),
        ) ||
        validateConfig(r.config).length ||
        r.config.id !== r.harnessId ||
        !statuses.includes(r.status) ||
        !validText(r.task, 600)
      )
        return null;
      if (
        ![
          r.costCents,
          r.reservedCents,
          r.effects,
          r.startedAt,
          r.deadline,
        ].every((x) => Number.isSafeInteger(x) && x >= 0) ||
        r.effects > 1 ||
        !FAULTS.includes(r.fault) ||
        !["ok", "failed"].includes(r.delivery) ||
        typeof r.result !== "string" ||
        r.result.length > 2000 ||
        typeof r.noteContent !== "string" ||
        r.noteContent.length > 700 ||
        !/^\d{4}-\d{2}-\d{2}$/u.test(r.day)
      )
        return null;
      if (
        !validTime(r.startedAt) ||
        !validTime(r.deadline) ||
        r.costCents + r.reservedCents > r.config.policy.runBudgetCents
      )
        return null;
      if (
        ["awaiting_approval", "writing"].includes(r.status) &&
        (!r.approval ||
          !validTime(r.approval.expiresAt) ||
          typeof r.approval.closed !== "boolean" ||
          r.approval.noteContent !== r.noteContent ||
          !Number.isSafeInteger(r.remainingMs) ||
          r.remainingMs < 0)
      )
        return null;
    }
    if (s.selectedRunId !== null && !selectedRun(s)) return null;
    if (
      !Array.isArray(s.events) ||
      s.events.length > 60 ||
      s.events.some(
        (x) =>
          !validTime(x.at) ||
          !validText(x.text, 200) ||
          !["info", "warning"].includes(x.kind),
      )
    )
      return null;
    telegramPayload(s);
    return s;
  } catch {
    return null;
  }
}
