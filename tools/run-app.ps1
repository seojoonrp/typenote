# Runs the debug build with the WebView2 DevTools protocol on port 9222, shows the window
# without stealing focus, plays a CDP step file (see cdp.mjs), then closes the app.
# The debug build loads the frontend from the dev server: run `npm run dev` first. -Release runs
# the release build (`npm run tauri build`), which has the frontend built in.
#   powershell -File tools/run-app.ps1 -Steps steps.json [-Pdf path\to\file.pdf] [-Release]
param([Parameter(Mandatory)][string]$Steps, [string]$Pdf, [switch]$Release)
$root = Split-Path -Parent $PSScriptRoot
if (-not $Pdf) { $Pdf = Join-Path $root "samples\sample-normal.pdf" }
$build = if ($Release) { "release" } else { "debug" }
$exe = Join-Path $root "src-tauri\target\$build\typenote.exe"
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class Win { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd); }
"@ -ErrorAction SilentlyContinue
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
$p = Start-Process -FilePath $exe -ArgumentList "`"$Pdf`"" -PassThru
for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 250; $p.Refresh(); if ($p.MainWindowHandle -ne 0) { break } }
[Win]::ShowWindow($p.MainWindowHandle, 4) | Out-Null   # SW_SHOWNOACTIVATE
node (Join-Path $PSScriptRoot "cdp.mjs") $Steps
# a normal close: the app saves unsaved edits first
$null = $p.CloseMainWindow()
if (-not $p.WaitForExit(8000)) { Write-Output "app did not close in 8s, killing"; Stop-Process -Id $p.Id -Force }
