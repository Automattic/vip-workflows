/**
 * Unit tests for the sequence identity fields — name, description, active.
 *
 * Both sequence-level inspector panels open with the same three controls: the
 * workflow one (`SequenceSettingsInspector`) and the shorter phase one that
 * `Inspector` renders inline. They were once written twice and drifted, the
 * phase copy losing its placeholders and the "Active" help text. These tests
 * pin the group to one shape across both panels, and pin the one difference
 * that is deliberate — the name's example, which names the kind of sequence
 * being written.
 *
 * @package
 */

import { render, screen, fireEvent } from './helpers/render-wp-component';

import Inspector from '../../src/admin/components/graph/Inspector';

const ACTIVE_HELP =
	'Inactive sequences are saved as drafts and not applied to content.';
const DESCRIPTION_PLACEHOLDER = 'What is this workflow for?';

const STAGES = [
	{
		key: 'draft',
		label: 'Draft',
		status: 'draft',
		region_entry: true,
		transitions: [],
	},
];

function renderSettings( { isPhase, ...settings } = {} ) {
	const onNameChange = jest.fn();
	const onActiveChange = jest.fn();

	render(
		<Inspector
			selection={ null }
			isPhase={ Boolean( isPhase ) }
			stages={ STAGES }
			selectedStage={ null }
			selectedTransition={ null }
			availableAgents={ [] }
			availableRoles={ [] }
			availableTools={ [] }
			availableChannels={ [] }
			onUpdateStage={ () => {} }
			onDeleteStage={ () => {} }
			onUpdateTransition={ () => {} }
			onDeleteTransition={ () => {} }
			sequenceSettings={ {
				name: 'Editorial Review',
				onNameChange,
				description: '',
				onDescriptionChange: () => {},
				isActive: true,
				onActiveChange,
				postTypes: [ { label: 'Posts', value: 'post' } ],
				selectedPostTypes: [ 'post' ],
				onTogglePostType: () => {},
				metadataFields: [],
				onMetadataChange: () => {},
				isNew: false,
				onDelete: () => {},
				deleting: false,
				...settings,
			} }
		/>
	);

	return { onNameChange, onActiveChange };
}

const nameField = () => screen.getByRole( 'textbox', { name: 'Name' } );
const descriptionField = () =>
	screen.getByRole( 'textbox', { name: 'Description' } );

describe.each( [
	[ 'workflow sequence', false, 'e.g. Editorial Review' ],
	[ 'phase sequence', true, 'e.g. Ideation Gate' ],
] )( 'Sequence identity fields (%s)', ( _label, isPhase, namePlaceholder ) => {
	it( 'shows the three identity controls', () => {
		renderSettings( { isPhase } );

		expect( nameField() ).toHaveValue( 'Editorial Review' );
		expect( descriptionField() ).toBeInTheDocument();
		expect(
			screen.getByRole( 'checkbox', { name: 'Active' } )
		).toBeChecked();
	} );

	it( 'prompts the author with placeholders and the Active help text', () => {
		renderSettings( { isPhase } );

		expect( nameField() ).toHaveAttribute( 'placeholder', namePlaceholder );
		expect( descriptionField() ).toHaveAttribute(
			'placeholder',
			DESCRIPTION_PLACEHOLDER
		);
		expect( screen.getByText( ACTIVE_HELP ) ).toBeInTheDocument();
	} );

	it( 'reports edits back to the sequence', () => {
		const { onNameChange, onActiveChange } = renderSettings( { isPhase } );

		fireEvent.change( nameField(), { target: { value: 'Newsroom' } } );
		expect( onNameChange ).toHaveBeenCalledWith( 'Newsroom' );

		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Active' } ) );
		expect( onActiveChange ).toHaveBeenCalledWith( false );
	} );

	it( 'falls back to a placeholder title while the sequence is unnamed', () => {
		renderSettings( { isPhase, name: '' } );

		expect(
			screen.getByRole( 'heading', { name: 'Untitled sequence' } )
		).toBeInTheDocument();
	} );
} );

describe( 'Sequence settings panels beyond the shared identity group', () => {
	it( 'offers post types and metadata on a workflow sequence', () => {
		renderSettings( { isPhase: false } );

		expect(
			screen.getByRole( 'checkbox', { name: 'Posts' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: /Metadata fields/ } )
		).toBeInTheDocument();
	} );

	it( 'omits them on a phase sequence, which has neither', () => {
		renderSettings( { isPhase: true } );

		expect(
			screen.queryByRole( 'checkbox', { name: 'Posts' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: /Metadata fields/ } )
		).not.toBeInTheDocument();
	} );
} );
