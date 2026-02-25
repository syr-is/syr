#!/usr/bin/env bash
set -e

cargo clippy --manifest-path packages/rust/Cargo.toml --workspace --all-targets -- -D warnings
cargo clippy --manifest-path apps/syner/app/src-tauri/Cargo.toml --workspace --all-targets -- -D warnings
