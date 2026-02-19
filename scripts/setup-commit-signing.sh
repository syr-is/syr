#!/bin/sh
# Configure this repository to sign commits by default.
# Required for pushing - the pre-push hook rejects unsigned commits.

set -e
cd "$(dirname -- "$0")/.."

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository."
  exit 1
fi

echo "Configuring commit signing for this repository..."
echo ""
echo "Choose signing method:"
echo "  1) GPG"
echo "  2) SSH"
read -r choice

case "$choice" in
  1)
    git config commit.gpgsign true
    echo "Set commit.gpgsign=true"
    echo ""
    echo "Ensure you have a GPG key configured: gpg --list-secret-keys"
    echo "Link it: git config user.signingkey YOUR_KEY_ID"
    ;;
  2)
    git config commit.gpgsign true
    git config gpg.format ssh
    # Default to common SSH key paths
    for key in ~/.ssh/id_ed25519.pub ~/.ssh/id_rsa.pub; do
      if [ -f "$key" ]; then
        git config user.signingkey "$key"
        echo "Set user.signingkey=$key"
        break
      fi
    done
    echo "Set commit.gpgsign=true, gpg.format=ssh"
    ;;
  *)
    echo "Invalid choice."
    exit 1
    ;;
esac

echo ""
echo "Done. Commits will now be signed by default."
