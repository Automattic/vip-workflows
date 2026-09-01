/**
 * Configurable prompts — Settings → Prompts tab.
 *
 * Edits a registered prompt's override from the admin UI and confirms it
 * persists (UI + REST), then resets it.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const PROMPT_ID = 'media/image-analysis';

async function openPromptsTab( admin, page ) {
	await admin.visitAdminPage( 'admin.php', 'page=vip-workflows-settings' );
	await page.getByRole( 'tab', { name: 'Prompts' } ).click();
	await expect( getPromptTextbox( page ) ).toBeVisible();
}

// Scope to the prompt's own item by its stable id, not its label — several
// prompts share the "Media: image analysis" prefix (e.g. the ideation-source
// variant), so a label match resolves to multiple textboxes.
function getPromptItem( page ) {
	return page.locator( `[data-prompt-id="${ PROMPT_ID }"]` );
}

function getPromptTextbox( page ) {
	return getPromptItem( page ).getByRole( 'textbox' );
}

async function savePrompts( page ) {
	await page.getByRole( 'button', { name: 'Save' } ).click();
}

test.describe( 'VIP Workflows — configurable prompts (Settings)', () => {
	test.afterEach( async ( { requestUtils } ) => {
		// Reset the override so runs stay isolated.
		await requestUtils
			.rest( {
				path: `/vip-workflows/v1/prompts/${ PROMPT_ID }`,
				method: 'POST',
				data: { prompt: '' },
			} )
			.catch( () => {} );
	} );

	test( 'editing a prompt override persists', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		await openPromptsTab( admin, page );
		const textbox = getPromptTextbox( page );

		const override = 'E2E override — describe the image briefly.';
		await textbox.fill( override );
		await savePrompts( page );

		// Persisted server-side.
		await expect
			.poll( async () => {
				const prompts = await requestUtils.rest( {
					path: '/vip-workflows/v1/prompts',
				} );
				return ( prompts.find( ( p ) => p.id === PROMPT_ID ) || {} )
					.override;
			} )
			.toBe( override );

		// Survives a reload.
		await openPromptsTab( admin, page );
		await expect( getPromptTextbox( page ) ).toHaveValue( override );
	} );

	test( 'reset clears the override', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		await requestUtils.rest( {
			path: `/vip-workflows/v1/prompts/${ PROMPT_ID }`,
			method: 'POST',
			data: { prompt: 'Temporary override.' },
		} );

		await openPromptsTab( admin, page );
		await expect( getPromptTextbox( page ) ).toHaveValue(
			'Temporary override.'
		);
		await getPromptItem( page )
			.getByRole( 'button', { name: 'Reset to default' } )
			.click();
		await savePrompts( page );

		await expect
			.poll( async () => {
				const prompts = await requestUtils.rest( {
					path: '/vip-workflows/v1/prompts',
				} );
				return ( prompts.find( ( p ) => p.id === PROMPT_ID ) || {} )
					.override;
			} )
			.toBeNull();
	} );
} );
