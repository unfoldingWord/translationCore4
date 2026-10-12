# Windows clean machine: the window has no native title bar and no menu row, `issue-639-windows-title-bar` at `ab168ae` (#639) — 2026-10-12

This record is the Windows cold-launch witness that the Verify section of issue #639 asks
for. It checks criteria 1, 2 and 3 of the issue on the artifact of pull request #645.
The run is scripted: `witness.ps1` in the kit unpacks the zip, cold-launches the app with an
empty HOME, reads the window state through `user32`, drives each control with
`mouse_event` and each shortcut with `SendKeys`, and writes a picture after each step.
A second run of the same script produced the same states.

## The machine

- Windows Sandbox on a Windows 11 Pro 10.0.26200 host. The sandbox reports
  `Microsoft Windows 11 Enterprise 10.0.26100 64 bits`, user `WDAGUtilityAccount`,
  Spanish keyboard.
- Networking is off (`<Networking>Disable</Networking>`), memory 8192 MB. Inside the
  sandbox, `Get-NetAdapter` shows 0 adapters with status `Up`.
- Time of the run: 2026-10-12T18:05:25Z to 2026-10-12T18:07:14Z.
- The screen inside the sandbox is 1520x823 at 100 % scale.

## The artifact

The zip comes from `package-desktop` run 38272852412, the `pull_request` run of #645 at head
`ab168ae`. All 10 jobs of the run passed. `BUILD-MANIFEST.json` in the zip names
version `4.0.0-rc.1`, variant `production`, built `2026-10-12T15:52:58Z`.

| File | Artifact id | Bytes | sha256 |
|---|---|---|---|
| `tC4-4.0.0-rc.1-windows-x64-unsigned.zip` | 11757534863 | 259034925 | `1f9fe3ddb8731a6788e97272eac58eda9823ce05ea4316d8418771360bbd4cd5` |

The packaged `electron/electronStartup.js` holds the `win32` spread with
`titleBarOverlay`, and `electron/preload.js` marks the page `overlay` on `win32`
(both read from the zip before the run).

## Criterion 1: no native title bar, no menu row

The app was started as `electronite\electron.exe "<app>\electron"` from the unpacked zip,
with `USERPROFILE`, `HOME`, `APPDATA` and `LOCALAPPDATA` under an empty `C:\h1`.

```
window: 'translationCore 4' pid 7724
window: GetMenu handle (native menu bar): 0 (0 = none)
window: outer 1536x791, client 1520x775; non-client height 16
window after Alt: GetMenu handle: 0; client height 775
```

- `GetMenu` returns 0: the window has no native menu bar, before and after a press of
  `Alt`. The picture after `Alt` is identical to the cold-launch picture.
- The non-client height is 16 px: the 8 px resize borders of a maximized window and
  nothing else. A native title bar would add about 31 px, a menu row about 20 px more.
- `GetWindowLong(GWL_STYLE)` still reports `WS_CAPTION`. Chromium keeps that style bit
  on its frameless windows for snap and animation; it does not draw a caption. The
  non-client height and the picture are the evidence.
- Picture: `windows-title-bar-639-2026-10-12.png` (cold launch, maximized). The app
  header is the top edge. The three window controls sit at the right of the header, in
  the header color, white symbols, the full 56 px tall. The account trigger sits left
  of them with its gutter.

## Criterion 2: the controls work, the header moves the window

Each line is the window state read by `IsIconic`, `IsZoomed` and `GetWindowRect` two
seconds after the input. The overlay controls were clicked at the center of each 46 px
button; the header was dragged and double-clicked at x = left + 400, y = top + 28,
clear of the brand and of the overlay.

```
check start: minimized=False maximized=True rect=-8,-8,1528,783
after minimize click at 1413,20: minimized=True maximized=False rect=-32000,-32000,-31840,-31972
after restore from taskbar (ShowWindow 9): minimized=False maximized=True rect=-8,-8,1528,783
after maximize/restore click at 1459,20: minimized=False maximized=False rect=248,3,1272,771
after header drag from 648,31 by +120,+80: minimized=False maximized=False rect=356,75,1380,843
after header double-click: minimized=False maximized=True rect=-8,-8,1528,783
after second header double-click: minimized=False maximized=False rect=356,75,1380,843
after maximize click: minimized=False maximized=True rect=-8,-8,1528,783
after account trigger click: minimized=False maximized=True rect=-8,-8,1528,783
after close click at 1505,20: window alive=False; electron processes=0
```

- Minimize: the window is iconic. Maximize/restore: the window goes from maximized to
  1024x768 at (248,3). Drag: the window moves by (+108,+72) for a 120x80 drag, the
  difference is the drag threshold. Double-click: maximized, then restored to the same
  rectangle. Close: the window is gone and no `electron` process remains.
- The account trigger, left of the overlay, opens its menu (picture `account-menu.png`
  of the run; the menu hangs below the trigger, nothing under the controls).
- Picture: `windows-title-bar-639-restored-2026-10-12.jpg` (restored, 1024x768): the
  same header and controls in a window that is not maximized.

## Criterion 3: the menu stays set, its shortcuts work, no bar on Alt

Shortcuts sent with `SendKeys` to the focused app window; the header height in the
picture after each one, read at x = 700:

| Shortcut | Header height | Result |
|---|---|---|
| none (cold launch) | 56 px | default zoom |
| `Ctrl+Shift+=` (the `CommandOrControl+Plus` accelerator of View › Zoom In) | 61 px | zoom in |
| `Ctrl+0` (View › Default Zoom) | 56 px | default zoom |
| `Ctrl+-` (View › Zoom Out) | 51 px | zoom out |
| `Ctrl+Shift+I` (Window › Toggle Developer Tools) | — | one `Developer Tools` window opens; its Elements panel shows `<html lang="en" data-title-bar="overlay">` |
| `Ctrl+Shift+I` again, app window in front | — | the Developer Tools window closes |
| `Ctrl+R` (Window › Reload) with the account menu open | — | the page reloads: the menu is closed, Home is drawn again |

`Ctrl+=` and `Ctrl+` with the `+` key did nothing: the accelerator is `Plus`, which is
`Shift+=` on this keyboard. That is the accelerator's spelling, not a defect.

After the shortcuts, `GetMenu` is still 0. The menu bar never showed, also not on
`Alt`, and the application menu is set: its accelerators act. No `setMenuBarVisibility`
call is in the build; the frameless window alone gives this (docs/PACKAGING.md, "The
window frame").

## Not in this record

- An RTL project, the Help panel and the Translation Academy drawer: the sandbox has no
  network and no project. The CSS that keeps a side panel below the header is the one
  the macOS mark uses (`src/ui.css`), now shared by both marks; the dev-client
  measurement of the header at 900 px is in docs/PACKAGING.md.
- At zoom out, the overlay keeps its 56 px while the header is 51 px, so a 5 px strip
  in the header color shows under the controls (pixel (1450,53) is `#014263`, pixel
  (1200,53) is the app background). It is the same class as the macOS zoom caveat of
  pull request #631.
- macOS and Linux: not run here (the issue's criteria 4 and 5).

## Kit

`C:\Users\Elias_2\tc4-witness-639` on the host: `tc4-639.wsb` (maps `in\` and `kit\`
read-only, `out\` writable), `kit\witness.ps1`, `in\<the zip>`. The pictures and
`run.log` of each run stay in `out\` on the host; this record carries two of them.
