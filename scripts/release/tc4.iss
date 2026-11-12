; The Windows installer (card G3), ported from tC4 scripts/tc4.iss: a per-user install with no
; elevation, made from the staged folder the smoke test ran. The build defines Payload, Output
; and Version, and Sign when it signs (sign-windows.ps1 through the tc4sign tool).
#ifndef Payload
  #error Payload must name the staged app folder
#endif
#ifndef Output
  #error Output must name the artifact folder
#endif
#ifndef Version
  #error Version must name the application version
#endif
[Setup]
; Not tC4's AppId: this is a different program, and sharing the id would make one installer
; uninstall the other.
AppId={{6E0C2B4A-3F1D-4C55-9B7E-2D8A41C0F7E3}
AppName=translationCore 4
AppVersion={#Version}
AppPublisher=unfoldingWord
DefaultDirName={localappdata}\Programs\translationCore 4
DefaultGroupName=translationCore 4
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
DisableProgramGroupPage=yes
OutputDir={#Output}
#ifdef Sign
SignTool=tc4sign
SignedUninstaller=yes
OutputBaseFilename=translationCore4-{#Version}-windows-x64
#else
OutputBaseFilename=translationCore4-{#Version}-windows-x64-unsigned
#endif
SetupIconFile={#Payload}\icon.ico
UninstallDisplayIcon={app}\icon.ico
LicenseFile={#Payload}\LICENSE
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "{#Payload}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\translationCore 4"; Filename: "{app}\electron.exe"; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; AppUserModelID: "org.unfoldingword.translationcore4"
Name: "{autodesktop}\translationCore 4"; Filename: "{app}\electron.exe"; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; AppUserModelID: "org.unfoldingword.translationcore4"; Tasks: desktopicon
; No UninstallDelete section: projects, resources and settings live outside {app} and stay
; (tC4 #44). No vc_redist step: tc4.exe is built with the static C runtime (tC4 #284), which
; keeps PrivilegesRequired=lowest true.

[Code]
// #1016: Setup writes this build's files over an installed one and leaves a file this build no
// longer has, such as the older build's UI folder, whose name is a hash. Before the files are
// written, every file the installed build's BUILD-MANIFEST.json names is removed, and each folder
// that leaves empty. Nothing else in the folder is touched: a person may have installed into a
// folder that holds their own files. The manifest has one "path" on a line, with forward slashes.
procedure RemoveTheInstalledBuildsFiles();
var
  Lines: TArrayOfString;
  I, Quote: Integer;
  Line, Path, Dir, App: String;
begin
  App := ExpandConstant('{app}');
  if not LoadStringsFromFile(App + '\BUILD-MANIFEST.json', Lines) then
    Exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
  begin
    Line := Trim(Lines[I]);
    if Pos('"path": "', Line) = 1 then
    begin
      Path := Copy(Line, 10, Length(Line));
      Quote := Pos('"', Path);
      if Quote > 1 then
      begin
        Path := Copy(Path, 1, Quote - 1);
        // A path inside the folder, with no escape to read.
        if (Pos('\', Path) = 0) and (Pos('..', Path) = 0) and (Pos(':', Path) = 0) and (Path[1] <> '/') then
        begin
          StringChangeEx(Path, '/', '\', True);
          Path := App + '\' + Path;
          DeleteFile(Path);
          Dir := ExtractFileDir(Path);
          while (Length(Dir) > Length(App)) and RemoveDir(Dir) do
            Dir := ExtractFileDir(Dir);
        end;
      end;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
    RemoveTheInstalledBuildsFiles();
end;
