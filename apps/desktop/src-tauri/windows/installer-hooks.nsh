; 助教工作台 NSIS 自定义钩子（经 Tauri bundle.windows.nsis.installerHooks 注入）。
;
; 卸载语义（产品约定 2026-08-30）：
;   本产品是本地单用户桌面应用，全部业务数据只有一份 SQLite 数据库，位于
;   %APPDATA%\com.wonderedu.assistant\assistant.db。卸载时询问用户是否
;   一并删除全部本地数据，选“是”即完全清除式卸载，删除后不可恢复。
;
; 注意：perMachine 卸载以管理员运行，NSIS 的 $APPDATA 会随
; SetShellVarContext 指向 ProgramData；而应用数据固定在“安装用户”的
; Roaming 目录，因此这里用 $PROFILE 定位，再对 $APPDATA 兜底一次。
; WebView2 的用户数据目录在 %LOCALAPPDATA%\com.wonderedu.assistant，
; 一并纳入完全清除范围。

!macro NSIS_HOOK_PREUNINSTALL
  MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除全部本地数据（含 SQLite 数据库与学习记录）？$\r$\n$\r$\n[是] 完全清除式卸载，删除 $PROFILE\AppData\Roaming\com.wonderedu.assistant，不可恢复。$\r$\n[否] 仅卸载程序，保留数据，重装后可继续使用。" IDYES wd_wipe_data
  Goto wd_keep_data
wd_wipe_data:
  ; 应用业务数据（assistant.db 等）。
  RMDir /r "$PROFILE\AppData\Roaming\com.wonderedu.assistant"
  RMDir /r "$APPDATA\com.wonderedu.assistant"
  ; WebView2 用户数据缓存。
  RMDir /r "$PROFILE\AppData\Local\com.wonderedu.assistant"
wd_keep_data:
!macroend
