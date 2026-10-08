/**
 * Which move the editor header offers, and when it hides core's Publish.
 *
 * Hiding a core control is the exception: only where Publish could do nothing
 * but fail — a live workflow, the draft side of the publish boundary, a person
 * who cannot bypass the workflow, and somewhere else to send the post.
 *
 * @package
 */

import {
	getPrimaryTransition,
	replacesCorePublish,
} from '../../src/editor/primary-transition';

const REVIEW = { to: 'review', label: 'Send to Review' };
const PUBLISH = { to: 'published', label: 'Publish' };

/**
 * A status payload, as the endpoint serves it.
 *
 * @param {Object} overrides Fields to replace.
 * @return {Object} The payload.
 */
function payload( overrides = {} ) {
	return {
		has_workflow: true,
		orphaned: false,
		guard: { current_region: 'draft', can_bypass: false },
		...overrides,
	};
}

describe( 'getPrimaryTransition', () => {
	it( 'is the first transition in authored order', () => {
		expect( getPrimaryTransition( [ REVIEW, PUBLISH ] ) ).toBe( REVIEW );
	} );

	it( 'stays the first transition when it is locked', () => {
		const held = { ...PUBLISH, _locked: true, _locked_reason: 'Fill it.' };

		expect( getPrimaryTransition( [ held, REVIEW ] ) ).toBe( held );
	} );

	it( 'is null when the stage offers no move', () => {
		expect( getPrimaryTransition( [] ) ).toBeNull();
		expect( getPrimaryTransition( undefined ) ).toBeNull();
	} );
} );

describe( 'replacesCorePublish', () => {
	it( 'replaces Publish on a draft-side stage', () => {
		expect( replacesCorePublish( payload(), [ REVIEW ] ) ).toBe( true );
	} );

	it( 'replaces Publish in the pending region', () => {
		expect(
			replacesCorePublish(
				payload( {
					guard: { current_region: 'pending', can_bypass: false },
				} ),
				[ PUBLISH ]
			)
		).toBe( true );
	} );

	it( 'keeps core controls for a live post, where the button is Save', () => {
		expect(
			replacesCorePublish(
				payload( {
					guard: { current_region: 'publish', can_bypass: false },
				} ),
				[ REVIEW ]
			)
		).toBe( false );
	} );

	it( 'keeps core controls in the private region', () => {
		expect(
			replacesCorePublish(
				payload( {
					guard: { current_region: 'private', can_bypass: false },
				} ),
				[ REVIEW ]
			)
		).toBe( false );
	} );

	it( 'keeps core controls for a person who can bypass the workflow', () => {
		expect(
			replacesCorePublish(
				payload( {
					guard: { current_region: 'draft', can_bypass: true },
				} ),
				[ REVIEW ]
			)
		).toBe( false );
	} );

	it( 'keeps core controls for an orphaned post', () => {
		expect(
			replacesCorePublish(
				payload( {
					orphaned: true,
					guard: { current_region: null, can_bypass: false },
				} ),
				[ REVIEW ]
			)
		).toBe( false );
	} );

	it( 'keeps core controls when the stage offers no move', () => {
		expect( replacesCorePublish( payload(), [] ) ).toBe( false );
	} );

	it( 'keeps core controls while its one button is the post’s Save', () => {
		expect( replacesCorePublish( payload(), [ REVIEW ], true ) ).toBe(
			false
		);
	} );

	it( 'keeps core controls for a post with no workflow', () => {
		expect(
			replacesCorePublish( { has_workflow: false }, [ REVIEW ] )
		).toBe( false );
		expect( replacesCorePublish( null, [ REVIEW ] ) ).toBe( false );
	} );
} );
