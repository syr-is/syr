# @syr-is/types

Shared TypeScript types and Zod schemas for the SYR (Self-Yield Representation) platform.

## Overview

This package provides type-safe schemas and TypeScript definitions for all data models in the SYR ecosystem, including:

- **User Management**: User accounts, profiles, authentication
- **ActivityPub**: Actors, activities, objects, federation
- **Verifiable Credentials**: W3C VC 2.0 data models, DIDs, proofs
- **OAuth 2.0**: Clients, tokens, authorization flows
- **Events**: Service integration event schemas
- **Digital Proofs**: Cryptographic proof models
- **API**: Common API response and error schemas

## Installation

```bash
pnpm add @syr-is/types
```

## Usage

### Schema Validation

```typescript
import {
  UserSchema,
  UserRegistrationSchema,
  type User,
  type UserRegistration,
} from "@syr-is/types";

// Validate data
const result = UserRegistrationSchema.safeParse({
  username: "alice",
  password: "SecurePass123",
  display_name: "Alice",
});

if (result.success) {
  const userData: UserRegistration = result.data;
  // ... proceed with registration
}
```

### Using Codecs

```typescript
import { isoDatetimeToDate, json } from "@syr-is/types";
import { z } from "zod";

// Date transformation
const date = isoDatetimeToDate.decode("2024-01-15T10:30:00.000Z");
// => Date object

const isoString = isoDatetimeToDate.encode(new Date());
// => "2024-01-15T10:30:00.000Z"

// JSON with validation
const personCodec = json(z.object({ name: z.string(), age: z.number() }));
const person = personCodec.decode('{"name":"Alice","age":30}');
// => { name: "Alice", age: 30 }

const jsonString = personCodec.encode({ name: "Bob", age: 25 });
// => '{"name":"Bob","age":25}'
```

### Extending Base Schemas

```typescript
import { BaseEntitySchema, DIDSchema, isoDatetimeToDate } from "@syr-is/types";
import { z } from "zod";

// Create a new entity type extending the base
const MyEntitySchema = BaseEntitySchema.extend({
  name: z.string(),
  did: DIDSchema.optional(),
  // id, created_at, updated_at inherited from BaseEntitySchema (all as ISO strings)
});

// Parse data from database/API (timestamps as ISO strings)
const entity = MyEntitySchema.parse({
  id: "123e4567-e89b-12d3-a456-426614174000",
  name: "Example",
  created_at: "2024-01-15T10:30:00.000Z",
  updated_at: "2024-01-15T10:30:00.000Z",
});

// Convert timestamps to Date objects when needed
const createdDate = isoDatetimeToDate.decode(entity.created_at);
// => Date object
```

## Philosophy: Digital Sovereignty

The SYR platform is built on principles of digital sovereignty:

- **No Required Email**: Users can create accounts without email addresses
- **did:web Only**: Enforces `did:web` method - DNS-based DIDs with no blockchain dependency
  - Format: `did:web:example.com` or `did:web:example.com:users:alice`
  - You control your DID by controlling your domain
  - No centralized registries, no blockchain fees
  - Easy migration: just move your domain
- **Federated**: ActivityPub support for cross-platform communication
- **Verifiable Credentials**: W3C VC 2.0 for reputation and credibility
- **User Control**: Users own their data and digital presence

## Schema Categories

### Common Base Schemas (`common.ts`)

Shared base schemas to reduce redundancy:

- `DIDSchema` - did:web identifier (enforced throughout)
- `UUIDSchema` - UUID format
- `TimestampSchema` - ISO 8601 datetime string (use `isoDatetimeToDate` codec to convert to Date)
- `BaseEntitySchema` - Common entity fields (id, created_at, updated_at)
  - **Note:** All timestamps are ISO 8601 strings, not Date objects
  - Use `isoDatetimeToDate` codec to convert when needed
- `BaseEntityWithDIDSchema` - Entity with optional DID field
- `MetadataSchema` - Generic metadata object

**Design Philosophy:** Timestamps are stored as ISO 8601 strings for consistency across serialization boundaries (database, API, JSON). Convert to JavaScript `Date` objects only when needed using the `isoDatetimeToDate` codec.

### Codecs (`codecs.ts`)

