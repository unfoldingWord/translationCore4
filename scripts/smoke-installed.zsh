#!/bin/zsh
# Post-install smoke test (#45). Run it against an INSTALLED translationCore4 folder,
# on the machine that will use it. It proves what a pilot does after installing:
#
#   1. the app starts through its own launcher and its bundled server answers;
#   2. the server serves the tC4 client (303 from /, 200 from /clients/uw-tc4);
#   3. the project store is the tC4-owned path, never $HOME/pankosmia_repos (#70);
#   4. a project is created through the app's own HTTP surface, with one book;
#   5. one verse is written into that book and lands in the store on disk;
#   6. the app is stopped and started again; the verse reads back;
#   7. the smoke project is removed; the app is stopped.
#
# Each step prints one line, "ok <step>: <what was seen>" or "FAIL <step>: <what was
# seen>", and the script exits non-zero at the first failure. The output is what the
# pre-release notes paste (epic #59, the standing tag rule).
#
# Needs: zsh, curl, lsof, and the artifact itself. No npm, no checkout, no rig. The JSON
# steps run under the artifact's own Electron binary in Node mode
# (ELECTRON_RUN_AS_NODE=1), so a clean machine needs no node, python or jq.
#
# Usage:
#   zsh smoke-installed.zsh [<installed translationCore4 folder>]
#     default folder: the one this script sits in (the build ships a copy there).
#   TC4_SMOKE_HOME=<dir>   the HOME the app runs under (default: $HOME). CI passes a
#                          fresh directory; a pilot runs with the real HOME.
#   TC4_SMOKE_KEEP=1       keep the smoke project instead of deleting it.
#
# The build-time smoke test in scripts/package-desktop.zsh stays: it checks the
# staged folder inside the build. This script is the post-install half.
set -u

APPDIR=${1:-${0:a:h}}
APPDIR=${APPDIR:a}
SMOKE_HOME=${TC4_SMOKE_HOME:-$HOME}
STAMP=$(date +%s)
ABBR="smoke_$STAMP"
REPO="_local_/_local_/$ABBR"
MARKER="tC4 smoke verse $STAMP"
PORT=""
APP_PID=""
LOGDIR=${TMPDIR:-/tmp}

fail() { echo "FAIL $1"; cleanup_app; exit 1; }
ok()   { echo "ok $1"; }

# ---- the artifact's own binaries -------------------------------------------------
# An unpacker that drops permission bits leaves the launcher present but not
# executable (seen with actions/download-artifact, CI run 34007702506); say which.
if [ -f "$APPDIR/start-tc4.command" ]; then
  LAUNCHER="$APPDIR/start-tc4.command"; ELECTRON="$APPDIR/Electron.app/Contents/MacOS/Electron"
elif [ -f "$APPDIR/start-tc4.sh" ]; then
  LAUNCHER="$APPDIR/start-tc4.sh"; ELECTRON="$APPDIR/electronite/electron"
else
  echo "FAIL launcher: no start-tc4.command or start-tc4.sh in $APPDIR"; exit 1
fi
for bin in "$LAUNCHER" "$ELECTRON"; do
  [ -f "$bin" ] || { echo "FAIL artifact: $bin is missing"; exit 1; }
  [ -x "$bin" ] || { echo "FAIL artifact: $bin exists but is not executable ($(ls -l "$bin" | cut -d' ' -f1)); the unpacker dropped the permission bits. Unpack the downloaded zip once with unzip."; exit 1; }
done
ok "artifact: $APPDIR ($(basename "$LAUNCHER") and $(basename "$ELECTRON") are executable)"

