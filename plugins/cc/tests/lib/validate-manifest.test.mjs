import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf8"));

test("manifest 顶层必填字段", () => {
  assert.equal(manifest.name, "cc");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.description?.length > 0);
  assert.ok(manifest.author?.name?.length > 0);
});

test("interface 必填字段齐全", () => {
  const i = manifest.interface;
  for (const f of ["displayName", "shortDescription", "longDescription", "developerName", "category"]) {
    assert.equal(typeof i[f], "string");
    assert.ok(i[f].trim().length > 0, `${f} 非空`);
  }
  assert.ok(Array.isArray(i.capabilities) && i.capabilities.every(c => typeof c === "string" && c.trim()));
  const prompts = i.defaultPrompt ?? i.default_prompt;
  assert.ok(Array.isArray(prompts) && prompts.length >= 1 && prompts.length <= 3);
  assert.ok(prompts.every(p => p.length <= 128));
});

test("声明 hooks 字段指向 codex hook 清单", () => {
  // Codex 0.142 的 PluginManifest 接受 hooks 字段（参考插件 superpowers 亦如此）。
  // hooks 路径必须以 ./ 开头、相对插件根，且文件存在。
  assert.equal(typeof manifest.hooks, "string");
  assert.ok(manifest.hooks.startsWith("./"), "hooks 路径需以 ./ 开头");
  const hookManifest = path.join(root, manifest.hooks);
  assert.ok(existsSync(hookManifest), "hooks 清单文件需存在");
  const parsed = JSON.parse(readFileSync(hookManifest, "utf8"));
  const stop = parsed.hooks?.Stop;
  assert.ok(Array.isArray(stop) && stop.length >= 1, "需声明 Stop 事件 hook");
  const entry = stop[0].hooks?.[0];
  assert.equal(entry.type, "command");
  assert.equal(entry.async, false);
  assert.ok(entry.command.includes("stop-review-gate"), "command 需指向 wrapper");
});

test("Stop hook wrapper 存在且可执行", () => {
  const wrapper = path.join(root, "hooks", "stop-review-gate");
  assert.ok(existsSync(wrapper), "wrapper 文件需存在");
  const mode = statSync(wrapper).mode;
  assert.ok(mode & 0o111, "wrapper 需有执行权限");
});
