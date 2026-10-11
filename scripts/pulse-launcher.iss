; pulse-launcher.iss — Inno Setup script for Pulse portable launcher
;
; Creates a single EXE that:
;   - First run: extracts the Electron app to .pulse-app/ next to itself, shows progress
;   - Subsequent runs: detects existing extraction, launches directly (~1 sec)
;   - Updates: detects version mismatch, re-extracts automatically
;
; Build: ISCC /DAppVersion=1.0.0 /DSourcePath=...\win-unpacked pulse-launcher.iss

; ── Configurable defines (passed from build script) ──────────────────────────

#ifndef AppVersion
  #define AppVersion "1.0.0-preview"
#endif

#ifndef SourcePath
  #define SourcePath "..\dist\win-unpacked"
#endif

#ifndef OutputDir
  #define OutputDir "..\dist"
#endif

#ifndef IconPath
  #define IconPath "..\build\icon.ico"
#endif

; ── Setup configuration ──────────────────────────────────────────────────────

[Setup]
AppName=Pulse by BaringaSoft
AppVersion={#AppVersion}
DefaultDirName={src}\.pulse-app
PrivilegesRequired=lowest

; Fully portable — no uninstaller, no registry, no Start Menu
Uninstallable=no
CreateUninstallRegKey=no
DisableProgramGroupPage=yes

; Skip all wizard pages — go straight to extraction progress bar
DisableWelcomePage=yes
DisableDirPage=yes
DisableReadyPage=yes
DisableFinishedPage=yes

; Branding
WizardStyle=modern
SetupIconFile={#IconPath}

; Output
OutputBaseFilename=PULSE
OutputDir={#OutputDir}

; Close running instance before extracting (Restart Manager API)
CloseApplications=force

; Compression
Compression=lzma2/ultra64
SolidCompression=yes


; ── Customize the "Installing" page text ─────────────────────────────────────

[Messages]
SetupWindowTitle=Pulse by BaringaSoft
InstallingLabel=Setting up Pulse...
StatusExtractFiles=Unpacking files... %1

; ── Files to pack ────────────────────────────────────────────────────────────

[InstallDelete]
; Clear out the old version's app files so nothing removed since then lingers.
; {app} is the hidden .pulse-app folder; PulseData (next to PULSE.exe) is untouched.
Type: filesandordirs; Name: "{app}\resources"
Type: filesandordirs; Name: "{app}\locales"

[Files]
Source: "{#SourcePath}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; ── Pascal code: extract-once logic + launcher ───────────────────────────────

[Code]

// Windows API — set env var so child process inherits it
function SetEnvironmentVariableW(lpName, lpValue: String): BOOL;
  external 'SetEnvironmentVariableW@kernel32.dll stdcall';

// ── Path helpers ──────────────────────────────────────────────────────────

function GetLauncherDir: String;
begin
  // {src} = directory containing this setup EXE
  Result := ExpandConstant('{src}');
end;

function GetAppDir: String;
begin
  Result := GetLauncherDir + '\.pulse-app';
end;

function GetVersionFilePath: String;
begin
  Result := GetAppDir + '\.version';
end;

function GetInnerExePath: String;
begin
  Result := GetAppDir + '\Pulse by BaringaSoft.exe';
end;

// ── Version check ─────────────────────────────────────────────────────────

function IsAlreadyExtracted: Boolean;
var
  StoredVersion: AnsiString;
begin
  Result := False;
  if FileExists(GetVersionFilePath) and FileExists(GetInnerExePath) then
  begin
    if LoadStringFromFile(GetVersionFilePath, StoredVersion) then
    begin
      if Trim(StoredVersion) = '{#AppVersion}' then
        Result := True;
    end;
  end;
end;

// ── Collect non-Inno command line args (for .pulse file association) ───────

function GetAppArgs: String;
var
  I: Integer;
  Arg: String;
begin
  Result := '';
  for I := 1 to ParamCount do
  begin
    Arg := ParamStr(I);
    // Skip Inno Setup's own args (start with /)
    if (Length(Arg) > 0) and (Arg[1] <> '/') then
    begin
      if Result <> '' then
        Result := Result + ' ';
      Result := Result + '"' + Arg + '"';
    end;
  end;
end;

// ── Launch the real Electron app ──────────────────────────────────────────

procedure LaunchApp;
var
  ExePath, LauncherDir, Args: String;
  ResultCode: Integer;
begin
  ExePath := GetInnerExePath;
  LauncherDir := GetLauncherDir;
  Args := GetAppArgs;

  // Set PORTABLE_EXECUTABLE_DIR so Electron's getPortableDataDir()
  // finds PulseData/ next to the launcher (not next to the inner EXE)
  SetEnvironmentVariableW('PORTABLE_EXECUTABLE_DIR', LauncherDir);

  Exec(ExePath, Args, LauncherDir, SW_SHOW, ewNoWait, ResultCode);
end;

// ── Close running instance before extraction ─────────────────────────────

function IsPulseRunning: Boolean;
var
  ResultCode: Integer;
begin
  // find exits 0 only when tasklist lists the process
  Result := Exec(ExpandConstant('{cmd}'),
       '/C tasklist /NH /FI "IMAGENAME eq Pulse by BaringaSoft.exe" | find /I "Pulse by BaringaSoft.exe" >NUL',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

procedure CloseRunningInstance;
var
  ResultCode, Waited: Integer;
begin
  if not IsPulseRunning then
    Exit;
  // Ask first: taskkill without /F sends the window a normal close, so Pulse
  // saves edits still being typed and makes its quit backup.
  Exec('taskkill.exe', '/IM "Pulse by BaringaSoft.exe"',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Waited := 0;
  while IsPulseRunning and (Waited < 20000) do
  begin
    Sleep(500);
    Waited := Waited + 500;
  end;
  // Still running after 20 seconds (stuck, or kept open in the background):
  // force it so the files can be replaced. /T = child processes too.
  if IsPulseRunning then
    Exec('taskkill.exe', '/F /IM "Pulse by BaringaSoft.exe" /T',
         '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  // Brief pause to let Windows release file locks
  Sleep(500);
end;

// ── Entry point: decide whether to extract or just launch ─────────────────

function InitializeSetup: Boolean;
begin
  if IsAlreadyExtracted then
  begin
    // Version matches — launch directly, skip extraction
    LaunchApp;
    Result := False;
  end
  else
  begin
    // Version update — close the running instance before extraction
    CloseRunningInstance;
    Result := True;
  end;
end;

// ── Post-extraction: stamp version, hide folder, launch ───────────────────

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    // Write version stamp so subsequent launches skip extraction
    SaveStringToFile(GetVersionFilePath, '{#AppVersion}', False);

    // Hide .pulse-app folder (Windows hidden attribute)
    Exec('cmd.exe', '/c attrib +h "' + GetAppDir + '"',
         '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

    // Launch the app
    LaunchApp;
  end;
end;
