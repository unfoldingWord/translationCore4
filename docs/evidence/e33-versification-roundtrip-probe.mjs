// e33-versification-roundtrip-probe.mjs — evidence for epic #33 (issues #15/#16).
//
// Measures how many verses do NOT survive the round trip
//   project scheme -> org -> project scheme
// through Proskomma's versification functions, per bundled scheme, inside the
// 66-book canon (D26 limits tC4 to that canon).
//
// Run:
//   npm i --no-save proskomma-core@0.11.3
//   node docs/evidence/e33-versification-roundtrip-probe.mjs
//
// Scheme data: the platform's own bundled schemes in dev-env (the same files
// POST /git/new-text-translation copies into each project's ingredients/vrs.json).
//
// NOTE the `arrayify` step. The platform writes `mappedVerses` values as STRINGS.
// Proskomma's `reverseVersification` iterates the value, so an unconverted string
// is iterated CHARACTER BY CHARACTER and returns a silently corrupt table keyed
// "0","1","2",... — no exception. Every caller must normalize first.

import pkg from 'proskomma-core';
import fs from 'fs';
const V = pkg.utils.versification;
const DIR=process.env.VRS_DIR ?? '../../../dev-env/app-resources/templates/content_templates/vrs/';
const load = n => JSON.parse(fs.readFileSync(DIR+n+'.json','utf8'));
const arrayify = mv => Object.fromEntries(Object.entries(mv).map(([k,v]) => [k, Array.isArray(v)?v:[v]]));
const fwd = n => V.succinctifyVerseMappings(load(n).mappedVerses);
const rev = n => V.succinctifyVerseMappings(V.reverseVersification({mappedVerses:arrayify(load(n).mappedVerses)}).reverseMappedVerses);
const apply=(s,b,c,v)=>{const sc=s[b]?.[String(c)];return sc?V.mapVerse(sc,b,c,v):[b,[[c,v]]];};
const CANON='GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(' ');
const schemes=['eng','lxx','rsc','rso','vul'];
for (const s of schemes) {
  const F=fwd(s), R=rev(s), mv=load(s).maxVerses;
  let n=0, bad=[], books=new Set();
  for (const b of CANON) {
    const chs=mv[b]; if(!chs) continue;
    chs.forEach((last,i)=>{const c=i+1;
      for(let v=1;v<=Number(last);v++){
        const [ob,ocv]=apply(F,b,c,v); const [oc,ov]=ocv[0];
        const [rb,rcv]=apply(R,ob,oc,ov); const [rc,rv]=rcv[0];
        n++; if(!(rb===b&&rc===c&&rv===v)){bad.push(`${b} ${c}:${v} -> org ${ob} ${oc}:${ov} -> ${rb} ${rc}:${rv}`);books.add(b);}
      }});
  }
  console.log(`${s}: ${bad.length}/${n} non-round-tripping in the 66-book canon; books: ${[...books].join(',')||'none'}`);
  bad.slice(0,6).forEach(x=>console.log('    '+x));
}
