// A conditional written as a direct JSX child without braces is text, not
// code: the page shows "(loadError ?" and renders both branches (PR #258
// found two: the Story panel's empty state and the workshop list's). This
// walks every component's JSX text nodes and fails on anything shaped like
// a ternary fragment, so the next one never ships.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.join(import.meta.dirname, "..", "src");

function* componentFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* componentFiles(full);
    } else if (entry.name.endsWith(".tsx")) {
      yield full;
    }
  }
}

// What leaked code looks like once JSX reads it as prose: an identifier
// followed by a spaced "?" (prose questions have no space before theirs),
// a ":" leading into another condition, or the closing ": null)".
const FRAGMENTS = [
  /^\(?\s*!?[A-Za-z_$][\w.$]*\s+\?$/,
  /^\)?\s*:\s*!?[A-Za-z_$][\w.$]*\s+\?$/,
  /^\)?\s*:\s*(null|undefined|""|'')\s*\)*$/,
  /^\)\s*:\s*\($/,
];

export function leakedTextNodes(source, fileName = "component.tsx") {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const leaks = [];
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      const text = node.getText().trim();
      if (text && FRAGMENTS.some((pattern) => pattern.test(text))) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart());
        leaks.push({ line: line + 1, text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return leaks;
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("a ternary written as a JSX child is caught", () => {
  const leaks = leakedTextNodes(`
    export function Panel({ loadError, loaded }) {
      return (
        <div>
          (loadError ? <LoadFailed error={loadError} /> : loaded ? <EmptyState title="Nothing" /> : null)
        </div>
      );
    }
  `);
  assert.deepEqual(leaks.map((leak) => leak.text), ["(loadError ?", ": loaded ?", ": null)"]);
});

test("the same conditional inside braces, and prose with a question mark, pass", () => {
  const leaks = leakedTextNodes(`
    export function Panel({ loadError, loaded, count }) {
      return (
        <div>
          {loadError ? <LoadFailed error={loadError} /> : loaded ? <EmptyState title="Nothing" /> : null}
          <p>Undo anyway?</p>
          <p>{count}:</p>
          <span>?</span>
          <p>what is this?</p>
        </div>
      );
    }
  `);
  assert.deepEqual(leaks, []);
});

const leaks = [];
for (const file of componentFiles(root)) {
  for (const leak of leakedTextNodes(fs.readFileSync(file, "utf8"), file)) {
    leaks.push(`${path.relative(root, file)}:${leak.line}: ${JSON.stringify(leak.text)}`);
  }
}
test("no component leaks a conditional as text", () => {
  assert.deepEqual(leaks, [], `conditionals rendered as text:\n${leaks.join("\n")}`);
});

console.log(`test-jsx-text-leaks: ${passed} passed`);
