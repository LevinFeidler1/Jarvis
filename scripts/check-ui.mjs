// Static check of the browser modules (public/*.js, public/app/*.js): every name
// is declared or imported, every import exists. Uses the TypeScript compiler on
// plain JS — only "cannot find" errors count, no type checking.
//   npm run check:ui
import { readdirSync } from "node:fs";
import ts from "typescript";

const root = new URL("../public/", import.meta.url).pathname;
const files = [
  ...readdirSync(root).filter((f) => f.endsWith(".js") && f !== "sw.js").map((f) => root + f),
  ...readdirSync(root + "app").filter((f) => f.endsWith(".js")).map((f) => `${root}app/${f}`),
];
const program = ts.createProgram(files, {
  allowJs: true,
  checkJs: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  types: [],
  strict: false,
  noUnusedLocals: true,
});
// 2304/2552 cannot find name · 2305/2614/2724 missing export · 2307 missing module · 6133/6192 unused (imports only)
const CODES = new Set([2304, 2552, 2305, 2614, 2724, 2307]);
const problems = ts.getPreEmitDiagnostics(program).filter((d) => {
  if (!d.file || !files.includes(d.file.fileName)) return false;
  if (CODES.has(d.code)) return true;
  if (d.code === 6133 || d.code === 6192) {
    const line = d.file.text.slice(d.file.getLineStarts()[d.file.getLineAndCharacterOfPosition(d.start).line], d.start);
    return /^\s*import\b/.test(line) || /^import /.test(d.file.text.slice(d.start - 200, d.start).split("\n").pop() ?? "");
  }
  return false;
});
for (const d of problems) {
  const { line } = d.file.getLineAndCharacterOfPosition(d.start);
  console.error(`${d.file.fileName.replace(root, "public/")}:${line + 1}  ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
}
console.log(problems.length ? `✗ ${problems.length} Problem(e) in den Browser-Modulen` : `✓ ${files.length} Browser-Module: alle Namen deklariert oder importiert`);
process.exit(problems.length ? 1 : 0);
