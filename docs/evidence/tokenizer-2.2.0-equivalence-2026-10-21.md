# string-punctuation-tokenizer 2.0.0 and 2.2.0 give the same output to tC4 (2026-10-21)

**Claim.** For each call form that tC4 and its packages use, `string-punctuation-tokenizer`
2.2.0 (MIT) gives the same output as 2.0.0 (GPL-2.0). This supports D111 point 3.

**Result** [VERIFIED — 2026-10-21, on branch `license-mit` from `main` b86270f]:

| Corpus | Files | Lines | Differences (each tC4 call form) | Control (`greedy: true`) |
|---|---|---|---|---|
| `test/fixtures` and `conformance/` | 44 | 12,102 | 0 | 3,896 |
| The USFM in the rig's `resources-cache`: en_ult v89 and v91, en_ust v89 and v91, es-419_glt v42, es-419_gst v40, el-x-koine_ugnt v0.34, hbo_uhb v2.1.30, v2.1.32 and v3.0.0 | 491 | 248,773 | 0 | 92 |

These are the call forms in the code:
- `tokenize({ text })`: `src/data/selections.ts`, `src/data/derive.ts`, word-aligner `verseObjects.js:698`.
- `tokenize({ text, includePunctuation: true })`: `src/data/align/verseWords.mjs`, word-aligner `verseObjects.js:228`, wordmap-lexer `Lexer.js:60`.
- The verbose form in `src/data/align/tokenize.ts`.
- `word.test` and `number.test` on each token.
- `occurrencesInString` and `occurrenceInString`.

No caller passes `greedy`, `normalize` or `parsers`. Between the two versions, the only
changed rule is in greedy mode: a trailing `’` joins the word. The control shows that the
script finds that change.

**Method.**
1. Install the two versions side by side in an empty folder:
   `npm i old@npm:string-punctuation-tokenizer@2.0.0 new@npm:string-punctuation-tokenizer@2.2.0`.
2. Run `node cmp.cjs <folder>...`. The script reads each `.usfm`, `.sfm` and `.tsv` file,
   removes the USFM markers and the word attributes, and compares the JSON output of the
   two versions for each line.

```js
const fs=require('fs'),path=require('path');
const O=require('old'),N=require('new');
const roots=process.argv.slice(2);const files=[];
const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()){if(e.name!=='node_modules'&&e.name!=='.git')walk(p)}else if(/\.(usfm|sfm|tsv)$/i.test(e.name))files.push(p)}};
roots.forEach(r=>fs.existsSync(r)&&walk(r));
const lines=new Set();
for(const f of files){for(const l of fs.readFileSync(f,'utf8').split(/\r?\n/)){const t=l.replace(/\\[a-z0-9-]+\*?/gi,' ').replace(/\|[^\\]*?(?=\\|$)/g,' ').trim();if(t)lines.add(t)}}
const extra=["‘Hello,’ he said. The disciples’ boats","don’t 2nd 1,000.00 it's a—b","וַֽ⁠יְהִי֙ καὶ μὴ","Jesus’"];extra.forEach(x=>lines.add(x));
const pats={
 plain:(T,t)=>T.tokenize({text:t}),
 punct:(T,t)=>T.tokenize({text:t,includePunctuation:true}),
 verbose:(T,t)=>T.tokenize({text:t,includeWords:true,includeNumbers:true,includePunctuation:true,includeWhitespace:true,verbose:true}),
 wordtest:(T,t)=>T.tokenize({text:t,includePunctuation:true}).map(x=>[T.word.test(x),T.number.test(x)]),
 occs:(T,t)=>T.tokenize({text:t}).map(w=>T.occurrencesInString(t,w)),
 occ:(T,t)=>T.tokenize({text:t}).map((w,i)=>T.occurrenceInString(t,i,w)),
 CONTROL_greedy:(T,t)=>T.tokenize({text:t,greedy:true}),
};
let n=0;const diff={};for(const k in pats)diff[k]=0;let sample={};
for(const t of lines){n++;for(const [k,f] of Object.entries(pats)){const a=JSON.stringify(f(O,t)),b=JSON.stringify(f(N,t));if(a!==b){diff[k]++;sample[k]=sample[k]||[t.slice(0,80),a.slice(0,160),b.slice(0,160)]}}}
console.log('files',files.length,'lines',n);console.log(diff);console.log(sample);
```
