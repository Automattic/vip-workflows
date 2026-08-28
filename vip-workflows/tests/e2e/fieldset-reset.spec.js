/**
 * The `<fieldset>` shrink reset, on the surfaces that carry it.
 *
 * `<fieldset>` ships a UA `min-inline-size: min-content`, so it refuses to go
 * narrower than its own content and overflows any constrained flex or grid
 * parent. Measured: a fieldset given 50px of a 200px flex row takes 203px
 * without the reset and 50px with it.
 *
 * `@wordpress/ui`'s `Fieldset` does not reset it — that stylesheet zeroes
 * `border`, `margin` and `padding` and stops — so this is ours to carry, and it
 * lives once per surface rather than once per group: src/admin/admin-page.css
 * for the admin canvas, src/styles/modal-reset.css for anything portaled to
 * document.body, which the canvas scope cannot reach.
 *
 * jsdom has no layout and does not apply stylesheets, so the unit suite cannot
 * see this at all — the shrink behaviour and the computed floor are both real
 * browser facts. Hence e2e. Unlike wpds-cascade-audit.spec.js, which is an
 * informational detector, this one fails: it guards a rule that is already
 * correct.
 *
 * @package
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

/**
 * Read the effective floor off every fieldset under a root.
 *
 * @param {import('@playwright/test').Page} page         The page.
 * @param {string}                          rootSelector Subtree to scan.
 * @return {Promise<Array|null>} One entry per fieldset, or null if the root is absent.
 */
async function fieldsetFloors( page, rootSelector ) {
	return page.evaluate( ( sel ) => {
		const root = document.querySelector( sel );
		if ( ! root ) {
			return null;
		}
		return [ ...root.querySelectorAll( 'fieldset' ) ].map( ( el ) => ( {
			className: el.className || '(no class)',
			minInlineSize: getComputedStyle( el ).minInlineSize,
		} ) );
	}, rootSelector );
}

/**
 * Constrain a fieldset's parent and report whether it actually shrinks.
 *
 * The computed floor is the rule; this is the consequence. Asserting only the
 * declaration would pass if some later rule re-raised the floor, so both are
 * checked. Mutates layout, so it restores what it touched.
 *
 * @param {import('@playwright/test').Page} page         The page.
 * @param {string}                          rootSelector Subtree holding the fieldset.
 * @return {Promise<number|null>} Rendered width in px, or null if absent.
 */
async function shrinksUnderPressure( page, rootSelector ) {
	return page.evaluate( ( sel ) => {
		const fs = document.querySelector( `${ sel } fieldset` );
		if ( ! fs ) {
			return null;
		}
		const parent = fs.parentElement;
		const prev = parent.getAttribute( 'style' ) || '';
		parent.style.display = 'flex';
		// Explicitly row: these parents are column Stacks, and in a column the
		// spacer's flex-basis would size it on the block axis, leaving the
		// fieldset the full inline size and the measurement meaningless.
		parent.style.flexDirection = 'row';
		parent.style.width = '200px';

		const spacer = document.createElement( 'div' );
		spacer.style.flex = '0 0 150px';
		spacer.style.minWidth = '150px';
		parent.appendChild( spacer );

		const width = Math.round( fs.getBoundingClientRect().width );

		spacer.remove();
		parent.setAttribute( 'style', prev );
		return width;
	}, rootSelector );
}

test.describe( 'fieldset shrink reset', () => {
	test( 'admin canvas', async ( { admin, page } ) => {
		await admin.visitAdminPage( 'admin.php', 'page=vip-workflow-settings' );
		await page.waitForLoadState( 'networkidle' ).catch( () => {} );
		await page
			.locator( '.vip-workflow-admin-page fieldset' )
			.first()
			.waitFor();

		const floors = await fieldsetFloors( page, '.vip-workflow-admin-page' );
		expect(
			floors,
			'no fieldset found — has the Settings screen changed?'
		).not.toHaveLength( 0 );
		for ( const f of floors ) {
			expect( f.minInlineSize, `fieldset ${ f.className }` ).toBe(
				'0px'
			);
		}

		// Given 50px of a 200px row, it must take 50px — not the ~200px+ the UA
		// floor produces.
		expect(
			await shrinksUnderPressure( page, '.vip-workflow-admin-page' )
		).toBeLessThanOrEqual( 50 );
	} );

	test( 'portaled modal', async ( { admin, page } ) => {
		await admin.visitAdminPage( 'admin.php', 'page=vip-workflow-tools' );
		await page.waitForLoadState( 'networkidle' ).catch( () => {} );

		const trigger = page.getByRole( 'button', {
			name: /Add custom tools/i,
		} );
		if ( ( await trigger.count() ) === 0 ) {
			test.skip(
				true,
				'How-to modal trigger not present on this build.'
			);
			return;
		}
		await trigger.click();
		await page.locator( '.components-modal__content' ).waitFor();

		// The modal's own content may carry no fieldset today. Mount one so the
		// rule is exercised where the canvas reset provably cannot reach: this
		// guards modal-reset.css against being dropped as redundant.
		const floor = await page.evaluate( () => {
			const root = document.querySelector( '.components-modal__content' );
			const fs = document.createElement( 'fieldset' );
			root.appendChild( fs );
			const value = getComputedStyle( fs ).minInlineSize;
			fs.remove();
			return value;
		} );
		expect( floor ).toBe( '0px' );
	} );
} );
