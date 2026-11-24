/**
 * The workflow split button in the editor header.
 *
 * For a person who cannot bypass the workflow, a post on the draft side of the
 * publish boundary has nowhere for core's Publish button to go but a refusal,
 * so the header offers the stage's primary transition in its place. A person
 * who can bypass keeps core's Publish, with the workflow button beside it.
 *
 * Administrators bypass by default, so this spec takes the bypass away for its
 * own tests and puts the default back after each one. The default, not a
 * snapshot of whatever was stored: a run killed mid-test never restores, and a
 * snapshot taken by the next run would then save the broken value as the one
 * to return to, every run after. The suite runs on one worker, so no other
 * spec sees the change while it lasts.
 *
 * @package
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const {
	createWorkflowPost,
	deletePost,
	getWorkflowStatus,
	openWorkflowPanel,
	transition,
} = require( './helpers/workflow' );

const SETTINGS_PATH = '/vip-workflows/v1/settings/general';

/**
 * Who bypasses the workflow out of the box (Settings::sanitize_settings()).
 *
 * @type {string[]}
 */
const DEFAULT_BYPASS_ROLES = [ 'administrator' ];

/**
 * Set which roles bypass the workflow.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @param {string[]}                                                    roles        Role slugs.
 * @return {Promise<Object>} The saved settings.
 */
function setBypassRoles( requestUtils, roles ) {
	return requestUtils.rest( {
		path: SETTINGS_PATH,
		method: 'POST',
		data: { bypass_workflow_roles: roles },
	} );
}

