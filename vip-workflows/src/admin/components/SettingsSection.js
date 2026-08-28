/**
 * SettingsSection — a titled group of controls, and the default way to divide a
 * settings screen.
 *
 * This is core's shape, not a card: the Gutenberg Preferences modal renders each
 * group as a borderless `<fieldset>` whose `<legend>` carries the title, with an
 * optional description beneath it and no border, shadow or surface. Grouping is
 * done by a heading and space — the cheapest device that works — and containers
 * are saved for things the screen has many of.
 *
 * Uses `@wordpress/ui`'s `Fieldset` with a `<div>` legend slot (via
 * `aria-labelledby`) rather than a native `<legend>`. Native legends carry UA
 * typography and layout that fight the admin-page `revert-layer` reset on the
 * `<h2>` inside, and they mis-measure height when the fieldset is a flex item.
 * The title and the description go in their own slots: the legend is what names
 * the group, so anything else put inside it is read as part of that name.
 *
 * The section owns the space between its own controls. The space between one
 * section and the next belongs to the `Stack` the consumer wraps them in —
 * consumers never add margins.
 *
 * @package
 */

import { Fieldset, Stack, Text } from '@wordpress/ui';

import './SettingsSection.css';

/**
 * A titled group of related controls.
 *
 * @param {Object} props               Component props.
 * @param {string} props.title         Sentence-case noun phrase naming the group.
 * @param {string} [props.description] Context the controls cannot carry themselves.
 * @param {Node}   props.children      The controls.
 * @return {JSX.Element} The section.
 */
export function SettingsSection( { title, description, children } ) {
	return (
		<Fieldset.Root className="vip-workflows-settings-section">
			<Fieldset.Legend className="vip-workflows-settings-section__legend">
				<Text variant="heading-md" render={ <h2 /> }>
					{ title }
				</Text>
			</Fieldset.Legend>
			{ /* `Fieldset.Description`, not a second child of the legend: the
			     legend slot is what `Fieldset.Root` names the group by
			     (`aria-labelledby`), so a paragraph inside it is read as part
			     of the group's NAME and the group is left with no
			     `aria-describedby` at all. The description slot registers that
			     id — the same wiring `RoleCheckboxGroup` already uses. */ }
			{ description && (
				<Fieldset.Description
					className="vip-workflows-settings-section__description"
					render={ <Text variant="body-md" render={ <p /> } /> }
				>
					{ description }
				</Fieldset.Description>
			) }
			{ /* No `align`: a column Stack's `align` is its cross axis, which
			     is width, so `align="start"` shrink-wrapped every control to
			     its intrinsic size — textareas to the UA's 20-column default,
			     the role grids to a single auto-fill column, selects to their
			     label. Stretch is both the flex default and what the
			     `Card.Content` this shell replaced did. */ }
			<Stack
				className="vip-workflows-settings-section__controls"
				direction="column"
				gap="xl"
			>
				{ children }
			</Stack>
		</Fieldset.Root>
	);
}
