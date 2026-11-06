; Standard NSIS installer. Generate the uninstaller at install time so a Linux
; build does not need to execute Windows programs through Wine.
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "extractAppPackage.nsh"

!define APP_EXE "PasteBoard Plus.exe"
!define UNINSTALL_EXE "Uninstall PasteBoard Plus.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\PasteBoardPlus"

Name "PasteBoard Plus"
InstallDir "$LOCALAPPDATA\Programs\PasteBoard Plus"
InstallDirRegKey HKCU "Software\PasteBoardPlus" "InstallLocation"
RequestExecutionLevel user
SetCompressor zlib
CRCCheck on
ShowInstDetails show
ShowUninstDetails show

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

!macro AppClosedFunction PREFIX
Function ${PREFIX}EnsureAppClosed
  check:
    nsProcess::_FindProcess "${APP_EXE}"
    Pop $0
    StrCmp $0 0 running done
  running:
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "请先从系统托盘退出 PasteBoard Plus，再点击重试。$\r$\nPlease quit PasteBoard Plus from the system tray, then retry." IDRETRY check
    Abort
  done:
FunctionEnd
!macroend
!insertmacro AppClosedFunction ""
!insertmacro AppClosedFunction "un."

Function .onInit
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "此安装程序需要 64 位 Windows。$\r$\n64-bit Windows is required."
    Quit
  ${EndIf}
  SetRegView 64
  Call EnsureAppClosed
FunctionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
  Call un.EnsureAppClosed
FunctionEnd

Section "PasteBoard Plus"
  ; Reuse electron-builder's CRC-checked, NSIS-compatible LZMA payload.
  ; Avoid embedding every runtime file again with weaker zlib compression.
  InitPluginsDir
  SetCompress off
  File "/oname=$PLUGINSDIR\app.7z" "${APP_64}"
  SetCompress auto
  SetOutPath "$INSTDIR"
  !insertmacro extractUsing7za "$PLUGINSDIR\app.7z"
  IfFileExists "$INSTDIR\${APP_EXE}" 0 extractionFailed
  IfFileExists "$INSTDIR\resources\app.asar" 0 extractionFailed
  Goto extractionComplete
  extractionFailed:
    MessageBox MB_OK|MB_ICONSTOP "应用文件解压失败，请重新运行安装程序。$\r$\nExtraction failed. Please run the installer again."
    Abort
  extractionComplete:
  Delete "$PLUGINSDIR\app.7z"
  WriteUninstaller "$INSTDIR\${UNINSTALL_EXE}"
  CreateDirectory "$SMPROGRAMS\PasteBoard Plus"
  CreateShortCut "$SMPROGRAMS\PasteBoard Plus\PasteBoard Plus.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortCut "$SMPROGRAMS\PasteBoard Plus\卸载 PasteBoard Plus.lnk" "$INSTDIR\${UNINSTALL_EXE}"
  CreateShortCut "$DESKTOP\PasteBoard Plus.lnk" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "Software\PasteBoardPlus" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "PasteBoard Plus"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "PasteBoard Plus"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\${UNINSTALL_EXE}"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" ${ESTIMATED_SIZE}
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\PasteBoard Plus.lnk"
  Delete "$SMPROGRAMS\PasteBoard Plus\PasteBoard Plus.lnk"
  Delete "$SMPROGRAMS\PasteBoard Plus\卸载 PasteBoard Plus.lnk"
  RMDir "$SMPROGRAMS\PasteBoard Plus"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\PasteBoardPlus"
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\*.json"
  Delete "$INSTDIR\LICENSE*"
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\resources"
  Delete "$INSTDIR\${UNINSTALL_EXE}"
  ; Remove the chosen directory only when empty. Clipboard history lives in a
  ; separate Electron userData directory and is retained.
  RMDir "$INSTDIR"
SectionEnd
