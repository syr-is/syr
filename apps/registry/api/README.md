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
