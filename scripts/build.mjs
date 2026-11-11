import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFile(path.join(root, file), "utf8");
const [html, css, core, app] = await Promise.all(
  [
    "prototype/index.html",
    "prototype/styles.css",
    "prototype/core.mjs",
    "prototype/app.mjs",
  ].map(read),
);
const js = `${core.replace(/^export /gm, "")}\n${app.replace(/^import[\s\S]*?from\s+["']\.\/core\.mjs["'];\r?\n/u, "")}`;
if (/<\/script/iu.test(js) || /<\/style/iu.test(css))
  throw new Error("Unsafe closing tag in inline bundle.");
const bundled = html
  .replace(
    /<link\s+rel="stylesheet"\s+href="styles\.css"\s*\/?>/u,
    `<style>\n${css}\n</style>`,
  )
  .replace(
    '<script type="module" src="app.mjs"></script>',
    `<script type="module">\n${js}\n</script>`,
  );
if (/src="app.mjs"|href="styles.css"/u.test(bundled))
  throw new Error("Bundle substitution failed.");
await writeFile(path.join(root, "Relay-Prototype.html"), bundled);
process.stdout.write(
  "Built Relay-Prototype.html — standalone, offline, no dependencies.\n",
);
