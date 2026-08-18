# Local dependencies

`compose.yaml` only defines the local PostgreSQL 18 dependency. Set `ASSISTANT_DB_PASSWORD` in the process environment or an untracked `.env` file before running Docker Compose. Never commit that value.

```powershell
$env:ASSISTANT_DB_PASSWORD = Read-Host 'Local DB password'
docker compose -f infra/compose/compose.yaml up -d --wait postgres
```

Database reset is intentionally not automated yet; a future reset script must require an explicit confirmation and must never target a production compose project.
