#!/usr/bin/env node
// Localise react-grab-annotate's dev overlay to English and stop it phoning home.
//
// The package (0.1.x) ships its UI strings hard-coded and \u-escaped in
// node_modules/react-grab-annotate/dist/core-*.js. There is no locale option and
// no public source repo to patch upstream, so `npm run dev:annotate` runs this
// first. It is idempotent and re-applies itself after any npm install, which is
// why it is a script rather than a committed patch file.
//
// It also disables the overlay's version ping to www.react-grab.com, which the
// package fires on every mount. The ping sends no page data — it compares
// versions and logs a console warning — but a dev tool in this repo makes no
// outbound calls.
//
// It touches node_modules only — nothing here reaches src/ or dist/.
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'node_modules/react-grab-annotate/dist';

// Applied longest source string first (sorted below), so that e.g. 保存中…
// wins over 保存 and 条标注信息保存到 over 条标注.
const STRINGS = [
  ['条标注信息保存到', 'annotation(s) to'],
  ['条标注，提示语已复制到剪贴板', 'annotation(s) — prompt copied to clipboard'],
  ['，你读完之后进行项目修改。', '. Read them, then update the project.'],
  ['描述要修改的内容…', 'Describe the change…'],
  ['提交并复制提示语', 'Submit and copy prompt'],
  ['进入标注模式', 'Enter annotation mode'],
  ['退出标注模式', 'Exit annotation mode'],
  ['未知位置', 'Unknown location'],
  ['保存中…', 'Saving…'],
  ['已保存', 'Saved'],
  ['我把', 'I saved'],
  ['保存', 'Save'],
  ['取消', 'Cancel'],
  ['删除', 'Delete'],
  ['标注', 'Annotate'],
  // annotations.md (server.js)
  ['每条包含:组件名与源码位置(', 'Each entry gives the component name and source location ('],
  ['）、DOM 选择器、页面 URL、截图(就是用户选中的那块内容)，以及用户的修改说明(评论)。', '), the DOM selector, the page URL, a screenshot of the selected region, and the requested change.'],
  [')、DOM 选择器、页面 URL、截图(就是用户选中的那块内容)，以及用户的修改说明(评论)。', '), the DOM selector, the page URL, a screenshot of the selected region, and the requested change.'],
  ['请据此定位对应组件并按评论修改项目代码;截图用于确认你找到的正是用户圈中的元素。', 'Use it to find the component and make the change the comment asks for. The screenshot confirms the element.'],
  ['条标注。每条对应用户在运行中的页面上**选中的一个 UI 元素/区域**——也就是用户希望你改动的地方。', 'annotation(s). Each one is a UI element or region the user selected on the running page — the place to change.'],
  ['（组件声明处，非元素精确行——在此文件内查找该元素）', ' (component declaration, not the exact element line — find the element in this file)'],
  ['（组件声明处，非元素精确行）', ' (component declaration, not the exact element line)'],
  ['个元素（同级，逐个处理）:', 'elements (siblings — handle each):'],
  ['- 截图（用户选中的部分）:', '- Screenshot (selected region):'],
  ['- 组件链（从内到外）:', '- Component chain (innermost first):'],
  ['- 源码位置:', '- Source:'],
  ['- 选择器:', '- Selector:'],
  ['**评论:**', '**Comment:**'],
  ['- 框选包含', '- Box selection covers'],
  ['(位置未知)', '(location unknown)'],
  ['# 标注', '# Annotations'],
  ['- 页面:', '- Page:'],
  ['(未知)', '(unknown)'],
  ['元素', 'element'],
  ['(空)', '(empty)'],
  ['共', ''],
];

const ORDERED = [...STRINGS].sort((a, b) => b[0].length - a[0].length);

const CJK = /[\u2010-\u303F\u3400-\u9FFF\uFF00-\uFFEF]/;
const HAN = /[\u3400-\u9FFF]/;

// Decode escapes for CJK text and the punctuation mixed into it. U+2028/U+2029
// stay escaped: they are line terminators, and a JS source file needs them so.
const decodeCjkEscapes = (src) =>
  src.replace(/\\u([0-9a-fA-F]{4})/g, (whole, hex) => {
    const ch = String.fromCharCode(parseInt(hex, 16));
    if (ch === '\u2028' || ch === '\u2029') return whole;
    return CJK.test(ch) ? ch : whole;
  });

const files = (await readdir(DIST)).filter(
  (f) => (f.startsWith('core-') || f === 'server.js') && f.endsWith('.js')
);
if (files.length === 0) {
  console.error(`[annotate-i18n] nothing to patch in ${DIST} — is react-grab-annotate installed?`);
  process.exit(1);
}

const PING_URL = 'https://www.react-grab.com/api/version';
const PING_ANCHOR = `fetch(\`${PING_URL}`;
const PING_OFF = `false && fetch(\`${PING_URL}`;

// The call sits at the end of an `a && b && fetch(url).then(...)` chain, so a
// leading `false &&` short-circuits the whole term — .then() is never reached.
const disableVersionPing = (src, file) => {
  if (src.includes(PING_OFF)) return src;
  if (!src.includes(PING_ANCHOR)) return src;
  console.log(`[annotate-i18n] disabled the version ping in ${file}`);
  return src.split(PING_ANCHOR).join(PING_OFF);
};

let touched = 0;
for (const file of files) {
  const path = join(DIST, file);
  const original = await readFile(path, 'utf8');
  let out = decodeCjkEscapes(original);
  if (HAN.test(out)) {
    for (const [zh, en] of ORDERED) out = out.split(zh).join(en);
  }

  out = disableVersionPing(out, file);

  const leftover = [...new Set(out.match(/[㐀-鿿][‐-〿㐀-鿿＀-￯]*/g) ?? [])];
  if (leftover.length > 0) {
    console.error(`[annotate-i18n] ${file}: untranslated strings — add them to STRINGS:`);
    for (const s of leftover) console.error(`    ${s}`);
    process.exit(1);
  }
  if (out === original) continue;
  await writeFile(path, out, 'utf8');
  touched += 1;
  console.log(`[annotate-i18n] patched ${path}`);
}
if (touched === 0) {
  console.log('[annotate-i18n] already patched');
} else {
  // Vite pre-bundles the package into node_modules/.vite/deps and only
  // re-optimizes when the lockfile changes, never when node_modules content
  // does — so a patched file would otherwise stay invisible to the browser.
  await rm('node_modules/.vite', { recursive: true, force: true });
  console.log('[annotate-i18n] cleared node_modules/.vite so Vite re-optimizes');
}
