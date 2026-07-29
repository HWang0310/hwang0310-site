# 2026-07-29 首页重设计发布记录

## 发布结果

- 发布日期：2026-07-29
- Cloudflare 账户：`bd8ad6d1ec4ff38ac655e8f60a336b53`
- Pages 项目：`hwang0310-site`
- 生产分支：`main`
- 生产地址：<https://hwang0310.dpdns.org/>
- Wrangler：`4.86.0`

预览与生产部署均成功：

- 预览分支：`homepage-redesign-preview`
- 预览部署 ID：`13fecf60-4164-4b70-9744-54272ee9ac7f`
- 预览部署地址：<https://13fecf60.hwang0310-site.pages.dev>
- 预览分支别名：<https://homepage-redesign-preview.hwang0310-site.pages.dev>
- 生产部署 ID：`4a447888-3118-47a9-90f8-12a0bd1e0480`
- 生产部署地址：<https://4a447888.hwang0310-site.pages.dev>

## 发布前验证

- `npm test`：通过，8 个测试文件、53 个测试全部通过。
- `npm run build`：通过，生成并暂存 102 个文件，包含
  `20260720`、`20260724`、`20260725`、`20260726` 四个报告日期。
- `npm run test:e2e`：通过，22 个测试通过、5 个按配置跳过。

## 线上回归

预览部署和生产自定义域名均已验证首页标题。以下生产路径返回 HTTP 200：

- 论文 PDF：
  <https://hwang0310.dpdns.org/assets/papers/wang-hao-rkdg-thesis.pdf>
- 收入预估入口：
  <https://hwang0310.dpdns.org/projects/income-forecast/>
- 2026-07-20 报告：
  <https://hwang0310.dpdns.org/projects/income-forecast/reports/2026/07/20/>
- 2026-07-24 报告：
  <https://hwang0310.dpdns.org/projects/income-forecast/reports/2026/07/24/>
- 2026-07-25 报告：
  <https://hwang0310.dpdns.org/projects/income-forecast/reports/2026/07/25/>
- 2026-07-26 报告：
  <https://hwang0310.dpdns.org/projects/income-forecast/reports/2026/07/26/>

武汉历史 `.html` 地址返回 HTTP 308，并正确跳转到返回 HTTP 200 的无扩展名页面：

- <https://hwang0310.dpdns.org/projects/income-forecast/reports/2026/07/26/cities/wuhan.html>
- <https://hwang0310.dpdns.org/projects/income-forecast/reports/2026/07/26/cities/wuhan>

生产首页已确认包含：

- GitHub：<https://github.com/HWang0310>
- 邮箱：<mailto:hwang0310@163.com>

生产首页不包含私人手机号或本地 `file:///Users/` 路径，完整构建目录也未检出这两类隐私标记。

## 回滚信息

本次发布前的上一生产部署为：

- 部署 ID：`6d1d4bab-ac5e-4859-8ca0-adf031dfe9eb`
- 部署地址：<https://6d1d4bab.hwang0310-site.pages.dev>
- 分支：`main`
- 源版本：`30f44c4`
