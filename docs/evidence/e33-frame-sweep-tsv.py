import os
import json, io, zipfile, urllib.request, re, sys
VRS=os.environ.get('VRS_DIR','../../../dev-env/app-resources/templates/content_templates/vrs/')
S={n:json.load(open(VRS+n+'.json'))['maxVerses'] for n in ['eng','org','rsc','rso','vul','lxx']}
def exists(sch,b,c,v):
    chs=S[sch].get(b)
    if not chs or c<1 or c>len(chs): return False
    return 1<=v<=int(chs[c-1])
REPOS=[("ru_gl","ru_tn","v60.1"),("es-419_gl","es-419_tn","v66"),("unfoldingWord","en_tn","v90"),
       ("translationCore-Create-BCS","hi_tn","v9"),("BSOJ","ar_tn","v6.1")]
for o,r,t in REPOS:
    url=f"https://git.door43.org/{o}/{r}/archive/{t}.zip"
    try: data=urllib.request.urlopen(url,timeout=90).read()
    except Exception as e: print(f"{o}/{r}@{t}: download failed {e}"); continue
    z=zipfile.ZipFile(io.BytesIO(data))
    names=[n for n in z.namelist() if re.search(r'tn_[A-Z0-9]{3}\.tsv$',n)]
    tot=0; notin={s:0 for s in S}; ex=[]
    for n in names:
        bk=re.search(r'tn_([A-Z0-9]{3})\.tsv$',n).group(1)
        for line in z.read(n).decode('utf-8','replace').splitlines()[1:]:
            ref=line.split('\t')[0].strip()
            m=re.match(r'^(\d+):(\d+)(?:-(\d+))?$',ref)
            if not m: continue
            c=int(m.group(1)); vs=[int(m.group(2))]+([int(m.group(3))] if m.group(3) else [])
            for v in vs:
                tot+=1
                for s in S:
                    if not exists(s,bk,c,v):
                        notin[s]+=1
                        if s=='eng' and len(ex)<8: ex.append(f"{bk} {c}:{v}")
    print(f"{o}/{r}@{t}: {len(names)} books, {tot} verse refs")
    print("   refs impossible in each frame: " + "  ".join(f"{s}={notin[s]}" for s in ['eng','org','rsc','rso','vul','lxx']))
    if ex: print("   eng-impossible examples:", ", ".join(ex))
