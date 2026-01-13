➜ s3 git:(main) ✗ aws --endpoint-url=http://localhost:8333 \
 s3api create-bucket \
 --bucket syr \
 --region us-east-1

➜ s3 git:(main) ✗ aws --endpoint-url=http://localhost:8333 \
 s3api put-bucket-cors \
 --bucket syr \
 --cors-configuration file://cors-config.json
