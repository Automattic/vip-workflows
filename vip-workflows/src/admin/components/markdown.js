/**
 * Render markdown as React elements.
 *
 * AI-generated summaries and scraped source content both arrive as markdown, and
 * rendering either as a React child showed the reader `**bold**`, `#` headings
 * and `[text](url)` instead of the formatting they describe.
 *
 * This returns React nodes rather than an HTML string, which is the whole
 * security argument: nothing is handed to `dangerouslySetInnerHTML`, so there is
 * no injection surface to sanitize. A model — or a scraped page — that emits
 * `<script>` or `onerror=` produces those characters as visible text, because
 * React escapes every string child. That is also why this exists rather than the
 * `showdown` copy already in the tree via `@wordpress/blocks`: that is a 2018
 * release with XSS advisories, reached through a transitive dependency we do not
 * declare, and it emits HTML we would then have to sanitize.
 *
 * URLs are the one exception to "elements are inert". An `href` executes, so
 * `isSafeUrl()` gates every link and image against an explicit scheme allowlist
 * instead of relying on React's version-dependent `javascript:` handling.
 *
 * Coverage is deliberately broad — anything unsupported reaches the reader as
 * literal syntax, which is the bug this file exists to fix, so the useful
 * default is to handle more rather than to constrain the writer. What is NOT
 * handled degrades to plain text, never to dropped content.
 */

import './markdown.css';

/**
 * Schemes permitted in a link or image URL.
 *
 * Anything else — `javascript:`, `data:`, `vbscript:`, `file:` — renders as text
 * rather than as a link, so a crafted URL in model output or a scraped page
 * cannot become a clickable payload. Protocol-relative (`//host`) and
 * root-relative (`/path`) URLs are allowed: they inherit the admin's own origin.
 */
