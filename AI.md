# Syr — AI Collaboration Guide

Common instructions for all AI agents and assistants working in this repository.
This file (`AI.md`) is the single source of truth; all agent-specific configuration
files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `CONVENTIONS.md`, `.cursorrules`) are
symlinks to it — update it here and every tool sees the change.

Canonical protocol docs: `apps/docs/app/src/routes/`.

---

## Project Overview

- **Syr**: Self Yield Identity Representation — self-hosted multi-tenant self-sovereign identity manager
- **Core concepts**: Ed25519 root keypair, `did:syr` DID method, root-key rotation chain, delegated device/platform keys, Aegis (custodial seed protection), Sigil (portable encrypted export)
- **Ecosystem naming**: Aegis = custodial protection; Sigil = portable export format; Syner = self-custody companion app
- **Registry model is plural by design**: registries are signed pointer directories, not trust authorities. Many registries are expected to coexist — run under different countries, communities, and governance — and platforms may publish their registered users to registries they operate or trust. No single registry is assumed to be followed by every platform; the DID stays verifiable without any registry.
- **Implementation phases**: see `apps/docs/app/src/routes/roadmap/+page.md`; spec-to-code status lives in `apps/docs/app/src/routes/reference/spec-mapping/+page.md`

---

## Monorepo Structure

```
apps/
  syr/       # SvelteKit web app (primary instance implementation)
  docs/      # SveltePress protocol/spec docs site
  syner/     # Tauri v2 native app (self-custody keys)
  registry/  # NestJS registry server (signed pointer directory)
packages/
  rust/
    syr-crypto-core/   # Ed25519, JCS, delegation + rotation statements
    syr-crypto-aegis/  # CIGP v1 custodial seed encryption (Argon2id + AES-256-GCM)
    syr-crypto-sigil/  # PIEF v1 portable encrypted export
    syr-crypto-wasm/   # wasm-bindgen surface consumed by the TS packages
    syr-did/           # did:syr parse/validate/document
  ts/
    types/     # @syr-is/types — Zod v4 schemas
    crypto/    # @syr-is/crypto — TS wrapper over the WASM crypto surface
    did/       # @syr-is/did — did:syr parsing, DID documents (WASM-backed)
    resolver/  # @syr-is/resolver — registry resolution
    ui/        # @syr-is/ui — shadcn-svelte components
    utils/     # shared helpers
```

Rust is the cryptographic source of truth; TS packages wrap the WASM build. Never
reimplement crypto in TS — extend the crate, rebuild the WASM, wrap it.

---

## Tech Stack

| Layer      | Technology                                    |
| ---------- | --------------------------------------------- |
| Frontend   | Svelte 5 runes, SvelteKit 2                   |
| Styling    | Tailwind CSS 4, shadcn-svelte, tw-animate-css |
| Validation | Zod v4 (from catalog)                         |
| Forms      | sveltekit-superforms + Zod v4                 |
| Crypto     | Rust crates via wasm-bindgen (Ed25519, JCS)   |
| Database   | SurrealDB                                     |
| Storage    | SeaweedFS (S3-compatible)                     |
| Auth       | JWT + Argon2id                                |
| Build      | Vite 7, Turborepo, pnpm workspaces, cargo     |

---

## Code Patterns

- **Repository pattern**: All data access via `BaseRepository<T>` with Zod validation on reads, date transformation, CRUD, pagination
- **Controller pattern**: Business logic between API routes and repositories; validation, authorization, cross-cutting concerns
- **Composite record IDs**: For owned content (post, upload): `{ created_by: DID, id: ULID }` — enables portable identity, zero-conflict import
- **Codecs**: Zod v4 codecs for bi-directional API ↔ internal type transforms (`stringToRecordId`, `isoDatetimeToDate`, etc.)
- **BaseEntitySchema**: All entities extend `id`, `created_at`, `updated_at`; use `RecordIdSchema`, `TimestampSchema`
- **API responses**: `{ status, data?, error?, meta? }`; paginated: `{ data[], pagination }`; error codes from `APIErrorSchema`
- **Model the axis, not the brand**: never hard-code a vendor/provider name into a shared data shape (storage backend, KDF, registry host, …). A new provider must be a new value, not a schema change. Brand names live only at the adapter edge, in the provider enum, and in env var names.

