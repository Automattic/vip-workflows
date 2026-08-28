/**
 * Unit tests for the sentence that describes a workflow event.
 *
 * Stage keys are minted by the sequence editor as `status_1`, `status_2`, … and
 * never change when the author renames the stage, so any description that prints
 * the key reads as "status 3" instead of the stage's name. Every event that names
 * a stage carries a label snapshotted at write time; these tests pin that the
 * snapshot is what renders, and that the key is used only when there is none.
 *
 * They also pin what the description is and is not responsible for: the sequence
 * is a field of its own, and the input a transition collected is read from the
 * ellipsis menu, so neither belongs in the sentence — while prose the event
 * carries (a comment, a refusal's reason, an error) does.
 *
 * eventDescription is shared: the audit log and the editor's history modal both
 * describe their events with it, so these cover both surfaces.
 */

import {
	eventDescription,
	eventSummary,
} from '../../src/common/event-description';

const describeEvent = ( eventType, eventData ) =>
	eventDescription( { event_type: eventType, event_data: eventData } );

describe( 'eventDescription stage labels', () => {
	it( 'names the snapshotted labels for a status transition', () => {
		const out = describeEvent( 'status_transition', {
			from_status: 'status_1',
			to_status: 'status_3',
			from_label: 'Ideas',
			to_label: 'Legal Hold',
		} );

		expect( out ).toBe( 'Stage changed from Ideas to Legal Hold' );
	} );

	it( 'names the snapshotted labels for a blocked transition', () => {
		const out = describeEvent( 'transition_blocked', {
			from_status: 'status_1',
			to_status: 'status_3',
			from_label: 'Ideas',
			to_label: 'Legal Hold',
			reason: 'Transition blocked by required checks.',
		} );

		expect( out ).toContain( 'Ideas' );
		expect( out ).toContain( 'Legal Hold' );
		expect( out ).not.toContain( 'status_1' );
		expect( out ).not.toContain( 'status_3' );
	} );

	it( 'names the snapshotted target label for tool warnings', () => {
		const out = describeEvent( 'tool_warnings', {
			to_status: 'status_4',
			to_label: 'Fact Check',
			warnings: [ { tool: 'x', message: 'y' } ],
		} );

		expect( out ).toContain( 'Fact Check' );
		expect( out ).not.toContain( 'status_4' );
	} );

	it( 'names the snapshotted initial stage label for an assignment', () => {
		const out = describeEvent( 'workflow.assigned', {
			sequence_name: 'Label Snapshot Flow',
			initial_stage: 'status_1',
			initial_stage_label: 'Ideas',
		} );

		expect( out ).toContain( 'Ideas' );
		expect( out ).not.toContain( 'status_1' );
	} );

	it( 'falls back to the stage key only when no label was snapshotted', () => {
		const out = describeEvent( 'status_transition', {
			from_status: 'status_1',
			to_status: 'status_3',
			from_label: null,
			to_label: null,
		} );

		expect( out ).toBe( 'Stage changed from status_1 to status_3' );
	} );
} );

