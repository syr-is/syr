---
title: Syner Integration
---

# Syner Integration with SYR

This document specifies the API contracts, data flows, and implementation requirements for integrating Syner (the native companion app) with the SYR web application.

---

## 1. SYR-Side Endpoints

The following API endpoints must be implemented on the SYR web application to support Syner.

### 1.1 Device Pairing

**`POST /api/syner/pair`**

Registers a Syner device with the SYR instance.

Request:
```json
{
  "pairing_code": "ABC123",
  "device_public_key": "z6Mk...(multibase Ed25519)",
  "device_info": {
    "name": "Alice's MacBook",
    "os": "macos",
    "model": "MacBook Pro"
  }
}
```

Response:
```json
{
  "device_token": "jwt...",
  "instance_url": "https://my.syr.is",
  "user_did": "did:syr:z6Mk..."
}
```

**`DELETE /api/syner/pair`**

Unpairs a device. Requires device JWT authentication.

---

### 1.2 SSE Signing Bridge

**`GET /api/syner/events`**

Server-Sent Events stream for pushing signing requests to Syner.

Authentication: Device JWT in `Authorization: Bearer <token>` header.

Events:

```
event: connected
data: {"device_id": "uuid", "instance": "https://my.syr.is"}

event: signing_request
data: {"id": "uuid", "type": "registry_update", "payload": {...}, "payload_hash": "sha256hex", "created_at": "...", "expires_at": "..."}

event: ping
data: {"timestamp": "..."}
```

**`GET /api/syner/requests/:id`**

Fetch a specific signing request by ID. Used by the deep link fallback flow.

Response:
```json
{
  "id": "uuid",
  "type": "delegation",
  "payload": {"did": "...", "delegate": "...", "scope": "device", "createdAt": "..."},
  "payload_hash": "sha256hex",
  "created_at": "...",
  "expires_at": "..."
}
```

---

### 1.3 Signature Submission

**`POST /api/syner/sign/:id`**

Submit a signature for a pending signing request.

Authentication: Device JWT.

Request:
```json
{
  "signature": "z...(multibase-encoded Ed25519 signature)",
  "signed_at": "ISO-8601"
}
```

Response:
```json
{
  "status": "accepted",
  "request_id": "uuid"
}
```

The SYR backend verifies the signature against the user's root public key and completes the pending operation.

---

### 1.4 Pairing Code Generation

**`POST /api/syner/pairing-code`**

Generates a one-time pairing code for device enrollment.

Authentication: User session (standard SYR auth).

Response:
```json
{
  "code": "ABC123",
  "qr_data": "syr://pair?code=ABC123&instance=https://my.syr.is",
  "expires_at": "ISO-8601"
}
```

---

## 2. Database Schema Extensions

### 2.1 Paired Device Table

```sql
DEFINE TABLE paired_device SCHEMAFULL;

DEFINE FIELD user_id ON paired_device TYPE record<user>;
DEFINE FIELD device_public_key ON paired_device TYPE string;
DEFINE FIELD device_name ON paired_device TYPE string;
DEFINE FIELD device_os ON paired_device TYPE string;
DEFINE FIELD device_model ON paired_device TYPE option<string>;
DEFINE FIELD device_token_hash ON paired_device TYPE string;
DEFINE FIELD paired_at ON paired_device TYPE datetime DEFAULT time::now();
DEFINE FIELD last_active ON paired_device TYPE datetime DEFAULT time::now();
DEFINE FIELD is_active ON paired_device TYPE bool DEFAULT true;

DEFINE INDEX idx_paired_device_user ON paired_device FIELDS user_id;
```

### 2.2 Signing Request Table

```sql
DEFINE TABLE signing_request SCHEMAFULL;

DEFINE FIELD user_id ON signing_request TYPE record<user>;
DEFINE FIELD device_id ON signing_request TYPE option<record<paired_device>>;
DEFINE FIELD request_type ON signing_request TYPE string
  ASSERT $value IN ['registry_update', 'delegation', 'post_sign', 'rotation'];
DEFINE FIELD payload ON signing_request FLEXIBLE TYPE object;
DEFINE FIELD payload_hash ON signing_request TYPE string;
DEFINE FIELD status ON signing_request TYPE string
  ASSERT $value IN ['pending', 'signed', 'expired', 'cancelled'] DEFAULT 'pending';
DEFINE FIELD signature ON signing_request TYPE option<string>;
DEFINE FIELD created_at ON signing_request TYPE datetime DEFAULT time::now();
DEFINE FIELD expires_at ON signing_request TYPE datetime;
DEFINE FIELD signed_at ON signing_request TYPE option<datetime>;

DEFINE INDEX idx_signing_request_user ON signing_request FIELDS user_id;
DEFINE INDEX idx_signing_request_status ON signing_request FIELDS status;
```

---

## 3. Communication Flow Details

### 3.1 SSE Connection Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Disconnected
    Disconnected --> Connecting: Syner opens SSE
    Connecting --> Connected: Server accepts
    Connected --> Connected: ping/signing_request
    Connected --> Reconnecting: Connection dropped
    Reconnecting --> Connected: Reconnect success
    Reconnecting --> Disconnected: Max retries exceeded
    Connected --> Disconnected: Unpaired / logout
