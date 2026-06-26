import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("schema 是合法 JSON 且声明 findings", () => {
  const p = path.join(root, "schemas", "review-output.schema.json");
  assert.ok(existsSync(p));
  const s = JSON.parse(readFileSync(p, "utf8"));
  assert.equal(s.type, "object");
  assert.ok(s.properties?.findings);
});

test("README 存在且含安装与用法", () => {
  const txt = readFileSync(path.join(root, "README.md"), "utf8");
  assert.ok(txt.includes("cc:review") && txt.includes("cc:delegate"));
});
