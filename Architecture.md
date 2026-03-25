# SYR Architecture

## Vision and Principles

The Self-Yield Representation (SYR) Project creates **sovereign identity on decentralized social infrastructure** where:

- **Identity is self-sovereign**: Users own cryptographic root identities managed by their SYR instance, exportable on demand
- **Posts are identity**: What you think and share is integral to who you are — posts travel with your identity
- **Communities define norms**: Cultural context travels with content, not algorithmic scores
- **Accountability is human**: Judgment rooted in human context, not engagement metrics
- **Discovery is organic**: People find each other through human connections, not feeds
- **Multi-tenancy is native**: A single instance can manage isolated identity pools for multiple organizations

## System Overview

```mermaid
graph TB
    subgraph "Client Layer"
        Web[Web Application<br/>SvelteKit + shadcn-svelte]
        Syner[Syner Native App<br/>Tauri v2]
        SDK[Integration SDK<br/>@syr-is/sdk]
    end

    subgraph "Application Layer"
        API[SvelteKit Backend<br/>API Routes]
        Auth[Authentication<br/>JWT + Sessions]
        IDM[Identity Manager<br/>Key Generation + DID]
        SSEBridge[SSE Signing Bridge<br/>Syner Communication]
        VC[Credential Store<br/>Identity-Linked VCs]
        IDA[Identity-Based Auth<br/>Cross-Instance Login]
        TM[Tenant Manager<br/>Multi-Tenant Isolation]
    end

    subgraph "Data Layer"
        Types[Shared Types<br/>@syr-is/types<br/>Zod Schemas]
        Crypto[Crypto Package<br/>@syr-is/crypto<br/>Ed25519]
        DB[(SurrealDB<br/>Multi-model Database)]
        S3[(SeaweedFS<br/>S3 Storage)]
    end

    subgraph "External"
        SYR2[Other SYR Providers<br/>Peer hosting]
        Services[Third-party Services<br/>Identity-Based Login]
        Registry[DID Registry<br/>did:syr Resolution]
    end

    Web --> API
    Syner <-->|"SSE + HTTP"| SSEBridge
    SDK --> API
    API --> Auth
    API --> IDM
    API --> SSEBridge
    API --> VC
    API --> IDA
    API --> TM

    Auth --> DB
    IDM --> DB
    IDM --> Crypto
    VC --> DB
    IDA --> Registry

    API --> Types
    SDK --> Types

    API <-->|"registry resolve + public APIs"| SYR2
    Services --> IDA
```

## DID Method: did:syr

SYR uses the **did:syr** method for decentralized identifiers:

- **Key-Anchored**: DIDs are derived from the root identity's Ed25519 public key
- **No Blockchain**: No dependency on blockchain infrastructure
- **Self-Sovereign**: Users control their identity through their cryptographic root key
- **Registry-Resolved**: `did:syr:<multibase-encoded-pubkey>` resolves via the SYR registry to find the user's current provider/instance
- **Portable**: Identity can migrate between SYR instances without changing the DID

**Why did:syr?**

- Fully sovereign (rooted in cryptographic keys you control)
- No centralized registries or blockchain fees
- Provider-portable — move between instances without losing identity
- Compatible with the SYR key hierarchy (root keys, delegated device keys, recovery keys)

## Core Components

### 1. Identity System

The identity system is the core of SYR. In the current phase, keys are **generated and managed server-side** by the SYR instance as a transitionary convenience. Users can explicitly export/offload their keys via the export-bundle endpoint. Once **Syner** (the native companion app) is available, Syner-managed identity becomes the canonical self-custody method, with server-managed keys remaining available for users who prefer managed hosting.

SurrealDB's native composite record IDs extend the identity model into the data layer. The `post` and `upload` tables use composite keys `{ created_by: DID, id: ULID }`, embedding the creator's DID in every record. This yields global uniqueness, portable identity (records survive migration with original IDs), direct ownership proof, and zero-conflict import/export across instances.

