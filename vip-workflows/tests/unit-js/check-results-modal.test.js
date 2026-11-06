/**
 * CheckResultsModal — saying which copy of the post a check judged.
 *
 * A tool reads the post from the database. Run from the command palette over
 * unsaved edits, it judges the last saved copy, and its findings can contradict
 * what the author sees. The palette does not save before a read-only run, so the
 * result says so instead of reading as a broken check.
 *
 * @package
 */

import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';

/*
 * Queries are scoped to the dialog. Modal renders through a portal, and Notice
 * mirrors its text into an aria-live region on document.body that outlives the
 * test, so a body-wide query would find an earlier test's notice.
 */

import { CheckResultsModal } from '../../src/editor/components/ToolResultModals';

const STALE_COPY =
	'These results are for the last saved version. Save the post, then run the check again to include your edits.';

const PUBLISHED_COPY =
	'These results are for the published version. Save the post to publish your edits, then run the check again.';

const RESULT = {
	summary: 'SEO score: 85',
	output: {
		score: 85,
		status: 'warning',
		issues: [
			{ type: 'missing_alt', message: '1 image missing alt text.' },
		],
	},
};

function renderModal( props = {} ) {
	return render(
		<CheckResultsModal
			result={ RESULT }
			toolLabel="SEO check"
			onClose={ () => {} }
			{ ...props }
		/>
	);
}

describe( 'CheckResultsModal', () => {
	it( 'says the results describe the saved copy when edits were unsaved', () => {
		renderModal( { ranOnUnsavedEdits: true } );

		expect(
			within( screen.getByRole( 'dialog' ) ).getAllByText( STALE_COPY )
				.length
		).toBeGreaterThan( 0 );
	} );

	/**
	 * Saving a published post publishes the edits, so the copy says so rather
	 * than presenting the save as a harmless step.
	 */
	it( 'says saving publishes the edits when the post was published', () => {
		renderModal( { ranOnUnsavedEdits: true, ranOnPublishedPost: true } );

		const dialog = within( screen.getByRole( 'dialog' ) );
		expect( dialog.getAllByText( PUBLISHED_COPY ).length ).toBeGreaterThan(
			0
		);
		expect( dialog.queryByText( STALE_COPY ) ).not.toBeInTheDocument();
	} );

	it( 'keeps the draft copy when the post was not published', () => {
		renderModal( { ranOnUnsavedEdits: true, ranOnPublishedPost: false } );

		expect(
			within( screen.getByRole( 'dialog' ) ).queryByText( PUBLISHED_COPY )
		).not.toBeInTheDocument();
	} );

	it( 'says nothing about the saved copy when the post was clean', () => {
		renderModal( { ranOnPublishedPost: true } );

		const dialog = within( screen.getByRole( 'dialog' ) );
		expect( dialog.queryByText( STALE_COPY ) ).not.toBeInTheDocument();
		expect( dialog.queryByText( PUBLISHED_COPY ) ).not.toBeInTheDocument();
	} );

	/**
	 * A refused run judged nothing, so there are no findings to qualify.
	 */
	it( 'leaves a failed run to its own notice', () => {
		renderModal( {
			ranOnUnsavedEdits: true,
			result: { error: 'Check could not be completed' },
		} );

		expect(
			within( screen.getByRole( 'dialog' ) ).queryByText( STALE_COPY )
		).not.toBeInTheDocument();
	} );
} );
