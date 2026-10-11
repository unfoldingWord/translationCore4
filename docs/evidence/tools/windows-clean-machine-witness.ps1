# Windows clean-machine witness (#546): the script that ran inside Windows Sandbox for
# docs/evidence/windows-clean-machine-546-2026-10-09.md. It differs from the copy that
# ran in two places only: this header, and the last message (it was in Spanish).
#
# Launch procedure:
# 1. Make a folder on the host with three subfolders: in\, kit\ and out\.
# 2. Download the Windows zip and the Windows installer of one package-desktop run into
#    in\, each with: gh api repos/unfoldingWord/translationCore4/actions/artifacts/<id>/zip > <file>
#    Set $zip and $installer below to the two file names.
# 3. Copy this file to kit\witness.ps1.
# 4. Set the three HostFolder paths in windows-clean-machine-witness.wsb, then open it.
#    The script starts at logon and needs no input.
# 5. Read out\run.log and out\DONE on the host. out\window.png is the picture of the screen.
#
# rc.2 clean-machine witness of the Windows installer and zip (#546). Runs INSIDE
# Windows Sandbox. Every step logs "step <name> exit <code>" to C:\out\run.log.
# A failed step does not stop the next one; C:\out\DONE is written last.
$ErrorActionPreference = 'Continue'
$zip = 'C:\in\tC4-4.0.0-rc.1-windows-x64-unsigned.zip'
$installer = 'C:\in\tC4-4.0.0-rc.1-windows-x64-unsigned.exe'
$out = 'C:\out'
$runLog = "$out\run.log"
$results = [ordered]@{}

