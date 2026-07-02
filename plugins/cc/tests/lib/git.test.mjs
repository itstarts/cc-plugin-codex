import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildDiffArgs,
  detectDefaultBranch,
  getWorkingTreeState,
  resolveReviewTarget,
  collectReviewInput,
  collectDiff,
} from "../../scripts/lib/git.mjs";

const tempDirs = [];

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function makeRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-plugin-git-"));
  tempDirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test User"]);
  writeFileSync(path.join(dir, "tracked.txt"), "base\n");
  git(dir, ["add", "tracked.txt"]);
  git(dir, ["commit", "-m", "initial"]);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("working-tree 默认 diff HEAD", () => {
  assert.deepEqual(buildDiffArgs({ scope: "working-tree" }), ["diff", "HEAD"]);
});

test("branch scope 用三点 diff", () => {
  assert.deepEqual(buildDiffArgs({ scope: "branch", base: "main" }), ["diff", "main...HEAD"]);
});

test("branch scope 缺 base 回退 HEAD", () => {
  assert.deepEqual(buildDiffArgs({ scope: "branch" }), ["diff", "HEAD...HEAD"]);
});

test("getWorkingTreeState reports staged, unstaged, and untracked files", () => {
  const dir = makeRepo();
  writeFileSync(path.join(dir, "staged.txt"), "staged\n");
  git(dir, ["add", "staged.txt"]);
  writeFileSync(path.join(dir, "tracked.txt"), "base\nchanged\n");
  writeFileSync(path.join(dir, "new.txt"), "new file\n");

  const state = getWorkingTreeState(dir);

  assert.equal(state.isDirty, true);
  assert.deepEqual(state.staged, ["staged.txt"]);
  assert.deepEqual(state.unstaged, ["tracked.txt"]);
  assert.deepEqual(state.untracked, ["new.txt"]);
});

test("auto uses working-tree when repo is dirty and includes untracked text", () => {
  const dir = makeRepo();
  writeFileSync(path.join(dir, "tracked.txt"), "base\nchanged\n");
  writeFileSync(path.join(dir, "new.txt"), "new file\n");

  const target = resolveReviewTarget(dir, { scope: "auto" });
  const input = collectReviewInput(dir, { scope: "auto" });

  assert.equal(target.mode, "working-tree");
  assert.equal(input.ok, true, input.stderr);
  assert.match(input.text, /Git Status/);
  assert.match(input.text, /Untracked Files/);
  assert.match(input.text, /new file/);
});

