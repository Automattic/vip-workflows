/**
 * Unit tests for the split between the shared side-effect module and the build
 * entry that publishes it.
 *
 * The React surfaces import `src/common/confirm-workflow-side-effect.js`
 * directly, so importing it must not touch `window`. The classic Quick Edit /
 * Bulk Edit inline script reads `window.vipWorkflowsSideEffect`, which only
 * `src/entries/side-effect.js` publishes — and it must publish the very same
 * functions, not a second copy.
 */

describe( 'side-effect module and entry', () => {
	beforeEach( () => {
		jest.resetModules();
		delete window.vipWorkflowsSideEffect;
	} );

	afterEach( () => {
		delete window.vipWorkflowsSideEffect;
	} );

	it( 'publishes nothing when the shared module is imported', () => {
		require( '../../src/common/confirm-workflow-side-effect' );

		expect( window.vipWorkflowsSideEffect ).toBeUndefined();
	} );

	it( 'publishes the shared module on the global from the entry', () => {
		const shared = require( '../../src/common/confirm-workflow-side-effect' );
		require( '../../src/entries/side-effect' );

		const api = window.vipWorkflowsSideEffect;

		expect( api ).toBeDefined();
		// The entry publishes every export of the shared module, so a new export
		// that the entry forgets fails here rather than in the classic script.
		// `getEntryStageLabels` is React-only: the classic rows get that map
		// from PHP in their `data-entry-stages` attribute.
		const reactOnly = [ 'getEntryStageLabels' ];
		expect( Object.keys( shared ) ).toEqual(
			expect.arrayContaining( reactOnly )
		);
		const exported = Object.keys( shared )
			.filter(
				( name ) =>
					name !== 'default' &&
					name !== '__esModule' &&
					! reactOnly.includes( name )
			)
			.sort();

		expect( Object.keys( api ).sort() ).toEqual( exported );

		// Each published value is the shared one, not a second copy.
		exported.forEach( ( name ) => {
			expect( api[ name ] ).toBe( shared[ name ] );
		} );
	} );
} );
