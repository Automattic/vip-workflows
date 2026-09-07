/**
 * Unit tests for the shared workflow side-effect decision table.
 *
 * `evaluateStatusChange()` is the client half of a rule whose server half is
 * `StatusManager::crosses_publish_boundary()` / `PublishBoundaryGuard`. Three
 * surfaces consume it — the block editor's `editor.preSavePost` guard, the Quick
 * Edit preflight and the Bulk Edit preflight — and they must not reach different
 * answers about the same change. These tests pin the cases where the two halves
 * previously disagreed: a stage region that will not resolve, and `inherit`.
 */

import {
	DECISION_SILENT,
	DECISION_VETO,
	DECISION_WARN,
	evaluateStatusChange,
	getAgentInterruptWarning,
	getEntryStageLabels,
	getOrphanedWorkflowMessage,
	getRegionLabel,
	getStatusChangeWarning,
	getTransitionPublishWarning,
	getTransitionWarningsMessage,
	statusToRegion,
} from '../../src/entries/confirm-workflow-side-effect';

/**
 * A sequence whose draft checkpoint is NOT its first draft stage.
 *
 * That is the whole point of the fixture: the entry stage is whichever carries
 * `region_entry`, and the author may put it anywhere in the band. Copy that says
 * "the first Draft stage" describes "Idea" here, and the workflow re-seats at
 * "Writing".
 *
 * It models no `private` region, which is the other case the copy has to tell
 * the truth about: `resolve_reseat_stage()` leaves the stage alone when the
 * sequence has nowhere to put it.
 */
const STAGES = [
	{ key: 'idea', label: 'Idea', status: 'draft' },
	{ key: 'writing', label: 'Writing', status: 'draft', region_entry: true },
	{
		key: 'review',
		label: 'Editor review',
		status: 'pending',
		region_entry: true,
	},
	{
		key: 'live',
		label: 'On the site',
		status: 'publish',
		region_entry: true,
	},
];

const ENTRY_STAGES = getEntryStageLabels( STAGES );

describe( 'statusToRegion', () => {
	it( 'maps scheduling to the publish side, so it cannot route around the boundary', () => {
		expect( statusToRegion( 'future' ) ).toBe( 'publish' );
	} );

	it( "maps core's embryo of a draft to draft", () => {
		expect( statusToRegion( 'auto-draft' ) ).toBe( 'draft' );
	} );

	it( 'maps every other status to itself', () => {
		expect( statusToRegion( 'pending' ) ).toBe( 'pending' );
		expect( statusToRegion( 'private' ) ).toBe( 'private' );
	} );
} );

describe( 'evaluateStatusChange', () => {
	it( 'says nothing about a change that stays inside the current region', () => {
		expect(
			evaluateStatusChange( {
				currentRegion: 'draft',
				targetStatus: 'draft',
				canBypass: false,
			} )
		).toBe( DECISION_SILENT );
	} );

	it( 'warns about a reseat between two non-publish regions', () => {
		expect(
			evaluateStatusChange( {
				currentRegion: 'draft',
				targetStatus: 'pending',
				canBypass: false,
			} )
		).toBe( DECISION_WARN );
	} );

	it( 'vetoes a publish crossing for a non-bypass user, in both directions', () => {
		expect(
			evaluateStatusChange( {
				currentRegion: 'draft',
				targetStatus: 'publish',
				canBypass: false,
			} )
		).toBe( DECISION_VETO );
		expect(
			evaluateStatusChange( {
				currentRegion: 'publish',
				targetStatus: 'draft',
				canBypass: false,
			} )
		).toBe( DECISION_VETO );
	} );

	it( 'downgrades the veto to a confirm for a bypass user', () => {
		expect(
			evaluateStatusChange( {
				currentRegion: 'draft',
				targetStatus: 'publish',
				canBypass: true,
			} )
		).toBe( DECISION_WARN );
	} );

	it( 'treats scheduling as a publish crossing', () => {
		expect(
			evaluateStatusChange( {
				currentRegion: 'draft',
				targetStatus: 'future',
				canBypass: false,
			} )
		).toBe( DECISION_VETO );
	} );

	// `trash` and `inherit` are not regions. The server filters BOTH before its
	// region compare; the client used to filter only `trash`, so `inherit` was
	// vetoed here while the server allowed it.
	it.each( [ 'trash', 'inherit' ] )(
		'says nothing about %s, which is not a region',
		( targetStatus ) => {
			expect(
				evaluateStatusChange( {
					currentRegion: 'publish',
					targetStatus,
					canBypass: false,
				} )
			).toBe( DECISION_SILENT );
		}
	);

	// crosses_publish_boundary() fails CLOSED on a post whose stage region will
	// not resolve — it reports a crossing for EVERY target — so the client must
	// too, or the user is walked through a friendly confirm into a 409.
	describe( 'an unresolvable current region', () => {
		it.each( [ null, undefined, '' ] )(
			'vetoes every target for a non-bypass user (region: %p)',
			( currentRegion ) => {
				expect(
					evaluateStatusChange( {
						currentRegion,
						targetStatus: 'pending',
						canBypass: false,
					} )
				).toBe( DECISION_VETO );
			}
		);

		it( 'confirms instead for a bypass user, whom the server never vetoes', () => {
			expect(
				evaluateStatusChange( {
					currentRegion: null,
					targetStatus: 'pending',
					canBypass: true,
				} )
			).toBe( DECISION_WARN );
		} );

		it( 'still says nothing about trashing, which the server also allows', () => {
			expect(
				evaluateStatusChange( {
					currentRegion: null,
					targetStatus: 'trash',
					canBypass: false,
				} )
			).toBe( DECISION_SILENT );
		} );
	} );
} );

