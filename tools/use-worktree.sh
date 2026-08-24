#!/bin/bash
# Usage:
#   tools/use-worktree.sh /path/to/worktree   — remap wp-env mounts to a worktree
#   tools/use-worktree.sh                     — reset back to main repo

WORKTREE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WP_ENV_ROOT="${CONDUCTOR_ROOT_PATH:-$WORKTREE_ROOT}"
OVERRIDE="$WP_ENV_ROOT/.wp-env.override.json"
WORKTREE=$1

if [ -z "$WORKTREE" ]; then
	rm -f "$OVERRIDE"
	echo "Cleared worktree override — using main repo."
else
	WORKTREE=$(realpath "$WORKTREE")
	cat > "$OVERRIDE" <<EOF
{
	"plugins": [
		"https://downloads.wordpress.org/plugin/gutenberg.23.3.2.zip",
		"https://github.com/WordPress/mcp-adapter/releases/latest/download/mcp-adapter.zip",
		"https://downloads.wordpress.org/plugin/wp-parsely.zip",
		"$WORKTREE/vip-workflow",
		"$WORKTREE/workflow-parsely",
		"$WORKTREE/workflow-tool-checklist",
		"$WORKTREE/workflow-assistant-wikipedia",
		"$WORKTREE/workflow-agent-copy-edit",
		"$WORKTREE/workflow-agent-tag-sanity-check"
	],
	"mappings": {
		"wp-env-tools": "$WORKTREE/tools"
	}
}
EOF
	echo "Remapped to: $WORKTREE"
fi

cd "$WP_ENV_ROOT" && wp-env start
