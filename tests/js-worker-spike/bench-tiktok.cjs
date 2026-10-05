// TikTok flow benchmark: node bench-tiktok.cjs <url> <export.json|zip>
// Same RSS sampling as tests/memory-benchmark.cjs. A scripted participant uploads the
// export, inspects watch history, deletes two rows, excludes logins, and donates. The app must
// be built with VITE_DEMO_HOST=1: its demo host plays the server (pass ?latency=&failRate= in
// the URL), and what it received is checked against the participant's choices. Prints counts
// and timings, never row contents.
const { chromium } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');

async function main() {
  const [url, fixture] = process.argv.slice(2);
  const server = await chromium.launchServer({ headless: false });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const pid = server.process().pid;
  const report = { url, fixture, outcome: 'failed', sample_interval_ms: 250, peak_rss_kib: 0, phase_peaks_kib: {}, phase_ms: {}, samples: 0 };
  let phase = 'initialization';
  const t0 = Date.now(); let tPhase = t0;
  const mark = (next) => { report.phase_ms[phase] = Date.now() - tPhase; tPhase = Date.now(); phase = next; };
  const sample = () => {
    const processes = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' })
      .trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
    const tree = new Set([pid]); let size;
    do { size = tree.size; for (const [child, parent] of processes) if (tree.has(parent)) tree.add(child); } while (tree.size !== size);
    const rss = processes.reduce((sum, [child, , kib]) => sum + (tree.has(child) ? kib : 0), 0);
    report.peak_rss_kib = Math.max(report.peak_rss_kib, rss);
    report.phase_peaks_kib[phase] = Math.max(report.phase_peaks_kib[phase] ?? 0, rss);
    report.samples++;
  };
  const timer = setInterval(sample, report.sample_interval_ms);
  let fail; const failure = new Promise((_, reject) => { fail = reject; }); failure.catch(() => {});
  page.on('crash', () => fail(new Error('Chromium tab crashed')));
  page.on('pageerror', error => fail(error));
  await page.exposeFunction('benchFailure', message => fail(new Error(message)));
  await page.addInitScript(() => {
    window.donation = null;
    window.progressSeen = [];
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', e => { if (e.data?.eventType === 'error') window.benchFailure(e.data.error); });
        this.addEventListener('error', e => window.benchFailure(e.message));
      }
    };
    // Record each distinct progress text the participant would have seen.
    new MutationObserver(() => {
      const text = document.body?.innerText ?? '';
      const m = /(Reading your file…|Processing your file…|Extracting [^\n…]*…|Sending your donation…)(?:\s*(\d+)%)?/.exec(text);
      if (m) { const seen = m[1] + (m[2] ? ' ' + m[2] + '%' : ''); if (window.progressSeen.at(-1) !== seen) window.progressSeen.push(seen); }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });

  try {
    await Promise.race([failure, (async () => {
      await page.goto(url);
      await page.getByRole('heading', { name: 'Donate your TikTok data' }).waitFor({ timeout: 90000 });
      sample(); mark('read_and_extract');
      const chooser = page.waitForEvent('filechooser');
      await page.getByText('Choose file', { exact: true }).click();
      await (await chooser).setFiles(fixture);
      await page.getByText('Continue', { exact: true }).click();
      const watch = page.getByTestId('category-watch_history');
      await watch.waitFor({ timeout: 180000 });
      sample(); mark('inspect_and_delete');
      await watch.getByText('Look through all entries').click();
      await watch.getByText(/^Entries 1–50 of /).waitFor({ timeout: 30000 });
      await watch.getByRole('button', { name: 'Next' }).click();
      await watch.getByText(/^Entries 51–100 of /).waitFor({ timeout: 30000 });
      const boxes = watch.locator('.category__inspector input[type=checkbox]');
      await boxes.nth(0).check(); await boxes.nth(1).check();
      await watch.getByRole('button', { name: 'Delete selected (2)' }).click();
      await watch.getByText('2 entries deleted').waitFor();
      const tSearch = Date.now();
      await watch.getByPlaceholder('Search').fill(process.env.BENCH_SEARCH ?? 'tiktok');
      await watch.getByText(/^Entries 1–50 of /).waitFor({ timeout: 30000 });
      report.search_ms = Date.now() - tSearch;
      await page.getByTestId('category-logins').getByLabel('Include in my donation').uncheck();
      sample(); mark('donation');
      await page.getByText('Yes, donate', { exact: true }).click();
      await page.getByText('Thank you! Your donation has been received.').waitFor({ timeout: 300000 });
      const host = await page.evaluate(() => window.demoHost);
      report.progress_seen = await page.evaluate(() => window.progressSeen);
      const m = host.manifest.categories;
      report.donation = {
        pieces: Object.values(host.pieces).reduce((n, c) => n + c.pieces, 0),
        max_piece_mib: +(host.maxPieceChars / 2 ** 20).toFixed(2),
        injected_failures: host.failuresInjected, resent_duplicates: host.duplicates, donation_ids: host.donationIds.length, errors: host.errors,
        categories: Object.fromEntries(Object.entries(m).map(([id, c]) => [id, { received_rows: host.pieces[id]?.rows ?? 0, ...c }]))
      };
      for (const [id, c] of Object.entries(report.donation.categories)) {
        assert.equal(c.received_rows, c.donated_rows, id + ': rows received match the manifest');
        assert.equal(host.pieces[id]?.pieces ?? 0, c.pieces, id + ': pieces received match the manifest');
      }
      assert.deepEqual(host.errors, []);
      assert.equal(host.donationIds.length, 1);
      const w = report.donation.categories.watch_history;
      assert.equal(w.deleted_rows, 2);
      assert.equal(w.donated_rows, w.total_rows - 2);
      assert.equal(report.donation.categories.logins.included, false);
      assert.equal(report.donation.categories.logins.received_rows, 0);
      sample(); mark('done'); report.total_ms = Date.now() - t0;
      report.outcome = 'passed';
    })()]);
  } catch (error) {
    report.failure_phase = phase;
    report.error = String(error);
    report.progress_seen = await page.evaluate(() => window.progressSeen).catch(() => null);
    await page.screenshot({ path: '/out/failure.png', fullPage: false }).catch(() => {});
    process.exitCode = 1;
  } finally {
    clearInterval(timer);
    await browser.close();
    await server.close();
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