---

## Cryptographic Conventions

- **Ed25519 only**, implemented in `packages/rust/syr-crypto-core`, consumed through `syr-crypto-wasm`
- **DID format**: `did:syr:z6Mk…` (multibase base58btc, multicodec `0xed01` + 32-byte Ed25519 public key). The DID is genesis-key-derived and never changes; the *current* root key is resolved through the rotation chain
- **Canonical signing**: RFC 8785 JCS via `canonicalize()` before signing — Rust and TS must byte-match; when adding a signed payload, add a cross-language test vector
- **Delegation**: Root-signed statement `{ did, delegate, scope, createdAt, expiresAt?, signature }`; scopes `device | session | platform`
- **Never persist plaintext seeds**: custodial seeds exist only Aegis-encrypted at rest; decrypt → use → zeroize in one scope
- **No app logic in crypto crates**: pure cryptography only

---

## Protocol Docs Discipline

The docs site under `apps/docs/app/src/routes/` **is the spec**. Any change to wire
formats, endpoints, signed payloads, or lifecycle semantics must land with matching
updates to:

1. the relevant `architecture/*/+page.md` page,
2. `reference/spec-mapping/+page.md` (status per requirement), and
3. `reference/public-api/+page.md` when the federation read surface changes.

Code that drifts from the docs is a bug in one of the two.

---

## Commits & AI Attribution (required)

**AI is never to be attributed in commits.** Do not add `Co-Authored-By` lines for
any AI tool, do not mention Claude/Codex/Gemini/Copilot in commit messages, and do
not add "Generated with AI" trailers.

In today's sea of internet slop, nobody cares _which_ AI someone used — what matters
is _who_ is filtering that slop and whether they are doing it correctly. AI is a
tool, not a colleague you can point to and blame. The human author owns every commit
and is accountable for it. Write commit messages as the author, full stop.

---

## Multi-System Prompts (parallel agents + adversarial review)

When the developer asks for changes to **different systems in the same prompt**, the
master agent may parallelize instead of working through them serially:

- **One agent per system, each in its own git worktree**, branched from the branch
  under work (not from `main` unless that is the branch under work), with
  non-overlapping file territories so the merge stays conflict-free. If territories
  overlap (shared schemas, spec-mapping, crypto crates), run the phases sequentially
  in one worktree instead of forcing a parallel split.
- **Adversarial review in a loop, two adversaries per change**: after implementation,
  two independent adversary agents review each change with distinct lenses (e.g.
  protocol-correctness/security vs implementation/regression compliance). Real
  findings go back to the implementing agent to refine; re-review until the
  adversaries come back clean. Cap the loop (two or three rounds is usually enough)
  and surface anything still contested to the developer instead of looping forever.
- **Merge the worktree branches into the working branch** and run the repo checks
  (`pnpm check`, `pnpm build`, `cargo test`) on the merged result, not just
  per-worktree.

---

## MarkItDown Preprocessing (required)

Before reading or reasoning about any non-text source file (PDF, DOCX, PPTX, XLSX,
images, audio, HTML, CSV, JSON, XML, ZIP, EPUB, and other formats MarkItDown
supports), **always preprocess it through [MarkItDown](https://github.com/microsoft/markitdown)
first** and work from the resulting Markdown. Do not attempt to parse these binary
or rich formats directly.

```bash
markitdown path/to/source.pdf -o path/to/source.md
```

Save the generated Markdown alongside the source (same directory, same basename,
`.md` extension) so it can be reused and version-controlled.

---

## File References

| Category                   | Path                                                       |
| -------------------------- | ---------------------------------------------------------- |
| Architecture specs         | `apps/docs/app/src/routes/architecture/*/+page.md`         |
| Implementation blueprints  | `apps/docs/app/src/routes/implementation/*/+page.md`       |
| Reference docs             | `apps/docs/app/src/routes/reference/*/+page.md`            |
| Spec-to-implementation map | `apps/docs/app/src/routes/reference/spec-mapping/+page.md` |
| Roadmap                    | `apps/docs/app/src/routes/roadmap/+page.md`                |