```mermaid
erDiagram
    TENANT ||--o{ USER : "contains"
    USER ||--o| PROFILE : has
    USER ||--o| IDENTITY : "has root identity"
    IDENTITY ||--o{ DELEGATED_KEY : "delegates to"
    USER ||--o{ SESSION : has
    USER ||--o{ CREDENTIAL : "holds"

    TENANT {
        string id PK
        string name
        string slug UK
        json settings
        datetime created_at
    }

    USER {
        string id PK
        string tenant_id FK
        string username UK
        string password_hash
        string did
        string role
        datetime created_at
        datetime updated_at
    }

    PROFILE {
        string id PK
        string user_id FK
        string display_name
        string bio
        string avatar_url
        string banner_url
        json metadata
    }

    IDENTITY {
        string id PK
        string user_id FK
        string did UK
        string root_public_key
        datetime created_at
    }

    DELEGATED_KEY {
        string id PK
        string identity_id FK
        string public_key
        string scope
        string delegation_signature
        datetime created_at
        datetime expires_at
        datetime revoked_at
    }

    SESSION {
        string id PK
        string user_id FK
        string token
        datetime expires_at
        datetime last_active
    }
```

### 2. Cross-provider social (DID + registry + public APIs)

Users on one SYR instance can **follow** other identities by **`did:syr`** and read their **public** profiles and posts from the **author’s Syr instance**. Follow rows persist **`followed_provider_url`** (the provider base URL) after a **registry-verified** resolve at follow time (or after an explicit **refresh from registry**). The home timeline and Following page **fetch public APIs using that stored URL** so routine reads do not depend on discovery registries being reachable. **Legacy rows** without a stored URL fall back to resolving via registries in the browser.

**Manual provider URL override (guardrails):** Advanced users may **manually edit** the stored provider base URL on the Following page when registry data is wrong or a peer has moved. The UI treats this as an operational escape hatch: inputs are normalized to **http(s)** with **no userinfo**, bounded length, and trailing slashes stripped—but there is **no cryptographic proof** that the host matches the followed DID. Prefer **refresh from registry** whenever registries are trustworthy; treat manual overrides as “best effort” until the row is refreshed or re-followed. See _Follows, Discovery, and Home Timeline_ in the docs app.

```mermaid
sequenceDiagram
    participant Viewer as Viewer client
    participant Home as Home Syr API
    participant Registry as Discovery registry
    participant Author as Author provider

    Note over Viewer,Home: Create follow
    Viewer->>Home: POST /api/follows
    Home->>Registry: resolve did via gate
    Registry-->>Home: Signed hosting record
    Home->>Home: Store user_follow.followed_provider_url

    Note over Viewer,Author: Timeline or following list
    Viewer->>Home: GET /api/follows
    Home-->>Viewer: rows with followed_provider_url
    Viewer->>Author: GET /api/public/posts using stored base URL
    Author->>Viewer: Post metadata or full post (public)
```

### 3. Verifiable Credentials

VCs in SYR are **credentials that others issue to you**, linked to your identity. They represent attestations like memberships, roles, KYC verifications, or qualifications that enrich your identity. VC exchange for platforms with specific credential requirements to join is planned for a future phase.

```mermaid
sequenceDiagram
    participant Issuer as External Issuer
    participant SYR as SYR Instance
    participant User
    participant Platform as Platform with VC Requirements

    Issuer->>SYR: Issue Credential<br/>(W3C VC 2.0 format)
    SYR->>SYR: Validate + Store VC
    SYR->>User: Credential linked<br/>to identity

    Note over User,Platform: Later, joining a platform

    User->>Platform: Request to join
    Platform->>User: Requires specific VC
    User->>SYR: Select credential
    SYR->>SYR: Build Verifiable Presentation
    SYR->>Platform: Present VP
    Platform->>SYR: Verify credential<br/>(check signature + status)
    Platform->>User: Access granted
```

### 4. Verifiable Credentials Data Model

```mermaid
erDiagram
    USER ||--o{ CREDENTIAL : "holds"
    CREDENTIAL }o--|| ISSUER : "issued by"
    CREDENTIAL ||--o{ PROOF : "proven by"

    CREDENTIAL {
        string id PK
        string issuer_did
        string subject_did
        string type
        json credential_data
        json proof
        datetime issued_at
        datetime expires_at
    }

    PROOF {
        string id PK
        string credential_id FK
        string proof_type
        string created
        string verification_method
        string proof_value
        string proof_purpose
    }

    ISSUER {
        string did PK
        string name
        json public_key
        string verification_method
    }
```

### 5. Identity-Based Login Flow

Third-party platforms authenticate users through their SYR instance. Instead of generic OAuth, users enter their instance name and username (or DID), which is resolved via the registry to locate their SYR instance.

