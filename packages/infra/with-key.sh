#!/bin/sh
# Runs a command with OPENAI_API_KEY from the macOS Keychain, so the key lives
# in no file an agent could read and every worktree finds it. A key already in
# the shell wins. Without either, the command runs without one. Store the key
# with:
#
#   security add-generic-password -s civicdata-dev -a OPENAI_API_KEY -w
if [ -z "${OPENAI_API_KEY:-}" ] && command -v security >/dev/null 2>&1; then
  key=$(security find-generic-password -s civicdata-dev -a OPENAI_API_KEY -w 2>/dev/null) &&
    export OPENAI_API_KEY="$key"
  unset key
fi
exec "$@"
