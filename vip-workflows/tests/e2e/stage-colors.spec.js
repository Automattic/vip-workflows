/**
 * Stage colors.
 *
 * Stages carry a hex color surfaced in the sequences list (status_summary) and
 * chosen per stage in the graph editor from a fixed named palette (the freeform
 * base-color picker that once derived colors from a single hex has since been
 * replaced). This guards the wiring end to end: the list exposes stage colors,
 * and a palette color chosen in the editor persists through a save.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const SEED_COLOR = '#111111';

async function createSequence( requestUtils, label ) {
	return requestUtils.rest( {
		path: '/vip-workflows/v1/sequences',
		method: 'POST',
		data: {
			name: `E2E Stage Colors ${ label }`,
			type: 'workflow',
			status: 'active',
			post_types: [ 'post' ],
			statuses: [
				{
					key: 'draft',
					label: 'Draft',
					color: SEED_COLOR,
					status: 'draft',
					region_entry: true,
				},
				{
					key: 'review',
					label: 'Review',
					color: SEED_COLOR,
					status: 'draft',
				},
				{
					key: 'done',
					label: 'Done',
					color: SEED_COLOR,
					is_terminal: true,
					status: 'publish',
					region_entry: true,
				},
			],
		},
	} );
}

test.describe( 'VIP Workflows — automatic stage colors', () => {
	let sequenceId;

	test.afterEach( async ( { requestUtils } ) => {
		if ( sequenceId ) {
			await requestUtils
				.rest( {
					path: `/vip-workflows/v1/sequences/${ sequenceId }`,
					method: 'DELETE',
				} )
				.catch( () => {} );
			sequenceId = null;
		}
	} );

	test( 'the sequences list exposes stage colors in status_summary', async ( {
		requestUtils,
	} ) => {
		const bp = await createSequence( requestUtils, `list-${ Date.now() }` );
		sequenceId = bp.id;

		const list = await requestUtils.rest( {
			path: '/vip-workflows/v1/sequences',
		} );
		const mine = list.find( ( b ) => b.id === sequenceId );
		expect( mine ).toBeTruthy();

		const summary = mine.status_summary || [];
		expect( summary.length ).toBeGreaterThan( 0 );
		// Every pill carries a hex color so the list can tint it.
		expect(
			summary.every(
				( s ) => typeof s.color === 'string' && /^#/.test( s.color )
			)
		).toBe( true );
	} );

	test( 'a stage color chosen from the palette persists', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createSequence( requestUtils, `${ Date.now() }` );
		sequenceId = bp.id;

		await admin.visitAdminPage(
			'admin.php',
			'page=vip-workflows-sequences'
		);
		// Open the sequence in the graph editor. The card is
		// `.vip-workflows-summary-card`; "Edit" is an onClick <Button> (role
		// button); the editor's landmark is the sequence editor's "Save" action.
		await page
			.locator( '.vip-workflows-summary-card' )
			.filter( { hasText: bp.name } )
			.getByRole( 'button', { name: 'Edit' } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Save' } )
		).toBeVisible();

		// Select the Draft stage node to open its inspector, then pick a palette
		// color. The freeform base-color picker was replaced by a fixed named
		// palette (Green = #879F11), chosen per stage via a SelectControl.
		await page
			.locator( '.wf-stage-node' )
			.filter( { hasText: 'Draft' } )
			.click();
		const colorSelect = page.getByRole( 'combobox', { name: 'Color' } );
		await expect( colorSelect ).toBeVisible();
		await colorSelect.selectOption( '#879F11' );

		await page.getByRole( 'button', { name: 'Save' } ).click();

		// Persisted: the Draft stage carries the chosen palette color, off the
		// seed value (proves the color-edit save round-trip ran). Compared
		// case-insensitively since sanitize_hex_color may normalize case.
		await expect
			.poll( async () => {
				const updated = await requestUtils.rest( {
					path: `/vip-workflows/v1/sequences/${ sequenceId }`,
				} );
				return updated.config.statuses
					.find( ( s ) => s.key === 'draft' )
					?.color?.toLowerCase();
			} )
			.toBe( '#879f11' );

		const updated = await requestUtils.rest( {
			path: `/vip-workflows/v1/sequences/${ sequenceId }`,
		} );
		const draft = updated.config.statuses.find(
			( s ) => s.key === 'draft'
		);
		expect( draft.color.toLowerCase() ).not.toBe(
			SEED_COLOR.toLowerCase()
		);
	} );
} );