describe( 'getRegionLabel', () => {
	// An unresolved region reaches this function as null or '', and the message
	// it feeds must never render "Changing the status from null to Draft".
	it( 'never interpolates an unrecognized region into the copy', () => {
		const spy = jest
			.spyOn( console, 'error' )
			.mockImplementation( () => {} );

		expect( getRegionLabel( null ) ).not.toContain( 'null' );
		expect( getRegionLabel( '' ) ).toBe( getRegionLabel( null ) );

		spy.mockRestore();
	} );
} );

describe( 'getEntryStageLabels', () => {
	it( 'names the marked checkpoint, not the first stage of the region', () => {
		expect( ENTRY_STAGES.draft ).toBe( 'Writing' );
	} );

	it( 'leaves out a region the sequence models no checkpoint for', () => {
		expect( ENTRY_STAGES ).not.toHaveProperty( 'private' );
	} );

	it( 'names a label-less stage by its key rather than dropping the region', () => {
		const labels = getEntryStageLabels( [
			{ key: 'status_3', status: 'private', region_entry: true },
		] );

		expect( labels.private ).toBe( 'status_3' );
	} );

	it( 'survives a post that has no stages at all', () => {
		expect( getEntryStageLabels( [] ) ).toEqual( {} );
		expect( getEntryStageLabels( undefined ) ).toEqual( {} );
	} );
} );

