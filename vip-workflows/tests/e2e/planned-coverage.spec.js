/**
 * Planned coverage — documented, not yet implemented.
 *
 * These flows are real and valuable but each needs a fixture this foundation
 * doesn't yet provide (a non-admin reviewer user, a sequence with a hard tool
 * gate, or stable drag-and-drop). They're recorded as `test.fixme` so they show
 * up in the report as explicitly pending rather than silently missing. Promote
 * each to a real test as its fixture lands. See vip-workflows/docs/TESTING.md
 * ("Planned e2e coverage").
 */

const { test } = require( '@wordpress/e2e-test-utils-playwright' );

test.describe( 'VIP Workflow — planned coverage', () => {
	// Assigning from the Workflow sidebar is covered for real now, in
	// workflow-assign.spec.js: `openWorkflowSidebar` solved the open problem
	// this entry recorded (driving an unpinned plugin sidebar), and the flow
	// itself became a single act when the select-plus-Start form was replaced
	// by the workflow row's popover.

	// Needs a FAKE tool fixture. Verified in run_transition_tools(): a missing/
	// disabled tool is skipped (not a failure) and an exception becomes a SOFT
	// warning — so a deterministic HARD gate requires an *enabled* ability that
	// returns an issue with severity 'error'/'hard'. Plan: a tests-env mu-plugin
	// registering an ability that emits a hard issue (and a soft one) on demand,
	// a sequence whose transition requires it, and a non-admin user (admins
	// bypass via can_user_bypass_tool_checks). Assert REST `tool_check_failed`
	// (422, hard_failures) for hard, and warnings_pending → acknowledge for soft.
	test.fixme(
		'hard tool gate blocks a transition; soft gate warns and proceeds',
		async () => {}
	);

	// Claim/release behaviour is now covered at REST level (an editor reviewer,
	// not the author) in claim-release.spec.js. Remaining UI-only gap: the
	// editor's `.vip-workflow-panel__claim` button + the My Queue /
	// claim-board admin page, which need the full can_claim fixture
	// (a show_in_queue stage AND the post added to the claim queue).
	test.fixme( 'claim / release via the My Queue UI', async () => {} );

	// Needs: stable HTML5 drag-and-drop across `.vip-workflow-kanban-column`s. Outcome is
	// already asserted via the REST transition path in
	// workflow-lifecycle.spec.js; this would cover the drag interaction itself.
	test.fixme(
		'drag a Kanban card to a new column to transition',
		async () => {}
	);
} );
