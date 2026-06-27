# 贡献指南

欢迎为 cc-plugin-codex 贡献。本仓库是一个 Codex marketplace 仓库，提供 `cc` 插件，让 Codex 把代码评审和编码任务委派给本机 Claude Code。

## 前置条件

- Node.js >=18.18.0（运行时与测试零第三方依赖）
- 已安装并登录 Codex 与 Claude Code（`claude`）CLI
- 校验：`node --version`、`claude --version` 均有输出

## 本地开发与验证

```bash
cd plugins/cc && node --test       # 单元 / 契约 / fixture 测试（e2e 默认跳过）
```

写边界等 env-gated 集成测试默认跳过，需真实已登录的 `claude` 才运行：

```bash
cd plugins/cc && CC_PLUGIN_E2E=1 node --test tests/e2e/write-boundary.e2e.test.mjs
```

本地安装插件做端到端验证（用 clone 后的仓库根目录绝对路径）：

```bash
codex plugin marketplace add /path/to/cc-plugin-codex
codex plugin add cc@itstarts
codex plugin list | grep cc        # 期望: installed, enabled
```

## 代码约定

- 运行时保持零第三方依赖；如需引入依赖，先在 issue/PR 中说明理由
- 沿用现有 skill / companion / lib 的结构和命名，不做无关重构
- 改动行为时同步更新对应测试，并保证 `node --test` 全绿
- 文档（README、CHANGELOG、SMOKE.md）与代码保持一致；测试数量等易过时信息不写死

## 提交 PR

- 从 `main` 切分支开发，不直接推 `main`
- commit message 用 `<type>: 中文描述`，type 取 `feat`/`fix`/`docs`/`refactor`/`test`/`chore`/`build`
- PR 描述写清：改了什么、为什么、如何验证（附 `node --test` 结果）
- 涉及对外契约、安全边界或数据外发行为的改动，在 PR 中显著说明

## 安全

发现安全问题请勿公开提交，参见 [SECURITY.md](SECURITY.md)。
