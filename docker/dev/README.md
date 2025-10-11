# Development Docker Setup

This directory contains the Dockerfile for running the SvelteKit app in development mode within a pnpm workspace monorepo.

The `docker-compose.yml` file is located in the project root.

## Project Structure

This is a pnpm workspace monorepo:
```
/
├── apps/
│   └── syr/               # SvelteKit application
├── docker/
│   └── dev/
│       └── syr.dockerfile # Development Dockerfile
├── docker-compose.yml     # Docker Compose config
├── pnpm-workspace.yaml    # Workspace definition
└── package.json           # Root workspace package.json
```

## Quick Start

1. Create a `.env` file in the project root with your configuration:
   ```bash
   PORT=5173
   # Add other environment variables as needed
   ```

2. Run with docker-compose from the project root:
   ```bash
   docker-compose up --watch
   ```

## Configuration

### Environment Variables

All environment variables from your `.env` file in the project root will be passed through to the container.

**Required:**
- `PORT` - The port to run the development server on (default: 5173)

### Port Configuration

The port is configurable via the `PORT` environment variable. For example:
```bash
PORT=4000 docker-compose up --watch
```

## Docker Watch Features

The setup uses Docker Compose's `watch` feature for intelligent file synchronization:

### Hot Reload (sync action)
These files/directories trigger immediate sync without rebuilding:
- `apps/syr/src/` - Application source code
- `apps/syr/static/` - Static assets
- `apps/syr/svelte.config.js` - Svelte configuration
- `apps/syr/vite.config.ts` - Vite configuration
- `apps/syr/tsconfig.json` - TypeScript configuration

### Container Rebuild (rebuild action)
These files trigger a full container rebuild when changed:
- `package.json` - Root workspace package.json
- `pnpm-lock.yaml` - Workspace lock file
- `pnpm-workspace.yaml` - Workspace configuration
- `turbo.json` - Turborepo pipeline configuration
- `apps/syr/package.json` - App-specific dependencies

## Using Docker without docker-compose

Build the image (from project root):
```bash
docker build -f docker/dev/syr.dockerfile -t syr-dev .
```

Run the container:
```bash
docker run -p 5173:5173 --env-file .env syr-dev
```

Or with a custom port:
```bash
docker run -p 8080:8080 --env-file .env -e PORT=8080 syr-dev
```

## Turborepo Integration

This project uses Turborepo for task orchestration. The Dockerfile runs tasks through pnpm scripts that use Turbo:

```bash
# Commands run through pnpm (which uses Turborepo)
pnpm dev         # Runs dev server via Turbo (persistent, not cached)
pnpm build       # Runs build via Turbo (cached)
pnpm lint        # Runs lint via Turbo (cached)
pnpm check       # Runs type checking via Turbo (cached)
```

The `turbo.json` configuration file is copied into the container to enable Turborepo's caching and pipeline features.

### Workspace Commands

For direct package management:

```bash
# Add dependencies to the syr app
pnpm --filter syr add <package-name>

# Run non-turbo commands
pnpm --filter syr <command>
```

## Development Features

- Hot module reloading (HMR) enabled through Docker watch sync
- Source code changes are reflected immediately
- Dependency changes trigger automatic container rebuild
- All environment variables from `.env` are available in the container

