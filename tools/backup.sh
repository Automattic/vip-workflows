#!/usr/bin/env bash
#
# Create a backup zip of the entire repo, excluding
# generated/dependency dirs that should be recreated.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_NAME="$(basename "$REPO_ROOT")"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="$REPO_ROOT/dist/${REPO_NAME}-backup-${TIMESTAMP}.zip"

mkdir -p "$REPO_ROOT/dist"

echo "Creating backup..."
(cd "$REPO_ROOT/.." && zip -rq "$BACKUP_FILE" "$REPO_NAME" \
	-x "$REPO_NAME/_tmp/*" \
	-x "$REPO_NAME/dist/*" \
	-x "*/node_modules/*" \
	-x "*/vendor/*" \
	-x "*/__pycache__/*" \
	-x "*/.git/*" \
	-x "*/.DS_Store" \
	-x "*/.env" \
	-x "*.log")

SIZE="$(du -h "$BACKUP_FILE" | cut -f1 | xargs)"
echo "Done → dist/${REPO_NAME}-backup-${TIMESTAMP}.zip ($SIZE)"
