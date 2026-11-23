/**
 * General settings — the Workflow behavior section.
 *
 * Asserts the section's toggles as a list, so the test describes what the
 * section holds rather than any one control. Turning workflow selection on
 * reveals the enforcement mode, and the choice survives a save and a reload.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const GENERAL_SETTINGS = '/vip-workflows/v1/settings/general';

async function openGeneralTab( admin, page ) {
	await admin.visitAdminPage( 'admin.php', 'page=vip-workflows-settings' );
	await page.getByRole( 'tab', { name: 'General' } ).click();
	const section = page.getByRole( 'group', { name: 'Workflow behavior' } );
	await expect( section ).toBeVisible();
	return section;
}

test.describe( 'VIP Workflows — general settings', () => {
	let original;

	test.beforeEach( async ( { requestUtils } ) => {
		const settings = await requestUtils.rest( { path: GENERAL_SETTINGS } );
		original = settings.workflow_enforcement;

		await requestUtils.rest( {
			path: GENERAL_SETTINGS,
			method: 'POST',
			data: { workflow_enforcement: false },
		} );
	} );

	test.afterEach( async ( { requestUtils } ) => {
		await requestUtils.rest( {
			path: GENERAL_SETTINGS,
			method: 'POST',
			data: { workflow_enforcement: original },
		} );
	} );

	test( 'Workflow behavior holds the workflow selection toggle', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const section = await openGeneralTab( admin, page );

		const toggles = await section
			.getByRole( 'checkbox' )
			.evaluateAll( ( inputs ) =>
				inputs.map( ( input ) =>
					( input.labels?.[ 0 ]?.textContent ?? '' ).trim()
				)
			);
		expect( toggles ).toEqual( [
			'Prompt workflow selection for new posts',
		] );

		const toggle = section.getByRole( 'checkbox', {
			name: 'Prompt workflow selection for new posts',
		} );
		// The mode's radios show only while workflow selection is on.
		const mode = section.getByRole( 'radio', { name: /^Require/ } );

		await expect( mode ).toHaveCount( 0 );
		await toggle.click();
		await expect( mode ).toBeVisible();

		await page.getByRole( 'button', { name: 'Save' } ).click();

		await expect
			.poll(
				async () =>
					(
						await requestUtils.rest( {
							path: GENERAL_SETTINGS,
						} )
					).workflow_enforcement
			)
			.toBe( true );

		const reloaded = await openGeneralTab( admin, page );
		await expect(
			reloaded.getByRole( 'checkbox', {
				name: 'Prompt workflow selection for new posts',
			} )
		).toBeChecked();
		await expect(
			reloaded.getByRole( 'radio', { name: /^Require/ } )
		).toBeVisible();
	} );
} );
