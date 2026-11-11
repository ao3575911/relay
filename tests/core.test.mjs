import test from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  step,
  view,
  telegramPayload,
  selectedHarness,
  activeConfig,
  selectedRun,
  decodeSnapshot,
  validateConfig,
  sampleConfig,
  changes,
} from "../prototype/core.mjs";

const TIME = 1804800000000;
const action = (s, name, value = "", now = TIME) =>
  step(s, { type: "action", action: name, value, revision: s.revision }, now)
    .state;
const text = (s, value, now = TIME) =>
  step(s, { type: "text", text: value, revision: s.revision }, now).state;
const open = (s) => action(action(s, "list"), "open", s.selectedId);
const advance = (s, now = TIME + 1000) =>
  step(s, { type: "advance", runId: selectedRun(s).id }, now).state;
const configure = (s) => action(open(s), "configure");
function withNotes(s = createState(TIME)) {
  s = action(configure(s), "edit", "tools");
  s = action(s, "tool", "notesWrite");
  s = action(s, "draft-back");
  s = action(s, "review");
  s = action(s, "apply");
  return s;
}
function start(s = createState(TIME), fault = "none", now = TIME) {
  s = step(s, { type: "fault", fault }, now).state;
  s = action(open(action(s, "home")), "prompt", "", now);
  s = action(s, "sample-task", "", now);
  return action(s, "start", "", now);
}
const renderable = (s) => {
  const payload = telegramPayload(s, TIME);
  assert.ok(payload.text.length > 0);
  assert.equal(payload.parse_mode, "HTML");
  assert.ok(
    payload.reply_markup.inline_keyboard
      .flat()
      .every((x) => Buffer.byteLength(x.callback_data) <= 64),
  );
  assert.ok(decodeSnapshot(JSON.stringify(s)));
};

