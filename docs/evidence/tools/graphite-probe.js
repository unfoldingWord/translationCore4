// Graphite shaping probe — the exact script behind
// docs/evidence/graphite-shaping-packaged-2026-08-14.md.
//
// LAUNCH PROCEDURE (packaged artifact, macOS):
//   1. Build the artifact: zsh scripts/package-desktop.zsh
//      (output: an app dir with start-tc4.command, Electron.app = the
//      Electronite v37.1.0-graphite binary, and electron/electronStartup.js).
//   2. Launch it with a fresh HOME and a CDP port. From the app dir:
//        HOME=$(mktemp -d) ./Electron.app/Contents/MacOS/Electron ./electron \
//          --remote-debugging-port=9223
//      This is the shipped launch path (start-tc4.command ends in the same
//      exec) plus ONLY the debug-port flag. The app self-spawns its bundled
//      server (electronStartup.js scans free ports from 19119) and loads
//      /clients/uw-tc4.
//   3. Run the probe against the open page:
//        node graphite-probe.js 9223 out.png
//      It injects the platform's /api/webfonts Awami Nastaliq CSS
//      (a Graphite-ONLY font) plus an Urdu probe line and an Arial reference,
//      waits for the font to load, prints canvas measureText widths and
//      bounding-box ascent/descent as JSON, and screenshots the probe block.
//   4. Negative control: run the IDENTICAL probe against a plain Chromium
//      (no Graphite) pointed at the SAME running server, passing the server
//      origin as the third argument if the CSS must be fetched cross-page:
//        node graphite-probe.js <chromiumCdpPort> negative.png http://127.0.0.1:19119
//      Shaped (Graphite) vs unshaped renderings differ ~2x in width.
//
// puppeteer-core must be resolvable from the working directory
// (npm install puppeteer-core). No probe code ships in the client:
// the injection is CDP-only, into the running page.
//
// Usage: node graphite-probe.js <cdpPort> <outPng> [serverOrigin]
const puppeteer = require('puppeteer-core');

const [, , port, outPng, origin] = process.argv;

(async () => {
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().startsWith('http')) || pages[0];
  console.log('page URL:', page.url());

  const result = await page.evaluate(async (origin) => {
    const base = origin || '';
    // Load the platform's Awami Nastaliq CSS if not already present.
    if (!document.getElementById('graphite-probe-css')) {
      const link = document.createElement('link');
      link.id = 'graphite-probe-css';
      link.rel = 'stylesheet';
      link.href = base + '/api/webfonts/pankosmia-Awami_Nastaliq.css';
      document.head.appendChild(link);
      await new Promise((res, rej) => { link.onload = res; link.onerror = () => rej(new Error('css load failed')); });
    }
    // Probe block.
    let el = document.getElementById('graphite-probe');
    if (!el) {
      el = document.createElement('div');
      el.id = 'graphite-probe';
      el.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:#fff;color:#000;padding:16px;direction:rtl;text-align:right;border:2px solid #000;';
      el.innerHTML =
        '<div id="gp-awami" style="font-family:\'Pankosmia-Awami Nastaliq\';font-size:48px;line-height:2.4;">نستعلیق تحریر خوش آمدید</div>' +
        '<div id="gp-fallback" style="font-family:Arial;font-size:48px;line-height:2.4;">نستعلیق تحریر خوش آمدید</div>';
      document.body.appendChild(el);
    }
    await document.fonts.load("48px 'Pankosmia-Awami Nastaliq'", 'نستعلیق');
    await document.fonts.ready;
    const loaded = document.fonts.check("48px 'Pankosmia-Awami Nastaliq'", 'نستعلیق');
    const text = 'نستعلیق تحریر خوش آمدید';
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = "48px 'Pankosmia-Awami Nastaliq'";
    const mAwami = ctx.measureText(text);
    ctx.font = '48px Arial';
    const mArial = ctx.measureText(text);
    const r = document.getElementById('graphite-probe').getBoundingClientRect();
    return {
      userAgent: navigator.userAgent,
      fontLoaded: loaded,
      awami: { width: mAwami.width,
               ascent: mAwami.actualBoundingBoxAscent, descent: mAwami.actualBoundingBoxDescent },
      arial: { width: mArial.width,
               ascent: mArial.actualBoundingBoxAscent, descent: mArial.actualBoundingBoxDescent },
      box: { x: r.x, y: r.y, w: r.width, h: r.height },
    };
  }, origin || null);

  console.log(JSON.stringify(result, null, 2));
  await page.screenshot({
    path: outPng,
    clip: { x: result.box.x, y: result.box.y, width: Math.min(result.box.w, 1200), height: Math.min(result.box.h, 400) },
  });
  console.log('screenshot:', outPng);
  await browser.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
