# 收入预估认证运维手册

本手册用于现有 Supabase 免费项目、Cloudflare Pages 和 163 邮箱的认证运维。不在仓库、工单、聊天或截图中记录 SMTP 授权码、Supabase Service Role、数据库密码或 Cloudflare 令牌。

## Supabase Auth 和 163 SMTP

在 Supabase Dashboard 的当前项目中打开 **Authentication → Email → SMTP Settings**，启用自定义 SMTP，并填写：

- Sender email：`hwang0310@163.com`
- Sender name：`收入预估`
- Host：`smtp.163.com`
- Port：`465`（SSL/TLS）
- Username：`hwang0310@163.com`
- Password：`由王昊在官方后台填写`

163 邮箱后台需开启 SMTP 服务。授权码只粘贴到 Supabase Dashboard 的 Password 字段，不得写入本文件或本地 `.env`。保存后使用 Dashboard 提供的测试功能向管理员自己的邮箱发送一封测试邮件，不使用生产人员名单做测试。

在 **Authentication → URL Configuration** 中确认 Site URL 为 `https://hwang0310.dpdns.org`，Redirect URLs 包含：

```text
https://hwang0310.dpdns.org/projects/income-forecast/reset-password/
```

在 **Authentication → Email Templates → Reset password** 中使用 [`supabase/templates/recovery.html`](../../supabase/templates/recovery.html)。链接必须保持为：

```text
https://hwang0310.dpdns.org/projects/income-forecast/reset-password/?token_hash={{ .TokenHash }}&type=recovery
```

不得改用 `{{ .ConfirmationURL }}`，不得在邮件正文中出现 Supabase 项目域名。邮件发送失败时，接口不会返回 `sent`；先在 Dashboard 的 Auth Logs 中查看时间点与错误类型，再检查 SMTP 服务状态、发件限额和垃圾邮件箱。日志和工单不得复制完整邮箱、姓名、令牌或密码。

## Cloudflare Pages 秘密配置

在 Cloudflare Dashboard 的 `hwang0310-site` Pages 项目中，将以下值作为生产秘密或变量维护，不写入 Wrangler 配置和源码：

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RATE_LIMIT_HMAC_SECRET`
- `SITE_ORIGIN=https://hwang0310.dpdns.org`
- `SUPABASE_STORAGE_BUCKET`

变更秘密后重新部署 Pages，再使用专用测试账号验证登录、退出、找回、重置和主动改密。响应、Workers Logs 和审计中均不应出现密码、`token_hash`、完整 Cookie、完整手机号、完整邮箱或姓名。

## DBeaver 与 Supavisor

在 Supabase Dashboard 点击 **Connect**，选择 **Supavisor Session Pooler**，将 Dashboard 当前显示的 Host、Port、Database 和 User 分别填入 DBeaver PostgreSQL 连接，SSL mode 使用 `require`。数据库密码从平台官方秘密配置或 macOS 钥匙串读取，不保存到仓库。

DBeaver 只用于查询和审核 `public` 业务表。不直接插入、更新或删除 `auth` 和 `storage` schema 的系统表；账号通过 Auth API 管理，对象通过 Storage API 管理。也不使用 DBeaver 绕过 RLS 、修改审计记录或手工清空限流计数。

## 改密故障恢复

重置和主动改密在成功后会撤销旧 refresh sessions，再登录产生一组新的 HttpOnly Cookie。Supabase Auth 已更新密码，但 profile 更新、会话撤销或新登录随后失败时，服务会清除本地收入预估 Cookie 并返回脱敏错误，不返回任何 Auth 令牌。

遇到这种情况：

1. 先用用户本次提交的新密码尝试正常登录；不要在日志或聊天中向用户索要密码。
2. 如果能登录，在登录态再执行一次主动改密，使 profile 标记与会话撤销完整收敛。
3. 如果无法登录，重新发起姓名找回；旧 recovery token 不得重放。
4. 按时间点查看 Auth Logs 和脱敏审计的 `reason`，区分 Auth、profile、撤销或 SMTP 故障，不从日志复制用户输入。

Supabase Auth access token 在已签发后不能立即从所有节点撤回；全局退出主要撤销 refresh token。敏感操作必须继续服务端验证用户和 profile，并保持较短的 JWT 有效期。

## 私有报告桶与人员清单导入

私有报告桶由 Storage API 幂等初始化，脚本不会直接写 `storage.buckets` 或
`storage.objects`。先在仓库根目录执行：

```bash
npm run provision:income
```

脚本要求 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 来自官方秘密配置；报告桶
`income-forecast-reports` 保持私有，单文件上限 25 MiB，只允许 HTML、CSS、JavaScript、
SVG、常用图片和 WOFF/WOFF2。若发现同名公共桶，脚本会安全失败，不会自动改变公开状态。

人员清单导入默认为 Dry Run，默认文件为：

```text
/Users/hwang/Movies/Program/hwang_sryg/收入预估2.0人员权限清单.xlsx
```

可显式指定清单路径：

```bash
npm run import:income-users -- --roster "/path/to/人员权限清单.xlsx"
```

Dry Run 只显示人数、管理员数和待创建/待更新数量，不访问远端、不输出完整手机号、
邮箱或密码。表头必须精确为 `姓名/工号/电话号码/邮箱/是否管理员`，工号、手机号和邮箱
不能重复，且必须有且仅有一名标记为管理员的王昊。确认脱敏预演结果后，才可以加上
`--apply`：

```bash
npm run import:income-users -- --roster "/path/to/人员权限清单.xlsx" --apply
```

`--apply` 会通过 Auth Admin API 创建缺失手机号账号，初始密码仅在 Auth 中设为手机号，
并用 `app_metadata.role` 写入 `root_admin/admin/user`；已存在账号只同步联系方式和角色，
绝不重设密码。随后通过 PostgREST `profiles` upsert 业务资料。脚本和清单均不进入 Git，
Service Role 缺失时在任何远端调用前失败。
