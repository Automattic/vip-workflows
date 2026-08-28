/**
 * The editor's half of the required-metadata gate.
 *
 * The gate is the server's: a sequence's `required` fields must hold a value
 * before a post crosses into publish, and the projection onto each edge is
 * computed from get_post_meta() — from the database. The block editor is the one
 * place that is not the whole truth, because the sidebar's metadata rows write
 * through useEntityProp and stay in the editor store until the post is saved.
 * That is the defect these pin: an author filled both required fields and the
 * transition stayed disabled under "Required fields are empty: …" with the
 * values on screen, until they saved AND reloaded the page.
 *
 * Two things have to hold for the fix to be safe rather than merely convenient:
 *
 * - the emptiness rule has to match PHP's exactly, or a button unlocks into a
 *   422 the author cannot act on;
 * - the projection may only RELEASE a lock the server placed, never invent one,
 *   because which edges the gate covers is a question about stage regions that
 *   only the sequence answers.
 *
 * @package
 */

// The module reaches the plugin store (which fetches, and refreshes the post
// entity) and the editor store. None of that is exercised here — these are the
// gate's pure functions — but the imports still have to resolve, and the real
// packages pull dependencies Jest cannot load.
jest.mock( '@wordpress/api-fetch', () => jest.fn() );
jest.mock( '@wordpress/core-data', () => ( { store: 'core' } ) );
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );

// eslint-disable-next-line import/first
import {
	REQUIRED_METADATA_LOCK,
	getMissingRequiredMetadata,
	metadataValueIsEmpty,
	projectRequiredMetadataLocks,
} from '../../src/editor/required-metadata';

const SECTION = {
	key: 'section',
	meta_key: 'wf_meta_1_section',
	label: 'Section Name',
	type: 'text',
	required: true,
};

const EDITOR = {
	key: 'editor',
	meta_key: 'wf_meta_1_editor',
	label: 'Assigned editor',
	type: 'user',
	required: true,
};

const OPTIONAL = {
	key: 'notes',
	meta_key: 'wf_meta_1_notes',
	label: 'Notes',
	type: 'textarea',
	required: false,
};

/**
 * The publish edge, held by the gate exactly as the server projects it.
 *
 * @param {Array} labels Field labels the server found empty when it answered.
 * @return {Object} Transition carrying the metadata lock.
 */
function heldPublishEdge( labels ) {
	const named = labels.join( ' and ' );

	return {
		to: 'published',
		label: 'Publish',
		_locked: true,
		_locked_code: REQUIRED_METADATA_LOCK,
		_locked_reason: `Required fields are empty: ${ named }`,
	};
}

/**
 * An edge held by the assignment rule — a lock the editor may not touch.
 */
const ASSIGNMENT_HELD_EDGE = {
	to: 'review',
	label: 'Send to Review',
	_locked: true,
	_locked_reason: 'Only the assigned editor can make this move.',
};

