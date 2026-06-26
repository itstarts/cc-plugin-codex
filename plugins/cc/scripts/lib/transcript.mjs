import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ERROR_CODES, makeError, makeOk } from "./errors.mjs";

// Claude 的写类工具：用于从 transcript 收集改动文件。
// 除 Edit/Write 外，新版还可能用 MultiEdit/NotebookEdit 写文件。
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

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

// 解析结果缓存：键为 filePath，值含文件的 mtimeMs+size 指纹与解析结果。
// status 对每个 job 都解析整个 transcript，job 多时重复成本高；
// 文件未变（指纹一致）时直接复用，变更或不存在则重新解析。
// 加容量上限做 LRU 淘汰，避免长跑进程随不同路径无限增长（companion 多为短命进程，此为防御）。
const parseCache = new Map();
const MAX_PARSE_CACHE_ENTRIES = 256;

function rememberParse(filePath, fingerprint, result) {
  if (parseCache.has(filePath)) parseCache.delete(filePath); // 先删后插，刷新 LRU 顺序
  parseCache.set(filePath, { fingerprint, result });
  while (parseCache.size > MAX_PARSE_CACHE_ENTRIES) {
    parseCache.delete(parseCache.keys().next().value); // 淘汰最旧条目
  }
}

export function parseTranscript(filePath) {
  if (!fs.existsSync(filePath)) {
    parseCache.delete(filePath);
    return makeError(ERROR_CODES.TRANSCRIPT_UNAVAILABLE, "transcript 文件不存在", { filePath });
  }
  let fingerprint = null;
  try {
    const st = fs.statSync(filePath);
    fingerprint = `${st.mtimeMs}:${st.size}`;
    const cached = parseCache.get(filePath);
    if (cached && cached.fingerprint === fingerprint) return cached.result;
  } catch {
    // stat 失败则不走缓存，继续按常规解析
  }
  const result = parseTranscriptUncached(filePath);
  if (fingerprint) rememberParse(filePath, fingerprint, result);
  return result;
}

function parseTranscriptUncached(filePath) {
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
      // is_error:true 表示任务以错误结束，不作为成功结果；直接返回结构化错误
      if (obj.is_error === true) {
        return makeError(ERROR_CODES.NONZERO_EXIT, "claude 任务以错误结束", {
          filePath,
          subtype: obj.subtype ?? null,
        });
      }
      finalText = obj.result;
    } else if (obj.type === "assistant") {
      const content = obj.message?.content;
      if (Array.isArray(content)) {
        const texts = content.filter((c) => c.type === "text").map((c) => c.text);
        if (texts.length) finalText = texts.join("\n");
      } else if (typeof content === "string" && content) {
        // 防御：content 为纯字符串（非数组）的终结消息也作为结果，
        // 覆盖无 result 行的交互式 transcript，避免误判 transcript_unavailable
        finalText = content;
      }
    }
    // 收集文件改动：tool_use 中的写类工具路径
    if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
      for (const c of obj.message.content) {
        if (c.type === "tool_use" && WRITE_TOOLS.has(c.name) && c.input?.file_path) {
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