const SAFE_SCHEME = /^(?:https?:|mailto:|tel:|#|\/)/i;

/**
 * Whether a URL is safe to put in an href or src.
 *
 * @param {string} url Candidate URL.
 * @return {boolean} True when the URL may be linked.
 */
export function isSafeUrl( url ) {
	const trimmed = ( url || '' ).trim();

	if ( ! trimmed ) {
		return false;
	}

	// Control characters are stripped by browsers before scheme matching, so
	// `java\0script:` and `java\nscript:` would slip a naive test.
	// eslint-disable-next-line no-control-regex
	const normalized = trimmed.replace( /[\s\u0000-\u001f\u007f-\u009f]/g, '' );

	return SAFE_SCHEME.test( normalized );
}

// Inline constructs, ordered so longer delimiters win: `***x***` before `**x**`
// before `*x*`, and image before link so `![alt](src)` is not read as a link.
const INLINE_RULES = [
	// A linked image — `[![alt](src)](href)` — must be matched whole. Scraped
	// pages are full of them (a logo that links home), and both the link and the
	// image rule below match at an earlier or equal offset inside one: the link
	// rule captures `![alt` as its label, because a label cannot contain `]`, and
	// renders a stray `!` followed by a broken link.
	{
		kind: 'imagelink',
		re: /\[!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/,
	},
	{ kind: 'image', re: /!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/ },
	{ kind: 'link', re: /\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/ },
	{ kind: 'code', re: /`([^`\n]+)`/ },
	{ kind: 'strongem', re: /\*\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*\*/ },
	{ kind: 'strong', re: /\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/ },
	{ kind: 'strong', re: /(?<![\w_])__(?=\S)([\s\S]+?)(?<=\S)__(?![\w_])/ },
	{ kind: 'strike', re: /~~(?=\S)([\s\S]+?)(?<=\S)~~/ },
	{ kind: 'em', re: /(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])/ },
	{ kind: 'em', re: /(?<![\w_])_(?=\S)([^_\n]+?)(?<=\S)_(?![\w_])/ },
	{ kind: 'autolink', re: /<((?:https?:\/\/|mailto:)[^>\s]+)>/ },
];

/**
 * Find the inline construct to render next.
 *
 * Earliest position wins, so emphasis late in a line cannot pre-empt a link
 * earlier in it. On a tie the LONGER match wins, which is what resolves nesting:
 * `[![alt](src)](href)` has the linked-image and the plain-link rule both
 * matching at the same offset, and only the longer one is the whole construct.
 *
 * @param {string} text Source text.
 * @return {Object|null} { kind, match } or null.
 */
function firstInline( text ) {
	let best = null;

	for ( const rule of INLINE_RULES ) {
		const match = rule.re.exec( text );

		if ( ! match ) {
			continue;
		}

		if (
			! best ||
			match.index < best.match.index ||
			( match.index === best.match.index &&
				match[ 0 ].length > best.match[ 0 ].length )
		) {
			best = { kind: rule.kind, match };
		}
	}

	return best;
}

/**
 * Render inline markdown into React children.
 *
 * @param {string} text      Source text.
 * @param {string} keyPrefix Stable key prefix.
 * @return {Array} React children.
 */
function renderInline( text, keyPrefix ) {
	const out = [];
	let rest = text;
	let n = 0;

	while ( rest ) {
		const found = firstInline( rest );

		if ( ! found ) {
			out.push( rest );
			break;
		}

		const { kind, match } = found;

		if ( match.index > 0 ) {
			out.push( rest.slice( 0, match.index ) );
		}

		const key = `${ keyPrefix }-${ n++ }`;
		const body = match[ 1 ];
		const url = match[ 2 ];

		switch ( kind ) {
			case 'imagelink': {
				const href = match[ 3 ];
				const img = isSafeUrl( url ) ? (
					<img
						src={ url }
						alt={ body }
						className="vip-workflows-markdown__image"
						loading="lazy"
					/>
				) : (
					body
				);

				out.push(
					isSafeUrl( href ) ? (
						<a
							key={ key }
							href={ href }
							target="_blank"
							rel="noopener noreferrer nofollow"
						>
							{ img }
						</a>
					) : (
						<span key={ key }>{ img }</span>
					)
				);
				break;
			}

			case 'image':
				// An unsafe or missing src degrades to the alt text, which is the
				// informative part anyway.
				out.push(
					isSafeUrl( url ) ? (
						<img
							key={ key }
							src={ url }
							alt={ body }
							className="vip-workflows-markdown__image"
							loading="lazy"
						/>
					) : (
						body
					)
				);
				break;

			case 'link':
				out.push(
					isSafeUrl( url ) ? (
						<a
							key={ key }
							href={ url }
							target="_blank"
							rel="noopener noreferrer nofollow"
						>
							{ renderInline( body, key ) }
						</a>
					) : (
						// Keep the text, drop the URL: a blocked scheme is not
						// content worth showing, but the label is.
						body
					)
				);
				break;

			case 'autolink':
				out.push(
					<a
						key={ key }
						href={ body }
						target="_blank"
						rel="noopener noreferrer nofollow"
					>
						{ body }
					</a>
				);
				break;

			case 'code':
				out.push(
					<code key={ key } className="vip-workflows-markdown__code">
						{ body }
					</code>
				);
				break;

			case 'strongem':
				out.push(
					<strong key={ key }>
						<em>{ renderInline( body, key ) }</em>
					</strong>
				);
				break;

			case 'strong':
				out.push(
					<strong key={ key }>{ renderInline( body, key ) }</strong>
				);
				break;

			case 'strike':
				out.push( <s key={ key }>{ renderInline( body, key ) }</s> );
				break;

			default:
				out.push( <em key={ key }>{ renderInline( body, key ) }</em> );
		}

		rest = rest.slice( match.index + match[ 0 ].length );
	}

	return out;
}

const BULLET = /^(\s*)[-*+•]\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s{0,3}(?:```|~~~)(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/**
 * Split a table row into cells.
 *
 * @param {string} line Row source.
 * @return {string[]} Cell contents.
 */
function tableCells( line ) {
	return line
		.trim()
		.replace( /^\|/, '' )
		.replace( /\|$/, '' )
		.split( '|' )
		.map( ( cell ) => cell.trim() );
}

/**
 * Render markdown as React elements.
 *
 * @param {string} text Markdown source.
 * @return {Array|null} React nodes, or null when there is nothing to render.
 */
export function renderMarkdown( text ) {
	if ( typeof text !== 'string' || ! text.trim() ) {
		return null;
	}

	const lines = text.replace( /\r\n?/g, '\n' ).split( '\n' );
	const blocks = [];
	let i = 0;

	const key = () => `md${ blocks.length }`;

	while ( i < lines.length ) {
		const line = lines[ i ];

		// Blank lines only separate blocks; the block builders below consume
		// their own runs, so there is nothing to emit here.
		if ( ! line.trim() ) {
			i++;
			continue;
		}

		// Fenced code. Everything to the closing fence is literal, including
		// anything that would otherwise look like markdown.
		const fence = FENCE.exec( line );
		if ( fence ) {
			const language = fence[ 1 ].trim();
			const body = [];
			i++;

			while ( i < lines.length && ! FENCE.test( lines[ i ] ) ) {
				body.push( lines[ i ] );
				i++;
			}

			// Skip the closing fence when there is one; an unterminated fence just
			// ends at the end of input rather than swallowing nothing.
			i++;

			blocks.push(
				<pre
					key={ key() }
					className="vip-workflows-markdown__pre"
					data-language={ language || undefined }
				>
					<code>{ body.join( '\n' ) }</code>
				</pre>
			);
			continue;
		}

		if ( RULE.test( line ) ) {
			blocks.push(
				<hr key={ key() } className="vip-workflows-markdown__rule" />
			);
			i++;
			continue;
		}

		const heading = HEADING.exec( line );
		if ( heading ) {
			// Clamped to h4-h6: these render inside a card that owns its own
			// title, so an `h1` from the source would break the page outline.
			const level = Math.min( 6, 3 + heading[ 1 ].length );
			const Tag = `h${ level }`;

			blocks.push(
				<Tag key={ key() } className="vip-workflows-markdown__heading">
					{ renderInline( heading[ 2 ], key() ) }
				</Tag>
			);
			i++;
			continue;
		}

		// Table: a header row followed by a divider row.
		if (
			line.includes( '|' ) &&
			i + 1 < lines.length &&
			TABLE_DIVIDER.test( lines[ i + 1 ] )
		) {
			const header = tableCells( line );
			i += 2;
			const rows = [];

			while (
				i < lines.length &&
				lines[ i ].includes( '|' ) &&
				lines[ i ].trim()
			) {
				rows.push( tableCells( lines[ i ] ) );
				i++;
			}

			blocks.push(
				// wpds-allow R7 -- a horizontal scroll container for a table that can be wider than the card; <Stack> lays children out and exposes no overflow prop
				<div
					key={ key() }
					className="vip-workflows-markdown__table-scroll"
				>
					<table className="vip-workflows-markdown__table">
						<thead>
							<tr>
								{ header.map( ( cell, c ) => (
									<th key={ c }>
										{ renderInline(
											cell,
											`${ key() }-h${ c }`
										) }
									</th>
								) ) }
							</tr>
						</thead>
						<tbody>
							{ rows.map( ( row, r ) => (
								<tr key={ r }>
									{ row.map( ( cell, c ) => (
										<td key={ c }>
											{ renderInline(
												cell,
												`${ key() }-${ r }-${ c }`
											) }
										</td>
									) ) }
								</tr>
							) ) }
						</tbody>
					</table>
				</div>
			);
			continue;
		}

		// Block quote: consume the run of `>` lines and render their content as
		// markdown, so a quote can contain emphasis or a list.
		if ( QUOTE.test( line ) ) {
			const quoted = [];

			while ( i < lines.length && QUOTE.test( lines[ i ] ) ) {
				quoted.push( QUOTE.exec( lines[ i ] )[ 1 ] );
				i++;
			}

			blocks.push(
				<blockquote
					key={ key() }
					className="vip-workflows-markdown__quote"
				>
					{ renderMarkdown( quoted.join( '\n' ) ) }
				</blockquote>
			);
			continue;
		}

		// Lists. One run of markers becomes one list, and a more-indented run
		// nests inside the item above it.
		const isListLine = ( l ) => BULLET.test( l ) || ORDERED.test( l );

		if ( isListLine( line ) ) {
			const ordered = ! BULLET.test( line ) && ORDERED.test( line );
			const baseIndent = ( BULLET.exec( line ) ||
				ORDERED.exec( line ) )[ 1 ].length;
			const items = [];

			while ( i < lines.length && isListLine( lines[ i ] ) ) {
				const m =
					BULLET.exec( lines[ i ] ) || ORDERED.exec( lines[ i ] );
				const indent = m[ 1 ].length;

				if ( indent > baseIndent && items.length ) {
					// Nested: collect the whole sub-run and recurse on it.
					const nested = [];

					while ( i < lines.length && isListLine( lines[ i ] ) ) {
						const sub =
							BULLET.exec( lines[ i ] ) ||
							ORDERED.exec( lines[ i ] );

						if ( sub[ 1 ].length <= baseIndent ) {
							break;
						}

						nested.push( lines[ i ].slice( baseIndent + 1 ) );
						i++;
					}

					items[ items.length - 1 ].children = renderMarkdown(
						nested.join( '\n' )
					);
					continue;
				}

				if ( indent < baseIndent ) {
					break;
				}

				items.push( {
					text: BULLET.test( lines[ i ] ) ? m[ 2 ] : m[ 3 ],
				} );
				i++;
			}

			const Tag = ordered ? 'ol' : 'ul';

			blocks.push(
				<Tag key={ key() } className="vip-workflows-markdown__list">
					{ items.map( ( item, n ) => (
						<li key={ n }>
							{ renderInline( item.text, `${ key() }-${ n }` ) }
							{ item.children }
						</li>
					) ) }
				</Tag>
			);
			continue;
		}

		// Paragraph: everything up to a blank line or the start of another block.
		const paragraph = [];

		while ( i < lines.length && lines[ i ].trim() ) {
			const l = lines[ i ];

			if (
				paragraph.length &&
				( isListLine( l ) ||
					HEADING.test( l ) ||
					QUOTE.test( l ) ||
					RULE.test( l ) ||
					FENCE.test( l ) )
			) {
				break;
			}

			paragraph.push( l.trim() );
			i++;
		}

		blocks.push(
			// wpds-allow R7 -- one of ~10 generated block kinds; the siblings (<li>, <th>, <blockquote>, <pre>) have no component analog, so styling the paragraph from a component and the rest from the stylesheet would split one document across two type systems
			<p key={ key() } className="vip-workflows-markdown__paragraph">
				{ renderInline( paragraph.join( ' ' ), key() ) }
			</p>
		);
	}

	return blocks.length ? blocks : null;
}

/**
 * Reduce markdown to plain text.
 *
 * For places that cannot render elements — a truncated card preview, a `title`
 * attribute, a one-line label. Mirrors the PHP `Markdown::to_plain_text()` used
 * for stored values; both keep content and drop only markup, because losing a
 * sentence is worse than leaving a stray character.
 *
 * @param {string} text Markdown source.
 * @return {string} Plain text.
 */
export function markdownToPlainText( text ) {
	if ( typeof text !== 'string' || ! text.trim() ) {
		return '';
	}

	return (
		text
			.replace( /\r\n?/g, '\n' )
			// Images before links: the link rule would otherwise eat the
			// `[alt](src)` inside `![alt](src)` and leave a bare `!`.
			.replace( /!\[([^\]]+)\]\([^)]*\)/g, '$1' )
			.replace( /!\[\s*\]\([^)]*\)/g, '' )
			.replace( /\[([^\]]+)\]\([^)]*\)/g, '$1' )
			.replace( /<((?:https?:\/\/|mailto:)[^>\s]+)>/g, '$1' )
			// Fences and rules carry no text of their own.
			.replace( /^\s{0,3}(?:```|~~~).*$/gm, '' )
			.replace( /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '' )
			.replace( /^\s{0,3}>\s?/gm, '' )
			.replace( /^\s{0,3}#{1,6}\s+/gm, '' )
			.replace( /^(\s*)[*+•]\s+/gm, '$1- ' )
			.replace( /\*\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*\*/g, '$1' )
			.replace( /\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, '$1' )
			.replace( /(?<![\w_])__(?=\S)([\s\S]+?)(?<=\S)__(?![\w_])/g, '$1' )
			.replace( /~~(?=\S)([\s\S]+?)(?<=\S)~~/g, '$1' )
			.replace( /(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])/g, '$1' )
			.replace( /(?<![\w_])_(?=\S)([^_\n]+?)(?<=\S)_(?![\w_])/g, '$1' )
			.replace( /`([^`\n]+)`/g, '$1' )
			.replace( /\n{3,}/g, '\n\n' )
			.trim()
	);
}

/**
 * Formatted markdown text.
 *
 * Renders nothing for an empty value so callers keep their own empty state — an
 * unsummarized source should say so, not show a blank box.
 *
 * @param {Object} props
 * @param {string} props.text        Markdown source.
 * @param {string} [props.className] Extra class for the wrapper.
 * @return {JSX.Element|null} Rendered markdown, or null.
 */
export function MarkdownText( { text, className = '' } ) {
	const nodes = renderMarkdown( text );

	if ( ! nodes ) {
		return null;
	}

	return (
		<div className={ `vip-workflows-markdown ${ className }`.trim() }>
			{ nodes }
		</div>
	);
}
