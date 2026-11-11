import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const errors = [];

function fail(message) {
  errors.push(message);
}

async function read(relative) {
  return readFile(path.join(root, relative), "utf8");
}

const packageJson = JSON.parse(await read("package.json"));
if (packageJson.version !== "0.1.0") {
  fail(`package.json version is ${packageJson.version}, expected 0.1.0`);
}

const versionFiles = ["README.md", "CHANGELOG.md"];
const docsDir = path.join(root, "docs");
for (const name of await readdir(docsDir)) {
  if (name.endsWith(".md")) versionFiles.push(path.join("docs", name));
}
for (const relative of versionFiles) {
  const text = await read(relative);
  if (!text.includes("0.1.0")) fail(`${relative} does not mention 0.1.0`);
  if (/30 tests/i.test(text)) fail(`${relative} still says 30 tests`);
  if (
    /security boundary/i.test(text) &&
    !/not a security boundary/i.test(text)
  ) {
    fail(
      `${relative} mentions a security boundary without saying the prototype is not one`,
    );
  }
}

const changelog = await read("CHANGELOG.md");
if (!changelog.includes("## [Unreleased]")) {
  fail("CHANGELOG.md is missing the Unreleased section");
}
if (!changelog.includes("## [0.1.0] - 2026-11-12")) {
  fail("CHANGELOG.md is missing [0.1.0] - 2026-11-12");
}

const index = await read("docs/index.md");
for (const name of [
  "01_PRD.md",
  "02_TECHNICAL_SPEC.md",
  "03_DESIGN_BLUEPRINT.md",
  "04_BUILD_PLAN.md",
  "05_VALIDATION.md",
]) {
  if (!index.includes(name)) fail(`docs/index.md does not link to ${name}`);
}

const coreLog = await read("evidence/core-results.txt");
if (!/ℹ tests 28\b/.test(coreLog)) {
  fail("evidence/core-results.txt does not record 28 tests");
}
const schemaReport = JSON.parse(await read("evidence/contracts-results.json"));
if (schemaReport.passed !== 19 || schemaReport.failed !== 0) {
  fail(
    "evidence/contracts-results.json does not record 19 passing schema checks",
  );
}

async function markdownFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await markdownFiles(full)));
    else if (entry.name.endsWith(".md")) found.push(full);
  }
  return found;
}

const linkPattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
for (const file of await markdownFiles(root)) {
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(linkPattern)) {
    const target = decodeURI(match[1].split("#")[0]);
    if (!target || /^[a-z]+:/i.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), target);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      fail(
        `${path.relative(root, file)} links outside the repository: ${match[1]}`,
      );
      continue;
    }
    try {
      await stat(resolved);
    } catch {
      fail(`${path.relative(root, file)} has a broken link: ${match[1]}`);
    }
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log("Document checks passed.");
