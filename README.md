# SYR

[![Code Quality](https://github.com/syr-is/syr/actions/workflows/code-quality.yml/badge.svg)](https://github.com/syr-is/syr/actions/workflows/code-quality.yml)
[![Build](https://github.com/syr-is/syr/actions/workflows/build.yml/badge.svg)](https://github.com/syr-is/syr/actions/workflows/build.yml)
[![Docker](https://github.com/syr-is/syr/actions/workflows/docker.yml/badge.svg)](https://github.com/syr-is/syr/actions/workflows/docker.yml)

A SvelteKit application built with a pnpm workspace monorepo structure, powered by Turborepo for efficient task orchestration and caching.

## Project Structure

```
/
├── .github/
│   ├── ISSUE_TEMPLATE/     # Issue templates (bug, feature, proposal, docs)
│   ├── workflows/
│   │   ├── code-quality.yml  # Code quality checks (format, lint, typecheck)
│   │   ├── build.yml         # Build verification
│   │   └── docker.yml        # Docker image builds
│   └── pull_request_template.md
├── .vscode/
│   ├── settings.json         # VS Code settings (format on save, etc.)
│   └── extensions.json       # Recommended extensions
├── .cursor/
│   └── mcp.json              # MCP server configuration (SurrealMCP + Svelte MCP)
├── apps/
│   └── syr/                # SvelteKit application (frontend + backend)
├── packages/
│   └── types/              # Shared Zod schemas and types (@syr-is/types)
├── db/
│   └── data/               # SurrealDB data (gitignored)
├── s3/
│   ├── data/               # SeaweedFS data (gitignored)
│   └── s3_config.json      # S3 credentials configuration
├── docker/
│   ├── dev/
│   │   ├── syr.dockerfile  # Development Dockerfile
│   │   └── README.md       # Docker dev documentation
│   ├── prod/
│   │   ├── syr.dockerfile  # Production Dockerfile (optimized)
│   │   └── README.md       # Docker prod documentation
│   └── DOCKER_SETUP.md     # Docker infrastructure guide
├── docker-compose.yml      # Dev: SurrealDB + SeaweedFS + SYR
├── docker-compose.prod.yml # Production Docker Compose
├── Architecture.md         # System architecture and design
├── pnpm-workspace.yaml     # pnpm workspace definition
├── turbo.json              # Turborepo pipeline configuration
├── env.example             # Environment variable template
└── package.json            # Root workspace configuration
```

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10.18.1+
- VS Code (recommended) with suggested extensions

### VS Code Setup

When you open this project in VS Code, you'll be prompted to install recommended extensions. These include:

- **Svelte** - Svelte language support
- **ESLint** - JavaScript/TypeScript linting
- **Prettier** - Code formatting
- **Turbo** - Turborepo integration
- **Tailwind CSS** - IntelliSense for Tailwind
- **Docker** - Docker file support
- And more utilities for better DX

The workspace is configured with:

- ✅ Format on save (Prettier)
- ✅ Auto-fix on save (ESLint)
- ✅ Consistent tab settings (tabs, size 2)
- ✅ File nesting for better organization

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
   cp env.example .env
   # Edit as needed
   ```

2. Start all services with Docker:

   ```bash
   docker-compose up --watch
   ```

   This starts:

   - **SYR App** at [http://localhost:5173](http://localhost:5173)
   - **SurrealDB** at http://localhost:8000
   - **Surrealist** (DB GUI) at [http://localhost:8091](http://localhost:8091)
   - **SeaweedFS S3** at http://localhost:8333

   The `--watch` flag enables:

   - Hot module reloading for source code changes
   - Automatic rebuild when dependencies change
   - Types package synchronization

3. See [docker/DOCKER_SETUP.md](docker/DOCKER_SETUP.md) for detailed Docker documentation

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

## MCP Integration (AI Tooling)

The SYR project includes MCP (Model Context Protocol) integration for AI-powered development:

### SurrealMCP

- **Purpose**: Connect AI tools to your SurrealDB database
- **Runs in**: Docker (port 8090)
- **Start**: `docker-compose --profile mcp up --watch`
- **Docs**: [surrealdb.com/mcp](https://surrealdb.com/mcp)

### Svelte MCP

- **Purpose**: AI assistance for Svelte component and route creation
- **Runs**: Locally via `npx -y @sveltejs/mcp`
- **Configured in**: `.cursor/mcp.json`
- **Docs**: [svelte.dev/docs/mcp](https://svelte.dev/docs/mcp/overview)

The repository includes `.cursor/mcp.json` with both MCP servers pre-configured. Cursor will automatically use this configuration.

## Docker Documentation

- **Development**: [docker/dev/README.md](docker/dev/README.md)
- **Production**: [docker/prod/README.md](docker/prod/README.md)
- **Infrastructure Setup**: [docker/DOCKER_SETUP.md](docker/DOCKER_SETUP.md)

## Technology Stack

- **Framework**: SvelteKit 2
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4 + shadcn-svelte
- **Build Tool**: Vite 7
- **Package Manager**: pnpm
- **Task Runner**: Turborepo 2
- **Container**: Docker with watch mode
- **Database**: SurrealDB (multi-model)
- **File Storage**: SeaweedFS (S3-compatible)
- **Type System**: Zod v4
- **Password Hashing**: Argon2id
- **Protocols**: ActivityPub, W3C VC 2.0, OAuth 2.0
