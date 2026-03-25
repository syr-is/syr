# @syr-is/types

Shared TypeScript types and **Zod v4** schemas for the Syr platform (`did:syr`, profiles, posts, auth, registry, signed mutations, etc.).

## Installation

```bash
pnpm add @syr-is/types
```

## What’s in the package

Exports are listed in [`src/index.ts`](./src/index.ts). Highlights:

| Module                                                                                                               | Contents                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`common.ts`**                                                                                                      | `RecordIdSchema`, `TimestampSchema`, `BaseEntitySchema`, `DidSyrSchema`, `IdentityHostUrlSchema`, `ProfileSignedImageUrlSchema`, codecs-friendly primitives |
| **`codecs.ts`**                                                                                                      | Bi-directional codecs (e.g. ISO datetime ↔ `Date`, record IDs)                                                                                             |
| **`user.ts`**                                                                                                        | `UserSchema`, `ProfileSchema`, registration/login/session shapes                                                                                            |
| **`identity.ts`**                                                                                                    | Identity records, delegations, export bundle, init/delegate requests                                                                                        |
| **`signed-mutations.ts`**                                                                                            | Client-signed profile/post mutation payloads                                                                                                                |
| **`independent-login.ts`**                                                                                           | Challenge / callback types for Syner-style login                                                                                                            |
| **`persona.ts`**                                                                                                     | Local Syner persona / profile JSON shape                                                                                                                    |
| **`api.ts`**                                                                                                         | Shared API response and error envelopes                                                                                                                     |
| **`posts.ts`**, **`uploads.ts`**, **`folders.ts`**, **`events.ts`**, **`registry.ts`**, **`tenant.ts`**, **`kv.ts`** | Domain models for the Syr app and integrations                                                                                                              |

**DID method:** Syr uses **`did:syr`** (multibase-encoded Ed25519 public key), validated by `DidSyrSchema`—not `did:web`. Older README text referring to `did:web`-only `DIDSchema`, OAuth, or VC modules described a different design; those files are not part of this package today.

## Usage

```typescript
import { UserLoginSchema, DidSyrSchema, type UserLogin } from '@syr-is/types';

const parsed = UserLoginSchema.safeParse({ username: 'alice', password: 'secret' });
if (parsed.success) {
	const data: UserLogin = parsed.data;
	// ...
}
```

With codecs (see `codecs.ts`):

```typescript
import { isoDatetimeToDate } from '@syr-is/types';

const d = isoDatetimeToDate.decode('2024-01-15T10:30:00.000Z');
const iso = isoDatetimeToDate.encode(new Date());
```

## Dependencies

- **Zod v4** (from the workspace catalog)

## Contributing

This package lives in the Syr monorepo. See the [root README](../../../README.md).

## License

See the [root LICENSE](../../../LICENSE).
