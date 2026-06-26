import { test } from "node:test";
import assert from "node:assert/strict";
import { ERROR_CODES, makeError, makeOk } from "../../scripts/lib/errors.mjs";

test("错误码集合完整", () => {
  assert.deepEqual(Object.values(ERROR_CODES).sort(), [
    "auth_required", "invalid_args", "invalid_json", "job_not_found",
    "missing_cli", "nonzero_exit", "timeout", "transcript_unavailable"
  ]);
});

test("makeError 结构", () => {
  const e = makeError(ERROR_CODES.MISSING_CLI, "no claude", { hint: "install" });
  assert.equal(e.ok, false);
  assert.equal(e.error.code, "missing_cli");
  assert.equal(e.error.message, "no claude");
  assert.equal(e.error.hint, "install");
});

test("makeOk 结构", () => {
  const r = makeOk({ result: "hi" });
  assert.equal(r.ok, true);
  assert.equal(r.result, "hi");
});