function Log([string]$line) {
  Write-Host $line
  Add-Content -LiteralPath $runLog -Value $line -Encoding UTF8
}
function Step([string]$name, [string]$file, [string]$arguments, [string]$transcript) {
  Log "step $name start $(Get-Date -Format o): $file $arguments"
  try {
    $p = Start-Process -FilePath $file -ArgumentList $arguments -Wait -PassThru -NoNewWindow `
      -RedirectStandardOutput "$transcript.out.log" -RedirectStandardError "$transcript.err.log"
    $code = $p.ExitCode
  } catch { $code = "not started: $_" }
  $results[$name] = $code
  Log "step $name exit $code"
  if (Test-Path "$transcript.out.log") { Get-Content "$transcript.out.log" | ForEach-Object { Write-Host "  $_" } }
}
function Vc([string]$when) {
  Log "vc ${when}: System32\vcruntime140.dll exists: $(Test-Path "$env:SystemRoot\System32\vcruntime140.dll")"
  Log "vc ${when}: registry VC\Runtimes\x64 exists: $(Test-Path 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64')"
}
function Sig([string]$path) {
  if (!(Test-Path -LiteralPath $path)) { Log "signature ${path}: file missing"; return }
  $s = Get-AuthenticodeSignature -LiteralPath $path
  Log "signature ${path}: Status=$($s.Status) Signer=$($s.SignerCertificate.Subject)"
}
function Save-Logs([string]$from, [string]$to) {
  # The smoke copies lib\ into "<LogDir>\tc4-poison resources"; keep that off the host.
  & robocopy.exe $from $to /E /XD 'tc4-poison resources' /NFL /NDL /NJH /NJS | Out-Null
}

New-Item -ItemType Directory -Force $out, C:\tmp, C:\t\z, C:\l1, C:\l2 | Out-Null
Remove-Item "$out\DONE" -ErrorAction SilentlyContinue
$env:TEMP = $env:TMP = 'C:\tmp'
Log "witness start $(Get-Date -Format o) (UTC $([DateTime]::UtcNow.ToString('o')))"
$os = Get-CimInstance Win32_OperatingSystem
Log "machine: $($os.Caption) $($os.Version) $($os.OSArchitecture), user $env:USERNAME"
Log "network adapters up: $(@(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up').Count)"
foreach ($f in $zip, $installer) {
  Log "input: $f, $((Get-Item $f).Length) bytes, sha256 $((Get-FileHash $f -Algorithm SHA256).Hash.ToLower())"
}
Vc 'before'

# 1. Zip path.
Step 'zip-unpack' "$env:SystemRoot\System32\tar.exe" "-xf `"$zip`" -C C:\t\z" "$out\zip-unpack"
$zipApp = 'C:\t\z\translationCore4'
Step 'zip-smoke' 'powershell.exe' "-NoProfile -ExecutionPolicy Bypass -File `"$zipApp\smoke-installed.ps1`" -AppDir `"$zipApp`" -SmokeHome C:\h1 -LogDir C:\l1" "$out\zip-smoke"
Save-Logs C:\l1 "$out\l1"

# 2. Installer path.
Copy-Item -LiteralPath $installer -Destination C:\t\setup.exe
Step 'install' 'C:\t\setup.exe' '/VERYSILENT /SUPPRESSMSGBOXES /SP- /NORESTART /LOG="C:\l2\install.log"' "$out\install"
$app = Join-Path $env:LOCALAPPDATA 'Programs\translationCore4'
Step 'installer-smoke' 'powershell.exe' "-NoProfile -ExecutionPolicy Bypass -File `"$app\smoke-installed.ps1`" -AppDir `"$app`" -SmokeHome C:\h2 -LogDir C:\l2" "$out\installer-smoke"
Save-Logs C:\l2 "$out\l2"
Vc 'after'

# 3. Signing state (#456).
Sig $installer
Sig "$app\electronite\electron.exe"
Sig "$app\bin\server.exe"
Get-ChildItem "$app\unins*.exe" -ErrorAction SilentlyContinue | ForEach-Object { Sig $_.FullName }

# 4. Start the installed app from its Start menu shortcut, under the real profile, and
#    take a picture of the screen (#214: title bar and menu on Windows).
try {
  $lnk = Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter '*.lnk' | Where-Object Name -like 'translationCore*' | Select-Object -First 1
  if ($lnk) {
    $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk.FullName)
    Log "shortcut: $($lnk.FullName) -> $($sc.TargetPath) $($sc.Arguments)"
    Start-Process -FilePath $lnk.FullName
  } else {
    Log 'shortcut: no Start menu shortcut found; starting electron.exe directly'
    Start-Process -FilePath "$app\electronite\electron.exe" -ArgumentList "`"$app\electron`"" -WorkingDirectory $app
  }
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type @"
using System; using System.Runtime.InteropServices;
public class U { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i); }
"@
  $w = $null
  for ($i = 0; $i -lt 60; $i++) {
    $w = Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' } | Select-Object -First 1
    if ($w) { break }
    Start-Sleep -Seconds 2
  }
  if ($w) {
    $style = [U]::GetWindowLong($w.MainWindowHandle, -16)
    Log "window: '$($w.MainWindowTitle)' pid $($w.Id); WS_CAPTION (native title bar) set: $(($style -band 0x00C00000) -eq 0x00C00000)"
    Start-Sleep -Seconds 15
    [U]::SetForegroundWindow($w.MainWindowHandle) | Out-Null
    Start-Sleep -Seconds 2
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0, 0, 0, 0, $bmp.Size); $g.Dispose()
    $bmp.Save("$out\window.png", [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    Log "screenshot: $out\window.png ($($b.Width)x$($b.Height))"
    $results['launch'] = 0
  } else {
    Log 'window: no tC4 window after 120 s'
    $results['launch'] = 'no window'
  }
} catch { Log "launch step error: $_"; $results['launch'] = "error: $_" }

$summary = ($results.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join '; '
Log "witness end $(Get-Date -Format o): $summary"
Set-Content -LiteralPath "$out\DONE" -Value $summary -Encoding UTF8
Write-Host ''
Write-Host 'DONE. Look at the translationCore 4 window (title bar and menu).' -ForegroundColor Green
