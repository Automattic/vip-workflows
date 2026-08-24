/**
 * Deciding what a tool returned.
 *
 * The modals used to work this out by probing output keys in priority order:
 *
 *     output?.excerpt || result?.summary || output?.content || ''
 *
 * Nothing told them what an ability actually returned, so every new result shape
 * either matched no key and rendered nothing, or matched the wrong key and
 * rendered — or applied — the wrong thing. Three shipped bugs came from that: a
 * successful run with four links rendering an empty modal, a WP_Error read as a
 * success, and the footer setting a post title to "5 suggested headlines."
 *
 * An ability now declares `result_type` and this resolves the result against it.
 * `apply_field` is the precedent: it is the one thing the modal never guessed,
 * and the one thing that never broke.
 *
 * Inference is kept for an ability that declares nothing, so every tool that
 * exists today behaves exactly as it did.
 *
 * @package
 */

import { resolveToolResult } from '../../src/common/resolve-tool-result';

describe( 'resolveToolResult', () => {
	// ── Declared: value ──────────────────────────────────────────────

	it( 'resolves a declared value result to its value', () => {
		const resolved = resolveToolResult( {
			result: { output: { excerpt: 'A generated excerpt.' } },
			resultType: 'value',
		} );

		expect( resolved.kind ).toBe( 'value' );
		expect( resolved.value ).toBe( 'A generated excerpt.' );
	} );

	it( 'reads a declared value from content when excerpt is absent', () => {
		const resolved = resolveToolResult( {
			result: { output: { content: 'Some generated prose.' } },
			resultType: 'value',
		} );

		expect( resolved.value ).toBe( 'Some generated prose.' );
	} );

	/**
	 * The bug that set a post title to "5 suggested headlines." A summary is the
	 * line *about* a result and must never be offered as the result.
	 */
	it( 'never treats a summary as the value', () => {
		const resolved = resolveToolResult( {
			result: { summary: '5 suggested headlines.', output: {} },
			resultType: 'value',
		} );

		expect( resolved.value ).toBe( '' );
		expect( resolved.summary ).toBe( '5 suggested headlines.' );
	} );

	// ── Declared: list ───────────────────────────────────────────────

	it( 'resolves a declared list to its items', () => {
		const resolved = resolveToolResult( {
			result: { output: { suggestions: [ 'First', 'Second' ] } },
			resultType: 'list',
		} );

		expect( resolved.kind ).toBe( 'list' );
		expect( resolved.items ).toHaveLength( 2 );
		expect( resolved.items[ 0 ].label ).toBe( 'First' );
	} );

	it( 'normalizes the three accepted row shapes to one', () => {
		const resolved = resolveToolResult( {
			result: {
				output: {
					suggestions: [
						'A plain string',
						{ message: 'An object with a message' },
						{
							label: 'A labelled row',
							meta: 'Some context',
							href: 'https://example.com/',
						},
					],
				},
			},
			resultType: 'list',
		} );

		expect( resolved.items.map( ( i ) => i.label ) ).toEqual( [
			'A plain string',
			'An object with a message',
			'A labelled row',
		] );
		expect( resolved.items[ 2 ].href ).toBe( 'https://example.com/' );
	} );

	/**
	 * A list has no whole-result value — it is chosen from, per row. Offering one
	 * is what put a summary into the post title.
	 */
	it( 'gives a list no applicable value', () => {
		const resolved = resolveToolResult( {
			result: {
				summary: '2 suggested headlines.',
				output: { suggestions: [ 'First', 'Second' ] },
			},
			resultType: 'list',
		} );

		expect( resolved.value ).toBe( '' );
	} );

	/**
	 * Only a bare value can be written into a field. A plain string *is* the
	 * value — an alternative headline. A described row points somewhere: a
	 * suggested link's label is anchor text and its destination a URL, so there is
	 * nothing a field could be set to. Flattening the two would offer to set a
	 * post title to a link's anchor text.
	 */
	it( 'marks plain-string rows applicable and described rows not', () => {
		const resolved = resolveToolResult( {
			result: {
				output: {
					suggestions: [
						'An alternative headline',
						{ label: 'anchor text', href: 'https://example.com/' },
						{ message: 'A piece of advice' },
					],
				},
			},
			resultType: 'list',
		} );

		expect( resolved.items[ 0 ].applicable ).toBe( true );
		expect( resolved.items[ 1 ].applicable ).toBe( false );
		expect( resolved.items[ 2 ].applicable ).toBe( false );
	} );

	it( 'resolves a declared list with no items to empty rather than to a value', () => {
		const resolved = resolveToolResult( {
			result: { summary: 'No suggestions.', output: { suggestions: [] } },
			resultType: 'list',
		} );

		expect( resolved.kind ).toBe( 'list' );
		expect( resolved.items ).toEqual( [] );
		expect( resolved.value ).toBe( '' );
	} );

	// ── Declared: report ─────────────────────────────────────────────

	it( 'resolves a declared report to its verdict', () => {
		const resolved = resolveToolResult( {
			result: {
				output: {
					status: 'warning',
					score: 72,
					issues: [ 'Missing a source' ],
				},
			},
			resultType: 'report',
		} );

		expect( resolved.kind ).toBe( 'report' );
		expect( resolved.verdict.status ).toBe( 'warning' );
		expect( resolved.verdict.score ).toBe( 72 );
		expect( resolved.verdict.issues ).toEqual( [ 'Missing a source' ] );
	} );

	/**
	 * The check modal defaulted an absent status to Fail, so an ability that
	 * forgot the key was reported as failing. Absence of a verdict is not a
	 * negative verdict.
	 */
	it( 'reports a missing status as no verdict rather than as a failure', () => {
		const resolved = resolveToolResult( {
			result: { output: { issues: [ 'Something to look at' ] } },
			resultType: 'report',
		} );

		expect( resolved.verdict.status ).toBeNull();
	} );

	it( 'carries a report’s suggestions alongside its issues', () => {
		const resolved = resolveToolResult( {
			result: {
				output: {
					status: 'fail',
					issues: [ 'A problem' ],
					suggestions: [ 'A fix' ],
				},
			},
			resultType: 'report',
		} );

		expect( resolved.verdict.issues ).toEqual( [ 'A problem' ] );
		expect( resolved.items[ 0 ].label ).toBe( 'A fix' );
	} );

	// ── Errors ───────────────────────────────────────────────────────

	it( 'surfaces an error regardless of the declared type', () => {
		[ 'value', 'list', 'report', undefined ].forEach( ( resultType ) => {
			const resolved = resolveToolResult( {
				result: { error: 'Upstream refused.' },
				resultType,
			} );

			expect( resolved.error ).toBe( 'Upstream refused.' );
		} );
	} );

	it( 'offers nothing to apply when the result is an error', () => {
		const resolved = resolveToolResult( {
			result: {
				error: 'Upstream refused.',
				output: { excerpt: 'stale' },
			},
			resultType: 'value',
		} );

		expect( resolved.value ).toBe( '' );
	} );

	// ── Undeclared: today's behaviour, unchanged ─────────────────────

	/**
	 * Every ability that exists predates this contract. An undeclared result must
	 * behave exactly as it does now, or shipping the contract breaks each of them.
	 */
	it( 'falls back to inference when nothing is declared', () => {
		const resolved = resolveToolResult( {
			result: { output: { excerpt: 'A generated excerpt.' } },
		} );

		expect( resolved.value ).toBe( 'A generated excerpt.' );
	} );

	it( 'infers a list from a suggestions array', () => {
		const resolved = resolveToolResult( {
			result: { output: { suggestions: [ 'First' ] } },
		} );

		expect( resolved.kind ).toBe( 'list' );
		expect( resolved.value ).toBe( '' );
	} );

	/**
	 * Deliberately preserved: with nothing declared and no other key present, the
	 * summary is still the only thing to show. That is the old behaviour, and the
	 * reason `result_type` exists rather than silently changing it.
	 */
	it( 'still falls back to a summary when nothing is declared and no output matches', () => {
		const resolved = resolveToolResult( {
			result: { summary: 'A one-line result.', output: {} },
		} );

		expect( resolved.value ).toBe( 'A one-line result.' );
	} );

	it( 'reports an unknown declared type as undeclared rather than throwing', () => {
		const resolved = resolveToolResult( {
			result: { output: { excerpt: 'A generated excerpt.' } },
			resultType: 'something-nobody-implemented',
		} );

		expect( resolved.value ).toBe( 'A generated excerpt.' );
	} );

	// ── Robustness ───────────────────────────────────────────────────

	it( 'survives a result with no output at all', () => {
		const resolved = resolveToolResult( {
			result: {},
			resultType: 'value',
		} );

		expect( resolved.value ).toBe( '' );
		expect( resolved.items ).toEqual( [] );
	} );

	it( 'survives a missing result', () => {
		expect( () => resolveToolResult( {} ) ).not.toThrow();
	} );

	it( 'discards list rows that carry no text', () => {
		const resolved = resolveToolResult( {
			result: { output: { suggestions: [ 'Real', '', null, {}, 42 ] } },
			resultType: 'list',
		} );

		expect( resolved.items.map( ( i ) => i.label ) ).toEqual( [ 'Real' ] );
	} );

	it( 'ignores a suggestions value that is not an array', () => {
		const resolved = resolveToolResult( {
			result: { output: { suggestions: 'not a list' } },
			resultType: 'list',
		} );

		expect( resolved.items ).toEqual( [] );
	} );
} );
