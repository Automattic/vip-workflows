/**
 * VIP Real-Time Collaboration × stage-agent out-of-band write.
 *
 * A content-mutating stage agent (copy-edit) rewrites the
 * post server-side with wp_update_post() while it runs. This spec characterises
 * what RTC does with that "out-of-band" DB write, so we know whether the editor
 * needs a reload path even when collaboration is on.
 *
 * It is NOT part of the default e2e suite: it needs the RTC plugin + Gutenberg
 * provisioned (tests/e2e/rtc/setup-rtc.sh) and the RTC WebSocket server running.
 * It only runs when RTC_E2E=1; otherwise every test is skipped. See
 * tests/e2e/rtc/README.md and playwright.rtc.config.js.
 *
 * Findings this pins (v0.3.2, dev WebSocket server):
 *   1. Live client-to-client sync works (the harness is genuinely collaborating).
 *   2. A server-side wp_update_post is invisible to open collab clients — the
 *      agent's rewrite does not appear live.
 *   3. It only surfaces once the room empties and the editor is reopened
 *      (bootstrap reads the DB). i.e. a reload is required.
 *
 * If a future RTC version DOES propagate the out-of-band write, test 2 flips and
 * we revisit the reload UX — which is exactly the signal we want.
 */
const path = require( 'path' );
const { execSync } = require( 'node:child_process' );
const { test, expect } = require( '@playwright/test' );

const RTC_ENABLED = process.env.RTC_E2E === '1';
const ROOT = path.resolve( __dirname, '../../../..' ); // monorepo root (has .wp-env.json)

let postId;

function wpCli( args ) {
	return execSync( `npx wp-env run cli wp ${ args }`, {
		cwd: ROOT,
		encoding: 'utf8',
		stdio: [ 'ignore', 'pipe', 'ignore' ],
	} ).trim();
}

async function login( context, baseURL ) {
	const page = await context.newPage();
	await page.goto( `${ baseURL }/wp-login.php` );
	await page.fill( '#user_login', process.env.WP_ADMIN_USER || 'admin' );
	await page.fill(
		'#user_pass',
		process.env.WP_ADMIN_PASSWORD || 'password'
	);
	await page.click( '#wp-submit' );
	await page.waitForLoadState( 'load' );
	return page;
}

async function openEditor( page, baseURL, id ) {
	const wsRooms = [];
	page.on( 'websocket', ( ws ) => {
		if ( ws.url().includes( `post-${ id }` ) ) {
			wsRooms.push( ws.url() );
		}
	} );
	await page.goto(
		`${ baseURL }/wp-admin/post.php?post=${ id }&action=edit`
	);
	await page.waitForSelector( 'iframe[name="editor-canvas"]', {
		timeout: 30000,
	} );
	await page.keyboard.press( 'Escape' ).catch( () => {} ); // dismiss welcome guide
	await page.waitForTimeout( 6000 ); // let the collab doc connect + bootstrap
	return wsRooms;
}

const canvas = ( page ) => page.frameLocator( 'iframe[name="editor-canvas"]' );
const canvasText = async ( page ) =>
	( await canvas( page ).locator( 'body' ).innerText() ).trim();

test.describe( 'VIP RTC × stage-agent out-of-band write', () => {
	test.skip(
		! RTC_ENABLED,
		'RTC harness required: run tests/e2e/rtc/setup-rtc.sh + the WebSocket server, then set RTC_E2E=1.'
	);

	test.beforeAll( () => {
		postId = Number(
			wpCli(
				`post create --post_title='RTC OOB e2e' --post_status=draft --post_content='<!-- wp:paragraph --><p>BASE_CONTENT</p><!-- /wp:paragraph -->' --porcelain`
			)
		);
	} );

	test.afterAll( () => {
		if ( postId ) {
			wpCli( `post delete ${ postId } --force` );
		}
	} );

	test( 'an out-of-band agent write is invisible to open collab clients but shows after reload', async ( {
		browser,
		baseURL,
	} ) => {
		const ctxA = await browser.newContext();
		const ctxB = await browser.newContext();
		const pageA = await login( ctxA, baseURL );
		const pageB = await login( ctxB, baseURL );

		const roomsA = await openEditor( pageA, baseURL, postId );
		await openEditor( pageB, baseURL, postId );

		// The harness must actually be collaborating, else the rest is meaningless.
		expect(
			roomsA.length,
			'client A should open the RTC WebSocket room for this post — is the WS server running and the plugin provisioned?'
		).toBeGreaterThan( 0 );

		// Sanity: live client-to-client sync works. Type in A, see it in B.
		const liveMarker = 'LIVE_SYNC_' + Date.now();
		await canvas( pageA )
			.locator( 'p.wp-block-paragraph, [data-type="core/paragraph"]' )
			.first()
			.click();
		await pageA.keyboard.press( 'End' );
		await pageA.keyboard.type( ' ' + liveMarker );
		await expect
			.poll( () => canvasText( pageB ), { timeout: 15000 } )
			.toContain( liveMarker );

		// The agent's move: a server-side content rewrite, out of band.
		const oob = 'OOB_AGENT_' + Date.now();
		wpCli(
			`post update ${ postId } --post_content='<!-- wp:paragraph --><p>${ oob }</p><!-- /wp:paragraph -->'`
		);

		// It must NOT appear in either open client (watch ~16s). This is the
		// behaviour the reload UX exists to cover.
		await pageA.waitForTimeout( 16000 );
		expect( await canvasText( pageA ) ).not.toContain( oob );
		expect( await canvasText( pageB ) ).not.toContain( oob );

		// Close the room, reopen fresh: the editor bootstraps from the DB and the
		// agent's content is finally there.
		await ctxA.close();
		await ctxB.close();
		const ctxC = await browser.newContext();
		const pageC = await login( ctxC, baseURL );
		await openEditor( pageC, baseURL, postId );
		expect( await canvasText( pageC ) ).toContain( oob );
		await ctxC.close();
	} );
} );