# Node mode of the shipped Electron: the JSON steps below run through it.
node_run() { ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$@"; }

# ---- start / stop ----------------------------------------------------------------
find_port() {  # sets PORT to the port of a tc4 server, or leaves it empty
  PORT=""
  local p
  for p in {19119..19139}; do
    if curl -s --max-time 1 "http://127.0.0.1:$p/api/version" | grep -q '"product_short_name":"tc4"'; then
      PORT=$p; return 0
    fi
  done
  return 1
}

port_pids() { lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | sort -u | tr '\n' ' ' | sed 's/ *$//'; }
alive() { kill -0 "$1" 2>/dev/null; }

SERVER_PIDS=""
start_app() {  # $1 = label
  HOME="$SMOKE_HOME" "$LAUNCHER" > "$LOGDIR/tc4-smoke-$1.log" 2>&1 &
  APP_PID=$!
  local i
  for i in {1..60}; do
    find_port && break
    sleep 1
  done
  [ -n "$PORT" ] || fail "$1 start: no tc4 server on 19119-19139 after 60 s (log: $LOGDIR/tc4-smoke-$1.log)"
  local version
  version=$(curl -s --max-time 2 "http://127.0.0.1:$PORT/api/version" | sed -n 's/.*"pkg_version":"\([^"]*\)".*/\1/p')
  SERVER_PIDS=$(port_pids)
  [ -n "$SERVER_PIDS" ] || fail "$1 start: no process listens on port $PORT (lsof)"
  ok "$1 start: server on port $PORT (pid $SERVER_PIDS), pkg_version $version, electron pid $APP_PID"
}

port_answers() { curl -s --max-time 1 "http://127.0.0.1:$PORT/api/version" | grep -q '"product_short_name":"tc4"'; }

stop_app() {  # $1 = label. The launcher execs Electron, so APP_PID is Electron's; the
              # server is its child, found by the port it listens on. A stop is proven
              # when both processes are gone AND the port is silent. SIGTERM first; a
              # process still alive after 10 s gets SIGKILL (a macOS CI runner kept
              # Electron alive past 30 s of SIGTERM, run 34008006559). The test proves
              # persistence across a restart, not a graceful quit, so a forced stop is
              # reported, not failed.
  local victims="$APP_PID $SERVER_PIDS"
  local pid i forced=""
  for pid in ${=victims}; do kill "$pid" 2>/dev/null; done
  for i in {1..40}; do
    local left=""
    for pid in ${=victims}; do alive "$pid" && left="$left $pid"; done
    if [ -z "$left" ] && ! port_answers; then
      ok "$1 stop: electron and server exited (pids $victims${forced:+; SIGKILL needed for$forced}), port $PORT no longer answers"
      APP_PID=""; return 0
    fi
    if [ "$i" = 10 ] && [ -n "$left" ]; then
      forced="$left"
      for pid in ${=left}; do kill -9 "$pid" 2>/dev/null; done
    fi
    sleep 1
  done
  local still=""
  for pid in ${=victims}; do alive "$pid" && still="$still $pid"; done
  echo "-- diagnostics: processes still alive:${still:- none}; port $PORT answers: $(port_answers && echo yes || echo no)"
  [ -n "$still" ] && ps -o pid,stat,etime,command -p ${=still} 2>/dev/null | cut -c1-200
  echo "-- launcher log tail ($LOGDIR/tc4-smoke-$1.log):"; tail -20 "$LOGDIR/tc4-smoke-$1.log" 2>/dev/null
  fail "$1 stop: after SIGTERM and SIGKILL, still alive:${still:- none}; port $PORT answers: $(port_answers && echo yes || echo no)"
}

cleanup_app() {
  local pid
  for pid in ${=APP_PID} ${=SERVER_PIDS}; do kill "$pid" 2>/dev/null; done
  return 0
}
trap cleanup_app INT TERM

# ---- 1-2: start, serve the client ------------------------------------------------
mkdir -p "$SMOKE_HOME"
# The server this test finds must be the one it launches: another tC4 already running
# on the scan range would be found, tested and killed in its place.
if find_port; then
  echo "FAIL precondition: a tC4 server already answers on port $PORT; close that translationCore4 first"; exit 1
fi
ok "precondition: no tC4 server on 19119-19139 before the launch"
start_app first
ROOT=$(curl -s --max-time 10 -o /dev/null -w '%{http_code} %{redirect_url}' "http://127.0.0.1:$PORT/")
CLIENT=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/clients/uw-tc4")
case "$ROOT" in
  303*"/clients/uw-tc4") ok "root: $ROOT" ;;
  *) fail "root: expected 303 to /clients/uw-tc4, got '$ROOT'" ;;
esac
[ "$CLIENT" = "200" ] && ok "client: /clients/uw-tc4 200" || fail "client: /clients/uw-tc4 answered $CLIENT"

# ---- 3: the project store (#70) --------------------------------------------------
US="$SMOKE_HOME/pankosmia/tc4/user_settings.json"
[ -f "$US" ] || fail "store: no $US (the server did not create its working dir under this HOME)"
STORE=$(sed -n 's/.*"repo_dir"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$US" | head -1)
[ -n "$STORE" ] || fail "store: no repo_dir in $US"
case "$STORE" in
  *pankosmia_repos*) fail "store: repo_dir is the shared store '$STORE' (#70 forbids it)" ;;
