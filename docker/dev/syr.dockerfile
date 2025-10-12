FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.18.1 --activate

# Copy workspace configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./

# Copy app and packages package.json
COPY apps/syr/package.json ./apps/syr/
COPY packages/types/package.json ./packages/types/

# Install dependencies from workspace root
RUN pnpm install --frozen-lockfile

# Copy application source code
COPY apps/syr ./apps/syr
COPY packages ./packages

# Set default port (can be overridden by env variable)
ENV PORT=5173

# Expose the port
EXPOSE ${PORT}

# Run dev server with host binding and custom port
CMD ["sh", "-c", "pnpm dev -- --host 0.0.0.0 --port ${PORT}"]


