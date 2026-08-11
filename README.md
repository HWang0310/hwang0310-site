# 王昊个人网站

这是王昊的个人作品集网站，面向公开访问，用于介绍个人经历、专业能力、作品、论文与联系方式。

- 网站：<https://hwang0310.dpdns.org/>
- GitHub：<https://github.com/HWang0310/hwang0310-site>
- 当前正式版本：**个人网站 1.0**（标签：`site-v1.0.0`）

## 网站内容

- 个人简介、教育经历、专业能力和作品集；
- AI 卡通肖像与真实照片切换；
- 卡通小狗网站向导、滚动章节和轻量交互动效；
- 座右铭、硕士论文介绍及数值实验展示；
- 联系方式与项目入口；
- 面向手机、平板和桌面端的响应式布局。

## 项目展示入口

网站中包含“湖北电信收入预估”的展示入口：

- 在线入口：<https://hwang0310.dpdns.org/projects/income-forecast/>
- 收入预估核心仓库：<https://github.com/HWang0310/hwang_sryg>

这里的职责是提供网站入口和在线展示承载；收入预估的数据清洗、预测、低代码 SQL/PySpark、登录权限、Supabase 架构和发布策略，请以 `hwang_sryg` 仓库的中文 README 为准。

## 网站技术

- Vite + TypeScript 构建；
- 原生 HTML、CSS 和 JavaScript 实现页面与交互；
- Cloudflare Pages 托管；
- Playwright、Vitest 和 TypeScript 用于页面、无障碍和构建回归检查。

## 本地运行

```bash
npm install
npm run build
npm test
npm run typecheck
```

## 安全说明

本仓库不保存密码、访问令牌、SMTP 授权码、恢复链接、Cookie 或其他密钥。网站发布与收入预估发布均遵循各自的项目边界，收入预估日常发布不会覆盖个人主页。
