# Windows clean machine: the installer and the zip start and pass the smoke, `main` at `4574920` (#546) — 2026-10-09

This record is a clean-machine witness of the Windows installer for the rc.2 checklist of
issue #546 ("A clean-machine witness of the Windows installer passed"). It also records
the signing state (#456) and the window frame on Windows (#214).

**The build is not the rc.2 build.** `package.json` at `4574920` says `4.0.0-rc.1`. The
witness must run again on the commit that gets the `v4.0.0-rc.2` tag.

## The machine

- Windows Sandbox on a Windows 11 Pro 10.0.26200 host. The sandbox reports
  `Microsoft Windows 11 Enterprise 10.0.26100 64 bits`, user `WDAGUtilityAccount`.
- Networking is off (`<Networking>Disable</Networking>`), memory 8192 MB. Inside the
  sandbox, `Get-NetAdapter` shows 0 adapters with status `Up`.
- Time of the run: 2026-10-10T00:08:54Z to 2026-10-10T00:15:59Z (2026-10-09, 20:08 to
  20:15 local time, UTC−4).

The machine has no VC++ runtime, before and after the run:

```
vc before: System32\vcruntime140.dll exists: False
vc before: registry VC\Runtimes\x64 exists: False
vc after: System32\vcruntime140.dll exists: False
vc after: registry VC\Runtimes\x64 exists: False
```

The registry key is `HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64`.

## The artifacts

The two artifacts come from `package-desktop` run 38005536249, the push of pull request
#629 to `main`, head `457492067026134914fac038854e9471873c6a59`. All 10 jobs of the run
passed. `BUILD-MANIFEST.json` in the zip names client commit
`457492067026134914fac038854e9471873c6a59`, version `4.0.0-rc.1`, built
`2026-10-09T23:44:11Z`, and server pankosmia-web 0.18.15
(`a83725b67593b018f815fdb25a3920ce03e833e7`), binary sha256
`970800ec0d8626175d87d3d8ca374b994f1c12440bb9154267324af00e1604dd`.

| File | Artifact id | Bytes | sha256 |
|---|---|---|---|
| `tC4-4.0.0-rc.1-windows-x64-unsigned.zip` | 11651850301 | 259009238 | `2206a46cef578467c1438551bfe59bab3e563f167a2f9ebb607bd5fca4c3d0fe` |
| `tC4-4.0.0-rc.1-windows-x64-unsigned.exe` | 11651810322 | 186525858 | `ff29661c8410fec816ed35483eb0b2c6c8099c068d0531e3f77d0222eaf791c2` |

The bytes and the sha256 were measured inside the sandbox. They are equal to the size and
the digest that GitHub lists for each artifact. The released v4.0.0-rc.1 assets have the
same file names. Use the sha256 to tell them apart.

## Method

The two files were downloaded on the host with
`gh api repos/unfoldingWord/translationCore4/actions/artifacts/<id>/zip` and mapped
read-only into the sandbox at `C:\in`. A PowerShell script ran inside the sandbox at
logon. It started each step with `Start-Process -Wait -PassThru` and wrote the exit code
of each step to a log. `TEMP` and `TMP` were set to `C:\tmp`.

Zip path:

```
C:\Windows\System32\tar.exe -xf "C:\in\tC4-4.0.0-rc.1-windows-x64-unsigned.zip" -C C:\t\z
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\t\z\translationCore4\smoke-installed.ps1" -AppDir "C:\t\z\translationCore4" -SmokeHome C:\h1 -LogDir C:\l1
```

Installer path:

```
C:\t\setup.exe /VERYSILENT /SUPPRESSMSGBOXES /SP- /NORESTART /LOG="C:\l2\install.log"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\WDAGUtilityAccount\AppData\Local\Programs\translationCore4\smoke-installed.ps1" -AppDir "C:\Users\WDAGUtilityAccount\AppData\Local\Programs\translationCore4" -SmokeHome C:\h2 -LogDir C:\l2
```

`smoke-installed.ps1` is the copy that the artifact ships. `C:\t\setup.exe` is a copy of
the installer. After the two smoke runs, the script read the signature of four files with
`Get-AuthenticodeSignature`. Then it started the installed app from its Start menu
shortcut, under the real profile of the sandbox user, and saved a picture of the screen.

## Result

Exit codes, from the log of the script:

```
step zip-unpack exit 0
step zip-smoke exit 0
step install exit 0
step installer-smoke exit 0
```

The four error streams are empty (0 bytes each).

Zip path, selected lines of the smoke transcript:

```
ok first start: installed app PID 4540, server PID 3636, port 19119
ok second start: installed app PID 9192, server PID 8372, port 19119
ok bundled upgrade: old pinned ULT and unpinned TN bytes preserved; old project reopened with old pin; current bundled ULT/TN readable and selected by exact SHA; preference retained
SMOKE OK: C:\t\z\translationCore4 under USERPROFILE=C:\tmp\tc4u-739bec8956e6; store C:\tmp\tc4u-739bec8956e6\pankosmia\tc4-projects
SMOKE OK: C:\t\z\translationCore4 under USERPROFILE=C:\h1; store C:\h1\pankosmia\tc4-projects
```

Installer path:

```
ok first start: installed app PID 8068, server PID 1912, port 19119
ok second start: installed app PID 6628, server PID 7912, port 19119
ok bundled upgrade: old pinned ULT and unpinned TN bytes preserved; old project reopened with old pin; current bundled ULT/TN readable and selected by exact SHA; preference retained
SMOKE OK: C:\Users\WDAGUtilityAccount\AppData\Local\Programs\translationCore4 under USERPROFILE=C:\tmp\tc4u-2fe87080eefd; store C:\tmp\tc4u-2fe87080eefd\pankosmia\tc4-projects
SMOKE OK: C:\Users\WDAGUtilityAccount\AppData\Local\Programs\translationCore4 under USERPROFILE=C:\h2; store C:\h2\pankosmia\tc4-projects
```

Each path prints two `SMOKE OK` lines: the smoke runs itself a second time for the bundled
upgrade check. No line of the two transcripts starts with `FAIL`. Each of the four smoke
runs printed this line:

```
ok OBS image proof: tC4-4.0.0-rc.1-windows-x64-unsigned, commit 457492067026134914fac038854e9471873c6a59, host win32-x64, built 2026-10-09T23:44:11Z
```

### The signing state (#456)

Nothing is signed:

```
signature C:\in\tC4-4.0.0-rc.1-windows-x64-unsigned.exe: Status=NotSigned Signer=
signature C:\Users\WDAGUtilityAccount\AppData\Local\Programs\translationCore4\electronite\electron.exe: Status=NotSigned Signer=
signature C:\Users\WDAGUtilityAccount\AppData\Local\Programs\translationCore4\bin\server.exe: Status=NotSigned Signer=
signature C:\Users\WDAGUtilityAccount\AppData\Local\Programs\translationCore4\unins000.exe: Status=NotSigned Signer=
```

### The window frame on Windows (#214)

The installer made the Start menu shortcut `translationCore4.lnk`. Its target is
`electronite\electron.exe` with the argument `electron` (the installed folder), no batch
launcher. The app started from that shortcut and showed Home ("Your projects", "No
projects yet. Select + Add a project to start.").

- The window has the native Windows title bar: the icon, the title "translationCore 4",
  and the minimize, maximize and close buttons. The window style has `WS_CAPTION` set.
- Below the title bar, the window shows the menu bar `Edit`, `View`, `Window`.
- The app header is below the menu bar.

The maintainer saw the window, and the picture of the screen shows the same. This agrees
with "The window frame (#214)" in `docs/PACKAGING.md`: pull request #631 changed macOS
only.

The picture and the logs stay in the witness folder on the host (not committed).

## Limits

- **Not the rc.2 build.** See the note at the top.
- **A sandbox, not a pilot's PC.** The sandbox is a clean Windows image on the maintainer's
  machine. No physical clean machine was used.
- **The installer ran silently.** Nobody saw the installer pages.
- **No SmartScreen or "unknown publisher" prompt could show.** The files came through a
  mapped folder, so they have no Mark of the Web, and networking is off. The signing state
  is the `Get-AuthenticodeSignature` result only.
- **The app was not used after the start.** The proof of function is the shipped smoke
  (`SMOKE OK`). On the Home screen, nobody created a project or opened a menu.
- **The failure without the VC++ runtime DLLs was not reproduced.** The script did not
  start `server.exe` without the DLLs.
- One Windows build (10.0.26100) only. Windows 10 was not tested.
