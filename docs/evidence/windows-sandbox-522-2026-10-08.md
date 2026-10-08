# The packaged Windows app without a network: App language, Hindi, a restart (#522) — 2026-10-08

This record is the packaged-app witness of issue #522, acceptance criteria 9, 11 and 12
(the installed app includes the four catalogs; the dialog works with external access
unavailable; Hindi renders legibly in the installed app; a fresh session uses the saved
choice). Pull request #597, review finding F1.

## The machine

- Windows Sandbox on a Windows 11 Pro 10.0.26200 host. The sandbox reports
  `Microsoft Windows [Versión 10.0.26100.9550]`, user `WDAGUtilityAccount`.
- Networking is off (`<Networking>Disable</Networking>`), memory 8192 MB. Inside the
  sandbox, `ping -n 1 git.door43.org` answers "La solicitud de ping no pudo encontrar el
  host git.door43.org" (no name resolution, no adapter).
- Time of the run: 2026-10-08, 14:50 to 15:01 local time (UTC−4).

## The artifact

`package-desktop` run 37817673890, dispatched by hand on branch `issue-522-app-language`
(`workflow_dispatch`; every job and smoke green). `BUILD-MANIFEST.json` names client commit
`07ae9e685ba1db8205d1539903fefd4589d6ddc4` (the PR head of review round 1) and server
pankosmia-web 0.18.15 (`a83725b67593b018f815fdb25a3920ce03e833e7`), binary sha256
`48520447e6c5874d8b1d86f588cab5aa509ad9cad0527c4cc05e2925d4028fd1`.

| File | Artifact id | Bytes |
|---|---|---|
| `tC4-4.0.0-rc.1-windows-x64-unsigned.zip` | 11568990322 | 238455139 |

The four catalogs are in the client bundle: on the host, `grep -l` for one string of each
catalog in `lib/clients/uw-tc4/build/assets/index-*.js` finds each once ("ऐप की भाषा",
"Español (Latinoamérica)", "Langue de l’application", "Idioma de la aplicación",
"Choose the language for menus and dialogs.").

## Method

The unpacked zip is mapped read-only into the sandbox at `C:\in`. A logon command copies
it to `C:\t\translationCore4`, records `ver`, `ipconfig` and the ping, and runs
`start-tc4.cmd`. A small PowerShell agent inside the sandbox then runs the scripts the host
drops into `C:\in\cmd` and writes logs and screenshots to the mapped `C:\out`:

1. `01-shot.ps1`: wait for the window "translationCore 4", maximize, screenshot.
2. `02-language.ps1`: click the account trigger; Down, Down, Enter (the App language row);
   Tab, Down (open the select); End, Enter (हिन्दी); Tab, Tab, Enter (Apply); open the
   menu again. A screenshot after each step.
3. `03-restart.ps1`: copy the per-client settings document, kill `electron` and `server`,
   run `start-tc4.cmd` again, screenshot.

## Result

- `01-start.png`: Home in English, "Your projects", the account trigger.
- `02b-dialog.png`: the App language dialog in English with English selected.
- `02d-preview-hi.png`: after the selection, before Apply, the whole app and the dialog in
  Hindi (`ऐप की भाषा`, `मेनू और संवादों की भाषा चुनें।`, `रद्द करें`, `लागू करें`), Devanagari
  rendered by the system face, every label inside its control.
- `02e-applied-hi.png`, `02f-menu-hi.png`: after Apply, Home in Hindi; the account menu in
  Hindi with the row `ऐप की भाषा` / `हिन्दी` and the internet switch off.
- `03-restart-hi.png`: a fresh app session (new `electron` and `server` processes) starts
  in Hindi.
- `client-settings-after-apply.json` (from
  `C:\Users\WDAGUtilityAccount\pankosmia\tc4\client_settings\uw-tc4.json`): the document
  holds `"appLocale": "hi"` beside the `installedResources` record; nothing else was added.

The screenshots and logs stay in the witness folder on the host (not committed).

## Known limits

- One platform: Windows 11 only. macOS and Linux packages were built and smoked by the same
  run but not exercised for this criterion.
- The witness uses the unpacked zip, not the Inno Setup installer (`.exe`).
