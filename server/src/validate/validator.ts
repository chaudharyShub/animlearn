// Runs generated step code in headless Chromium, inside the same runtime the player uses,
// and reports runtime errors and layout problems (overlaps, overflow, off-canvas).
import { chromium, type Browser, type Page } from 'playwright';
import { sandboxHtml } from '../sandboxPage.js';
import type { Theme } from '../../../shared/types.js';

export interface ValidationResult {
  ok: boolean;
  /** Fatal: the code threw, returned no timeline, or drew nothing. */
  error?: string;
  /** Layout problems that should be fixed (overlaps, overflow...). */
  issues: string[];
  warnings: string[];
  duration?: number;
}

let browserPromise: Promise<Browser> | null = null;

function browser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true }).then((b) => {
      // If Chromium crashes (e.g. low memory), start a fresh one next time.
      b.on('disconnected', () => { browserPromise = null; });
      return b;
    }).catch((err) => {
      browserPromise = null;
      throw new Error(`Could not start headless Chromium. Run "npx playwright install chromium". (${err.message})`);
    });
  }
  return browserPromise;
}

async function openPage(theme: Theme): Promise<Page> {
  try {
    return await newSandboxPage(theme);
  } catch {
    // The browser may have crashed: restart it once.
    await closeValidator();
    return newSandboxPage(theme);
  }
}

async function newSandboxPage(theme: Theme): Promise<Page> {
  const b = await browser();
  const page = await b.newPage({ viewport: { width: 960, height: 540 }, colorScheme: theme });
  // Generated code must never reach the network.
  await page.route('**/*', (route) => route.abort());
  await page.setContent(sandboxHtml(), { waitUntil: 'load' });
  return page;
}

async function runInPage(page: Page, code: string, theme: Theme) {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const res = await page.evaluate(
    ([c, t]) => (window as any).AnimLearn.run(c, t) as { ok: boolean; duration?: number; error?: string },
    [code, theme] as const,
  );
  return { res, pageErrors };
}

export async function validateStep(code: string, theme: Theme = 'light'): Promise<ValidationResult> {
  const page = await openPage(theme);
  try {
    const { res, pageErrors } = await withTimeout(runInPage(page, code, theme), 15000, 'Rendering timed out (infinite loop?)');
    if (!res.ok) return { ok: false, error: res.error, issues: [], warnings: [] };
    const report = await withTimeout(
      page.evaluate(() => (window as any).AnimLearn.inspect() as { issues: string[]; warnings: string[]; duration: number }),
      20000,
      'Inspecting the animation timed out',
    );
    if (pageErrors.length) return { ok: false, error: pageErrors[0], issues: [], warnings: [] };
    return { ok: true, issues: report.issues, warnings: report.warnings, duration: report.duration };
  } catch (err) {
    const message = (err as Error).message;
    // A crashed browser is our problem, not the generated code's: let the caller handle it.
    if (/crash|Target (page, context or browser )?(has been )?closed|browser has been closed/i.test(message)) throw err;
    return { ok: false, error: message, issues: [], warnings: [] };
  } finally {
    await page.close().catch(() => {});
  }
}

/** Screenshots a step at given progress points (0..1). Used by the acceptance-test script. */
export async function screenshotStep(code: string, theme: Theme, points: number[]): Promise<Buffer[]> {
  const page = await openPage(theme);
  try {
    const { res } = await runInPage(page, code, theme);
    if (!res.ok) throw new Error(res.error);
    const shots: Buffer[] = [];
    for (const p of points) {
      await page.evaluate((x) => (window as any).AnimLearn.seek(x), p);
      shots.push(await page.screenshot());
    }
    return shots;
  } finally {
    await page.close().catch(() => {});
  }
}

export async function closeValidator(): Promise<void> {
  if (browserPromise) (await browserPromise).close().catch(() => {});
  browserPromise = null;
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
