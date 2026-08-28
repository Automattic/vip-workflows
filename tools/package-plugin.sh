#!/usr/bin/env bash
#
# Build distributable plugin archives — one installable zip per plugin.
#
# The working tree is never modified. Production dependencies are resolved
# inside the staging directory, and the version is stamped only into the
# staged copy that gets archived.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$REPO_ROOT/dist"
STAGE_ROOT="$DIST_DIR/.stage"
BUILD_LOG="$DIST_DIR/build.log"

NO_INSTALL=0
PICK=0
VERSION=""
REQUESTED=()

# Paths copied from a plugin directory into its staged copy, when present.
# Anything absent from this list does not ship. vendor/ is deliberately
# excluded: production dependencies are installed into the stage instead, so a
# developer's dev-dependency vendor/ is never packaged.
#
# autoload-paths.php lives at the plugin root rather than under includes/,
# because the autoloader has to load before it can manage that directory. The
# entrypoint requires it unconditionally, so omitting it fatals on activation.
STAGE_PATHS="
uninstall.php
autoload-paths.php
includes
build
languages
skills
"

# Top-level source directories that are known development-only, so the
# unshipped-runtime-asset check below does not flag them.
DEV_ONLY_DIRS="
node_modules
vendor
src
tests
docs
coverage
artifacts
.git
.idea
.vscode
.phpunit.cache
"

# Patterns that must never appear anywhere in an archive, vendor/ included.
# Composer falls back to a source install when a dist download fails, which
# drops a full .git clone into vendor/ — 70MB of it, in this project.
FORBIDDEN_EVERYWHERE="
/\\.git/
/\\.github/
/node_modules/
/\\.DS_Store
"

# Patterns forbidden only outside vendor/, where upstream packages legitimately
# ship their own manifests and test suites.
FORBIDDEN_OUTSIDE_VENDOR="
/tests/
/src/
/phpunit\\.xml
/package\\.json
/package-lock\\.json
/composer\\.json
/composer\\.lock
/\\.eslintrc
/\\.phpcs
"

# Directories stripped from each vendor package. None are loadable code: the
# autoload classmap integrity check in verify_stage() proves that per build.
VENDOR_PRUNE="
.git
.github
tests
Tests
test
samples
doc
docs
"

info() { printf '%s\n' "$*"; }
step() { printf '  %s\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
	cat <<'USAGE'
Build distributable plugin archives — one installable zip per plugin.

Usage:
  tools/package-plugin.sh <version> [slug...]

  tools/package-plugin.sh 1.2.0                  every plugin
  tools/package-plugin.sh 1.2.0 vip-workflow     just the core plugin
  tools/package-plugin.sh 1.2.0 --pick           choose extensions interactively

Produces dist/<slug>-<version>.zip for the core plugin and for every
workflow-* directory that has a matching PHP entrypoint.

Options:
  --pick         Choose which extensions to include, via gum. Core is always
                 included. Requires gum; without this flag gum is not needed.
  --no-install   Reuse existing node_modules and build output. Local
                 iteration only; a release build must never use it.
  -h, --help     Show this help.
USAGE
}

# Run a noisy command, surfacing its output only when it fails.
run_quiet() {
	if ! "$@" >>"$BUILD_LOG" 2>&1; then
		printf '\nERROR: command failed: %s\n' "$*" >&2
		printf -- '--- last 40 lines of %s ---\n' "$BUILD_LOG" >&2
		tail -40 "$BUILD_LOG" >&2
		exit 1
	fi
}

# Portable in-place sed. BSD and GNU disagree about -i, so rewrite via a temp file.
sed_inplace() {
	local expr="$1" file="$2" tmp
	tmp="$file.tmp.$$"
	sed -E "$expr" "$file" >"$tmp"
	mv "$tmp" "$file"
}

while [ $# -gt 0 ]; do
	case "$1" in
		--no-install) NO_INSTALL=1 ;;
		--pick) PICK=1 ;;
		-h|--help) usage; exit 0 ;;
		-*) die "unknown option: $1" ;;
		*)
			if [ -z "$VERSION" ]; then
				VERSION="$1"
			else
				REQUESTED+=("$1")
			fi
			;;
	esac
	shift
