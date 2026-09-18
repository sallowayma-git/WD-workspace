; 助教工作台 NSIS 自定义钩子（经 Tauri bundle.windows.nsis.installerHooks 注入）。
;
; 卸载语义（产品约定 2026-08-30）：
;   本产品是本地单用户桌面应用，全部业务数据只有一份 SQLite 数据库，位于
;   %APPDATA%\com.wonderedu.assistant\assistant.db。卸载时询问用户是否
;   一并删除全部本地数据，选“是”即完全清除式卸载，删除后不可恢复。
;
; 注意：installMode 为 both，安装与卸载既可能以当前用户身份运行（per-user，
; 此时 $APPDATA 就是用户自己的 Roaming 目录），也可能以管理员身份运行
; （per-machine，此时 SetShellVarContext 会让 $APPDATA 指向 ProgramData）。
; 而应用数据固定在“安装用户”的 Roaming 目录，所以主路径用 $PROFILE 定位，
; 再用 $APPDATA 兜底一次——两种模式下都能命中。
; WebView2 的用户数据目录在 %LOCALAPPDATA%\com.wonderedu.assistant，
; 一并纳入完全清除范围。
;
; 这三条路径不是猜的，是照着应用自己的路径解析核对过的：应用用
; app_config_dir() 定位数据目录，而 tauri 的 app_config_dir() =
; dirs::config_dir()/{identifier}；在 Windows 上 dirs::config_dir() 和
; dirs::data_dir() 都指向 known_folder_roaming_app_data（即 %APPDATA%），
; dirs::data_local_dir() 指向 %LOCALAPPDATA%。所以上面三条 RMDir 正好覆盖
; 应用实际写入的位置。改这里之前先回去确认应用的取路径方式没变。

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
