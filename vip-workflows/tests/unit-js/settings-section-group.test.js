/**
 * SettingsSection — the grouping contract every settings screen inherits.
 *
 * The section is a real `<fieldset>`, so it reaches assistive tech as a `group`
 * whose accessible name is announced on entry. Two ways that name goes wrong are
 * easy to write and invisible on screen.
 *
 * The first is folding the description into the thing that names the group. It
 * shipped that way — the description sat inside `Fieldset.Legend` — so every
 * control inside carried a group name of the title followed by the whole
 * description. `Fieldset.Description` is the slot for it: same text, announced
 * through `aria-describedby` as context rather than as identity.
 *
 * The second is reaching for a native `<legend>`. Measured in Chromium, a legend
 * is not a flex item of its own fieldset: a 40px `gap` between it and the
 * controls applies as 0px, so the spacing has to be re-expressed as margins and
 * the layout fights back. Base UI names the fieldset from a `<div>` through
 * `aria-labelledby` instead, which measures 40px with an identical role and
 * name. The absence of a `<legend>` is therefore part of the contract, not an
 * implementation detail — hence the assertion on it.
 *
 * @package
 */

import { render, screen, within } from './helpers/render-wp-component';

import { SettingsSection } from '../../src/admin/components/SettingsSection';

const TITLE = 'Workflow enforcement';
const DESCRIPTION =
	'Applies to every post type the sequence claims, including ones added later.';

// Deliberately plain HTML: what is under test is the group around the controls,
// not the controls themselves.
const controls = (
	<>
		<input id="settings-section-test-toggle" type="checkbox" />
		<label htmlFor="settings-section-test-toggle">Enforce</label>
	</>
);

const group = () => screen.getByRole( 'group' );

describe( 'SettingsSection', () => {
	it( 'names the group with the title alone, not the title plus the description', () => {
		render(
			<SettingsSection title={ TITLE } description={ DESCRIPTION }>
				{ controls }
			</SettingsSection>
		);

		expect( group().tagName ).toBe( 'FIELDSET' );
		expect( group() ).toHaveAccessibleName( TITLE );
	} );

	it( 'describes the group with the description', () => {
		render(
			<SettingsSection title={ TITLE } description={ DESCRIPTION }>
				{ controls }
			</SettingsSection>
		);

		expect( group() ).toHaveAccessibleDescription( DESCRIPTION );
	} );

	it( 'names the group without a native legend', () => {
		render(
			<SettingsSection title={ TITLE } description={ DESCRIPTION }>
				{ controls }
			</SettingsSection>
		);

		// Both halves matter. Asserting only that the legend is absent would
		// pass for a group with no accessible name at all, which is worse than
		// the layout bug the absence buys.
		expect( group().querySelector( 'legend' ) ).toBeNull();
		expect( group() ).toHaveAttribute( 'aria-labelledby' );
	} );

	it( 'leaves no dangling aria-describedby without a description', () => {
		render(
			<SettingsSection title={ TITLE }>{ controls }</SettingsSection>
		);

		// A description rendered unconditionally still leaves the group with an
		// *empty* accessible description, so asserting on the description alone
		// would not catch it.
		expect( group() ).not.toHaveAttribute( 'aria-describedby' );
		expect(
			group().querySelector(
				'.vip-workflows-settings-section__description'
			)
		).toBeNull();
	} );

	it( 'titles the group at h2, one step above a field group inside it', () => {
		render(
			<SettingsSection title={ TITLE }>{ controls }</SettingsSection>
		);

		expect(
			screen.getByRole( 'heading', { name: TITLE, level: 2 } )
		).toBeInTheDocument();
	} );

	it( 'renders its controls inside the fieldset', () => {
		render(
			<SettingsSection title={ TITLE } description={ DESCRIPTION }>
				{ controls }
			</SettingsSection>
		);

		expect(
			within( group() ).getByRole( 'checkbox', { name: 'Enforce' } )
		).toBeInTheDocument();
	} );
} );
