# SYR Registry Client

SvelteKit UI for viewing DID hosting records. Uses `@syr-is/ui` and calls the Registry API.

## Routes

- `/` — Landing page
- `/manage/[did]` — View hosting record for a DID (e.g. `/manage/did:syr:z6Mkt9...`)

## Environment

| Variable                  | Default                 | Description           |
| ------------------------- | ----------------------- | --------------------- |
| `PUBLIC_REGISTRY_API_URL` | `http://localhost:3100` | Registry API base URL |

## Dev

```bash
# From repo root
pnpm --filter @syr-is/registry-client dev
```

Ensure the Registry API is running (e.g. `pnpm --filter @syr-is/registry-api start:dev`).
