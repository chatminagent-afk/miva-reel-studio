; Installer Windows MIVA Reel Studio (Inno Setup 6). Dibangun CI dari release\win-unpacked (electron-builder --dir).
; Total ±3 GB (Chrome headless, FFmpeg, Python + faster-whisper + DLL CUDA, model large-v3-turbo), jadi installer
; dipecah: MIVA-Reel-Studio-Setup-<versi>.exe + -1.bin, -2.bin, ... (masing-masing < 2 GB, batas aset GitHub Release).
; Taruh semua file di satu folder lalu jalankan .exe. Pasang per pengguna (tanpa admin/UAC).
#define AppName "MIVA Reel Studio"
#define AppExe "MIVA Reel Studio.exe"
#define AppVersion GetEnv("APP_VERSION")
#if AppVersion == ""
  #define AppVersion "0.0.0-dev"
#endif

[Setup]
AppId={{6F2B8C1E-3D4A-4E7B-9A51-2C8D0E6F4B13}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=MIVA
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\release\installer
OutputBaseFilename=MIVA-Reel-Studio-Setup-{#AppVersion}
Compression=lzma2/normal
SolidCompression=no
DiskSpanning=yes
DiskSliceSize=2000000000
WizardStyle=modern
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "..\release\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent
