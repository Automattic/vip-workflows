#!/usr/bin/env bash
#
# Builds the pull request preview into dist/preview/:
#
#   vip-workflows.zip  core plugin, packaged by tools/package-plugin.sh
#   demo-content.zip   WXR fixture plus the boot-time date shifter
#   blueprint.json     .playground/blueprint.json, validated
#
# Each zip is named after the {{ARTIFACT_URL:<name>}} token that installs it.
# Used by "PR Preview - Build" and by tools/playground/serve-preview.sh.
#
# Usage: tools/playground/build-preview.sh <version>

set -euo pipefail

if [ "$#" -ne 1 ]; then
	echo "Usage: tools/playground/build-preview.sh <version>" >&2
	exit 1
fi

VERSION="$1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREVIEW_DIR="$REPO_ROOT/dist/preview"
ARTIFACTS=( vip-workflows demo-content )

"$REPO_ROOT/tools/package-plugin.sh" "$VERSION" vip-workflows

rm -rf "$PREVIEW_DIR"
mkdir -p "$PREVIEW_DIR"
cp "$REPO_ROOT/dist/vip-workflows-${VERSION}.zip" "$PREVIEW_DIR/vip-workflows.zip"
zip -j -q "$PREVIEW_DIR/demo-content.zip" \
	"$REPO_ROOT/tools/vip-workflows-content.xml" \
	"$REPO_ROOT/tools/playground/shift-wxr-dates.php"

node "$REPO_ROOT/tools/playground/build-preview-blueprint.mjs" \
	"$PREVIEW_DIR/blueprint.json" "${ARTIFACTS[@]}"

for name in "${ARTIFACTS[@]}"; do
	unzip -l "$PREVIEW_DIR/$name.zip" | tail -n 1
done
