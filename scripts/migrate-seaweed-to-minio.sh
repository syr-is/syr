#!/bin/bash
# Migrate all S3 data from SeaweedFS to MinIO on production.
#
# Usage (from project root):
#   bash scripts/migrate-seaweed-to-minio.sh

set -euo pipefail

if [ -f .env ]; then
  set -a; source .env; set +a
fi

ACCESS_KEY="${S3_ACCESS_KEY_ID:-syr-access-key}"
SECRET_KEY="${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY must be set}"
BUCKET="${S3_BUCKET:-syr-storage}"
COMPOSE_FILE="docker-compose.prod.yml"
SEAWEED_VOLUME="${SEAWEED_VOLUME:-syr-app-uigl84_seaweedfs-prod-data}"

# Use the compose project network — all containers must be on the same one
NETWORK=$(docker compose -f "$COMPOSE_FILE" ps --format '{{.Networks}}' 2>/dev/null | head -1 | tr ',' '\n' | head -1)
if [ -z "$NETWORK" ]; then
  NETWORK=$(docker network ls --format '{{.Name}}' | grep -E "code_default|syr.*default" | head -1)
fi
if [ -z "$NETWORK" ]; then
  NETWORK="code_default"
  docker network create "$NETWORK" 2>/dev/null || true
fi

echo "=== SeaweedFS → MinIO Migration ==="
echo "Bucket:  $BUCKET"
echo "Volume:  $SEAWEED_VOLUME"
echo "Network: $NETWORK"
echo ""

# 1. Start SeaweedFS temp container (no host port — internal only)
echo "[1/5] Starting temporary SeaweedFS container..."
docker rm -f syr-seaweed-migration 2>/dev/null || true
docker run -d \
  --name syr-seaweed-migration \
  --network "$NETWORK" \
  -v "${SEAWEED_VOLUME}":/data \
  -v "$(pwd)/s3/entrypoint.sh:/etc/seaweedfs/entrypoint.sh:ro" \
  -e "S3_ACCESS_KEY_ID=$ACCESS_KEY" \
  -e "S3_SECRET_ACCESS_KEY=$SECRET_KEY" \
  -e "S3_BUCKET=$BUCKET" \
  --entrypoint /bin/sh \
  chrislusf/seaweedfs:latest \
  /etc/seaweedfs/entrypoint.sh \
  server -s3 -dir=/data -s3.port=8333 -volume.max=100 -ip=0.0.0.0 \
  -filer=true -s3.config=/etc/seaweedfs/s3_config.json

echo "Waiting for SeaweedFS S3 API..."
for i in $(seq 1 60); do
  # wget returns exit 8 for server error responses (403/404) — that still means S3 is listening
  if docker exec syr-seaweed-migration wget -q -O /dev/null http://127.0.0.1:9333/cluster/status 2>/dev/null; then
    echo "SeaweedFS master is ready, waiting for S3..."
    sleep 5
    echo "SeaweedFS S3 is ready."
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "ERROR: SeaweedFS did not start in 60s"
    docker logs syr-seaweed-migration --tail 20
    exit 1
  fi
  sleep 1
done

# 2. Ensure MinIO is running on the same network
echo ""
echo "[2/5] Ensuring MinIO is running..."
docker compose -f "$COMPOSE_FILE" up -d minio
echo "Waiting for MinIO..."
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T minio curl -sf http://localhost:9000/minio/health/live >/dev/null 2>&1; then
    echo "MinIO is ready."
    break
  fi
  sleep 1
done

# Get MinIO container name for internal DNS
MINIO_HOST=$(docker compose -f "$COMPOSE_FILE" ps --format '{{.Name}}' minio 2>/dev/null | head -1)
if [ -z "$MINIO_HOST" ]; then
  MINIO_HOST=$(docker ps --filter "name=minio" --format '{{.Names}}' | head -1)
fi
echo "MinIO host: $MINIO_HOST"

# Ensure MinIO container is on the same network as SeaweedFS
docker network connect "$NETWORK" "$MINIO_HOST" 2>/dev/null || true

# 3. Create bucket + mirror
echo ""
echo "[3/5] Creating bucket and mirroring data..."
docker run --rm \
  --network "$NETWORK" \
  --entrypoint sh \
  minio/mc:latest \
  -c "
    mc alias set seaweed http://syr-seaweed-migration:8333 '$ACCESS_KEY' '$SECRET_KEY' &&
    mc alias set minio http://$MINIO_HOST:9000 '$ACCESS_KEY' '$SECRET_KEY' &&
    mc mb --ignore-existing minio/$BUCKET &&
    echo '' &&
    echo 'Mirroring objects...' &&
    mc mirror --overwrite seaweed/$BUCKET minio/$BUCKET
  "

# 4. Verify
echo ""
echo "[4/5] Verifying migration..."
docker run --rm \
  --network "$NETWORK" \
  --entrypoint sh \
  minio/mc:latest \
  -c "
    mc alias set seaweed http://syr-seaweed-migration:8333 '$ACCESS_KEY' '$SECRET_KEY' &&
    mc alias set minio http://$MINIO_HOST:9000 '$ACCESS_KEY' '$SECRET_KEY' &&
    echo '--- SeaweedFS ---' &&
    mc ls --recursive --summarize seaweed/$BUCKET | tail -3 &&
    echo '' &&
    echo '--- MinIO ---' &&
    mc ls --recursive --summarize minio/$BUCKET | tail -3
  "

# 5. Cleanup
echo ""
echo "[5/5] Stopping temporary SeaweedFS container..."
docker stop syr-seaweed-migration
docker rm syr-seaweed-migration

echo ""
echo "=== Migration Complete ==="
echo "MinIO has all data. Redeploy in Dokploy to start the app."
echo ""
