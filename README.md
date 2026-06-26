# cc-plugin-codex

一个 Codex 本地 **marketplace 仓库**，提供 `cc` 插件 —— 让 OpenAI Codex 把代码评审（只读）和编码任务（可写）委派给本机的 Claude Code（`claude` CLI）。

它是 [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)（让 Claude Code 调用 Codex）的镜像方向。

## 仓库结构

```
.agents/plugins/marketplace.json   # Codex marketplace 清单（指向 plugins/cc）
plugins/cc/                        # cc 插件本体
  .codex-plugin/plugin.json        #   插件清单
  skills/                          #   cc:review / cc:delegate + 内部 skill
  scripts/                         #   零依赖 Node.js 运行时（companion + lib）
  schemas/ · tests/ · README.md
docs/superpowers/                  # 设计 spec 与实现 plan
```

## 快速开始

需要本机已安装并登录 Codex 与 Claude Code（`claude`）CLI，以及 Node.js v18+。

```bash
codex plugin marketplace add <本仓库根路径>
codex plugin add cc@itstarts-local
codex plugin list | grep cc        # 期望: installed, enabled
```

安装后重启 Codex，在会话里说「让 Claude Code 评审一下当前改动」即可触发。

完整安装、用法、安全边界与数据外发说明见 **[plugins/cc/README.md](plugins/cc/README.md)**。

## 能力

- `cc:review` —— 让 Claude Code 只读评审当前改动 / 分支 / PR。
- `cc:delegate` —— 把编码任务委派给 Claude Code 执行（可写，限定在仓库内），支持前台/后台作业。

## 开发

```bash
cd plugins/cc && node --test       # 单元 / 契约 / fixture 测试
```

设计文档：[docs/superpowers/specs/](docs/superpowers/specs/)　实现计划：[docs/superpowers/plans/](docs/superpowers/plans/)　验证记录：[plugins/cc/tests/SMOKE.md](plugins/cc/tests/SMOKE.md)
