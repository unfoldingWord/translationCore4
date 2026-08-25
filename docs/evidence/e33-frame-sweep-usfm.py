import os
import json, io, zipfile, urllib.request, re
VRS=os.environ.get('VRS_DIR','../../../dev-env/app-resources/templates/content_templates/vrs/')
S={n:json.load(open(VRS+n+'.json'))['maxVerses'] for n in ['eng','org','rsc','rso','vul','lxx']}
for o,r,t in [("ru_gl","ru_rsob","v14.0"),("BSA","ru_rsb","v1.0.0"),("ru_gl","ru_rlob","v13.0"),("Door43-Catalog","ru_ulb","v1.1")]:
    try: data=urllib.request.urlopen(f"https://git.door43.org/{o}/{r}/archive/{t}.zip",timeout=120).read()
    except Exception as e: print(f"{o}/{r}: {e}"); continue
    z=zipfile.ZipFile(io.BytesIO(data)); usfm=[n for n in z.namelist() if n.lower().endswith('.usfm')]
    bad={s:0 for s in S}; tot=0; psa3=None; jon1=None
    for n in usfm:
        m=re.search(r'([A-Z0-9]{3})\.usfm$',n,re.I)
        if not m: continue
        bk=m.group(1).upper(); ch=0; seen={}
        for line in z.read(n).decode('utf-8','replace').splitlines():
            if line.startswith('\\c '):
                try: ch=int(line.split()[1])
                except: pass
            elif line.startswith('\\v ') and ch:
                mm=re.match(r'\\v (\d+)',line)
                if mm: seen[ch]=max(seen.get(ch,0),int(mm.group(1)))
        if bk=='PSA': psa3=seen.get(3)
        if bk=='JON': jon1=seen.get(1)
        for c,v in seen.items():
            if bk not in S['eng']: continue
            tot+=1
            for s in S:
                chs=S[s].get(bk)
                if not (chs and 1<=c<=len(chs) and v<=int(chs[c-1])): bad[s]+=1
    print(f"{o}/{r}@{t}: {len(usfm)} usfm, {tot} chapters | exceeds: " + "  ".join(f"{s}={bad[s]}" for s in ['eng','org','rsc','rso','vul','lxx']))
    print(f"    PSA 3 last verse={psa3} (eng=8 org/rsc=9)   JON 1 last verse={jon1} (eng=17 others=16)")
