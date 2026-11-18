param([long]$Window, [byte]$Key, [switch]$Snapshot, [string]$Restore)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Native keyboard tests require an isolated GitHub Actions runner' }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class NativeZoomKeys {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint thread);
  [DllImport("user32.dll")] public static extern int GetKeyboardLayoutList(int count, IntPtr[] layouts);
  [DllImport("user32.dll")] public static extern bool UnloadKeyboardLayout(IntPtr layout);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr LoadKeyboardLayout(string name, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@
$target = [IntPtr]::new($Window)
$count = [NativeZoomKeys]::GetKeyboardLayoutList(0, $null)
$layouts = New-Object IntPtr[] $count
[NativeZoomKeys]::GetKeyboardLayoutList($count, $layouts) | Out-Null
if ($Snapshot) {
  $targetThread = [NativeZoomKeys]::GetWindowThreadProcessId($target, [IntPtr]::Zero)
  @{ layout = [NativeZoomKeys]::GetKeyboardLayout($targetThread).ToInt64(); loaded = @($layouts | ForEach-Object { $_.ToInt64() }) } | ConvertTo-Json -Compress
  exit
}
if ($Restore) {
  $saved = $Restore | ConvertFrom-Json
  [NativeZoomKeys]::SendMessage($target, 0x50, [IntPtr]::Zero, [IntPtr]::new([long]$saved.layout)) | Out-Null
  foreach ($layout in $layouts) {
    if ($layout.ToInt64() -notin $saved.loaded) {
      if (-not [NativeZoomKeys]::UnloadKeyboardLayout($layout)) { throw 'INV-ZOOM-KEYS: failed to unload test layout' }
    }
  }
  exit
}
$thread = [NativeZoomKeys]::GetCurrentThreadId()
$foreground = [NativeZoomKeys]::GetWindowThreadProcessId([NativeZoomKeys]::GetForegroundWindow(), [IntPtr]::Zero)
$attached = [NativeZoomKeys]::AttachThreadInput($thread, $foreground, $true)
try {
  [NativeZoomKeys]::SetForegroundWindow($target) | Out-Null
  if ([NativeZoomKeys]::GetForegroundWindow() -ne $target) { throw 'INV-ZOOM-KEYS: shell is not foreground' }
  $layout = [NativeZoomKeys]::LoadKeyboardLayout('0000040a', 0)
  [NativeZoomKeys]::SendMessage($target, 0x50, [IntPtr]::Zero, $layout) | Out-Null
  # Detaching resets keyboard state, so detach before injecting Ctrl and the sign.
  if ($attached) {
    [NativeZoomKeys]::AttachThreadInput($thread, $foreground, $false) | Out-Null
    $attached = $false
  }
  [NativeZoomKeys]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
  [NativeZoomKeys]::keybd_event($Key, 0, 0, [UIntPtr]::Zero)
  [NativeZoomKeys]::keybd_event($Key, 0, 2, [UIntPtr]::Zero)
  [NativeZoomKeys]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
} finally {
  if ($attached) { [NativeZoomKeys]::AttachThreadInput($thread, $foreground, $false) | Out-Null }
}
