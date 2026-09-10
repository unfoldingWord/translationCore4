const [base, repo, abbr, marker, mode] = process.argv.slice(2);
const enc = (r) => r.split("/").map(encodeURIComponent).join("/");
const url = (route) => base + route;
const fail = (step, seen) => { console.log("FAIL " + step + ": " + seen); process.exit(1); };
const ok = (step, seen) => console.log("ok " + step + ": " + seen);
// A POST answer must be the success shape the client enforces (src/data/serverApi.ts
// post(): HTTP ok AND a JSON body with is_good true); anything else is a failure there
// and here. A GET returns the raw text; only its status is checked.
async function post(route, body) {
  const r = await fetch(url(route), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(route + " -> " + r.status + " " + t.slice(0, 200));
  let j;
  try { j = JSON.parse(t); } catch { throw new Error(route + " -> unparseable POST response body: " + t.slice(0, 200)); }
  if (!j || typeof j !== "object" || j.is_good !== true) throw new Error(route + " -> is_good is not true: " + (j && j.reason ? j.reason : t.slice(0, 200)));
  return t;
}
async function getText(route) {
  const r = await fetch(url(route));
  const t = await r.text();
  if (!r.ok) throw new Error(route + " -> " + r.status + " " + t.slice(0, 200));
  return t;
}
// The text of TIT 1:1: what follows the first "\\v 1 " up to the end of its line.
function verse11(usfm) {
  const at = usfm.indexOf("\\v 1 ");
  if (at < 0) return null;
  const eol = usfm.indexOf("\n", at);
  return usfm.slice(at + 5, eol < 0 ? usfm.length : eol);
}
(async () => {
  const ipath = "TIT.usfm"; // ingredient-relative, as /burrito/paths lists them
  const rawRoute = "/api/burrito/ingredient/raw/" + enc(repo) + "?ipath=" + encodeURIComponent(ipath);
  if (mode === "source") {
    const srcRoute = "/api/burrito/ingredient/raw/_local_/_sideloaded_/unfoldingword--en_ult?ipath=TIT.usfm";
    const usfm = await getText(srcRoute).catch((e) => fail("source", e.message));
    const v = verse11(usfm);
    if (!v) fail("source", "no text for TIT 1:1 in " + srcRoute);
    ok("source", "en_ult TIT 1:1 = \"" + v + "\"");
  } else if (mode === "create") {
    const before = JSON.parse(await getText("/api/git/list-local-repos"));
    if (before.includes(repo)) fail("create", repo + " already exists");
    await post("/api/git/new-text-translation", {
      content_name: "tC4 smoke test", content_abbr: abbr, content_language_code: "fr",
      content_language_name: null, add_book: true, book_code: "TIT", book_title: "Tite",
      book_abbr: "TIT", add_cv: true, versification: "eng", branch_name: null,
    }).catch((e) => fail("create", e.message));
    const after = JSON.parse(await getText("/api/git/list-local-repos"));
    if (!after.includes(repo)) fail("create", repo + " missing from /git/list-local-repos: " + JSON.stringify(after));
    ok("create", repo + " listed by /git/list-local-repos");
    const usfm = await getText(rawRoute).catch((e) => fail("read book", e.message));
    const at = usfm.indexOf("\\v 1 ");
    if (at < 0) fail("read book", "no \\v 1 in TIT.usfm (" + usfm.length + " bytes)");
    const eol = usfm.indexOf("\n", at);
    const end = eol < 0 ? usfm.length : eol;
    const edited = usfm.slice(0, at) + "\\v 1 " + marker + usfm.slice(end);
    await post("/api/burrito/ingredient/raw/" + enc(repo) + "?ipath=" + encodeURIComponent(ipath), { payload: edited })
      .catch((e) => fail("write verse", e.message));
    const back = verse11(await getText(rawRoute));
    if (back !== marker) fail("write verse", "TIT 1:1 read back as " + JSON.stringify(back) + ", expected " + JSON.stringify(marker));
    ok("write verse", "TIT 1:1 = \"" + marker + "\"");
  } else if (mode === "readback") {
    const v = verse11(await getText(rawRoute).catch((e) => fail("read back", e.message)));
    if (v !== marker) fail("read back", "TIT 1:1 is " + JSON.stringify(v) + " after the restart, expected " + JSON.stringify(marker));
    ok("read back", "TIT 1:1 still \"" + marker + "\" after the restart");
  } else if (mode === "delete") {
    await post("/api/git/delete/" + enc(repo), {}).catch((e) => fail("delete", e.message));
    const after = JSON.parse(await getText("/api/git/list-local-repos"));
    if (after.includes(repo)) fail("delete", repo + " still listed");
    ok("delete", repo + " removed");
  }
})().catch((e) => fail(mode, e.message));
