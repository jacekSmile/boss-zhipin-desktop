# BOSS直聘求职助手 (boss-zhipin-desktop)

一款基于 **Tauri v2** 的跨平台桌面求职工具，面向 BOSS直聘 的全流程应聘体验：职位搜索、多维筛选、岗位详情、数据统计与词云分析、批量打招呼投递（随机间隔防风控 + 实时进度条）、HR 在线沟通、简历管理与投递记录。

> 技术参考：[randolph555/boss-zhipin-scraper-tui](https://github.com/randolph555/boss-zhipin-scraper-tui)、[eatmoreduck/boss-zhipin-scraper](https://github.com/eatmoreduck/boss-zhipin-scraper)

## 功能一览

- **便捷登录**：内置独立 BOSS 窗口，扫码登录一次即可，登录态由系统 WebView 持久保存
- **职位搜索**：关键词 + 全国 300+ 城市 + 薪资/经验/学历/公司规模/融资阶段/行业多维筛选，翻页浏览
- **岗位详情**：一键拉取完整 JD、技能标签、公司信息
- **数据统计**：薪资区间分布、经验/学历要求分布、城市分布、公司规模/融资分布、高频技能词 Top 榜、JD 词云图（全局 + 单岗位）
- **批量投递**：勾选岗位加入队列，自定义打招呼话术模板（支持 `{公司}` `{职位}` 变量），随机间隔（可配置）逐个发起沟通，**实时进度条 + 逐项日志**，可随时取消，自动记录投递历史
- **消息沟通**：应用内查看会话列表、未读状态、聊天记录，直接回复 HR
- **简历管理**：上传/预览（PDF/文本）/删除简历，配合自我介绍要点个性化打招呼话术
- **风控友好**：随机化请求间隔、风控码（31/37）与验证页识别、明确的错误提示

## 工作原理

应用通过 Tauri 创建一个指向 zhipin.com 的独立 WebView 窗口供你登录。之后所有数据请求都在**该已登录页面的同源上下文**中执行（浏览器自动携带 Cookie），调用的是 BOSS 网页自身的搜索/详情接口——与参考项目的 Chrome CDP 方案等价，但无需安装 Chrome 或 Python，单个安装包即可运行。

## 下载安装（GitHub Releases）

在 [Releases](https://github.com/jacekSmile/boss-zhipin-desktop/releases) 页面下载对应平台安装包：

| 平台 | 文件 | 说明 |
|---|---|---|
| Windows x64 | `.msi` / `.exe` (NSIS) | 直接安装 |
| Linux x64 | `.AppImage` / `.deb` | AppImage 需 `chmod +x` |
| Linux ARM64 | `.AppImage` / `.deb` | 同上 |
| macOS Intel | `*_x64.dmg` | 见下方「macOS 未签名说明」 |
| macOS Apple Silicon | `*_aarch64.dmg` | 见下方「macOS 未签名说明」 |

### macOS 未签名说明（重要）

Release 中的 macOS 应用**未经过 Apple 开发者签名与公证**（需要付费开发者账号）。首次打开会提示「无法打开，因为无法验证开发者」或「已损坏」，按以下任一方式解决：

**方式一（推荐，命令行）**：

```bash
# 把 app 拖入「应用程序」后执行：
xattr -dr com.apple.quarantine /Applications/BOSS直聘求职助手.app
```

**方式二（图形界面）**：

1. 打开「系统设置 → 隐私与安全性」
2. 先尝试双击打开 app（会被拦截）
3. 回到「隐私与安全性」页面底部，点击「仍要打开」

> 如果你愿意自行签名，可 clone 本仓库后配置 `APPLE_CERTIFICATE` 等 secrets 重新构建。

## 从源码构建

```bash
# 依赖：Node.js 18+，Rust stable，系统 WebView（macOS/Windows 自带；
# Linux 需 libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev）
npm ci
npm run tauri build
```

开发模式：`npm run tauri dev`

## 发布流程（GitHub Actions）

推送 `v*` 标签（或在 Actions 页面手动触发并填写标签名）即可构建全平台安装包并创建 Release：

```bash
git tag v0.1.0 && git push origin v0.1.0
```

构建矩阵：`windows-latest`、`ubuntu-22.04`、`ubuntu-24.04-arm`、`macos-13` (Intel dmg)、`macos-14` (Apple Silicon dmg)。

## 使用建议与免责声明

- 批量投递请保持合理间隔（默认随机 8–20 秒），过短间隔会触发 BOSS 风控（错误码 31/37：环境异常/访问频繁），触发后需在 BOSS 窗口中手动完成验证并暂停一段时间
- 批量模式只负责「发起沟通」（打招呼）；HR 回复后请到「消息沟通」页继续交流
- 本项目仅供学习与技术研究，请遵守 BOSS直聘用户协议与相关法律法规，不得用于恶意爬取或对其服务造成负担的行为。使用本项目产生的一切后果由使用者自行承担

## License

MIT
