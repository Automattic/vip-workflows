#!/usr/bin/env bash
# Seeds wp-env after `wp-env start`: active theme + pretty permalinks + dev content import.
# All operations are idempotent — safe to run on every start.
set -euo pipefail

# Resolve a wp-env runner. Prefer `npx`, then the repository-local binary.
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
if command -v npx >/dev/null 2>&1; then
	WPENV=( npx wp-env )
elif [ -x "$ROOT/node_modules/.bin/wp-env" ]; then
	WPENV=( "$ROOT/node_modules/.bin/wp-env" )
else
	echo "✖ wp-env not found (no npx and no node_modules/.bin/wp-env)" >&2
	exit 1
fi

# On a fresh install against the WordPress/WordPress#master build, core can write
# the active theme as the bare 'default' fallback if the bundled themes aren't
# resolvable at install time — leaving a blank front end. Pin a real theme so a
# clean recreate always renders. Idempotent: re-activating the active theme is a
# no-op.
echo "→ Ensuring an active front-end theme"
"${WPENV[@]}" run cli wp theme activate twentytwentyfive

echo "→ Configuring pretty permalinks"
"${WPENV[@]}" run cli wp rewrite structure '/%postname%/' --hard

# Shift the seeded content so its newest post lands on today and the
# date-windowed Kanban and Calendar views surface it on a fresh start. The
# committed fixture is frozen at its export dates; shift-wxr-dates.php (shared
# with the pull request preview) writes a throwaway copy under tools/
# (gitignored) and that is imported — the fixture itself is never touched.
# Re-import is GUID-idempotent, so first-import dates persist. The shift runs
# in the cli container (tools/ is mapped to /var/www/html/wp-env-tools) so it
# does not depend on PHP being installed on the host.
CONTAINER_TOOLS="/var/www/html/wp-env-tools"
CONTENT_NAME="vip-workflows-content.xml"
SHIFTED_NAME=".vip-workflows-content.current.xml"
echo "→ Shifting seeded content dates to end today"
if "${WPENV[@]}" run cli php "$CONTAINER_TOOLS/playground/shift-wxr-dates.php" \
	"$CONTAINER_TOOLS/$CONTENT_NAME" "$CONTAINER_TOOLS/$SHIFTED_NAME"; then
	CONTENT_NAME="$SHIFTED_NAME"
	echo "→ Shifted seeded content dates to end today for import"
else
	{
		echo "⚠ Date shift failed: shift-wxr-dates.php exited non-zero in the cli container (see output above)."
		echo "⚠ Importing seeded content with its original export dates, so the date-windowed"
		echo "⚠ Kanban and Calendar views will show no demo posts. Imported posts keep these dates."
	} >&2
fi

# Dev-content import is a local convenience; e2e tests seed their own data via
# REST. If the WordPress Importer cannot be installed, the development-content
# convenience is skipped without affecting plugin activation or test fixtures.
echo "→ Ensuring WordPress Importer is installed and active"
if "${WPENV[@]}" run cli wp plugin install wordpress-importer --activate; then
	echo "→ Importing dev content (existing posts with matching GUIDs are skipped)"
	"${WPENV[@]}" run cli wp import "$CONTAINER_TOOLS/$CONTENT_NAME" --authors=create || true
else
	echo "→ Skipping dev content import (WordPress Importer unavailable)"
fi
