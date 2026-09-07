/**
 * InspectorFieldList — an ordered list an author adds to, orders and prunes.
 *
 * Three things in this editor have that shape: a sequence's metadata fields, the
 * inputs a transition captures on its way past, and the tools a transition
 * requires. The first two are the same object at different scopes — a named,
 * typed, optionally-required place to put a value — and the third is nothing of
 * the kind, which is the point. What they share is the list, not the item, so the
 * list lives here and the differences arrive as props.
 *
 * **Two of its halves are opt-in, because only a field definition has them.** A
 * row opens a configuration popover when `renderConfig` says what is in it, and
 * the list polices storage keys when `keyOf` says where to find one. A required
 * tool has neither: it is an ability id chosen from a menu, with nothing to set
 * per tool and no key of its own to collide with. A list that omits both is not a
 * degraded field list — it is this list without the two things a *field* adds to
 * it, and putting a tool through either would mean inventing a configuration with
 * nothing in it or a key nobody typed.
 *
 * **The list is the surface; one item's configuration shows at a time.** Rendering
 * every field's sub-form at once is what the metadata editor used to do, and a
 * handful of fields turned a settings panel into a wall of controls with no way
 * to see the shape of the list. A row here says what the field is and what it is
 * set to; clicking it opens that field's options in a popover, anchored to the
 * row. `__experimentalPaletteEdit` is the same idea in core — copied as a
 * pattern, not imported, since it is experimental and hardcoded to colors.
 *
 * **Order is the author's, set by dragging.** Nothing else expresses it: it is the
 * order a writer is asked for these values in, and the order they read in a
 * post's sidebar. The rows are `SortableFact`, the same row the stage
 * inspector's exits use, so a draggable list of settings looks the same wherever
 * this editor shows one.
 *
 * **Keys are checked here, not on the server's say-so** — in the lists that have
 * keys. A duplicate storage key is a 400 on save
 * (`duplicate_metadata_field_key`, `duplicate_assignment_key`), and it used to
 * be reported only after the fact, naming the field by array index. The row that
 * has to change is flagged as it is typed, and the message repeats inside the
 * popover where the key field actually is — a problem hidden behind a closed
 * disclosure is not a report.
 *
 * @package
 */

