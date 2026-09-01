/**
 * css-hygiene.mjs — WPDS-usage / CSS-hygiene analyzer for VIP Workflows.
 *
 * Correlates the two sides no single linter can see at once: the JSX that binds
 * a class to a component, and the CSS that styles that class. Detects dead CSS,
 * design-system overrides, and the hand-rolled-styling patterns that mean a
 * WPDS component (Stack/Text/…) was skipped.
 *
 * Called by quality.mjs; not a standalone CLI. Pure analysis — never edits.
 *
 * Rules (severity): R0 blanket-suppression BLOCK · R1 dead-class BLOCK ·
 * everything else FLAG (advisory, ranked):
 *   R2 hardcoded token-backed value   R3 any margin
 *   R4 layout prop in CSS (→ Stack)   R5 raw type styling (→ Text/type tokens)
 *   R6 override on a system component  R7 raw element w/ WPDS analog
 *   R8 <Text>/<Heading> typed via CSS (→ style prop)
 *
 * Suppression: `wpds-allow <ids> -- <reason>` on the offending line or the line
 * above. Rule id(s) + reason mandatory; anything looser is R0, not a mute.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const require = createRequire(import.meta.url);

// ── rule catalog ────────────────────────────────────────────────────────────
// title = the one-time fix guidance (shown once per group header). Per-finding
// lines carry only what varies (file:line + the offending code), so the
// guidance is never repeated across hundreds of lines.
export const RULES = {
	R0: { block: true, title: 'blanket/whole-file suppression — replace with inline `wpds-allow <ruleId> -- <reason>`' },
	R1: { block: true, title: 'dead CSS class — delete the rule (referenced in no JS/JSX/PHP)' },
	R2: { block: false, title: 'hardcoded value — replace with the matching --wpds-* token' },
	R3: { block: false, title: 'margin — move spacing to the parent Stack/HStack gap prop' },
	R4: { block: false, title: 'layout in CSS — use a <Stack>/<HStack> and its gap prop' },
	R5: { block: false, title: 'raw type styling — use <Text>, or a --wpds type token if <Text> cannot be used' },
	R6: { block: false, title: 'overrides a WPDS/library component — restyle via its props/tokens, not CSS' },
	R7: { block: false, title: 'raw element — use its WPDS analog: <p>/<h*>→<Text>/<Heading>, styled <div>/<span>→<Stack>/<Text>' },
	R8: { block: false, title: '<Text>/<Heading> typed in CSS — use its style/size prop instead' },
};

// ── property groups ──────────────────────────────────────────────────────────
// R2: token-backed props whose literal values duplicate a --wpds-* token.
// margin (R3) and the type props (R5) are handled by their own rules, so they
// are intentionally NOT here — one finding per declaration.
const COLOR_PROPS = new Set([
	'color', 'background', 'background-color', 'border-color', 'border-top-color',
	'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color',
	'fill', 'stroke', 'box-shadow', 'text-decoration-color', 'caret-color', 'accent-color',
]);
const SPACING_PROPS = new Set([
	'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
	'padding-block', 'padding-inline', 'inset', 'top', 'right', 'bottom', 'left',
]);
const RADIUS_PROPS = new Set([
	'border-radius', 'border-top-left-radius', 'border-top-right-radius',
	'border-bottom-left-radius', 'border-bottom-right-radius',
]);
const TYPE_PROPS = new Set([
	'font', 'font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing',
]);
const LAYOUT_GAP_PROPS = new Set(['gap', 'row-gap', 'column-gap']);
const LAYOUT_FLEX_PROPS = new Set([
	'flex-direction', 'align-items', 'justify-content', 'align-content',
	'justify-items', 'flex-wrap', 'place-items', 'place-content',
]);
// R6 flags only APPEARANCE overrides on a bound component — color / border /
// radius / shadow / type / effects. Layout & box-model props (padding, margin,
// flex-*, min/max size, position, overflow, gap…) are intentionally excluded:
// on a layout primitive like <Stack> — which exposes no padding or per-child
// sizing prop — a styling-hook class carrying them is the *intended* usage, not
// an override, so flagging them just manufactures suppressions.
const APPEARANCE_PROPS = new Set([
	...COLOR_PROPS, ...RADIUS_PROPS, ...TYPE_PROPS,
	'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
	'border-width', 'border-top-width', 'border-right-width', 'border-bottom-width',
	'border-left-width', 'border-style', 'background-image', 'text-transform',
	'text-decoration', 'opacity', 'text-shadow', 'filter', 'backdrop-filter',
]);

// Raw elements that (almost) always have a design-system home.
const ALWAYS_RAW = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']); // → Text / Heading
const STYLED_RAW = new Set(['div', 'span']); // → Stack / Text, but only when styled

// Project-authored CSS namespaces. R1 (dead-class, BLOCKING) only judges these —
// classes we own and could orphan. Bare/utility names are too ambiguous to call
// dead, so they're left alone.
const PROJECT_PREFIXES = ['vip-workflows-', 'wf-'];
const isProject = (cls) => PROJECT_PREFIXES.some((p) => cls.startsWith(p));

// Third-party / design-system-internal class namespaces. We never author these,
// so "dead" is meaningless — but CSS that TARGETS them is reaching into a
// component's internals (an R6 override), which we do want surfaced.
const FRAMEWORK_PREFIXES = [
	'components-', 'react-flow', 'rbc-', 'wp-', 'dashicon', 'block-editor-',
	'editor-', 'interface-', 'edit-post-', 'edit-site-', 'dataviews-',
];
const isFramework = (cls) => FRAMEWORK_PREFIXES.some((p) => cls.startsWith(p));

// ── small fs walker ──────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', 'build', 'vendor', 'dist', '.git', '_tmp']);
function walk(dir, exts, acc) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return acc;
	}
	for (const e of entries) {
		const full = join(dir, e.name);
		if (e.isDirectory()) {
			if (!SKIP_DIRS.has(e.name)) walk(full, exts, acc);
		} else if (exts.has(extname(e.name).toLowerCase())) {
			acc.push(full);
		}
	}
	return acc;
}

// Line number (1-based) for a character offset.
function lineOf(text, index) {
	let line = 1;
	for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
	return line;
}

// ── suppression parsing ──────────────────────────────────────────────────────
// Strict grammar: `wpds-allow R2,R3 -- reason`. Anything looser → R0.
const STRICT = /wpds-allow\s+(R\d+(?:\s*,\s*R\d+)*)\s*--\s*(\S.*?)(?:\*\/|-->|\}|$)/;
const ANY_ALLOW = /wpds-allow(?:-file)?\b|wpds-disable\b/;

/**
 * Scan one file's raw text for suppression directives.
 * @returns {{ byLine: Map<number,Set<string>>, directives: Array, blanket: Array }}
 *   byLine: line -> set of honored rule ids · directives: honored (for audit) ·
 *   blanket: R0 offences (bad grammar / whole-file / missing reason).
 */
