/**
 * InspectorFacts — the read-out row every inspector list is built from.
 *
 * One row: a name at the start, its current value at the far end, an optional
 * adornment in front of the name and an optional control after it. The row is
 * inert by default, becomes a button when it opens something (`onSelect`), and
 * becomes draggable when the author owns its order (`SortableFact`).
 *
 * Lifted out of `StageInspector`, which invented this row for the stage's exits
 * and is still its largest user. `InspectorFieldList` builds its rows from the
 * same primitives rather than growing a second, near-identical list — a capture
 * input and a stage exit are different things, but "a line that names something
 * and opens its options" is one shape, and two copies of it drift.
 *
 * @package
 */

import { Icon } from '@wordpress/components';
import { Stack, Text, Tooltip } from '@wordpress/ui';
import { dragHandle, info } from '@wordpress/icons';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { __, sprintf } from '@wordpress/i18n';

/**
 * An explanation, attached to the thing it explains.
 *
 * Some rows are two `<Text>`s in an `<li>` — nothing to hover, nothing to focus,
 * unlike the rows that open what they report — so the section prose these
 * tooltips replace had no per-row home to move into. This gives one a real
 * trigger: a button, which opens on hover, on focus and on tap, rather than a
 * hover target on label text that a keyboard or a touch screen can never reach.
 *
 * Named for what it explains rather than "More information", so tabbing a panel
 * says which setting is about to be described instead of offering a run of
 * identical buttons.
 *
 * @param {Object}      props          Component props.
 * @param {string}      props.about    The setting being explained.
 * @param {JSX.Element} props.children The explanation.
 * @return {JSX.Element} The trigger and its tooltip.
 */
export function InfoTip( { about, children } ) {
	return (
		<Tooltip.Provider>
			<Tooltip.Root>
				<Tooltip.Trigger
					className="wf-inspector-infotip"
					aria-label={ sprintf(
						/* translators: %s: the setting being explained, e.g. "Post status". */
						__( 'About %s', 'vip-workflows' ),
						about
					) }
				>
					<Icon icon={ info } size={ 16 } />
				</Tooltip.Trigger>
				{ /* Left, because the panel is docked to the right edge of the
				     canvas and a tooltip to its right would open off-screen. */ }
				<Tooltip.Popup
					className="wf-inspector-infotip__popup"
					side="left"
				>
					{ children }
				</Tooltip.Popup>
			</Tooltip.Root>
		</Tooltip.Provider>
	);
}

/**
 * The inside of a read-out row: what the thing is, and what it is set to.
 *
 * Split from the `<li>` around it so a plain row and a draggable one can be the
 * same row. Name at the start, value pushed to the far end, italicised when
 * there is no value to give (see `Inspector.css`).
 *
 * `children` slots in front of the name; the stage read-out's route rows put
 * their outcome's colored dot there.
 *
 * The value can be an absence — an outcome nobody has routed, a capture input
 * nobody has named — and `empty` marks it, so the placeholder standing in for it
 * doesn't read as the setting itself.
 *
 * @param {Object}      props            Component props.
 * @param {string}      props.label      What is being reported.
 * @param {string}      props.value      Its current setting.
 * @param {boolean}     [props.empty]    Value is the absence of a setting.
 * @param {JSX.Element} [props.tip]      What the setting means, in a tooltip.
 * @param {JSX.Element} [props.children] Leading adornment.
 * @return {JSX.Element} The row's contents.
 */
function FactContent( { label, value, empty = false, tip, children } ) {
	return (
		<>
			{ children }
			<Text variant="body-sm">{ label }</Text>
			{ tip && <InfoTip about={ label }>{ tip }</InfoTip> }
			<Text
				variant="body-sm"
				className={ [ 'wf-inspector__fact-value', empty && 'is-empty' ]
					.filter( Boolean )
					.join( ' ' ) }
			>
				{ value }
			</Text>
		</>
	);
}

