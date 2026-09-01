/**
 * HelperResultModal — what a successful helper tool actually shows.
 *
 * The modal was written for excerpt-style tools that generate one value the
 * writer applies to a field. A tool returning a list contributed none of the
 * keys it reads, so it rendered an empty box while reporting success. These
 * cover both shapes so the single-value path cannot regress while the list
 * path is added.
 *
 * @package
 */

import '@testing-library/jest-dom';
import { render, within } from '@testing-library/react';

/*
 * Queries run against `baseElement` (document.body), not `container`. Modal
 * renders through a portal, so the render container is left an empty
 * aria-hidden div and container-scoped queries find nothing.
 */

import { HelperResultModal } from '../../src/editor/components/ToolResultModals';

const noop = () => {};

function renderModal( result, props = {} ) {
	return render(
		<HelperResultModal
			result={ result }
			toolLabel="Smart Linking"
			onClose={ noop }
			onRegenerate={ noop }
			{ ...props }
		/>
	);
}

describe( 'HelperResultModal', () => {
	it( 'renders single-value generated content', () => {
		const { baseElement } = renderModal( {
			output: { excerpt: 'A generated excerpt.' },
		} );

		expect(
			within( baseElement ).getByText( 'A generated excerpt.' )
		).toBeInTheDocument();
	} );

	it( 'renders a list of suggestions', () => {
		const { baseElement } = renderModal( {
			output: {
				suggestions: [
					'"coffee futures" → https://example.com/coffee',
					'"Brazil harvest" → https://example.com/brazil',
				],
			},
		} );

		expect(
			within( baseElement ).getByText(
				'"coffee futures" → https://example.com/coffee'
			)
		).toBeInTheDocument();
		expect(
			within( baseElement ).getByText(
				'"Brazil harvest" → https://example.com/brazil'
			)
		).toBeInTheDocument();
	} );

	it( 'renders every item, not just the first', () => {
		const { baseElement } = renderModal( {
			output: { suggestions: [ 'one', 'two', 'three', 'four', 'five' ] },
		} );

		expect( within( baseElement ).getAllByRole( 'listitem' ) ).toHaveLength(
			5
		);
	} );

	/**
	 * Matches CheckResultsModal's existing convention rather than inventing a
	 * second one, so a tool can move between the two modals unchanged.
	 */
	it( 'accepts objects carrying a message, like the check modal does', () => {
		const { baseElement } = renderModal( {
			output: { suggestions: [ { message: 'From an object.' } ] },
		} );

		expect(
			within( baseElement ).getByText( 'From an object.' )
		).toBeInTheDocument();
	} );

	it( 'shows the summary alongside the list when one is given', () => {
		const { baseElement } = renderModal( {
			summary: 'Found 2 suggested links.',
			output: { suggestions: [ 'one', 'two' ] },
		} );

		expect(
			within( baseElement ).getByText( 'Found 2 suggested links.' )
		).toBeInTheDocument();
	} );

	/**
	 * The regression that started this: success, real results, empty box.
	 */
	it( 'never renders an empty body for a successful result with content', () => {
		const { baseElement } = renderModal( {
			output: { suggestions: [ 'a suggestion' ] },
		} );

		expect( baseElement.textContent ).toContain( 'a suggestion' );
	} );

	it( 'still renders the error path ahead of any output', () => {
		const { baseElement } = renderModal( {
			error: 'Something went wrong.',
			output: { suggestions: [ 'should not appear' ] },
		} );

		expect(
			within( baseElement ).getAllByText( 'Something went wrong.' ).length
		).toBeGreaterThan( 0 );
		expect( baseElement.textContent ).not.toContain( 'should not appear' );
	} );

	/*
	 * Applying one of several options.
	 *
	 * A list the writer cannot act on hands the transcription work back to them,
	 * which is the opposite of what a suggestion tool is for. `onApply` is passed
	 * only when the tool declares an apply_field, so a list with nothing to apply
	 * to — suggested links, say — must keep rendering as plain text.
	 */
	describe( 'applying a suggestion', () => {
		const suggestions = [ 'First headline', 'Second headline' ];

		it( 'offers an apply action per suggestion when the tool can apply', () => {
			const { baseElement } = renderModal(
				{ output: { suggestions } },
				{ onApply: jest.fn() }
			);

			expect(
				within( baseElement ).getAllByRole( 'button', {
					name: /use this/i,
				} )
			).toHaveLength( 2 );
		} );

		it( 'applies the suggestion whose action was clicked', () => {
			const onApply = jest.fn();
			const { baseElement } = renderModal(
				{ output: { suggestions } },
				{ onApply }
			);

			within( baseElement )
				.getAllByRole( 'button', { name: /use this/i } )[ 1 ]
				.click();

			expect( onApply ).toHaveBeenCalledWith( 'Second headline' );
		} );

		it( 'offers nothing to apply when the tool has no field to apply to', () => {
			const { baseElement } = renderModal( { output: { suggestions } } );

			expect(
				within( baseElement ).queryAllByRole( 'button', {
					name: /use this/i,
				} )
			).toHaveLength( 0 );
			expect( baseElement.textContent ).toContain( 'First headline' );
		} );

		it( 'does not offer to apply an object-shaped suggestion', () => {
			const { baseElement } = renderModal(
				{
					output: {
						suggestions: [ { message: 'Not a field value' } ],
					},
				},
				{ onApply: jest.fn() }
			);

			// A message carries no value to put in a field; the text still shows.
			expect(
				within( baseElement ).queryAllByRole( 'button', {
					name: /use this/i,
				} )
			).toHaveLength( 0 );
			expect( baseElement.textContent ).toContain( 'Not a field value' );
		} );

		it( 'disables the apply actions while an apply is in flight', () => {
			const { baseElement } = renderModal(
				{ output: { suggestions } },
				{ onApply: jest.fn(), applying: true }
			);

			within( baseElement )
				.getAllByRole( 'button', { name: /use this/i } )
				.forEach( ( b ) => expect( b ).toBeDisabled() );
		} );
	} );

	/*
	 * The richer row shape: a value plus where it points. Introduced so a
	 * suggested link can name its destination instead of printing a URL.
	 */
	describe( 'rows carrying a destination', () => {
		const row = {
			label: 'coffee futures',
			meta: 'Coffee Futures Spike on Brazil Harvest',
			href: 'https://example.com/coffee',
		};

		it( 'shows the value and its destination', () => {
			const { baseElement } = renderModal( {
				output: { suggestions: [ row ] },
			} );

			expect(
				within( baseElement ).getByText( 'coffee futures' )
			).toBeInTheDocument();
			expect(
				within( baseElement ).getByText(
					'Coffee Futures Spike on Brazil Harvest'
				)
			).toBeInTheDocument();
		} );

		it( 'never prints the raw URL as the row text', () => {
			const { baseElement } = renderModal( {
				output: { suggestions: [ row ] },
			} );

			expect(
				within( baseElement ).queryByText(
					'https://example.com/coffee'
				)
			).not.toBeInTheDocument();
		} );

		it( 'links the destination to its URL', () => {
			const { baseElement } = renderModal( {
				output: { suggestions: [ row ] },
			} );

			expect(
				within( baseElement ).getByRole( 'link', {
					name: /Coffee Futures Spike/,
				} )
			).toHaveAttribute( 'href', 'https://example.com/coffee' );
		} );

		it( 'offers no apply action for a row describing a destination', () => {
			const { baseElement } = renderModal(
				{ output: { suggestions: [ row ] } },
				{ onApply: jest.fn() }
			);

			expect(
				within( baseElement ).queryAllByRole( 'button', {
					name: /use this/i,
				} )
			).toHaveLength( 0 );
		} );
	} );

	/*
	 * The footer's apply button belongs to the single-value shape only.
	 *
	 * `generatedContent` falls back to `result.summary`, and a list result has a
	 * summary for the line above the list and for the audit row. That made the
	 * footer button apply "5 suggested headlines." as the post title.
	 */
	describe( 'the footer apply action', () => {
		it( 'is absent when the result is a list', () => {
			const { baseElement } = renderModal(
				{
					summary: '5 suggested headlines.',
					output: { suggestions: [ 'First', 'Second' ] },
				},
				{ onApply: jest.fn() }
			);

			// Two rows, and nothing else claiming to apply something.
			expect(
				within( baseElement ).getAllByRole( 'button', {
					name: /use this/i,
				} )
			).toHaveLength( 2 );
		} );

		it( 'never offers the summary as a value to apply', () => {
			const onApply = jest.fn();
			const { baseElement } = renderModal(
				{
					summary: '5 suggested headlines.',
					output: { suggestions: [ 'First', 'Second' ] },
				},
				{ onApply }
			);

			within( baseElement )
				.getAllByRole( 'button', { name: /use this/i } )
				.forEach( ( b ) => b.click() );

			expect( onApply ).not.toHaveBeenCalledWith(
				'5 suggested headlines.'
			);
			expect( onApply ).toHaveBeenCalledWith( 'First' );
			expect( onApply ).toHaveBeenCalledWith( 'Second' );
		} );

		it( 'is still offered for a single generated value', () => {
			const onApply = jest.fn();
			const { baseElement } = renderModal(
				{ output: { excerpt: 'A generated excerpt.' } },
				{ onApply }
			);

			within( baseElement )
				.getByRole( 'button', { name: /use this/i } )
				.click();

			expect( onApply ).toHaveBeenCalledWith( 'A generated excerpt.' );
		} );
	} );
} );