esac
# The build pins repo_dir to %%HOMEDIR%%/pankosmia/tc4-projects (debug: -debug);
# BUILD-MANIFEST.json names the variant (scripts/package-desktop.zsh).
VARIANT=$(sed -n 's/.*"variant"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$APPDIR/BUILD-MANIFEST.json" 2>/dev/null | head -1)
if [ "$VARIANT" = "debug" ]; then EXPECTED_STORE="$SMOKE_HOME/pankosmia/tc4-projects-debug"
else EXPECTED_STORE="$SMOKE_HOME/pankosmia/tc4-projects"; fi
[ "$STORE" = "$EXPECTED_STORE" ] || fail "store: repo_dir '$STORE' is not this build's tC4-owned store '$EXPECTED_STORE' (variant ${VARIANT:-unknown})"
[ -d "$STORE" ] || fail "store: repo_dir '$STORE' does not exist"
ok "store: repo_dir $STORE (the ${VARIANT:-production} build's tC4-owned store; not pankosmia_repos)"

# ---- 4-5: create a project and write one verse, through the app's HTTP surface ----
# The same endpoints the client uses (src/data/serverApi.ts): POST
# /git/new-text-translation, GET /git/list-local-repos, GET and POST
# /burrito/ingredient/raw/<repo>?ipath=TIT.usfm. Each line is one step.
STEPS_JS='
const [base, repo, abbr, marker, mode] = process.argv.slice(1); // node -e: argv[0] is the binary
const enc = (r) => r.split("/").map(encodeURIComponent).join("/");
const url = (route) => base + route;
const fail = (step, seen) => { console.log("FAIL " + step + ": " + seen); process.exit(1); };
const ok = (step, seen) => console.log("ok " + step + ": " + seen);
// The platform reports some failures as HTTP 200 with {"is_good":false,"reason":...};
// the client (src/data/serverApi.ts) rejects those, and so does this test.
function refuse(route, status, t) {
  if (status < 200 || status >= 300) throw new Error(route + " -> " + status + " " + t.slice(0, 200));
  let j = null;
  try { j = JSON.parse(t); } catch { return; }
  if (j && typeof j === "object" && j.is_good === false) throw new Error(route + " -> is_good:false " + (j.reason || t.slice(0, 200)));
}
async function post(route, body) {
  const r = await fetch(url(route), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.text();
  refuse(route, r.status, t);
  return t;
}
async function getText(route) {
  const r = await fetch(url(route));
  const t = await r.text();
  refuse(route, r.status, t);
  return t;
}
(async () => {
  const ipath = "TIT.usfm"; // ingredient-relative, as /burrito/paths lists them
  const rawRoute = "/api/burrito/ingredient/raw/" + enc(repo) + "?ipath=" + encodeURIComponent(ipath);
  if (mode === "create") {
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
    const back = await getText(rawRoute);
    if (!back.includes(marker)) fail("write verse", "marker not in the read-back");
    ok("write verse", "TIT 1:1 = \"" + marker + "\"");
  } else if (mode === "readback") {
    const usfm = await getText(rawRoute).catch((e) => fail("read back", e.message));
    if (!usfm.includes(marker)) fail("read back", "marker absent after the restart");
    ok("read back", "TIT 1:1 still \"" + marker + "\" after the restart");
  } else if (mode === "delete") {
    await post("/api/git/delete/" + enc(repo), {}).catch((e) => fail("delete", e.message));
    const after = JSON.parse(await getText("/api/git/list-local-repos"));
    if (after.includes(repo)) fail("delete", repo + " still listed");
    ok("delete", repo + " removed");
  }
})().catch((e) => fail(mode, e.message));
'
run_steps() { node_run -e "$STEPS_JS" -- "http://127.0.0.1:$PORT" "$REPO" "$ABBR" "$MARKER" "$1"; }

run_steps create || { cleanup_app; exit 1; }
ON_DISK="$STORE/$REPO/ingredients/TIT.usfm"
[ -f "$ON_DISK" ] || fail "store write: $ON_DISK does not exist"
grep -q "$MARKER" "$ON_DISK" && ok "store write: the verse is on disk at $ON_DISK" \
  || fail "store write: the verse is not in $ON_DISK"

# ---- 6: restart and read back ----------------------------------------------------
FIRST_SERVER="$SERVER_PIDS"
stop_app first
start_app second
[ "$SERVER_PIDS" != "$FIRST_SERVER" ] || fail "restart: the server pid did not change ($FIRST_SERVER); the app was not restarted"
ok "restart: a new server process (pid $FIRST_SERVER before, $SERVER_PIDS after)"
run_steps readback || { cleanup_app; exit 1; }

# ---- 7: clean up -----------------------------------------------------------------
if [ "${TC4_SMOKE_KEEP:-0}" = "1" ]; then
  ok "delete: skipped (TC4_SMOKE_KEEP=1), $REPO stays in $STORE"
else
  run_steps delete || { cleanup_app; exit 1; }
fi
stop_app second
echo "SMOKE OK: $APPDIR under HOME=$SMOKE_HOME, store $STORE"
