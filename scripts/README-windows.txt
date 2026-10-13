translationCore4 — Windows pilot

Download and run the tC4 Windows installer. It installs for your Windows user
under AppData\Local\Programs\translationCore4. You can choose another folder.
An administrator password is not required for the default destination.
The installer creates a Start menu entry and offers a desktop shortcut.
Open translationCore4 from Start after installation. To keep it on the taskbar,
use Windows' Pin to taskbar command on the app.

A signed build has no "-unsigned" in its file name. Its installer names
unfoldingWord as the publisher. Windows can still show "Windows protected your PC" while the
publisher builds reputation. Select More info to see the publisher, then
Run anyway. An unsigned build shows "Unknown publisher", and your
organization's policy can block it. To check a signature, open the installer's
Properties, then the Digital Signatures tab. Record any warnings when
reporting a pilot result; the number can vary by machine.

On first launch, tC4 copies its bundled English resources into your profile.
No separate Node, Rust or Git installation is needed for the production app.
Projects and resources are stored in %USERPROFILE%\pankosmia\tc4-projects.
Settings are in %USERPROFILE%\pankosmia\tc4. Close tC4 before reinstalling.
Existing projects and resources are preserved on subsequent launches.

Uninstall through Windows Settings > Apps > Installed apps > translationCore4.
Uninstall removes the application and shortcuts. It leaves your projects,
resources and settings in your profile. Back them up before deleting them.

Portable fallback: extract the zip once, then run start-tc4.cmd.
This uses the same project store as the installed production app. Close one
copy before opening the other. The debug zip uses tc4-projects-debug instead;
its sample-project initialization requires Git.

Post-install smoke (close the app first): in PowerShell, run
  powershell -NoProfile -ExecutionPolicy Bypass -File "<install folder>\smoke-installed.ps1" -AppDir "<install folder>"
The smoke creates a temporary project, writes a verse, restarts, reads it back,
and deletes that project. It refuses to run while another tC4 server answers.