test("collectReviewInput keeps working-tree review when one untracked file cannot be read", () => {
  const dir = makeRepo();
  writeFileSync(path.join(dir, "unreadable.txt"), "secret\n");
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function patchedReadFileSync(file, ...args) {
    if (String(file).endsWith(`${path.sep}unreadable.txt`)) throw new Error("forced read failure");
    return originalReadFileSync.call(this, file, ...args);
  };
  try {
    const input = collectReviewInput(dir, { scope: "working-tree" });
    assert.equal(input.ok, true, input.stderr);
    assert.match(input.text, /unreadable\.txt/);
    assert.match(input.text, /skipped: unreadable file/);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});

test("collectReviewInput working-tree args describe collected context commands", () => {
  const dir = makeRepo();
  writeFileSync(path.join(dir, "new.txt"), "new file\n");

  const input = collectReviewInput(dir, { scope: "working-tree" });

  assert.equal(input.ok, true, input.stderr);
  assert.deepEqual(input.args, [
    "git status --short --untracked-files=all",
    "git diff --cached --no-ext-diff --submodule=diff",
    "git diff --no-ext-diff --submodule=diff",
    "git ls-files --others --exclude-standard",
  ]);
});

test("auto uses detected branch target when working tree is clean", () => {
  const dir = makeRepo();
  git(dir, ["checkout", "-b", "feature"]);
  writeFileSync(path.join(dir, "tracked.txt"), "base\nfeature\n");
  git(dir, ["add", "tracked.txt"]);
  git(dir, ["commit", "-m", "feature"]);

  const target = resolveReviewTarget(dir, { scope: "auto" });

  assert.equal(target.mode, "branch");
  assert.equal(target.baseRef, "main");
});

test("explicit base takes precedence over auto target detection", () => {
  const dir = makeRepo();
  git(dir, ["checkout", "-b", "feature"]);
  writeFileSync(path.join(dir, "tracked.txt"), "base\nfeature\n");
  git(dir, ["add", "tracked.txt"]);
  git(dir, ["commit", "-m", "feature"]);

  const target = resolveReviewTarget(dir, { scope: "auto", base: "HEAD~1" });

  assert.equal(target.mode, "branch");
  assert.equal(target.baseRef, "HEAD~1");
  assert.equal(target.explicit, true);
});

test("branch scope without base detects default branch", () => {
  const dir = makeRepo();

  assert.equal(detectDefaultBranch(dir), "main");
  const target = resolveReviewTarget(dir, { scope: "branch" });
  assert.equal(target.mode, "branch");
  assert.equal(target.baseRef, "main");
});

test("detectDefaultBranch throws when no default branch candidate exists", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-plugin-git-"));
  tempDirs.push(dir);
  git(dir, ["init", "-b", "feature"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test User"]);
  writeFileSync(path.join(dir, "tracked.txt"), "base\n");
  git(dir, ["add", "tracked.txt"]);
  git(dir, ["commit", "-m", "initial"]);

  assert.throws(() => detectDefaultBranch(dir), /Unable to detect default branch/);
});

test("detectDefaultBranch prefers origin branch over local branch when both exist", () => {
  const dir = makeRepo();
  git(dir, ["checkout", "-b", "origin-main"]);
  writeFileSync(path.join(dir, "tracked.txt"), "base\nremote\n");
  git(dir, ["add", "tracked.txt"]);
  git(dir, ["commit", "-m", "remote main"]);
  const remoteCommit = git(dir, ["rev-parse", "HEAD"]);
  git(dir, ["update-ref", "refs/remotes/origin/main", remoteCommit]);
  git(dir, ["checkout", "main"]);

  assert.equal(detectDefaultBranch(dir), "origin/main");
});

test("detectDefaultBranch returns remote HEAD when configured", () => {
  const dir = makeRepo();
  git(dir, ["update-ref", "refs/remotes/origin/trunk", "HEAD"]);
  git(dir, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk"]);

  assert.equal(detectDefaultBranch(dir), "origin/trunk");
});

test("collectReviewInput omits binary patch payloads from branch diffs", () => {
  const dir = makeRepo();
  git(dir, ["checkout", "-b", "feature"]);
  writeFileSync(path.join(dir, "asset.bin"), Buffer.from([0, 1, 2, 3, 4, 5]));
  git(dir, ["add", "asset.bin"]);
  git(dir, ["commit", "-m", "add binary"]);

  const input = collectReviewInput(dir, { scope: "branch", base: "main" });

  assert.equal(input.ok, true, input.stderr);
  assert.doesNotMatch(input.text, /GIT binary patch/);
  assert.match(input.text, /asset\.bin/);
});

test("collectReviewInput branch args describe collected context commands", () => {
  const dir = makeRepo();
  git(dir, ["checkout", "-b", "feature"]);
  writeFileSync(path.join(dir, "tracked.txt"), "base\nfeature\n");
  git(dir, ["add", "tracked.txt"]);
  git(dir, ["commit", "-m", "feature"]);

  const input = collectReviewInput(dir, { scope: "branch", base: "main" });

  assert.equal(input.ok, true, input.stderr);
  assert.deepEqual(input.args, [
    "git log --oneline --decorate main...HEAD",
    "git diff --stat main...HEAD",
    "git diff --no-ext-diff --submodule=diff main...HEAD",
  ]);
});

test("collectDiff preserves legacy diff args while using review context text", () => {
  const dir = makeRepo();
  writeFileSync(path.join(dir, "tracked.txt"), "base\nchanged\n");

  const input = collectDiff(dir, { scope: "working-tree" });

  assert.equal(input.ok, true, input.stderr);
  assert.deepEqual(input.args, ["diff", "HEAD"]);
  assert.match(input.text, /Git Status/);
});
