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
		expect( api.DECISION_SILENT ).toBe( shared.DECISION_SILENT );
		expect( api.DECISION_WARN ).toBe( shared.DECISION_WARN );
		expect( api.DECISION_VETO ).toBe( shared.DECISION_VETO );

		// Every function the classic inline script calls is the shared one.
		[
			'statusToRegion',
			'evaluateStatusChange',
			'getRegionLabel',
			'getStatusChangeConfirmTitle',
			'getStatusChangeConfirmLabel',
			'getAgentInterruptWarning',
			'getTransitionWarningsTitle',
			'getTransitionWarningsMessage',
			'getTransitionPublishConfirmTitle',
			'getTransitionPublishConfirmLabel',
			'getTransitionPublishWarning',
			'getStatusChangeWarning',
			'getPublishVetoMessage',
			'getOrphanedWorkflowMessage',
			'getOrphanedWorkflowRemoveConfirmation',
			'getRemoveFromWorkflowLabel',
			'getRemoveFromWorkflowConfirmation',
			'getSwitchWorkflowConfirmTitle',
			'getSwitchWorkflowConfirmLabel',
			'getSwitchWorkflowConfirmation',
		].forEach( ( name ) => {
			expect( typeof shared[ name ] ).toBe( 'function' );
			expect( api[ name ] ).toBe( shared[ name ] );
		} );
	} );
} );