```mermaid
sequenceDiagram
    participant User
    participant Platform as Third-party Platform
    participant Registry as DID Registry
    participant SYR as User's SYR Instance

    User->>Platform: Enter instance + username<br/>or DID
    Platform->>Registry: Resolve DID<br/>(did:syr → instance URL)
    Registry->>Platform: Instance endpoint

    Platform->>SYR: Request auth challenge
    SYR->>User: Prompt for login<br/>(password for hosted keys)
    User->>SYR: Authenticate
    SYR->>SYR: Verify credentials
    SYR->>Platform: Issue identity token
    Platform->>Platform: Establish session
    Platform->>User: Authenticated

    Note over User,SYR: Future: signing challenge<br/>for offloaded keys
```

### 6. Identity-Based Auth Data Model

```mermaid
erDiagram
    AUTH_CLIENT ||--o{ AUTH_TOKEN : issues
    USER ||--o{ AUTH_TOKEN : owns

    AUTH_CLIENT {
        string client_id PK
        string instance_url
        string name
        array scopes
        datetime created_at
    }

    AUTH_TOKEN {
        string token PK
        string client_id FK
        string user_id FK
        string did
        array scopes
        datetime expires_at
        datetime created_at
    }
```

## Technology Stack

```mermaid
graph LR
    subgraph "Frontend"
        Svelte[Svelte 5]
        SvelteKit[SvelteKit 2]
        Tailwind[Tailwind CSS 4]
        Shadcn[shadcn-svelte]
    end

    subgraph "Backend"
        SK_API[SvelteKit API Routes]
        Node[Node.js 20+]
    end

    subgraph "Type System"
        TS[TypeScript]
        Zod[Zod 4]
    end

    subgraph "Storage"
        SurrealDB[(SurrealDB<br/>Database)]
        SeaweedFS[(SeaweedFS<br/>S3 Storage)]
    end

    subgraph "Protocols & Standards"
        VC_Proto[W3C VC 2.0]
        DID_Proto[did:syr Method]
        SSI[Self-Sovereign Identity]
    end

    subgraph "Build Tools"
        Vite[Vite 7]
        pnpm[pnpm]
        Turbo[Turborepo 2]
    end

    Svelte --> SvelteKit
    SvelteKit --> Tailwind
    SvelteKit --> Shadcn
    SvelteKit --> SK_API
    SK_API --> Node

    TS --> Zod

    SK_API --> SurrealDB
    SK_API --> SeaweedFS
    SK_API --> VC_Proto
    SK_API --> DID_Proto

    SvelteKit --> Vite
    pnpm --> Turbo
```

## Authentication & Authorization Flow

SYR uses username/password authentication for users with server-hosted keys. Sessions are managed via JWT tokens.

```mermaid
stateDiagram-v2
    [*] --> Unauthenticated

    Unauthenticated --> Registering: Register
    Registering --> Unauthenticated: Cancel
    Registering --> Authenticated: Success<br/>(identity created server-side)

    Unauthenticated --> LoggingIn: Login
    LoggingIn --> Unauthenticated: Failure
    LoggingIn --> Authenticated: Success

    Authenticated --> Protected: Access Resource
    Protected --> Authenticated: Authorized
    Protected --> Unauthenticated: Invalid Session

    Authenticated --> Unauthenticated: Logout

    note right of Authenticated
        JWT token stored
        Session validated
        Identity operations signed
        server-side with hosted keys
    end note
```

## Data Flow Architecture

```mermaid
flowchart TB
    User[User Action]

    User --> Route[SvelteKit Route]
    Route --> Validate{Validate with<br/>Zod Schema}

    Validate -->|Invalid| Error[Return 400 Error]
    Validate -->|Valid| Auth{Check Auth}

    Auth -->|Unauthorized| Error401[Return 401 Error]
    Auth -->|Authorized| Tenant{Check Tenant<br/>Scope}

    Tenant -->|Wrong Tenant| Error403[Return 403 Error]
    Tenant -->|Valid| Business[Business Logic]

    Business --> DB[SurrealDB Query]
    DB --> Transform[Transform Data]
    Transform --> Response[Return Response]

    Business -.->|If registry sync| RegistryJobs[Registry sync jobs<br/>/api/identity/outbox]
    Business -.->|If signed| Sign[Server-Side Signing<br/>with Hosted Keys]

    RegistryJobs --> Remote[Registry server]

    style Validate fill:#fff3cd
    style Auth fill:#fff3cd
    style Tenant fill:#fff3cd
    style Business fill:#d1ecf1
```

