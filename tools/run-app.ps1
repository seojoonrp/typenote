# Runs the debug build with the WebView2 DevTools protocol on port 9222, shows the window
# without stealing focus, plays a CDP step file (see cdp.mjs), then closes the app.
# The debug build loads the frontend from the dev server: run `npm run dev` first.
#   powershell -File tools/run-app.ps1 -Steps steps.json [-Pdf path\to\file.pdf]
param([Parameter(Mandatory)][string]$Steps, [string]$Pdf)
$root = Split-Path -Parent $PSScriptRoot
if (-not $Pdf) { $Pdf = Join-Path $root "samples\sample-normal.pdf" }
$exe = Join-Path $root "src-tauri\target\debug\typenote.exe"
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class Win { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd); }
"@ -ErrorAction SilentlyContinue
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
$p = Start-Process -FilePath $exe -ArgumentList "`"$Pdf`"" -PassThru
for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 250; $p.Refresh(); if ($p.MainWindowHandle -ne 0) { break } }
[Win]::ShowWindow($p.MainWindowHandle, 4) | Out-Null   # SW_SHOWNOACTIVATE
node (Join-Path $PSScriptRoot "cdp.mjs") $Steps
$null = $p.CloseMainWindow()
Start-Sleep -Seconds 1
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
