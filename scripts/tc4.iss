; Production payload is the same staged folder tested by package-desktop.zsh.
; These defines are supplied by the build; fail at compile time if missing.
#ifndef Payload
  #error Payload must name the tested staging directory
#endif
#ifndef Output
  #error Output must name the artifact directory
#endif
#ifndef Version
  #error Version must name the application version
#endif
[Setup]
AppId={{24B10730-6260-4EB7-A2EA-F3F19C90F242}
AppName=translationCore4
AppVersion={#Version}
AppPublisher=unfoldingWord
DefaultDirName={localappdata}\Programs\translationCore4
DefaultGroupName=translationCore4
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
DisableProgramGroupPage=yes
OutputDir={#Output}
OutputBaseFilename=tC4-{#Version}-windows-x64-unsigned
SetupIconFile={#Payload}\icon.ico
UninstallDisplayIcon={app}\electronite\electron.exe
InfoBeforeFile={#Payload}\README.txt
LicenseFile={#Payload}\LICENSE
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "{#Payload}\*"; DestDir: "{app}"; Excludes: "start-tc4.cmd,smoke-installed.zsh"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\translationCore4"; Filename: "{app}\electronite\electron.exe"; Parameters: """{app}\electron"""; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; AppUserModelID: "org.unfoldingword.translationcore4"
Name: "{autodesktop}\translationCore4"; Filename: "{app}\electronite\electron.exe"; Parameters: """{app}\electron"""; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; AppUserModelID: "org.unfoldingword.translationcore4"; Tasks: desktopicon
; No Run or UninstallDelete section: launch as the user from Start, and leave
; their projects/settings/resources outside {app} intact on uninstall.
