import { test } from "node:test";
import assert from "node:assert/strict";
import { isProbablyText } from "../../scripts/lib/fs.mjs";

test("isProbablyText rejects buffers containing null bytes", () => {
  assert.equal(isProbablyText(Buffer.from([65, 0, 66])), false);
});

test("isProbablyText accepts UTF-8 text buffers", () => {
  assert.equal(isProbablyText(Buffer.from("hello\nworld", "utf8")), true);
});

test("isProbablyText rejects buffers with many control bytes", () => {
  assert.equal(isProbablyText(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 65, 66])), false);
});

test("isProbablyText treats DEL as a control byte", () => {
  assert.equal(isProbablyText(Buffer.from([127])), false);
});
