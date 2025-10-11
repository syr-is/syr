# SYR

A SvelteKit application built with a pnpm workspace monorepo structure.

## Project Structure

```
/
├── apps/
│   └── syr/               # SvelteKit application
├── docker/
│   ├── dev/
│   │   ├── app.dockerfile # Development Dockerfile
│   │   └── README.md      # Docker documentation
│   └── prod/              # Production Docker configs (future)
├── docker-compose.yml     # Docker Compose configuration
├── pnpm-workspace.yaml    # pnpm workspace definition
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
   ```

3. Open [http://localhost:5173](http://localhost:5173) in your browser

### Docker Development

1. Create a `.env` file in the project root:
   ```bash
   PORT=3000
   # Add other environment variables as needed
   ```

2. Start the development server with Docker:
   ```bash
   docker-compose up --watch
   ```

   The `--watch` flag enables:
   - Hot module reloading for source code changes
   - Automatic rebuild when dependencies change

3. Access the app at [http://localhost:3000](http://localhost:3000) (or your configured PORT)

## Available Scripts

From the root directory:

- `pnpm dev` - Start development server for the syr app
- `pnpm build` - Build the syr app for production
- `pnpm preview` - Preview the production build
- `pnpm lint` - Lint the syr app
- `pnpm check` - Type check the syr app
- `pnpm format` - Format code in the syr app

## Workspace Management

This project uses pnpm workspaces. To run commands for a specific app:

```bash
# Run any command in the syr app
pnpm --filter syr <command>

# Examples:
pnpm --filter syr dev
pnpm --filter syr build
pnpm --filter syr add <package-name>
```

## Docker Documentation

For detailed Docker setup and usage, see [docker/dev/README.md](docker/dev/README.md).

## Technology Stack

- **Framework**: SvelteKit 2
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **Build Tool**: Vite 7
- **Package Manager**: pnpm
- **Container**: Docker with watch mode

