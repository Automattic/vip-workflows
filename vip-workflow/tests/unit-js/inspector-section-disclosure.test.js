/**
 * How a collapsible InspectorSection shuts, and where its spacing may live.
 *
 * `Collapsible.Panel` is shut with `hiddenUntilFound` so browser find-in-page
 * can still reach the controls inside and spring the section open. The HTML
 * rendering spec gives `hidden="until-found"` `content-visibility: hidden`
 * rather than `display: none`, and the difference is the whole point of this
 * file: the panel still generates a box and still lays out its own padding and
 * border, and only its *contents* are skipped.
 *
 * So box spacing on the panel survives the collapse, as a strip of dead space
 * under the header of every shut section. Spacing has to sit on the content
 * inside the panel, which is skipped along with everything else.
 *
 * @package
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { render, screen, fireEvent } from './helpers/render-wp-component';

import InspectorSection from '../../src/admin/components/graph/InspectorSection';

const STYLESHEET = join(
	__dirname,
	'../../src/admin/components/graph/Inspector.css'
);

function renderSection() {
	return render(
		<InspectorSection title="Advanced" collapsible>
			<p>Inside the disclosure</p>
		</InspectorSection>
	);
}

describe( 'InspectorSection disclosure', () => {
	it( 'shuts the panel with hidden="until-found", so find-in-page reaches it', () => {
		const { container } = renderSection();

		const panel = container.querySelector( '.wf-inspector-section__panel' );

		// Not `hidden=""`. That would be display:none, and none of the rest of
		// this file would matter.
		expect( panel ).toHaveAttribute( 'hidden', 'until-found' );
	} );

	it( 'keeps the trigger-to-content spacing inside the panel, not on it', () => {
		const { container } = renderSection();

		const panel = container.querySelector( '.wf-inspector-section__panel' );

		// The element the spacing hangs off is a child of the panel, so
		// content-visibility takes it away with everything else.
		expect(
			panel.querySelector( '.wf-inspector-section__disclosed' )
		).not.toBeNull();
	} );

	// A stylesheet assertion because the defect is a stylesheet one and jsdom
	// computes no layout: padding on the panel is invisible to every DOM test
	// that could be written here, and visible on screen under every shut
	// section. This is the cheapest thing that fails if it comes back.
	it( 'declares no box spacing directly on the panel', () => {
		const css = readFileSync( STYLESHEET, 'utf8' );

		// The rule body for the panel selector on its own — not descendant
		// selectors that merely start with it. No such rule is a pass: the
		// spacing cannot be on the panel if the panel has no rule of its own.
		const ownRule = css.match(
			/^\.wf-inspector-section__panel\s*\{([^}]*)\}/m
		);
		const declarations = ownRule ? ownRule[ 1 ] : '';

		expect( declarations ).not.toMatch(
			/(^|[\s;])(padding|margin|border)/
		);
	} );

	// A heading row centres its items, so a title carrying the block margin
	// WPDS's reset takes off an <h3> is centred by its MARGIN box — the label
	// riding above the control beside it. The rule that cancels the margin there
	// has to out-specify the rule that restores it, or it never applies to the
	// one section that has both (a non-collapsible one with `actions`).
	it( 'cancels the title margin inside a heading row, at a weight that wins', () => {
		// Comments first: they are full of class names, and a selector read
		// with one still attached measures as far heavier than it is.
		const css = readFileSync( STYLESHEET, 'utf8' ).replace(
			/\/\*[\s\S]*?\*\//g,
			''
		);

		const rules = [ ...css.matchAll( /([^{}]+)\{([^{}]*)\}/g ) ].map(
			( [ , selector, body ] ) => ( {
				selector: selector.trim(),
				body,
			} )
		);

		const ruleFor = ( declaration ) =>
			rules.find(
				( rule ) =>
					rule.body.includes( declaration ) &&
					rule.selector.includes( 'wf-inspector-section__title' )
			);

		// Class-count specificity is enough: neither rule uses an id, an element
		// or an inline style, and `:not()` takes its argument's weight.
		const weightOf = ( rule ) =>
			( rule.selector.match( /\.[\w-]+/g ) || [] ).length;

		const restore = ruleFor( 'margin-block-end: var(' );
		const cancel = ruleFor( 'margin-block-end: 0' );

		expect( cancel.selector ).toContain( 'wf-inspector-section__header' );
		expect( weightOf( cancel ) ).toBeGreaterThan( weightOf( restore ) );
	} );

	it( 'reveals the content when the trigger is used', () => {
		renderSection();

		expect( screen.getByText( 'Inside the disclosure' ) ).not.toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: /Advanced/ } ) );

		expect( screen.getByText( 'Inside the disclosure' ) ).toBeVisible();
	} );

	// `actions` is a SIBLING of the trigger, so it can be pressed while the
	// section is shut — and every action a section hangs off its heading adds
	// something to the panel. A disclosure that only read `defaultOpen` at mount
	// answered that press by leaving the new thing behind `hidden="until-found"`,
	// with nothing but the summary count to say it was there.
	it( 'opens itself when one of its heading actions is used', () => {
		render(
			<InspectorSection
				title="Advanced"
				collapsible
				actions={ <button type="button">Add</button> }
			>
				<p>Inside the disclosure</p>
			</InspectorSection>
		);

		expect( screen.getByText( 'Inside the disclosure' ) ).not.toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );

		expect( screen.getByText( 'Inside the disclosure' ) ).toBeVisible();
	} );

	it( 'still toggles shut from the trigger', () => {
		render(
			<InspectorSection
				title="Advanced"
				collapsible
				defaultOpen
				actions={ <button type="button">Add</button> }
			>
				<p>Inside the disclosure</p>
			</InspectorSection>
		);

		fireEvent.click( screen.getByRole( 'button', { name: /Advanced/ } ) );

		expect( screen.getByText( 'Inside the disclosure' ) ).not.toBeVisible();
	} );
} );
