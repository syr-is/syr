# Docker Setup for SYR

## Services Overview

The SYR platform runs with three main services:

### 1. SurrealDB

- **Purpose**: Multi-model database (document, graph, relational)
- **Port**: 8000
- **Data**: Persistent volume at `/data`
- **Health Check**: HTTP endpoint at `/health`

### 2. SeaweedFS

- **Purpose**: S3-compatible distributed object storage
- **Ports**:
  - 8333: S3 API
  - 9333: Master server
  - 8080: Volume server
  - 18080: Filer
- **Data**: Persistent volume at `/data`
- **Compatible with**: AWS S3 SDK

### 3. Surrealist

- **Purpose**: Visual IDE for SurrealDB (database management GUI)
- **Port**: 8091
- **Access**: http://localhost:8091
- **Use for**: Schema management, data inspection, query testing

### 4. SYR Application

- **Purpose**: SvelteKit application (frontend + backend)
- **Port**: 5173 (configurable via `PORT` env var)
- **Dependencies**: Waits for SurrealDB and SeaweedFS to be healthy

## Development Setup

1. **Create `.env` file** (copy from `env.example`):

   ```bash
   cp env.example .env
   ```

2. **Start services with watch mode**:

   ```bash
   docker-compose up --watch
   ```

3. **Access services**:
   - SYR App: http://localhost:5173
   - SurrealDB: http://localhost:8000
   - Surrealist (DB GUI): http://localhost:8091
   - SeaweedFS S3: http://localhost:8333
   - SeaweedFS Master: http://localhost:9333

## Production Setup

1. **Create `.env.production` file**:

   ```bash
   cp env.example .env.production
   # Edit with production values
   ```

2. **Important production changes**:

   - Set strong `SURREALDB_PASS`
   - Set strong `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`
   - Set strong `JWT_SECRET`
   - Use HTTPS for `PUBLIC_URL` and `OAUTH_ISSUER`
   - Set proper `DID_WEB_DOMAIN` (your actual domain)
   - Increase `ARGON2_MEMORY_COST` if you have more RAM

3. **Start production services**:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

## Watch Mode

Development watch mode provides:

- **Hot Module Reload**: Changes to `apps/syr/src/**` sync instantly
- **Types Sync**: Changes to `packages/types/src/**` sync automatically
- **Auto Rebuild**: Dependency changes trigger container rebuild

## Data Persistence

Data is stored in local directories (bind mounts) for easy inspection:

- `db/data/`: SurrealDB RocksDB files
- `s3/data/`: SeaweedFS object storage
- `s3/s3_config.json`: S3 credentials configuration

**Benefits of bind mounts:**

- Easy to inspect data files directly
- Survives `docker-compose down`
- Can be backed up with normal file tools
- No hidden Docker volumes

**Permissions:**
Containers run with your host UID/GID (set in `.env`) to avoid permission issues.

**Remove all data** (careful!):

```bash
rm -rf db/data/* s3/data/*
```

**Backup data:**

```bash
tar -czf syr-backup-$(date +%Y%m%d).tar.gz db/data s3/data
```

## Troubleshooting

### SurrealDB Not Healthy

```bash
docker-compose logs surrealdb
```

### SeaweedFS Not Starting

```bash
docker-compose logs seaweedfs
curl http://localhost:9333/cluster/status
```

### App Can't Connect to Services

1. Check services are healthy:

   ```bash
   docker-compose ps
   ```

2. Check environment variables:

   ```bash
   docker-compose exec syr-dev env | grep -E 'SURREALDB|S3'
   ```

3. Test connections:

   ```bash
   # Test SurrealDB
   curl http://localhost:8000/health

   # Test SeaweedFS
   curl http://localhost:9333/cluster/status
   ```

## MCP Server (Optional)

MCP (Model Context Protocol) enables AI tools to interact with your SurrealDB database.

### SurrealMCP

**SurrealMCP** ([docs](https://surrealdb.com/mcp)) runs as an HTTP server in Docker.

**Start SurrealMCP:**

```bash
# Start with MCP profile to enable SurrealMCP
docker-compose --profile mcp up --watch
```

This starts the SurrealMCP server at `http://localhost:8090/mcp` connected to your local SurrealDB instance.

**Features:**

- Query database with SurrealQL
- CRUD operations
- Schema inspection
- List namespaces/databases
- Connect to different endpoints

The repository includes `.cursor/mcp.json` with SurrealMCP and Svelte MCP pre-configured for Cursor.

## Security Notes

**Development:**

- Default passwords are acceptable
- HTTP connections are fine
- Debug logging enabled

**Production:**

- Change ALL default passwords
- Use HTTPS/WSS for all external connections
- Set `SURREAL_LOG=info` or `warn`
- Enable firewall rules
- Consider network isolation
- Regular backups of volumes
