#!/usr/bin/env bash
#
# Build workflows.zip — core plugin + selected extensions.
# Interactive checkbox UI powered by gum (brew install gum).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$REPO_ROOT/dist"
CORE_DIR="$REPO_ROOT/vip-workflow"

if ! command -v gum &>/dev/null; then
	echo "gum is required for the interactive picker."
	printf "Install it now via Homebrew? [Y/n] "
	read -r answer </dev/tty
	if [[ "$answer" =~ ^[Nn] ]]; then
		echo "Aborted. Install manually: brew install gum"
		exit 1
	fi
	brew install gum
fi

# Discover extension plugins (workflow-* dirs with a PHP entrypoint).
extensions=()
for dir in "$REPO_ROOT"/workflow-*/; do
	name="$(basename "$dir")"
	if ls "$dir"/*.php &>/dev/null; then
		extensions+=("$name")
	fi
done

if [ ${#extensions[@]} -eq 0 ]; then
	echo "No extension plugins found."
fi

# Interactive multi-select (gum needs direct TTY access for raw mode).
selected=()
if [ ${#extensions[@]} -gt 0 ]; then
	echo "Select extension plugins to include:"
	selected_default="$(IFS=,; echo "${extensions[*]}")"
	gum_output="$(gum choose --no-limit --selected="$selected_default" --header="Space to toggle, Enter to confirm, Ctrl+C to quit" "${extensions[@]}" </dev/tty)" || {
		echo "Aborted."
		exit 1
	}
	while IFS= read -r line; do
		selected+=("$line")
	done <<< "$gum_output"
fi

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

LOG="$DIST_DIR/build.log"

run_quiet() {
	if ! "$@" >>"$LOG" 2>&1; then
		echo "ERROR: $1 failed. Build log:"
		cat "$LOG"
		exit 1
	fi
}

# --- Core plugin (always included) ---
printf "Building vip-workflow..."
STAGE="$DIST_DIR/vip-workflow"
mkdir -p "$STAGE"

run_quiet bash -c "cd '$CORE_DIR' && npm run build"

rsync -a \
	--include='vip-workflow.php' \
	--include='uninstall.php' \
	--include='autoload-paths.php' \
	--include='includes/***' \
	--include='build/***' \
	--include='languages/***' \
	--include='composer.json' \
	--include='composer.lock' \
	--exclude='*' \
	"$CORE_DIR/" "$STAGE/"

run_quiet bash -c "cd '$STAGE' && composer install --no-dev --optimize-autoloader --no-interaction --quiet"
rm -f "$STAGE/composer.json" "$STAGE/composer.lock"

(cd "$DIST_DIR" && zip -rq vip-workflow.zip vip-workflow/)
rm -rf "$STAGE"
echo " ✓"

# --- Extension plugins ---
for plugin in "${selected[@]}"; do
	plugin_dir="$REPO_ROOT/$plugin"
	printf "Packaging $plugin..."
	STAGE="$DIST_DIR/$plugin"
	mkdir -p "$STAGE"

	if [ -f "$plugin_dir/package.json" ] && grep -q '"build"' "$plugin_dir/package.json"; then
		run_quiet bash -c "cd '$plugin_dir' && npm install --silent && npm run build"
	fi

	rsync -a \
		--exclude='node_modules' \
		--exclude='.git' \
		--exclude='src' \
		--exclude='package.json' \
		--exclude='package-lock.json' \
		--exclude='.eslintrc*' \
		--exclude='README.md' \
		"$plugin_dir/" "$STAGE/"

	(cd "$DIST_DIR" && zip -rq "$plugin.zip" "$plugin/")
	rm -rf "$STAGE"
	echo " ✓"
done

# --- Bundle everything into workflows.zip ---
printf "Creating workflows.zip..."
(cd "$DIST_DIR" && zip -q workflows.zip *.zip)
rm -f "$LOG"

# Clean up individual zips.
for f in "$DIST_DIR"/*.zip; do
	[ "$(basename "$f")" = "workflows.zip" ] && continue
	rm -f "$f"
done

echo " ✓"
echo ""
echo "Done → dist/workflows.zip"
echo ""
echo "This zip contains multiple plugin zips."
echo "Unzip workflows.zip first, then install each .zip individually"
echo "via Plugins → Add New → Upload Plugin in WordPress."