```

Syner maintains the SSE connection with:
- Automatic reconnection with exponential backoff (1s, 2s, 4s, 8s, max 30s)
- Server-side ping every 30 seconds to keep the connection alive
- Connection state displayed in Syner UI

### 3.2 Signing Request Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Pending: SYR creates request
    Pending --> Delivered: SSE push or deep link
    Delivered --> Approved: User approves in Syner
    Approved --> Signed: Syner signs payload
    Signed --> Completed: SYR verifies + completes
    Pending --> Expired: TTL exceeded
    Delivered --> Rejected: User rejects
    Delivered --> Expired: TTL exceeded
```

### 3.3 Deep Link Protocol

Custom URL scheme: `syr://`

| Action | URL Pattern | Description |
| ------ | ----------- | ----------- |
| Pair   | `syr://pair?code={code}&instance={url}` | Initiate device pairing |
| Sign   | `syr://sign?request_id={id}&instance={url}&payload_hash={hash}` | Open a signing request |

---

## 4. Identity Transition Flow

### 4.1 Server-Managed to Syner-Managed

```mermaid
sequenceDiagram
    participant User
    participant SYR as SYR Web App
    participant Syner

    User->>SYR: Settings > Transfer keys to Syner
    SYR->>SYR: Generate one-time encrypted key bundle
    SYR->>User: Display QR code (encrypted key)
    User->>Syner: Scan QR code
    Syner->>Syner: Decrypt and import root key
    Syner->>Syner: Store in platform keystore
    Syner->>SYR: POST /api/identity/confirm-transfer
    SYR->>SYR: Delete server-side private key
    SYR->>SYR: Mark identity as "syner-managed"
    SYR->>User: Transfer complete
```

The encrypted key bundle uses:
- X25519 key exchange (Syner's device key + ephemeral SYR key)
- ChaCha20-Poly1305 encryption
- One-time use, expires after 5 minutes

### 4.2 Syner-First Identity Creation

```mermaid
sequenceDiagram
    participant User
    participant Syner
    participant SYR as SYR Web App

    User->>Syner: Create new identity
    Syner->>Syner: Generate Ed25519 keypair
    Syner->>Syner: Store in platform keystore
    Syner->>Syner: Derive did:syr:z6Mk...
    User->>Syner: Pair with SYR instance
    Syner->>SYR: POST /api/identity/init {did, publicKey, ...}
    SYR->>SYR: Create identity (no private key)
    SYR->>Syner: Identity registered
```

---

## 5. Notification Strategy

### 5.1 Desktop (macOS, Windows, Linux)

- System tray icon shows connection status
- Native OS notification for incoming signing requests
- Clicking notification opens Syner to the signing request

### 5.2 Android

- Foreground service maintains SSE connection
- Push notification for signing requests via persistent notification channel
- Tap notification opens signing approval screen

### 5.3 iOS

- SSE connection active while app is in foreground
- When backgrounded, SSE disconnects after ~30 seconds
- Deep link fallback: SYR web app opens `syr://sign?...` which triggers iOS to open Syner
- Future: APNs push notification to wake Syner (requires Apple Developer account + server infra)

---

## 6. Error Handling

| Error | Syner Behavior | SYR Behavior |
| ----- | -------------- | ------------ |
| SSE disconnected | Reconnect with backoff. Show "offline" indicator. | Queue signing requests. Fall back to deep links. |
| Signing request expired | Discard. Show "expired" in history. | Return error to the originating action. User can retry. |
| Invalid payload hash | Reject request. Alert user. | Log security event. |
| Device unpaired | Clear instance config. Show pairing screen. | Remove device from active list. Revoke device JWT. |
| Keystore unavailable | Show error. Cannot sign. | Fall back to server-managed keys if available. |

---

## 7. Type Definitions

The following types should be added to `@syr-is/types` when implementing Syner support:

```typescript
// Paired device record
interface PairedDevice {
  id: RecordId;
  user_id: RecordId;
  device_public_key: string;
  device_name: string;
  device_os: 'macos' | 'windows' | 'linux' | 'android' | 'ios';
  device_model?: string;
  paired_at: Date;
  last_active: Date;
  is_active: boolean;
}

// Signing request
interface SigningRequest {
  id: RecordId;
  user_id: RecordId;
  device_id?: RecordId;
  request_type: 'registry_update' | 'delegation' | 'post_sign' | 'rotation';
  payload: Record<string, unknown>;
  payload_hash: string;
  status: 'pending' | 'signed' | 'expired' | 'cancelled';
  signature?: string;
  created_at: Date;
  expires_at: Date;
  signed_at?: Date;
}

// SSE event types
type SynerEvent =
  | { type: 'connected'; device_id: string; instance: string }
  | { type: 'signing_request'; data: SigningRequest }
  | { type: 'ping'; timestamp: string };
```

---

## 8. Implementation Checklist

When implementing Syner integration:

1. Add `paired_device` and `signing_request` tables to SurrealDB schema
2. Create `@syr-is/types` schemas for `PairedDevice`, `SigningRequest`
3. Implement pairing endpoints (`/api/syner/pair`, `/api/syner/pairing-code`)
4. Implement SSE bridge (`/api/syner/events`)
5. Implement signing endpoints (`/api/syner/sign/:id`, `/api/syner/requests/:id`)
6. Add "Devices" section to SYR Settings UI
7. Build Syner Tauri app with Svelte frontend
8. Implement platform keystore bindings in Rust
9. Implement SSE client in Syner
10. Implement deep link handler (`syr://` protocol)
11. Add identity transfer flow (server-managed to Syner-managed)
12. End-to-end integration testing
