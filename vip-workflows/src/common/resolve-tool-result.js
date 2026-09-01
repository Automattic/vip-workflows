/**
 * What a tool returned, as the ability declares it.
 *
 * The result modals used to work this out by probing output keys in priority
 * order — `output.excerpt || result.summary || output.content` — so nothing told
 * them what an ability had actually produced. Every new result shape either
 * matched no key and rendered nothing, or matched the wrong key and rendered, or
 * applied, the wrong thing.
 *
 * Three shipped bugs came from that: a successful run returning four links
 * rendered an empty modal; a `WP_Error` carrying array data was read as a
 * success; and the primary footer button set a post title to "5 suggested
 * headlines" because a list's summary was the first key that matched.
 *
 * `apply_field` is the counter-example and the model for this. It is the one
 * thing the modal never guessed — an ability names the field it writes to — and
 * it is the one thing that never broke. So an ability now also names what it
 * returns, via `result_type` in its meta, and this resolves the raw result
 * against that declaration.
 *
 * Inference is retained for any ability that declares nothing, so every tool
 * written before this contract behaves exactly as it did.
 *
 * @package
 */

/**
 * The declared result types.
 *
 * `value`  one value that replaces a field — a generated excerpt.
 * `list`   several options chosen from, per row — headline suggestions.
 * `report` a verdict with findings — a check's pass/warning/fail and issues.
 */
const KINDS = [ 'value', 'list', 'report' ];

/**
 * Normalize one list row.
 *
 * Three shapes are accepted because three already exist in the wild: a plain
 * string, an object carrying `message`, and a fully described row. Normalizing
 * here means each renderer handles one shape rather than three.
 *
 * @param {*} row A raw row from `output.suggestions`.
 * @return {?Object} The normalized row, or null when it carries no text.
 */
function normalizeRow( row ) {
	/*
	 * `applicable` is carried per row rather than derived later, because only a
	 * bare value can be written into a field. A plain string *is* the value — an
	 * alternative headline. A described row points somewhere instead: a suggested
	 * link's label is anchor text and its destination is a URL, so there is
	 * nothing a field could be set to. Losing this distinction would offer to set
	 * a post title to a link's anchor text.
	 */
	if ( typeof row === 'string' ) {
		const label = row.trim();
		return label ? { label, meta: '', href: '', applicable: true } : null;
	}

	if ( ! row || typeof row !== 'object' ) {
		return null;
	}

	const label = ( row.label || row.message || '' ).trim();

	if ( ! label ) {
		return null;
	}

	return {
		label,
		meta: row.meta || '',
		href: row.href || '',
		applicable: false,
	};
}

/**
 * Rows from an output, in normalized form.
 *
 * @param {Object} output The ability's output.
 * @return {Array} Normalized rows, possibly empty.
 */
function rowsFrom( output ) {
	if ( ! Array.isArray( output.suggestions ) ) {
		return [];
	}

	return output.suggestions.map( normalizeRow ).filter( Boolean );
}

/**
 * Resolve a tool result into something a renderer can switch on.
 *
 * @param {Object}  args            Arguments.
 * @param {?Object} args.result     The stored ability result.
 * @param {?string} args.resultType The ability's declared `result_type`.
 * @return {Object} { kind, summary, value, items, verdict, error }
 */
export function resolveToolResult( { result, resultType } = {} ) {
	const safeResult = result || {};
	const output = safeResult.output || {};
	const summary = safeResult.summary || '';
	const error = safeResult.error;

	const resolved = {
		kind: 'empty',
		summary,
		value: '',
		items: [],
		verdict: null,
		error,
	};

	/*
	 * An error has no result to render, and certainly none to apply. Returning
	 * early also means a stale output left beside an error cannot be offered as
	 * though the run had succeeded.
	 */
	if ( error ) {
		return resolved;
	}

	const declared = KINDS.includes( resultType ) ? resultType : null;

	if ( 'value' === declared ) {
		return {
			...resolved,
			kind: 'value',
			// Deliberately not falling back to `summary`: a summary describes a
			// result, and applying a description to a field is the bug this
			// contract exists to prevent.
			value: output.excerpt || output.content || '',
		};
	}

	if ( 'list' === declared ) {
		return {
			...resolved,
			kind: 'list',
			items: rowsFrom( output ),
		};
	}

	if ( 'report' === declared ) {
		return {
			...resolved,
			kind: 'report',
			// Null rather than a default: an ability that omits a status has not
			// reported a failure, and rendering one as "Fail" invents a verdict.
			verdict: {
				status: output.status || null,
				score: 'number' === typeof output.score ? output.score : null,
				issues: Array.isArray( output.issues ) ? output.issues : [],
			},
			items: rowsFrom( output ),
		};
	}

	/*
	 * Undeclared: reproduce the previous behaviour exactly, including the summary
	 * fallback. Every ability written before this contract relies on it, and
	 * changing it here would alter each of them at once with nothing declaring
	 * what they meant.
	 */
	const items = rowsFrom( output );

	if ( items.length > 0 ) {
		return { ...resolved, kind: 'list', items };
	}

	const inferredValue = output.excerpt || summary || output.content || '';

	return {
		...resolved,
		kind: inferredValue ? 'value' : 'empty',
		value: inferredValue,
	};
}
