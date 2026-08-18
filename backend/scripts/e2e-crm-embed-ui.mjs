/**
 * End-user CRM embed UI check (Playwright).
 *
 * Opens Flolah, goes to /crm (same as clicking CRM), waits for the iframe,
 * and fails if Twenty /welcome is still showing.
 *
 *   FLOLAH_E2E_SESSION=<ceo session> FLOLAH_E2E_BASE=https://login.flolah.cloud node backend/scripts/e2e-crm-embed-ui.mjs
 *
 * Does not print the session token.
 */
import { chromium } from 'playwright';

const base = String(process.env.FLOLAH_E2E_BASE || 'https://login.flolah.cloud').replace(/\/+$/, '');
const token = String(process.env.FLOLAH_E2E_SESSION || '').trim();
if (!token) {
  console.error('FLOLAH_E2E_SESSION required');
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const failures = [];
try {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate((t) => {
    localStorage.setItem('agent-os-auth-token', t);
  }, token);
  await page.goto(`${base}/crm`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const crmLink = page.getByRole('link', { name: /^CRM$/ });
  if (await crmLink.count()) {
    await crmLink.first().click();
    await page.waitForTimeout(500);
  }

  const iframe = page.locator('iframe[title="CRM"]');
  await iframe.waitFor({ state: 'attached', timeout: 30000 });
  const src = (await iframe.getAttribute('src')) || '';
  if (/\/verify/i.test(src) || /loginToken=/i.test(src)) {
    failures.push('iframe src uses Twenty /verify');
  }
  if (!/flolah-handoff/i.test(src) && !src) {
    failures.push('iframe src missing handoff');
  }

  // Apply then Twenty SPA — wait for welcome vs desk.
  const frame = page.frameLocator('iframe[title="CRM"]');
  await page.waitForTimeout(8000);
  const welcome = frame.getByText(/welcome|work email|continue with email/i);
  const welcomeVisible = await welcome.first().isVisible().catch(() => false);
  const desk = frame.getByText(/people|companies|opportunities|pipeline|settings/i);
  const deskVisible = await desk.first().isVisible().catch(() => false);

  const frameUrl = page.frames().find((f) => /crm\.flolah\.cloud/i.test(f.url()))?.url() || '';
  if (/\/welcome/i.test(frameUrl)) failures.push(`iframe still on /welcome (${frameUrl.split('?')[0]})`);
  if (welcomeVisible && !deskVisible) failures.push('Twenty email welcome still visible in CRM iframe');

  console.log(
    JSON.stringify({
      ok: failures.length === 0,
      failures,
      iframe_host: (() => {
        try {
          return new URL(src).hostname;
        } catch {
          return null;
        }
      })(),
      frame_path: (() => {
        try {
          return frameUrl ? new URL(frameUrl).pathname : null;
        } catch {
          return null;
        }
      })(),
      deskVisible,
      welcomeVisible,
    })
  );
  if (failures.length) process.exit(1);
} finally {
  await browser.close();
}
