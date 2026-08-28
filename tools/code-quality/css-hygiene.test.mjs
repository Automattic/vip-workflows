/**
 * Tests for the css-hygiene analyzer's JSX→CSS binding.
 *
 * The binding is the half of the analyzer nothing else can check: R4 and R6 both
 * turn on whether a class is understood to sit on a design-system component, and
 * getting that wrong is silent in both directions — a missed binding invents R4
 * findings on component-bound layout and hides every R6 appearance override on
 * the same class. Compound components (`<Tabs.Root>`, `<Card.Content>`) are the
 * case that used to be missed, so they are pinned here.
 *
 * Fixtures are built on disk because the analyzer's whole job is to read the
 * repo; a mocked fs would only prove the assertions agree with themselves. The
 * fixture borrows the real plugin's `node_modules` for postcss, which the
 * analyzer resolves out of the plugin it is analyzing.
 *
 * @package
 */

import assert from 'node:assert/strict';
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import { runCssHygiene } from './css-hygiene.mjs';
import { CORE } from './plugins.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const roots = [];

// The analyzer parses CSS with postcss, resolved out of the plugin it is
// analyzing — so these tests need that plugin's dependencies installed, which on
// a bare checkout they are not. The fixture's symlink would be created dangling
// and the analyzer would die on a MODULE_NOT_FOUND that says nothing about the
// binding under test, so say what is actually missing and skip, the way
// quality.mjs already does when it cannot load postcss either.
const skip = existsSync(join(REPO, CORE, 'node_modules', 'postcss'))
	? false
	: `${CORE} dependencies are not installed (run \`npm run setup\`)`;

/**
 * A throwaway plugin root holding one JS file and one stylesheet.
 *
 * @param {string} js  Contents of `src/Component.js`.
 * @param {string} css Contents of `src/style.css`.
 * @return {string} The fixture root, ready to hand to runCssHygiene.
 */
function fixture(js, css) {
	const root = mkdtempSync(join(tmpdir(), 'vipwf-hygiene-'));
	roots.push(root);
	mkdirSync(join(root, CORE, 'src'), { recursive: true });
	// postcss is resolved out of the analyzed plugin, and the walker skips
	// symlinks, so this lends the dependency without adding files to scan.
	symlinkSync(join(REPO, CORE, 'node_modules'), join(root, CORE, 'node_modules'));
	writeFileSync(join(root, CORE, 'src', 'Component.js'), js);
	writeFileSync(join(root, CORE, 'src', 'style.css'), css);
	return root;
}

const analyze = (root) =>
	runCssHygiene({ root, plugins: [CORE], mode: 'all' }).findings;
const rules = (findings) => findings.map((f) => f.rule);

after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

describe('component bindings', { skip }, () => {
	const css = `.vip-workflows-tabs {
	display: flex;
	gap: var(--wpds-dimension-gap-lg);
	border: 1px solid var(--wpds-color-stroke-surface-neutral);
}
`;

	it('binds a compound component through its root identifier', () => {
		const root = fixture(
			`import { Tabs } from '@wordpress/ui';
export default function C() {
	return <Tabs.Root className="vip-workflows-tabs" />;
}
`,
			css
		);
		const findings = analyze(root);

		// Layout on a bound component is the intended way to style a primitive,
		// so it is not an R4 "use a <Stack>".
		assert.deepEqual(rules(findings).filter((r) => r === 'R4'), []);
		// The appearance override is R6, and names the tag it landed on.
		const r6 = findings.filter((f) => f.rule === 'R6');
		assert.equal(r6.length, 1);
		assert.match(r6[0].message, /<Tabs\.Root> ← border/);
	});

	it('leaves a member expression whose root is not a system component unbound', () => {
		const root = fixture(
			`import { Tabs } from './local-tabs';
export default function C() {
	return <Tabs.Root className="vip-workflows-tabs" />;
}
`,
			css
		);
		const findings = analyze(root);

		// Nothing bound, so the layout is a genuine R4 and there is no component
		// for an R6 override to land on.
		assert.deepEqual(rules(findings).filter((r) => r === 'R6'), []);
		assert.equal(findings.filter((f) => f.rule === 'R4').length, 2);
	});
});

describe('override attribution', { skip }, () => {
	const r6of = (findings) => findings.filter((f) => f.rule === 'R6');

	it('names the descendant a selector reaches into, not the component it scopes from', () => {
		const root = fixture(
			`import { Tooltip } from '@wordpress/ui';
export default function C() {
	return (
		<Tooltip.Trigger className="wf-infotip">
			<svg />
		</Tooltip.Trigger>
	);
}
`,
			`.wf-infotip svg {
	fill: var(--wpds-color-foreground-content-neutral-weak);
}
`
		);
		const r6 = r6of(analyze(root));

		// Still a finding — the CSS is reaching into what the component renders —
		// but the fill lands on the <svg>, so naming <Tooltip.Trigger> on its own
		// sends a reader hunting for a fill the trigger never has.
		assert.equal(r6.length, 1);
		assert.equal(r6[0].message, '<Tooltip.Trigger> svg ← fill');
	});

	it('names the component itself when every class sits on one compound', () => {
		const root = fixture(
			`import { Card } from '@wordpress/ui';
export default function C() {
	return <Card.Content className="wf-panel wf-panel--inset" />;
}
`,
			`.wf-panel.wf-panel--inset {
	border: 1px solid var(--wpds-color-stroke-surface-neutral);
}
`
		);
		const r6 = r6of(analyze(root));

		// No combinator, so both classes are on the component's own element: the
		// border really is an override of <Card.Content>.
		assert.equal(r6.length, 1);
		assert.equal(r6[0].message, '<Card.Content> ← border');
	});

	it('names the component itself when it is the subject of a descendant selector', () => {
		const root = fixture(
			`import { Card } from '@wordpress/ui';
export default function C() {
	return (
		<div className="wf-panel-wrap">
			<Card.Content className="wf-panel" />
		</div>
	);
}
`,
			`.wf-panel-wrap .wf-panel {
	border: 1px solid var(--wpds-color-stroke-surface-neutral);
}
`
		);
		const r6 = r6of(analyze(root));

		// A combinator is not itself the tell: the bound class is the subject here,
		// so the declaration lands on the component and reaches into nothing.
		assert.equal(r6.length, 1);
		assert.equal(r6[0].message, '<Card.Content> ← border');
	});
});
