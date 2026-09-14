; Script de Extensiones NSIS (Estilo InstallShield)
; Desarrollado por: Ing. Roosvelt Enriquez Gamez

!macro customInstall
  DetailPrint "Configurando componentes de acceso remoto y dependencias de red..."
  ; Registrar regla de Firewall de Windows para permitir WebSockets si es necesario
  ExecWait 'netsh advfirewall firewall add rule name="Roosvelt Remote Desktop" dir=in action=allow program="$INSTDIR\Roosvelt Remote Desktop.exe" enable=yes'
!macroend

!macro customUnInstall
  DetailPrint "Limpiando reglas de red y componentes..."
  ExecWait 'netsh advfirewall firewall delete rule name="Roosvelt Remote Desktop"'
!macroend
