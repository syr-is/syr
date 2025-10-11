<!-- 148c6b8a-1b20-4ebc-8331-59c19f13e8b3 9ad06733-0935-459d-82a3-9a938c3e20b4 -->

# SYR Architecture Implementation Plan

## Overview

Implement the SYR vision: portable identity, ActivityPub federation, Verifiable Credentials (VC 2.0), and OAuth provider for service integration. Architecture-first approach with phased implementation.

## Phase 1: Foundation & Documentation

### 1.1 Architecture Documentation

Create `Architecture.md` in project root documenting:

- Vision and principles from syr.is
- System architecture (SvelteKit frontend/backend, SurrealDB, ActivityPub, VC 2.0, OAuth)
- Data models: Users, Profiles, ActivityPub Actors, VCs, Digital Proofs
- Federation strategy and interoperability
- Security model and authentication flows
- Integration SDK design

### 1.2 Shared Types Package

Create new package in monorepo: `packages/types/`

**Package structure:**

```
packages/types/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── user.ts - User and profile schemas
│   ├── activitypub.ts - ActivityPub types (Actor, Activity, Object)
│   ├── credentials.ts - VC 2.0 types (Credential, Presentation, DID)
│   ├── oauth.ts - OAuth client and token types
│   ├── events.ts - Event emission types
│   ├── proofs.ts - Digital proof types
│   └── api.ts - API request/response types
└── README.md
```

**Dependencies:**

- `zod` v4 (stable) - Schema definition and validation

**Features:**

- Type-safe schemas for all entities
- Validation functions using Zod
- Type inference for TypeScript
- Shared across frontend, backend, and SDK
- Runtime validation and parsing

### 1.3 Docker Infrastructure

Update Docker setup to include:

- SurrealDB service in `docker-compose.yml` and `docker-compose.prod.yml`
- SeaweedFS (S3-compatible storage) for file storage (avatars, media, attachments)
- MCP (Model Context Protocol) servers for tooling integration
- Environment configuration for database and storage connection
- Volume mounts for persistent data

Files to modify:

- `docker-compose.yml`
- `docker-compose.prod.yml`
- `docker/dev/syr.dockerfile`
- `docker/prod/syr.dockerfile`
- Add `.env.example` with required variables (DB, S3, etc.)

## Phase 2: Database & User Profile System

### 2.1 SurrealDB Integration

- Add SurrealDB client dependency (`surrealdb.js`)
- Create database connection utility in `apps/syr/src/lib/server/db.ts`
- Define database schemas for SurrealDB (users, profiles, actors, credentials)
- Create migration/setup script for initial database schema

### 2.2 User Profile System

**Database Schema (SurrealDB):**

- `user` table: id, username, email, password_hash, created_at, updated_at
- `profile` table: user_id, display_name, bio, avatar_url, banner_url, metadata (JSON)
- Indexes on username, email for lookups

**API Routes (SvelteKit):**

- `src/routes/api/auth/register/+server.ts` - User registration (with Zod validation)
- `src/routes/api/auth/login/+server.ts` - User login (issue JWT/session)
- `src/routes/api/auth/logout/+server.ts` - Logout
- `src/routes/api/profile/[username]/+server.ts` - Get/Update profile
- `src/routes/api/profile/[username]/avatar/+server.ts` - Upload avatar

**Authentication:**

- Implement session management (SvelteKit hooks)
- Create auth helpers in `src/lib/server/auth.ts`
- JWT or session-based auth (decide on approach)
- Use Zod schemas from `@syr-is/types` for validation

**Frontend:**

- Registration page: `src/routes/register/+page.svelte` (shadcn-svelte Form)
- Login page: `src/routes/login/+page.svelte` (shadcn-svelte Form)
- Profile page: `src/routes/@[username]/+page.svelte` (shadcn-svelte Card, Avatar)
- Profile edit page: `src/routes/settings/profile/+page.svelte` (shadcn-svelte Tabs, Form)
- Auth store in `src/lib/stores/auth.ts`

## Phase 3: ActivityPub Foundation

### 3.1 ActivityPub Actor Model

**Database Schema:**

