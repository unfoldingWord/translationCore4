const [base, repo, abbr, marker, mode, storeDir] = process.argv.slice(2);
const fs = require("node:fs");
const path = require("node:path");
const { verifyBurritoZip } = require("./smoke-export.cjs");
const enc = (r) => r.split("/").map(encodeURIComponent).join("/");
const url = (route) => base + route;
const obsRepo = `${repo}obs`;
const obsAbbr = `${abbr}obs`;
const localStore = storeDir || process.env.TC4_SMOKE_STORE;
const fail = (step, seen) => {
  console.log("FAIL " + step + ": " + String(seen).replace(/[\r\n\u0085\u2028\u2029]+/g, " "));
  process.exit(1);
};
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
async function getBytes(route, expectedStatus) {
  const r = await fetch(url(route));
  if (expectedStatus !== undefined && r.status !== expectedStatus) {
    throw new Error(route + " -> expected HTTP " + expectedStatus + ", got " + r.status + " " + (await r.text()).slice(0, 200));
  }
  if (!r.ok) throw new Error(route + " -> " + r.status + " " + (await r.text()).slice(0, 200));
  return new Uint8Array(await r.arrayBuffer());
}
function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("not a JPEG");
  let at = 2;
  while (at + 8 < bytes.length) {
    if (bytes[at] !== 0xff) { at += 1; continue; }
    const marker = bytes[at + 1];
    at += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = (bytes[at] << 8) | bytes[at + 1];
    if (length < 2 || at + length > bytes.length) throw new Error("invalid JPEG segment");
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { height: (bytes[at + 3] << 8) | bytes[at + 4], width: (bytes[at + 5] << 8) | bytes[at + 6] };
    }
    at += length;
  }
  throw new Error("JPEG has no size marker");
}
// The text of TIT 1:1: what follows the first "\\v 1 " up to the end of its line.
function verse11(usfm) {
  const at = usfm.indexOf("\\v 1 ");
  if (at < 0) return null;
  const eol = usfm.indexOf("\n", at);
  return usfm.slice(at + 5, eol < 0 ? usfm.length : eol);
}
function storyPath(number) {
  return `content/${String(number).padStart(2, '0')}.md`;
}
function storyRoute(project, number) {
  return "/api/burrito/ingredient/raw/" + enc(project) + "?ipath=" + encodeURIComponent(storyPath(number));
}
function localRepoDir(project) {
  if (!localStore) return null;
  return path.join(localStore, ...project.split("/"));
}
function obsTemplate(number) {
  return fs.readFileSync(path.join(__dirname, "lib", "templates", "content_templates", "text_stories", "ingredients", storyPath(number)), "utf8");
}
function seedStory(template, number) {
  const lines = template.split("\n");
  lines[0] = `# ${number}.`;
  return lines.join("\n");
}
function editFirstFrame(seed, text) {
  const lines = seed.split("\n");
  const imageLine = /^!\[[^\]]*\]\([^)]*\)$/;
  const images = lines.flatMap((line, index) => imageLine.test(line) ? [index] : []);
  if (images.length < 2) throw new Error("OBS story has no second frame");
  // Frame 1 is the region after image 1 and before image 2. Preserve the
  // title, image 1, image 2, and every later byte exactly as JournalingStore
  // does; only the frame paragraph is replaced.
  return [...lines.slice(0, images[0] + 1), "", text, "", ...lines.slice(images[1])].join("\n");
}
function firstFrameOutsideViolation(before, after) {
  const imageLine = /^!\[[^\]]*\]\([^)]*\)$/;
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const beforeImages = beforeLines.flatMap((line, index) => imageLine.test(line) ? [index] : []);
  const afterImages = afterLines.flatMap((line, index) => imageLine.test(line) ? [index] : []);
  if (beforeImages.length < 2) return "seed has no second frame";
  if (afterImages.length !== beforeImages.length) return "frame image boundaries changed";
  if (beforeLines.slice(0, beforeImages[0] + 1).join("\n") !== afterLines.slice(0, afterImages[0] + 1).join("\n"))
    return "bytes before frame 1 changed";
  if (beforeLines.slice(beforeImages[1]).join("\n") !== afterLines.slice(afterImages[1]).join("\n"))
    return "bytes after frame 1 changed";
  return null;
}
async function verifyObsStories(project, editedStory = null) {
  for (let number = 1; number <= 50; number += 1) {
    const expected = editedStory && number === 1 ? editedStory : seedStory(obsTemplate(number), number);
    const actual = Buffer.from(await getBytes(storyRoute(project, number)));
    const expectedBytes = Buffer.from(expected, "utf8");
    if (actual.includes(0x0d)) fail("OBS stories", `${storyPath(number)} contains CR bytes`);
    if (!actual.equals(expectedBytes)) fail("OBS stories", `${storyPath(number)} differs from the current package seed`);
    const repoDir = localRepoDir(project);
    if (repoDir) {
      const diskFile = path.join(repoDir, "ingredients", storyPath(number));
      if (!fs.existsSync(diskFile)) fail("OBS disk stories", `${diskFile} is missing`);
      const disk = fs.readFileSync(diskFile);
      if (!disk.equals(expectedBytes)) fail("OBS disk stories", `${storyPath(number)} differs on disk from HTTP/package bytes`);
    }
  }
  ok("OBS stories", `${project} has 50 byte-exact LF stories`);
}
async function verifyObsCheckpoint(project) {
  if (!localStore) {
    ok("OBS checkpoint", "skipped (no local project store was supplied)");
    return;
  }
  // The installed smoke deliberately removes development tools from PATH. Do
  // not shell out to Git here: the platform's checkpoint endpoint is the
  // authoritative commit operation, and an empty status proves that the
  // exact HTTP/disk bytes checked by verifyObsStories have no pending changes.
  let status;
  try {
    status = JSON.parse(await getText("/api/git/status/" + enc(project)));
  } catch (error) {
    fail("OBS checkpoint", `${project} status could not be read after commit (${error.message})`);
  }
  if (!Array.isArray(status)) fail("OBS checkpoint", `${project} status was not an array`);
  if (status.length) fail("OBS checkpoint", `${project} still has pending changes: ${JSON.stringify(status)}`);
  ok("OBS checkpoint", `${project} commit is clean; HTTP and disk bytes agree for all 50 stories`);
}
async function seedObsStories(project) {
  for (let number = 1; number <= 50; number += 1) {
    // Read the platform-created bytes first, exactly as JournalingStore does.
    // Never overwrite a stale template with the package fixture before checking
    // it; a CR or ordinary-byte drift must fail this lifecycle.
    const source = Buffer.from(await getBytes(storyRoute(project, number)));
    if (source.includes(0x0d)) fail("OBS seed", `${storyPath(number)} contains CR bytes in the platform template`);
    const seeded = seedStory(source.toString("utf8"), number);
    const route = storyRoute(project, number) + "&no_bak";
    await post(route, { payload: seeded }).catch((e) => fail("OBS seed", e.message));
  }
  await verifyObsStories(project);
  ok("OBS seed", `${project} received all 50 title-normalized LF stories`);
}
async function probeObsTemplate() {
  const probeAbbr = `${abbr}probeobs`;
  const probeProject = `_local_/_local_/${probeAbbr}`;
  // Negative control first: a known story path from the package, addressed to
  // the absent project, must be rejected. If this succeeds, the probe is not
  // testing the server surface (and no made-up story identifier is used).
  try {
    await getBytes(storyRoute(probeProject, 1));
    fail("OBS template negative control", "an absent project unexpectedly returned story bytes");
  } catch (error) {
    ok("OBS template negative control", `absent project rejected for ${storyPath(1)} (${error.message.split(" ").slice(0, 2).join(" ")})`);
  }
  const before = JSON.parse(await getText("/api/git/list-local-repos"));
  if (before.includes(probeProject)) fail("OBS template probe", `${probeProject} already exists`);
  await post("/api/git/new-obs-resource", {
    content_name: "tC4 OBS template probe", content_abbr: probeAbbr,
    content_language_code: "fr", branch_name: null,
  }).catch((e) => fail("OBS template probe create", e.message));
  try {
    const after = JSON.parse(await getText("/api/git/list-local-repos"));
    if (!after.includes(probeProject)) fail("OBS template probe", `${probeProject} missing from /git/list-local-repos`);
    const metadata = JSON.parse(await getText("/api/burrito/metadata/raw/" + enc(probeProject)));
    if (!Object.prototype.hasOwnProperty.call(metadata, "localizedNames"))
      fail("OBS template probe", "the selected OBS metadata has no localizedNames field");
    for (let number = 1; number <= 50; number += 1) {
      const actual = Buffer.from(await getBytes(storyRoute(probeProject, number)));
      const expected = Buffer.from(obsTemplate(number), "utf8");
      if (actual.includes(0x0d)) fail("OBS template probe", `${storyPath(number)} contains CR bytes before the client writes`);
      if (!actual.equals(expected)) fail("OBS template probe", `${storyPath(number)} served by the platform differs from the packaged fixture before any seed write`);
    }
    ok("OBS template probe", `${probeProject} served all 50 pre-seed bytes from the selected package resources`);
  } finally {
    await post("/api/git/delete/" + enc(probeProject), {}).catch(() => {});
  }
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
  } else if (mode === "obs-image") {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "BUILD-MANIFEST.json"), "utf8"));
    const pin = manifest.bundled_resources.find((entry) => entry.repoPath === "git.door43.org/uW/obs_images_360");
    if (!pin || pin.version !== null || pin.sha !== "7146d5b504f6b63b9e11f7dc0b18c594d0ae179d")
      fail("OBS image manifest", JSON.stringify(pin));
    ok("OBS image proof", manifest.artifact + ", commit " + manifest.inputs['uw-tc4_client'].commit
      + ", host " + process.platform + "-" + process.arch + ", built " + manifest.built_utc);
    const net = JSON.parse(await getText("/api/net/status"));
    if (net.is_enabled !== false) fail("OBS image net gate", "external access was enabled before the check: " + JSON.stringify(net));
    const route = "/api/burrito/ingredient/bytes/_local_/_sideloaded_/uw--obs_images_360--7146d5b504f6?ipath=360px%2Fobs-en-01-01.jpg";
    const bytes = await getBytes(route).catch((e) => fail("OBS image", e.message));
    let size;
    try { size = jpegDimensions(bytes); } catch (e) { fail("OBS image decode", e.message); }
    if (size.width !== 640 || size.height !== 360)
      fail("OBS image decode", size.width + "x" + size.height + ", expected 640x360");
    ok("OBS image", "story 1/frame 1 decoded 640x360 from local bundled resource with net disabled; no CDN request");
  } else if (mode === "version") {
    const product = JSON.parse(fs.readFileSync(path.join(__dirname, "lib", "product", "product.json"), "utf8"));
    const live = JSON.parse(await getText("/api/version"));
    if (live.product_version !== product.version || live.product_date_time !== product.datetime)
      fail("version", `/api/version ${live.product_version}/${live.product_date_time} != package ${product.version}/${product.datetime}`);
    ok("version", `/api/version matches this package (${product.version}, ${product.datetime})`);
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
  } else if (mode === "export") {
    const zipBytes = await getBytes("/api/burrito/zipped/" + enc(repo), 200)
      .catch((e) => fail("export", e.message));
    const metadataBytes = await getBytes("/api/burrito/metadata/raw/" + enc(repo))
      .catch((e) => fail("export", e.message));
    try {
      const result = await verifyBurritoZip(zipBytes, metadataBytes);
      ok("export", `${repo}: ${result.ingredientFiles} ingredient files; metadata matches raw route (${result.metadataBytes} bytes)`);
    } catch (error) {
      fail("export", error.message);
    }
  } else if (mode === "obs-create") {
    const before = JSON.parse(await getText("/api/git/list-local-repos"));
    if (before.includes(obsRepo)) fail("OBS create", obsRepo + " already exists");
    await post("/api/git/new-obs-resource", {
      content_name: "tC4 OBS smoke test", content_abbr: obsAbbr,
      content_language_code: "fr", branch_name: null,
    }).catch((e) => fail("OBS create", e.message));
    const after = JSON.parse(await getText("/api/git/list-local-repos"));
    if (!after.includes(obsRepo)) fail("OBS create", obsRepo + " missing from /git/list-local-repos");
    ok("OBS create", obsRepo + " listed by /git/list-local-repos");
    await seedObsStories(obsRepo);
    await post("/api/git/add-and-commit/" + enc(obsRepo), { commit_message: "Seed the fifty stories (tC4)" })
      .catch((e) => fail("OBS seed checkpoint", e.message));
    await verifyObsStories(obsRepo);
    await verifyObsCheckpoint(obsRepo);
    const edited = editFirstFrame(seedStory(obsTemplate(1), 1), marker);
    const outside = firstFrameOutsideViolation(seedStory(obsTemplate(1), 1), edited);
    if (outside) fail("OBS edit", outside);
    await post("/api/burrito/ingredient/raw/" + enc(obsRepo) + "?ipath=" + encodeURIComponent(storyPath(1)), { payload: edited })
      .catch((e) => fail("OBS edit", e.message));
    await post("/api/git/add-and-commit/" + enc(obsRepo), { commit_message: "OBS smoke checkpoint" })
      .catch((e) => fail("OBS checkpoint", e.message));
    const storyBack = Buffer.from(await getBytes(storyRoute(obsRepo, 1)));
    if (!storyBack.equals(Buffer.from(edited, "utf8"))) fail("OBS checkpoint", "story 1 did not read back after checkpoint");
    await verifyObsStories(obsRepo, edited);
    await verifyObsCheckpoint(obsRepo);
    ok("OBS edit/checkpoint", "story 1 changed and the other 49 stories remained byte-exact");
  } else if (mode === "obs-template-probe") {
    await probeObsTemplate();
  } else if (mode === "obs-readback") {
    const edited = editFirstFrame(seedStory(obsTemplate(1), 1), marker);
    await verifyObsStories(obsRepo, edited);
    ok("OBS reopen", obsRepo + " retained the edited story after server restart");
  } else if (mode === "delete") {
    const projects = JSON.parse(await getText("/api/git/list-local-repos"));
    // The current smoke sequence creates an OBS repo, not a text repo. Clean
    // up whichever fixtures actually exist so cleanup is idempotent and does
    // not turn an already-clean profile into a false failure.
    if (projects.includes(repo)) await post("/api/git/delete/" + enc(repo), {}).catch((e) => fail("delete", e.message));
    if (projects.includes(obsRepo)) await post("/api/git/delete/" + enc(obsRepo), {}).catch((e) => fail("OBS delete", e.message));
    const after = JSON.parse(await getText("/api/git/list-local-repos"));
    if (after.includes(repo) || after.includes(obsRepo)) fail("delete", `${repo} or ${obsRepo} still listed`);
    ok("delete", `${repo} and ${obsRepo} removed`);
  }
})().catch((e) => fail(mode, e.message));
