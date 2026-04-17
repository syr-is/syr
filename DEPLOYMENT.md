# Syr Production Deployment

Deploying Syr on Dokploy (Hetzner) behind Cloudflare.

---

## Architecture

```
Browser → Cloudflare → Traefik (Dokploy) → Docker containers
```

| Container                          | Port | Domain        |
| ---------------------------------- | ---- | ------------- |
| syr-prod (SvelteKit, adapter-node) | 5173 | app.syr.is    |
| surrealdb                          | 8000 | internal only |
| seaweedfs                          | 8333 | s3.syr.is     |

---

## Cloudflare Setup

### DNS Records

| Type | Name      | Content       | Proxy   |
| ---- | --------- | ------------- | ------- |
| A    | `app`     | `<server-ip>` | Proxied |
| A    | `s3`      | `<server-ip>` | Proxied |
| A    | `dokploy` | `<server-ip>` | Proxied |
| A    | `*`       | `<server-ip>` | Proxied |

The wildcard record ensures `cf_clearance` cookies from `app.syr.is` cover `s3.syr.is`. Without it, presigned S3 uploads get 403'd by Bot Fight Mode on the S3 subdomain.

### SSL/TLS

- **Encryption mode**: Full (Strict)
- **Edge Certificates → Always Use HTTPS**: On
- **Minimum TLS Version**: 1.2

### Security

- **Bot Fight Mode**: OFF. Can't be skipped per-path on the free plan. Blocks server-to-server POST requests from ecosystem apps (e.g. Syren calling `/api/platform/token`).
- **WAF Custom Rule** (optional, for Pro plan):
  - Name: `Allow platform APIs`
  - Expression: `(http.request.uri.path contains "/api/platform/")`
  - Action: Skip all WAF components

---

## Dokploy Setup

### Compose Project

- Point at the Syr repo
- Compose file: `docker-compose.prod.yml`

### Domain Routing

| Service   | Host       | Path | Port | HTTPS |
| --------- | ---------- | ---- | ---- | ----- |
| syr-prod  | app.syr.is | /    | 5173 | Yes   |
| seaweedfs | s3.syr.is  | /    | 8333 | Yes   |

---

## Environment Variables

```env
NODE_ENV=production
PORT=5173
PUBLIC_URL=https://app.syr.is

SURREALDB_NAMESPACE=syr
SURREALDB_DATABASE=syr
SURREALDB_USER=root
SURREALDB_PASS=<openssl rand -base64 32>

S3_ACCESS_KEY_ID=syr-access-key
S3_SECRET_ACCESS_KEY=<openssl rand -base64 32>
S3_BUCKET=syr-storage
S3_REGION=us-east-1
S3_PUBLIC_URL=https://s3.syr.is
S3_CORS_ORIGINS=https://app.syr.is

JWT_SECRET=<openssl rand -base64 48>
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

PLATFORM_DELEGATE_SECRET=<openssl rand -base64 48>

ARGON2_MEMORY_COST=65536
ARGON2_TIME_COST=3
ARGON2_PARALLELISM=4

RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX=100

CORS_CREDENTIALS=true
```

`S3_PUBLIC_URL` must NOT include the bucket name (just `https://s3.syr.is`, not `https://s3.syr.is/syr-storage`). The SDK adds the bucket as a path segment with `forcePathStyle`.

---

## Gotchas / Lessons Learned

### SurrealDB

- **Pin to v2.6**. v3 changed the `file:` storage format and is incompatible.
- **`user: root`** in compose. Without it, volume mount `/data` isn't writable.
- **Healthcheck**: `["CMD", "/surreal", "is-ready", "--endpoint", "http://localhost:8000"]`. SurrealDB's Alpine image has no `curl`, `wget`, or `sh` — must use the built-in `is-ready` command.
- **Storage**: `file:/data/syr.db` (not `rocksdb://data`).

### SeaweedFS

- **No `-s3.config` or IAM config**. SeaweedFS runs without credential validation. Bucket + CORS are auto-created by `s3-setup.ts` on app startup.
- **Healthcheck**: `["CMD-SHELL", "wget -q --spider http://127.0.0.1:8333/ || exit 1"]` with `retries: 10, start_period: 15s`. Port 9333 (master) is unreachable via localhost. Use S3 port 8333 on `127.0.0.1`.
- **`-ip=0.0.0.0`** required. Without it, SeaweedFS only binds to the compose-default-network interface and is unreachable from Dokploy's overlay network.
- **Containers can get stuck**. If `docker kill` / `docker rm` hang, restart Docker: `systemctl restart docker`, then clean up.

### S3 / Presigned URLs

- **Two S3 clients**: `s3Service.client` (internal, `http://seaweedfs:8333`) for server-side ops (HeadObject, DeleteObject). `s3PublicClient` (`https://s3.syr.is`) for generating presigned URLs the browser will use.
- **Do NOT include `ContentLength` in `PutObjectCommand`** for presigned URLs. Cloudflare modifies Content-Length headers, breaking the signature.
- **File preview URLs** must use `s3.publicUrl` (not `s3.endpoint`). Otherwise the frontend gets internal `http://seaweedfs:8333` URLs.

### Vite Build

- **OOM during Docker build**: `NODE_OPTIONS="--max-old-space-size=4096"` required. Default 2GB heap isn't enough for SSR build on small VPS.

### WASM

- **`pnpm deploy --prod` doesn't include build artifacts** from workspace deps. Explicit `COPY --from=builder` for `packages/ts/crypto/dist` is needed in the production stage.

### pnpm Workspace in Docker

- `inject-workspace-packages=true` appended to `.npmrc` in deps stage (not in repo `.npmrc` — only for Docker).
- Build workspace packages (types → utils → crypto → did → resolver → ui) in dependency order.
- **Re-run `pnpm install` after building** all workspace packages so injected copies in `node_modules` get the built `dist/` files.

### Traefik / Healthcheck

- **Healthcheck must hit `/`** not `/health`. SvelteKit has no `/health` route — hitting a 404 makes Traefik mark the container unhealthy and silently drop it from routing.

### SvelteKit CSRF

- **`csrf: { checkOrigin: false }`** in `svelte.config.js`. Required for ecosystem apps (Syren) that make server-to-server POST requests to `/api/platform/token`. SvelteKit's default CSRF blocks these with 403. Origin validation is handled per-route in `hooks.server.ts` instead.

### Platform Delegation (Ecosystem Auth)

- **`Authorization: Bearer` support** in `hooks.server.ts`. Platform delegation tokens from ecosystem apps authenticate via header, not session cookie.
- **Platform tokens use `sessionId: "platform:xxx"`** which doesn't exist in the session table. Auth hooks must detect the `platform:` prefix and skip session lookup — just verify the user exists.
- **`PLATFORM_DELEGATE_SECRET`** must be set (32+ chars). Config throws if missing.

### Container Hardening

The app container runs with:

- `read_only: true` + `tmpfs: [/tmp]`
- `security_opt: [no-new-privileges:true]`
- `cap_drop: [ALL]`
- Non-root user (`sveltekit`, uid 1001)

### Docker General

- Don't use `container_name` in compose — let Dokploy manage naming.
- If containers get stuck in `Created` state after a failed deploy, clean up with `docker rm -f $(docker ps -a --filter "name=syr" -q)` then redeploy.