describe( 'getStatusChangeWarning', () => {
	// Defects A and B together: the copy used to name the target REGION and call
	// the destination "the first {region} stage". A region holds many stages, and
	// the one a reseat lands on is whichever carries `region_entry`.
	it( 'names the destination stage, and never calls it the first of its region', () => {
		const message = getStatusChangeWarning( {
			currentRegion: 'pending',
			stageRegion: 'pending',
			targetStatus: 'draft',
			entryStageLabels: ENTRY_STAGES,
			agentPending: false,
		} );

		expect( message ).toContain( 'Writing' );
		expect( message ).not.toContain( 'Idea' );
		expect( message ).not.toContain( 'first' );
	} );

	// Every no-reseat case below mirrors a null return from
	// StatusManager::resolve_reseat_stage(). The copy used to promise a reseat in
	// all of them.
	describe( 'a change that re-seats nothing', () => {
		it( 'says so when the sequence models no stage in the target region', () => {
			const message = getStatusChangeWarning( {
				currentRegion: 'draft',
				stageRegion: 'draft',
				targetStatus: 'private',
				entryStageLabels: ENTRY_STAGES,
				agentPending: false,
			} );

			expect( message ).toContain(
				'leaves this post at its current workflow stage'
			);
			expect( message ).not.toContain( 're-seats' );
		} );

		// boundary_region() forces `publish` for a live post whatever its stage
		// says, so a post stranded at a draft-region stage reports `publish`
		// here — while resolve_reseat_stage() compares draft to draft and does
		// nothing. The copy has to follow the stage, not the boundary.
		it( 'says so when the stage already lives in the target region', () => {
			const message = getStatusChangeWarning( {
				currentRegion: 'publish',
				stageRegion: 'draft',
				targetStatus: 'draft',
				entryStageLabels: ENTRY_STAGES,
				agentPending: false,
			} );

			expect( message ).toContain( 'already a Draft stage' );
			expect( message ).not.toContain( 're-seats' );
			expect( message ).not.toContain( 'Writing' );
		} );
	} );

	describe( 'scheduling', () => {
		// `future` is an overlay for the reseat: the stage stays put, and cron's
		// later `future` -> `publish` is what moves it.
		it( 'names the stage the go-live will land on', () => {
			const message = getStatusChangeWarning( {
				currentRegion: 'draft',
				stageRegion: 'draft',
				targetStatus: 'future',
				entryStageLabels: ENTRY_STAGES,
				agentPending: false,
			} );

			expect( message ).toContain(
				'leaves it at its current workflow stage'
			);
			expect( message ).toContain( 'On the site' );
			expect( message ).not.toContain( 'first' );
		} );

		// The old copy asserted a Published stage without checking one exists.
		// When none does, cron publishes and the stage never moves.
		it( 'promises no Published stage when the sequence models none', () => {
			const { publish, ...withoutPublish } = ENTRY_STAGES;

			const message = getStatusChangeWarning( {
				currentRegion: 'draft',
				stageRegion: 'draft',
				targetStatus: 'future',
				entryStageLabels: withoutPublish,
				agentPending: false,
			} );

			expect( message ).toContain( 'it stays there when it goes live' );
			expect( message ).not.toContain( 'Published' );
			expect( message ).not.toContain( 're-seats' );
		} );
	} );

	// A post whose sequence row was deleted, and a post carrying a stage its
	// sequence no longer defines, both arrive with nothing resolved. A non-bypass
	// user is refused outright; a bypass user gets this confirm, and
	// resolve_managed_stage() bails before any reseat for both of them.
	describe( 'a post whose stage cannot be resolved', () => {
		it.each( [
			[ 'an orphaned post', null, undefined, {} ],
			[ 'a dangling stage key', '', '', {} ],
		] )(
			'degrades to a sentence that names no region (%s)',
			( _label, currentRegion, stageRegion, entryStageLabels ) => {
				const spy = jest
					.spyOn( console, 'error' )
					.mockImplementation( () => {} );

				const message = getStatusChangeWarning( {
					currentRegion,
					stageRegion,
					targetStatus: 'publish',
					entryStageLabels,
					agentPending: false,
				} );

				expect( message ).toContain(
					'cannot resolve this post’s workflow stage'
				);
				expect( message ).not.toContain( 'undefined' );
				expect( message ).not.toContain( 'null' );
				expect( message ).not.toContain( 're-seats' );
				// It never reaches getRegionLabel(), so there is no region to
				// complain about either.
				expect( spy ).not.toHaveBeenCalled();

				spy.mockRestore();
			}
		);
	} );

	it( 'adds the agent sentence to whatever it just said', () => {
		const message = getStatusChangeWarning( {
			currentRegion: 'draft',
			stageRegion: 'draft',
			targetStatus: 'pending',
			entryStageLabels: ENTRY_STAGES,
			agentPending: true,
		} );

		expect( message ).toContain( 'Editor review' );
		expect( message ).toContain( getAgentInterruptWarning() );
	} );
} );

describe( 'getTransitionWarningsMessage', () => {
	// `warnings_pending` is a 200 that means the transition did NOT happen. Four
	// surfaces read it — the block editor panel, the Kanban board, My Queue and
	// the Quick Edit buttons — and all four ask with this sentence.
	it( 'joins the server-supplied warnings and asks once', () => {
		const message = getTransitionWarningsMessage( [
			{ message: 'Tool A soft-failed.' },
			{ message: getAgentInterruptWarning() },
		] );

		expect( message ).toContain( 'Tool A soft-failed.' );
		expect( message ).toContain( getAgentInterruptWarning() );
		expect( message ).toContain( 'Continue anyway?' );
	} );

	it( 'still asks when the server sent no usable detail', () => {
		expect( getTransitionWarningsMessage( [] ) ).toContain(
			'Continue anyway?'
		);
		expect( getTransitionWarningsMessage( undefined ) ).toContain(
			'Continue anyway?'
		);
		// A malformed entry must not render "undefined" at the user.
		expect( getTransitionWarningsMessage( [ {} ] ) ).not.toContain(
			'undefined'
		);
	} );
} );