/**
 * A row's contents, made operable when the row leads somewhere.
 *
 * A row that reports something with options of its own becomes a button that
 * opens them. In the stage read-out that selects a transition; in a field list
 * it opens the field's popover.
 *
 * A button rather than the `<li>` itself for the same reason the drag handle is
 * one: a row can hold a tooltip trigger or a remove button, and a control inside
 * a control is not a thing. `onSelect` and `tip` never arrive together.
 *
 * `render` lets a caller supply the element the contents become — a
 * `Dropdown`'s toggle button, say — instead of the plain button used when the
 * row simply selects something.
 *
 * @param {Object}      props               Component props.
 * @param {?Function}   [props.onSelect]    Opens what the row reports.
 * @param {string}      [props.selectLabel] Accessible name for that button.
 * @param {JSX.Element} [props.render]      Element to render the contents as.
 * @param {boolean}     [props.expanded]    Whether what it opens is open.
 * @return {JSX.Element} The row's contents, bare or in a button.
 */
function FactBody( { onSelect, selectLabel, render, expanded, ...content } ) {
	if ( ! onSelect && ! render ) {
		return <FactContent { ...content } />;
	}

	return (
		<Stack
			render={ render || <button type="button" /> }
			align="center"
			gap="sm"
			className="wf-inspector__fact-open"
			aria-label={ selectLabel }
			aria-expanded={ undefined === expanded ? undefined : expanded }
			onClick={ onSelect }
		>
			<FactContent { ...content } />
		</Stack>
	);
}

/**
 * One line of a read-out.
 *
 * The shape every summary in an inspector uses, so a stage's placement facts,
 * its exits, and a list of capture inputs read as one grammar rather than three
 * inventions.
 *
 * `trailing` sits after the body, outside whatever button the body became — a
 * per-row remove has to be a sibling of that button, not a control inside one.
 *
 * @param {Object}      props             Component props.
 * @param {string}      [props.className] Extra classes for the row.
 * @param {JSX.Element} [props.trailing]  Control rendered at the row's end.
 * @return {JSX.Element} The row.
 */
export function Fact( { className, trailing, ...content } ) {
	return (
		<Stack
			render={ <li /> }
			align="center"
			gap="sm"
			className={ [ 'wf-inspector__fact', className ]
				.filter( Boolean )
				.join( ' ' ) }
		>
			<FactBody { ...content } />
			{ trailing }
		</Stack>
	);
}

/**
 * A read-out row the author can drag, for an order no other gesture expresses.
 *
 * Dragging is on a handle rather than the whole row. The row can hold a tooltip
 * trigger or a remove button, and dnd-kit's `attributes` make whatever carries
 * them focusable with `role="button"` — which would nest one control inside
 * another. The handle also gives the KeyboardSensor a real tab stop, so
 * reordering works without a pointer in a panel where dragging is fiddly.
 *
 * That the grip is its own button is also what leaves the rest of the row free
 * to be one (`FactBody`): the two never claim the same pointer, so a row can be
 * reordered and opened from the same line. They do need names that tell them
 * apart, which is why one says "Reorder" and the other "Select" or "Configure".
 *
 * @param {Object}      props             Component props.
 * @param {string}      props.id          Stable, unique id for this row's position.
 * @param {string}      props.dragLabel   Accessible name for the handle.
 * @param {string}      [props.className] Extra classes for the row.
 * @param {JSX.Element} [props.trailing]  Control rendered at the row's end.
 * @return {JSX.Element} The row.
 */
export function SortableFact( {
	id,
	dragLabel,
	className,
	trailing,
	...content
} ) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable( { id } );

	return (
		<Stack
			render={ <li /> }
			align="center"
			gap="sm"
			ref={ setNodeRef }
			className={ [
				'wf-inspector__fact',
				'is-sortable',
				isDragging && 'is-dragging',
				className,
			]
				.filter( Boolean )
				.join( ' ' ) }
			// The drag transform is measured by dnd-kit at drag time, so it
			// cannot be authored in the stylesheet.
			style={ {
				transform: CSS.Transform.toString( transform ),
				transition,
			} }
		>
			<button
				type="button"
				className="wf-inspector__grip"
				aria-label={ dragLabel }
				{ ...attributes }
				{ ...listeners }
			>
				<Icon icon={ dragHandle } size={ 16 } />
			</button>
			<FactBody { ...content } />
			{ trailing }
		</Stack>
	);
}
