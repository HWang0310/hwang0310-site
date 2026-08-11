# 王昊个人网站与湖北电信收入预估

这是王昊的个人网站仓库，包含个人主页和湖北电信收入预估 2.0 项目。两个项目共用同一个 Cloudflare Pages 站点，但通过独立的发布标签和目录边界管理。

- 个人网站：<https://hwang0310.dpdns.org/>
- 收入预估入口：<https://hwang0310.dpdns.org/projects/income-forecast/>
- GitHub：<https://github.com/HWang0310/hwang0310-site>

## 版本发布

| 项目 | 版本 | GitHub Release 标签 | 说明 |
| --- | --- | --- | --- |
| 个人网站 | 1.0 | `site-v1.0.0` | 个人主页、作品集、论文介绍、联系方式和卡通向导 |
| 收入预估项目 | 2.0 | `income-forecast-v2.0.0` | 报告展示、账号体系、Supabase 私有数据和管理后台 |

两个 Release 都对应本仓库的完整源代码快照。GitHub 会自动提供源码 ZIP/TAR 下载；生产发布仍由 Cloudflare Pages 和收入预估发布 Skill 按项目边界执行。

## 个人网站 1.0

个人网站以作品集和专业能力展示为主，同时保留轻松、亲切的卡通线稿氛围：

- 个人简介、专业能力、项目作品、硕士论文和联系方式；
- AI 卡通肖像与真实照片切换；
- 小狗网站向导、滚动章节和轻量动效；
- 座右铭、论文数值实验截图等个人内容模块；
- 手机、平板和桌面端响应式布局；
- 站点主页与收入预估项目隔离，收入预估报告发布不会覆盖个人主页。

### 个人网站技术

- Vite + TypeScript：负责多页面构建和静态资源打包；
- 原生 HTML/CSS/JavaScript：保持页面轻量、易维护和无第三方运行时依赖；
- Cloudflare Pages：托管静态页面和 Pages Functions；
- Cloudflare Pages Functions：承载收入预估项目的同源 API；
- Playwright、Vitest、TypeScript：用于响应式、无障碍、接口和构建回归验证。

## 湖北电信收入预估 2.0

收入预估项目用于展示湖北省及 17 地市的收入预估报告。匿名访客可以查看指定的公开示例，登录后的人员可以按照权限查看完整报告归档。

### 前端与展示功能

- 全省总览、17 地市下钻、业务拆解、环比/同比分析和数值实验说明；
- 年、月、日三级联动日期选择器；
- 桌面、平板和手机端响应式报告页面，支持 360px 宽度；
- 表格局部滚动、首列吸附、打印样式和减少动效模式；
- 静态公开报告优先展示，在线接口失败时保留可用的公开示例；
- 公开白名单目前为 `20260720` 和 `20260725`，其他报告不会进入公开静态构建物。

### 后端与安全边界

- Cloudflare Pages Functions 提供同源登录、会话、报告、密码和管理 API；
- 服务端校验请求来源、会话、角色、报告日期和 Storage 路径；
- 匿名请求只返回公开报告；私有报告必须经过认证并从私有 Storage 流式读取；
- 管理员王昊使用 `root_admin` 权限，可管理人员、报告、容量清理和审计记录；
- 登录、忘记密码、管理员操作和报告访问均有速率限制、失败审计和安全错误提示；
- 私有报告容量按在线元数据和 Storage 实际用量管理，公共示例不会被自动清理。

### 账号登录、改密与密码重置

#### 账号登录

- 用户名为人员清单中的手机号；
- 初始密码为手机号本身；
- 首次登录不强制改密，但用户可在登录后主动修改密码；
- 登录成功后服务端建立 HttpOnly、Secure、SameSite 会话 Cookie；
- 同一手机号、同一网络地址和管理员账户分别进行失败次数限制；连续失败达到阈值后增加人机验证或短暂暂停。

#### 登录后修改密码

- 先验证当前登录会话，再使用账号邮箱重新认证当前密码；
- 新密码通过长度和 UTF-8 字节边界校验，不能与当前密码相同；
- 修改成功后撤销旧会话、更新用户状态并建立新会话；
- 不把密码写入前端日志、审计记录、仓库或普通文件。

#### 忘记密码与邮件重置

- 用户输入姓名；同名人员需要补充工号后四位进行精确匹配；
- 页面显示脱敏邮箱，并提示“请前往您的邮箱”；
- 同一姓名 60 秒内最多发送一次，每小时最多发送 10 次；
- 邮件通过 Supabase 自定义 SMTP 发送，使用中文主题和正文；
- 邮件使用一次性 `token_hash` 链接，链接打开后在站内输入新密码；
- 重置成功后撤销恢复会话并自动进入新的登录会话；
- 邮件末尾包含人工联系信息：IBOC-王昊 Tel：18062752550；
- 新密码与旧密码相同或链接已使用时，页面会给出明确中文提示，并要求重新申请一次性链接。

### Supabase 技术架构

项目使用 Supabase 作为零成本优先的认证和数据服务，Cloudflare Pages Functions 作为唯一服务端边界：

- **Supabase Auth**：管理邮箱/密码认证、恢复 Token、会话和全局登出；用户在页面使用手机号登录，服务端将手机号映射到清单中的 Auth 邮箱；
- **Supabase PostgreSQL**：保存 `profiles` 人员权限、`reports` 报告元数据、`audit_events` 审计事件及速率限制数据；
- **PostgreSQL RPC**：使用原子 reservation/finalization 和密码找回计数函数，避免并发请求绕过限制；
- **Supabase Storage**：私有桶 `income-forecast-reports` 保存非公开报告文件，服务端验证后再代理下载；
- **自定义 SMTP**：通过 163 邮箱 SMTP 发送中文找回密码邮件，SMTP 密码只保存在 Supabase 控制台的加密配置中；
- **Publishable Key / Service Role Key**：Publishable Key 只用于受控的公开客户端初始化，Service Role Key 仅在 Pages Functions 服务端配置中使用，绝不进入网页、README 或 GitHub。

### 报告发布策略

收入预估 2.0 Skill 会根据日期自动选择发布路径：

- `20260720`、`20260725`：进入公开 Cloudflare Pages 静态报告；
- 其他日期：写入 Supabase 私有 Storage 和 PostgreSQL 元数据，不部署到公开静态站；
- 私有报告超过容量阈值时，优先清理最早的私有报告；公开示例始终保留；
- 发布流程只替换 `/projects/income-forecast/`，不会覆盖个人主页；
- 发布前会校验报告日期、文件类型、字节数、SHA-256、路径绑定和运行时资源版本。

## 本地开发与验证

```bash
npm install
npm run build
npm test
npm run typecheck
npm run test:e2e
```

收入预估报告的生成、验证和发布由本机 Skill 统一管理。生产配置中的 Supabase URL、Publishable Key、Service Role Key 和 SMTP 密码不写入仓库；本地调试应使用未提交的环境配置或系统钥匙串。

## 目录概览

```text
src/                              个人主页与收入预估前端
functions/                        Cloudflare Pages Functions API
supabase/migrations/              PostgreSQL 迁移
supabase/templates/               中文密码重置邮件模板
scripts/                          构建、导入人员、发布和生产探测脚本
projects/income-forecast/         收入预估静态入口与报告路径
tests/                            Vitest、Playwright 和安全回归测试
```

## 安全说明

本仓库只保存源代码、模板和不含凭据的配置。请不要提交密码、SMTP 授权码、Supabase Service Role Key、恢复链接、Cookie 或人员清单中的敏感信息。
