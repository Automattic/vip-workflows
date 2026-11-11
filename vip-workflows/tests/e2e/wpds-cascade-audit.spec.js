/**
 * WPDS ↔ wp-admin cascade-layer audit.
 *
 * Visits each design-system admin surface and reports every element where a
 * `@wordpress/ui` component's layered styles are being overridden by wp-admin's
 * unlayered `common.css` — i.e. where a parent-level reset is (or should be)
 * applied. See helpers/wpds-cascade-audit.js for the mechanism and
 * docs/guides/wpds-usage-audit-patterns.md for the fix pattern.
 *
 * Every covered surface is clean, so this is a regression guard: a surface
 * with any finding fails, and so does a modal whose trigger can no longer be
 * found. To explore a new surface that is not clean yet, run it report-only,
 * which logs findings and writes the JSON artifact without failing:
 *
 *   WPDS_AUDIT_REPORT_ONLY=1 npm run test:e2e -- wpds-cascade-audit
 */

const fs = require( 'fs' );
const path = require( 'path' );
const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const {
	auditCascade,
	formatReport,
} = require( './helpers/wpds-cascade-audit' );

const { withEnabledExperiment } = require( './helpers/experiments' );

const STRICT = ! process.env.WPDS_AUDIT_REPORT_ONLY;

// DS-bearing admin screens. The System screens (Settings…Tools) render on the
// shared AdminPage scaffold (covered by admin-page.css's reset); Board/Kanban
// are full-bleed app canvases. Add new DS screens here as they ship.
const SCREENS = [
	{ name: 'Board (main)', query: 'page=vip-workflows' },
	{
		name: 'Kanban',
		query: 'page=vip-workflows-kanban',
		experiment: 'kanban',
	},
	{ name: 'Settings', query: 'page=vip-workflows-settings' },
	{ name: 'Notifications', query: 'page=vip-workflows-notifications' },
	{ name: 'Agents', query: 'page=vip-workflows-agents' },
	{ name: 'Tools', query: 'page=vip-workflows-tools' },
];

// Aggregated across the (single-worker) file run, written out in afterAll.
const report = [];

test.describe.configure( { mode: 'serial' } );

test.describe( 'WPDS ↔ wp-admin cascade audit', () => {
	for ( const screen of SCREENS ) {
		test( screen.name, async ( { admin, page, requestUtils } ) => {
			const auditScreen = async () => {
				await admin.visitAdminPage( 'admin.php', screen.query );
				// Let the React app render (DS styles inject on first paint).
				// Best-effort settle before reading computed styles; a timeout is ignored.
				// eslint-disable-next-line playwright/no-networkidle
				await page.waitForLoadState( 'networkidle' ).catch( () => {} );

				await expect(
					page.locator( '#vip-workflows-root' )
				).toBeVisible();

				const findings = await auditCascade( page );
				report.push( {
					screen: screen.name,
					query: screen.query,
					findings,
				} );

				// eslint-disable-next-line no-console
				console.log( formatReport( screen.name, findings ) );
				await test.info().attach( `cascade-${ screen.query }.json`, {
					body: JSON.stringify( findings, null, 2 ),
					contentType: 'application/json',
				} );

				if ( STRICT ) {
					expect(
						findings,
						formatReport( screen.name, findings )
					).toEqual( [] );
				}
			};
			if ( screen.experiment ) {
				await withEnabledExperiment(
					requestUtils,
					screen.experiment,
					auditScreen
				);
			} else {
				await auditScreen();
			}
		} );
	}

	// Modals portal to document.body, so the admin-page canvas reset does not
	// reach inside them — src/styles/modal-reset.css covers them instead, and
	// these surfaces are what keep it honest. Each entry opens one real modal
	// and scans its content subtree.
	//
	// `open` matches the button that opens it. Both of these once named a label
	// the screens had already stopped using, and while a missing trigger only
	// skipped, the modal reset went unaudited on every run. A missing trigger
	// therefore fails (report-only mode still skips). If one fails here,
	// re-check the label before assuming the surface went away.
	const MODALS = [
		{
			name: 'Tools how-to modal (portal)',
			query: 'page=vip-workflows-tools',
			open: /Add custom tools/i,
			root: '.vip-workflows-howto-modal',
		},
		{
			name: 'Agents how-to modal (portal)',
			query: 'page=vip-workflows-agents',
			open: /Add custom agents/i,
			root: '.vip-workflows-howto-modal',
		},
	];

	for ( const modal of MODALS ) {
		test( modal.name, async ( { admin, page } ) => {
			await admin.visitAdminPage( 'admin.php', modal.query );
			// Best-effort settle before reading computed styles; a timeout is ignored.
			// eslint-disable-next-line playwright/no-networkidle
			await page.waitForLoadState( 'networkidle' ).catch( () => {} );

			const trigger = page.getByRole( 'button', { name: modal.open } );
			if ( ! STRICT && ( await trigger.count() ) === 0 ) {
				test.skip( true, `Trigger not present: ${ modal.open }` );
				return;
			}
			await expect(
				trigger,
				`Trigger not present: ${ modal.open }`
			).toHaveCount( 1 );
			await trigger.click();
			await page.locator( modal.root ).waitFor();

			const findings = await auditCascade( page, {
				rootSelector: modal.root,
			} );
			report.push( { screen: modal.name, findings } );

			// eslint-disable-next-line no-console
			console.log( formatReport( modal.name, findings ) );
			await test.info().attach( `cascade-${ modal.name }.json`, {
				body: JSON.stringify( findings, null, 2 ),
				contentType: 'application/json',
			} );

			if ( STRICT ) {
				expect(
					findings,
					formatReport( modal.name, findings )
				).toEqual( [] );
			}
		} );
	}

	test.afterAll( async () => {
		const outDir = path.join( __dirname, 'artifacts' );
		fs.mkdirSync( outDir, { recursive: true } );
		const file = path.join( outDir, 'wpds-cascade-audit.json' );
		fs.writeFileSync( file, JSON.stringify( report, null, 2 ) );
		const total = report.reduce( ( n, r ) => n + r.findings.length, 0 );
		// eslint-disable-next-line no-console
		console.log(
			`\nWPDS cascade audit: ${ total } finding(s) across ${ report.length } surface(s). Full report → ${ file }`
		);
	} );
} );
