# cc — 在 Codex 中调用 Claude Code

一个 Codex 插件，让 Codex 把代码评审（只读）和编码任务（可写）委派给本机的 Claude Code（`claude` CLI）。它是 `openai/codex-plugin-cc`（让 Claude Code 调用 Codex）的镜像方向。

## 能力

- `cc:review`：让 Claude Code 只读评审当前改动 / 指定分支 / PR，把结构化结果交回 Codex。
- `cc:delegate`：把编码任务（调查、修复、实现）交给 Claude Code 执行，允许在仓库内改文件，支持前台/后台。
- 后台作业：经 companion 的 `status` / `result <jobId>` / `cancel <jobId>` 管理（复用 Claude Code 原生后台机制）。

## 前置条件

- 已安装 Codex（codex-cli 0.142.0+）与 Claude Code CLI（命令名 `claude`），且 `claude` 已本机登录。
- 已安装 Node.js（v18+）。
- 校验：`claude --version` 与 `node --version` 均有输出。

## 安装

本仓库本身就是一个 Codex 本地 marketplace：marketplace 清单在 `.agents/plugins/marketplace.json`，插件在 `plugins/cc/`。Codex 要求 marketplace 清单位于 `<根>/.agents/plugins/marketplace.json`，且插件目录通过 `source.path`（如 `./plugins/cc`，相对 marketplace 根）引用。

把**仓库根**（不是 `plugins/cc`）作为 marketplace 加入并安装插件：

```bash
codex plugin marketplace add <仓库根路径>     # 例如 /path/to/cc-plugin-codex
codex plugin add cc@itstarts-local            # 安装并启用
codex plugin list | grep cc                   # 确认: cc@itstarts-local  installed, enabled  0.1.0
```

或手动在 `~/.codex/config.toml` 配置：

```toml
[marketplaces.itstarts-local]
path = "<仓库根路径>"

[plugins."cc@itstarts-local"]
enabled = true
```

安装后重启 Codex 使插件生效。

> 更新插件：本地 marketplace 不能用 `codex plugin marketplace upgrade`（那只适用于 Git marketplace）。改用 `codex plugin remove cc@itstarts-local && codex plugin add cc@itstarts-local` 刷新已安装的缓存副本。

## 用法

在 Codex 会话里用自然语言触发（skill 按 description 隐式匹配），或用 `/skills` 显式选择：

- 评审当前改动：说「让 Claude Code 评审一下当前改动」即可命中 `cc:review`。可附 `--base main --scope branch` 选择 diff 范围，或后接聚焦点文本。
- 委派任务：说「把这个任务交给 Claude Code：……」命中 `cc:delegate`。可附 `--background` 走后台、`--model <alias>`、`--effort <level>`。

## 典型流程

发版前评审当前改动：

> 让 Claude Code 评审一下当前改动

把一个具体问题交给 Claude Code 修：

> 把这个任务交给 Claude Code：修复 src/foo.js 里空指针导致的崩溃

启动一个耗时任务走后台，随后查看：

> 用后台方式让 Claude Code 实现这个功能：……

然后在会话里说「查一下后台作业状态」「取一下那个作业的结果」，或经 companion：

```bash
node "<plugin>/scripts/claude-companion.mjs" status --json
node "<plugin>/scripts/claude-companion.mjs" result <jobId> --json
node "<plugin>/scripts/claude-companion.mjs" cancel <jobId>
```

## 常见问题

- **需要 Claude 账号吗？** 需要。插件调用本机 `claude` CLI，它必须已安装并完成登录（`claude --version` 能用）。
- **数据会外发吗？** 会。`claude` 在本机运行，但推理在 Anthropic 服务端完成，prompt 与所选上下文会发往该服务（见下方「数据外发说明」）。
- **怎么更新插件？** 本地 marketplace 用 `codex plugin remove cc@itstarts-local && codex plugin add cc@itstarts-local` 刷新缓存副本（不能用 `marketplace upgrade`，那只适用 Git marketplace）。
- **评审会改我的代码吗？** 不会。`cc:review` 走只读权限；只有 `cc:delegate` 才允许 Claude 写文件，且限定在仓库内。
- **skill 没被触发怎么办？** 用 `/skills` 显式选择 `cc:review` / `cc:delegate`，或在请求里明确点名「Claude Code」。

## 数据外发说明

`claude` 虽在本机运行，但推理在 Anthropic 服务端完成：prompt 与所选仓库上下文会发送到外部服务。「本机 CLI」不等于「数据不外发」。请在知情前提下使用，并只发送必要上下文。

## 安全边界

- 评审走只读权限（`--permission-mode plan`）。
- 任务走 `acceptEdits` + `--add-dir <repo>`，请求 Claude 把写操作限制在仓库内（由 Claude Code 自身强制执行，非本插件保证）。

## 实现说明

- 运行时为零依赖 Node.js（ESM `.mjs`），入口 `scripts/claude-companion.mjs` 分发 `setup/review/task/status/result/cancel`，各 `scripts/lib/*.mjs` 模块分担参数解析、claude 调用、状态机、transcript 解析等职责。
- skill 通过相对路径 `../../scripts/claude-companion.mjs` 调用 companion（Codex 不注入插件根环境变量，相对路径在仓库与缓存副本中均有效）。
- 后台作业结果从 Claude transcript JSONL 读取；后台模式下 Claude 自生成真实 sessionId，companion 通过 `claude agents --json` 解析真实 id 定位 transcript。

## 测试

```bash
cd plugins/cc && node --test     # 75 个单元/契约/fixture 测试
```

端到端冒烟与真实 Codex 会话验证记录见 `tests/SMOKE.md`。
