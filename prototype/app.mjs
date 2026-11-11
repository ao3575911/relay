import {
  createState,
  decodeSnapshot,
  step,
  view,
  telegramPayload,
  selectedHarness,
  activeConfig,
  selectedRun,
  money,
} from "./core.mjs";

const $ = (id) => document.getElementById(id);
const STORE = "relay-telegram-demo-v1";
const DISPLAY_ZONE = "Australia/Perth";
let storageOK = true,
  storageWarning = "",
  stored = null;
try {
  stored = localStorage.getItem(STORE);
} catch {
  storageOK = false;
}
const restoredState = stored ? decodeSnapshot(stored) : null;
let state = restoredState || createState();
if (stored && !restoredState)
  storageWarning =
    "Saved demo data could not be read. A fresh demo was opened.";
state = step(state, { type: "tick" }).state;
const chatHistory = [];
let workerTimer = null,
  workerKey = null;
let lastNotice = storageWarning;

const clock = () =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_ZONE,
  }).format(new Date());
function notice(text) {
  lastNotice = text;
  $("notice").textContent = text;
  $("notice").hidden = !text;
}
function persist() {
  if (!storageOK) return;
  try {
    const snapshot = JSON.stringify(state);
    if (snapshot.length > 1500000)
      throw new Error("Demo storage limit reached");
    localStorage.setItem(STORE, snapshot);
  } catch {
    storageOK = false;
    notice(
      "Browser storage is unavailable. You can keep exploring; changes may not survive a refresh.",
    );
  }
}
function addHistory(text, kind = "user") {
  chatHistory.push({ text, kind });
  if (chatHistory.length > 3) chatHistory.shift();
}
function downloadConfig() {
  try {
    const c = activeConfig(selectedHarness(state));
    const blob = new Blob([`${JSON.stringify(c, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relay-${c.id}-v${selectedHarness(state).activeVersion}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    notice(
      "The download could not start. Open Telegram payload or try again in a browser that permits downloads.",
    );
  }
}
function act(action, value = "", revision = state.revision, label = "") {
  const previous = state;
  const result = step(state, { type: "action", action, value, revision });
  if (result.state !== previous) {
    if (label && !["home", "detail", "draft-back"].includes(action))
      addHistory(label);
    state = result.state;
  }
  notice(result.notice);
  persist();
  render();
  if (action === "export" && state !== previous) downloadConfig();
}
function navigateHome() {
  act("home");
}
function scheduleWorker() {
  const run = state.runs.find((r) => ["running", "writing"].includes(r.status));
  const key = run ? `${run.id}:${run.status}` : null;
  if (key === workerKey) return;
  clearTimeout(workerTimer);
  workerTimer = null;
  workerKey = key;
  if (!run) return;
  workerTimer = setTimeout(() => {
    const result = step(state, { type: "advance", runId: run.id });
    state = result.state;
    workerKey = null;
    notice(result.notice);
    persist();
    render();
  }, 1600);
}
function render() {
  const v = view(state),
    h = selectedHarness(state),
    c = activeConfig(h),
    run = selectedRun(state);
  $("message-title").textContent = v.title;
  $("screen-step").textContent = v.eyebrow;
  $("message-body").replaceChildren(
    ...v.paragraphs.filter(Boolean).map((text) => {
      const p = document.createElement("p");
      p.textContent = text;
      return p;
    }),
  );
  $("history").replaceChildren(
    ...chatHistory.map((item) => {
      const div = document.createElement("div");
      div.className = item.kind === "user" ? "past-message" : "past-summary";
      div.textContent = item.text;
      return div;
    }),
  );
  const revision = state.revision;
  const keyboardHadFocus = $("keyboard").contains(document.activeElement);
  $("keyboard").replaceChildren(
    ...v.rows.map((row) => {
      const div = document.createElement("div");
      div.className = "keyboard-row";
      row.forEach((button) => {
        const el = document.createElement("button");
        el.type = "button";
        el.textContent = button.label;
        el.className = button.tone;
        el.dataset.action = button.action;
        el.dataset.value = button.value;
        el.dataset.revision = String(revision);
        el.addEventListener("click", () =>
          act(button.action, button.value, revision, button.label),
        );
        div.append(el);
      });
      return div;
    }),
  );
  const input = $("message-input");
  const inputScreenChanged = input.dataset.screen !== state.screen;
  input.dataset.screen = state.screen;
  input.disabled = !v.input;
  $("send-button").disabled = !v.input;
  input.placeholder = v.input?.placeholder ?? "Choose a button above";
  input.maxLength = v.input ? v.input.maxLength * 2 : 1;
  input.setAttribute(
    "aria-label",
    v.input?.label ?? "Choose a button to begin",
  );
  if (inputScreenChanged) input.value = "";
  $("typing").hidden = !state.runs.some((r) =>
    ["running", "writing"].includes(r.status),
  );
  $("scenario").value = state.fault;
  const rows = [
    ["Selected harness", c.name],
    [
      "Configuration",
      `v${h.activeVersion}${state.draft ? " · draft open" : ""}`,
    ],
    ["Harness status", h.paused ? "Paused" : "Ready"],
    ["Run cap", `${money(c.policy.runBudgetCents)} USD`],
    ["Display time", "Perth · UTC+8"],
    ["Current screen", state.screen],
    [
      "Latest run",
      run ? `${run.id} · ${run.status.replaceAll("_", " ")}` : "No runs yet",
    ],
  ];
  $("state-details").replaceChildren(
    ...rows.map(([label, value]) => {
      const div = document.createElement("div"),
        dt = document.createElement("dt"),
        dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      div.append(dt, dd);
      return div;
    }),
  );
  $("event-list").replaceChildren(
    ...state.events
      .slice(-4)
      .reverse()
      .map((item) => {
        const li = document.createElement("li"),
          time = document.createElement("time");
        li.className = item.kind;
        li.textContent = item.text;
        time.dateTime = new Date(item.at).toISOString();
        time.textContent = new Date(item.at).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: DISPLAY_ZONE,
        });
        li.append(time);
        return li;
      }),
  );
  $("payload").textContent = JSON.stringify(telegramPayload(state), null, 2);
  $("message-clock").textContent = clock();
  $("clock").textContent = clock();
  $("storage-note").textContent = storageOK
    ? "Demo state saves in this browser. Use sample text only."
    : "Storage unavailable. This session stays in memory until you close or refresh.";
  // Announce the current screen without replaying the entire conversation.
  $("current-message").setAttribute("aria-live", "polite");
  if (keyboardHadFocus) {
    if (v.input) input.focus({ preventScroll: true });
    else $("keyboard").querySelector("button")?.focus({ preventScroll: true });
  }
  requestAnimationFrame(() => {
    $("conversation").scrollTop = Math.max(
      0,
      $("current-message").offsetTop - $("conversation").offsetTop - 12,
    );
  });
  scheduleWorker();
}

$("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("message-input"),
    text = input.value;
  const result = step(state, { type: "text", text, revision: state.revision });
  if (result.state !== state) {
    addHistory(text.trim());
    state = result.state;
    input.value = "";
  }
  notice(result.notice);
  persist();
  render();
});
$("message-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("composer").requestSubmit();
  }
});
$("menu-button").addEventListener("click", navigateHome);
$("phone-home").addEventListener("click", navigateHome);
$("phone-help").addEventListener("click", () => {
  navigateHome();
  act("help");
});
$("start-tour").addEventListener("click", () => {
  navigateHome();
  act(state.draft ? "continue" : "create");
  $("conversation").scrollIntoView({
    block: "center",
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
  });
});
document.querySelector(".wordmark").addEventListener("click", (event) => {
  event.preventDefault();
  navigateHome();
});
$("scenario").addEventListener("change", (event) => {
  const result = step(state, { type: "fault", fault: event.target.value });
  state = result.state;
  notice(result.notice);
  persist();
  render();
});
$("stale-button").addEventListener("click", () =>
  act("home", "", state.revision - 1),
);
$("export-button").addEventListener("click", downloadConfig);
$("pause-all-button").addEventListener("click", () => act("pause-all"));
$("reset-button").addEventListener("click", () =>
  $("reset-dialog").showModal(),
);
$("reset-cancel").addEventListener("click", () => $("reset-dialog").close());
$("reset-confirm").addEventListener("click", () => {
  clearTimeout(workerTimer);
  workerKey = null;
  state = createState();
  chatHistory.length = 0;
  $("reset-dialog").close();
  notice("A fresh demo is ready.");
  persist();
  render();
});
window.addEventListener("storage", (event) => {
  if (event.key !== STORE) return;
  const restored = decodeSnapshot(event.newValue);
  if (restored) {
    state = step(restored, { type: "tick" }).state;
    chatHistory.length = 0;
    notice("Demo state updated from another tab. Use the latest buttons.");
    render();
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    const next = step(state, { type: "tick" });
    if (next.state !== state) {
      state = next.state;
      persist();
      render();
    }
  }
});
setInterval(() => {
  const next = step(state, { type: "tick" });
  if (next.state !== state) {
    state = next.state;
    notice("An approval expired. No note was saved.");
    persist();
    render();
  }
}, 1000);
notice(
  lastNotice ||
    (!storageOK
      ? "Browser storage is unavailable. This demo will continue in memory."
      : ""),
);
persist();
render();
