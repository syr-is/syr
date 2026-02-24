#!/usr/bin/env bash
set -e

cargo fmt --manifest-path packages/rust/Cargo.toml --all -- --check
cargo fmt --manifest-path apps/syner/app/src-tauri/Cargo.toml -- --check
