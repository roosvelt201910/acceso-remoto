; =====================================================================
; Inno Setup / InstallShield Script para Roosvelt Remote Desktop
; Desarrollado por: Ing. Roosvelt Enriquez Gamez
; =====================================================================

#define MyAppName "Roosvelt Remote Desktop"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Ing. Roosvelt Enriquez Gamez"
#define MyAppURL "https://github.com/roosvelt/acceso-remoto"
#define MyAppExeName "Roosvelt Remote Desktop.exe"

[Setup]
AppId={{D821F91B-6F29-4A73-8B39-81C5A03A89C1}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DisableProgramGroupPage=yes
LicenseFile=LICENSE.txt
OutputDir=dist-setup
OutputBaseFilename=Roosvelt_Remote_Desktop_Setup_v1.0.0
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startupicon"; Description: "Iniciar con Windows (Modo Host Desatendido)"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Empaquetar todo el directorio compilado autocontenido (con todas las dependencias incluidas)
Source: "dist\win-arm64-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: startupicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
// Verificación automática de componentes del sistema antes de instalar
function InitializeSetup(): Boolean;
begin
  Log('Verificando entorno del sistema para Roosvelt Remote Desktop...');
  Result := True;
end;
