import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ERROR_CODES, makeError, makeOk } from "./errors.mjs";

export function transcriptPathFor(cwd, sessionId) {
  let root = cwd;
  try {
    root = fs.realpathSync.native(cwd);
  } catch {
    root = path.resolve(cwd);
  }
  const slug = root.replace(/[/.]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", slug, `${sessionId}.jsonl`);
}

export function parseTranscript(filePath) {
  if (!fs.existsSync(filePath)) {
    return makeError(ERROR_CODES.TRANSCRIPT_UNAVAILABLE, "transcript 文件不存在", { filePath });
  }
  let lines;
  try {
    lines = fs.readFileSync(filePath, "utf8").split("\n");
  } catch (e) {
    return makeError(ERROR_CODES.TRANSCRIPT_UNAVAILABLE, "transcript 读取失败", { filePath });
  }
  let finalText = null;
  const touchedFiles = new Set();
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try {
      obj = JSON.parse(t);
    } catch {
      continue; // 跳过损坏行
    }
    if (obj.type === "result" && typeof obj.result === "string") {
      finalText = obj.result;
    } else if (obj.type === "assistant" && obj.message?.content) {
      const texts = obj.message.content.filter((c) => c.type === "text").map((c) => c.text);
      if (texts.length) finalText = texts.join("\n");
    }
    // 收集文件改动：tool_use 中的 Edit/Write 路径
    if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
      for (const c of obj.message.content) {
        if (c.type === "tool_use" && (c.name === "Edit" || c.name === "Write") && c.input?.file_path) {
          touchedFiles.add(c.input.file_path);
        }
      }
    }
  }
  if (finalText === null) {
    return makeError(ERROR_CODES.TRANSCRIPT_UNAVAILABLE, "transcript 无终结消息", { filePath });
  }
  return makeOk({ result: finalText, touchedFiles: [...touchedFiles] });
}
