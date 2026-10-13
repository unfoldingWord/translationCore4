# Sign the Windows build with Azure Artifact Signing (#456).
#
#   -Setup        Fetch the pinned signing tools into -ToolDir and write metadata.json.
#   -Sign <path>  Sign each file that has no signature, then require Valid.
#                 A folder means every .exe, .dll and .node file under it.
#                 A file is signed whatever its extension (Inno Setup passes .tmp files).
#
# package-desktop.zsh runs -Setup once, then -Sign on the staged app folder.
# Inno Setup runs -Sign on the installer and on its uninstaller (tc4.iss).
#
# A file that Microsoft or another publisher signed keeps its signature: only
# NotSigned files are signed. Any other non-Valid status stops the build.
#
# Authentication is the Azure EnvironmentCredential: AZURE_TENANT_ID,
# AZURE_CLIENT_ID and AZURE_CLIENT_SECRET, for an app registration that holds the
# "Artifact Signing Certificate Profile Signer" role on the certificate profile.
param(
  [Parameter(Mandatory = $true)][string]$ToolDir,
  [switch]$Setup,
  [string[]]$Sign
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Pins. signtool must be 10.0.2261.755 or later, and not the 20348 SDK (Microsoft
# Learn, "Set up signing integrations to use Artifact Signing"). The dlib needs
# a .NET 8 or later runtime (its runtimeconfig.json rolls forward to a major).
$Packages = @(
  @{ Id = 'microsoft.windows.sdk.buildtools'; Version = '10.0.26100.4188'; Dir = 'buildtools'
     Sha256 = '180deb372659029864c10a0c04787833234d64aacd1d2c0661d2c00295d8e022' },
  @{ Id = 'microsoft.artifactsigning.client'; Version = '1.0.128'; Dir = 'client'
     Sha256 = '74bd7d27e6ce1051409c38d9b46bc8df0400ecd643d51ffbf2ac00869061e40b' }
)
$SignTool = Join-Path $ToolDir 'buildtools\bin\10.0.26100.0\x64\signtool.exe'
$Dlib = Join-Path $ToolDir 'client\bin\x64\Azure.CodeSigning.Dlib.dll'
$Metadata = Join-Path $ToolDir 'metadata.json'
$Timestamp = 'http://timestamp.acs.microsoft.com'

if ($Setup) {
  $required = 'AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_SIGNING_PROFILE',
              'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'
  $missing = @($required | Where-Object { -not [Environment]::GetEnvironmentVariable($_) })
  if ($missing.Count) { throw "Signing is on, but these values are empty: $($missing -join ', ')" }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  New-Item -ItemType Directory -Force -Path $ToolDir | Out-Null
  foreach ($p in $Packages) {
    $nupkg = Join-Path $ToolDir "$($p.Id).$($p.Version).nupkg"
    if (-not (Test-Path -LiteralPath $nupkg)) {
      Invoke-WebRequest -UseBasicParsing -OutFile $nupkg `
        -Uri "https://api.nuget.org/v3-flatcontainer/$($p.Id)/$($p.Version)/$($p.Id).$($p.Version).nupkg"
    }
    $actual = (Get-FileHash -LiteralPath $nupkg -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $p.Sha256) { throw "Checksum mismatch for $($p.Id) $($p.Version): expected $($p.Sha256), got $actual" }
    $dest = Join-Path $ToolDir $p.Dir
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
    [System.IO.Compression.ZipFile]::ExtractToDirectory($nupkg, $dest)
  }
  foreach ($tool in $SignTool, $Dlib) {
    if (-not (Test-Path -LiteralPath $tool)) { throw "Signing tool not found after setup: $tool" }
  }
  # EnvironmentCredential only: the other credential types would each be tried
  # first and fail on a CI runner.
  [ordered]@{
    Endpoint               = $env:AZURE_SIGNING_ENDPOINT
    CodeSigningAccountName = $env:AZURE_SIGNING_ACCOUNT
    CertificateProfileName = $env:AZURE_SIGNING_PROFILE
    ExcludeCredentials     = @('ManagedIdentityCredential', 'WorkloadIdentityCredential',
      'SharedTokenCacheCredential', 'VisualStudioCredential', 'VisualStudioCodeCredential',
      'AzureCliCredential', 'AzurePowerShellCredential', 'AzureDeveloperCliCredential',
      'InteractiveBrowserCredential')
  } | ConvertTo-Json | Set-Content -LiteralPath $Metadata -Encoding Ascii
  Write-Host "signing tools ready: signtool $($Packages[0].Version), Artifact Signing client $($Packages[1].Version)"
}

if ($Sign) {
  $files = @(foreach ($path in $Sign) {
    if (Test-Path -LiteralPath $path -PathType Container) {
      Get-ChildItem -LiteralPath $path -Recurse -File | Where-Object { $_.Extension -in '.exe', '.dll', '.node' }
    } else {
      Get-Item -LiteralPath $path
    }
  })
  $toSign = @()
  foreach ($f in $files) {
    $status = (Get-AuthenticodeSignature -LiteralPath $f.FullName).Status
    if ($status -eq 'NotSigned') { $toSign += $f.FullName }
    elseif ($status -ne 'Valid') { throw "$($f.FullName) has signature status $status; refusing to sign over it" }
  }
  # Batches keep each signtool command line well under the Windows limit.
  for ($i = 0; $i -lt $toSign.Count; $i += 50) {
    $batch = @($toSign[$i..([Math]::Min($i + 49, $toSign.Count - 1))])
    & $SignTool sign /v /fd SHA256 /tr $Timestamp /td SHA256 /dlib $Dlib /dmdf $Metadata @batch
    if ($LASTEXITCODE -ne 0) { throw "signtool failed (exit $LASTEXITCODE)" }
  }
  foreach ($path in $toSign) {
    $sig = Get-AuthenticodeSignature -LiteralPath $path
    if ($sig.Status -ne 'Valid' -or -not $sig.TimeStamperCertificate) {
      throw "$path is not Valid and timestamped after signing (status $($sig.Status))"
    }
  }
  Write-Host "signed $($toSign.Count) file(s); $($files.Count - $toSign.Count) already carried a valid signature"
}
