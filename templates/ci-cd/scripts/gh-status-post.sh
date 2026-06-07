#!/usr/bin/env bash
# gh-status-post.sh — post a PR status check via the gh CLI.
#
# Usage:
#   gh-status-post.sh success
#   gh-status-post.sh failure
#   gh-status-post.sh pending
#
# Required environment (Animus injects these into command phases that
# run from a webhook-triggered workflow):
#   GITHUB_REPO        e.g. launchapp-dev/animus-cli
#   COMMIT_SHA         the head SHA of the PR
#
# Optional:
#   STATUS_CONTEXT     defaults to "animus/ci"
#   TARGET_URL         link the status check points at (e.g. dashboard)

set -euo pipefail

STATUS="${1:-success}"
REPO="${GITHUB_REPO:?GITHUB_REPO must be set}"
SHA="${COMMIT_SHA:?COMMIT_SHA must be set}"
CONTEXT="${STATUS_CONTEXT:-animus/ci}"
TARGET="${TARGET_URL:-}"

case "$STATUS" in
  success)
    DESCRIPTION="Animus CI passed locally"
    ;;
  failure)
    DESCRIPTION="Animus CI failed locally"
    ;;
  pending)
    DESCRIPTION="Animus CI running locally"
    ;;
  *)
    echo "gh-status-post.sh: unknown status '$STATUS' (expected success/failure/pending)" >&2
    exit 2
    ;;
esac

ARGS=(
  api
  "repos/${REPO}/statuses/${SHA}"
  -X POST
  -f "state=${STATUS}"
  -f "description=${DESCRIPTION}"
  -f "context=${CONTEXT}"
)

if [ -n "$TARGET" ]; then
  ARGS+=(-f "target_url=${TARGET}")
fi

gh "${ARGS[@]}"
