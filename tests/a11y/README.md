# Accessibility and mobile audit

`audit.cjs` walks the TikTok donation flow (choose file → consent page → row inspector → donate) at
desktop (1280px) and phone (375px) width, in light and dark, and on every screen:

- runs **axe-core** (WCAG 2.0/2.1/2.2 A and AA, plus best practice),
- checks nothing overflows the page sideways,
- saves a full-page screenshot;

then does the whole flow **with the keyboard only** (Tab, Shift+Tab, Enter, Space), checking each control
is reachable, named, and works, and that focus moves to the heading when the page changes.

It uses a synthetic export (`gen_synthetic_tiktok.py`): never run it on a real one, since the screenshots
show example rows.

```sh
python3 tests/a11y/gen_synthetic_tiktok.py /tmp/synthetic_tiktok.json
(cd packages/data-collector && VITE_WORKER=tiktok VITE_DEMO_HOST=1 npx vite build)
python3 -m http.server 4173 -d packages/data-collector/dist &
node tests/a11y/audit.cjs 'http://localhost:4173/?latency=10' /tmp/synthetic_tiktok.json /tmp/a11y-out
```

Results on 2026-10-05: before this work, 6 kinds of axe violation (critical: unlabelled checkboxes;
serious: colour contrast on every screen) and no way to start the flow with a keyboard (Feldspar's
buttons weren't focusable). After: no violations on any screen, either width or theme, and every
keyboard step passes.
