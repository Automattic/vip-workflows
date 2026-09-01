/**
 * The required-metadata gate, re-judged against what the author has filled in.
 *
 * The gate itself is the server's: a sequence's `required` metadata fields
 * must hold a value before a post may cross into the publish region, and
 * Sequence::get_role_permitted_transitions() projects that answer onto every
 * edge it covers as `_locked` plus a reason, so no surface offers a move the
 * server is about to refuse.
 *
 * That projection is computed with get_post_meta() — from what is in the
 * DATABASE. The open block editor is the one place where that is not the whole
 * truth: the sidebar's metadata rows write through useEntityProp, which edits
 * the core-data entity record and nothing else until the post is saved. So an
 * author who fills both required fields changes nothing the server's lock was
 * derived from, the button stays disabled under "Required fields are empty:
 * Section Name and Assigned editor" with both values on screen in front of
 * them, and the only way out is a save AND a page reload — the save to persist
 * the meta, the reload to re-bootstrap a status payload computed from it.
 *
 * This module closes that gap by re-deciding the lock here, against the edited
 * record. It is deliberately allowed to do only one thing:
 *
 *   It RELAXES a lock the server placed. It never adds one.
 *
 * Which is what keeps the server authoritative. The editor may say "those
 * fields are filled now, even though you could not see it yet"; it may not say
 * "those fields are empty now" and invent a gate, because whether an edge is
 * covered by the gate at all is a question about stage regions that only
 * Sequence answers — and answering it twice is how the projection and the gate
 * it mirrors drift apart. An author who CLEARS a filled field is therefore
 * still offered the move; clicking it saves first (see WorkflowPanel), the
 * server refuses with `required_fields_missing`, and that refusal re-reads the
 * status so the lock is back for the next attempt.
 *
 * Unlocking early is safe for the same reason: a transition that depends on
 * persisted meta saves the post before it is sent, so by the time the server
 * judges the move the values it reads are the ones the author was looking at.
 *
 * @package
 */

