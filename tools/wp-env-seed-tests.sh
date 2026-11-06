#!/usr/bin/env bash
# Seeds the wp-env tests environment (:8889, `.wp-env.tests.json`) with the
# plugin state the end-to-end suite assumes: VIP Workflows active, its schema
# installed, and the default data the activation hook seeds (workflow roles and
# the "Editorial Review" sequence, slug `editorial-review`).
#
# The tests config drops the dev env's `afterStart` lifecycle script, so nothing
# else brings a tests env up to that state. Runs automatically after
# `npm run wp-env:start:tests`, which local Playwright runs call through
# `tools/wp-env-e2e-webserver.sh`; run `npm run seed:tests` by hand to reseed a
# tests env that is already running.
#
# Additive and idempotent: it activates, installs and seeds only what is
# missing. It never resets, drops or recreates anything. When the plugin's
# state is still incomplete afterwards, it fails rather than guessing.
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
CONFIG=".wp-env.tests.json"

if [ -x "$ROOT/node_modules/.bin/wp-env" ]; then
	WPENV=( "$ROOT/node_modules/.bin/wp-env" )
elif command -v npx >/dev/null 2>&1; then
	WPENV=( npx wp-env )
else
	echo "✖ wp-env not found (run \`npm install\` at the repository root)" >&2
	exit 1
fi

cd "$ROOT"

wp_tests() {
	"${WPENV[@]}" run cli --config "$CONFIG" wp "$@"
}

# Activating an inactive plugin fires its activation hook, which installs the
# schema and seeds the defaults. Activating an active plugin is a no-op.
echo "→ Ensuring VIP Workflows is active in the tests environment"
wp_tests plugin activate vip-workflows

# Run the activation path explicitly too, so a plugin that was already active
# when its seeded data went missing still gets it. Schema::install() and the
# Seeder skip anything that already exists.
echo "→ Installing the schema and seeding default data"
wp_tests eval 'VIPWorkflows\activate();'

echo "→ Verifying the seeded fixtures"
wp_tests eval '
global $wpdb;
$missing = array();
foreach ( VIPWorkflows\Database\Schema::get_owned_tables() as $table ) {
	if ( $table !== $wpdb->get_var( $wpdb->prepare( "SHOW TABLES LIKE %s", $wpdb->esc_like( $table ) ) ) ) {
		$missing[] = $table;
	}
}
if ( $missing ) {
	WP_CLI::error( "Tables " . implode( ", ", $missing ) . " are missing although vip_workflows_db_version is " . get_option( "vip_workflows_db_version", "(unset)" ) . ". The schema install skips tables when that option is current; inspect the database before rerunning." );
}
if ( ! ( new VIPWorkflows\Sequences\SequenceRepository() )->find_by_slug( "editorial-review" ) ) {
	WP_CLI::error( "The editorial-review sequence was not seeded." );
}
WP_CLI::success( "Tests environment seeded: schema installed and editorial-review sequence present." );
'
