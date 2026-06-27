# cc-plugin-codex

一个 Codex **marketplace 仓库**（支持远程 GitHub 安装或本地路径安装），提供 `cc` 插件 —— 让 OpenAI Codex 把代码评审（只读）和编码任务（可写）委派给本机的 Claude Code（`claude` CLI）。

它是 [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)（让 Claude Code 调用 Codex）的镜像方向。

## 仓库结构

```
.agents/plugins/marketplace.json   # Codex marketplace 清单（指向 plugins/cc）
plugins/cc/                        # cc 插件本体
  .codex-plugin/plugin.json        #   插件清单
  skills/                          #   cc:review / cc:adversarial-review / cc:delegate + 内部 skill
  scripts/                         #   零依赖 Node.js 运行时（companion + lib）
  schemas/ · tests/ · README.md
docs/superpowers/                  # 设计 spec 与实现 plan
```

## 快速开始

需要本机已安装并登录 Codex 与 Claude Code（`claude`）CLI，以及 Node.js >=18.18.0。

直接从 GitHub 安装（无需 clone）：

```bash
codex plugin marketplace add itstarts/cc-plugin-codex   # 远程拉取本仓库作为 marketplace
codex plugin add cc@itstarts                              # 安装并启用 cc 插件
codex plugin list | grep cc                              # 期望: installed, enabled
```

安装后重启 Codex，在会话里说「让 Claude Code 评审一下当前改动」即可触发。

> marketplace 的名字是 `itstarts`（来自仓库内 `marketplace.json`），所以插件 id 是 `cc@itstarts`，远程或本地安装都一样。
> 想从本地副本安装（开发/离线场景），把 `itstarts/cc-plugin-codex` 换成 clone 后的仓库根目录绝对路径即可，例如 `codex plugin marketplace add /path/to/cc-plugin-codex`。

完整安装、用法、安全边界与数据外发说明见 **[plugins/cc/README.md](plugins/cc/README.md)**。

版本变更记录见 **[CHANGELOG.md](CHANGELOG.md)**。

## 能力

- `cc:review` —— 让 Claude Code 只读评审当前改动 / 分支 / PR。
- `cc:adversarial-review` —— 让 Claude Code 做只读的「挑战式」评审：质疑实现方向、设计取舍与隐藏假设，重点打高代价失败面（auth / 数据丢失 / 回滚 / 竞态）。
- `cc:delegate` —— 把编码任务委派给 Claude Code 执行（可写，限定在仓库内），支持前台/后台作业，可续接上一次委派线程。

> 与参考项 [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) 的差异：参考项的 `transfer`（把会话导成对方可 resume 的线程）依赖对方运行时的「外部 agent 会话导入」能力。镜像方向需要 Claude Code 能导入外部会话，而 Claude Code 当前无此能力（`--resume` 只认自身 session），故本插件未镜像该命令。

## 开发

```bash
cd plugins/cc && node --test       # 单元 / 契约 / fixture 测试
```

设计文档：[docs/superpowers/specs/](docs/superpowers/specs/)　实现计划：[docs/superpowers/plans/](docs/superpowers/plans/)　验证记录：[plugins/cc/tests/SMOKE.md](plugins/cc/tests/SMOKE.md)

贡献流程见 **[CONTRIBUTING.md](CONTRIBUTING.md)**。

> `docs/superpowers/` 下是开发期的历史设计 spec 与实现 plan，记录设计思路，**不是安装/使用文档**。安装与用法以本文件和 [plugins/cc/README.md](plugins/cc/README.md) 为准。
