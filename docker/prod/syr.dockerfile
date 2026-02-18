# ---- Base Stage ----
FROM node:20-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.18.1 --activate

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./

# ---- Dependencies Stage ----
FROM base AS deps

# Copy app and packages package.json for dependency resolution
COPY apps/syr/app/package.json ./apps/syr/app/
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json ./packages/ui/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/did/package.json ./packages/did/

# Install all dependencies (including devDependencies for build)
# packages/ui dist is produced in the builder stage by pnpm build
RUN pnpm install --frozen-lockfile

# ---- Builder Stage ----
FROM deps AS builder

# Copy application source (overlays on top of deps, preserving node_modules)
COPY apps/syr ./apps/syr
COPY packages ./packages

# Build workspace dependency packages (produces dist/ in each)
RUN pnpm --filter "@syr-is/syr..." --filter "!@syr-is/syr" build

# Fix @syr-is/ui resolution: pnpm routes it through the virtual store (due to
# peerDependencies) where only package.json exists — no dist/ or src/.
# Replace with a direct symlink to the source package so the app can resolve
# both dist/ exports (components) and src/ exports (styles).
RUN target="/app/apps/syr/app/node_modules/@syr-is/ui" && \
    rm -f "$target" && \
    ln -s ../../../../../packages/ui "$target"

# Give packages/ui access to its deps (formsnap, tailwindcss, @lucide/svelte, etc.)
# from the pnpm store. With @lucide/svelte, tailwindcss, tw-animate-css as direct
# deps, the store's ui node_modules has everything needed.
RUN ui_deps=$(ls -d /app/node_modules/.pnpm/@syr-is+ui@file+packages+ui*/node_modules 2>/dev/null | head -1) && \
    [ -n "$ui_deps" ] || (echo "ERROR: Could not find UI store deps" && exit 1) && \
    rm -rf /app/packages/ui/node_modules 2>/dev/null && \
    ln -sf "$ui_deps" /app/packages/ui/node_modules

# Build the syr app
RUN pnpm --filter "@syr-is/syr" build

# Prune dev dependencies - keep only production dependencies
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

