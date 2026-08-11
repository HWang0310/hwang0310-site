import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const subjectPath = resolve("supabase/templates/recovery.subject.txt");
const templatePath = resolve("supabase/templates/recovery.html");
const runbookPath = resolve("docs/runbooks/income-forecast-auth.md");
const recoveryUrl =
  "https://hwang0310.dpdns.org/projects/income-forecast/reset-password/?token_hash={{ .TokenHash }}&type=recovery";

function readIfPresent(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

describe("hosted recovery email template", () => {
  const subject = readIfPresent(subjectPath).trim();
  const html = readIfPresent(templatePath);

  it("uses the approved Chinese subject", () => {
    expect(existsSync(subjectPath)).toBe(true);
    expect(subject).toBe("《湖北电信收入预估》密码重置");
  });

  it("contains the approved Chinese recovery and contact copy", () => {
    expect(html).toContain("《湖北电信收入预估》密码重置");
    expect(html).toContain("我们收到您的《湖北电信收入预估》账户密码重置申请");
    expect(html).toContain("设置新密码");
    expect(html).toContain("此链接仅可使用一次，并将在系统设定时间后失效");
    expect(html).toContain("如果不是您本人发起的申请，请忽略本邮件，您的原密码不会发生变化");
    expect(html).toContain("如有疑问，请联系IBOC-王昊 Tel：18062752550");
    expect(html).toContain("湖北电信收入预估系统");
  });

  it("contains exactly one own-domain TokenHash recovery link", () => {
    expect(html.split(recoveryUrl)).toHaveLength(2);
    expect(html.match(/href=/giu)).toHaveLength(1);
    expect(html.match(/\{\{\s*\.[A-Za-z]+\s*\}\}/gu)).toEqual(["{{ .TokenHash }}"]);
  });

  it("contains no default English copy, Supabase redirect, secret wording, or remote assets", () => {
    expect(html).not.toMatch(/Reset your password|Reset password|We received a request|If you didn't request/iu);
    expect(html).not.toContain("ConfirmationURL");
    expect(html).not.toMatch(/\.supabase\.(?:co|in)/iu);
    expect(html).not.toMatch(/当前密码|临时密码|初始密码/gu);
    expect(html).not.toMatch(/<(?:img|script|iframe|link)\b/iu);
    expect(html).not.toMatch(/(?:src|action)=["']https?:\/\//iu);
  });
});

describe("recovery email operations", () => {
  const runbook = readIfPresent(runbookPath);

  it("documents the exact hosted subject, body, and credential boundary", () => {
    expect(runbook).toContain("supabase/templates/recovery.subject.txt");
    expect(runbook).toContain("supabase/templates/recovery.html");
    expect(runbook).toContain("《湖北电信收入预估》密码重置");
    expect(runbook).toContain("Authentication → Email Templates → Reset password");
    expect(runbook).toContain("授权码只粘贴到 Supabase Dashboard");
    expect(runbook).toContain("不得改用 `{{ .ConfirmationURL }}`");
  });

  it("requires a complete Wang Hao production recovery test without recording passwords", () => {
    expect(runbook).toContain("王昊账户");
    expect(runbook).toContain("中文主题");
    expect(runbook).toContain("中文正文");
    expect(runbook).toContain("地址栏");
    expect(runbook).toContain("旧密码不再能够登录");
    expect(runbook).toContain("不得向 Codex、日志或聊天提供新旧密码");
  });
});
