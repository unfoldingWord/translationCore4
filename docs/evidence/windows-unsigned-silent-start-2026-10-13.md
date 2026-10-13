# Windows: the unsigned build starts with no window (2026-10-13)

Owner observation on a Windows test machine (user profile `tc-win-test`), reported
2026-10-13 on #456. This record is the evidence for D98.

## What the user sees

1. The user clicks the translationCore4 shortcut.
2. No window opens. Windows shows no warning and no prompt.
3. Task Manager shows that translationCore4 is running.

The user gets no sign that the app runs or that Windows blocked something.

## When it occurs

- Windows Security **App & browser control** is on.
- **Smart App Control** is off.

The owner saw the failure only with these two settings.

## What made it start

The owner signed two Electronite DLLs by hand with Azure Artifact Signing (account
`unfoldingWordSigning`, certificate profile `uw-public-prod`): `vulkan-1.dll` and
`libGLESv2.dll`. After that, the installed app started with no security issue.

The signer subject of the hand-signed `vulkan-1.dll`:

```
CN=unfoldingWord, O=unfoldingWord, L=Orlando, S=Florida, C=US
```

After the hand signing, this check showed six files that were still unsigned, and the
app started all the same:

```powershell
Get-ChildItem "$env:LOCALAPPDATA\Programs\translationCore4" -Recurse -Include *.exe,*.dll |
  Get-AuthenticodeSignature | Where-Object Status -ne 'Valid' | Select-Object Path,Status
```

| File | Status |
|---|---|
| `bin\server.exe` | NotSigned |
| `electronite\electron.exe` | NotSigned |
| `electronite\ffmpeg.dll` | NotSigned |
| `electronite\libEGL.dll` | NotSigned |
| `electronite\vk_swiftshader.dll` (name cut off in the output) | NotSigned |
| `unins000.exe` | NotSigned |

## What this shows, and what it does not

- [VERIFIED — owner observation, 2026-10-13] An unsigned build can fail silently on a
  Windows machine with these protection settings. Signing `vulkan-1.dll` and
  `libGLESv2.dll` removed the failure on that machine.
- [inference] Both DLLs are graphics libraries. A blocked graphics DLL can stop the
  window from drawing while the process keeps running. This matches the symptom, but no
  log shows it.
- Not shown: that only these two files matter. Another machine or another security
  product can check other files. The fix is to sign every file the build ships (#456).

## Not recorded

[FLAG: these facts are not in the owner's report. Add them when known.]

- Windows edition, version and build number.
- Which **App & browser control** option was on (for example reputation-based protection
  or Exploit protection).
- The tC4 version and the artifact id of the installed build.
- Any entry in **Windows Security → Protection history** or in Event Viewer.
