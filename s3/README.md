# S3 / SeaweedFS setup

The **apps/syr/app** application ensures the S3 bucket and CORS rules exist on startup. You do not need to run manual `aws s3api` commands if the app is configured with the correct environment variables.

## Storage path structure (DID-based)

Uploads use DID-namespaced S3 keys:

- **Root / folder uploads**: `uploads/{did}/[folder_path/]{ulid}`
- **Public files** (e.g. in a `public` folder): `uploads/{did}/.../public/{ulid}`
- **Post assets**: `uploads/{did}/posts/{post_ulid}/public/{upload_ulid}`
- **Profile stories** (spec / planned layout): `uploads/{did}/stories/{UTC_YYYY-MM-DD}/public/{upload_ulid}` — date is **UTC** at upload completion; public API returns only slides in the **rolling last 24h** (see [Profile stories (v1 spec)](../apps/docs/app/src/routes/architecture/profile-stories/+page.md)).

The `s3_config.json` anonymous identity must allow read access for public paths:

```json
"Read:syr/uploads/did:syr:*/public/*"
```

This permits unauthenticated access to files under any DID's `public` subtree (post assets, public folder uploads).

## Required environment variables

Set these (e.g. in `.env` or your deployment config) so the app can create the bucket and apply CORS:

- `S3_ENDPOINT` – S3 endpoint URL (e.g. `http://localhost:8333` or `http://seaweedfs:8333`)
- `S3_ACCESS_KEY_ID` – Access key (e.g. from `s3_config.json` identities)
- `S3_SECRET_ACCESS_KEY` – Secret key
- `S3_BUCKET` – Bucket name (e.g. `syr` or `syr-storage`)
- `S3_REGION` – Region (e.g. `us-east-1`)

CORS allowed origins are taken from `S3_CORS_ORIGINS` (comma-separated) if set, otherwise from `CORS_ORIGIN`. Example:

- `CORS_ORIGIN=http://localhost:5173` (single origin, used for S3 CORS when `S3_CORS_ORIGINS` is unset)
- `S3_CORS_ORIGINS=http://localhost:5173,https://app.example.com` (optional, multiple origins)

At server startup (module load), the app ensures the bucket exists and applies the CORS configuration. `initializeS3()` is invoked in `hooks.server.ts` when the server loads (via `Promise.all([initializeDatabase(), initializeS3()]).catch(console.error)`), so bucket creation and CORS happen during startup rather than on the first incoming request.

## Manual setup (optional)

If you prefer to create the bucket and CORS yourself (e.g. before starting the app), you can use:

```bash
aws --endpoint-url=http://localhost:8333 \
  s3api create-bucket \
  --bucket syr \
  --region us-east-1

aws --endpoint-url=http://localhost:8333 \
  s3api put-bucket-cors \
  --bucket syr \
  --cors-configuration file://cors-config.json
```

The `cors-config.json` in this directory is a reference; the app builds CORS from the env vars above.
