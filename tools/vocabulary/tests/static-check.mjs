import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
let checked = 0;
for (const dir of ["", "modules", "tests"])
  for (const name of fs.readdirSync(path.join(root, dir))) {
    if (!name.endsWith(".mjs") && !name.endsWith(".cjs")) continue;
    const file = path.join(root, dir, name);
    const syntax = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
    });
    if (syntax.status !== 0) throw Error(syntax.stderr);
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(
      /(?:from\s*|import\s*\()(['"])(\.\.?\/[^'"]+)\1/g,
    )) {
      if (
        !fs.existsSync(path.resolve(path.dirname(file), match[2])) &&
        !(name === "browser.cjs" && fs.existsSync(path.resolve(root, match[2])))
      )
        throw Error("Missing module: " + match[2]);
    }
    checked++;
  }
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (!fs.existsSync(path.resolve(root, match[1].split("?")[0])))
    throw Error("Missing static asset: " + match[1]);
}
for (const view of [
  "home",
  "learn",
  "assessment",
  "library",
  "import",
  "analytics",
  "settings",
])
  if (!fs.existsSync(path.join(root, `modules/${view}-view.mjs`)))
    throw Error("Missing view " + view);
console.log(
  `Static production validation passed: ${checked} JS files; relative assets and lazy routes exist. No bundling required.`,
);