function scanSuppressions(text, relPath) {
	const byLine = new Map();
	const directives = [];
	const blanket = [];
	const lines = text.split('\n');
	lines.forEach((raw, i) => {
		if (!ANY_ALLOW.test(raw)) return;
		const line = i + 1;
		const m = raw.match(STRICT);
		if (m) {
			const ids = m[1].split(',').map((s) => s.trim());
			const reason = m[2].trim();
			byLine.set(line, new Set(ids));
			directives.push({ file: relPath, line, rules: ids, reason });
		} else {
			// Mentions our keyword but not the strict per-rule+reason form.
			blanket.push({ rule: 'R0', file: relPath, line, message: raw.trim().slice(0, 60) });
		}
	});
	return { byLine, directives, blanket };
}

// A finding at `line` for `rule` is muted by a directive on that line or the one
// above (the natural spots for a leading or trailing comment).
function isSuppressed(byLine, line, rule) {
	for (const L of [line, line - 1]) {
		const s = byLine.get(L);
		if (s && s.has(rule)) return true;
	}
	return false;
}

// ── JSX scanning (pragmatic regex, no AST dep) ───────────────────────────────
const WPDS_SOURCES = /@wordpress\/(components|ui)/;

/** Local identifiers imported from @wordpress/components|ui, plus Text-likes. */
function wpdsImports(text) {
	const local = new Set();
	const textLike = new Set();
	const re = /import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
	let m;
	while ((m = re.exec(text))) {
		if (!WPDS_SOURCES.test(m[3])) continue;
		for (const spec of m[2].split(',')) {
			const parts = spec.trim().split(/\s+as\s+/);
			const orig = parts[0].trim();
			const localName = (parts[1] || parts[0]).trim();
			if (!localName) continue;
			local.add(localName);
			if (orig === 'Text' || orig === 'Heading') textLike.add(localName);
		}
	}
	return { local, textLike };
}

