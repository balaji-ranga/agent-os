/**
 * End-user CRM + ERP embed UI check (Playwright).
 *
 * Opens Flolah, clicks CRM then ERP (same shell/iframe as a CEO), and fails if
 * Twenty /welcome or the ERPNext login form is still showing.
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

  const crm = {
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
    flolah_path: new URL(page.url()).pathname,
  };
  if (!/^\/crm/i.test(crm.flolah_path)) {
    failures.push(`Flolah left the CRM page (${crm.flolah_path})`);
  }

  const erpLink = page.getByRole('link', { name: /^ERP$/ });
  if (await erpLink.count()) {
    await erpLink.first().click();
  } else {
    await page.goto(`${base}/erp`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  const erpIframe = page.locator('iframe[title="ERP"]');
  await erpIframe.waitFor({ state: 'attached', timeout: 30000 });
  const erpSrc = (await erpIframe.getAttribute('src')) || '';
  if (!/flolah-erp-handoff/i.test(erpSrc) && !/erp\.crm\./i.test(erpSrc)) {
    failures.push('ERP iframe src missing erp handoff');
  }

  await page.waitForTimeout(10000);
  const erpFrame = page.frameLocator('iframe[title="ERP"]');
  const erpLogin = erpFrame.getByRole('button', { name: /^login$/i });
  const erpLoginVisible = await erpLogin.first().isVisible().catch(() => false);
  const erpDesk = erpFrame.getByText(/awesome bar|workspaces|home|modules|accounting|selling/i);
  const erpDeskVisible = await erpDesk.first().isVisible().catch(() => false);
  const erpFrameUrl =
    page.frames().find((f) => /erp\.crm\./i.test(f.url()) || /flolah-erp/i.test(f.url()))?.url() || '';
  if (/\/login/i.test(erpFrameUrl) && erpLoginVisible) {
    failures.push(`ERP iframe still on login (${String(erpFrameUrl).split('?')[0]})`);
  }
  if (erpLoginVisible && !erpDeskVisible) {
    failures.push('ERPNext login still visible in ERP iframe');
  }

  const erp = {
    iframe_host: (() => {
      try {
        return new URL(erpSrc).hostname;
      } catch {
        return null;
      }
    })(),
    frame_path: (() => {
      try {
        return erpFrameUrl ? new URL(erpFrameUrl).pathname : null;
      } catch {
        return null;
      }
    })(),
    deskVisible: erpDeskVisible,
    loginVisible: erpLoginVisible,
    flolah_path: new URL(page.url()).pathname,
  };
  if (!/^\/erp/i.test(erp.flolah_path)) {
    failures.push(`Flolah left the ERP page (${erp.flolah_path})`);
  }

  console.log(
    JSON.stringify({
      ok: failures.length === 0,
      failures,
      crm,
      erp,
    })
  );
  if (failures.length) process.exit(1);
} finally {
  await browser.close();
}