Bi-directional data transformations based on [Zod v4 codecs](https://zod.dev/codecs):

**Number/String Conversions:**

- `stringToNumber` - String ↔ Number
- `stringToInt` - String ↔ Integer
- `stringToBigInt` - String ↔ BigInt
- `numberToBigInt` - Number ↔ BigInt
- `stringToBoolean` - "true"/"false" ↔ Boolean

**Date/Time Conversions:**

- `isoDatetimeToDate` - ISO string ↔ Date (primary codec for dates)
- `epochSecondsToDate` - Unix seconds ↔ Date
- `epochMillisToDate` - Unix milliseconds ↔ Date

**Data Encoding:**

- `json(schema)` - JSON string ↔ Typed object
- `utf8ToBytes` - UTF-8 string ↔ Uint8Array
- `bytesToUtf8` - Uint8Array ↔ UTF-8 string
- `base64ToBytes` - Base64 ↔ Uint8Array
- `base64urlToBytes` - Base64URL ↔ Uint8Array
- `hexToBytes` - Hex string ↔ Uint8Array

**URL/URI:**

- `stringToURL` - URL string ↔ URL object
- `stringToHttpURL` - HTTP/HTTPS string ↔ URL object
- `uriComponent` - URI component encoding/decoding

**Example Usage:**

```typescript
import { isoDatetimeToDate } from "@syr-is/types";

// Decode: ISO string → Date
const date = isoDatetimeToDate.decode("2024-01-15T10:30:00.000Z");

// Encode: Date → ISO string
const isoString = isoDatetimeToDate.encode(new Date());
```

### User & Profile (`user.ts`)

- `UserSchema` - User account (username, optional email, optional DID)
- `ProfileSchema` - Public profile information
- `UserRegistrationSchema` - Registration validation
- `UserLoginSchema` - Login validation
- `SessionSchema` - Authentication sessions

### ActivityPub (`activitypub.ts`)

- `ActorSchema` - ActivityPub actors (Person, Service, etc.)
- `ActivitySchema` - Activities (Create, Follow, Accept, etc.)
- `ObjectSchema` - Content objects (Note, Article, etc.)
- `CollectionSchema` - Collections and paginated lists
- `WebFingerResourceSchema` - WebFinger discovery

### Verifiable Credentials (`credentials.ts`)

- `DIDSchema` - Decentralized Identifier (enforces `did:web` method only)
- `DIDDocumentSchema` - W3C DID Document
- `VerifiableCredentialSchema` - W3C VC 2.0 credentials
- `VerifiablePresentationSchema` - Credential presentations
- `ProofSchema` - Cryptographic proofs

### OAuth 2.0 (`oauth.ts`)

- `OAuthClientSchema` - Registered OAuth clients
- `OAuthAuthorizationCodeSchema` - Authorization codes
- `OAuthAccessTokenSchema` - Access tokens
- `OAuthTokenRequestSchema` - Token requests
- `OAuthUserInfoResponseSchema` - UserInfo endpoint

### Events (`events.ts`)

- `EventSchema` - Base event structure
- `PostEventDataSchema` - Post creation events
- `CommentEventDataSchema` - Comment events
- `InteractionEventDataSchema` - Like, follow events
- `EventEmissionRequestSchema` - Event submission

### Digital Proofs (`proofs.ts`)

- `DigitalProofSchema` - Cryptographic proof of actions
- `ProofCreationRequestSchema` - Proof creation
- `ProofVerificationResultSchema` - Verification results
- `AttestationSchema` - Third-party attestations

### API Utilities (`api.ts`)

- `APIResponseSchema<T>` - Generic API response wrapper
- `PaginatedResponseSchema<T>` - Paginated responses
- `APIErrorSchema` - Standardized error responses
- `QueryOptionsSchema` - List query parameters

## Validation Example

```typescript
import { VerifiableCredentialSchema } from "@syr-is/types";

// Validate a credential
const credential = {
  "@context": ["https://www.w3.org/2018/credentials/v1"],
  type: ["VerifiableCredential"],
  issuer: "did:example:issuer",
  issuanceDate: "2025-01-01T00:00:00Z",
  credentialSubject: {
    id: "did:example:subject",
    reputation: 100,
  },
};

const result = VerifiableCredentialSchema.safeParse(credential);
```

## Type Inference

All schemas automatically infer TypeScript types:

```typescript
import { UserSchema, type User } from "@syr-is/types";

// Type is automatically inferred from schema
type User = z.infer<typeof UserSchema>;

// Use the exported type directly
function getUser(id: string): User {
  // ...
}
```

## Dependencies

- **Zod v4**: Schema validation library
- Designed for use with Zod v4's improved API

## Contributing

This package is part of the SYR monorepo. See the [main README](../../README.md) for contribution guidelines.

## License

See the [main LICENSE](../../LICENSE) file in the repository root.
