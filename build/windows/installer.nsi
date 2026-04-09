; Parallax Client — NSIS Installer Script
; Built during CI; can also be run locally with `makensis installer.nsi`

!include "MUI2.nsh"

;--- Basics ----------------------------------------------------------------
!define PRODUCT_NAME      "Parallax Client"
!define PRODUCT_PUBLISHER  "Parallax Protocol"
!define PRODUCT_EXE        "Parallax Client.exe"
!define INSTALL_DIR_NAME   "ParallaxClient"

; VERSION is injected from the command line via -DVERSION=x.y.z
!ifndef VERSION
  !define VERSION "0.0.0"
!endif

Name "${PRODUCT_NAME} ${VERSION}"
OutFile "Parallax-Client-${VERSION}-windows-x86_64-setup.exe"
InstallDir "$LOCALAPPDATA\${INSTALL_DIR_NAME}"
InstallDirRegKey HKCU "Software\${INSTALL_DIR_NAME}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

;--- UI --------------------------------------------------------------------
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_EXE}"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

;--- Install ---------------------------------------------------------------
Section "Install"
  SetOutPath "$INSTDIR"

  ; Main binary
  File "${BINDIR}\${PRODUCT_EXE}"

  ; Bundle hashwarp if present
  IfFileExists "${BINDIR}\hashwarp.exe" 0 +2
    File "${BINDIR}\hashwarp.exe"

  ; Uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Start-menu shortcut
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut  "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXE}"
  CreateShortCut  "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall.lnk"       "$INSTDIR\Uninstall.exe"

  ; Desktop shortcut
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXE}"

  ; Add/Remove Programs registry
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_DIR_NAME}" \
                    "DisplayName"     "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_DIR_NAME}" \
                    "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_DIR_NAME}" \
                    "DisplayIcon"     "$INSTDIR\${PRODUCT_EXE}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_DIR_NAME}" \
                    "Publisher"       "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_DIR_NAME}" \
                    "DisplayVersion"  "${VERSION}"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_DIR_NAME}" \
                     "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_DIR_NAME}" \
                     "NoRepair" 1

  ; Remember install dir for upgrades
  WriteRegStr HKCU "Software\${INSTALL_DIR_NAME}" "InstallDir" "$INSTDIR"
SectionEnd

;--- Uninstall -------------------------------------------------------------
Section "Uninstall"
  ; Kill the app if running
  nsExec::ExecToLog 'taskkill /F /IM "${PRODUCT_EXE}"'

  Delete "$INSTDIR\${PRODUCT_EXE}"
  Delete "$INSTDIR\hashwarp.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir  "$INSTDIR"

  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall.lnk"
  RMDir  "$SMPROGRAMS\${PRODUCT_NAME}"

  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_DIR_NAME}"
  DeleteRegKey HKCU "Software\${INSTALL_DIR_NAME}"
SectionEnd
