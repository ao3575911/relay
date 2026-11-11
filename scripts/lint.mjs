import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const skip = new Set(["node_modules", ".git", ".venv"]);

async function collect(dir) {
  const found = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await collect(full)));
    else if (entry.name.endsWith(".mjs")) found.push(full);
  }
  return found;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const javascript = await collect(root);
run(process.execPath, ["--check", ...javascript]);

const prettier = path.join(
  root,
  "node_modules",
  "prettier",
  "bin",
  "prettier.cjs",
);
run(process.execPath, [
  prettier,
  "--check",
  "prototype/**/*.{css,html,mjs}",
  "scripts/**/*.mjs",
  "tests/**/*.mjs",
  "contracts/**/*.json",
  "package.json",
]);

run("python3", ["-m", "ruff", "check", "."]);
