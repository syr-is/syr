# Production Docker Setup

This directory contains the optimized production Dockerfile for the SvelteKit application.

## Key Optimizations

### Multi-Stage Build
The production Dockerfile uses a 4-stage build process:

1. **Base**: Sets up pnpm and workspace configuration
2. **Dependencies**: Installs all dependencies (including devDependencies)
3. **Builder**: Builds the application with Turborepo and prunes to production-only dependencies
4. **Production**: Minimal final image with only runtime necessities

### Security Features
- ✅ Runs as non-root user (`sveltekit:nodejs`)
- ✅ Read-only filesystem
- ✅ Dropped all capabilities
- ✅ No new privileges
- ✅ Alpine Linux base (smaller attack surface)
- ✅ Health check included

### Performance Features
- ✅ Optimized layer caching
- ✅ Production-only dependencies
- ✅ Smaller final image size (~50% smaller than dev)
- ✅ Built with Turborepo for optimal builds

## Quick Start

1. Create a `.env.production` file in the project root:
   ```bash
   PORT=5173
   NODE_ENV=production
   # Add other production environment variables
   ```

2. Build and run from the project root:
   ```bash
   docker-compose -f prod.docker-compose.yml up -d
   ```

## Configuration

### Environment Variables

Create `.env.production` in the project root with:

**Required:**
- `PORT` - The port to run the server on (default: 5173)
- `NODE_ENV` - Should be set to `production`

**Optional:**
- Database URLs, API keys, etc.

### Port Configuration

```bash
PORT=8080 docker-compose -f prod.docker-compose.yml up -d
```

## Using Docker without docker-compose

Build the production image:
```bash
docker build -f docker/prod/syr.dockerfile -t syr-prod .
```

Run the container:
```bash
docker run -d \
  -p 5173:5173 \
  --env-file .env.production \
  --name syr-app \
  --restart unless-stopped \
  syr-prod
```

With custom port:
```bash
docker run -d \
  -p 8080:8080 \
  --env-file .env.production \
  -e PORT=8080 \
  --name syr-app \
  --restart unless-stopped \
  syr-prod
```

## Health Check

The container includes a built-in health check that:
- Runs every 30 seconds
- Expects a 200 response from `/health` endpoint
- Has a 5-second startup grace period
- Retries 3 times before marking unhealthy

**Note:** Make sure to implement a `/health` route in your SvelteKit app or remove the health check from the Dockerfile.

## Image Sizes

Approximate sizes:
- Development image: ~400-500 MB
- Production image: ~200-250 MB (50% smaller)

## Deployment Checklist

- [ ] Create `.env.production` with all required environment variables
- [ ] Build and test locally: `docker-compose -f prod.docker-compose.yml up`
- [ ] Verify health check endpoint exists or remove from Dockerfile
- [ ] Configure reverse proxy (nginx/traefik) for SSL termination
- [ ] Set up logging and monitoring
- [ ] Configure backup strategy for persistent data
- [ ] Deploy: `docker-compose -f prod.docker-compose.yml up -d`

## Production Best Practices

1. **Use specific version tags** instead of `latest`
2. **Implement health endpoints** for load balancer checks
3. **Use secrets management** instead of .env files in production
4. **Enable Docker logging driver** for centralized logs
5. **Set resource limits** (CPU/memory) in production
6. **Use orchestration** (Docker Swarm, Kubernetes) for high availability

## Comparison: Dev vs Prod

| Feature | Development | Production |
|---------|-------------|------------|
| Base | node:20-alpine | node:20-alpine |
| Stages | Single | Multi-stage (4) |
| User | root | sveltekit (1001) |
| Dependencies | All | Production only |
| Server | Vite dev | Node built app |
| Hot Reload | Yes | No |
| Size | ~400-500 MB | ~200-250 MB |
| Security | Basic | Hardened |

## Turborepo in Production

The build stage uses Turborepo for optimal builds:
- Caches build outputs when possible
- Handles task dependencies automatically
- Optimizes parallel task execution

```dockerfile
RUN pnpm build
```

This runs the build through pnpm, which invokes Turborepo with the pipeline configuration from `turbo.json`. This ensures consistent, fast builds in CI/CD pipelines.