done

[ -n "$VERSION" ] || { usage >&2; die "a version argument is required"; }
if ! printf '%s' "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$'; then
	die "version '$VERSION' is not semver (expected e.g. 1.2.0 or 1.2.0-beta.1)"
fi

for tool in node npm composer php rsync zip unzip; do
	command -v "$tool" >/dev/null || die "$tool is required but not installed"
done

# --- Plugin discovery -------------------------------------------------------

discover_plugins() {
	local dir slug
	echo "vip-workflow"
	for dir in "$REPO_ROOT"/workflow-*/; do
		[ -d "$dir" ] || continue
		slug="$(basename "$dir")"
		[ -f "$dir/$slug.php" ] || continue
		echo "$slug"
	done
}

PLUGINS=()
while IFS= read -r line; do
	[ -n "$line" ] && PLUGINS+=("$line")
done <<EOF
$(discover_plugins)
EOF

if [ ${#REQUESTED[@]} -gt 0 ]; then
	[ "$PICK" -eq 0 ] || die "--pick cannot be combined with explicit plugin names"
	for want in "${REQUESTED[@]}"; do
		found=0
		for have in "${PLUGINS[@]}"; do
			[ "$want" = "$have" ] && found=1
		done
		[ "$found" -eq 1 ] || die "unknown plugin '$want' (available: $(discover_plugins | tr '\n' ' '))"
	done
	PLUGINS=("${REQUESTED[@]}")
fi

# Interactive extension picker. Opt-in, so an unattended build can never block
# on a prompt and gum is only needed when it is actually asked for.
if [ "$PICK" -eq 1 ]; then
	command -v gum >/dev/null \
		|| die "--pick needs gum (https://github.com/charmbracelet/gum). Omit --pick to build every plugin."
	[ -t 0 ] || die "--pick needs a terminal; omit it when running unattended"

	extensions=()
	for slug in "${PLUGINS[@]}"; do
		[ "$slug" = "vip-workflow" ] && continue
		extensions+=("$slug")
	done

	if [ ${#extensions[@]} -gt 0 ]; then
		info "vip-workflow (core) is always included."
		selected_default="$(IFS=,; echo "${extensions[*]}")"
		chosen="$(gum choose --no-limit --selected="$selected_default" \
			--header="Space to toggle, Enter to confirm, Ctrl+C to quit" \
			"${extensions[@]}" </dev/tty)" || die "aborted"

		PLUGINS=("vip-workflow")
		while IFS= read -r line; do
			[ -n "$line" ] && PLUGINS+=("$line")
		done <<EOF
$chosen
EOF
	fi
fi

# --- Per-plugin steps -------------------------------------------------------

has_npm_build() {
	[ -f "$1/package.json" ] || return 1
	node -e 'const p=require(process.argv[1]); process.exit(p.scripts && p.scripts.build ? 0 : 1)' "$1/package.json"
}

build_assets() {
	local dir="$1"
	has_npm_build "$dir" || return 0
	if [ "$NO_INSTALL" -eq 1 ]; then
		step "reusing existing node_modules (--no-install)"
	elif [ -f "$dir/package-lock.json" ]; then
		step "npm ci"
		run_quiet npm --prefix "$dir" ci
	else
		step "npm install"
		run_quiet npm --prefix "$dir" install
	fi
	step "npm run build"
	run_quiet npm --prefix "$dir" run build
}

stage_files() {
	local dir="$1" slug="$2" stage="$3" rel
	mkdir -p "$stage"
	rsync -a "$dir/$slug.php" "$stage/"
	[ -f "$REPO_ROOT/LICENSE" ] && rsync -a "$REPO_ROOT/LICENSE" "$stage/"
	while IFS= read -r rel; do
		[ -n "$rel" ] || continue
		[ -e "$dir/$rel" ] || continue
		rsync -a "$dir/$rel" "$stage/$(dirname "$rel")/"
	done <<EOF
$STAGE_PATHS
EOF
}

# Strip non-loadable cruft from vendor packages. A dist install already omits
# most of it; a source fallback does not.
prune_vendor() {
	local stage="$1" name before after
	[ -d "$stage/vendor" ] || return 0
	before=$(du -sk "$stage/vendor" | cut -f1)
	while IFS= read -r name; do
		[ -n "$name" ] || continue
		find "$stage/vendor" -mindepth 2 -maxdepth 4 -type d -name "$name" -prune -exec rm -rf {} + 2>/dev/null || true
	done <<EOF
$VENDOR_PRUNE
EOF
	after=$(du -sk "$stage/vendor" | cut -f1)
	step "pruned vendor $(( before / 1024 ))MB → $(( after / 1024 ))MB"
}

# Resolve production dependencies inside the stage so the working tree's
# dev-dependency vendor/ is left alone.
install_vendor() {
	local dir="$1" stage="$2"
	[ -f "$dir/composer.json" ] || return 0
	step "composer install --no-dev"
	rsync -a "$dir/composer.json" "$stage/"
	[ -f "$dir/composer.lock" ] && rsync -a "$dir/composer.lock" "$stage/"
	run_quiet composer install --working-dir="$stage" --no-dev --optimize-autoloader --no-interaction --prefer-dist
	rm -f "$stage/composer.json" "$stage/composer.lock"
	prune_vendor "$stage"
}

stamp_version() {
	local entry="$1" slug="$2" version_constant had_const header_version
	version_constant="$(printf '%s' "$slug" | tr '[:lower:]-' '[:upper:]_')_VERSION"
	had_const=0
	grep -qE "define\([[:space:]]*'${version_constant}'" "$entry" && had_const=1

	sed_inplace "s|^([[:space:]]*\*[[:space:]]*Version:[[:space:]]*).*$|\1${VERSION}|" "$entry"
	sed_inplace "s|(define\([[:space:]]*'${version_constant}'[[:space:]]*,[[:space:]]*')[^']*('[[:space:]]*\)[[:space:]]*;)|\1${VERSION}\2|" "$entry"

	# A silently no-op stamp ships the wrong version, so assert the result.
	header_version="$(grep -aoE "^[[:space:]]*\*[[:space:]]*Version:[[:space:]]*.*$" "$entry" | head -1 | sed -E 's|.*Version:[[:space:]]*||' | tr -d '\r')"
	[ "$header_version" = "$VERSION" ] || die "$slug: plugin header Version is '$header_version' after stamping, expected '$VERSION'"
	if [ "$had_const" -eq 1 ]; then
		grep -qE "define\([[:space:]]*'${version_constant}'[[:space:]]*,[[:space:]]*'${VERSION//./\\.}'" "$entry" \
			|| die "$slug: $version_constant was not stamped to '$VERSION'"
	fi
}

verify_stage() {
	local dir="$1" slug="$2" stage="$3" entry="$stage/$slug.php"
	local file rel referenced

	[ -f "$entry" ] || die "$slug: entrypoint $slug.php missing from the archive"

	# Syntax-check the plugin's own PHP. vendor/ is upstream and already tagged.
	while IFS= read -r file; do
		php -l "$file" >/dev/null 2>&1 || die "$slug: PHP syntax error in ${file#$stage/}"
	done < <(find "$stage" -name '*.php' -not -path "$stage/vendor/*")

	# Every require_once __DIR__ . '/x' target in the entrypoint must ship.
	# This is the check that catches an entrypoint dependency left unstaged.
	while IFS= read -r rel; do
		[ -n "$rel" ] || continue
		[ -e "$stage$rel" ] || die "$slug: entrypoint requires '$rel' but it is not in the archive"
	done < <(grep -oE "require(_once)?[[:space:]]*\(?[[:space:]]*__DIR__[[:space:]]*\.[[:space:]]*'[^']+'" "$entry" \
		| sed -E "s|.*'([^']+)'|\1|")

	# A top-level source directory referenced by shipped PHP but not staged is
	# a runtime asset that will be missing in the wild.
	while IFS= read -r file; do
		rel="$(basename "$file")"
		case "$rel" in .*) continue ;; esac
		printf '%s' "$DEV_ONLY_DIRS" | grep -qx "$rel" && continue
		[ -e "$stage/$rel" ] && continue
		referenced="$(grep -rlF "$rel/" "$stage" --include='*.php' 2>/dev/null | grep -v "^$stage/vendor/" | head -1 || true)"
		[ -z "$referenced" ] || die "$slug: shipped PHP references '$rel/' (${referenced#$stage/}) but that directory is not in the archive"
	done < <(find "$dir" -maxdepth 1 -mindepth 1 -type d)

	if [ -f "$dir/composer.json" ]; then
		[ -f "$stage/vendor/autoload.php" ] || die "$slug: composer.json exists but vendor/autoload.php is not in the archive"
		# Every class Composer promises to autoload must still be on disk after
		# pruning. This is what makes the prune list safe to extend.
		php -r '$m = require $argv[1]; $bad = 0; foreach ($m as $c => $f) { if (!file_exists($f)) { fwrite(STDERR, "  $c => $f\n"); $bad++; } } exit($bad > 0 ? 1 : 0);' \
			"$stage/vendor/composer/autoload_classmap.php" \
			|| die "$slug: pruning removed files still listed in the Composer autoload classmap (see above)"
	fi
}

verify_archive() {
	local slug="$1" zipfile="$2" pattern offenders

	unzip -tq "$zipfile" >/dev/null || die "$slug: archive is corrupt"

	while IFS= read -r pattern; do
		[ -n "$pattern" ] || continue
		offenders="$(unzip -Z1 "$zipfile" | sed 's|^|/|' | grep -E "$pattern" | head -3 || true)"
		[ -z "$offenders" ] || die "$slug: archive contains files matching '$pattern': $(printf '%s' "$offenders" | tr '\n' ' ')"
	done <<EOF
$FORBIDDEN_EVERYWHERE
EOF

	while IFS= read -r pattern; do
		[ -n "$pattern" ] || continue
		offenders="$(unzip -Z1 "$zipfile" | sed 's|^|/|' | grep -v "^/$slug/vendor/" | grep -E "$pattern" | head -3 || true)"
		[ -z "$offenders" ] || die "$slug: archive contains files matching '$pattern': $(printf '%s' "$offenders" | tr '\n' ' ')"
	done <<EOF
$FORBIDDEN_OUTSIDE_VENDOR
EOF
}

package_plugin() {
	local slug="$1" dir="$REPO_ROOT/$slug" stage="$STAGE_ROOT/$slug"
	local zipfile="$DIST_DIR/$slug-$VERSION.zip"

	info "$slug"
	build_assets "$dir"
	step "staging"
	stage_files "$dir" "$slug" "$stage"
	install_vendor "$dir" "$stage"
	stamp_version "$stage/$slug.php" "$slug"
	step "verifying"
	verify_stage "$dir" "$slug" "$stage"
	( cd "$STAGE_ROOT" && zip -rqX "$zipfile" "$slug" )
	verify_archive "$slug" "$zipfile"
	ok "$(basename "$zipfile") ($(du -h "$zipfile" | cut -f1 | tr -d ' '), $(unzip -Z1 "$zipfile" | wc -l | tr -d ' ') files)"
}

# --- Run --------------------------------------------------------------------

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR" "$STAGE_ROOT"
: >"$BUILD_LOG"

info "Building $VERSION"
info ""
for slug in "${PLUGINS[@]}"; do
	package_plugin "$slug"
done

rm -rf "$STAGE_ROOT"
rm -f "$BUILD_LOG"

info ""
info "Done → $(cd "$DIST_DIR" && ls -1 *.zip | wc -l | tr -d ' ') archive(s) in dist/"
info ""
info "Each zip installs directly via Plugins → Add New → Upload Plugin."
info "vip-workflow is required; the workflow-* plugins extend it."
