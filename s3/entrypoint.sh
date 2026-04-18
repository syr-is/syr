#!/bin/sh
# Generate s3_config.json from environment variables at container start time.
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

# Hand off to SeaweedFS
exec weed "$@"
