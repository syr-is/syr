# ---- Base Stage ----
FROM node:20-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.18.1 --activate

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# ---- Dependencies Stage ----
FROM base AS deps

# Copy app package.json for dependency resolution
COPY apps/syr/package.json ./apps/syr/

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# ---- Builder Stage ----
FROM base AS builder

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/syr/node_modules ./apps/syr/node_modules

# Copy application source
COPY apps/syr ./apps/syr

# Build the application with Turborepo
RUN pnpm build

# Prune dev dependencies - keep only production dependencies
RUN pnpm --filter syr --prod deploy pruned

# ---- Production Stage ----
FROM node:20-alpine AS production

# Set production environment
ENV NODE_ENV=production
ENV PORT=5173

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 sveltekit

# Copy built application and production dependencies
COPY --from=builder --chown=sveltekit:nodejs /app/pruned/package.json ./
COPY --from=builder --chown=sveltekit:nodejs /app/pruned/node_modules ./node_modules
COPY --from=builder --chown=sveltekit:nodejs /app/apps/syr/build ./build
COPY --from=builder --chown=sveltekit:nodejs /app/apps/syr/package.json ./package.json

# Switch to non-root user
USER sveltekit

# Expose the port
EXPOSE ${PORT}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + process.env.PORT + '/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# Start the production server
CMD ["sh", "-c", "HOST=0.0.0.0 PORT=${PORT} node build"]