import { useMemo } from '@wordpress/element';
import { useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { __, sprintf } from '@wordpress/i18n';

import { STORE_NAME } from './store';

/**
 * The `_locked_code` the required-metadata gate stamps on the edges it holds.
 *
 * Mirrors Sequence::CODE_REQUIRED_METADATA, which is also the error code the
 * transition endpoint refuses with — one rule, one name on both sides.
 *
 * @type {string}
 */
export const REQUIRED_METADATA_LOCK = 'required_fields_missing';

/**
 * Joins the field labels the way a list is joined in the reader's language.
 *
 * The counterpart of the `wp_sprintf( '%l' )` the server builds the same
 * sentence with — a bare ", " would leave the translated sentence with an
 * untranslated conjunction in the middle of it.
 *
 * The locale is the document's, not the browser's. The sentence around this
 * list is resolved by `__()` against the locale WordPress rendered the screen
 * in, and `language_attributes()` puts that same locale on `<html lang>`; the
 * runtime default would resolve against `navigator.language` instead and join a
 * Spanish sentence with an English "and". Empty means no locale was declared,
 * which is the one case where the runtime default is the best answer left.
 *
 * Built per call rather than once at module scope: this runs only while a move
 * is actually being held, and a constructor at import time would take the whole
 * editor entry down on an engine that ships no `Intl.ListFormat`.
 *
 * @param {Array} labels Field labels, in config order.
 * @return {string} The labels joined for the document's locale.
 */
function formatFieldList( labels ) {
	const locale = document.documentElement.lang;

	return new Intl.ListFormat( locale || undefined, {
		style: 'long',
		type: 'conjunction',
	} ).format( labels );
}

/**
 * Whether a stored metadata value counts as empty.
 *
 * The JS mirror of Sequence::metadata_value_is_empty(), which is the single
 * server-side answer to "has this field been filled in?" — shared by the
 * required-field gate in StatusManager::transition(), the `value`/`null`
 * decision in MetadataController::get_metadata(), and this. The closer the two
 * agree the better: a row this calls filled and the gate calls empty is a
 * button that unlocks into a 422.
 *
 * So the per-type test is reproduced, not approximated:
 *
 * - `user` is registered as `integer` meta, where 0 is the "no user" sentinel
 *   the picker writes when it is cleared. PHP tests `0 === (int) $value`, whose
 *   cast turns an unset key ('') and a non-numeric string into 0; `parseInt`
 *   yields NaN for both, so NaN is folded in with 0 here.
 * - `text`, `textarea`, `select` and `date` are `string` meta. Empty is the
 *   empty string, whitespace included. `'0'` is an answer, not a blank, which
 *   is why this is a trim test and not a falsiness test.
 *
 * One divergence is left standing, deliberately. PHP judges the value as
 * STORED, after the `sanitize_text_field` that class-plugin.php registers these
 * meta keys with; this judges the value as TYPED, because that is the only one
 * the editor holds. A string that survives here and sanitizes away to nothing
 * — markup and nothing else, `<b>` — is called filled here and empty there.
 * Reproducing sanitize_text_field in JS would not close that: it strips tags,
 * octets and percent-encodings and collapses whitespace, and an approximation
 * of it trades one disagreement for several. What absorbs it instead is the
 * release-only rule this module is built on: the button unlocks, the click
 * saves, the server refuses with the same gate, and the refusal re-reads the
 * status so the lock is back. One wasted round trip, no wrong state.
 *
 * @param {string} type  Field type from the sequence config.
 * @param {*}      value Stored meta value.
 * @return {boolean} True when the field has not been filled in.
 */
export function metadataValueIsEmpty( type, value ) {
	if ( 'user' === type ) {
		const userId = parseInt( value, 10 );
		return Number.isNaN( userId ) || 0 === userId;
	}

	return '' === String( value ?? '' ).trim();
}

/**
 * The sequence's required fields that are still empty, in config order.
 *
 * The JS mirror of Sequence::get_missing_required_metadata(), read against a
 * post meta object rather than the database.
 *
 * @param {Array}  fields Metadata field configs, each carrying its `meta_key`.
 * @param {Object} meta   Post meta, keyed by meta key.
 * @return {Array} The field configs that are required and empty.
 */
export function getMissingRequiredMetadata( fields, meta ) {
	return ( fields || [] ).filter(
		( field ) =>
			!! field.required &&
			metadataValueIsEmpty( field.type, meta?.[ field.meta_key ] )
	);
}

/**
 * The sentence the rail shows under a move the gate is holding.
 *
 * Rebuilt here rather than reusing the server's, because the server's names the
 * fields that were empty when the payload was built. With two required fields,
 * filling one has to shrink the list — a message that still names a field the
 * author has just filled in is the same staleness in prose that the lock itself
 * was in behaviour.
 *
 * @param {Array} missingFields Field configs that are required and empty.
 * @return {string} Translated reason naming exactly those fields.
 */
function buildLockReason( missingFields ) {
	return sprintf(
		/* translators: %s: list of metadata field labels, joined for the locale. */
		__( 'Required fields are empty: %s', 'vip-workflows' ),
		formatFieldList(
			missingFields.map( ( field ) => String( field.label ) )
		)
	);
}

/**
 * Re-decide the required-metadata locks against the fields as they stand now.
 *
 * Every other lock on a transition is passed through untouched: a role, an
 * assignment or a capability is a fact about the user or the post that only the
 * server can settle, and `_locked_code` is what tells the two apart.
 *
 * Returns the original array when there is nothing to re-judge, so a post whose
 * sequence has no required fields — the overwhelming majority — pays a single
 * `some()` and hands back the same reference the store holds.
 *
 * @param {Array} transitions   Transitions as the status endpoint served them.
 * @param {Array} missingFields Field configs that are required and still empty.
 * @return {Array} Transitions with the metadata locks re-judged.
 */
export function projectRequiredMetadataLocks( transitions, missingFields ) {
	const held = transitions.some(
		( transition ) => REQUIRED_METADATA_LOCK === transition._locked_code
	);

	if ( ! held ) {
		return transitions;
	}

	const reason = missingFields.length
		? buildLockReason( missingFields )
		: null;

	return transitions.map( ( transition ) => {
		if ( REQUIRED_METADATA_LOCK !== transition._locked_code ) {
			return transition;
		}

		if ( reason ) {
			return { ...transition, _locked_reason: reason };
		}

		// Nothing is missing any more: the lock is not softened, it is gone.
		// The whole of it goes, `_locked_code` included, so a reader of this
		// list cannot find a rule name on an edge that is not being held.
		const released = { ...transition };
		delete released._locked;
		delete released._locked_reason;
		delete released._locked_code;
		return released;
	} );
}

/**
 * The gate as the editor sees it, for the two surfaces that have to agree.
 *
 * WorkflowPanel needs the transitions with their metadata locks re-judged;
 * MetadataPanel needs to know which of its rows are the reason a move is being
 * held, so it can mark them the way an unfilled required form field is marked.
 * One hook answers both, because a rail that offers the move while the fields
 * below it still read as blocking (or the reverse) is the same bug wearing
 * different clothes.
 *
 * @return {{transitions: Array, missingFields: Array, blockingFieldKeys: Array}}
 *   `transitions` — the store's list, metadata locks re-judged.
 *   `missingFields` — required fields still empty, in config order.
 *   `blockingFieldKeys` — the meta keys of those fields, but only while a move
 *   is actually being held for them. Empty at a stage with no publish crossing
 *   to offer: the fields are still unfilled, but nothing is waiting on them,
 *   and an error state with no blocked action behind it is just nagging.
 */
export function useRequiredMetadataGate() {
	const { metadataFields, meta, storedTransitions } = useSelect(
		( select ) => {
			const workflow = select( STORE_NAME );

			return {
				metadataFields: workflow.getMetadataFields(),
				storedTransitions: workflow.getWorkflowStatus()?.transitions,
				// The post's meta as it stands in the editor: the saved
				// values with the unsaved edits merged over them. Exactly
				// what MetadataPanel reads and writes through useEntityProp
				// — `meta` is one of core's merge properties, so both resolve
				// to the same object — so the rows and the gate can never be
				// looking at two different sets of values.
				meta: select( editorStore ).getEditedPostAttribute( 'meta' ),
			};
		},
		[]
	);

	return useMemo( () => {
		const transitions = storedTransitions || [];
		const missingFields = getMissingRequiredMetadata(
			metadataFields,
			meta
		);

		const held =
			missingFields.length > 0 &&
			transitions.some(
				( transition ) =>
					REQUIRED_METADATA_LOCK === transition._locked_code
			);

		return {
			transitions: projectRequiredMetadataLocks(
				transitions,
				missingFields
			),
			missingFields,
			blockingFieldKeys: held
				? missingFields.map( ( field ) => field.meta_key )
				: [],
		};
	}, [ metadataFields, meta, storedTransitions ] );
}
