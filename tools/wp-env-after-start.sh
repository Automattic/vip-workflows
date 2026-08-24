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

# On a fresh install against the WordPress/WordPress#7.0 build, core can write
# the active theme as the bare 'default' fallback if the bundled themes aren't
# resolvable at install time — leaving a blank front end. Pin a real theme so a
# clean recreate always renders. Idempotent: re-activating the active theme is a
# no-op.
echo "→ Ensuring an active front-end theme"
"${WPENV[@]}" run cli wp theme activate twentytwentyfive

echo "→ Configuring pretty permalinks"
"${WPENV[@]}" run cli wp rewrite structure '/%postname%/' --hard

# Shift the seeded content into the current month so the date-windowed Kanban
# and Calendar views surface it on a fresh start. The committed
# fixture is frozen in one export month; rewrite the post dates onto a throwaway
# copy under tools/ (gitignored) and import that — the fixture itself is never
# touched. Re-import is GUID-idempotent, so first-import dates persist.
CONTENT_NAME="vip-workflows-content.xml"
CONTENT_SRC="$ROOT/tools/$CONTENT_NAME"
TARGET_YM="$( date +%Y-%m )"
# Dominant YYYY-MM among the fixture's post dates (the source month to shift from).
SOURCE_YM="$( grep -oE 'wp:post_date><!\[CDATA\[[0-9]{4}-[0-9]{2}' "$CONTENT_SRC" 2>/dev/null \
	| grep -oE '[0-9]{4}-[0-9]{2}' | sort | uniq -c | sort -rn | awk 'NR==1{print $2}' )" || true

if [ -n "$SOURCE_YM" ] && [ "$SOURCE_YM" != "$TARGET_YM" ] \
	&& perl -pe "s{(<wp:post_date(?:_gmt)?><!\[CDATA\[)$SOURCE_YM}{\${1}$TARGET_YM}g" \
		"$CONTENT_SRC" > "$ROOT/tools/.vip-workflows-content.current.xml"; then
	CONTENT_NAME=".vip-workflows-content.current.xml"
	echo "→ Shifted seeded content dates ${SOURCE_YM} → ${TARGET_YM} for import"
else
	echo "→ Importing seeded content unmodified (no date shift applied)"
fi

# Dev-content import is a local convenience; e2e tests seed their own data via
# REST. If the WordPress Importer cannot be installed, the development-content
# convenience is skipped without affecting plugin activation or test fixtures.
echo "→ Ensuring WordPress Importer is installed and active"
if "${WPENV[@]}" run cli wp plugin install wordpress-importer --activate; then
	echo "→ Importing dev content (existing posts with matching GUIDs are skipped)"
	"${WPENV[@]}" run cli wp import "/var/www/html/wp-env-tools/$CONTENT_NAME" --authors=create || true
else
	echo "→ Skipping dev content import (WordPress Importer unavailable)"
fi
