.PHONY: reset-local-data

reset-local-data:
	@if [ "$(CONFIRM)" != "YES" ]; then echo "Refusing reset. Re-run with CONFIRM=YES and inspect the compose project."; exit 1; fi
	docker compose -f infra/compose/compose.yaml down -v
