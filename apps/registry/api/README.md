# SYR Registry API

REST-only NestJS service for the SYR DID Registry. Signature-verified hosting record directory.

## Endpoints

- `GET /resolve/:did` — Resolve a DID to its hosting record
- `POST /update` — Submit a signed hosting record (register or update)
- `POST /delete` — Submit a signed deletion request
- `GET /health` — Health check

## Environment

| Variable                       | Default                   |
| ------------------------------ | ------------------------- |
| `REGISTRY_PORT`                | 3100                      |
| `REGISTRY_SURREALDB_URL`       | `ws://localhost:8000/rpc` |
| `REGISTRY_SURREALDB_NAMESPACE` | syr                       |
| `REGISTRY_SURREALDB_DATABASE`  | registry                  |

## Database migrations

### `updated_at` string → datetime

If you have an existing SurrealDB with `hosting_record.updated_at` as `string`:

```bash
surreal sql --endpoint ws://localhost:8000 --user root --pass syr-dev-password \
  --namespace syr --database registry \
  apps/registry/api/migrations/001_updated_at_to_datetime.surql
```

Or run in Surrealist (connect to your DB, select `syr` / `registry`):

```sql
DEFINE FIELD OVERWRITE updated_at ON TABLE hosting_record TYPE datetime;
```
