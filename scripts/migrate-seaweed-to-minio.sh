#!/bin/bash
# Migrate all S3 data from SeaweedFS to MinIO on production.
#
# This script:
#   1. Starts SeaweedFS temporarily from the old volume
#   2. Starts MinIO (from compose) and creates the bucket
#   3. Mirrors all objects SeaweedFS → MinIO via mc
#   4. Verifies counts match
#   5. Cleans up the temp SeaweedFS container
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
NETWORK=""

echo "=== SeaweedFS → MinIO Migration ==="
echo "Bucket: $BUCKET"
echo ""

# Detect the docker compose network
NETWORK=$(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null | head -1 | python3 -c "import sys,json; print(json.load(sys.stdin).get('Networks',''))" 2>/dev/null || true)
if [ -z "$NETWORK" ]; then
  # Fallback: find network by project name
  PROJECT=$(basename "$(pwd)")
  NETWORK=$(docker network ls --filter "name=${PROJECT}" --format '{{.Name}}' | head -1)
fi
if [ -z "$NETWORK" ]; then
  echo "Could not detect Docker network. Creating one..."
  NETWORK="syr-migration"
  docker network create "$NETWORK" 2>/dev/null || true
fi
echo "Network: $NETWORK"

# 1. Start SeaweedFS from the existing volume (temp, port 8334 to avoid conflicts)
echo ""
echo "[1/5] Starting temporary SeaweedFS container from existing volume..."
docker rm -f syr-seaweed-migration 2>/dev/null || true
docker run -d \
  --name syr-seaweed-migration \
  --network "$NETWORK" \
  -v syr_seaweedfs-prod-data:/data \
  -v "$(pwd)/s3/entrypoint.sh:/etc/seaweedfs/entrypoint.sh:ro" \
  -e "S3_ACCESS_KEY_ID=$ACCESS_KEY" \
  -e "S3_SECRET_ACCESS_KEY=$SECRET_KEY" \
  -e "S3_BUCKET=$BUCKET" \
  --entrypoint /bin/sh \
  chrislusf/seaweedfs:latest \
  /etc/seaweedfs/entrypoint.sh \
  server -s3 -dir=/data -s3.port=8333 -volume.max=100 -ip=0.0.0.0 \
  -filer=true -s3.config=/etc/seaweedfs/s3_config.json

echo "Waiting for SeaweedFS..."
for i in $(seq 1 30); do
  if docker exec syr-seaweed-migration wget -q --spider http://127.0.0.1:9333/cluster/status 2>/dev/null; then
    echo "SeaweedFS is ready."
    break
  fi
  sleep 1
done

# 2. Ensure MinIO is running
echo ""
echo "[2/5] Starting MinIO..."
docker compose -f "$COMPOSE_FILE" up -d minio
echo "Waiting for MinIO..."
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T minio curl -sf http://localhost:9000/minio/health/live >/dev/null 2>&1; then
    echo "MinIO is ready."
    break
  fi
  sleep 1
done

# Get MinIO container name
MINIO_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q minio)
MINIO_HOST=$(docker inspect -f '{{.Name}}' "$MINIO_CONTAINER" | sed 's/^\///')

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
echo ""
echo "MinIO has all data. The compose file already points syr-prod to MinIO."
echo "Run: docker compose -f $COMPOSE_FILE up -d"
echo ""
