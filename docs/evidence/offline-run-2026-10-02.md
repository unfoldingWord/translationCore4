# The offline run for v4.0.0-rc.1 (2026-10-02)

**Question:** does one artifact of the rc.1 candidate pass the offline run in
`docs/PACKAGING.md` ("The offline run"), including steps 9, 9a and 9b?

**Artifact:** package-desktop run 37079689983, the push of `main` at
`6f878aad50c6720f6aad061bde4968b7833d38e4` (the merge of PR #531). Linux zip
`tC4-4.0.0-rc.1-linux-x64-unsigned.zip`, artifact id 11257559838.
`BUILD-MANIFEST.json` names client commit `6f878aad50c6720f6aad061bde4968b7833d38e4`,
version `4.0.0-rc.1`, variant production, `built_utc` `2026-10-02T23:58:48Z`.

| Artifact | Id | Bytes | SHA-256 |
|---|---|---|---|
| `tC4-4.0.0-rc.1-linux-x64-unsigned.zip` | 11257559838 | 228949754 | `e957b91a9f1276dad2bcf71d112d4107100a8cba1a5c7cf00790bb93da7bcdcf` |

The hash is of the zip downloaded from the artifacts API. It matches the digest
recorded on issue #371 for that artifact id. macOS and Windows artifacts of the
same run were not downloaded for this record.

## Post-install smoke test, local (#45)

**Method:** `smoke-installed.zsh` from the unpacked Linux folder, run once online
before the offline session, on Debian GNU/Linux 13 (trixie) x86_64. The script
runs an upgrade pass and a fresh pass.

**Result:** exit 0. Both lines:

- `SMOKE OK: /workspace/tc4-371/app/translationCore4 under HOME=/tmp/tc4-upgrade-lC6usw, store /tmp/tc4-upgrade-lC6usw/pankosmia/tc4-projects`
- `SMOKE OK: /workspace/tc4-371/app/translationCore4 under HOME=/home/box, store /home/box/pankosmia/tc4-projects`

Each start printed `ok version: /api/version matches this package (4.0.0-rc.1, 2026-10-02T23:58:48Z)`.
The script removed only its own smoke projects.

## Offline run (#43)

**Method:** the procedure in `docs/PACKAGING.md`, "The offline run", steps 1–10
including 9, 9a and 9b. Same Debian host. Unpacked with `unzip` to
`/workspace/tc4-371/app/translationCore4`. Fresh `HOME=/workspace/tc4-371/home`.
`APP_RESOURCES_DIR` unset. The host network was not turned off. The app was
started with `unshare -rn` and `ip link set lo up` around `./start-tc4.sh`
(loopback only). `chrome-sandbox` is not setuid, so the launcher used
`--no-sandbox`.

Isolation check, from inside the namespace (`nsenter -t <server pid> -U --preserve-credentials -n`,
because a plain `nsenter -n` returned `Operation not permitted`): `ping -c 1 -W 2 1.1.1.1`
failed with `ping: connect: Network is unreachable` (exit 2). From the host,
nothing accepted `127.0.0.1:19119`. Inside the namespace, `/api/version` returned
`product_version` `4.0.0-rc.1` and `product_date_time` `2026-10-02T23:58:48Z`.
Served `index.html` and on-disk `lib/clients/uw-tc4/build/index.html` both load
`index-_HQorPp5.js`, sha256
`d3041afe2861333cf6d01211e4b5b878c61cd0a413ae479387a8fca3344acbf3`.
One electron/server pair, both with cwd under the unpack folder.
Run by Tessa (end-user QA), 2026-10-02 America/New_York.

**Result:** PASS. Every numbered step reached its expected result. Step 9a has
one difference from the written line, stated in the table. No missing resource
was named. No issue was filed.

| Step | Result |
|---|---|
| 1 Start the app | PASS. Home, heading "Your projects". "No projects yet. Select + Add a project to start." No error banner. Window open within 30 s. |
| 2 New Bible, blank Titus | PASS. Project "Offline371", language `en`, left to right. Titus opened directly in Understand at chapter 1. |
| 3 Understand, chapter 1 | PASS. Notes and Questions showed. Note headings included "Titus 1 Chapter Introduction" and "Structure and Formatting." First question: "What was Paul's purpose in his service to God?" |
| 4 Translate, chapter 1 | PASS. Verses 1–3 showed. Source tabs ULT, UST, and Greek. ULT verse 1 begins "Paul, a servant of God and an apostle of Jesus Christ…" |
| 5 Draft verse 1 | PASS. Typed "Paul, a servant of God." Indicator: "Saved". |
| 6 Check, Translation Notes, one item Mark valid | PASS. Item "for the faith of the chosen people of God and knowledge of the truth". Progress: "1 of 157 resolved." The card did not read "Unavailable offline". |
| 7 Align, one word into a card | PASS. "Paul" moved into the Paul card. "1 of 5 words placed." The screen did not say the original-language text was missing. |
| 8 Leave and reopen | PASS. After Switch project and opening Titus again: the verse was still "Paul, a servant of God."; notes still "1 of 157 resolved"; Align still "1 of 5 words placed", Paul still in the Paul card. |
| 9 Community Checking exports | PASS. "Saved Offline371-Titus.pdf" and "Saved Offline371-2026-10-02.zip", both in `/workspace/tc4-371/exports`. The PDF text includes "Paul, a servant of God." `pdffonts` on that PDF lists embedded PT Serif (Regular and Bold) only. |
| 9a Home account menu and Share | PASS for the behaviors the step proves, with one difference. Home top bar showed the person icon. Its tooltip was "Door43 account: not signed in". The bar showed no "Internet" and no "Local". It did not show "Saved" beside the icon. "Saved" was visible inside the project (steps 5 and 9b), not on Home. "Share on Door43" opened the dialog "Use the internet?" with the text "This will contact Door43 to sign in if needed and prepare sharing. You will review the destination and books before uploading." Cancel closed the dialog. No sending toast. The checkbox "Don't ask again on this computer" was left off. |
| 9b New OBS, draft frame 1, Understand, Check | PASS. Project "Offline371 Stories", language `en`, left to right. Story 1 opened in Understand. Translate showed gateway text beginning "This is how God made" and a picture for frame 1. Drafted "God made light." Indicator: "Saved". Understand listed the note heading "the beginning" and the word link "God". Translation Notes item "The Creation" marked valid. Progress: "1 of 91 resolved." |
| 10 Quit | PASS. The window was closed with its close button. The electron and server processes exited. The host network was never turned off, so it was not turned back on. |

**Limits:** one platform (Linux). macOS and Windows were not run offline. The
network was cut off for the app's namespace only, not with `nmcli` or by
unplugging Ethernet; a browser on the host could still open web pages. Screen
font names (Mulish, Charis SIL, Noto Serif, Amiri) were not measured. The PDF
embeds PT Serif. `ping` was not on the host until `iputils-ping` was installed
for the namespace check. The local smoke's second pass used `HOME=/home/box`,
which is the process home, not the fresh offline home.

[VERIFIED — run 37079689983 on `main` 6f878aa, Linux artifact 11257559838;
local smoke and offline run (steps 1–10, 9a and 9b) by Tessa, 2026-10-02 ET]