describe( 'metadataValueIsEmpty', () => {
	/**
	 * The PHP mirror, per type. Sequence::metadata_value_is_empty() is the
	 * authority and this has to give the same answer for every value the editor
	 * can produce — a row this calls filled that the gate calls empty is a
	 * button that unlocks into a refusal.
	 */
	it( 'calls a blank string field empty, whitespace included', () => {
		expect( metadataValueIsEmpty( 'text', '' ) ).toBe( true );
		expect( metadataValueIsEmpty( 'text', '   ' ) ).toBe( true );
		expect( metadataValueIsEmpty( 'text', '\n\t' ) ).toBe( true );
		expect( metadataValueIsEmpty( 'textarea', undefined ) ).toBe( true );
		expect( metadataValueIsEmpty( 'select', null ) ).toBe( true );
	} );

	it( 'treats a typed zero as an answer, not a blank', () => {
		expect( metadataValueIsEmpty( 'text', '0' ) ).toBe( false );
		expect( metadataValueIsEmpty( 'text', 0 ) ).toBe( false );
	} );

	it( 'reads a user field through its 0 sentinel', () => {
		// 0 is what the picker writes when it is cleared: the field is
		// registered as integer meta, so an empty string fails the schema
		// before the sanitiser runs.
		expect( metadataValueIsEmpty( 'user', 0 ) ).toBe( true );
		expect( metadataValueIsEmpty( 'user', '0' ) ).toBe( true );
		// An unset key reads back as '' , which PHP's (int) cast calls 0.
		expect( metadataValueIsEmpty( 'user', '' ) ).toBe( true );
		expect( metadataValueIsEmpty( 'user', undefined ) ).toBe( true );

		expect( metadataValueIsEmpty( 'user', 7 ) ).toBe( false );
		expect( metadataValueIsEmpty( 'user', '7' ) ).toBe( false );
	} );

	it( 'calls a filled date and select field filled', () => {
		expect( metadataValueIsEmpty( 'date', '2026-09-01' ) ).toBe( false );
		expect( metadataValueIsEmpty( 'select', 'Feature' ) ).toBe( false );
	} );

	/**
	 * The one place the two answers differ, pinned so it stays a decision
	 * rather than a surprise. PHP judges the value as STORED, after the
	 * `sanitize_text_field` these meta keys are registered with; this judges it
	 * as TYPED, because that is the only value the editor holds. A field
	 * holding markup and nothing else is filled here and empty there.
	 *
	 * The release-only rule absorbs it: the button unlocks, the click saves,
	 * the save stores '', the server refuses with the same gate, and the
	 * refusal re-reads the status — by which point the editor is reading the
	 * sanitised value and the two agree again. One wasted round trip, no wrong
	 * state. Reproducing sanitize_text_field here (tags, octets,
	 * percent-encodings, whitespace collapse) would trade this one
	 * disagreement for several.
	 */
	it( 'judges the typed value, not the one sanitising will store', () => {
		expect( metadataValueIsEmpty( 'text', '<b></b>' ) ).toBe( false );
		// And what the save writes back, which both sides call empty.
		expect( metadataValueIsEmpty( 'text', '' ) ).toBe( true );
	} );
} );

describe( 'getMissingRequiredMetadata', () => {
	it( 'names the required fields with no value, in config order', () => {
		const missing = getMissingRequiredMetadata(
			[ SECTION, OPTIONAL, EDITOR ],
			{}
		);

		expect( missing.map( ( field ) => field.key ) ).toEqual( [
			'section',
			'editor',
		] );
	} );

	it( 'ignores an optional field that is empty', () => {
		const missing = getMissingRequiredMetadata( [ OPTIONAL ], {
			wf_meta_1_notes: '',
		} );

		expect( missing ).toEqual( [] );
	} );

	it( 'drops a field the moment it holds a value', () => {
		const missing = getMissingRequiredMetadata( [ SECTION, EDITOR ], {
			wf_meta_1_section: 'Politics',
			wf_meta_1_editor: 0,
		} );

		expect( missing.map( ( field ) => field.key ) ).toEqual( [ 'editor' ] );
	} );
} );

