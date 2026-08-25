// e33-helps-frame-mapping-probe.mjs — evidence for epic #33, issue #15.
//
// The uW helps TSVs are in the ENG frame, not org (proof: en_tn@v86/JON.tsv and
// en_tw@v87/JON.tsv both carry JON 1:17 and JON 2:1-2:10; eng JON = 17,10,10,11
// while org JON = 16,11,10,11). No resource metadata.json declares a frame.
//
// This probe measures the mapping tC4 actually needs at derive time:
//     eng (helps source frame) -> org -> X (project scheme)
// and counts the two failure modes that matter, because the mapped reference is
// the §5.2 identity key AND the §8.5 journal register key (written once, never
// re-derived):
//   * identity collisions — two distinct helps rows land on ONE project-frame
//     reference, so two distinct checks would share one identity key;
//   * out-of-range results — the mapped reference does not exist in the project's
//     scheme (including verse 0, which the mapVerse arithmetic can produce).
//
// Run:
//   npm i --no-save proskomma-core@0.11.3
//   node docs/evidence/e33-helps-frame-mapping-probe.mjs

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
const engF = fwd('eng'), engMax = load('eng').maxVerses;
console.log('helps source frame = eng -> project scheme X (66-book canon)\n');
for (const X of ['eng','lxx','rsc','rso','vul']) {
  const XR = rev(X), XMax = load(X).maxVerses;
  const seen = new Map(); let n=0, collisions=[], outOfRange=[];
  for (const b of CANON) {
    const chs = engMax[b]; if(!chs) continue;
    chs.forEach((last,i)=>{ const c=i+1;
      for(let v=1;v<=Number(last);v++){
        n++;
        const [ob,ocv]=apply(engF,b,c,v); const [oc,ov]=ocv[0];
        const [xb,xcv]=apply(XR,ob,oc,ov); const [xc,xv]=xcv[0];
        const key=`${xb} ${xc}:${xv}`;
        if (seen.has(key)) collisions.push(`${seen.get(key)} and ${b} ${c}:${v} both -> ${X} ${key}`);
        else seen.set(key, `${b} ${c}:${v}`);
        const maxc = XMax[xb]?.[xc-1];
        if (maxc === undefined || xv > Number(maxc) || xv < 1) outOfRange.push(`eng ${b} ${c}:${v} -> ${X} ${key} (scheme max ${maxc ?? 'no chapter'})`);
      }});
  }
  console.log(`${X}: ${n} eng refs | ${collisions.length} identity collisions | ${outOfRange.length} land outside the ${X} scheme`);
  collisions.slice(0,4).forEach(x=>console.log('   collide: '+x));
  outOfRange.slice(0,4).forEach(x=>console.log('   range:   '+x));
}
