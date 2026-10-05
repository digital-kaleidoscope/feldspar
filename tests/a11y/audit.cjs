// Accessibility and mobile audit of the TikTok donation flow (demo host build).
// node audit.cjs <url> <export.json> <outdir>
// For each viewport x colour scheme: axe (WCAG 2.2 AA + best practice) on each screen, plus a screenshot.
// Then a keyboard-only run: can the whole flow be done with Tab / Enter / Space?
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const [url, fixture, out] = process.argv.slice(2);
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 375, height: 740 } };

async function axe(page) {
  await page.addScriptTag({ content: AXE });
  return await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
  });
}

async function horizontalOverflow(page) {
  return await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > w + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('.category__table-wrap');
    }).slice(0, 5).map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''));
  });
}

async function run(browser, name, viewport, colorScheme, report) {
  const page = await browser.newPage({ viewport, colorScheme });
  const shots = async (screen) => {
    await page.screenshot({ path: `${out}/${name}-${colorScheme}-${screen}.png`, fullPage: true });
    report[`${name}/${colorScheme}/${screen}`] = { violations: await axe(page), overflow: await horizontalOverflow(page) };
  };
  await page.goto(url);
  await page.getByRole('heading', { name: 'Donate your TikTok data' }).waitFor({ timeout: 60000 });
  await shots('1-file');
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('Choose file', { exact: true }).click();
  await (await chooser).setFiles(fixture);
  await page.getByText('Continue', { exact: true }).click();
  await page.getByTestId('category-watch_history').waitFor({ timeout: 60000 });
  await shots('2-consent');
  const watch = page.getByTestId('category-watch_history');
  await watch.getByText('Look through all entries').click();
  await watch.getByText(/^Entries 1–50 of /).waitFor({ timeout: 30000 });
  await watch.locator('.category__inspector input[type=checkbox]').first().check();
  await shots('3-inspector');
  await page.getByText('Yes, donate', { exact: true }).click();
  await page.getByText('Thank you! Your donation has been received.').waitFor({ timeout: 60000 });
  await shots('4-done');
  await page.close();
}

// Keyboard only: each step must be reachable by Tab and done by Enter or Space. Controls are found by
// selector (inside the watch-history card), and the focused element's accessible name is recorded.
async function keyboard(browser, report) {
  const page = await browser.newPage({ viewport: VIEWPORTS.desktop });
  const steps = [];
  const W = '[data-testid=category-watch_history] ';
  const describe = () => page.evaluate(() => {
    const el = document.activeElement;
    const name = el?.getAttribute('aria-label') || el?.closest('label')?.innerText || el?.innerText || '';
    return el ? `${el.tagName.toLowerCase()} "${name.trim().slice(0, 40)}"` : 'none';
  });
  async function tabTo(description, test, max = 150) {
    for (let i = 0; i < max; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(test)) { steps.push({ step: description, reached: true, tabs: i + 1, focused: await describe() }); return true; }
    }
    steps.push({ step: description, reached: false });
    return false;
  }
  const focusIs = (selector) => `document.activeElement?.matches(${JSON.stringify(selector)})`;
  const focusText = (re) => `${re}.test(document.activeElement?.innerText ?? '')`;
  try {
    await page.goto(url);
    await page.getByRole('heading', { name: 'Donate your TikTok data' }).waitFor({ timeout: 60000 });
    if (await tabTo('choose file', focusText('/^Choose file$/'))) {
      const chooser = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
      await page.keyboard.press('Enter');
      const c = await chooser;
      steps.push({ step: 'Enter opens the file chooser', reached: c !== null });
      if (c) await c.setFiles(fixture);
    }
    if (await tabTo('continue', focusText('/^Continue$/'))) {
      await page.keyboard.press('Enter');
      const shown = await page.getByTestId('category-watch_history').waitFor({ timeout: 30000 }).then(() => true, () => false);
      steps.push({ step: 'Enter continues to the consent page', reached: shown });
      steps.push({ step: 'focus moved to the page heading', reached: await page.evaluate(() => document.activeElement?.tagName === 'H1') });
    }
    if (await tabTo('include checkbox', focusIs(W + '.category__include input'))) {
      await page.keyboard.press('Space');
      const off = await page.evaluate(() => document.activeElement.checked === false);
      await page.keyboard.press('Space');
      steps.push({ step: 'Space toggles it', reached: off && await page.evaluate(() => document.activeElement.checked === true) });
    }
    if (await tabTo('look through entries', focusIs(W + 'button[aria-controls]'))) {
      await page.keyboard.press('Enter');
      const opened = await page.locator(W + '.category__status').filter({ hasText: /^Entries 1–50 of / }).waitFor({ timeout: 10000 }).then(() => true, () => false);
      steps.push({ step: 'Enter opens the inspector', reached: opened });
    }
    if (await tabTo('a row checkbox', focusIs(W + '.category__inspector input[type=checkbox]'))) await page.keyboard.press('Space');
    await page.keyboard.down('Shift');
    const back = await tabTo('Shift+Tab back to delete selected', focusIs(W + '.category__delete'));
    await page.keyboard.up('Shift');
    if (back) {
      await page.keyboard.press('Enter');
      const deleted = await page.locator(W).getByText('1 entries deleted').waitFor({ timeout: 5000 }).then(() => true, () => false);
      steps.push({ step: 'Enter deletes the row', reached: deleted });
    }
    if (await tabTo('donate button', focusText('/^Yes, donate$/'), 400)) {
      await page.keyboard.press('Enter');
      const done = await page.getByText('Thank you! Your donation has been received.').waitFor({ timeout: 60000 }).then(() => true, () => false);
      steps.push({ step: 'Enter donates', reached: done });
    }
  } catch (error) {
    steps.push({ step: 'error', error: String(error) });
  }
  report.keyboard = steps;
  await page.close();
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const report = {};
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    for (const scheme of ['light', 'dark']) {
      try { await run(browser, name, viewport, scheme, report); } catch (error) { report[`${name}/${scheme}/error`] = String(error); }
    }
  }
  await keyboard(browser, report);
  await browser.close();
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  // Summary
  const all = Object.entries(report).filter(([k]) => k !== 'keyboard');
  const byRule = {};
  for (const [screen, r] of all) for (const v of r.violations ?? []) (byRule[v.id] ??= { impact: v.impact, help: v.help, screens: [] }).screens.push(`${screen} (${v.count})`);
  console.log('AXE VIOLATIONS BY RULE:');
  for (const [id, v] of Object.entries(byRule)) console.log(`- [${v.impact}] ${id}: ${v.help}\n    ${v.screens.join(', ')}`);
  console.log('HORIZONTAL OVERFLOW (mobile):');
  for (const [screen, r] of all) if (screen.startsWith('mobile') && r.overflow?.length) console.log(`- ${screen}: ${r.overflow.join(', ')}`);
  for (const [k, v] of Object.entries(report)) if (k.endsWith('/error')) console.log('ERROR', k, v);
  console.log('KEYBOARD:');
  for (const s of report.keyboard) console.log(`- ${s.reached === false ? 'FAIL' : 'ok  '} ${s.step}${s.tabs ? ` (${s.tabs} tabs)` : ''}${s.focused ? ` → ${s.focused}` : ''}${s.error ? ' ' + s.error : ''}`);
})();
