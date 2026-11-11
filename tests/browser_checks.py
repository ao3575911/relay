"""Offline browser acceptance checks. Requires Python Playwright and Chromium."""

from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
import os
import shutil

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "evidence"
STORE = "relay-telegram-demo-v1"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def click(page, action, value=None):
    target = page.locator(f'#keyboard button[data-action="{action}"]')
    if value is not None:
        target = page.locator(
            f'#keyboard button[data-action="{action}"][data-value="{value}"]'
        )
    target.first.click()


def snapshot(page):
    return page.evaluate("key => JSON.parse(localStorage.getItem(key))", STORE)


def detail(page):
    page.locator("#menu-button").click()
    click(page, "list")
    click(page, "open")


def enable_notes(page):
    click(page, "configure")
    click(page, "edit", "tools")
    click(page, "tool", "notesWrite")
    click(page, "draft-back")
    click(page, "review")
    click(page, "apply")


def start(page, fault="none"):
    page.locator("#scenario").select_option(fault)
    click(page, "prompt")
    click(page, "sample-task")
    click(page, "start")


def main():
    EVIDENCE.mkdir(exist_ok=True)
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT))
    )
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    results = []
    all_errors = []
    try:
        with sync_playwright() as playwright:
            binary = os.environ.get("RELAY_CHROMIUM_BIN") or shutil.which("chromium")
            browser = playwright.chromium.launch(
                executable_path=binary, headless=True, args=["--no-sandbox"]
            )

            @contextmanager
            def fresh(name, width=1440, height=1040, init=None, standalone=False):
                context = browser.new_context(
                    viewport={"width": width, "height": height},
                    device_scale_factor=1,
                    reduced_motion="reduce",
                    timezone_id="Australia/Perth",
                )
                if init:
                    context.add_init_script(init)
                page = context.new_page()
                errors, outbound = [], []
                page.on("pageerror", lambda err: errors.append(str(err)))
                page.on(
                    "request",
                    lambda req: outbound.append(req.url)
                    if not req.url.startswith((origin, "file:", "data:"))
                    else None,
                )
                try:
                    url = origin + ("/Relay-Prototype.html" if standalone else "/prototype/")
                    page.goto(url, wait_until="networkidle")
                    expect(page.locator("#message-title")).to_have_text("Your agents. Your rules.")
                    yield page
                    assert not errors, errors
                    assert not outbound, outbound
                    results.append({"name": name, "passed": True})
                except Exception:
                    page.screenshot(path=str(EVIDENCE / "browser-failure.png"), full_page=True)
                    raise
                finally:
                    all_errors.extend(errors)
                    context.close()

            with fresh("advanced creation, exact approval, export, restore") as page:
                page.screenshot(path=str(EVIDENCE / "desktop-home.png"), full_page=True)
                click(page, "create")
                click(page, "mode", "advanced")
                click(page, "template", "research")
                page.locator("#message-input").fill("Field notes")
                page.locator("#send-button").click()
                click(page, "save-new")
                expect(page.locator("#message-title")).to_have_text("Field notes")
                enable_notes(page)
                start(page)
                expect(page.locator("#message-title")).to_have_text("Needs your approval", timeout=8000)
                page.screenshot(path=str(EVIDENCE / "approval.png"), full_page=True)
                click(page, "approve")
                expect(page.locator("#message-title")).to_have_text("Completed", timeout=8000)
                assert snapshot(page)["runs"][-1]["effects"] == 1
                click(page, "detail")
                with page.expect_download() as download:
                    click(page, "export")
                exported = json.loads(Path(download.value.path()).read_text())
                assert exported["name"] == "Field notes"
                assert exported["tools"]["notesWrite"] is True
                assert set(exported) == {"schemaVersion", "id", "name", "mode", "agent", "tools", "policy"}
                click(page, "detail")
                click(page, "versions")
                click(page, "restore", "1")
                click(page, "confirm-restore")
                state = snapshot(page)
                harness = next(h for h in state["harnesses"] if h["id"] == state["selectedId"])
                assert harness["activeVersion"] == 3
                assert harness["versions"][-1]["config"]["tools"]["notesWrite"] is False

            with fresh("draft survives Home and refresh; stale buttons reject") as page:
                detail(page)
                click(page, "configure")
                click(page, "edit", "instructions")
                page.locator("#message-input").fill("Produce three concise next steps.")
                page.locator("#send-button").click()
                page.locator("#menu-button").click()
                page.reload(wait_until="networkidle")
                click(page, "continue")
                assert snapshot(page)["draft"]["agent"]["instructions"] == "Produce three concise next steps."
                before = snapshot(page)
                page.locator("#stale-button").click()
                expect(page.locator("#notice")).to_contain_text("out of date")
                assert snapshot(page) == before

            with fresh("provider timeout") as page:
                detail(page)
                start(page, "provider")
                expect(page.locator("#message-title")).to_have_text("Could not complete", timeout=8000)
                assert snapshot(page)["runs"][-1]["effects"] == 0
                expect(page.locator('[data-action="retry-run"]')).to_be_visible()

            with fresh("wizard resumes its exact saved step") as page:
                click(page, "create")
                click(page, "mode", "advanced")
                page.locator("#menu-button").click()
                page.reload(wait_until="networkidle")
                click(page, "continue")
                expect(page.locator("#message-title")).to_have_text("Choose a starting point")
                assert snapshot(page)["draft"]["mode"] == "advanced"

            with fresh("budget stops before tools") as page:
                detail(page)
                start(page, "budget")
                expect(page.locator("#message-title")).to_have_text("Stopped at budget check")
                assert snapshot(page)["runs"][-1]["costCents"] == 0

            with fresh("expired approval never writes") as page:
                detail(page)
                enable_notes(page)
                start(page, "expired")
                expect(page.locator("#message-title")).to_have_text("Approval expired", timeout=8000)
                assert snapshot(page)["runs"][-1]["effects"] == 0

            with fresh("delivery-only retry preserves work and costs") as page:
                detail(page)
                start(page, "delivery")
                expect(page.locator("#message-title")).to_have_text("Completed", timeout=8000)
                before = snapshot(page)["runs"][-1]
                click(page, "redeliver")
                after = snapshot(page)["runs"][-1]
                assert after["delivery"] == "ok"
                assert (before["id"], before["effects"], before["costCents"]) == (after["id"], after["effects"], after["costCents"])

            with fresh("unknown write reconciles without repeat") as page:
                detail(page)
                enable_notes(page)
                start(page, "unknown")
                expect(page.locator("#message-title")).to_have_text("Needs your approval", timeout=8000)
                click(page, "approve")
                expect(page.locator("#message-title")).to_have_text("Outcome needs checking", timeout=8000)
                expect(page.locator('[data-action="retry-run"]')).to_have_count(0)
                click(page, "reconcile")
                expect(page.locator("#message-title")).to_have_text("Completed")
                assert snapshot(page)["runs"][-1]["effects"] == 1

            with fresh("expired persisted approval is rejected on reload") as page:
                detail(page)
                enable_notes(page)
                start(page)
                expect(page.locator("#message-title")).to_have_text("Needs your approval", timeout=8000)
                page.evaluate("key => {const s=JSON.parse(localStorage.getItem(key)); s.runs.at(-1).approval.expiresAt=Date.now()-1; localStorage.setItem(key,JSON.stringify(s));}", STORE)
                page.reload(wait_until="networkidle")
                expect(page.locator("#message-title")).to_have_text("Approval expired")
                assert snapshot(page)["runs"][-1]["effects"] == 0

            with fresh("pause and workspace confirmation") as page:
                detail(page)
                click(page, "pause")
                click(page, "prompt")
                expect(page.locator("#notice")).to_contain_text("paused")
                assert len(snapshot(page)["runs"]) == 0
                click(page, "pause")
                page.locator("#pause-all-button").click()
                assert not snapshot(page)["harnesses"][0]["paused"]
                click(page, "confirm-pause-all")
                assert all(h["paused"] for h in snapshot(page)["harnesses"])

            with fresh("corrupt storage recovery", init=f"localStorage.setItem('{STORE}', '{{broken');") as page:
                expect(page.locator("#notice")).to_contain_text("fresh demo")

            with fresh("storage disabled keeps UI usable", init="Object.defineProperty(window,'localStorage',{get(){throw new Error('storage blocked')}});") as page:
                expect(page.locator("#storage-note")).to_contain_text("Storage unavailable")
                click(page, "create")
                expect(page.locator("#message-title")).to_have_text("How would you like to build?")

            with fresh("storage quota failure keeps UI usable", init="Storage.prototype.setItem = function(){throw new DOMException('full','QuotaExceededError')};") as page:
                expect(page.locator("#storage-note")).to_contain_text("Storage unavailable")
                click(page, "create")
                expect(page.locator("#message-title")).to_have_text("How would you like to build?")

            with fresh("credential-like input is not echoed or stored") as page:
                click(page, "create")
                click(page, "mode", "simple")
                click(page, "template", "blank")
                fake = "sk-FAKE_CREDENTIAL_FOR_REJECTION_12345"
                page.locator("#message-input").fill(fake)
                page.locator("#send-button").click()
                expect(page.locator("#notice")).to_contain_text("not saved")
                assert fake not in json.dumps(snapshot(page))
                assert fake not in page.locator("#history").inner_text()

            with fresh("keyboard navigation and reset cancel/confirm") as page:
                page.locator('#keyboard [data-action="create"]').focus()
                page.keyboard.press("Enter")
                expect(page.locator("#message-title")).to_have_text("How would you like to build?")
                page.locator("#reset-button").click()
                page.locator("#reset-cancel").click()
                assert snapshot(page)["draft"] is not None
                page.locator("#reset-button").click()
                page.locator("#reset-confirm").click()
                assert snapshot(page)["draft"] is None

            for width in (320, 390, 768, 1440):
                with fresh(f"responsive layout {width}px", width=width, height=900) as page:
                    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
                    assert min(page.locator("#keyboard button").evaluate_all("xs => xs.map(x=>x.getBoundingClientRect().height)")) >= 44
                    if width == 390:
                        page.screenshot(path=str(EVIDENCE / "mobile-home.png"), full_page=True)

            with fresh("standalone bundle runs offline after loading", standalone=True) as page:
                page.context.set_offline(True)
                click(page, "create")
                click(page, "mode", "simple")
                click(page, "template", "research")
                click(page, "use-name")
                click(page, "save-new")
                expect(page.locator("#message-title")).to_have_text("Scout")
                page.locator("#menu-button").click()
                click(page, "create")
                expect(page.locator("#message-title")).to_have_text("How would you like to build?")

            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
    report = {"passed": len(results), "failed": 0, "page_errors": all_errors, "external_requests": 0, "checks": results}
    (EVIDENCE / "browser-results.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
