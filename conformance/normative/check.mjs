#!/usr/bin/env node
// The normative coverage gate (D55). Exit 0 only when BURRITO-SPEC §8 and the
// journal suite agree COMPLETELY:
//
//   1. Every [R-x.y.z] rule id authored in §8 is claimed by a LIVE check —
//      a `[covers R-…]` tag inside the name string of a check(...)/prop(...)
//      call in executable (non-comment) suite code.
//   2. Every claim names a rule that exists in §8 today.
//   3. No rule id is defined twice in the spec.
//
// There is no registry file and no extractor: the spec's authored ids ARE the
// registry, and rewording a rule is visible in the spec diff itself. There is
// no floor and no waiver: the D55 bar is full coverage, so any uncovered rule
// is a failure — this gate never prints success for partial agreement.
//
// Honest limits (do not trust this further than it deserves): the gate proves
// a claim exists and is live. It does NOT prove the check fails when its rule
// is violated — that is per-statement mutation hardening (D51's standing
// condition). And a tag in a live non-check string would still count; the
// comment-stripper closes the commented-out case, not every adversarial one.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SPEC = path.resolve(ROOT, 'docs/BURRITO-SPEC.md');
const SUITE_DIR = path.resolve(HERE, '..');

const fail = [];

// ---- 1. rule ids from the spec ---------------------------------------------
const specLines = fs.readFileSync(SPEC, 'utf8').split('\n');
const s8start = specLines.findIndex((l) => /^## 8\./.test(l));
let s8end = specLines.findIndex((l, i) => i > s8start && /^## 9\./.test(l));
if (s8start < 0 || s8end < 0) { console.error('FATAL: cannot locate section 8 in ' + SPEC); process.exit(2); }

const ruleLine = new Map();               // id -> first spec line
const ID_RE = /\[R-(8(?:\.\d+)*\.\d+)\]/g;
for (let i = s8start; i < s8end; i++) {
  let m;
  while ((m = ID_RE.exec(specLines[i])) !== null) {
    const id = 'R-' + m[1];
    if (ruleLine.has(id)) fail.push('DUPLICATE RULE ID: ' + id + ' defined at spec lines ' + ruleLine.get(id) + ' and ' + (i + 1));
    else ruleLine.set(id, i + 1);
  }
}
if (ruleLine.size === 0) fail.push('NO RULE IDS: section 8 defines no [R-…] ids — wrong spec revision?');

// ---- 2. live claims from the suite -----------------------------------------
// Strip comments so a commented-out check loses its claim. String-aware so a
// "//" inside a string literal does not truncate real code.
const stripComments = (src) => {
  let out = '', i = 0, mode = 'code', q = '';
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { mode = 'block'; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { mode = 'str'; q = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i++; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; i += 2; } else i++; continue; }
    // string mode
    if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
    if (c === q) { mode = 'code'; }
    out += c; i++;
  }
  return out;
};

// A claim counts only inside the FIRST string argument of check(/prop( in live code.
const claims = new Map();                 // id -> [{file, checkHead}]
const suiteFiles = fs.readdirSync(SUITE_DIR).filter((f) => f.endsWith('.mjs')).map((f) => path.join(SUITE_DIR, f));
const CALL_RE = /\b(?:check|prop)\s*\(\s*(['"`])/g;
for (const file of suiteFiles) {
  const live = stripComments(fs.readFileSync(file, 'utf8'));
  let m;
  while ((m = CALL_RE.exec(live)) !== null) {
    const q = m[1];
    let j = m.index + m[0].length, name = '';
    while (j < live.length) {
      const c = live[j];
      if (c === '\\') { name += live[j + 1] ?? ''; j += 2; continue; }
      if (c === q) break;
      name += c; j++;
    }
    let t;
    const TAG_RE = /\[covers ([^\]]+)\]/g;
    while ((t = TAG_RE.exec(name)) !== null) {
      for (const raw of t[1].split(/[,\s]+/)) {
        const id = raw.trim();
        if (!id) continue;
        if (!claims.has(id)) claims.set(id, []);
        claims.get(id).push({ file: path.basename(file), checkHead: name.slice(0, 60) });
      }
    }
  }
}

// ---- 3. compare -------------------------------------------------------------
for (const [id, where] of claims) {
  if (!ruleLine.has(id)) fail.push('STALE CLAIM: ' + where[0].file + ' check "' + where[0].checkHead + '…" covers ' + id + ', which is not a rule in section 8 (reworded or removed?)');
}
const uncovered = [...ruleLine.keys()].filter((id) => !claims.has(id));
for (const id of uncovered) fail.push('UNCOVERED RULE: ' + id + ' (spec line ' + ruleLine.get(id) + ') has no live check claiming it');

console.log('rules in section 8 : ' + ruleLine.size);
console.log('claimed by a check : ' + (ruleLine.size - uncovered.length));
console.log('uncovered          : ' + uncovered.length);
console.log('stale claims       : ' + [...claims.keys()].filter((id) => !ruleLine.has(id)).length);

if (fail.length) {
  console.log('');
  for (const f of fail) console.log('FAIL  ' + f);
  console.log('\n' + fail.length + ' problem(s). The specification and the suite do NOT agree.');
  process.exit(1);
}
console.log('\nOK — every rule id in section 8 is claimed by a live check, and every claim resolves.');
