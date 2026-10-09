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

// ── Kill running instance before extraction ──────────────────────────────

procedure KillRunningInstance;
var
  ResultCode: Integer;
begin
  // Silently kill any running Pulse process so DLLs are unlocked.
  // /F = force, /IM = image name, /T = kill child processes.
  // Exit code is ignored — it's fine if the process isn't running.
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
    // Version update — kill running instance before extraction
    KillRunningInstance;
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