describe( 'getTransitionPublishWarning', () => {
	// A transition into a publish-region stage writes `publish` before the
	// stage move, so the post goes publicly live as a side effect of what
	// reads as a workflow step. The confirm names the destination stage and
	// says plainly that the post becomes public.
	it( 'names the destination stage and says the post goes public', () => {
		const message = getTransitionPublishWarning( {
			stageLabel: 'On the site',
			scheduled: false,
		} );

		expect( message ).toContain( 'On the site' );
		expect( message ).toContain( 'publicly visible' );
	} );

	// A scheduled post's stage stayed put when it was scheduled, so moving it
	// into a publish-region stage still crosses the boundary — and publishes
	// it now, overriding the schedule. That is the part the author most needs
	// to hear, so the scheduled variant says it explicitly.
	it( 'tells a scheduled post it publishes now, not at the scheduled time', () => {
		const message = getTransitionPublishWarning( {
			stageLabel: 'On the site',
			scheduled: true,
		} );

		expect( message ).toContain( 'On the site' );
		expect( message ).toContain( 'scheduled' );
		expect( message ).toContain( 'now' );
	} );
} );

describe( 'getOrphanedWorkflowMessage', () => {
	// A post whose sequence row was deleted is frozen by the save layer but has
	// no workflow left to name, so it cannot reuse the ordinary veto's copy —
	// which both names the workflow and offers to move the post through it.
	it( 'names the post, never a workflow, and points at the way out', () => {
		const message = getOrphanedWorkflowMessage( { title: 'Budget piece' } );

		expect( message ).toContain( 'Budget piece' );
		expect( message ).not.toContain( 'undefined' );
		expect( message ).toContain( 'Remove it from the workflow' );
	} );
} );

// The other half of the shared golden fixture. Its PHP twin is
// tests/phpunit/Unit/RegionMathFixtureTest.php, reading this same file — the
// rule is implemented three times across two languages and had already drifted
// twice, so it is pinned in one place rather than described in a comment.
describe( 'shared region-math fixture', () => {
	const fixture = require( '../fixtures/region-math.json' );

	it( 'carries cases for both suites', () => {
		expect( fixture.statusToRegion.length ).toBeGreaterThan( 0 );
		expect( fixture.crossesPublishBoundary.length ).toBeGreaterThan( 0 );
	} );

	it.each( fixture.statusToRegion )(
		'statusToRegion($status) is $region — $why',
		( { status, region } ) => {
			expect( statusToRegion( status ) ).toBe( region );
		}
	);

	// evaluateStatusChange() is the client's expression of the same predicate:
	// a crossing is what it refuses for a non-bypass user (VETO), and a
	// non-crossing is anything it does not (SILENT for a same-region move,
	// WARN for a reseat between two non-publish regions).
	it.each( fixture.crossesPublishBoundary )(
		'$currentRegion -> $targetStatus crosses=$crosses — $why',
		( { currentRegion, targetStatus, crosses } ) => {
			const decision = evaluateStatusChange( {
				currentRegion,
				targetStatus,
				canBypass: false,
			} );

			expect( decision === DECISION_VETO ).toBe( crosses );
		}
	);

	// The same crossings are a confirm rather than a refusal for a bypass user.
	// Whether it is a crossing is not a question of who is asking.
	it.each( fixture.crossesPublishBoundary.filter( ( c ) => c.crosses ) )(
		'$currentRegion -> $targetStatus is a confirm for a bypass user',
		( { currentRegion, targetStatus } ) => {
			expect(
				evaluateStatusChange( {
					currentRegion,
					targetStatus,
					canBypass: true,
				} )
			).toBe( DECISION_WARN );
		}
	);
} );
