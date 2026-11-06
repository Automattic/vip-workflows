/**
 * The sequence canvas, stubbed down to what a jsdom test can drive.
 *
 * React Flow measures a viewport jsdom does not lay out, so the real canvas
 * cannot render in a unit test. Every suite that renders the sequence editor
 * replaces it with this:
 *
 *     jest.mock(
 *         '../../src/admin/components/graph/GraphCanvas',
 *         () => require( './helpers/graph-canvas-stub' ).GraphCanvasStub
 *     );
 *
 * It lives apart from `sequence-editor.js` because that module imports the
 * editor, and the editor imports the canvas: a mock factory requiring it would
 * require a module still in the middle of loading.
 *
 * Read what the editor handed the canvas through `sequence-editor.js`, which
 * re-exports everything here.
 *
 * @package
 */

/** The props the stub was last rendered with. */
let lastProps;

/**
 * Every reveal the stub was handed, in order, deduplicated by identity: the
 * canvas re-renders for reasons of its own (a keystroke in the panel), and a
 * prop arriving twice is still one instruction.
 */
let reveals = [];

/**
 * The canvas stub. Records every prop it is given — the editor's callbacks, the
 * stages, any reveal — and offers the two gestures suites need as buttons:
 * drawing Draft → End, and clicking empty canvas.
 *
 * @param {Object} props The props the editor hands the canvas.
 * @return {JSX.Element} Stub.
 */
export function GraphCanvasStub( props ) {
	lastProps = props;
	if ( props.reveal && reveals[ reveals.length - 1 ] !== props.reveal ) {
		reveals.push( props.reveal );
	}

	return (
		<div data-testid="canvas">
			<button
				onClick={ () =>
					props.onConnectTransition( 'draft', '__wf_end__', null )
				}
			>
				end the flow
			</button>
			{ /* Drawing an edge selects it, which swaps the inspector to that
			     edge's panel. Clicking empty canvas is how the sequence
			     settings come back. */ }
			<button onClick={ props.onClearSelection }>
				deselect everything
			</button>
		</div>
	);
}

/**
 * The props the canvas was last rendered with.
 *
 * @return {Object|undefined} Props, or undefined before the canvas has rendered.
 */
export function canvas() {
	return lastProps;
}

/**
 * Every reveal the canvas was handed, in order.
 *
 * @return {Array<Object>} Reveals.
 */
export function canvasReveals() {
	return [ ...reveals ];
}

/**
 * Forget every render, so a test starts from an unrendered canvas.
 */
export function resetCanvas() {
	lastProps = undefined;
	reveals = [];
}
