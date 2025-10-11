# SYR

[![Code Quality](https://github.com/syr-is/syr/actions/workflows/code-quality.yml/badge.svg)](https://github.com/syr-is/syr/actions/workflows/code-quality.yml)
[![Build](https://github.com/syr-is/syr/actions/workflows/build.yml/badge.svg)](https://github.com/syr-is/syr/actions/workflows/build.yml)
[![Docker](https://github.com/syr-is/syr/actions/workflows/docker.yml/badge.svg)](https://github.com/syr-is/syr/actions/workflows/docker.yml)

A SvelteKit application built with a pnpm workspace monorepo structure, powered by Turborepo for efficient task orchestration and caching.

## Project Structure

```
/
├── .github/
│   └── workflows/
│       ├── code-quality.yml  # Code quality checks (format, lint, typecheck)
│       ├── build.yml         # Build verification
│       └── docker.yml        # Docker image builds
├── apps/
│   └── syr/               # SvelteKit application
├── docker/
│   ├── dev/
│   │   ├── syr.dockerfile # Development Dockerfile
│   │   └── README.md      # Docker dev documentation
│   └── prod/
│       ├── syr.dockerfile # Production Dockerfile (optimized)
│       └── README.md      # Docker prod documentation
├── docker-compose.yml     # Development Docker Compose
├── prod.docker-compose.yml # Production Docker Compose
├── pnpm-workspace.yaml    # pnpm workspace definition
├── turbo.json             # Turborepo pipeline configuration
├── .npmrc                 # pnpm configuration (v10 workspace settings)
└── package.json           # Root workspace configuration
```

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10.18.1+

### Local Development (without Docker)

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Run the development server:
   ```bash
   pnpm dev
   # or specifically for the syr app:
   pnpm dev:syr
   ```

3. Open [http://localhost:5173](http://localhost:5173) in your browser

### Docker Development

1. Create a `.env` file in the project root:
   ```bash
   PORT=5173
   # Add other environment variables as needed
   ```

2. Start the development server with Docker:
   ```bash
   docker-compose up --watch
   ```

   The `--watch` flag enables:
   - Hot module reloading for source code changes
   - Automatic rebuild when dependencies change

3. Access the app at [http://localhost:5173](http://localhost:5173) (or your configured PORT)

### Production Docker

1. Create a `.env.production` file in the project root:
   ```bash
   PORT=5173
   NODE_ENV=production
   # Add other production environment variables
   ```

2. Build and run:
   ```bash
   docker-compose -f prod.docker-compose.yml up -d
   ```

See [docker/prod/README.md](docker/prod/README.md) for detailed production deployment guide.

## Available Scripts

From the root directory:

- `pnpm dev` - Start development server (via Turbo)
- `pnpm dev:syr` - Start development server specifically for the syr app
- `pnpm build` - Build the syr app for production
- `pnpm preview` - Preview the production build
- `pnpm lint` - Lint the syr app
- `pnpm check` - Type check the syr app
- `pnpm format` - Format code in the syr app
- `pnpm format:check` - Check code formatting (used in CI)

## Turborepo

This project uses Turborepo for efficient task execution with smart caching and parallel builds.

### Features

- **Intelligent Caching**: Tasks are cached and reused when inputs haven't changed
- **Parallel Execution**: Multiple tasks run in parallel when possible
- **Pipeline Management**: Task dependencies are automatically handled
- **Remote Caching**: Can be configured for team-wide cache sharing (optional)

### Turborepo Commands

All tasks are run through Turborepo:

```bash
# Run tasks (uses turbo.json pipeline)
pnpm dev        # Runs dev task (persistent, not cached)
pnpm build      # Runs build task (cached)
pnpm lint       # Runs lint task (cached)
pnpm check      # Runs type checking (cached)

# Bypass cache for a specific run
turbo build --force

# Clear Turborepo cache
turbo prune
```

### Workspace Management

For package management or running non-turbo commands:

```bash
# Add dependencies to a specific app
pnpm --filter syr add <package-name>

# Run any command in the syr app
pnpm --filter syr <command>
```

## Continuous Integration

The project uses GitHub Actions with **3 separate workflows** that run on every push and pull request:

### Code Quality (`code-quality.yml`)
- ✅ **Format Check** - Ensures code is properly formatted with Prettier
- ✅ **Lint** - Runs ESLint and Prettier checks
- ✅ **Type Check** - Validates TypeScript types with svelte-check

### Build (`build.yml`)
- ✅ **Build** - Ensures the project builds successfully with Turborepo caching

### Docker (`docker.yml`)
- ✅ **Dev Image** - Verifies development container builds
- ✅ **Prod Image** - Verifies production container builds

All workflows run in parallel, with jobs within each workflow also running concurrently for maximum speed.

## Docker Documentation

- **Development**: [docker/dev/README.md](docker/dev/README.md)
- **Production**: [docker/prod/README.md](docker/prod/README.md)

## Technology Stack

- **Framework**: SvelteKit 2
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **Build Tool**: Vite 7
- **Package Manager**: pnpm
- **Task Runner**: Turborepo 2
- **Container**: Docker with watch mode

