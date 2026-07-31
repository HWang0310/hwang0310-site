# 王昊个人网站内容升级与收入报告安全发布实现计划

日期：2026-07-31

## 1. 固化内容契约

- 在 `tests/content-contract.test.ts` 先加入章节顺序、编号、座右铭原文、配图、论文五层叙事与实验图契约。
- 在 `tests/portrait-flip.test.ts` 先加入多切换器、多 AI 图层和桌面真实照片覆盖测试。
- 运行定向测试并确认失败。

## 2. 生成编辑图片资源

- 为座右铭图和论文页面新增资产管线测试，约束三格式输出、合理尺寸和裁切范围。
- 扩展 `scripts/prepare-assets.mjs` 或增加聚焦的编辑资产函数。
- 从 `IMG_0675.jpg` 生成座右铭图。
- 从论文 PDF 第 47–52 页渲染结果中生成三组实验图。
- 逐张检查最终图片的内容、裁切和清晰度。

## 3. 重构首页内容与交互

- 调整 `index.html` 导航、章节 DOM 顺序与 01–05 编号。
- 在 About 后加入座右铭编辑卡片。
- 扩展论文为摘要、研究路径、关键结论和三图实验画廊。
- 将肖像切换标记扩展到移动端 Hero、桌面粘性肖像和 About。
- 泛化 `src/portrait-flip.ts`；更新小狗向导的下一节行为和文字。
- 增加响应式样式与减少动态规则。
- 运行单元与内容契约测试。

## 4. 锁定收入预估 Skill 发布边界

- 在主 Skill 的部署测试中先加入失败用例：
  - 完整站点基底外文件哈希必须保持不变。
  - 缺少完整网站基底时构建失败。
  - 报告专用目录不能交给 `publish_pages`。
  - 发布快照只能替换 `/projects/income-forecast/`。
- 重写部署快照组装逻辑，移除占位首页生成。
- 为 `run_pipeline` 增加完整站点基底参数，并让 `--publish` 缺失基底时安全失败。
- 更新 `SKILL.md` 与 `references/cloudflare-publishing.md` 的强制边界。
- 运行主 Skill 全量测试和 `quick_validate.py`。

## 5. 同步 Skill 三份交付

- 从主库同步到 `/Users/hwang/Movies/SKILLS/income-forecast-2-0`。
- 重新生成 `/Users/hwang/Movies/SKILLS/income-forecast-2-0.zip`。
- 排除 `.git`、`.wrangler`、缓存、凭据、用户源数据和测试产物。
- 比较主库、移植副本和 ZIP 的文件清单与 SHA-256。

## 6. 浏览器与构建验证

- 运行 `npm test`、`npm run build`、`npm run test:e2e`。
- 在真实浏览器检查桌面、平板、360px 移动端、键盘、无 JS 和减少动态。
- 检查所有新图片、论文 PDF 和内部链接。
- 修复发现的问题后重跑完整验证。

## 7. Cloudflare 发布

- 查询当前 Cloudflare Pages 项目和官方 Direct Upload 约束。
- 用本地完整构建目录部署预览分支。
- 验证预览首页、论文资源、收入项目入口和报告页。
- 部署生产分支并重新验证自定义域名关键路由。

## 8. 创建安全的公开 GitHub 仓库

- 从稳定基线和最终版本分别生成脱敏快照，不复用包含隐私的旧 git 历史。
- 扫描私人手机号、用户绝对路径、令牌、密钥和不应公开的源文件。
- 创建公开仓库 `HWang0310/hwang0310-site`。
- 推送清理后的 `main` 和功能分支。
- 创建 Draft PR，写明页面升级、测试和收入发布隔离。

## 9. 最终验收

- 复查线上首页和 GitHub 仓库。
- 记录部署 URL、提交、PR、Skill 验证结果和关键路由。
- 只在全部要求完成后报告完成。
