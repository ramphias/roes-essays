# ROES Essays · 思考与文章

Essays on recursive intelligence evolution, intelligence ownership, and the economics of AI.

关于递归智能进化、智能归属与 AI 经济关系的持续思考。

[ROES 官网](https://roes.pro/) · [中文文章目录](https://roes.pro/about/blog) · [English articles](https://roes.pro/about/blog/en)

## 文章 / Essays

### 2026-09-29 · 当智能变得廉价，什么会变得稀缺？

What Becomes Scarce When Intelligence Becomes Cheap?

- [Read on GitHub · 中英原稿](essays/2026-09-29-what-becomes-scarce.md)
- [官网中文](https://roes.pro/about/blog/2026-09-29-what-becomes-scarce)
- [Website English](https://roes.pro/about/blog/en/2026-09-29-what-becomes-scarce)

### 2026-09-27 · 递归智能进化与复利智能资本

Recursive Intelligence Evolution & Compounding Intelligence Capital

- [Read on GitHub · 中文原稿](essays/2026-09-27-recursive-intelligence-evolution.zh.md)
- [Read on GitHub · English manuscript](essays/2026-09-27-recursive-intelligence-evolution.en.md)
- [官网中文](https://roes.pro/about/blog/2026-09-27-recursive-intelligence-evolution)
- [Website English](https://roes.pro/about/blog/en/2026-09-27-recursive-intelligence-evolution)

## 关于这份镜像 / About this mirror

本仓库用于阅读、版本记录与讨论。官网是公开文章的原文入口；这里保存同一份中英原稿。未来更新应同步修改源稿与镜像，保持内容一致。

This repository provides a readable, versioned mirror for discussion. The ROES website remains the original publication location. The Markdown files preserve the bilingual source manuscripts.

文章中的未来方向与开放问题，应按原文语境理解。

Future directions and open questions should be read in the context of the original essays.

---

## 站点与发布 / Site & publishing

- 本仓库包含一个**纯静态阅读站**：`node scripts/build.mjs` 生成 `dist/`——文章索引 + 每篇文章的中文页（`/<日期-slug>/`）与英文页（`/en/<日期-slug>/`）。正文无需 JavaScript；站内链接全部为相对路径，天然适配项目 base path `https://ramphias.github.io/roes-essays/`。
- **canonical**：每个文章页的 canonical 指向对应语言的 roes.pro 原文（日期 URL 形式，如 `https://roes.pro/about/blog/2026-09-27-recursive-intelligence-evolution`；英文页为 `/about/blog/en/…`）。本站是阅读镜像，不是原文的替代发布地。
- **构建完整性门禁**：`scripts/build.mjs` 在生成页面前校验 `essays/*.md` 与 `source-manifest.json` 的 sha256 完全一致，不一致即拒绝构建；`scripts/verify.mjs` 做有限验证（哈希、页面结构、语言纯度、逐字一致、链接解析）。两者均只依赖 Node 标准库，无第三方依赖。
- **发布方式**：GitHub Actions 官方 Pages 流程（`.github/workflows/pages.yml`，最小权限 `contents: read` / `pages: write` / `id-token: write`，无任何硬编码凭据）。首次发布步骤：合并到 `main` → 仓库 Settings → Pages → Source 选 *GitHub Actions* → 触发工作流。站点地址 `https://ramphias.github.io/roes-essays/`（发布前视为未上线）。
- **字体**：站点使用系统字体栈（含 CJK 回退链，见 DESIGN.md 字体角色定义），不随仓库分发任何字体二进制。
- **更新流程**：内容更新以作者批准的稿件为源——将批准的同一份稿件同步到 `essays/` 并相应更新 `source-manifest.json` 中的 sha256，再重新构建。自动同步不在本版范围内。
- **联系**：evolve@roes.pro
