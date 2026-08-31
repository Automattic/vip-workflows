/**
 * WPDS ↔ wp-admin cascade-layer conflict detector.
 *
 * Finds elements where a `@wordpress/ui` component's styles (which live in
 * `@layer wp-ui-components`) are being overridden by wp-admin's UNLAYERED
 * `common.css`/`forms.css`/etc. — i.e. the exact situation that needs a
 * parent-level reset (see docs/guides/wpds-usage-audit-patterns.md →
 * "wp-admin ↔ WPDS cascade-layer conflicts").
 *
 * Why runtime, not a CSS lint: the conflict is a cross-stylesheet cascade
 * interaction that only exists against real DOM (which element a component
 * rendered as, which mount root it lives under, with wp-admin CSS loaded).
 * A linter can't see it; the browser can.
 *
 * Detection logic (per element, per style category):
 *   flag  ⇔  a rule in `@layer wp-ui-*` sets the property   (element is DS-styled)
 *        AND an UNLAYERED wp-admin-core rule sets it         (would clobber it)
 *        AND no UNLAYERED rule from our own CSS sets it      (reset not reaching here)
 *
 * The first clause keys off runtime truth, so non-DS elements (e.g. a bare
 * `.description`) are never flagged. The last clause is what surfaces the gap
 * on surfaces our canvas reset doesn't reach (modals, the slideout portal).
 *
 * Caveat: co-existence is a guaranteed conflict for *normal* declarations
 * (unlayered always beats layered). `!important` flips that and is NOT modelled
 * — `@wordpress/ui` doesn't use it and wp-admin rarely does, so v1 ignores it.
 */

// Property names, grouped by the category a reset would defer. Shorthands are
// listed alongside longhands so a rule is caught however it was authored.
const CATEGORIES = {
	typography: [
		'font',
		'font-family',
		'font-size',
		'font-weight',
		'font-style',
		'line-height',
		'text-transform',
	],
	margin: [
		'margin',
		'margin-top',
		'margin-right',
		'margin-bottom',
		'margin-left',
		'margin-block',
		'margin-block-start',
		'margin-block-end',
		'margin-inline',
		'margin-inline-start',
		'margin-inline-end',
	],
};

// The flow tags wp-admin styles by bare selector, i.e. the ones a DS component
// rendered as can collide on. Extend as new collisions surface.
const TARGET_TAGS = 'p,h1,h2,h3,h4,h5,h6,a,li,dt,dd';

/**
 * Run the audit against the current page DOM.
 *
 * @param {import('@playwright/test').Page} page                  Playwright page.
 * @param {Object}                          [opts]
 * @param {string}                          [opts.rootSelector]   Restrict the scan
 *                                                                to a subtree (e.g. '.vip-ai-slideout-panel' for the slideout portal).
 * @param {string}                          [opts.targetSelector] Override the
 *                                                                flow-tag selector.
 * @return {Promise<Array>} Findings: { tag, cls, text, path, categories:[...] }.
 */
