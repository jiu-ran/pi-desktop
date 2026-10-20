; 桌面快捷方式由下面的自定义页面和安装逻辑管理。
;
; package.json 里设置 nsis.createDesktopShortcut=false，关闭 electron-builder
; 默认的“先删除、再创建”流程；否则旧卸载器会先删掉快捷方式，新安装器
; 再创建。这里改为：
;   1. 安装前备份用户桌面和公共桌面上已有的快捷方式；
;   2. 安装页给出“创建 / 保留桌面快捷方式”选项；
;   3. 勾选时保留原文件（不覆盖时间戳）；只有原来不存在才创建；
;   4. 取消勾选时才删除已有快捷方式；
;   5. 自动更新（--updated）不显示选项页，默认保留已有快捷方式。
;
; 不使用 electron-builder 的 keep-shortcuts 机制，因为它依赖旧版本写入的
; 注册表和 --updated 参数；手动运行安装包时仍会走“删除再创建”。

!include "nsDialogs.nsh"
!include "FileFunc.nsh"
!include "WinMessages.nsh"

!ifndef BUILD_UNINSTALLER
Var piDesktopCreateShortcut
Var piDesktopRemoveShortcut
Var piDesktopShortcutCheckbox
Var piDesktopShortcutExisted
Var piDesktopShortcutBackup
Var piDesktopShortcutBackupCurrent
Var piDesktopShortcutBackupAll
Var piDesktopIsUpdated
Var piDesktopNoShortcut
!endif

!macro customInit
  StrCpy $piDesktopCreateShortcut "true"
  StrCpy $piDesktopRemoveShortcut "false"
  StrCpy $piDesktopShortcutBackupCurrent "$TEMP\pi-desktop-shortcut-backup-current.lnk"
  StrCpy $piDesktopShortcutBackupAll "$TEMP\pi-desktop-shortcut-backup-all.lnk"

  ; 记录更新 / 禁用桌面快捷方式参数。页面函数在 !addplugindir 之前定义，
  ; 不能直接使用 StdUtils 的 ${isUpdated}；在这里展开，页面只读变量。
  StrCpy $piDesktopIsUpdated "false"
  ${If} ${isUpdated}
    StrCpy $piDesktopIsUpdated "true"
  ${EndIf}
  StrCpy $piDesktopNoShortcut "false"
  ${If} ${isNoDesktopShortcut}
    StrCpy $piDesktopNoShortcut "true"
    StrCpy $piDesktopCreateShortcut "false"
  ${EndIf}

  ; 清理上一次安装遗留的备份，避免在用户已手动删除快捷方式后又恢复出来。
  Delete "$piDesktopShortcutBackupCurrent"
  Delete "$piDesktopShortcutBackupAll"

  SetShellVarContext current
  ${If} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
    CopyFiles /SILENT "$DESKTOP\${SHORTCUT_NAME}.lnk" "$piDesktopShortcutBackupCurrent"
  ${EndIf}

  SetShellVarContext all
  ${If} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
    CopyFiles /SILENT "$DESKTOP\${SHORTCUT_NAME}.lnk" "$piDesktopShortcutBackupAll"
  ${EndIf}

  ; 恢复 initMultiUser 选择的 shell context，后续页面和安装段依赖它。
  ${If} $installMode == "all"
    SetShellVarContext all
  ${Else}
    SetShellVarContext current
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom piDesktopShortcutPageCreate piDesktopShortcutPageLeave
!macroend

!ifndef BUILD_UNINSTALLER

Function piDesktopShortcutPageCreate
  ; 自动更新不打断用户；默认保留已有快捷方式。
  ${If} $piDesktopIsUpdated == "true"
    Abort
  ${EndIf}

  ${If} $piDesktopNoShortcut == "true"
    Abort
  ${EndIf}

  GetDlgItem $0 $HWNDPARENT 1037
  SendMessage $0 ${WM_SETTEXT} 0 "STR:桌面快捷方式"
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 ${WM_SETTEXT} 0 "STR:选择是否在桌面保留或创建 Pi Desktop 快捷方式。"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${If} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
    StrCpy $piDesktopShortcutExisted "true"
    ${NSD_CreateCheckbox} 0 0 100% 12u "保留现有桌面快捷方式"
  ${Else}
    StrCpy $piDesktopShortcutExisted "false"
    ${NSD_CreateCheckbox} 0 0 100% 12u "创建桌面快捷方式"
  ${EndIf}
  Pop $piDesktopShortcutCheckbox
  ${NSD_SetState} $piDesktopShortcutCheckbox ${BST_CHECKED}

  ${If} $piDesktopShortcutExisted == "true"
    ${NSD_CreateLabel} 0 24u 100% 54u "安装程序检测到已有桌面快捷方式。$\r$\n$\r$\n勾选：安装后原样保留，不删除或重建。$\r$\n取消勾选：安装完成后删除该快捷方式。"
  ${Else}
    ${NSD_CreateLabel} 0 24u 100% 54u "勾选后会在桌面创建 Pi Desktop 快捷方式。$\r$\n$\r$\n取消勾选则不会创建。"
  ${EndIf}
  Pop $0

  nsDialogs::Show
FunctionEnd

Function piDesktopShortcutPageLeave
  ${NSD_GetState} $piDesktopShortcutCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $piDesktopCreateShortcut "true"
    StrCpy $piDesktopRemoveShortcut "false"
  ${Else}
    StrCpy $piDesktopCreateShortcut "false"
    StrCpy $piDesktopRemoveShortcut "true"
  ${EndIf}
FunctionEnd

!endif

!macro customInstall
  ${If} $installMode == "all"
    StrCpy $piDesktopShortcutBackup "$piDesktopShortcutBackupAll"
  ${Else}
    StrCpy $piDesktopShortcutBackup "$piDesktopShortcutBackupCurrent"
  ${EndIf}

  ${If} $piDesktopCreateShortcut == "true"
    ; 已有快捷方式时什么都不做，连同时间戳、图标和目标路径一起保留。
    ${IfNot} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
      ${If} ${FileExists} "$piDesktopShortcutBackup"
        ; 旧卸载器可能已删除快捷方式；恢复安装前的原件。
        CopyFiles /SILENT "$piDesktopShortcutBackup" "$DESKTOP\${SHORTCUT_NAME}.lnk"
        System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
      ${Else}
        ; 旧版本卸载器可能已删除快捷方式，更新时也要重新创建。
        CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
        ClearErrors
        WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
        System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
      ${EndIf}
    ${EndIf}
  ${ElseIf} $piDesktopRemoveShortcut == "true"
    ; 只有用户在安装页明确取消勾选时才删除，避免默认删除再创建。
    ${If} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
      WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
      Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${EndIf}
  ${EndIf}

  Delete "$piDesktopShortcutBackupCurrent"
  Delete "$piDesktopShortcutBackupAll"
!macroend

!macro customUnInstall
  ; 更新时保留快捷方式；真正卸载时才清理。
  ${IfNot} ${isUpdated}
    ${If} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
      WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
      Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${EndIf}
  ${EndIf}

  Delete "$TEMP\pi-desktop-shortcut-backup-current.lnk"
  Delete "$TEMP\pi-desktop-shortcut-backup-all.lnk"
!macroend
