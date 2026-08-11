# Chinese Recovery Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the incompatible Supabase default English recovery email with a tested Chinese template that opens the existing same-domain one-time password reset flow.

**Architecture:** Keep the existing Cloudflare/Supabase password-reset API unchanged. Store the hosted subject and HTML as versioned template files, test their security and copy contract, then copy the exact values into Supabase Dashboard and verify the production email end to end.

**Tech Stack:** Supabase Auth hosted email templates, Cloudflare Pages Functions, TypeScript, Vitest, HTML email.

## Global Constraints

- Subject must be exactly `《湖北电信收入预估》密码重置`.
- The only action link must use the exact own-domain `token_hash={{ .TokenHash }}&type=recovery` URL.
- The footer must contain `如有疑问，请联系IBOC-王昊 Tel：18062752550`.
- Never include, retrieve, email, log, or store a current or temporary password.
- Never include `{{ .ConfirmationURL }}`, a Supabase project domain, remote assets, tracking pixels, scripts, or English default recovery copy.
- The 163 SMTP authorization code is entered only by the user in Supabase Dashboard.

---

### Task 1: Lock the hosted recovery template contract

**Files:**
- Create: `tests/recovery-email-template.test.ts`
- Create: `supabase/templates/recovery.subject.txt`
- Modify: `supabase/templates/recovery.html`

**Interfaces:**
- Consumes: Supabase Go-template variable `{{ .TokenHash }}`.
- Produces: exact hosted subject and HTML body copied into Supabase Authentication Email Templates.

- [ ] **Step 1: Write the failing template contract test**

Assert the exact subject; required Chinese copy and contact line; exactly one same-domain action URL; and absence of `ConfirmationURL`, default English copy, Supabase domains, remote assets, scripts, current-password wording, and template variables other than `TokenHash`.

- [ ] **Step 2: Run the test to verify RED**

Run: `npm test -- tests/recovery-email-template.test.ts`

Expected: FAIL because `recovery.subject.txt` is missing and the existing HTML lacks the approved full copy/contact line.

- [ ] **Step 3: Implement the minimal subject and HTML template**

Create the exact subject file and replace the HTML with a simple Chinese, inline-styled, image-free template containing one `TokenHash` button URL and the approved footer.

- [ ] **Step 4: Run the test to verify GREEN**

Run: `npm test -- tests/recovery-email-template.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/recovery-email-template.test.ts supabase/templates/recovery.subject.txt supabase/templates/recovery.html
git commit -m "feat: add Chinese password recovery email"
```

### Task 2: Make hosted configuration reproducible

**Files:**
- Modify: `docs/runbooks/income-forecast-auth.md`
- Test: `tests/recovery-email-template.test.ts`

**Interfaces:**
- Consumes: `supabase/templates/recovery.subject.txt` and `supabase/templates/recovery.html`.
- Produces: exact Dashboard configuration and an end-to-end verification checklist without credential exposure.

- [ ] **Step 1: Extend the failing contract test**

Assert that the runbook points to both versioned template files, names the exact Dashboard fields, forbids default `ConfirmationURL`, and requires a Wang Hao test email without recording secrets.

- [ ] **Step 2: Run the test to verify RED**

Run: `npm test -- tests/recovery-email-template.test.ts`

Expected: FAIL because the current runbook does not reference the subject file or exact production verification checklist.

- [ ] **Step 3: Update the runbook minimally**

Document the subject/body copy procedure, SMTP fields, authorization-code boundary, Redirect URL, exact `TokenHash` link, and end-to-end acceptance steps.

- [ ] **Step 4: Run targeted and full local verification**

Run:

```bash
npm test -- tests/recovery-email-template.test.ts tests/function-password.test.ts
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

Expected: all commands exit 0 and the production dependency audit reports zero vulnerabilities.

- [ ] **Step 5: Commit**

```bash
git add docs/runbooks/income-forecast-auth.md tests/recovery-email-template.test.ts
git commit -m "docs: lock recovery email operations"
```

### Task 3: Configure and verify Supabase production

**Files:**
- Read: `supabase/templates/recovery.subject.txt`
- Read: `supabase/templates/recovery.html`
- Read: `docs/runbooks/income-forecast-auth.md`

**Interfaces:**
- Consumes: the tested subject/body files and user-entered 163 SMTP authorization code.
- Produces: a hosted Chinese recovery email whose button reaches the production reset page.

- [ ] **Step 1: Configure Supabase hosted email**

In `dcymydheijnbqciemlzn`, enable custom SMTP with `smtp.163.com:465`, sender `hwang0310@163.com`, and the user-entered authorization code. Copy the exact versioned subject and HTML into `Authentication → Email Templates → Reset password`.

- [ ] **Step 2: Verify Auth URL configuration**

Confirm Site URL is `https://hwang0310.dpdns.org` and Redirect URLs include `https://hwang0310.dpdns.org/projects/income-forecast/reset-password/`.

- [ ] **Step 3: Send one production recovery email**

Use the website forgot-password form for Wang Hao. Confirm the received message has the exact Chinese subject/body, no English default copy, and a button whose visible destination is the own domain.

- [ ] **Step 4: Verify the complete reset flow**

Open the link once, confirm the address bar is scrubbed, choose a new password, confirm automatic signed-in state, and verify the old password no longer authenticates. Do not disclose either password to the agent or logs.

- [ ] **Step 5: Deploy and sync source**

Deploy the verified site bundle to Cloudflare Pages, run `npm run verify:income`, merge the branch to `main`, and push normally to GitHub without force.

### Task 4: Explain and display the recovery cooldown

**Files:**
- Modify: `projects/income-forecast/index.html`
- Modify: `src/income-forecast/client.ts`
- Modify: `src/income-forecast/styles.css`
- Test: `tests/income-ui.test.ts`
- Test: `tests/e2e/income-forecast.spec.ts`

**Interfaces:**
- Consumes: fixed successful cooldown of 60 seconds and server `IncomeApiError.retryAfterSeconds` for rejected requests.
- Produces: `recoveryCooldownText(seconds: number): string`, a persistent reminder, and a disabled submit button during the active cooldown.

- [ ] **Step 1: Write failing UI and browser tests**

Assert the static reminder, exported countdown formatter, and disabled submit button with `60秒` feedback after a successful recovery request.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- tests/income-ui.test.ts`

Expected: FAIL because the marker, copy, and formatter do not exist.

- [ ] **Step 3: Implement the minimal cooldown UI**

Add the accessible reminder element, formatter, timer, success cooldown, server-retry cooldown, and minimal muted helper styling. Re-enable the button only after the active cooldown reaches zero.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/income-ui.test.ts
npx playwright test tests/e2e/income-forecast.spec.ts --project=desktop-chromium --grep "forgot-password"
```

Expected: both commands exit 0.