async function auditCascade( page, opts = {} ) {
	const targetSelector = opts.targetSelector || TARGET_TAGS;
	const rootSelector = opts.rootSelector || null;

	return page.evaluate(
		( { categories, targetSelector: sel, rootSelector: root } ) => {
			const TYPO = new Set( categories.typography );
			const MARGIN = new Set( categories.margin );

			// Classify an author style rule by where it sits in the cascade.
			// Returns 'ds' | 'wpadmin' | 'ours' | null (null = irrelevant here).
			const classify = ( layer, href ) => {
				if ( /wp-ui/.test( layer ) ) {
					return 'ds';
				}
				if ( layer ) {
					return null; // layered but not DS — never a clobber source
				}
				if (
					/\/wp-(admin|includes)\/(css\/|load-styles)|load-styles\.php/.test(
						href
					)
				) {
					return 'wpadmin';
				}
				if ( /vip-workflows\//.test( href ) ) {
					return 'ours';
				}
				return null; // other unlayered author CSS (theme, other plugins)
			};

			// Flatten every relevant author rule into a compact match list.
			// Only rules that touch a typography/margin property are kept.
			const rules = [];
			const walk = ( ruleList, layer, href ) => {
				for ( const r of ruleList ) {
					if (
						typeof window.CSSLayerBlockRule !== 'undefined' &&
						r instanceof window.CSSLayerBlockRule
					) {
						const name = [ layer, r.name ]
							.filter( Boolean )
							.join( '.' );
						walk( r.cssRules, name, href );
					} else if ( r.cssRules && ! r.selectorText ) {
						// @media / @supports / @container — keep the layer, descend.
						walk( r.cssRules, layer, href );
					} else if ( r.selectorText && r.style ) {
						let typo = false;
						let margin = false;
						for ( const prop of r.style ) {
							if ( TYPO.has( prop ) ) {
								typo = true;
							}
							if ( MARGIN.has( prop ) ) {
								margin = true;
							}
						}
						if ( ! typo && ! margin ) {
							continue;
						}
						const cls = classify( layer, href );
						if ( ! cls ) {
							continue;
						}
						rules.push( {
							sel: r.selectorText,
							cls,
							typo,
							margin,
						} );
					}
				}
			};

			for ( const sheet of document.styleSheets ) {
				let href = '';
				try {
					href = sheet.href || '';
				} catch ( e ) {
					href = '';
				}
				let cssRules;
				try {
					cssRules = sheet.cssRules;
				} catch ( e ) {
					continue; // cross-origin sheet — not one of ours anyway
				}
				walk( cssRules, '', href );
			}

			// Build a short, human-locatable CSS path for a finding.
			const cssPath = ( el ) => {
				const parts = [];
				let node = el;
				let depth = 0;
				while ( node && node.nodeType === 1 && depth < 5 ) {
					let s = node.tagName.toLowerCase();
					if ( node.id ) {
						parts.unshift( s + '#' + node.id );
						break;
					}
					const first = ( node.getAttribute( 'class' ) || '' )
						.trim()
						.split( /\s+/ )
						.filter( Boolean )[ 0 ];
					if ( first ) {
						s += '.' + first;
					}
					let i = 1;
					let sib = node;
					while ( ( sib = sib.previousElementSibling ) ) {
						if ( sib.tagName === node.tagName ) {
							i++;
						}
					}
					parts.unshift( s + ':nth-of-type(' + i + ')' );
					node = node.parentElement;
					depth++;
				}
				return parts.join( ' > ' );
			};

			const scope = root ? document.querySelector( root ) : document;
			if ( ! scope ) {
				return [];
			}

			const out = [];
			for ( const el of scope.querySelectorAll( sel ) ) {
				const ds = { typo: false, margin: false };
				const wp = {
					typo: false,
					margin: false,
					typoSel: null,
					marginSel: null,
				};
				const ours = { typo: false, margin: false };

				for ( const rule of rules ) {
					let matches = false;
					try {
						matches = el.matches( rule.sel );
					} catch ( e ) {
						continue; // selector unsupported by .matches() — skip
					}
					if ( ! matches ) {
						continue;
					}
					let bucket = null;
					if ( rule.cls === 'ds' ) {
						bucket = ds;
					} else if ( rule.cls === 'wpadmin' ) {
						bucket = wp;
					} else if ( rule.cls === 'ours' ) {
						bucket = ours;
					}
					if ( ! bucket ) {
						continue;
					}
					if ( rule.typo ) {
						bucket.typo = true;
						if ( rule.cls === 'wpadmin' ) {
							wp.typoSel = rule.sel;
						}
					}
					if ( rule.margin ) {
						bucket.margin = true;
						if ( rule.cls === 'wpadmin' ) {
							wp.marginSel = rule.sel;
						}
					}
				}

				const cats = [];
				if ( ds.typo && wp.typo && ! ours.typo ) {
					cats.push( {
						category: 'typography',
						losesTo: wp.typoSel,
					} );
				}
				if ( ds.margin && wp.margin && ! ours.margin ) {
					cats.push( { category: 'margin', losesTo: wp.marginSel } );
				}
				if ( cats.length ) {
					out.push( {
						tag: el.tagName.toLowerCase(),
						cls: el.getAttribute( 'class' ) || '',
						text: ( el.textContent || '' ).trim().slice( 0, 50 ),
						path: cssPath( el ),
						categories: cats,
					} );
				}
			}
			return out;
		},
		{ categories: CATEGORIES, targetSelector, rootSelector }
	);
}

/**
 * Render a findings array as a readable console block.
 *
 * @param {string} label    Screen/surface name.
 * @param {Array}  findings Output of auditCascade.
 * @param {number} [max]    Cap the per-surface detail lines.
 * @return {string} A multi-line, human-readable report block.
 */
function formatReport( label, findings, max = 40 ) {
	const header = `\n=== WPDS↔wp-admin cascade audit — ${ label } ===`;
	if ( ! findings.length ) {
		return `${ header }\n  ✓ clean — every DS element is covered.`;
	}
	const lines = findings.slice( 0, max ).map( ( f ) => {
		const cats = f.categories
			.map( ( c ) => `${ c.category } ← lost to \`${ c.losesTo }\`` )
			.join( '; ' );
		const text = f.text ? `  "${ f.text }"` : '';
		return `  • <${ f.tag }>${ text }\n      ${ cats }\n      at ${ f.path }`;
	} );
	const more =
		findings.length > max
			? `\n  … and ${ findings.length - max } more (see JSON artifact).`
			: '';
	return `${ header }\n  ${
		findings.length
	} element(s) need a reset:\n${ lines.join( '\n' ) }${ more }`;
}

module.exports = { auditCascade, formatReport, CATEGORIES, TARGET_TAGS };
