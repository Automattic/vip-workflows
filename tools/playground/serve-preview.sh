#!/usr/bin/env bash
#
# Boots the pull request preview locally from this checkout.
#
# Builds dist/preview/ with build-preview.sh, serves its zips on 127.0.0.1 for
# the lifetime of this script, and starts the Playground CLI with the
# {{ARTIFACT_URL:<name>}} tokens pointed at that server.
#
# Usage: tools/playground/serve-preview.sh [port]

set -euo pipefail

PORT="${1:-8765}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREVIEW_DIR="$REPO_ROOT/dist/preview"

"$REPO_ROOT/tools/playground/build-preview.sh" 0.0.0-local

sed -E "s#\{\{ *ARTIFACT_URL:([A-Za-z0-9_-]+) *\}\}#http://127.0.0.1:${PORT}/\1.zip#g" \
	"$PREVIEW_DIR/blueprint.json" > "$PREVIEW_DIR/local.json"

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$PREVIEW_DIR" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

# A port held by another checkout's server would serve that checkout's zips.
sleep 1
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
	echo "Could not serve $PREVIEW_DIR on 127.0.0.1:$PORT; is the port in use?" >&2
	exit 1
fi

npx @wp-playground/cli@latest server --blueprint="$PREVIEW_DIR/local.json"
