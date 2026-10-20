; 更新时保留用户已有的桌面快捷方式。
;
; electron-builder 默认的 keep-shortcuts 机制只有在安装器收到
; `--updated`、且旧版本写过 KeepShortcuts 注册表时才生效；旧版本/手动
; 运行安装包时，旧卸载器可能先删掉桌面快捷方式，新安装器再重建。
; 这里在安装前备份原 .lnk，若默认流程没有保留它，再原样恢复，
; 避免快捷方式名称、图标和目标路径发生变化。

!macro customInit
  ${If} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
    CopyFiles /SILENT "$DESKTOP\${SHORTCUT_NAME}.lnk" "$TEMP\pi-desktop-shortcut-backup.lnk"
  ${EndIf}
!macroend

!macro customInstall
  ${If} ${FileExists} "$TEMP\pi-desktop-shortcut-backup.lnk"
    ; $keepShortcuts 为 false 表示安装器已经重建了快捷方式，此时恢复原件；
    ; 为 true 时安装器保留了原文件，不要再覆盖它的时间戳。
    ${If} $keepShortcuts == "false"
      CopyFiles /SILENT "$TEMP\pi-desktop-shortcut-backup.lnk" "$DESKTOP\${SHORTCUT_NAME}.lnk"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${EndIf}
    Delete "$TEMP\pi-desktop-shortcut-backup.lnk"
  ${EndIf}
!macroend
