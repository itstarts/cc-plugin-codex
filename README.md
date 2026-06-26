# cc — 在 Codex 中调用 Claude Code

一个 Codex 插件，让 Codex 把代码评审（只读）和编码任务（可写）委派给本机的 Claude Code（`claude` CLI）。

## 能力

- `cc:review`：让 Claude Code 只读评审当前改动 / 指定分支 / PR。
- `cc:delegate`：把编码任务交给 Claude Code 执行，允许在仓库内改文件，支持前台/后台。

## 前置条件

- 已安装 Codex 与 Claude Code CLI（命令名 `claude`），且 `claude` 已本机登录。
- 校验：`claude --version`。

## 安装

把本插件目录加入你的 Codex 本地 marketplace，并在 `~/.codex/config.toml` 启用：

```toml
[plugins."cc@itstarts-local"]
enabled = true
```

（或通过 `codex plugin add` 按你的 Codex 版本安装。）

## 用法

- 评审当前改动：在 Codex 中触发 `cc:review`（可加 `--base main --scope branch`，或后接聚焦点文本）。
- 委派任务：触发 `cc:delegate` 后接任务描述（可加 `--background`）。
- 后台作业：`status` 查看、`result <jobId>` 取结果、`cancel <jobId>` 取消（经 companion）。

## 数据外发说明

`claude` 虽在本机运行，但推理在 Anthropic 服务端完成：prompt 与所选仓库上下文会发送到外部服务。请在知情前提下使用，并只发送必要上下文。

## 安全边界

- 评审走只读权限（`--permission-mode plan`）。
- 任务走 `acceptEdits` + `--add-dir <repo>`，请求 Claude 把写操作限制在仓库内（由 Claude Code 强制，非本插件保证）。

## 测试

```bash
node --test
```
