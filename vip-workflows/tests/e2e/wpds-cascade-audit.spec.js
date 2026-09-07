/**
 * WPDS ↔ wp-admin cascade-layer audit (informational).
 *
 * Visits each design-system admin surface and reports every element where a
 * `@wordpress/ui` component's layered styles are being overridden by wp-admin's
 * unlayered `common.css` — i.e. where a parent-level reset is (or should be)
 * applied. See helpers/wpds-cascade-audit.js for the mechanism and
 * docs/guides/wpds-usage-audit-patterns.md for the fix pattern.
 *
 * This spec does NOT fail on findings by default — it's a detector, and known
 * conflicts on un-reset surfaces are expected until each gets its own reset.
 * Run it and read the report / the JSON artifact:
 *
 *   npm run test:e2e -- wpds-cascade-audit
 *
 * Set WPDS_AUDIT_STRICT=1 to make it fail when any surface has findings (useful
 * once the covered surfaces are all clean and you want to guard against
 * regressions).
 */

const fs = require( 'fs' );
const path = require( 'path' );
const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const {
	auditCascade,
	formatReport,
} = require( './helpers/wpds-cascade-audit' );

const STRICT = !! process.env.WPDS_AUDIT_STRICT;

// DS-bearing admin screens. The System screens (Settings…Tools) render on the
// shared AdminPage scaffold (covered by admin-page.css's reset); Board/Kanban
// are full-bleed app canvases. Add new DS screens here as they ship.
const SCREENS = [
	{ name: 'Board (main)', query: 'page=vip-workflows' },
	{ name: 'Kanban', query: 'page=vip-workflows-kanban' },
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
		test( screen.name, async ( { admin, page } ) => {
			await admin.visitAdminPage( 'admin.php', screen.query );
			// Let the React app render (DS styles inject on first paint).
			await page.waitForLoadState( 'networkidle' ).catch( () => {} );

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
		} );
	}

	// The AI Agent slideout portals OUTSIDE .vip-workflows-admin-page, so the
	// canvas reset does not reach it — the surface most likely to surface a gap.
	test( 'AI Agent slideout (portal)', async ( { admin, page } ) => {
		await admin.visitAdminPage( 'admin.php', 'page=vip-workflows' );
		const fab = page.getByRole( 'button', { name: 'Open AI Agent' } );
		if ( ( await fab.count() ) === 0 ) {
			test.skip( true, 'AI Agent FAB not present on this build.' );
			return;
		}
		await fab.click();
		await page
			.locator( '.vip-ai-slideout-panel.is-open' )
			.waitFor()
			.catch( () => {} );

		const findings = await auditCascade( page, {
			rootSelector: '.vip-ai-slideout-panel',
		} );
		report.push( { screen: 'AI Agent slideout', findings } );

		// eslint-disable-next-line no-console
		console.log( formatReport( 'AI Agent slideout', findings ) );
		await test.info().attach( 'cascade-ai-slideout.json', {
			body: JSON.stringify( findings, null, 2 ),
			contentType: 'application/json',
		} );

		if ( STRICT ) {
			expect(
				findings,
				formatReport( 'AI Agent slideout', findings )
			).toEqual( [] );
		}
	} );

	// Modals portal to document.body, so neither the admin-page canvas reset nor
	// the slideout's own scope reaches inside them — src/styles/modal-reset.css
	// covers them instead, and these surfaces are what keep it honest. Each entry
	// opens one real modal and scans its content subtree.
	//
	// `open` matches the button that opens it. Both of these named a label the
	// screens had already stopped using, so `test.skip` fired on every run and
	// the modal reset went unaudited — a skip on a missing trigger reads as
	// "not applicable here", not as "the test no longer finds its own UI". If a
	// modal below starts skipping, re-check the label before assuming the
	// surface went away.
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
			await page.waitForLoadState( 'networkidle' ).catch( () => {} );

			const trigger = page.getByRole( 'button', { name: modal.open } );
			if ( ( await trigger.count() ) === 0 ) {
				test.skip( true, `Trigger not present: ${ modal.open }` );
				return;
			}
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