## Security Model

### 1. Authentication Layers

```mermaid
graph TD
    A[Request] --> B{Session Valid?}
    B -->|No| C[Return 401]
    B -->|Yes| D{JWT Valid?}
    D -->|No| C
    D -->|Yes| E{User Exists?}
    E -->|No| C
    E -->|Yes| F{Tenant Scope OK?}
    F -->|No| G[Return 403]
    F -->|Yes| H{Permissions OK?}
    H -->|No| G
    H -->|Yes| I[Process Request]
```

### 2. Cross-provider trust boundaries

When one instance or browser loads **another** provider’s public content:

- **Registry hosting records** are Ed25519-signed; the resolver verifies the signature before trusting `provider` URLs (`@syr-is/resolver`).
- **HTTPS** to peer providers is required in production; treat peer responses as **untrusted** at the HTTP layer (CORS, availability, and content limits apply on the client).
- **Signed profile and post mutations** (where implemented) establish cryptographic integrity of authored content; they are separate from transport trust.

There is no inbox protocol between instances for follows: visibility is **pull** via public endpoints using a **stored** provider base URL on the follow row (or registry resolution when no URL is stored / for discovery). **Manual** URL overrides are not registry-verified.

### 3. Password Security

**Argon2id Configuration**

SYR uses Argon2id, the winner of the Password Hashing Competition, for password hashing:

- **Algorithm**: Argon2id (hybrid mode - resistant to both side-channel and GPU attacks)
- **Memory Cost**: 64 MiB (65536 KiB) - makes GPU cracking expensive
- **Time Cost**: 3 iterations - balances security and performance
- **Parallelism**: 4 threads - leverages multi-core CPUs
- **Output**: 32-byte hash with random salt

**Why Argon2id over bcrypt?**

