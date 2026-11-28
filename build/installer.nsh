!macro customInstall
  IfFileExists "$INSTDIR\CutRoom.exe" old_cutroom_exe_exists old_cutroom_exe_missing
  old_cutroom_exe_exists:
    Goto cutroom_shortcut_cleanup_done
  old_cutroom_exe_missing:
    IfFileExists "$DESKTOP\CutRoom.lnk" 0 +2
    Delete "$DESKTOP\CutRoom.lnk"
    IfFileExists "$SMPROGRAMS\CutRoom.lnk" 0 +2
    Delete "$SMPROGRAMS\CutRoom.lnk"
  cutroom_shortcut_cleanup_done:
!macroend