test.describe( 'VIP Workflows — header split button (editor UI)', () => {
	let postId;

	test.afterEach( async ( { requestUtils } ) => {
		await setBypassRoles( requestUtils, DEFAULT_BYPASS_ROLES );

		if ( postId ) {
			await deletePost( requestUtils, postId );
			postId = undefined;
		}
	} );

	test( 'stands in for Publish, saves the edit, and moves the post', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		await setBypassRoles( requestUtils, [] );
		( { postId } = await createWorkflowPost( requestUtils, {
			title: 'Header action e2e',
		} ) );

		await admin.editPost( postId );

		const topBar = page.getByRole( 'region', { name: 'Editor top bar' } );
		const primary = topBar.locator( '.vip-workflows-header-action__main' );

		// The first transition of the Draft stage, under its own label.
		await expect( primary ).toHaveText( 'Submit for review' );
		await expect(
			topBar.getByRole( 'button', { name: 'Publish', exact: true } )
		).toBeHidden();

		// The arrow opens the rail with every way out.
		await topBar
			.getByRole( 'button', { name: 'Workflow transitions' } )
			.click();
		const rail = page.locator( '.vip-workflows-header-action__rail' );
		await expect( rail.locator( '.vip-workflows-rail__stage' ) ).toHaveText(
			'Draft'
		);
		await page.keyboard.press( 'Escape' );
		await expect( rail ).toBeHidden();

		// An unsaved edit travels with the move: the button saves first.
		await editor.canvas
			.getByRole( 'textbox', { name: 'Add title' } )
			.fill( 'Header action e2e, edited' );
		await primary.click();

		await expect
			.poll(
				async () =>
					( await getWorkflowStatus( requestUtils, postId ) ).current
						.key
			)
			.toBe( 'review' );

		const saved = await requestUtils.rest( {
			path: `/wp/v2/posts/${ postId }`,
			params: { context: 'edit' },
		} );
		expect( saved.title.raw ).toBe( 'Header action e2e, edited' );

		// The rail in the sidebar follows the move made from the header.
		const panel = await openWorkflowPanel( page );
		await expect(
			panel.locator( '.vip-workflows-rail__stage' )
		).toHaveText( 'In review' );
	} );

	/**
	 * Whether core's Publish is hidden is decided from the post's workflow
	 * state. Read after the editor paints, that answer came one paint late and
	 * Publish flashed on every load, so the state is served with the page.
	 * Every animation frame is sampled from the first one.
	 */
	test( 'never paints core Publish where the button stands in for it', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		await setBypassRoles( requestUtils, [] );
		( { postId } = await createWorkflowPost( requestUtils, {
			title: 'Header action no-flash e2e',
		} ) );

		await page.addInitScript( () => {
			window.vipWorkflowsPublishFrames = 0;
			const sample = () => {
				const publish = document.querySelector(
					'.editor-header .editor-post-publish-button__button'
				);
				if ( publish?.getBoundingClientRect().width > 0 ) {
					window.vipWorkflowsPublishFrames++;
				}
				window.requestAnimationFrame( sample );
			};
			window.requestAnimationFrame( sample );
		} );

		await admin.editPost( postId );
		await expect(
			page.locator( '.vip-workflows-header-action__main' )
		).toBeVisible();

		expect(
			await page.evaluate( () => window.vipWorkflowsPublishFrames )
		).toBe( 0 );
	} );

	/**
	 * Core's Publish is hidden, so the step before a publishing move is where
	 * other plugins' pre-publish checks show. A fill registered the way any
	 * plugin registers one has to appear there, before anything is published.
	 */
	test( 'shows other plugins’ pre-publish checks before publishing', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		await setBypassRoles( requestUtils, [] );
		( { postId } = await createWorkflowPost( requestUtils, {
			title: 'Header action pre-publish e2e',
		} ) );
		await transition( requestUtils, postId, 'review' );
		await transition( requestUtils, postId, 'ready' );

		await admin.editPost( postId );

		await page.evaluate( () => {
			const { createElement } = window.wp.element;
			window.wp.plugins.registerPlugin( 'vip-workflows-e2e-pre-publish', {
				render: () =>
					createElement(
						window.wp.editor.PluginPrePublishPanel,
						{ title: 'E2E check', initialOpen: true },
						'Checked by another plugin'
					),
			} );
		} );

		const primary = page
			.getByRole( 'region', { name: 'Editor top bar' } )
			.locator( '.vip-workflows-header-action__main' );
		await expect( primary ).toHaveText( 'Publish now' );
		await primary.click();

		const dialog = page.getByRole( 'dialog', {
			name: 'Publish this post?',
		} );
		await expect(
			dialog.getByText( 'Checked by another plugin' )
		).toBeVisible();

		// Nothing is published until the step is answered.
		expect(
			( await getWorkflowStatus( requestUtils, postId ) ).current.key
		).toBe( 'ready' );

		await dialog.getByRole( 'button', { name: 'Publish' } ).click();

		await expect
			.poll(
				async () =>
					( await getWorkflowStatus( requestUtils, postId ) ).current
						.key
			)
			.toBe( 'publish' );
	} );

	test( 'keeps core Publish for a person who can bypass the workflow', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		await setBypassRoles( requestUtils, [ 'administrator' ] );
		( { postId } = await createWorkflowPost( requestUtils, {
			title: 'Header action bypass e2e',
		} ) );

		await admin.editPost( postId );

		const topBar = page.getByRole( 'region', { name: 'Editor top bar' } );
		await expect(
			topBar.getByRole( 'button', { name: 'Publish', exact: true } )
		).toBeVisible();
		await expect(
			topBar.locator( '.vip-workflows-header-action__main' )
		).toHaveText( 'Submit for review' );
	} );

	/*
	 * The split button's shape. Two buttons drawn as one control: the halves
	 * share a row and a height, meet at a 1px seam, and are squared off where
	 * they meet. Corner radii outside the seam come from core's Button, so
	 * they are checked as rounded, not as a size.
	 */
	test( 'draws the two halves as one control while standing in for Publish', async ( {
		admin,
		page,
		requestUtils,
	}, testInfo ) => {
		await setBypassRoles( requestUtils, [] );
		( { postId } = await createWorkflowPost( requestUtils, {
			title: 'Header action shape e2e',
		} ) );

		await admin.editPost( postId );

		const parts = splitButton( page );
		await expect( parts.main ).toHaveClass( /is-primary/ );
		await expectOneControl( parts );
		await expectLastPinnedItem( parts.wrapper );
		await expectSteadyFocus( parts.toggle );
		await attachCrop( testInfo, parts.wrapper, 'replaces-publish-desktop' );
	} );

	test( 'draws the two halves as one control beside core Publish', async ( {
		admin,
		page,
		requestUtils,
	}, testInfo ) => {
		await setBypassRoles( requestUtils, [ 'administrator' ] );
		( { postId } = await createWorkflowPost( requestUtils, {
			title: 'Header action shape bypass e2e',
		} ) );

		await admin.editPost( postId );

		const parts = splitButton( page );
		await expect( parts.main ).toHaveClass( /is-secondary/ );
		await expectOneControl( parts );
		await expectLastPinnedItem( parts.wrapper );
		await expectSteadyFocus( parts.toggle );
		await attachCrop( testInfo, parts.wrapper, 'beside-publish-desktop' );
	} );

	/*
	 * Core hides pinned items below the small breakpoint. Standing in for
	 * Publish, the button is the only way forward, so both halves stay;
	 * beside Publish, it yields like any other pinned item.
	 */
	test( 'keeps both halves at phone width while standing in for Publish', async ( {
		admin,
		page,
		requestUtils,
	}, testInfo ) => {
		await setBypassRoles( requestUtils, [] );
		( { postId } = await createWorkflowPost( requestUtils, {
			title: 'Header action phone e2e',
		} ) );

		await page.setViewportSize( PHONE );
		await admin.editPost( postId );

		const parts = splitButton( page );
		await expect( parts.main ).toBeVisible();
		await expect( parts.toggle ).toBeVisible();
		await expect(
			parts.topBar.getByRole( 'button', { name: 'Publish', exact: true } )
		).toBeHidden();
		await expectOneControl( parts );
		await attachCrop( testInfo, parts.wrapper, 'replaces-publish-phone' );
	} );

	test( 'hides both halves at phone width beside core Publish', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		await setBypassRoles( requestUtils, [ 'administrator' ] );
		( { postId } = await createWorkflowPost( requestUtils, {
			title: 'Header action phone bypass e2e',
		} ) );

		await page.setViewportSize( PHONE );
		await admin.editPost( postId );

		const parts = splitButton( page );
		await expect(
			parts.topBar.getByRole( 'button', { name: 'Publish', exact: true } )
		).toBeVisible();
		await expect( parts.main ).toBeHidden();
		await expect( parts.toggle ).toBeHidden();
	} );
} );

