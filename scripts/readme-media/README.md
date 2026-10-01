# README media

Regenerates the screenshots and hero GIFs in `docs/media/` from the real
frontend running in headless Chromium, with the Tauri backend mocked
(`mock.ts`) and fictional documents (`docs.ts`). Nothing here ships with the app.

Requirements: the npm dependencies (`puppeteer-core` is already a dev
dependency), a Chromium binary (default
`~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, override with
`CHROME=`), `ffmpeg` and `pngquant`.

```bash
npx vite --port 5302 --strictPort &              # dev server (any free port; set BASE_URL if not 5302)
node scripts/readme-media/capture.mjs            # all: en + es, screenshots + GIF frames
node scripts/readme-media/capture.mjs es shots   # one language / one kind (shots|gif)
scripts/readme-media/build.sh                    # downscale + pngquant, assemble hero-<lang>.gif
```

- `app.html?lang=en|es[&docs=0][&active=<file name>]` loads the app with the mock.
- Raw GIF frames go to `scripts/readme-media/out/` (ignored by git).
