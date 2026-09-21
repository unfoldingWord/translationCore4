# Installed Windows proof for #242/#45. Uses only PowerShell and shipped binaries.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$AppDir,
  [string]$SmokeHome = $env:USERPROFILE,
  [string]$LogDir = $env:TEMP,
  [switch]$KeepProject
)
$ErrorActionPreference = 'Stop'
$AppDir = (Resolve-Path -LiteralPath $AppDir).Path
$exe = Join-Path $AppDir 'electronite\electron.exe'
$serverExe = Join-Path $AppDir 'bin\server.exe'
$main = Join-Path $AppDir 'electron'
foreach ($file in @($exe, $serverExe, "$AppDir\smoke-api.cjs", "$AppDir\smoke-journal.cjs", "$AppDir\BUILD-MANIFEST.json")) {
  if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing installed file: $file" }
}
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$abbr = "smoke_$stamp"
$repo = "_local_/_local_/$abbr"
$marker = "tC4 smoke verse $stamp"
$script:appProcess = $null
$script:serverProcess = $null
$script:port = $null
$oldEnv = @{}
$names = @('USERPROFILE','HOME','APPDATA','LOCALAPPDATA','TEMP','TMP','APP_RESOURCES_DIR','ELECTRON_ENABLE_LOGGING','ELECTRON_LOG_FILE','ELECTRON_RUN_AS_NODE')
foreach ($name in $names) { $oldEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
function Find-Port {
  foreach ($p in 19119..19139) {
    try {
      $v = Invoke-RestMethod "http://127.0.0.1:$p/api/version" -TimeoutSec 1
      if ($v.product_short_name -eq 'tc4') { return $p }
    } catch { }
  }
  return $null
}
function Start-App([string]$label) {
  $env:ELECTRON_LOG_FILE = Join-Path $LogDir "tc4-$label-electron.log"
  $script:appProcess = Start-Process -FilePath $exe -ArgumentList "`"$main`"" -WorkingDirectory $AppDir -PassThru
  for ($i = 0; $i -lt 60; $i++) {
    $script:port = Find-Port
    if ($script:port) { break }
    if ($script:appProcess.HasExited) { throw "App exited before server boot: $($script:appProcess.ExitCode)" }
    Start-Sleep -Seconds 1
  }
  if (!$script:port) { throw 'No tC4 server after launch' }
  $connection = @(Get-NetTCPConnection -LocalPort $script:port -State Listen)[0]
  $script:serverProcess = Get-Process -Id $connection.OwningProcess
  if ($script:serverProcess.Path -ine $serverExe) { throw "Server is not the installed binary: $($script:serverProcess.Path)" }
  if ($script:appProcess.HasExited) { throw 'Electron exited while server remained alive' }
  Write-Host "ok $label start: installed app PID $($script:appProcess.Id), server PID $($script:serverProcess.Id), port $script:port"
}
function Stop-App {
  if ($script:appProcess) {
    if (!$script:appProcess.HasExited) {
      & "$env:SystemRoot\System32\taskkill.exe" /PID $script:appProcess.Id /T /F | Out-Host
    }
    $script:appProcess = $null
  }
  if ($script:serverProcess) {
    if (!$script:serverProcess.HasExited) { Stop-Process -Id $script:serverProcess.Id -Force }
    $script:serverProcess.WaitForExit(10000) | Out-Null
    if (!$script:serverProcess.HasExited) { throw 'Installed server did not stop' }
    $script:serverProcess = $null
  }
}
function Run-Steps([string]$mode) {
  $env:ELECTRON_RUN_AS_NODE = '1'
  try {
    $out = Join-Path $LogDir "api-$mode-$stamp.log"
    $err = Join-Path $LogDir "api-$mode-$stamp.err"
    $argsList = @("`"$AppDir\smoke-api.cjs`"", "http://127.0.0.1:$script:port", $repo, $abbr, "`"$marker`"", $mode, "`"$store`"")
    $p = Start-Process -FilePath $exe -ArgumentList $argsList -PassThru -Wait -RedirectStandardOutput $out -RedirectStandardError $err
    Get-Content -LiteralPath $out | Write-Host
    Get-Content -LiteralPath $err | Write-Host
    if ($p.ExitCode -ne 0) { throw "API smoke $mode failed: $($p.ExitCode)" }
  } finally { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
}
function Run-RealClientSmoke {
  $env:ELECTRON_RUN_AS_NODE = '1'
  try {
    $out = Join-Path $LogDir "journal-$stamp.log"
    $err = Join-Path $LogDir "journal-$stamp.err"
    $argsList = @("`"$AppDir\smoke-journal.cjs`"", "http://127.0.0.1:$script:port/api", $abbr, "`"$marker`"", "`"$store`"")
    $p = Start-Process -FilePath $exe -ArgumentList $argsList -PassThru -Wait -RedirectStandardOutput $out -RedirectStandardError $err
    Get-Content -LiteralPath $out | Write-Host
    Get-Content -LiteralPath $err | Write-Host
    if ($p.ExitCode -ne 0) { throw "real-client OBS smoke failed: $($p.ExitCode)" }
  } finally { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
}
try {
  # Negative control: refuse to touch a server the smoke did not start.
  $existing = Find-Port
  if ($existing) { throw "Close the existing tC4 on port $existing before running this smoke" }
  Write-Host 'ok precondition: no existing tC4 server'
  New-Item -ItemType Directory -Force -Path $SmokeHome, $LogDir | Out-Null
  $SmokeHome = (Resolve-Path -LiteralPath $SmokeHome).Path
  $env:USERPROFILE = $SmokeHome
  $env:HOME = $SmokeHome
  $env:APPDATA = Join-Path $SmokeHome 'AppData\Roaming'
  $env:LOCALAPPDATA = Join-Path $SmokeHome 'AppData\Local'
  $env:TEMP = $env:TMP = Join-Path $SmokeHome 'tmp'
  New-Item -ItemType Directory -Force -Path $env:APPDATA, $env:LOCALAPPDATA, $env:TEMP | Out-Null
  $poisonRoot = Join-Path $LogDir 'tc4-poison resources'
  Remove-Item -LiteralPath $poisonRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $poisonRoot | Out-Null
  Copy-Item -LiteralPath (Join-Path $AppDir 'lib') -Destination (Join-Path $poisonRoot 'lib') -Recurse
  $poisonProductFile = Join-Path $poisonRoot 'lib\product\product.json'
  $poisonProduct = Get-Content -Raw -LiteralPath $poisonProductFile | ConvertFrom-Json
  $poisonProduct.version = '4.0.0-poison-old'
  $poisonProduct.datetime = '2000-01-01T00:00:00Z'
  [IO.File]::WriteAllText($poisonProductFile, (($poisonProduct | ConvertTo-Json -Depth 20) + "`n"), [Text.UTF8Encoding]::new($false))
  $poisonStoryFile = Join-Path $poisonRoot 'lib\templates\content_templates\text_stories\ingredients\content\01.md'
  $poisonStory = [IO.File]::ReadAllText($poisonStoryFile) -replace "`r?`n", "`r`n"
  [IO.File]::WriteAllText($poisonStoryFile, $poisonStory, [Text.UTF8Encoding]::new($false))
  $env:APP_RESOURCES_DIR = Join-Path $poisonRoot 'lib'
  $env:ELECTRON_ENABLE_LOGGING = 'file'
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  Start-App first
  $second = Start-Process -FilePath $exe -ArgumentList "`"$main`"" -WorkingDirectory $AppDir -PassThru
  try {
    if (!$second.WaitForExit(15000)) { throw 'Second launch did not exit under singleton guard' }
    $servers = @(Get-Process server -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq $serverExe })
    if ($servers.Count -ne 1 -or $script:appProcess.HasExited) { throw 'Singleton guard did not retain exactly one installed app/server' }
  } finally { if (!$second.HasExited) { Stop-Process -Id $second.Id -Force } }
  Write-Host 'ok singleton: second launch exited, first remains'
  # curl.exe does not follow redirects unless requested, so verify the root 303.
  $root = & "$env:SystemRoot\System32\curl.exe" -s --max-time 10 -o NUL -w '%{http_code} %{redirect_url}' "http://127.0.0.1:$script:port/"
  if ($LASTEXITCODE -ne 0 -or $root -notmatch '^303 .*/clients/uw-tc4$') { throw "Root redirect: $root" }
  $client = Invoke-WebRequest "http://127.0.0.1:$script:port/clients/uw-tc4" -UseBasicParsing
  if ($client.StatusCode -ne 200) { throw 'Client did not return 200' }
  Write-Host 'ok client: root 303, tC4 client 200'
  # VERSION GUARD (#326): the server must report this install's own
  # lib/product/product.json version and datetime, not another tree's.
  $product = Get-Content -Raw -LiteralPath "$AppDir\lib\product\product.json" | ConvertFrom-Json
  $live = Invoke-RestMethod "http://127.0.0.1:$script:port/api/version" -TimeoutSec 10
  if ($live.product_version -cne $product.version -or $live.product_date_time -cne $product.datetime) { throw "Version mismatch: /api/version $($live.product_version)/$($live.product_date_time) != lib/product/product.json $($product.version)/$($product.datetime) (#326)" }
  Write-Host "ok version: /api/version matches lib/product/product.json ($($product.version), $($product.datetime))"
  $settings = Get-Content -Raw -LiteralPath "$SmokeHome\pankosmia\tc4\user_settings.json" | ConvertFrom-Json
  $manifest = Get-Content -Raw -LiteralPath "$AppDir\BUILD-MANIFEST.json" | ConvertFrom-Json
  $leaf = if ($manifest.variant -eq 'debug') { 'tc4-projects-debug' } else { 'tc4-projects' }
  $store = Join-Path $SmokeHome "pankosmia\$leaf"
  if ([IO.Path]::GetFullPath($settings.repo_dir) -ine $store) { throw "Wrong project store: $($settings.repo_dir)" }
  Write-Host "ok store: $store"
  Run-Steps source
  Run-Steps obs-image
  Run-Steps obs-template-probe
  Run-Steps obs-create
  Run-RealClientSmoke
  Run-Steps create
  $onDisk = Join-Path $store "$repo/ingredients/TIT.usfm"
  if (!(Get-Content -LiteralPath $onDisk | Where-Object { $_ -ceq "\v 1 $marker" })) { throw 'Written verse missing on disk' }
  $firstServer = $script:serverProcess.Id
  Stop-App
  $settingsFile = Join-Path $SmokeHome 'pankosmia\tc4\user_settings.json'
  $settings = Get-Content -Raw -LiteralPath $settingsFile | ConvertFrom-Json
  $settings.app_resources_dir = (Join-Path $poisonRoot 'lib') + '\'
  [IO.File]::WriteAllText($settingsFile, (($settings | ConvertTo-Json -Depth 20) + "`n"), [Text.UTF8Encoding]::new($false))
  Start-App second
  if ($script:serverProcess.Id -eq $firstServer) { throw 'Server did not restart' }
  $repaired = Get-Content -Raw -LiteralPath $settingsFile | ConvertFrom-Json
  $expectedResources = [IO.Path]::GetFullPath((Join-Path $AppDir 'lib')) + '\'
  if ($repaired.app_resources_dir -ine $expectedResources) { throw "Packaged resource binding did not repair user_settings.json: $($repaired.app_resources_dir)" }
  Write-Host "ok resources: poisoned parent and saved profile rebound to $expectedResources"
  Run-Steps version
  Run-Steps obs-template-probe
  Run-RealClientSmoke
  Run-Steps readback
  Run-Steps obs-image
  Run-Steps obs-readback
  if (!$KeepProject) { Run-Steps delete }
  Stop-App
  Write-Host "SMOKE OK: $AppDir under USERPROFILE=$SmokeHome; store $store"
} finally {
  Stop-App
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $oldEnv[$name], 'Process') }
}
