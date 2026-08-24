/**
 * Tools settings — the tools API, and the screen shape built on it.
 *
 * `/v1/settings/abilities` was retired in favor of the per-surface tools API:
 * `GET /v1/tools` (list) + `POST /v1/tools/{id}/settings` (save). The first two
 * tests assert those endpoints answer in real WordPress and that a per-tool save
 * round-trips and persists.
 *
 * The third asserts the screen `docs/guides/settings-standard.md` prescribes:
 * one topic tab strip, tools as cards titled `h2`, and — the rule the migration
 * turned on — exactly one Save for the whole screen, in the page header. The
 * per-card Save it replaced is the thing most likely to creep back, so the count
 * is asserted rather than the presence of any one button.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

test.describe( 'VIP Workflow — tools settings', () => {
	test( 'GET /v1/tools lists vip-workflow tools', async ( {
		requestUtils,
	} ) => {
		const tools = await requestUtils.rest( {
			path: '/vip-workflow/v1/tools',
		} );

		expect( Array.isArray( tools ) ).toBe( true );
		expect( tools.length ).toBeGreaterThan( 0 );
		// Every entry is a configurable vip-workflow tool with the management shape.
		for ( const tool of tools ) {
			expect( tool.category ).toBe( 'vip-workflow' );
			expect( tool ).toHaveProperty( 'settings_schema' );
			expect( tool ).toHaveProperty( 'check_modes' );
		}
	} );

	test( 'POST /v1/tools/{id}/settings round-trips and persists', async ( {
		requestUtils,
	} ) => {
		const tools = await requestUtils.rest( {
			path: '/vip-workflow/v1/tools',
		} );
		const tool = tools[ 0 ];
		const original = tool.enabled;

		try {
			const updated = await requestUtils.rest( {
				path: `/vip-workflow/v1/tools/${ tool.id }/settings`,
				method: 'POST',
				data: { enabled: ! original },
			} );

			// The per-tool save returns the single updated tool, not a list.
			expect( updated.id ).toBe( tool.id );
			expect( updated.enabled ).toBe( ! original );

			// The change is persisted, visible on a fresh list fetch.
			const after = await requestUtils.rest( {
				path: '/vip-workflow/v1/tools',
			} );
			const reloaded = after.find( ( t ) => t.id === tool.id );
			expect( reloaded.enabled ).toBe( ! original );
		} finally {
			// Restore the original state so reruns stay isolated.
			await requestUtils.rest( {
				path: `/vip-workflow/v1/tools/${ tool.id }/settings`,
				method: 'POST',
				data: { enabled: original },
			} );
		}
	} );

	test( 'Tools admin page renders one tab strip, h2 cards and a single Save', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( 'admin.php', 'page=vip-workflow-tools' );

		const root = page.locator( '#vip-workflow-root' );
		await expect( root ).toBeAttached();
		await expect( root ).not.toBeEmpty();

		// The tool types are the tab strip, so the cards below sit directly
		// under the page h1 and can take h2 without colliding with a section
		// heading.
		await expect(
			page.getByRole( 'tab', { name: 'Checks' } )
		).toBeVisible();
		await expect(
			page.getByRole( 'tab', { name: 'Validators' } )
		).toBeVisible();
		await expect(
			page.getByRole( 'tab', { name: 'Helpers' } )
		).toBeVisible();

		// At least one tool card renders from GET /v1/tools, titled by the
		// tool's own name as an h2.
		await expect(
			page.getByRole( 'heading', { level: 2 } ).first()
		).toBeVisible();

		// One Save for the screen, in the page header beside Add custom tools —
		// not one per card. Hidden panels stay mounted, so a per-card Save would
		// push this count past one even on the inactive tabs.
		await expect(
			page.getByRole( 'button', { name: 'Save' } )
		).toHaveCount( 1 );
	} );
} );