/**
 * Below core's small breakpoint (600px).
 *
 * @type {{width: number, height: number}}
 */
const PHONE = { width: 375, height: 800 };

/**
 * The split button's parts in the editor header.
 *
 * @param {import('@playwright/test').Page} page
 * @return {Object} Locators: topBar, wrapper, main, toggle.
 */
function splitButton( page ) {
	const topBar = page.getByRole( 'region', { name: 'Editor top bar' } );
	return {
		topBar,
		wrapper: topBar.locator( '.vip-workflows-header-action' ),
		main: topBar.locator( '.vip-workflows-header-action__main' ),
		toggle: topBar.getByRole( 'button', { name: 'Workflow transitions' } ),
	};
}

/**
 * Corner radii as computed, in px strings.
 *
 * @param {import('@playwright/test').Locator} locator
 * @return {Promise<Object>} topLeft, topRight, bottomRight, bottomLeft.
 */
function cornerRadii( locator ) {
	return locator.evaluate( ( el ) => {
		const style = window.getComputedStyle( el );
		return {
			topLeft: style.borderTopLeftRadius,
			topRight: style.borderTopRightRadius,
			bottomRight: style.borderBottomRightRadius,
			bottomLeft: style.borderBottomLeftRadius,
		};
	} );
}

/**
 * The halves sit in one row at one height, 1px apart, squared off where they
 * meet and rounded on the outside.
 *
 * @param {Object}                             parts        Locators from splitButton().
 * @param {import('@playwright/test').Locator} parts.main   The main half.
 * @param {import('@playwright/test').Locator} parts.toggle The arrow half.
 */
async function expectOneControl( { main, toggle } ) {
	await expect( main ).toBeVisible();
	await expect( toggle ).toBeVisible();

	const mainBox = await main.boundingBox();
	const toggleBox = await toggle.boundingBox();

	expect( toggleBox.x - ( mainBox.x + mainBox.width ) ).toBeCloseTo( 1, 0 );
	// Subpixel layout differs by platform (Linux CI renders the halves up to 0.6px apart); 1px of difference in the top edge or the height is still a single seam.
	expect( Math.abs( toggleBox.y - mainBox.y ) ).toBeLessThanOrEqual( 1 );
	expect( Math.abs( toggleBox.height - mainBox.height ) ).toBeLessThanOrEqual(
		1
	);

	const mainRadii = await cornerRadii( main );
	expect( mainRadii.topRight ).toBe( '0px' );
	expect( mainRadii.bottomRight ).toBe( '0px' );
	expect( mainRadii.topLeft ).not.toBe( '0px' );
	expect( mainRadii.bottomLeft ).not.toBe( '0px' );

	const toggleRadii = await cornerRadii( toggle );
	expect( toggleRadii.topLeft ).toBe( '0px' );
	expect( toggleRadii.bottomLeft ).toBe( '0px' );
	expect( toggleRadii.topRight ).not.toBe( '0px' );
	expect( toggleRadii.bottomRight ).not.toBe( '0px' );
}

/**
 * The button sits where Publish sat: after every other visible pinned item.
 *
 * @param {import('@playwright/test').Locator} wrapper
 */
async function expectLastPinnedItem( wrapper ) {
	const placement = await wrapper.evaluate( ( el ) => {
		const right = el.getBoundingClientRect().right;
		const others = Array.from( el.parentElement.children ).filter(
			( sibling ) =>
				sibling !== el && sibling.getBoundingClientRect().width > 0
		);
		return {
			order: window.getComputedStyle( el ).order,
			isRightmost: others.every(
				( sibling ) => sibling.getBoundingClientRect().right < right
			),
		};
	} );
	expect( placement.order ).toBe( '99' );
	expect( placement.isRightmost ).toBe( true );
}

/**
 * Focusing a half shows core's focus ring without moving or resizing it.
 *
 * @param {import('@playwright/test').Locator} button
 */
async function expectSteadyFocus( button ) {
	const before = await button.boundingBox();
	await button.focus();
	await expect( button ).toBeFocused();
	expect( await button.boundingBox() ).toEqual( before );
}

/**
 * Save a crop of the split button with the test's results, as evidence for a
 * before-and-after comparison. Not an assertion.
 *
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {import('@playwright/test').Locator}  wrapper
 * @param {string}                              name     File name, without extension.
 */
async function attachCrop( testInfo, wrapper, name ) {
	const path = testInfo.outputPath( `${ name }.png` );
	await wrapper.screenshot( { path } );
	await testInfo.attach( name, { path, contentType: 'image/png' } );
}
