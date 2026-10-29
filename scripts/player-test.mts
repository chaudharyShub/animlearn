// Click-through test of the player UI. Does NOT generate or regenerate anything.
import { chromium } from 'playwright';
const out = 'scripts/out/ui';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
const errors: string[] = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
// Safety: block any generation request.
await p.route('**/api/lessons/**/regenerate', (r) => { errors.push('BLOCKED regenerate call'); r.abort(); });
await p.route('**/api/lessons', (r) => (r.request().method() === 'POST' ? (errors.push('BLOCKED create call'), r.abort()) : r.continue()));

const label = () => p.locator('.controls-label').innerText();
const fill = () => p.locator('.track-seg.is-current .track-fill').evaluate((e) => getComputedStyle(e).transform);
const ok = (name: string, cond: boolean, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);

await p.goto('http://localhost:3001/#/lesson/13PrwJjtj4AR');
await p.waitForSelector('.lesson-title');
await p.screenshot({ path: `${out}-1-intro.png` });
ok('intro shows', (await label()) === 'Introduction', await label());
ok('history lists both lessons', (await p.locator('.history-item').count()) >= 2);

await p.getByRole('button', { name: 'Start the lesson' }).click();
await p.waitForTimeout(4000);
ok('start goes to step 1', (await label()).startsWith('Step 1 of 11'), await label());
const f1 = await fill();
await p.waitForTimeout(1000);
const f2 = await fill();
ok('animation progresses while playing', f1 !== f2, `${f1} -> ${f2}`);
await p.screenshot({ path: `${out}-2-playing.png` });

await p.keyboard.press('Space');
await p.waitForTimeout(300);
const f3 = await fill();
await p.waitForTimeout(1200);
ok('space pauses', f3 === (await fill()));
ok('play button shown when paused', await p.getByRole('button', { name: 'Play', exact: true }).isVisible());

await p.keyboard.press('ArrowRight');
await p.waitForTimeout(800);
ok('arrow right -> step 2', (await label()).startsWith('Step 2 of 11'), await label());
await p.keyboard.press('ArrowLeft');
await p.waitForTimeout(800);
ok('arrow left -> step 1', (await label()).startsWith('Step 1 of 11'), await label());

// Scrub: click the middle of the current segment.
const seg = p.locator('.track-seg.is-current');
const box = (await seg.boundingBox())!;
await p.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
await p.waitForTimeout(600);
const scrub = await fill();
ok('scrub seeks to ~50%', /matrix\(0\.[45]/.test(scrub), scrub);

// Auto-advance: play step 2 to the end and wait for the hold.
await p.keyboard.press('ArrowRight');
await p.getByRole('button', { name: 'Play', exact: true }).click();
await p.waitForTimeout(9000 + 6500);
ok('auto-advances to step 3 after step 2 ends', (await label()).startsWith('Step 3 of 11'), await label());
await p.getByRole('button', { name: 'Pause', exact: true }).click();

// Replay button restarts the step.
await p.getByRole('button', { name: 'Replay step' }).click();
await p.waitForTimeout(700);
const rf = await fill();
ok('replay restarts step', /matrix\(0\.0/.test(rf), rf);
await p.getByRole('button', { name: 'Pause', exact: true }).click();

// Theme toggle: system -> light -> dark
const themeBtn = p.locator('.topbar .icon-btn');
await themeBtn.click(); await themeBtn.click();
await p.waitForTimeout(1200);
ok('dark theme applied', (await p.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
await p.screenshot({ path: `${out}-3-dark.png` });

// Broken step 10 shows a clear placeholder and a regenerate button (not clicked).
await p.locator('.track-seg').nth(10).click();
await p.waitForTimeout(800);
ok('broken step shows placeholder', await p.getByText('This step could not be built').isVisible());
ok('regenerate button present', await p.getByRole('button', { name: /Regenerate this step/ }).isVisible());
await p.screenshot({ path: `${out}-4-broken-step.png` });

// Recap
await p.locator('.track-seg').last().click();
await p.waitForTimeout(600);
ok('recap shows', (await label()) === 'Recap');
await p.screenshot({ path: `${out}-5-recap.png` });

// Reload keeps the lesson (hash routing) and reopen from history works.
await p.reload(); await p.waitForSelector('.lesson-title');
ok('reload keeps lesson open', (await p.locator('.lesson-title').innerText()).includes('Docker'));
await p.locator('.history-item', { hasText: 'React' }).click();
await p.waitForTimeout(800);
ok('open other lesson from history', (await p.locator('.lesson-title').innerText()).includes('React'));

// Narrow window layout
await p.setViewportSize({ width: 820, height: 1000 });
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}-6-narrow.png`, fullPage: true });

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await b.close();
