# Helper de Entrada Win32 de Alta Velocidad para Windows 10/11
# Desarrollado por: Ing. Roosvelt Enriquez Gamez

Add-Type -AssemblyName System.Windows.Forms
$code = @'
using System;
using System.Runtime.InteropServices;
public class Win32Input {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, int extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
  
  public static void M(int x, int y) { SetCursorPos(x, y); }
  public static void C(int x, int y, uint f) { SetCursorPos(x, y); mouse_event(f, 0, 0, 0, 0); }
  public static void W(int d) { mouse_event(0x0800, 0, 0, (uint)d, 0); }
  public static void K(byte k, uint f) { keybd_event(k, 0, f, 0); }
}
'@
Add-Type -TypeDefinition $code -Language CSharp

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::WriteLine("WIN32_READY")

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim().Length -eq 0) { continue }
    try {
        Invoke-Expression $line
    } catch {
        # Ignorar errores individuales
    }
}