test("seed and all supported mode/template paths render and save valid configs", () => {
  for (const mode of ["simple", "advanced"])
    for (const template of ["research", "writing", "blank"]) {
      let s = createState(TIME);
      renderable(s);
      for (const [name, value] of [
        ["create", ""],
        ["mode", mode],
        ["template", template],
        ["use-name", ""],
        ["save-new", ""],
      ]) {
        s = action(s, name, value);
        renderable(s);
      }
      assert.equal(s.harnesses.length, 2);
      assert.equal(activeConfig(selectedHarness(s)).mode, mode);
    }
});
test("name and instructions accept Unicode, and HTML is escaped in Telegram", () => {
  let s = action(createState(TIME), "create");
  s = action(s, "mode", "advanced");
  s = action(s, "template", "blank");
  s = text(s, "研究 <agent> & friends");
  s = action(s, "edit", "instructions");
  s = text(s, "&".repeat(2000));
  renderable(s);
  assert.ok(telegramPayload(s).text.includes("&amp;"));
  assert.ok(telegramPayload(s).text.includes("&lt;agent&gt;"));
  assert.ok(!telegramPayload(s).text.includes("<agent>"));
});
test("invalid input and credential-like text leave drafts unchanged and do not echo values", () => {
  let s = action(createState(TIME), "create");
  s = action(s, "mode", "simple");
  s = action(s, "template", "blank");
  for (const value of [
    "",
    " ".repeat(10),
    "x".repeat(41),
    "name\u202e",
    "sk-THIS_IS_A_FAKE_CREDENTIAL_123456789",
  ]) {
    const result = step(
      s,
      { type: "text", text: value, revision: s.revision },
      TIME,
    );
    assert.equal(result.state, s);
    assert.ok(result.notice);
    assert.ok(!result.notice.includes(value) || value === "");
  }
});
test("stale clicks, duplicate clicks, unknown actions and arbitrary values do not mutate state", () => {
  const initial = createState(TIME),
    s = action(initial, "create");
  for (const e of [
    { type: "action", action: "create", revision: initial.revision },
    { type: "action", action: "apply", revision: s.revision },
    {
      type: "action",
      action: "mode",
      value: "__proto__",
      revision: s.revision,
    },
    { type: "action", action: "tool", value: "shell", revision: s.revision },
    { type: "nonsense" },
  ])
    assert.equal(step(s, e, TIME).state, s);
});
test("Home preserves a draft and Continue returns to its owning harness", () => {
  let s = configure(createState(TIME));
  const draftId = s.draft.id;
  s = action(s, "home");
  s = action(s, "continue");
  assert.equal(s.screen, "config");
  assert.equal(s.selectedId, draftId);
  assert.ok(s.draft);
});
test("configuration edits stay in a draft until reviewed and create immutable versions", () => {
  const base = createState(TIME);
  let s = configure(base);
  s = action(s, "edit", "model");
  s = action(s, "model", "fast");
  s = action(s, "draft-back");
  assert.equal(activeConfig(selectedHarness(s)).agent.modelProfile, "balanced");
  assert.equal(s.draft.agent.modelProfile, "fast");
  s = action(s, "review");
  renderable(s);
  s = action(s, "apply");
  assert.equal(selectedHarness(s).activeVersion, 2);
  assert.equal(
    selectedHarness(s).versions[0].config.agent.modelProfile,
    "balanced",
  );
  assert.equal(activeConfig(selectedHarness(s)).agent.modelProfile, "fast");
  assert.equal(base.harnesses[0].activeVersion, 1);
});
test("CAS conflict rejects applying an out-of-date draft", () => {
  let s = configure(createState(TIME));
  s = action(s, "toggle-mode");
  s = action(s, "review");
  s.harnesses[0].activeVersion = 2;
  s.harnesses[0].versions.push({ version: 2, config: sampleConfig() });
  const result = step(
    s,
    { type: "action", action: "apply", revision: s.revision },
    TIME,
  );
  assert.equal(result.state, s);
  assert.match(result.notice, /changed/u);
});
test("empty diffs have no Apply button; discard is reversible", () => {
  let s = action(configure(createState(TIME)), "review");
  assert.ok(
    !view(s)
      .rows.flat()
      .some((x) => x.action === "apply"),
  );
  s = action(s, "discard");
  assert.equal(s.draft, null);
  assert.equal(selectedHarness(s).activeVersion, 1);
});
test("advanced controls, domains, memory and model round-trip validly", () => {
  let s = configure(createState(TIME));
  s = action(s, "toggle-mode");
  s = action(s, "edit", "limits");
  for (const [name, value] of [
    ["cap", "100"],
    ["daily", ""],
    ["steps", ""],
    ["timeout", ""],
  ]) {
    s = action(s, name, value);
    renderable(s);
  }
  s = action(s, "draft-back");
  s = action(s, "edit", "memory");
  s = action(s, "memory", "run");
  s = action(s, "draft-back");
  s = action(s, "edit", "tools");
  s = action(s, "tool", "webRead");
  s = action(s, "edit", "domains");
  for (const invalid of [
    "http://example.org",
    "*.example.org",
    "127.0.0.1",
    "localhost",
    "example.local",
    "a.com,a.com",
  ])
    assert.equal(text(s, invalid), s);
  s = text(s, "example.org, docs.example.org");
  s = action(s, "draft-back");
  s = action(s, "review");
  s = action(s, "apply");
  renderable(s);
  assert.equal(activeConfig(selectedHarness(s)).policy.memory, "run");
});
test("every write requires an exact, unexpired, single-use approval", () => {
  let s = advance(start(withNotes()));
  assert.equal(selectedRun(s).status, "awaiting_approval");
  assert.equal(selectedRun(s).effects, 0);
  renderable(s);
  const before = s;
  s = action(s, "approve", "", TIME + 2000);
  assert.equal(selectedRun(s).status, "writing");
  assert.equal(selectedRun(s).effects, 0);
  assert.equal(
    step(
      s,
      { type: "action", action: "approve", revision: before.revision },
      TIME + 2000,
    ).state,
    s,
  );
  s = advance(s, TIME + 3000);
  assert.equal(selectedRun(s).effects, 1);
  assert.equal(selectedRun(s).status, "succeeded");
  assert.equal(
    step(
      s,
      { type: "action", action: "approve", revision: s.revision },
      TIME + 4000,
    ).state,
    s,
  );
  renderable(s);
});
test("declined, expired and tampered approvals cannot save a note", () => {
  const pending = advance(start(withNotes()));
  const denied = action(pending, "deny");
  assert.equal(selectedRun(denied).effects, 0);
  assert.equal(selectedRun(denied).status, "denied");
  const expired = action(pending, "approve", "", TIME + 601000);
  assert.equal(selectedRun(expired).status, "expired");
  assert.equal(selectedRun(expired).effects, 0);
  const tampered = structuredClone(pending);
  selectedRun(tampered).noteContent += "changed";
  assert.equal(action(tampered, "approve", "", TIME + 2000), tampered);
});
test("expiry is enforced after refresh and without clicking a button", () => {
  let s = advance(start(withNotes()));
  s = decodeSnapshot(JSON.stringify(s));
  s = step(s, { type: "tick" }, TIME + 601000).state;
  assert.equal(selectedRun(s).status, "expired");
  renderable(s);
});
test("approval wait does not replenish the active runtime allowance", () => {
  let s = advance(start(withNotes()), TIME + 20000);
  const remaining = selectedRun(s).remainingMs;
  s = action(s, "approve", "", TIME + 300000);
  assert.equal(selectedRun(s).deadline, TIME + 300000 + remaining);
});
test("read-only runs need no approval and cannot create side effects", () => {
  const s = advance(start());
  assert.equal(selectedRun(s).status, "succeeded");
  assert.equal(selectedRun(s).effects, 0);
  assert.equal(selectedRun(s).costCents, 8);
  renderable(s);
});
test("provider timeout preserves accounted usage; retry opens a new reviewed run", () => {
  let s = advance(start(createState(TIME), "provider"));
  assert.equal(selectedRun(s).status, "failed");
  assert.equal(selectedRun(s).costCents, 2);
  assert.equal(selectedRun(s).effects, 0);
  renderable(s);
  s = action(s, "retry-run");
  assert.equal(s.screen, "run-review");
  s = action(s, "start");
  assert.equal(s.runs.length, 2);
  assert.equal(selectedRun(s).status, "running");
});
test("run budget blocks before execution and daily budget includes reservations", () => {
  let s = start(createState(TIME), "budget");
  assert.equal(selectedRun(s).status, "blocked");
  assert.equal(selectedRun(s).costCents, 0);
  assert.equal(selectedRun(s).reservedCents, 0);
  s = createState(TIME);
  for (let i = 0; i < 61; i++) s = advance(start(s));
  assert.equal(s.runs.at(-1).status, "succeeded");
  s = start(s);
  assert.equal(selectedRun(s).status, "blocked");
  assert.equal(selectedRun(s).effects, 0);
  const nextDay = TIME + 86400000;
  s = start(s, "none", nextDay);
  assert.equal(selectedRun(s).status, "running");
});
test("one active run is allowed in the demo", () => {
  let s = start();
  s = action(s, "detail");
  s = action(s, "prompt");
  s = action(s, "sample-task");
  const result = step(
    s,
    { type: "action", action: "start", revision: s.revision },
    TIME,
  );
  assert.equal(result.state, s);
  assert.match(result.notice, /one task/u);
});
test("pause revokes pending approval and prevents more steps; resume permits a new run", () => {
  let s = advance(start(withNotes()));
  s = action(s, "detail");
  s = action(s, "pause");
  assert.equal(selectedRun(s).status, "cancelled");
  assert.equal(selectedRun(s).approval.closed, true);
  assert.equal(selectedHarness(s).paused, true);
  assert.equal(action(s, "prompt"), s);
  s = action(s, "pause");
  assert.equal(action(s, "prompt").screen, "prompt");
  renderable(s);
});
test("workspace pause is explicit and blocks every harness", () => {
  let s = start();
  s = action(s, "pause-all");
  assert.equal(selectedHarness(s).paused, false);
  s = action(s, "confirm-pause-all");
  assert.ok(s.harnesses.every((h) => h.paused));
  assert.equal(selectedRun(s).status, "cancelled");
  renderable(s);
});
test("run snapshots remain pinned when a newer configuration is applied", () => {
  let s = start();
  const pinned = selectedRun(s).config;
  s = action(s, "detail");
  s = action(s, "configure");
  s = action(s, "toggle-mode");
  s = action(s, "review");
  s = action(s, "apply");
  assert.equal(selectedRun(s).configVersion, 1);
  assert.deepEqual(selectedRun(s).config, pinned);
  assert.equal(selectedHarness(s).activeVersion, 2);
});
test("restore creates a new version without rewriting version history", () => {
  let s = withNotes();
  s = action(s, "versions");
  s = action(s, "restore", "1");
  renderable(s);
  s = action(s, "confirm-restore");
  assert.equal(selectedHarness(s).activeVersion, 3);
  assert.equal(activeConfig(selectedHarness(s)).tools.notesWrite, false);
  assert.equal(selectedHarness(s).versions[1].config.tools.notesWrite, true);
});
test("uncertain writes require reconciliation and never offer write retry", () => {
  let s = advance(start(withNotes(), "unknown"));
  s = action(s, "approve", "", TIME + 2000);
  s = advance(s, TIME + 3000);
  assert.equal(selectedRun(s).status, "needs_review");
  assert.ok(
    !view(s)
      .rows.flat()
      .some((x) => x.action === "retry-run"),
  );
  const before = s;
  s = action(s, "detail");
  s = action(s, "prompt");
  s = action(s, "sample-task");
  assert.equal(action(s, "start"), s);
  s = action(action(before, "reconcile"), "detail");
  assert.equal(selectedRun(s).effects, 1);
  assert.equal(selectedRun(s).status, "succeeded");
});
test("delivery retry sends the existing result without re-executing work", () => {
  for (const notes of [false, true]) {
    let s = advance(start(notes ? withNotes() : createState(TIME), "delivery"));
    if (notes) s = advance(action(s, "approve", "", TIME + 2000), TIME + 3000);
    assert.equal(selectedRun(s).delivery, "failed");
    const before = structuredClone(selectedRun(s));
    s = action(s, "redeliver");
    assert.equal(selectedRun(s).delivery, "ok");
    assert.equal(selectedRun(s).effects, before.effects);
    assert.equal(selectedRun(s).costCents, before.costCents);
    assert.equal(s.runs.length, 1);
    renderable(s);
  }
});
test("timeout and duplicate worker events cannot repeat an effect", () => {
  let s = start();
  s = advance(s, TIME + 91000);
  assert.equal(selectedRun(s).status, "failed");
  const unchanged = advance(s, TIME + 92000);
  assert.equal(unchanged, s);
});
test("history, approval inbox, help and config export remain valid Telegram screens", () => {
  let s = advance(start(withNotes()));
  s = action(s, "home");
  s = action(s, "approvals");
  renderable(s);
  s = action(s, "open-run", s.selectedRunId);
  renderable(s);
  s = action(s, "home");
  s = action(s, "history");
  renderable(s);
  s = action(s, "home");
  s = action(s, "help");
  renderable(s);
  s = open(action(s, "home"));
  s = action(s, "export");
  renderable(s);
});
test("configuration validator rejects unknown fields, bypass policies and malformed structures", () => {
  assert.deepEqual(validateConfig(sampleConfig()), []);
  for (const mutate of [
    (c) => {
      c.policy.approvalMode = "never";
    },
    (c) => {
      c.agent = null;
    },
    (c) => {
      c.tools = null;
    },
    (c) => {
      c.tools.shell = true;
    },
    (c) => {
      c.policy.runBudgetCents = -1;
    },
    (c) => {
      c.policy.allowedDomains = ["localhost"];
    },
    (c) => {
      c.policy = null;
    },
  ]) {
    const c = sampleConfig();
    mutate(c);
    assert.ok(validateConfig(c).length);
  }
  assert.deepEqual(changes(sampleConfig(), sampleConfig()), []);
});
test("malformed and oversized persisted demos reset safely", () => {
  for (const raw of [
    "not json",
    "{}",
    "null",
    "x".repeat(1500001),
    JSON.stringify({ ...createState(TIME), screen: "invalid" }),
    JSON.stringify({ ...createState(TIME), harnesses: [] }),
    JSON.stringify({ ...createState(TIME), runs: [{}] }),
    JSON.stringify({ ...createState(TIME), draft: {} }),
    JSON.stringify({
      ...createState(TIME),
      events: [
        { at: Number.MAX_SAFE_INTEGER, text: "Invalid date", kind: "info" },
      ],
    }),
  ])
    assert.equal(decodeSnapshot(raw), null);
});
test("model explores reachable screens with payload and persistence invariants", () => {
  let seed = 7019;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const seen = new Set();
  for (let round = 0; round < 18; round++) {
    let s = createState(TIME);
    for (let i = 0; i < 65; i++) {
      renderable(s);
      seen.add(s.screen);
      const v = view(s, TIME),
        options = v.rows.flat();
      if (s.runs.some((r) => ["running", "writing"].includes(r.status)))
        s = advance(s);
      else if (v.input && random() < 0.55)
        s = text(
          s,
          s.screen === "domains" ? "docs.example.org" : "Useful demo content",
        );
      else {
        const chosen = options[Math.floor(random() * options.length)];
        s = action(s, chosen.action, chosen.value);
      }
    }
  }
  assert.ok(seen.size >= 18, `Only reached ${seen.size} screens`);
});
