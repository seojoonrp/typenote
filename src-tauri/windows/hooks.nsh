; NSIS hooks for the typenote installer (bundle.windows.nsis.installerHooks).

!macro NSIS_HOOK_POSTINSTALL
  ; Windows caches app icons by exe path, so after an update with a new logo the taskbar and the
  ; Start menu keep showing the old one. Refresh the user's icon cache (64-bit ie4uinit when the
  ; installer runs as a 32-bit process on 64-bit Windows).
  IfFileExists "$WINDIR\Sysnative\ie4uinit.exe" 0 +3
    ExecWait '"$WINDIR\Sysnative\ie4uinit.exe" -show'
    Goto +2
  ExecWait '"$SYSDIR\ie4uinit.exe" -show'
!macroend
