# Windows without the VC++ runtime: the zip and the installer start (#284) — 2026-10-06

This record is the clean-machine witness of issue #284, acceptance criterion 4. It shows
that the Windows zip and the Windows installer start on a Windows that has no Visual C++
runtime, when the artifact carries the runtime DLLs in `bin\`.

## The machine

- Windows Sandbox on a Windows 11 Pro 10.0.26200 host. The sandbox reports
  `Microsoft Windows 11 Enterprise 10.0.26100 64 bits`, user `WDAGUtilityAccount`.
- Networking is off (`<Networking>Disable</Networking>`), memory 8192 MB.
- Time of the run: 2026-10-06T15:17:31Z.

The machine has no VC++ runtime, before and after the run:

```
System32\vcruntime140.dll exists: False
registry VC\Runtimes\x64 exists: False
where vcruntime140.dll: (no file found)
```

The registry key is `HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64`. After
the two smoke runs, `System32\vcruntime140.dll exists: False` again.

## The artifacts

The two artifacts come from `package-desktop` run 37475497768, pull request #535, head
`a59acbb`. The manifest in each one names client commit `fabc4cc` (the merge commit that
GitHub builds for a pull-request run) and server pankosmia-web 0.18.15 (`a83725b`), binary
sha256 `4bff4b9314cc0c66b0732cfe1ecad7db1ae4e0af5074e921e7c92702441559c0`.

| File | Artifact id | Bytes | sha256 |
|---|---|---|---|
| `tC4-4.0.0-rc.1-windows-x64-unsigned.zip` | 11419650608 | 238010184 | `570dd20c9e8f6d65ac586396d0ff905253278a653f4550a3c14c7a0f1badf205` |
| `tC4-4.0.0-rc.1-windows-x64-unsigned.exe` | 11418359864 | 167052598 | `305904d0bfb8664634ec8d820434c1c2e1e9c7b9258c3f508cf86870e2897e09` |

The released v4.0.0-rc.1 assets have the same file names and do not carry the DLLs. Use
the sha256 to tell them apart.

In both the unpacked zip and the installed folder:

```
bin\vcruntime140.dll: 178616 bytes, version 14.51.36247.0
bin\ files: concrt140.dll, msvcp140.dll, msvcp140_1.dll, msvcp140_2.dll, msvcp140_atomic_wait.dll, msvcp140_codecvt_ids.dll, server.exe, vccorlib140.dll, vcruntime140.dll, vcruntime140_1.dll, vcruntime140_threads.dll
```

## Method

A script ran inside the sandbox at logon. It ran these commands, with `TEMP` and `TMP` set
to `C:\tmp`:

Zip path:

```
tar.exe -xf C:\in\tC4-4.0.0-rc.1-windows-x64-unsigned.zip -C C:\t\z
powershell -NoProfile -ExecutionPolicy Bypass -File C:\t\z\translationCore4\smoke-installed.ps1 -AppDir C:\t\z\translationCore4 -SmokeHome C:\h1 -LogDir C:\l1
```

Installer path:

```
C:\t\setup.exe /VERYSILENT /SUPPRESSMSGBOXES /SP- /NORESTART /LOG="C:\l2\install.log"
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\Programs\translationCore4\smoke-installed.ps1" -AppDir "%LOCALAPPDATA%\Programs\translationCore4" -SmokeHome C:\h2 -LogDir C:\l2
```

`smoke-installed.ps1` is the copy that the artifact ships. `C:\t\setup.exe` is a copy of the
installer.

## Result

Zip path, exit code 0:

```
ok first start: installed app PID 8152, server PID 5440, port 19119
ok second start: installed app PID 9092, server PID 4048, port 19119
SMOKE OK: C:\t\z\translationCore4 under USERPROFILE=C:\tmp\tc4u-66fe24f620e2; store C:\tmp\tc4u-66fe24f620e2\pankosmia\tc4-projects
SMOKE OK: C:\t\z\translationCore4 under USERPROFILE=C:\h1; store C:\h1\pankosmia\tc4-projects
```

Installer path, installer exit code 0, smoke exit code 0:

```
ok first start: installed app PID 7252, server PID 3096, port 19119
ok second start: installed app PID 6868, server PID 7888, port 19119
SMOKE OK: C:\Users\WDAGUtilityAccount\AppData\Local\Programs\translationCore4 under USERPROFILE=C:\tmp\tc4u-13176b3ba783; store C:\tmp\tc4u-13176b3ba783\pankosmia\tc4-projects
SMOKE OK: C:\Users\WDAGUtilityAccount\AppData\Local\Programs\translationCore4 under USERPROFILE=C:\h2; store C:\h2\pankosmia\tc4-projects
```

Each path prints two `SMOKE OK` lines: the smoke runs itself a second time for the bundled
upgrade check. No run showed the missing `VCRUNTIME140.dll` failure.

## Limits

- **The failure was not reproduced in this run.** The script also started `server.exe`
  alone, without the DLLs, to see exit code `0xC0000135`. The script did not capture the
  exit code, so that step proves nothing. The failure without the DLLs is in
  `offline-run-2026-09-14.md` (the alpha.6 zip on a clean Windows 11 Home).
- **A sandbox, not a pilot's PC.** The sandbox is a clean Windows image on the maintainer's
  machine. No physical clean machine was used.
- **The installer ran silently.** Nobody saw the installer pages, SmartScreen, or the
  Start menu shortcut. `windows-installer-242.md` covers the interactive witness.
- **Nobody looked at Home.** The proof is the shipped smoke (`SMOKE OK`), which the
  criterion accepts.
- **The preflight dialog was not shown.** No copy in this run lacked `bin\vcruntime140.dll`.
- One Windows build (10.0.26100) only. Windows 10 was not tested.
