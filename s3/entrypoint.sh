#!/bin/sh
# Generate s3_config.json from environment variables at container start time,
# then ensure the S3 bucket exists before handing off to SeaweedFS.
# Required env: S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET

BUCKET="${S3_BUCKET:-syr-storage}"
ACCESS_KEY="${S3_ACCESS_KEY_ID:-syr-access-key}"
SECRET_KEY="${S3_SECRET_ACCESS_KEY:-syr-secret-key}"

cat > /etc/seaweedfs/s3_config.json <<EOF
{
  "identities": [
    {
      "name": "anonymous",
      "actions": [
        "Read:${BUCKET}/uploads/did:syr:*/public/*",
        "Read:${BUCKET}/instance-media/*/public/*",
        "Read:${BUCKET}/instance-media/public/*"
      ]
    },
    {
      "name": "syr-access",
      "credentials": [
        {
          "accessKey": "${ACCESS_KEY}",
          "secretKey": "${SECRET_KEY}"
        }
      ],
      "actions": ["Admin", "Read", "List", "Tagging", "Write"]
    }
  ]
}
EOF

echo "[entrypoint] Generated s3_config.json (bucket=${BUCKET}, key=${ACCESS_KEY})"

# Start weed in background so we can create the bucket after it's ready
weed "$@" &
WEED_PID=$!

# Wait for the master to be ready
echo "[entrypoint] Waiting for SeaweedFS to start..."
for i in $(seq 1 30); do
    if wget -q --spider http://127.0.0.1:9333/cluster/status 2>/dev/null; then
        break
    fi
    sleep 1
done
sleep 2

# Create bucket via weed shell (busybox wget doesn't support PUT)
echo "[entrypoint] Ensuring bucket '${BUCKET}' exists..."
echo "s3.bucket.create -name ${BUCKET}" | weed shell -master=localhost:9333 2>&1 || true

# Hand off to the weed process
wait $WEED_PID
