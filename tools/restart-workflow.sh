#!/usr/bin/env bash
#
# Restart the vip-workflow plugin and its dependents.
# Deactivates dependent plugins first, then vip-workflow, then reactivates in reverse order.
# If vip-workflow fails to activate, a breadcrumb file records which dependents were stranded
# so the next successful run reactivates them.

set -euo pipefail

# Local by Flywheel environment.
export MYSQL_HOME="$HOME/Library/Application Support/Local/run/bAZpacUqd/conf/mysql"
export PHPRC="$HOME/Library/Application Support/Local/run/bAZpacUqd/conf/php"
export WP_CLI_CONFIG_PATH="/Applications/Local.app/Contents/Resources/extraResources/bin/wp-cli/config.yaml"
export WP_CLI_DISABLE_AUTO_CHECK_UPDATE=1
export PATH="$HOME/Library/Application Support/Local/lightning-services/mysql-8.0.35+4/bin/darwin-arm64/bin:$HOME/Library/Application Support/Local/lightning-services/php-8.2.27+1/bin/darwin-arm64/bin:/Applications/Local.app/Contents/Resources/extraResources/bin/wp-cli/posix:/Applications/Local.app/Contents/Resources/extraResources/bin/composer/posix:$PATH"

WP_PATH="$HOME/dev/wp-local/mcp/app/public"
WP="wp --path=$WP_PATH"

MAIN_PLUGIN="vip-workflow"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STRANDED_FILE="$SCRIPT_DIR/.stranded-plugins"

DEPENDENTS=(
	"workflow-parsely"
	"workflow-tool-checklist"
	"workflow-assistant-wikipedia"
	"workflow-agent-copy-edit"
	"workflow-agent-tag-sanity-check"
)

deactivated=()

echo "=== Restarting $MAIN_PLUGIN ==="

# Recover any stranded dependents from a previous failed run.
if [[ -f "$STRANDED_FILE" ]]; then
	echo "  Found stranded plugins from a previous failed run:"
	while IFS= read -r plugin; do
		[[ -z "$plugin" ]] && continue
		echo "    $plugin"
		deactivated+=("$plugin")
	done < "$STRANDED_FILE"
	rm -f "$STRANDED_FILE"
fi

# Deactivate dependents that are currently active.
for plugin in "${DEPENDENTS[@]}"; do
	if $WP plugin is-active "$plugin" 2>/dev/null; then
		echo "  Deactivating $plugin..."
		if $WP plugin deactivate "$plugin" 2>/dev/null; then
			deactivated+=("$plugin")
		else
			echo "  WARNING: Failed to deactivate $plugin"
		fi
	fi
done

# Deduplicate (a plugin could be both stranded and currently active).
if (( ${#deactivated[@]} )); then
	deduped=()
	while IFS= read -r plugin; do
		deduped+=("$plugin")
	done < <(printf '%s\n' "${deactivated[@]}" | sort -u)
	deactivated=("${deduped[@]}")
fi

# Deactivate vip-workflow.
echo "  Deactivating $MAIN_PLUGIN..."
$WP plugin deactivate "$MAIN_PLUGIN"

# Reactivate vip-workflow.
echo "  Activating $MAIN_PLUGIN..."
if ! $WP plugin activate "$MAIN_PLUGIN"; then
	echo "  ERROR: $MAIN_PLUGIN failed to activate"
	if (( ${#deactivated[@]} )); then
		printf '%s\n' "${deactivated[@]}" > "$STRANDED_FILE"
		echo "  Stranded dependents saved to $STRANDED_FILE"
		echo "  They will be reactivated on the next successful run."
	fi
	echo "=== Done (with errors) ==="
	exit 1
fi

# Reactivate dependents.
if (( ${#deactivated[@]} )); then
	for plugin in "${deactivated[@]}"; do
		echo "  Activating $plugin..."
		$WP plugin activate "$plugin" 2>/dev/null || echo "  WARNING: Failed to activate $plugin"
	done
fi

echo "=== Done ==="
