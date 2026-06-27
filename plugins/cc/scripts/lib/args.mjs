// review --scope 的合法取值，与 buildDiffArgs 的分支一致（branch 走三点 diff，其余按工作区）
export const SCOPE_VALUES = Object.freeze(["working-tree", "branch"]);

export function parseArgs(argv, spec = {}) {
  const boolSet = new Set(spec.boolean ?? []);
  const strSet = new Set(spec.string ?? []);
  const flags = {};
  const values = {};
  const positional = [];
  const unknown = []; // 未声明的 --flag，交由命令层判定为参数错误
  const missing = []; // 声明为 string 但缺少取值的 --flag
  const boolWithValue = []; // 布尔 flag 误带取值（如 --json=false），避免被静默当真

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      const name = eq === -1 ? tok.slice(2) : tok.slice(2, eq);
      if (boolSet.has(name)) {
        // 布尔 flag 不接受取值；`--fresh=false` 这类写法用户以为是关闭，实际会被当真，必须报错
        if (eq !== -1) boolWithValue.push(name);
        else flags[name] = true;
        continue;
      }
      if (strSet.has(name)) {
        let val;
        if (eq !== -1) {
          val = tok.slice(eq + 1);
        } else {
          const next = argv[i + 1];
          // 下一个 token 是另一个 --flag 时不当作取值，避免 `--base --scope` 把 base 误吞为 "--scope"
          if (next !== undefined && !next.startsWith("--")) val = argv[++i];
        }
        if (val === undefined || val === "") missing.push(name);
        else values[name] = val;
        continue;
      }
      unknown.push(name);
      continue;
    }
    positional.push(tok);
  }
  return { flags, values, positional, unknown, missing, boolWithValue };
}

/**
 * 校验已解析参数：未知 flag、string flag 缺值、枚举取值非法。
 * 命中时返回中文错误说明（含可选值提示），无误返回 null。
 * 与 errors.mjs 解耦：只产出消息文本，错误码由命令层映射为 invalid_args。
 */
export function validateArgs(parsed, { enums = {} } = {}) {
  if (parsed.unknown.length) {
    return `未知参数: ${parsed.unknown.map((n) => `--${n}`).join(", ")}`;
  }
  if (parsed.boolWithValue.length) {
    return `开关参数不接受取值: ${parsed.boolWithValue.map((n) => `--${n}`).join(", ")}`;
  }
  if (parsed.missing.length) {
    return `参数缺少取值: ${parsed.missing.map((n) => `--${n}`).join(", ")}`;
  }
  for (const [name, allowed] of Object.entries(enums)) {
    const v = parsed.values[name];
    if (v !== undefined && !allowed.includes(v)) {
      return `--${name} 取值非法: ${v}（可选: ${allowed.join("|")}）`;
    }
  }
  return null;
}