const CLASS_TOKEN = /[a-z_][\w-]*/i;
function classTokens(str) {
	return str.split(/\s+/).map((t) => t.trim()).filter((t) => t && CLASS_TOKEN.test(t) && /-/.test(t));
}

/**
 * Extract, per JS/JSX file: referenced class tokens (for dead-CSS), dynamic
 * class stems, class→component bindings (for R6/R8), and raw-element sites (R7).
 */
function scanJsx(text, relPath) {
	const { local, textLike } = wpdsImports(text);
	const referenced = new Set();
	const stems = new Set();
	const bindings = []; // { cls, isWpds, isText, file, line }
	const rawEls = []; // { tag, classes, file, line }

	// Referenced classes: EVERY class-like token in the raw source. A JS/PHP
	// identifier can't contain a hyphen, so a hyphenated class name can only ever
	// appear inside a string/JSX — scanning raw tokens (rather than parsing
	// strings, which desyncs on stray apostrophes) over-collects harmlessly and
	// guarantees R1 never false-flags a live class as dead.
	for (const t of text.match(/[A-Za-z_][\w-]*/g) || []) referenced.add(t);
	// Dynamic class stems: `vip-workflows-foo-${x}` → keep the literal prefix, so
	// every `.vip-workflows-foo-*` rule counts as referenced.
	for (const mm of text.matchAll(/([A-Za-z_][\w-]*)\$\{/g)) {
		if (/-/.test(mm[1])) stems.add(mm[1]);
	}

	// JSX tag openings: capture the tag name and its attribute span up to the
	// (naive) end of the opening tag, then pull className off that span.
	const tagRe = /<([A-Za-z][\w.]*)((?:[^>{}]|\{[^{}]*\})*?)\/?>/g;
	let tm;
	while ((tm = tagRe.exec(text))) {
		const tag = tm[1];
		const attrs = tm[2] || '';
		const line = lineOf(text, tm.index);
		const cm = attrs.match(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/);
		const classes = [];
		if (cm) {
			const literal = cm[1] ?? cm[2] ?? cm[3] ?? '';
			for (const t of classTokens(literal.replace(/\$\{[^}]*\}/g, ' ').replace(/['"`]/g, ' ')))
				classes.push(t);
		}

		if (/^[A-Z]/.test(tag)) {
			// Compound components are used as member expressions — `<Tabs.Root>`,
			// `<Card.Content>` — but only the root identifier (`Tabs`, `Card`) is
			// what the import bound. Resolve on that root, or every part of a
			// compound component reads as unbound: its layout CSS would be an R4
			// "use a <Stack>" and its appearance CSS would escape R6 entirely.
			const root = tag.split('.')[0];
			const isWpds = local.has(root);
			const isText = textLike.has(root);
			if (isWpds || isText) for (const c of classes) bindings.push({ cls: c, tag, isWpds, isText, file: relPath, line });
		} else {
			const lower = tag.toLowerCase();
			if (ALWAYS_RAW.has(lower) || (STYLED_RAW.has(lower) && classes.length))
				rawEls.push({ tag: lower, classes, file: relPath, line });
		}
	}
	return { referenced, stems, bindings, rawEls };
}

/** PHP/HTML: harvest every class-like token from the raw text (see scanJsx). */
function scanRefsOnly(text) {
	return new Set(text.match(/[A-Za-z_][\w-]*/g) || []);
}

// ── value classification (R2 / R5) ───────────────────────────────────────────
const KEYWORD = /^(inherit|initial|unset|revert|revert-layer|none|auto|transparent|currentcolor|normal|unset)$/i;
function usesToken(value) {
	return /var\(\s*--/.test(value);
}
function isLiteralColor(v) {
	return /#[0-9a-f]{3,8}\b/i.test(v) || /\b(rgb|rgba|hsl|hsla)\(/i.test(v);
}
function isLiteralLength(v) {
	return /(^|\s|,)-?\d*\.?\d+(px|rem|em|%|vh|vw|vmin|vmax|pt|ch)\b/.test(v) || /(^|\s)-?\d+(\s|$)/.test(v);
}
/** R2: a token-backed prop carrying a raw literal instead of a --wpds-* token. */
function isHardcodedTokenValue(prop, value) {
	if (usesToken(value) || KEYWORD.test(value.trim())) return false;
	if (COLOR_PROPS.has(prop)) return isLiteralColor(value);
	if (SPACING_PROPS.has(prop) || RADIUS_PROPS.has(prop)) return isLiteralLength(value);
	return false;
}

// ── selector anatomy (R6/R8 attribution) ─────────────────────────────────────
const CLASS_IN_SELECTOR = /\.(-?[_a-zA-Z][\w-]*)/g;
/** Every class name a selector — or one compound of one — mentions. */
const classesOf = (selector) => [...selector.matchAll(CLASS_IN_SELECTOR)].map((m) => m[1]);

/**
 * Split one selector into its compounds, in source order.
 *
 * Scanned rather than regex-split so a combinator living inside `:not(.a .b)`
 * or `[title="a > b"]` is not mistaken for the selector's own structure.
 *
 * Quoted runs are skipped over rather than counted, because a bracket inside a
 * string is not structure: `[title="a(b"]` would otherwise leave the depth
 * counter stuck open and swallow every combinator after it, and `[x="]"]` would
 * drive it negative so it never reads as closed again. Either way the selector
 * collapses to one compound and the finding names the wrong element — the exact
 * mis-attribution resolveBindings() exists to prevent.
 *
 * @param {string} selector One selector (comma lists already split by postcss).
 * @return {string[]} `.card > .body svg` → ['.card', '.body', 'svg'].
 */
function compoundsOf(selector) {
	const parts = [];
	let current = '';
	let depth = 0;
	let quote = null;
	for (const ch of selector) {
		if (quote) {
			// Inside a string: only its own closing quote is structural. CSS
			// escapes are `\`-prefixed, and a `\` before the quote is handled by
			// the escape branch below never running here — a quoted `\"` keeps
			// the run open because the backslash is copied and the quote that
			// follows is compared against the opener it does not end.
			if (ch === quote && !current.endsWith('\\')) quote = null;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
		} else if (ch === '(' || ch === '[') depth++;
		else if (ch === ')' || ch === ']') depth--;
		else if (depth === 0 && (ch === '>' || ch === '+' || ch === '~' || /\s/.test(ch))) {
			if (current) parts.push(current);
			current = '';
			continue;
		}
		current += ch;
	}
	if (current) parts.push(current);
	return parts;
}

/**
 * Which component a rule's declarations actually land on.
 *
 * A bound class only makes a declaration land on its component when the class
 * sits on the selector's SUBJECT — the last compound, the element the
 * declarations style. `.wf-card.is-open { border }` overrides the component the
 * class is on; `.wf-card svg { fill }` paints an <svg> that component renders.
 * Both are CSS reaching into a design-system component, so both stay findings —
 * but naming the component for the second sends the reader hunting for a border
 * on the card. An ancestor-only match therefore carries the subject along, and
 * the finding names that instead.
 *
 * @param {string[]}            selectors One rule's selectors.
 * @param {Map<string, Array>}  bindings  class → JSX bindings (see scanJsx).
 * @return {{ wpds: ?object, text: ?object }} The binding to report per kind,
 *   with `target` set to the subject when it was matched through an ancestor.
 */
function resolveBindings(selectors, bindings) {
	const found = { wpds: null, text: null };
	const boundIn = (compound) => classesOf(compound).flatMap((c) => bindings.get(c) || []);
	for (const selector of selectors) {
		const parts = compoundsOf(selector);
		if (!parts.length) continue;
		const subject = parts[parts.length - 1];
		const onSubject = boundIn(subject);
		const onAncestors = parts.slice(0, -1).flatMap(boundIn);
		for (const [kind, flag] of [['wpds', 'isWpds'], ['text', 'isText']]) {
			const direct = onSubject.find((b) => b[flag]);
			if (direct) {
				// The subject is the declaration's own element, so it outranks an
				// ancestor match taken from an earlier selector in the list.
				if (!found[kind] || found[kind].target) found[kind] = { ...direct, target: null };
			} else if (!found[kind]) {
				const ancestor = onAncestors.find((b) => b[flag]);
				if (ancestor) found[kind] = { ...ancestor, target: subject };
			}
		}
	}
	return found;
}

/** How a finding names what a declaration landed on: `<Card>`, or `<Card> svg`. */
const nameTarget = (b) => (b.target ? `<${b.tag}> ${b.target}` : `<${b.tag}>`);

// ── main analysis ────────────────────────────────────────────────────────────
/**
 * @param opts { root, plugins, mode:'all'|'list', files:string[] (repo-rel) }
 * @returns { blocking:boolean, findings:Array, directives:Array }
 */
export function runCssHygiene({ root, plugins, mode, files }) {
	const postcss = require(join(root, plugins[0], 'node_modules', 'postcss'));
	const rel = (abs) => relative(root, abs).split('\\').join('/');
	const inScope = mode === 'all' ? null : new Set((files || []).map((f) => f.split('\\').join('/')));

	// Discover files across every managed plugin.
	const cssFiles = [];
	const jsFiles = [];
	const refFiles = []; // php/html — reference index only
	for (const p of plugins) {
		const base = join(root, p);
		if (!existsSync(base)) continue;
		walk(base, new Set(['.css', '.scss']), cssFiles);
		walk(join(base, 'src'), new Set(['.js', '.jsx', '.ts', '.tsx']), jsFiles);
		walk(base, new Set(['.php']), refFiles);
	}

	// ── build global JSX/reference indexes (always whole-repo) ────────────────
	const referenced = new Set();
	const stems = new Set();
	const bindings = new Map(); // cls -> [{isWpds,isText,file,line}]
	const rawEls = [];
	const suppByFile = new Map(); // relFile -> { byLine, directives, blanket }
	const findings = [];

	const supp = (absOrRel, text) => {
		const r = typeof absOrRel === 'string' && absOrRel.startsWith('/') ? rel(absOrRel) : absOrRel;
		if (!suppByFile.has(r)) suppByFile.set(r, scanSuppressions(text, r));
		return suppByFile.get(r);
	};

	for (const f of jsFiles) {
		const text = readFileSync(f, 'utf8');
		const r = rel(f);
		const s = scanJsx(text, r);
		s.referenced.forEach((c) => referenced.add(c));
		s.stems.forEach((c) => stems.add(c));
		for (const b of s.bindings) {
			if (!bindings.has(b.cls)) bindings.set(b.cls, []);
			bindings.get(b.cls).push(b);
		}
		rawEls.push(...s.rawEls);
		supp(f, text); // pre-index suppressions for JS files
	}
	for (const f of refFiles) scanRefsOnly(readFileSync(f, 'utf8')).forEach((c) => referenced.add(c));

	const isReferenced = (cls) => referenced.has(cls) || [...stems].some((st) => cls.startsWith(st));

	// ── walk CSS ──────────────────────────────────────────────────────────────
	const styledClasses = new Set(); // classes CSS gives layout/type/appearance → feeds R7

	for (const f of cssFiles) {
		const r = rel(f);
		const text = readFileSync(f, 'utf8');
		const sp = supp(f, text);
		let rootNode;
		try {
			rootNode = postcss.parse(text, { from: f });
		} catch {
			continue; // unparseable (e.g. exotic scss) — skip rather than crash the gate
		}

		const reportThisFile = !inScope || inScope.has(r);
		const seenDeadClass = new Set();

		rootNode.walkRules((rule) => {
			const line = rule.source?.start?.line ?? 1;
			const classes = classesOf(rule.selector);
			if (!classes.length) return;

			// The component this rule's declarations land on, and the element within
			// it they actually target when the selector reaches past it (R6/R8).
			const bound = resolveBindings(rule.selectors, bindings);

			// Does this rule establish a CSS Grid? Grid is a genuine KEEP (Stack is
			// flex-only), so its display/gap/alignment are not R4 conversions. Detect
			// both `display:grid` and grid-only props (a modifier rule can set
			// `grid-template-columns` + `gap` without re-declaring `display:grid`).
			let ruleIsGrid = false;
			rule.walkDecls((d) => {
				const p = d.prop.toLowerCase();
				if (
					(p === 'display' && /\bgrid\b/.test(d.value)) ||
					p === 'grid' ||
					p.startsWith('grid-template') ||
					p.startsWith('grid-auto')
				) {
					ruleIsGrid = true;
				}
			});

			let ruleTouchesStyle = false;

			rule.walkDecls((decl) => {
				const prop = decl.prop.toLowerCase();
				const value = decl.value;
				const dline = decl.source?.start?.line ?? line;
				const push = (ruleId, message, rank = 0) => {
					if (!reportThisFile) return;
					if (isSuppressed(sp.byLine, dline, ruleId)) return;
					findings.push({ rule: ruleId, file: r, line: dline, message, rank });
				};

				// R3 — any margin.
				if (prop === 'margin' || prop.startsWith('margin-')) {
					ruleTouchesStyle = true;
					push('R3', prop, 5);
				}
				// R5 / R8 — type styling.
				else if (TYPE_PROPS.has(prop)) {
					ruleTouchesStyle = true;
					if (bound.text) push('R8', `${prop} on ${nameTarget(bound.text)}`, 12);
					else if (!usesToken(value)) push('R5', `${prop}: ${value}`, 10);
				}
				// R4 — flex layout in CSS that a <Stack> should own. NOT flagged on a
				// component-bound class (component-internal flex, or a class already
				// on a <Stack>) nor on a grid rule (CSS Grid is a KEEP — Stack is
				// flex-only); those aren't convertible to <Stack>.
				else if (LAYOUT_GAP_PROPS.has(prop)) {
					ruleTouchesStyle = true;
					if (!bound.wpds && !ruleIsGrid) push('R4', prop, 8);
				} else if (LAYOUT_FLEX_PROPS.has(prop) || (prop === 'display' && /\b(inline-)?(flex|grid)\b/.test(value))) {
					ruleTouchesStyle = true;
					const isGridDisplay = prop === 'display' && /\bgrid\b/.test(value);
					if (!bound.wpds && !ruleIsGrid && !isGridDisplay) push('R4', `${prop}: ${value}`, 6);
				}
				// R2 — hardcoded token-backed value.
				else if (isHardcodedTokenValue(prop, value)) {
					ruleTouchesStyle = true;
					const rank = COLOR_PROPS.has(prop) ? 9 : /\b0\b/.test(value) ? 1 : 4;
					push('R2', `${prop}: ${value}`, rank);
				}

				// R6 — an APPEARANCE override landing on a system component
				// (color/border/radius/shadow/type). Layout & box-model props on a
				// component-bound class are the intended way to give a primitive
				// like <Stack> padding or sizing, so they are not flagged here.
				if (bound.wpds && APPEARANCE_PROPS.has(prop)) {
					push('R6', `${nameTarget(bound.wpds)} ← ${prop}`, 11);
				}
			});

			if (ruleTouchesStyle) for (const c of classes) styledClasses.add(c);

			// R6 (framework flavour) — a rule reaching into design-system / library
			// internals (.components-*, .react-flow*, …). One finding per rule.
			const fw = classes.find(isFramework);
			if (fw && ruleTouchesStyle && reportThisFile && !isSuppressed(sp.byLine, line, 'R6')) {
				findings.push({ rule: 'R6', file: r, line, message: `.${fw} (library internal)`, rank: 11 });
			}

			// R1 — dead class (whole rule). Only project-namespaced classes we own;
			// report each undefined-elsewhere class once.
			for (const c of classes) {
				if (seenDeadClass.has(c) || !isProject(c) || isReferenced(c)) continue;
				seenDeadClass.add(c);
				if (!reportThisFile) continue;
				if (isSuppressed(sp.byLine, line, 'R1')) continue;
				findings.push({ rule: 'R1', file: r, line, message: `.${c}`, rank: 20 });
			}
		});
	}

	// ── R7 — raw elements with a WPDS analog ──────────────────────────────────
	for (const el of rawEls) {
		if (inScope && !inScope.has(el.file)) continue;
		const sp = suppByFile.get(el.file);
		if (sp && isSuppressed(sp.byLine, el.line, 'R7')) continue;
		if (STYLED_RAW.has(el.tag)) {
			// div/span only when actually styled by CSS (className hit by a rule).
			if (!el.classes.some((c) => styledClasses.has(c))) continue;
			findings.push({ rule: 'R7', file: el.file, line: el.line, message: `<${el.tag}> (styled)`, rank: 4 });
		} else {
			findings.push({ rule: 'R7', file: el.file, line: el.line, message: `<${el.tag}>`, rank: 7 });
		}
	}

	// ── R0 — blanket/invalid suppression attempts (always surfaced) ───────────
	const directives = [];
	for (const [file, s] of suppByFile) {
		for (const b of s.blanket) {
			if (inScope && !inScope.has(file)) continue;
			findings.push({ ...b, rank: 30 });
		}
		directives.push(...s.directives);
	}

	findings.sort((a, b) => (b.rank - a.rank) || a.file.localeCompare(b.file) || a.line - b.line);
	const blocking = findings.some((f) => RULES[f.rule]?.block);
	return { blocking, findings, directives };
}

/** For the `suppressions` audit command: every honored wpds-allow, repo-wide. */
export function listSuppressions({ root, plugins }) {
	const rel = (abs) => relative(root, abs).split('\\').join('/');
	const jsFiles = [];
	const cssFiles = [];
	for (const p of plugins) {
		const base = join(root, p);
		if (!existsSync(base)) continue;
		walk(base, new Set(['.css', '.scss']), cssFiles);
		walk(join(base, 'src'), new Set(['.js', '.jsx', '.ts', '.tsx']), jsFiles);
	}
	const all = [];
	for (const f of [...jsFiles, ...cssFiles]) {
		const { directives } = scanSuppressions(readFileSync(f, 'utf8'), rel(f));
		all.push(...directives);
	}
	all.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
	return all;
}
