/**
 * The inspector panel as the sequence editor renders it, for suites that drive
 * the panel on its own rather than through the whole editor.
 *
 * Two stages joined by one transition, and the sequence-level settings the
 * panel shows when nothing is selected. `renderInspector` selects the first
 * stage unless told otherwise, and `update` re-renders with some props changed
 * — a new selection, or a reveal.
 *
 * @package
 */

import { render, screen } from './render-wp-component';

import Inspector from '../../../src/admin/components/graph/Inspector';

export const STAGES = [
	{
		key: 'draft',
		label: 'Draft',
		status: 'draft',
		region_entry: true,
		transitions: [ { to: 'review', label: 'Submit' } ],
	},
	{ key: 'review', label: 'Review', status: 'pending', transitions: [] },
];

export const SEQUENCE_SETTINGS = {
	name: 'Editorial Review',
	onNameChange: () => {},
	description: '',
	onDescriptionChange: () => {},
	isActive: true,
	onActiveChange: () => {},
	postTypes: [ { label: 'Posts', value: 'post' } ],
	selectedPostTypes: [ 'post' ],
	onTogglePostType: () => {},
	metadataFields: [],
	onMetadataChange: () => {},
	isNew: false,
	onDelete: () => {},
	deleting: false,
};

/**
 * Render the panel with the first stage selected.
 *
 * @param {Object} overrides Props to replace.
 * @return {Object} The render result, plus `update( props )` to re-render with
 *                  some props changed.
 */
export function renderInspector( overrides = {} ) {
	const props = {
		selection: { type: 'node', key: 'draft' },
		isPhase: false,
		stages: STAGES,
		selectedStage: STAGES[ 0 ],
		selectedTransition: null,
		availableAgents: [],
		availableRoles: [],
		availableTools: [],
		availableChannels: [],
		onUpdateStage: () => {},
		onDeleteStage: () => {},
		onUpdateTransition: () => {},
		onDeleteTransition: () => {},
		sequenceSettings: SEQUENCE_SETTINGS,
		...overrides,
	};
	const view = render( <Inspector { ...props } /> );
	return {
		...view,
		update: ( next ) =>
			view.rerender( <Inspector { ...props } { ...next } /> ),
	};
}

/** The panel's collapse toggle, in either state. */
export const toggle = () =>
	screen.getByRole( 'button', { name: /Collapse panel|Expand panel/ } );

/** The panel's body, which collapsing hides. */
export const body = () => document.querySelector( '.wf-inspector__body' );
