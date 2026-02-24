# syntax=docker/dockerfile:1
# ---- Base Stage ----
FROM node:20-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# ---- Dependencies Stage ----
FROM base AS deps

# Copy app and packages package.json for dependency resolution
COPY apps/syr/app/package.json ./apps/syr/app/
COPY packages/ts/types/package.json ./packages/ts/types/
COPY packages/ts/ui/package.json ./packages/ts/ui/
COPY packages/ts/crypto/package.json ./packages/ts/crypto/
COPY packages/ts/did/package.json ./packages/ts/did/

# Enable injection only for Docker builds (required for pnpm deploy in v10)
RUN echo "inject-workspace-packages=true" >> .npmrc
# Install all dependencies (including devDependencies for build)
# packages/ui dist is produced in the builder stage by pnpm build
RUN pnpm install

# ---- Builder Stage ----
FROM deps AS builder

# Install wasm-pack for building @syr-is/crypto (Rust WASM)
# Use Alpine edge community repo for pre-built wasm-pack (faster than cargo install)
RUN echo "http://dl-cdn.alpinelinux.org/alpine/edge/community" >> /etc/apk/repositories \
    && apk update \
    && apk add --no-cache wasm-pack

COPY apps/syr ./apps/syr
COPY packages ./packages

# Build workspace packages first (dist/ doesn't exist at install time with injection)
# Order matters: types has no workspace deps, ui/crypto/did depend on types
RUN pnpm --filter @syr-is/types build
RUN pnpm --filter @syr-is/crypto build
RUN pnpm --filter @syr-is/did build
RUN pnpm --filter @syr-is/ui build

# Remove wasm-pack and build tools (no longer needed after WASM build)
RUN apk del wasm-pack \
    && sed -i '/alpine\/edge\/community/d' /etc/apk/repositories \
    && rm -rf /var/cache/apk/*

# Re-inject now that all dist/ folders exist
# node_modules/@syr-is/ui/dist will now contain the built files
RUN pnpm install

# Build the app — workspace deps are now properly injected with dist/
RUN pnpm --filter @syr-is/syr build

# Prune dev dependencies
RUN pnpm --filter @syr-is/syr --prod deploy pruned

# ---- Production Stage ----
FROM node:20-alpine AS production

# Set production environment
ENV NODE_ENV=production
ENV PORT=5173

# IMPORTANT: Set these environment variables at runtime:
# - JWT_SECRET: Must be at least 32 characters (generate with: openssl rand -base64 48)
# - SURREALDB_URL, SURREALDB_USER, SURREALDB_PASS: Database connection
# - All other configs have sensible defaults but should be reviewed for production

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 sveltekit

# Copy built application and production dependencies (pruned package.json has prod deps only)
COPY --from=builder --chown=sveltekit:nodejs /app/pruned/package.json ./
COPY --from=builder --chown=sveltekit:nodejs /app/pruned/node_modules ./node_modules
COPY --from=builder --chown=sveltekit:nodejs /app/apps/syr/app/build ./build

# Switch to non-root user
USER sveltekit

# Expose the port
EXPOSE ${PORT}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + process.env.PORT + '/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# Start the production server
CMD ["sh", "-c", "HOST=0.0.0.0 PORT=${PORT} node build"]