import { useState } from '@wordpress/element';
import { Button, DropdownMenu, MenuItem, Popover } from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { plus, trash } from '@wordpress/icons';
import { __, sprintf } from '@wordpress/i18n';
import {
	DndContext,
	closestCenter,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from '@dnd-kit/core';
import {
	SortableContext,
	verticalListSortingStrategy,
	sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { SortableFact } from './InspectorFacts';
import { reorderList } from './graph-model';

/**
 * The two ways a storage key gets a save refused, said on the row that has to
 * change while the author is still looking at it.
 *
 * Duplicates are walked the way the server walks them: the first field to use a
 * key owns it, later ones are the collision. A blank key is refused too, but
 * only on a row the author has started — the key is generated from the name, so
 * a row carrying a name and no key is one whose key was cleared by hand, a state
 * someone chose. A row added a moment ago and not yet typed into is incomplete
 * rather than wrong, and colouring it the instant it appears is validation
 * nobody asked for.
 *
 * A blank key never counts as a duplicate of another blank one, for the same
 * reason: two untouched new rows are not a collision.
 *
 * @param {Array}    items     The list.
 * @param {Function} keyOf     A field's storage key.
 * @param {Function} isStarted Whether the author has begun this field.
 * @return {Array<Object|undefined>} Per-item problem, positionally.
 */
function keyProblems( items, keyOf, isStarted ) {
	const seen = new Set();

	return items.map( ( item ) => {
		const key = keyOf( item );

		if ( ! key ) {
			return isStarted( item )
				? {
						short: __( 'Needs a key', 'vip-workflows' ),
						full: __(
							'This field needs a key. Saving is refused until it has one.',
							'vip-workflows'
						),
				  }
				: undefined;
		}

		if ( seen.has( key ) ) {
			return {
				short: __( 'Duplicate key', 'vip-workflows' ),
				full: __(
					'Another field already uses this key. Saving is refused until it is unique.',
					'vip-workflows'
				),
			};
		}

		seen.add( key );
		return undefined;
	} );
}

/**
 * One row: what the item is, what it is set to, and its options behind a click.
 *
 * The row's body is the control that opens the options — the line an author
 * reads is the line they press, with no separate "edit" affordance to find.
 * Remove sits outside that button, because a control inside a control is not a
 * thing, and the drag handle sits outside it for the same reason (see
 * `SortableFact`).
 *
 * A row with no configuration is not that button. Nothing opens, so nothing may
 * look like it opens: it stays the inert read-out `Fact` was to begin with, and
 * whatever it has to say for itself arrives as `tip` — the tooltip trigger
 * `InfoTip` exists for, built for exactly the row that has nothing to press.
 * That is also why `onSelect` and `tip` never arrive together, as `FactBody`
 * requires: one is the presence of a configuration and the other is its absence.
 *
 * The popover is rendered inside the row and takes no explicit anchor, so it
 * positions against the row itself — which is what a reader is looking at, and
 * which does not move when the summary text changes under it. `onClose` covers
 * every dismissal: Escape, a click outside, and a second press on the row.
 *
 * Which row is open is the LIST's business, not a row's: rows are identified by
 * position (see `sortId`), so a row that owned the state would hand its open
 * popover to whatever item took its place when the one above it was removed —
 * the author looking at one field's settings and editing another's.
 *
 * @param {Object}    props                Component props.
 * @param {string}    props.id             Stable, unique id for this row's position.
 * @param {Object}    props.item           The item this row reports.
 * @param {number}    props.index          Its position in the list.
 * @param {?Object}   props.problem        Why its key would have the save refused.
 * @param {Function}  props.describe       Names the item and says what it is set to.
 * @param {?Function} [props.renderConfig] Renders the item's options, when it has any.
 * @param {boolean}   props.isOpen         Whether this row's options are showing.
 * @param {Function}  props.onToggle       Opens or shuts this row's options: ( index ).
 * @param {Function}  props.onCloseConfig  Shuts whatever is open.
 * @param {Function}  props.onUpdate       Applies changes: ( index, changes ).
 * @param {Function}  props.onRemove       Removes the item: ( index ).
 * @param {string}    props.removeLabel    Accessible name for the remove button.
 * @return {JSX.Element} The row.
 */
function FieldRow( {
	id,
	item,
	index,
	problem,
	describe,
	renderConfig,
	isOpen,
	onToggle,
	onCloseConfig,
	onUpdate,
	onRemove,
	removeLabel,
} ) {
	const summary = describe( item, index );
	const configurable = Boolean( renderConfig );

	return (
		<SortableFact
			id={ id }
			dragLabel={ sprintf(
				/* translators: %s: the item's name. */
				__( 'Reorder %s', 'vip-workflows' ),
				summary.label
			) }
			// Either channel can put a row in the wrong: a key the save would
			// refuse, or — for a list that has no keys — an item that describes
			// itself as one that will not do its job.
			className={ problem || summary.invalid ? 'is-invalid' : undefined }
			label={ summary.label }
			// A row whose key is wrong says so instead of saying what it
			// captures: the setting is unreachable until the key is fixed, and
			// the popover behind this row is where it gets fixed.
			value={ problem ? problem.short : summary.value }
			empty={ problem ? false : Boolean( summary.empty ) }
			tip={ configurable ? undefined : summary.tip }
			onSelect={ configurable ? () => onToggle( index ) : undefined }
			expanded={ configurable ? isOpen : undefined }
			selectLabel={
				configurable
					? sprintf(
							/* translators: %s: the item's name. */
							__( 'Configure %s', 'vip-workflows' ),
							summary.label
					  )
					: undefined
			}
			trailing={
				<>
					<Button
						icon={ trash }
						label={ removeLabel }
						showTooltip
						onClick={ () => onRemove( index ) }
						isDestructive
						size="small"
					/>
					{ configurable && isOpen && (
						<Popover
							placement="left-start"
							offset={ 36 }
							shift
							// The string, not a bare `true`:
							// `useFocusOnMount` only looks for a tabbable
							// for 'firstElement' / 'firstInputElement' and
							// focuses the popover container itself for every
							// other value, landing a keyboard user on a div
							// instead of the first control.
							focusOnMount="firstElement"
							onClose={ onCloseConfig }
							className="wf-inspector-field-list__popover"
							// Popover renders a role-less div, where an
							// aria-label alone is prohibited ARIA that
							// assistive tech ignores. The explicit dialog
							// role makes the label announce.
							role="dialog"
							aria-label={ summary.label }
						>
							<Stack
								direction="column"
								gap="md"
								align="stretch"
								className="wf-inspector-field-list__config"
							>
								{ renderConfig( {
									item,
									index,
									problem,
									update: ( changes ) =>
										onUpdate( index, changes ),
								} ) }
							</Stack>
						</Popover>
					) }
				</>
			}
		/>
	);
}

/**
 * The list.
 *
 * `keyOf` and `isStarted` are a pair: together they are the storage-key check,
 * and a list whose items carry no key the author types leaves both off.
 * `renderConfig` is the other opt-in half — see `FieldRow` for what a row
 * without it becomes.
 *
 * `describe` returns what the row reads: `label` and `value`, `empty` when the
 * value stands in for a setting nobody made, `invalid` when it reports a problem
 * rather than a setting, and `tip` for the explanation a row with no popover has
 * nowhere else to put.
 *
 * @param {Object}    props                Component props.
 * @param {Array}     props.items          The list, in the author's order.
 * @param {Function}  props.onChange       Reports the whole list back.
 * @param {?Function} [props.keyOf]        An item's storage key, for lists that have one.
 * @param {?Function} [props.isStarted]    Whether the author has begun this item.
 * @param {Function}  props.describe       Names an item and says what it is set to.
 * @param {?Function} [props.renderConfig] Renders an item's options, for lists whose items have any.
 * @param {string}    props.removeLabel    Accessible name for a row's remove button.
 * @param {string}    props.emptyLabel     What an empty list says for itself.
 * @return {JSX.Element} The list, or its empty state.
 */
export default function InspectorFieldList( {
	items,
	onChange,
	keyOf,
	isStarted,
	describe,
	renderConfig,
	removeLabel,
	emptyLabel,
} ) {
	// Mirrors the stage inspector's sensor setup. KeyboardSensor is not optional
	// here: this list lives in a narrow panel where dragging is fiddly, so the
	// keyboard route is the one that always works.
	const sensors = useSensors(
		useSensor( PointerSensor, { activationConstraint: { distance: 8 } } ),
		useSensor( KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		} )
	);

	// Which row has its options showing. Held here because a row's identity is
	// its position: a removal or a reorder renumbers everything below it, and an
	// open popover that stayed put would be reporting — and writing to — an item
	// nobody opened. Both gestures shut it instead.
	const [ openIndex, setOpenIndex ] = useState( null );

	const problems = keyOf ? keyProblems( items, keyOf, isStarted ) : [];

	// Position, and only position. Two fields can share a key — that is the
	// collision this list flags — so a key cannot identify a row, and dnd-kit
	// needs the ids in a SortableContext to be unique or it cannot tell the pair
	// apart. The position already is.
	//
	// It must not carry the key for a second reason: this doubles as the row's
	// React key, and a key derived from the item's own content changes as the
	// item is edited. A note's storage key is built from its name, so naming one
	// remounted the row mid-keystroke and closed the popover the name was being
	// typed into. Row identity is where a row sits; what it holds is free to
	// change underneath it.
	const sortId = ( item, index ) => String( index );

	const updateItem = ( index, changes ) => {
		onChange(
			items.map( ( item, i ) =>
				i === index ? { ...item, ...changes } : item
			)
		);
	};

	const removeItem = ( index ) => {
		setOpenIndex( null );
		onChange( items.filter( ( _, i ) => i !== index ) );
	};

	const handleDragEnd = ( { active, over } ) => {
		if ( ! over ) {
			return;
		}

		// The sort ids ARE the positions (see `sortId`), so this is the whole
		// of the parse.
		const next = reorderList(
			items,
			parseInt( active.id, 10 ),
			parseInt( over.id, 10 )
		);

		// Identity, not equality: a drop that ended where it started returns the
		// original array, and reporting that as a change would mark the sequence
		// dirty for a drag the author abandoned.
		if ( next !== items ) {
			setOpenIndex( null );
			onChange( next );
		}
	};

	if ( items.length === 0 ) {
		return (
			<Text
				variant="body-sm"
				render={ <p /> }
				className="wf-inspector-section__help"
			>
				{ emptyLabel }
			</Text>
		);
	}

	return (
		<DndContext
			sensors={ sensors }
			collisionDetection={ closestCenter }
			onDragEnd={ handleDragEnd }
		>
			<Stack
				render={ <ul /> }
				direction="column"
				gap="xs"
				className="wf-inspector__facts wf-inspector-field-list"
			>
				<SortableContext
					items={ items.map( sortId ) }
					strategy={ verticalListSortingStrategy }
				>
					{ items.map( ( item, index ) => (
						<FieldRow
							key={ sortId( item, index ) }
							id={ sortId( item, index ) }
							item={ item }
							index={ index }
							problem={ problems[ index ] }
							describe={ describe }
							renderConfig={ renderConfig }
							isOpen={ openIndex === index }
							onToggle={ ( target ) =>
								setOpenIndex( ( open ) =>
									open === target ? null : target
								)
							}
							onCloseConfig={ () => setOpenIndex( null ) }
							onUpdate={ updateItem }
							onRemove={ removeItem }
							removeLabel={ removeLabel }
						/>
					) ) }
				</SortableContext>
			</Stack>
		</DndContext>
	);
}

/**
 * The Add control for a field list, for a section's `actions` slot.
 *
 * Exported separately because it belongs in the section's heading rather than
 * inside the list — a list with nothing in it still has to be addable to, and a
 * button below an empty-state sentence reads as part of the sentence.
 *
 * The choice is made before there is a row: what KIND of field to add, or which
 * of the things this site offers. An option can be present and disabled — a
 * transition already carrying its one assignment — which says the kind exists
 * and is spoken for. That is the only thing `disabled` says here: something the
 * site cannot offer at all is left out by the caller rather than greyed out,
 * because a barred entry reads as a capability withheld from the reader.
 *
 * **That reverses an earlier decision, and the reversal is the decision.** A
 * tool switched off site-wide used to be listed barred, on the reasoning that an
 * author looking for a tool that had quietly vanished is owed the reason rather
 * than a shorter menu — and its reason names Workflows → Tools, a screen the
 * author can go and act on, which is more than an unconfigured notification
 * channel's absence offers. It lost on where a reason has to be to be worth
 * anything. On the menu it reaches only the author who opens the picker and
 * scrolls to that entry, and charges every other author a list of things they
 * cannot have; on a row it reaches the author whose transition is actually
 * carrying the broken tool. So the reason moved to the row — a tool the
 * transition already requires still says on its own row why it will not run —
 * and this menu was left to say only what can be added.
 *
 * `description` is one line under the option's name, where a catalogue's entries
 * say what they are.
 *
 * One option collapses to one button, but only when there is nothing to read
 * about it. A menu exists so an author can read before choosing; an option
 * carrying a description — or a reason it is barred — has something to be read,
 * and a bare `+` that silently commits to it would be answering a question it
 * never asked.
 *
 * @param {Object}   props            Component props.
 * @param {Array}    props.addOptions What can be added: `{ label, value, description?, disabled? }`.
 * @param {Function} props.onAdd      Adds one: ( optionValue ).
 * @param {string}   props.label      Accessible name for the control.
 * @return {JSX.Element} The add control.
 */
export function InspectorFieldListAdd( { addOptions, onAdd, label } ) {
	const [ only ] = addOptions;

	if ( 1 === addOptions.length && ! only.description && ! only.disabled ) {
		return (
			<Button
				icon={ plus }
				label={ label }
				showTooltip
				size="small"
				onClick={ () => onAdd( only.value ) }
			/>
		);
	}

	return (
		<DropdownMenu
			icon={ plus }
			label={ label }
			toggleProps={ { size: 'small', showTooltip: true } }
		>
			{ /*
			 * `MenuItem`s of our own rather than the `controls` prop, which
			 * renders a plain `Button` per entry and has nowhere to put the
			 * line under the name. Closing the menu is ours to do here, in the
			 * order `controls` did it: shut first, so focus is already on its
			 * way back to the toggle before the list grows a row.
			 */ }
			{ ( { onClose } ) =>
				addOptions.map( ( option ) => (
					<MenuItem
						key={ option.value }
						info={ option.description }
						disabled={ Boolean( option.disabled ) }
						onClick={ () => {
							onClose();
							onAdd( option.value );
						} }
					>
						{ option.label }
					</MenuItem>
				) )
			}
		</DropdownMenu>
	);
}