- `actor` table: user_id, actor_type (Person, Service), inbox_url, outbox_url, followers_url, following_url, public_key, private_key
- `activity` table: id, actor_id, type, object, published, to, cc (recipients)
- `follower` table: actor_id, follower_actor_id, status (pending, accepted)

**Zod Schemas (in `packages/types/src/activitypub.ts`):**

- ActivityPub Actor, Activity, Object schemas
- Validation for incoming/outgoing activities
- Type inference for TypeScript

**Core ActivityPub Endpoints:**

- `src/routes/.well-known/webfinger/+server.ts` - WebFinger discovery
- `src/routes/users/[username]/+server.ts` - Actor endpoint (JSON-LD)
- `src/routes/users/[username]/inbox/+server.ts` - Inbox (receive activities)
- `src/routes/users/[username]/outbox/+server.ts` - Outbox (publish activities)
- `src/routes/users/[username]/followers/+server.ts` - Followers collection
- `src/routes/users/[username]/following/+server.ts` - Following collection

**ActivityPub Library:**

- `src/lib/server/activitypub/` directory structure: - `actor.ts` - Actor creation and management - `activity.ts` - Activity creation (Create, Follow, Accept, etc.) - `signature.ts` - HTTP Signatures for federation - `delivery.ts` - Activity delivery to remote servers - `inbox.ts` - Inbox processing logic - `webfinger.ts` - WebFinger utilities

### 3.2 Federation Logic

- Implement HTTP Signatures (for authenticated ActivityPub requests)
- Remote actor fetching and caching
- Activity validation and processing (using Zod schemas)
- Delivery queue for outgoing activities (consider using job queue)

## Phase 4: Verifiable Credentials (VC 2.0)

### 4.1 VC Data Model

**Database Schema:**

- `credential` table: id, issuer_did, subject_did, type, credential_data (JSON), proof, issued_at, expires_at
- `presentation` table: id, holder_did, verifiable_credentials (array), proof, created_at

**Zod Schemas (in `packages/types/src/credentials.ts`):**

- VC 2.0 Credential schema
- Verifiable Presentation schema
- DID document schema
- Proof schemas

**VC Endpoints:**

- `src/routes/api/credentials/issue/+server.ts` - Issue VC to a user
- `src/routes/api/credentials/verify/+server.ts` - Verify a VC
- `src/routes/api/credentials/[id]/+server.ts` - Get credential details
- `src/routes/api/presentations/create/+server.ts` - Create VP
- `src/routes/api/presentations/verify/+server.ts` - Verify VP

**VC Library:**

- `src/lib/server/verifiable-credentials/` directory: - `did.ts` - DID (Decentralized Identifier) generation/resolution - `issuer.ts` - VC issuance logic - `verifier.ts` - VC/VP verification - `proof.ts` - Cryptographic proof generation (Data Integrity, JSON-LD) - `types.ts` - Re-export types from `@syr-is/types`

Dependencies: `@digitalbazaar/vc` or similar W3C VC library

### 4.2 Digital Proof Storage

- Store proofs of user interactions from integrated services
- Link proofs to VCs (proof of content creation, engagement, etc.)
- API for services to submit proofs via integration SDK
- Validate proof submissions using Zod schemas

## Phase 5: OAuth Provider & Integration SDK

### 5.1 OAuth 2.0 Provider

**Database Schema:**

- `oauth_client` table: client_id, client_secret, name, redirect_uris, scopes
- `oauth_authorization_code` table: code, client_id, user_id, redirect_uri, expires_at
- `oauth_access_token` table: token, client_id, user_id, scopes, expires_at

**Zod Schemas (in `packages/types/src/oauth.ts`):**

- OAuth client registration schema
- Token request/response schemas
- Authorization request schema

**OAuth Endpoints:**

- `src/routes/oauth/authorize/+server.ts` - Authorization endpoint
- `src/routes/oauth/token/+server.ts` - Token endpoint
- `src/routes/oauth/userinfo/+server.ts` - UserInfo endpoint (OpenID Connect)
- `src/routes/oauth/clients/+server.ts` - Client registration

### 5.2 First-Party Integration SDK

Create new package in monorepo: `packages/syr-sdk/`

