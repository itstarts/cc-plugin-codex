# 安全策略

## 报告漏洞

如果你发现安全问题，请**不要**公开提交 issue 或 PR。请通过 GitHub 的私有漏洞报告（仓库 Security 标签页 → Report a vulnerability）私下联系维护者。

报告时请尽量包含：

- 受影响的命令 / skill / 文件
- 复现步骤或最小复现
- 可能的影响范围

我们会尽快确认并跟进修复。

## 安全边界说明

本插件的设计安全边界已在文档中说明，贡献和使用时请注意：

- `cc:review` / `cc:adversarial-review` 为只读，不写文件
- `cc:delegate` 可写，但写操作经 Claude Code 自身权限限定在仓库内（`--add-dir <repo>`），插件不做二次沙箱兜底
- 运行时为零第三方依赖的 Node.js 脚本，不主动联网
- 敏感信息（密钥、令牌）由 companion 做脱敏处理，不写入日志或结果输出
- 委派任务会把代码内容外发给本机 Claude Code 处理，使用前请知情

详见 [plugins/cc/README.md](plugins/cc/README.md) 的安全边界与数据外发章节。

## 支持的版本

仅对最新发布版本提供安全修复。