describe( 'projectRequiredMetadataLocks', () => {
	// jsdom declares no document language, which is the state every test here
	// starts from; the one that declares one puts it back.
	afterEach( () => {
		document.documentElement.lang = '';
	} );

	/**
	 * The defect, in one assertion: the values are in the editor, the server's
	 * payload still says they are empty, and the move has to be offered anyway.
	 */
	it( 'releases the lock once every required field holds a value', () => {
		const projected = projectRequiredMetadataLocks(
			[ heldPublishEdge( [ 'Section Name', 'Assigned editor' ] ) ],
			[]
		);

		// The whole lock goes, rule name included — nothing is left for a
		// reader to interpret as a hold.
		expect( projected[ 0 ] ).not.toHaveProperty( '_locked' );
		expect( projected[ 0 ] ).not.toHaveProperty( '_locked_reason' );
		expect( projected[ 0 ] ).not.toHaveProperty( '_locked_code' );
		expect( projected[ 0 ].to ).toBe( 'published' );
	} );

	/**
	 * And the half that is easy to forget: with two required fields, filling one
	 * has to shrink the sentence. Leaving the server's wording would keep naming
	 * a field the author has just filled in — the same staleness in prose that
	 * the lock itself was in behaviour.
	 */
	it( 'restates the reason from the fields that are still empty', () => {
		const projected = projectRequiredMetadataLocks(
			[ heldPublishEdge( [ 'Section Name', 'Assigned editor' ] ) ],
			[ EDITOR ]
		);

		expect( projected[ 0 ]._locked ).toBe( true );
		expect( projected[ 0 ]._locked_reason ).toContain( 'Assigned editor' );
		expect( projected[ 0 ]._locked_reason ).not.toContain( 'Section Name' );
	} );

	/**
	 * One sentence, one locale. `__()` resolves against the locale WordPress
	 * rendered the screen in, and `language_attributes()` writes that same
	 * locale onto `<html lang>` — so the list conjunction is taken from there
	 * too. The runtime default would resolve against `navigator.language`
	 * instead and join a Spanish sentence with an English "and", a split the
	 * server's `wp_sprintf( '%l' )` cannot have.
	 */
	it( 'joins the field list in the document locale, not the browser one', () => {
		document.documentElement.lang = 'es';

		const projected = projectRequiredMetadataLocks(
			[ heldPublishEdge( [ 'Section Name', 'Assigned editor' ] ) ],
			[ SECTION, EDITOR ]
		);

		expect( projected[ 0 ]._locked_reason ).toBe(
			'Required fields are empty: Section Name y Assigned editor'
		);
	} );

	/**
	 * And when the document declares no language at all, the runtime default is
	 * the best answer left — the sentence still gets built rather than throwing
	 * on an empty language tag.
	 */
	it( 'still names the fields when the document declares no language', () => {
		const projected = projectRequiredMetadataLocks(
			[ heldPublishEdge( [ 'Section Name' ] ) ],
			[ SECTION, EDITOR ]
		);

		expect( projected[ 0 ]._locked_reason ).toContain( 'Section Name' );
		expect( projected[ 0 ]._locked_reason ).toContain( 'Assigned editor' );
	} );

	/**
	 * The rule that keeps the server authoritative. An assignment lock is a fact
	 * about the user, not about post meta, and no amount of typing in the
	 * sidebar changes it.
	 */
	it( 'leaves a lock it does not own alone', () => {
		const projected = projectRequiredMetadataLocks(
			[ ASSIGNMENT_HELD_EDGE ],
			[]
		);

		expect( projected[ 0 ]._locked ).toBe( true );
		expect( projected[ 0 ]._locked_reason ).toBe(
			ASSIGNMENT_HELD_EDGE._locked_reason
		);
	} );

	/**
	 * It never adds one either: an author who CLEARS a filled field is still
	 * offered the move. Whether an edge is covered by the gate at all is a
	 * question about stage regions that only the sequence answers, and guessing
	 * at it here is how the projection and the gate drift apart. The click saves
	 * first, the server refuses, and that refusal re-reads the status.
	 */
	it( 'does not lock an edge the server left open', () => {
		const open = { to: 'published', label: 'Publish' };

		const projected = projectRequiredMetadataLocks(
			[ open ],
			[ SECTION, EDITOR ]
		);

		expect( projected[ 0 ] ).not.toHaveProperty( '_locked' );
	} );

	/**
	 * Nothing to re-judge means nothing to rebuild — the store's own array comes
	 * straight back, so the posts whose sequences declare no required field (the
	 * overwhelming majority) hand every consumer a stable reference.
	 */
	it( 'returns the same array when no metadata lock is present', () => {
		const transitions = [ ASSIGNMENT_HELD_EDGE ];

		expect( projectRequiredMetadataLocks( transitions, [] ) ).toBe(
			transitions
		);
	} );
} );