describe( 'eventDescription scope', () => {
	it( 'folds a transition comment into the sentence', () => {
		const out = describeEvent( 'status_transition', {
			from_label: 'Ideas',
			to_label: 'Copy Desk',
			comment: 'Ready for a second pass',
		} );

		expect( out ).toBe(
			'Stage changed from Ideas to Copy Desk — “Ready for a second pass”'
		);
	} );

	it( 'follows a refusal with the reason behind it', () => {
		const out = describeEvent( 'transition_blocked', {
			from_label: 'Ideas',
			to_label: 'Copy Desk',
			reason: 'Two required checks failed.',
		} );

		expect( out ).toBe(
			'Transition from Ideas to Copy Desk was blocked: Two required checks failed.'
		);
	} );

	it( 'counts the failed checks only where nothing wrote a reason', () => {
		const eventData = {
			from_label: 'Ideas',
			to_label: 'Copy Desk',
			hard_failures: [ { tool: 'a' }, { tool: 'b' } ],
		};

		expect( describeEvent( 'transition_blocked', eventData ) ).toBe(
			'Transition from Ideas to Copy Desk was blocked: 2 failed checks'
		);
		expect(
			describeEvent( 'transition_blocked', {
				...eventData,
				reason: 'Two required checks failed.',
			} )
		).toBe(
			'Transition from Ideas to Copy Desk was blocked: Two required checks failed.'
		);
	} );

	// Every composed description is a full sentence in sentence case that names
	// the kind of event as well as what it did, so it stands on its own under a
	// title that is the post rather than the event.
	it( 'reads as a natural sentence for every event kind', () => {
		expect(
			describeEvent( 'stage.copy_desk.entered', {
				to_label: 'Copy Desk',
			} )
		).toBe( 'Entered the Copy Desk stage' );
		expect(
			describeEvent( 'stage.copy_desk.completed', {
				from_label: 'Copy Desk',
			} )
		).toBe( 'Completed the Copy Desk stage' );
		expect(
			describeEvent( 'workflow.assigned', {
				initial_stage: 'status_1',
				initial_stage_label: 'Ideas',
			} )
		).toBe( 'Assigned to the workflow at the Ideas stage' );
		expect( describeEvent( 'post.released', {} ) ).toBe(
			'Released back to the queue'
		);
		expect(
			describeEvent( 'tool_warnings', {
				to_label: 'Copy Desk',
				warnings: [ {}, {} ],
			} )
		).toBe( 'Transition to Copy Desk raised 2 warnings' );
		expect(
			describeEvent( 'ability.executed', {
				ability_id: 'acme/excerpt',
				output: { score: 7 },
			} )
		).toBe( 'Ran acme/excerpt (score: 7)' );
		expect(
			describeEvent( 'sequence.updated', { statuses_count: 5 } )
		).toBe( 'Sequence updated, now 5 stages' );
		// The lifecycle slugs on the payload (`draft`/`active`) are machine
		// vocabulary, so the sentence names the direction and stops.
		expect(
			describeEvent( 'sequence.activated', {
				previous_status: 'draft',
				sequence_status: 'active',
			} )
		).toBe( 'Sequence activated' );
		expect(
			describeEvent( 'sequence.deactivated', {
				previous_status: 'active',
				sequence_status: 'draft',
			} )
		).toBe( 'Sequence deactivated' );
	} );

	it( 'follows a failed ability with its error', () => {
		expect(
			describeEvent( 'ability.failed', {
				ability_id: 'acme/excerpt',
				error: 'model returned no content',
			} )
		).toBe( 'acme/excerpt failed: model returned no content' );
	} );

	// The sequence is a field of its own now, in the meta row under the
	// description, so restating it per event type would print it twice.
	it( 'leaves the sequence to the Workflow field', () => {
		const withSequence = [
			[ 'status_transition', { from_label: 'A', to_label: 'B' } ],
			[ 'post.stage_changed', { from_label: 'A', to_label: 'B' } ],
			[ 'stage.copy_desk.entered', { to_label: 'Copy Desk' } ],
			[ 'stage.copy_desk.completed', { from_label: 'Copy Desk' } ],
			[ 'post.published', {} ],
			[ 'workflow.assigned', { initial_stage_label: 'Ideas' } ],
			[ 'workflow.removed', {} ],
		];

		withSequence.forEach( ( [ eventType, eventData ] ) => {
			expect(
				describeEvent( eventType, {
					...eventData,
					sequence_name: 'Editorial Sequence',
				} )
			).not.toContain( 'Editorial Sequence' );
		} );
	} );

	// The answers are free text and would swamp a stream; the entry offers them
	// as an "Open notes" action instead.
	it( 'leaves the collected input to the notes action', () => {
		const out = describeEvent( 'status_transition', {
			from_label: 'Ideas',
			to_label: 'Copy Desk',
			notes: [ { label: 'Assignee', value: 'Ada Lovelace' } ],
		} );

		expect( out ).toBe( 'Stage changed from Ideas to Copy Desk' );
	} );

	// eventSummary() names such an event and stops there.
	it( 'says nothing where the fields have said it all', () => {
		expect(
			describeEvent( 'workflow.removed', {
				sequence_name: 'Editorial Sequence',
			} )
		).toBe( '' );
		expect( describeEvent( 'acme.some_extension_event', {} ) ).toBe( '' );
	} );
} );

describe( 'eventSummary', () => {
	const summarise = ( eventType, label, eventData ) =>
		eventSummary( {
			event_type: eventType,
			event_type_label: label,
			event_data: eventData,
		} );

	// The entry's title is the post it happened to, so the kind of event has to
	// be said in the description rather than standing over it as a heading.
	it( 'says what the event did in one sentence that names its kind', () => {
		expect(
			summarise( 'status_transition', 'Stage Changed', {
				from_label: 'In Review',
				to_label: 'Published',
			} )
		).toBe( 'Stage changed from In Review to Published' );
	} );

	it( 'falls back to the name where there is nothing to say', () => {
		// Rather than leaving the description slot empty.
		expect(
			summarise( 'workflow.removed', 'Workflow Removed', {
				sequence_name: 'Editorial Sequence',
			} )
		).toBe( 'Workflow Removed' );
	} );

	// So the slot is never empty, whatever the event turns out to be.
	it( 'always has the event type to fall back on', () => {
		expect( summarise( 'acme.unknown', 'acme.unknown', {} ) ).toBe(
			'acme.unknown'
		);
	} );
} );