- More resistant to GPU/ASIC attacks
- Configurable memory hardness
- Modern design (2015 vs bcrypt's 1999)
- OWASP recommended
- Native Rust bindings for Node.js (@node-rs/argon2) - extremely fast

### 4. Key Management Security

- **Server-hosted keys (transitionary)**: Root identity keys are generated and stored server-side, encrypted at rest. This is a convenience for users who are not yet ready for self-custody.
- **Syner-managed keys (canonical, future)**: When Syner is available, keys are generated and stored in platform-native secure keystores (Keychain, DPAPI, libsecret, Android Keystore). The server never sees the private key.
- **Export-bundle**: Users can export their full identity (keys, posts, assets) as a portable zip for migration.
- **Audit trail**: All key operations (generation, delegation, export, revocation) are logged.
- **Delegated keys**: Device-specific keys can be delegated from the root key for multi-device access.

## Package Architecture

```mermaid
graph TB
    subgraph "Monorepo Structure"
        subgraph "apps/"
            App[syr<br/>Main SvelteKit App]
            RegistryApp[registry<br/>NestJS Registry API]
            Docs[docs<br/>Documentation Site]
            SynerApp[syner<br/>Tauri v2 Native App<br/>Future]
        end

        subgraph "packages/"
            Types[types<br/>@syr-is/types<br/>Zod Schemas]
            Crypto[crypto<br/>@syr-is/crypto<br/>Ed25519 Operations]
            DID[did<br/>@syr-is/did<br/>DID Method]
            Resolver[resolver<br/>@syr-is/resolver<br/>DID Resolution]
            SDK[syr-sdk<br/>@syr-is/sdk<br/>Integration Library]
        end
    end

    App --> Types
    App --> Crypto
    App --> DID
    RegistryApp --> Crypto
    SynerApp --> Crypto
    SynerApp --> Types
    Resolver --> Crypto
    Resolver --> DID
    SDK --> Types

    subgraph "External Consumers"
        ThirdParty[Third-party Services]
    end

    ThirdParty --> SDK
```

## Deployment Architecture

```mermaid
graph TB
    subgraph "Docker Compose"
        Web[SYR Web<br/>SvelteKit Container]
        DB[(SurrealDB<br/>Container)]
        S3[(SeaweedFS<br/>S3-compatible Storage)]
    end

    subgraph "External"
        Users[Instance Users]
        PeerProviders[Other SYR Providers]
        ThirdParty[Third-party Platforms<br/>Identity-Based Login]
    end

    Users --> Web
    Web -->|"HTTPS public APIs + registry"| PeerProviders
    ThirdParty --> Web
    Web --> DB
    Web --> S3

    style DB fill:#ffe1f5
    style S3 fill:#d4edda
```

## Integration SDK Design

### SDK Usage Flow

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant Service as Service App
    participant SDK as @syr-is/sdk
    participant SYR as SYR Instance

    Dev->>SYR: Register as auth client
    SYR->>Dev: client_id

    Dev->>Service: Install @syr-is/sdk
    Dev->>Service: Initialize SyrClient

    Note over Service: User wants to log in

    Service->>SDK: client.auth.login(did)
    SDK->>SYR: Resolve DID + request auth
    SYR->>SYR: Authenticate user
    SYR->>SDK: Identity token
    SDK->>Service: User authenticated

    Note over Service: User performs action

    Service->>SDK: client.events.emit()
    SDK->>SDK: Validate with Zod
    SDK->>SYR: POST /api/events
    SYR->>SDK: Event recorded
```

## Future Considerations

### Scalability

```mermaid
graph LR
    A[Current: Single Server] --> B[Phase 4: NestJS Backend]
    B --> C[Phase 5: Horizontal Scaling]
```

### Federation Network

```mermaid
graph TD
    SYR1[SYR Instance A]
    SYR2[SYR Instance B]
    SYR3[SYR Instance C]
    SYR4[SYR Instance D]

    SYR1 <--> SYR2
    SYR1 <--> SYR3
    SYR2 <--> SYR4
    SYR3 <--> SYR4

    style SYR1 fill:#0d6efd,color:#fff
    style SYR2 fill:#0d6efd,color:#fff
    style SYR3 fill:#0d6efd,color:#fff
    style SYR4 fill:#0d6efd,color:#fff
```

## Implementation Phases

```mermaid
gantt
    title SYR Implementation Timeline
    dateFormat YYYY-MM-DD
    section Foundation
    Architecture Doc           :done, arch, 2025-01-01, 1d
    Types Package             :active, types, after arch, 2d
    Crypto Package            :crypto, after types, 2d
    Docker Setup              :docker, after crypto, 2d

    section Core Identity
    SurrealDB Integration     :db, after docker, 2d
    User Auth System          :auth, after db, 3d
    Identity Manager          :idm, after auth, 4d
    Profile System            :profile, after idm, 3d

    section SocialAndRegistry
    FollowsTimelinePolish    :social, after profile, 5d
    RegistryReliability      :regrel, after social, 4d

    section Credentials
    VC Storage Model         :vc, after profile, 4d
    VC Presentation          :vp, after vc, 3d

    section Identity-Based Auth
    Auth Protocol            :ida, after auth, 4d
    SDK Integration          :sdk, after ida, 3d

    section Multi-Tenancy
    Tenant Model             :tenant, after db, 3d
    Tenant Isolation         :iso, after tenant, 4d

    section UI
    shadcn-svelte Setup      :ui, after auth, 2d
    UI Polish                :polish, after regrel, 5d
```

## Glossary

- **Self-Sovereign Identity (SSI)**: Identity model where the individual controls their own identity without relying on a central authority
- **DID**: Decentralized Identifier - a portable, cryptographically verifiable identifier
- **did:syr**: SYR's DID method — key-anchored, registry-resolved, provider-portable
- **Root Key**: Ed25519 keypair that anchors a user's identity — managed server-side, exportable on demand
- **Delegated Key**: Device-specific key authorized by the root key for multi-device access
- **VC**: Verifiable Credential - a credential others issue to you, linked to your identity (W3C VC 2.0 format)
- **VP**: Verifiable Presentation - a collection of VCs shared for verification when joining platforms
- **Identity-Based Login**: Authentication where users enter their SYR instance + username/DID to log into third-party platforms
- **Multi-Tenancy**: A single SYR instance managing isolated identity pools for multiple organizations
- **SurrealDB**: Multi-model database supporting document, graph, and relational models; native composite/object record IDs enable DID-anchored keys for `post` and `upload` tables
- **SeaweedFS**: Distributed S3-compatible object storage for files, images, and media
- **Zod**: TypeScript-first schema validation library (v4)

## References

- [W3C Decentralized Identifiers (DIDs)](https://www.w3.org/TR/did-core/)
- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [SurrealDB Documentation](https://surrealdb.com/docs)
- [SeaweedFS Documentation](https://github.com/seaweedfs/seaweedfs)
- [Zod v4 Documentation](https://zod.dev)
- [SYR Vision](https://www.syr.is/)
