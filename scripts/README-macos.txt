translationCore4 — Mac pilot build

INSTALL
1. Open the .pkg file. This pilot installer is unsigned. If macOS blocks it,
   open System Settings > Privacy & Security, find the blocked installer,
   and choose Open Anyway. Then continue in Installer.
   If Open Anyway does nothing (seen on macOS 26), clear the download flag:
   open Terminal, type the following command including the trailing space,
   drag the .pkg from Finder into Terminal, press Return, then open the .pkg
   again.

   xattr -d com.apple.quarantine

2. Enter an administrator password when Installer asks for it.
3. Open Applications > translationCore4 (or find it in Launchpad).

The app has the translationCore icon in Finder and the Dock. To keep a Dock
shortcut after you quit, Control-click its Dock icon > Options > Keep in Dock.
Quit tC4 before installing a newer build.

This is a test build. The app has an ad-hoc signature, not an Apple Developer ID
signature, and is not notarized. Signing/notarization is tracked in issue #44.
The clean macOS 15 approval-count witness is tracked in issue #243. If macOS
also blocks the installed app, record that prompt and report it on #243.

YOUR PROJECTS
Production projects: ~/pankosmia/tc4-projects
Debug projects: ~/pankosmia/tc4-projects-debug
Existing projects and installed resources are kept when you install a new build.
The app seeds its bundled English resources on first launch. The DEBUG zip also
seeds a sample project; that developer build needs Git installed.

WITHOUT ADMINISTRATOR ACCESS (ZIP FALLBACK)
Unzip the production or DEBUG zip. Move its .app to a folder you can write to,
such as ~/Applications, and open the app. No .command launcher is needed.
If quarantine blocks the app, open Terminal and type the following command,
including the trailing space, then drag the unpacked .app from Finder into
Terminal and press Return:

xattr -dr com.apple.quarantine 

For example, for the production app in your personal Applications folder:
xattr -dr com.apple.quarantine "$HOME/Applications/translationCore4.app"

UNINSTALL
Quit tC4 and move its app from Applications to Trash. Your projects are retained.
You do not need to remove the install receipt to uninstall or reinstall.

HELP AND LICENSES
https://github.com/unfoldingWord/translationCore4/issues/243
In Finder, Control-click the app > Show Package Contents > Contents > Resources.
This folder contains LICENSE, licenses, THIRD-PARTY-NOTICES.md,
BUILD-MANIFEST.json, and smoke-installed.zsh for diagnostic checks.
