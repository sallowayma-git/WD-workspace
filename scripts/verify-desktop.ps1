$ErrorActionPreference = "Stop"

$exe = (Resolve-Path (Join-Path $PSScriptRoot "..\apps\desktop\src-tauri\target\release\assistant_desktop.exe")).Path
$existing = Get-Process assistant_desktop -ErrorAction SilentlyContinue
if ($existing) {
  throw "assistant_desktop is already running; close it before running this verification."
}
$dbPath = Join-Path $env:APPDATA "com.wonderedu.assistant\assistant.db"
$process = $null

try {
  $process = Start-Process -FilePath $exe -PassThru
  Start-Sleep -Seconds 5
  if ($process.HasExited) {
    throw "Desktop process exited during smoke startup (code $($process.ExitCode))."
  }
  if (-not (Test-Path $dbPath)) {
    throw "Desktop process did not create $dbPath"
  }
  $process.Kill()
  $process.WaitForExit()
  $process = $null

  $nodeScript = @'
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const migration = db.prepare("SELECT version, success FROM _sqlx_migrations ORDER BY version DESC LIMIT 1").get();
const tableCount = db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_sqlx_migrations'").get().count;
const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
if (migration?.version !== 1 || migration?.success !== 1 || tableCount !== 13 || integrity !== "ok") {
  throw new Error(JSON.stringify({ migration, tableCount, integrity }));
}
console.log(JSON.stringify({ migration, tableCount, integrity }));
db.close();
'@
  $nodeScript | node - $dbPath
  if ($LASTEXITCODE -ne 0) {
    throw "SQLite verification failed with exit code $LASTEXITCODE"
  }
  Write-Output "desktop-runtime-smoke-ok"
}
finally {
  if ($process -and -not $process.HasExited) {
    $process.Kill()
    $process.WaitForExit()
  }
}