**Package structure:**

```
packages/syr-sdk/
├── package.json
├── src/
│   ├── index.ts
│   ├── client.ts - Main SDK client
│   ├── auth.ts - OAuth helpers
│   ├── events.ts - Event emission
│   ├── proofs.ts - Proof submission
│   └── types.ts - Re-export from @syr-is/types
└── README.md
```

**SDK Features:**

- OAuth login flow helpers
- Event emission (post created, user action, etc.)
- Proof submission API
- TypeScript support with Zod validation
- Browser and Node.js support
- Uses shared types from `@syr-is/types`

**Example Usage:**

```typescript
import { SyrClient } from "@syr-is/sdk";

const client = new SyrClient({
  clientId: "your-client-id",
  clientSecret: "your-client-secret",
});

// Emit event
await client.events.emit({
  type: "post.created",
  userId: "user123",
  data: { postId: "post456", content: "..." },
});
```

## Phase 6: UI/UX Polish

### 6.1 shadcn-svelte Setup

- Install and configure shadcn-svelte CLI
- Initialize shadcn-svelte with Tailwind CSS 4
- Set up components directory structure
- Configure theme (light/dark mode support)
- Add required shadcn-svelte components: - Button, Input, Label, Card - Form components (Input, Textarea, Select) - Dialog, Sheet, Dropdown Menu - Avatar, Badge, Separator - Table, Tabs, Toast - Command palette (for search)

### 6.2 Modern UI Design

- Design system using shadcn-svelte + Tailwind CSS 4
- Custom components in `src/lib/components/`
- Responsive layout with proper navigation
- Dark mode support (built into shadcn-svelte)
- Consistent spacing and typography

### 6.3 Key Pages

- Homepage explaining SYR vision (Hero, Features sections)
- User dashboard (Cards, Stats, Activity overview)
- Activity feed (ActivityPub posts with Card components)
- Credentials page (view/manage VCs with Table/Card components)
- Developer settings (OAuth clients, API keys with Form components)
- Settings pages (Profile, Account, Preferences with Tabs)

## Technical Considerations

### Dependencies to Add

**Root & Apps:**

- `surrealdb.js` - SurrealDB client
- `@aws-sdk/client-s3` - S3 client for SeaweedFS
- `@digitalbazaar/vc` or `@spruceid/didkit-wasm` - VC 2.0 support
- `jsonwebtoken` - JWT for sessions
- `@node-rs/argon2` - Argon2id password hashing (fast native bindings)
- `shadcn-svelte` - UI components

**packages/types:**

- `zod` v4 (stable) - Schema validation

**packages/syr-sdk:**

- Dependencies on `@syr-is/types`
- HTTP client (fetch or axios)

### Security

- HTTPS required for production
- HTTP Signatures for ActivityPub
- Rate limiting on API endpoints
- CSRF protection
- Input validation with Zod schemas from `@syr-is/types`
- Secure credential storage (encrypt private keys)

### Configuration

Update `pnpm-workspace.yaml` to include `packages/`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### Documentation Updates

Update `README.md` to include:

- SYR vision overview
- Setup instructions for SurrealDB
- API documentation links
- SDK usage examples
- Types package documentation

### To-dos

- [ ] Create Architecture.md documenting SYR vision, system design, data models, and integration patterns
- [ ] Add SurrealDB and MCP servers to Docker configuration files
- [ ] Integrate SurrealDB client, create database connection utilities and initial schema
- [ ] Implement user registration, login, session management with database schema and API routes
- [ ] Build user profile system with CRUD operations, avatar uploads, and frontend pages
- [ ] Create ActivityPub actor model, WebFinger, inbox/outbox endpoints, and HTTP signatures
- [ ] Implement federation logic: remote actor fetching, activity delivery, and inbox processing
- [ ] Build VC 2.0 implementation with DID support, credential issuance, and verification
- [ ] Implement digital proof storage system linked to VCs and user interactions
- [ ] Create OAuth 2.0 provider with authorization flow, token management, and client registration
- [ ] Build first-party JavaScript SDK package for service integration and event emission
- [ ] Design and implement modern UI with dashboard, activity feed, credentials page, and developer settings
