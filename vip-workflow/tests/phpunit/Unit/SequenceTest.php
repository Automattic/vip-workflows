<?php
/**
 * Sequence unit tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\Sequences\Sequence;

/**
 * Tests for the Sequence class.
 */
class SequenceTest extends TestCase
{
    /**
     * Sample sequence config for workflow type.
     *
     * @var array
     */
    private array $workflow_config = array(
        'post_types' => array( 'post', 'page' ),
        'statuses'   => array(
            array(
                'key'          => 'draft',
                'label'        => 'Draft',
                'color'        => '#gray',
                'status'       => 'draft',
                'region_entry' => true,
                'transitions'  => array(
                    array(
                        'to'            => 'review',
                        'label'         => 'Submit for Review',
                        'allowed_roles' => array( 'author', 'editor' ),
                    ),
                ),
            ),
            array(
                'key'         => 'review',
                'label'       => 'In Review',
                'color'       => '#orange',
                'status'      => 'draft',
                'transitions' => array(
                    array(
                        'to'    => 'draft',
                        'label' => 'Send Back',
                    ),
                    array(
                        'to'            => 'published',
                        'label'         => 'Publish',
                        'allowed_roles' => array( 'editor' ),
                    ),
                ),
            ),
            array(
                'key'          => 'published',
                'label'        => 'Published',
                'color'        => '#green',
                'status'       => 'publish',
                'region_entry' => true,
                'is_terminal'  => true,
                'transitions'  => array(),
            ),
        ),
        'automations' => array(
            array(
                'id'      => 'auto-notify',
                'name'    => 'Notify on Review',
                'trigger' => 'status.review.entered',
                'actions' => array(),
            ),
        ),
    );

    /**
     * Create a Sequence instance from config.
     *
     * @param array  $config Config overrides.
     * @param string $type   Sequence type.
     * @return Sequence
     */
    private function create_sequence( array $config = array(), string $type = Sequence::TYPE_WORKFLOW ): Sequence
    {
        $merged_config = array_merge( $this->workflow_config, $config );

        $row = (object) array(
            'id'          => 1,
            'uuid'        => 'test-uuid-1234',
            'type'        => $type,
            'name'        => 'Test Sequence',
            'slug'        => 'test-sequence',
            'description' => 'A test sequence',
            'version'     => 1,
            'status'      => 'active',
            'config'      => json_encode( $merged_config ),
            'created_by'  => 1,
            'created_at'  => '2026-01-01 00:00:00',
            'updated_at'  => '2026-01-01 00:00:00',
        );

        return Sequence::from_row( $row );
    }

    /**
     * Test Sequence::from_row creates instance correctly.
     */
    public function test_from_row_creates_instance(): void
    {
        $sequence = $this->create_sequence();

        $this->assertSame( 1, $sequence->id );
        $this->assertSame( 'test-uuid-1234', $sequence->uuid );
        $this->assertSame( Sequence::TYPE_WORKFLOW, $sequence->type );
        $this->assertSame( 'Test Sequence', $sequence->name );
        $this->assertSame( 'test-sequence', $sequence->slug );
        $this->assertSame( 1, $sequence->version );
        $this->assertSame( 'active', $sequence->status );
    }

    /**
     * Test type checking methods.
     */
    public function test_type_checking(): void
    {
        $workflow = $this->create_sequence( array(), Sequence::TYPE_WORKFLOW );
        $phase    = $this->create_sequence( array(), Sequence::TYPE_PHASE );

        $this->assertTrue( $workflow->is_workflow() );
        $this->assertFalse( $phase->is_workflow() );
    }

    /**
     * Test get_post_types returns configured types.
     */
    public function test_get_post_types(): void
    {
        $sequence = $this->create_sequence();

        $this->assertSame( array( 'post', 'page' ), $sequence->get_post_types() );
    }

    /**
     * Test get_post_types returns default when not configured.
     */
    public function test_get_post_types_default(): void
    {
        $sequence = $this->create_sequence( array( 'post_types' => null ) );

        $this->assertSame( array( 'post' ), $sequence->get_post_types() );
    }

    /**
     * Test get_statuses returns all statuses.
     */
    public function test_get_statuses(): void
    {
        $sequence = $this->create_sequence();
        $statuses  = $sequence->get_statuses();

        $this->assertCount( 3, $statuses );
        $this->assertSame( 'draft', $statuses[0]['key'] );
        $this->assertSame( 'review', $statuses[1]['key'] );
        $this->assertSame( 'published', $statuses[2]['key'] );
    }

    /**
     * Test get_status returns specific status.
     */
    public function test_get_status(): void
    {
        $sequence = $this->create_sequence();

        $status = $sequence->get_status( 'review' );

        $this->assertNotNull( $status );
        $this->assertSame( 'review', $status['key'] );
        $this->assertSame( 'In Review', $status['label'] );
    }

    /**
     * Test get_status returns null for non-existent status.
     */
    public function test_get_status_not_found(): void
    {
        $sequence = $this->create_sequence();

        $this->assertNull( $sequence->get_status( 'nonexistent' ) );
    }

    /**
     * Test get_initial_status returns first status for workflow.
     */
    public function test_get_initial_status_workflow(): void
    {
        $sequence = $this->create_sequence();

        $this->assertSame( 'draft', $sequence->get_initial_status() );
    }

    /**
     * Test get_initial_status honors an explicit is_initial flag over first-status.
     */
    public function test_get_initial_status_honors_is_initial_flag(): void
    {
        $sequence = $this->create_sequence(
            array(
                'statuses' => array(
                    array( 'key' => 'draft', 'label' => 'Draft' ),
                    array( 'key' => 'intake', 'label' => 'Intake', 'is_initial' => true ),
                    array( 'key' => 'published', 'label' => 'Published', 'is_terminal' => true ),
                ),
            )
        );

        $this->assertSame( 'intake', $sequence->get_initial_status() );
    }

    /**
     * Test get_transitions returns transitions for status.
     */
    public function test_get_transitions(): void
    {
        $sequence   = $this->create_sequence();
        $transitions = $sequence->get_transitions( 'draft' );

        $this->assertCount( 1, $transitions );
        $this->assertSame( 'review', $transitions[0]['to'] );
    }

    /**
     * Test get_transitions returns empty for terminal status.
     */
    public function test_get_transitions_terminal(): void
    {
        $sequence   = $this->create_sequence();
        $transitions = $sequence->get_transitions( 'published' );

        $this->assertEmpty( $transitions );
    }

    /**
     * Test is_transition_allowed for valid transition.
     */
    public function test_is_transition_allowed_valid(): void
    {
        $sequence = $this->create_sequence();

        $this->assertTrue( $sequence->is_transition_allowed( 'draft', 'review' ) );
        $this->assertTrue( $sequence->is_transition_allowed( 'review', 'published' ) );
        $this->assertTrue( $sequence->is_transition_allowed( 'review', 'draft' ) );
    }

    /**
     * Test is_transition_allowed for invalid transition.
     */
    public function test_is_transition_allowed_invalid(): void
    {
        $sequence = $this->create_sequence();

        $this->assertFalse( $sequence->is_transition_allowed( 'draft', 'published' ) );
        $this->assertFalse( $sequence->is_transition_allowed( 'published', 'draft' ) );
    }

    /**
     * Test get_transition returns transition config.
     */
    public function test_get_transition(): void
    {
        $sequence  = $this->create_sequence();
        $transition = $sequence->get_transition( 'draft', 'review' );

        $this->assertNotNull( $transition );
        $this->assertSame( 'review', $transition['to'] );
        $this->assertSame( 'Submit for Review', $transition['label'] );
    }

    /**
     * Test get_transition returns null for invalid transition.
     */
    public function test_get_transition_invalid(): void
    {
        $sequence = $this->create_sequence();

        $this->assertNull( $sequence->get_transition( 'draft', 'published' ) );
    }

    /**
     * Test is_terminal_status.
     */
    public function test_is_terminal_status(): void
    {
        $sequence = $this->create_sequence();

        $this->assertTrue( $sequence->is_terminal_status( 'published' ) );
        $this->assertFalse( $sequence->is_terminal_status( 'draft' ) );
    }

    /**
     * Test is_active.
     */
    public function test_is_active(): void
    {
        $active = $this->create_sequence();
        $this->assertTrue( $active->is_active() );

        $row = (object) array(
            'id'          => 2,
            'uuid'        => 'test-uuid-archived',
            'type'        => Sequence::TYPE_WORKFLOW,
            'name'        => 'Archived',
            'slug'        => 'archived',
            'description' => '',
            'version'     => 1,
            'status'      => 'archived',
            'config'      => '{}',
            'created_by'  => 1,
            'created_at'  => '2026-01-01 00:00:00',
            'updated_at'  => '2026-01-01 00:00:00',
        );

        $archived = Sequence::from_row( $row );
        $this->assertFalse( $archived->is_active() );
    }

    /**
     * Test get_automations returns automations config.
     */
    public function test_get_automations(): void
    {
        $sequence   = $this->create_sequence();
        $automations = $sequence->get_automations();

        $this->assertCount( 1, $automations );
        $this->assertSame( 'auto-notify', $automations[0]['id'] );
    }

    /**
     * Test to_array returns full sequence data.
     */
    public function test_to_array(): void
    {
        $sequence = $this->create_sequence();
        $array     = $sequence->to_array();

        $this->assertSame( 1, $array['id'] );
        $this->assertSame( 'test-uuid-1234', $array['uuid'] );
        $this->assertSame( 'Test Sequence', $array['name'] );
        $this->assertArrayHasKey( 'config', $array );
        $this->assertIsArray( $array['config'] );
    }

    /**
     * Test status flags (creates_post, dead_end).
     */
    public function test_status_flags(): void
    {
        $config = array(
            'statuses' => array(
                array(
                    'key'   => 'submitted',
                    'label' => 'Submitted',
                ),
                array(
                    'key'          => 'approved',
                    'label'        => 'Approved',
                    'creates_post' => true,
                ),
                array(
                    'key'         => 'rejected',
                    'label'       => 'Rejected',
                    'is_dead_end' => true,
                ),
            ),
        );

        $sequence = $this->create_sequence( $config, Sequence::TYPE_WORKFLOW );

        $this->assertTrue( $sequence->status_creates_post( 'approved' ) );
        $this->assertFalse( $sequence->status_creates_post( 'submitted' ) );

        $this->assertTrue( $sequence->is_dead_end_status( 'rejected' ) );
        $this->assertFalse( $sequence->is_dead_end_status( 'approved' ) );

        $dead_ends = $sequence->get_dead_end_statuses();
        $this->assertCount( 1, $dead_ends );
    }

    /**
     * Test get_metadata_fields returns empty array when not configured.
     */
    public function test_get_metadata_fields_empty(): void
    {
        $sequence = $this->create_sequence();
        $this->assertSame( [], $sequence->get_metadata_fields() );
    }

    /**
     * Test get_metadata_fields returns configured fields.
     */
    public function test_get_metadata_fields_returns_fields(): void
    {
        $fields = [
            [ 'key' => 'section', 'label' => 'Section', 'type' => 'text', 'required' => false, 'searchable' => false ],
            [ 'key' => 'embargo_date', 'label' => 'Embargo Date', 'type' => 'date', 'required' => true, 'searchable' => false ],
        ];

        $sequence = $this->create_sequence( [ 'metadata_fields' => $fields ] );

        $this->assertSame( $fields, $sequence->get_metadata_fields() );
    }

    /**
     * Test get_metadata_fields returns empty array when metadata_fields is explicitly empty.
     */
    public function test_get_metadata_fields_explicit_empty(): void
    {
        $sequence = $this->create_sequence( [ 'metadata_fields' => [] ] );
        $this->assertSame( [], $sequence->get_metadata_fields() );
    }

    /**
     * Test get_metadata_fields_with_meta_keys attaches wf_meta_{id}_{key} keys.
     */
    public function test_get_metadata_fields_with_meta_keys(): void
    {
        $fields = [
            [ 'key' => 'section', 'label' => 'Section', 'type' => 'text', 'required' => false, 'searchable' => false ],
            [ 'key' => 'embargo_date', 'label' => 'Embargo Date', 'type' => 'date', 'required' => true, 'searchable' => false ],
        ];

        $sequence = $this->create_sequence( [ 'metadata_fields' => $fields ] );
        $result    = $sequence->get_metadata_fields_with_meta_keys();

        $this->assertCount( 2, $result );
        $this->assertSame( 'wf_meta_1_section', $result[0]['meta_key'] );
        $this->assertSame( 'wf_meta_1_embargo_date', $result[1]['meta_key'] );
        // Original field config is preserved alongside the meta_key.
        $this->assertSame( 'Section', $result[0]['label'] );
        $this->assertSame( 'date', $result[1]['type'] );
    }

    /**
     * Test get_metadata_fields_with_meta_keys returns empty array when none configured.
     */
    public function test_get_metadata_fields_with_meta_keys_empty(): void
    {
        $sequence = $this->create_sequence();
        $this->assertSame( [], $sequence->get_metadata_fields_with_meta_keys() );
    }

    /**
     * Test get_reviewer_roles returns configured roles.
     */
    public function test_get_reviewer_roles(): void
    {
        $config    = array( 'reviewer_roles' => array( 'editor', 'admin' ) );
        $sequence = $this->create_sequence( $config );

        $this->assertSame( array( 'editor', 'admin' ), $sequence->get_reviewer_roles() );
    }

    /**
     * Test get_reviewer_roles returns defaults.
     */
    public function test_get_reviewer_roles_default(): void
    {
        $sequence = $this->create_sequence();

        $this->assertSame( array( 'editor', 'administrator' ), $sequence->get_reviewer_roles() );
    }

    // =========================================================================
    // Stage × status matrix
    // =========================================================================

    /**
     * get_stage_status returns the region each stage lives in.
     */
    public function test_get_stage_status_returns_region(): void
    {
        $sequence = $this->create_sequence();

        $this->assertSame( 'draft', $sequence->get_stage_status( 'draft' ) );
        $this->assertSame( 'draft', $sequence->get_stage_status( 'review' ) );
        $this->assertSame( 'publish', $sequence->get_stage_status( 'published' ) );
    }

    /**
     * An undefined stage key (a dangling reference) is a data-integrity error.
     */
    public function test_get_stage_status_throws_on_undefined_stage(): void
    {
        $sequence = $this->create_sequence();

        $this->expectException( \InvalidArgumentException::class );
        $sequence->get_stage_status( 'not-a-real-stage' );
    }

    /**
     * A defined stage missing its `status` region (pre-gate data) is a
     * data-integrity error — never silently defaulted at read time.
     */
    public function test_get_stage_status_throws_when_region_missing(): void
    {
        $sequence = $this->create_sequence( array(
            'statuses' => array(
                array( 'key' => 'orphan', 'label' => 'Orphan', 'transitions' => array() ),
            ),
        ) );

        $this->expectException( \InvalidArgumentException::class );
        $sequence->get_stage_status( 'orphan' );
    }

    /**
     * get_region_entry_stage returns the marked checkpoint of a used region and
     * null for a region the sequence doesn't use.
     */
    public function test_get_region_entry_stage(): void
    {
        $sequence = $this->create_sequence();

        $this->assertSame( 'draft', $sequence->get_region_entry_stage( 'draft' ) );
        $this->assertSame( 'published', $sequence->get_region_entry_stage( 'publish' ) );
        $this->assertNull( $sequence->get_region_entry_stage( 'pending' ), 'Unused region has no entry.' );
        $this->assertNull( $sequence->get_region_entry_stage( 'private' ) );
    }

    /**
     * A used region with no marked entry is a data-integrity error — the write
     * gate guarantees the marker on everything it stored.
     */
    public function test_get_region_entry_stage_throws_when_used_region_has_no_entry(): void
    {
        $sequence = $this->create_sequence( array(
            'statuses' => array(
                array( 'key' => 'a', 'label' => 'A', 'status' => 'draft', 'transitions' => array() ),
                array( 'key' => 'b', 'label' => 'B', 'status' => 'draft', 'transitions' => array() ),
            ),
        ) );

        $this->expectException( \InvalidArgumentException::class );
        $sequence->get_region_entry_stage( 'draft' );
    }

    /**
     * get_stages_in_region returns the stage configs living in a region, in
     * sequence order, and an empty array for an unused region.
     */
    public function test_get_stages_in_region(): void
    {
        $sequence = $this->create_sequence();

        $draft_stages = $sequence->get_stages_in_region( 'draft' );
        $this->assertCount( 2, $draft_stages );
        $this->assertSame( array( 'draft', 'review' ), array_column( $draft_stages, 'key' ) );

        $publish_stages = $sequence->get_stages_in_region( 'publish' );
        $this->assertSame( array( 'published' ), array_column( $publish_stages, 'key' ) );

        $this->assertSame( array(), $sequence->get_stages_in_region( 'pending' ) );
    }

    /**
     * is_region_crossing compares the endpoint stages' regions.
     */
    public function test_is_region_crossing(): void
    {
        $sequence = $this->create_sequence();

        $this->assertFalse( $sequence->is_region_crossing( 'draft', 'review' ), 'Same-region move.' );
        $this->assertTrue( $sequence->is_region_crossing( 'review', 'published' ), 'draft → publish crossing.' );
        $this->assertTrue( $sequence->is_region_crossing( 'published', 'draft' ), 'publish → draft crossing.' );
    }

    /**
     * Active stage keys exclude terminal and dead-end stages.
     */
    public function test_get_active_stage_keys(): void
    {
        $sequence = $this->create_sequence();

        // published is is_terminal in the default fixture.
        $this->assertSame( array( 'draft', 'review' ), $sequence->get_active_stage_keys() );
    }

    // =========================================================================
    // Write gate — prepare_config_for_write
    // =========================================================================

    /**
     * Re-stub sanitize_key with WordPress's real semantics (lowercase FIRST,
     * then strip). The TestCase stub strips before lowercasing, which silently
     * deletes uppercase characters — the normalization tests below exercise
     * case-folding, so they need the faithful order.
     */
    private function stub_real_sanitize_key(): void
    {
        Functions\when( 'sanitize_key' )->alias(
            fn( $key ) => preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $key ) )
        );
    }

    /**
     * The gate sanitize_key-normalizes stage keys AND transition targets
     * consistently, so no write path (import included) can store unnormalized
     * identities.
     */
    public function test_gate_normalizes_stage_keys_and_transition_targets(): void
    {
        $this->stub_real_sanitize_key();

        $config = Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array(
                    'key'         => 'First Stage',
                    'label'       => 'First',
                    'transitions' => array( array( 'to' => 'Second Stage', 'label' => 'Next' ) ),
                ),
                array( 'key' => 'Second Stage', 'label' => 'Second' ),
            ),
        ) );

        $this->assertSame( 'firststage', $config['statuses'][0]['key'] );
        $this->assertSame( 'secondstage', $config['statuses'][1]['key'] );
        $this->assertSame( 'secondstage', $config['statuses'][0]['transitions'][0]['to'] );
    }

    /**
     * A missing `status` region defaults to 'draft' at write time (write-time
     * normalization, never a read-time fallback).
     */
    public function test_gate_defaults_missing_status_to_draft(): void
    {
        $config = Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'writing', 'label' => 'Writing' ),
            ),
        ) );

        $this->assertSame( 'draft', $config['statuses'][0]['status'] );
    }

    /**
     * A present-but-invalid `status` region is rejected — overlays (future/trash)
     * and arbitrary strings are not matrix members.
     */
    public function test_gate_rejects_invalid_status_region(): void
    {
        $this->expectException( \InvalidArgumentException::class );

        Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'scheduled', 'label' => 'Scheduled', 'status' => 'future' ),
            ),
        ) );
    }

    /**
     * A non-string `status` value is rejected, not coerced.
     */
    public function test_gate_rejects_non_string_status_region(): void
    {
        $this->expectException( \InvalidArgumentException::class );

        Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'writing', 'label' => 'Writing', 'status' => true ),
            ),
        ) );
    }

    /**
     * When a used region has no marked entry, the gate auto-assigns the first
     * stage (array order) in that region.
     */
    public function test_gate_auto_assigns_first_in_region_as_entry(): void
    {
        $config = Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'writing', 'label' => 'Writing', 'status' => 'draft' ),
                array( 'key' => 'editing', 'label' => 'Editing', 'status' => 'draft' ),
                array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish' ),
                array( 'key' => 'promoted', 'label' => 'Promoted', 'status' => 'publish' ),
            ),
        ) );

        $this->assertTrue( $config['statuses'][0]['region_entry'], 'First draft-region stage becomes the draft checkpoint.' );
        $this->assertArrayNotHasKey( 'region_entry', $config['statuses'][1] );
        $this->assertTrue( $config['statuses'][2]['region_entry'], 'First publish-region stage becomes the publish checkpoint.' );
        $this->assertArrayNotHasKey( 'region_entry', $config['statuses'][3] );
    }

    /**
     * An explicit region_entry marker is honored (no auto-assignment on top),
     * and falsy markers are normalized away.
     */
    public function test_gate_honors_explicit_region_entry(): void
    {
        $config = Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'writing', 'label' => 'Writing', 'status' => 'draft', 'region_entry' => false ),
                array( 'key' => 'editing', 'label' => 'Editing', 'status' => 'draft', 'region_entry' => true ),
            ),
        ) );

        $this->assertArrayNotHasKey( 'region_entry', $config['statuses'][0] );
        $this->assertTrue( $config['statuses'][1]['region_entry'] );
    }

    /**
     * The sequence a new editor opens on — Draft → Published, Published final —
     * passes the gate untouched.
     *
     * The editor seeds this shape so that a sequence someone has only named can
     * be saved (see `newWorkflowStages` in `SequenceGraphEditor.js`). That
     * promise is only kept if the gate takes it as written: two regions, one
     * checkpoint each, and a transition whose target is a stage that exists.
     * Asserted as a no-op rather than just "did not throw", because a gate that
     * had to normalize it would mean the editor is seeding one shape and storing
     * another.
     */
    public function test_gate_accepts_the_sequence_a_new_editor_opens_on(): void
    {
        $seeded = array(
            array(
                'key'          => 'draft',
                'label'        => 'Draft',
                'is_terminal'  => false,
                'status'       => 'draft',
                'region_entry' => true,
                'transitions'  => array( array( 'to' => 'publish' ) ),
            ),
            array(
                'key'          => 'publish',
                'label'        => 'Published',
                'is_terminal'  => true,
                'status'       => 'publish',
                'region_entry' => true,
                'transitions'  => array(),
            ),
        );

        $config = Sequence::prepare_config_for_write( array( 'statuses' => $seeded ) );

        $this->assertSame( $seeded, $config['statuses'] );
    }

    /**
     * More than one entry marker in the same region is ambiguous and throws.
     */
    public function test_gate_rejects_multiple_entries_per_region(): void
    {
        $this->expectException( \InvalidArgumentException::class );

        Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'a', 'label' => 'A', 'status' => 'draft', 'region_entry' => true ),
                array( 'key' => 'b', 'label' => 'B', 'status' => 'draft', 'region_entry' => true ),
            ),
        ) );
    }

    /**
     * A region-crossing transition that targets the region's checkpoint is the
     * allowed shape, and same-region transitions are unconstrained.
     */
    public function test_gate_allows_crossing_into_a_region_checkpoint(): void
    {
        $config = Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array(
                    'key' => 'writing', 'label' => 'Writing', 'status' => 'draft',
                    'transitions' => array( array( 'to' => 'editing' ), array( 'to' => 'live' ) ),
                ),
                array(
                    'key' => 'editing', 'label' => 'Editing', 'status' => 'draft',
                    'transitions' => array( array( 'to' => 'live' ) ),
                ),
                array(
                    'key' => 'live', 'label' => 'Live', 'status' => 'publish', 'region_entry' => true,
                    'transitions' => array( array( 'to' => 'promoted' ), array( 'to' => 'writing' ) ),
                ),
                array( 'key' => 'promoted', 'label' => 'Promoted', 'status' => 'publish' ),
            ),
        ) );

        $this->assertCount( 4, $config['statuses'] );
    }

    /**
     * A transition may cross into a region at any stage, not only at its
     * `region_entry`. The checkpoint says where a post lands when something
     * OUTSIDE the workflow puts it in the region; it is not a door an edge has to
     * use, and the gate does not ask where a crossing points.
     */
    public function test_gate_allows_crossing_that_misses_the_checkpoint(): void
    {
        $config = Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array(
                    'key' => 'writing', 'label' => 'Writing', 'status' => 'draft',
                    // Straight into the publish region's SECOND stage.
                    'transitions' => array( array( 'to' => 'promoted' ) ),
                ),
                array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish', 'region_entry' => true ),
                array( 'key' => 'promoted', 'label' => 'Promoted', 'status' => 'publish' ),
            ),
        ) );

        $this->assertSame( 'promoted', $config['statuses'][0]['transitions'][0]['to'] );
        $this->assertTrue( $config['statuses'][1]['region_entry'], 'The checkpoint keeps its own job.' );
    }

    /**
     * "Send this back to the desk for revisions" — a return crossing that names
     * the interior stage where work resumes. The canonical shape the old rule
     * forbade, and the reason it went.
     */
    public function test_gate_allows_return_crossing_to_an_interior_stage(): void
    {
        $config = Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array(
                    'key' => 'brief', 'label' => 'Brief', 'status' => 'draft', 'region_entry' => true,
                    'transitions' => array( array( 'to' => 'desk' ) ),
                ),
                array(
                    'key' => 'desk', 'label' => 'Desk', 'status' => 'draft',
                    'transitions' => array( array( 'to' => 'rights' ) ),
                ),
                array(
                    'key' => 'rights', 'label' => 'Rights', 'status' => 'pending', 'region_entry' => true,
                    // Back into 'draft' at 'desk', NOT at the 'brief' checkpoint.
                    'transitions' => array( array( 'to' => 'desk' ) ),
                ),
            ),
        ) );

        $this->assertSame( 'desk', $config['statuses'][2]['transitions'][0]['to'] );
    }

    /**
     * Unpublishing to an interior stage is authorable too. What stops a user
     * doing it is StatusManager::current_user_can_cross_region() and the publish
     * boundary guard — both keyed on regions, neither on where the edge lands.
     */
    public function test_gate_allows_retracting_from_publish_to_an_interior_stage(): void
    {
        $config = Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'brief', 'label' => 'Brief', 'status' => 'draft', 'region_entry' => true ),
                array( 'key' => 'desk', 'label' => 'Desk', 'status' => 'draft' ),
                array(
                    'key' => 'live', 'label' => 'Live', 'status' => 'publish', 'region_entry' => true,
                    // Retract straight to an interior draft stage.
                    'transitions' => array( array( 'to' => 'desk' ) ),
                ),
            ),
        ) );

        $this->assertSame( 'desk', $config['statuses'][2]['transitions'][0]['to'] );
    }

    /**
     * Leaving a region is unconstrained too — any stage may carry an outbound
     * crossing, including one that is not its own region's checkpoint.
     */
    public function test_gate_allows_crossing_out_of_a_region_from_any_stage(): void
    {
        $config = Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'writing', 'label' => 'Writing', 'status' => 'draft' ),
                array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish', 'region_entry' => true ),
                array(
                    // Not the publish checkpoint, but free to send the post back.
                    'key' => 'promoted', 'label' => 'Promoted', 'status' => 'publish',
                    'transitions' => array( array( 'to' => 'writing' ) ),
                ),
            ),
        ) );

        $this->assertCount( 3, $config['statuses'] );
    }

    /**
     * A duplicate target is rejected at the gate, not tolerated: a stored row
     * carrying it is a privilege bug (the loosest copy decides who may transition,
     * the first decides required tools and assignment). No write may add another
     * one.
     */
    public function test_gate_rejects_two_transitions_to_the_same_target(): void
    {
        $this->expectException( \InvalidArgumentException::class );
        $this->expectExceptionMessage( 'more than one transition to "live"' );

        Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array(
                    'key' => 'writing', 'label' => 'Writing', 'status' => 'draft',
                    'transitions' => array(
                        array( 'to' => 'live', 'allowed_roles' => array( 'editor' ) ),
                        array( 'to' => 'live' ),
                    ),
                ),
                array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish', 'region_entry' => true ),
            ),
        ) );
    }

    /**
     * The rule the test above enforces is a WRITE rule, and it arrived after rows
     * were already stored — the gate that wrote them tolerated the duplicate
     * verbatim. So the repair has to survive the shape it rejects: it runs the gate
     * first, and in write mode it threw before repairing anything, leaving a legacy
     * row unmigratable, region-less and fatal on read, with a Repair button that
     * returned an error and a canvas that could not even draw the second edge.
     *
     * Repaired here instead: the first transition to the target keeps it, the later
     * one is removed, and the removal is reported — a repair that quietly deletes an
     * author's roles, tools and notifications is the silent change these repairs
     * exist to end.
     */
    public function test_collapse_removes_a_duplicate_target_the_row_arrived_with(): void
    {
        $repair = Sequence::collapse_duplicate_transitions( array(
            'statuses' => array(
                array(
                    'key' => 'review', 'label' => 'Review', 'status' => 'draft', 'region_entry' => true,
                    'transitions' => array(
                        array( 'to' => 'live', 'allowed_roles' => array( 'editor' ) ),
                        array( 'to' => 'live' ),
                    ),
                ),
                array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish', 'region_entry' => true ),
            ),
        ) );

        $transitions = $repair['config']['statuses'][0]['transitions'];

        $this->assertCount( 1, $transitions, 'One transition per target, never two.' );
        $this->assertSame(
            array( 'editor' ),
            $transitions[0]['allowed_roles'],
            'The FIRST in config order survives, with its policy — the looser copy is the one that goes.'
        );
        $this->assertSame(
            array( array( 'from' => 'review', 'to' => 'live' ) ),
            $repair['dropped'],
            'The removed transition is named by the stage that held it and the target it duplicated.'
        );

        // The whole point: the row now gets through the gate that rejected it.
        Sequence::prepare_config_for_write( $repair['config'] );
    }

    /**
     * `Live` and `live` are two visibly distinct targets to an author and ONE target
     * to the gate, because sanitize_key() runs on `to` before the duplicate check.
     * A legacy config written when nothing sanitized targets can therefore hold a
     * collision that only appears at normalization time — so the collapse has to run
     * with sanitization already applied, or the repair throws on a row whose config
     * never looked duplicated.
     */
    public function test_collapse_removes_targets_that_only_collide_once_sanitized(): void
    {
        $this->stub_real_sanitize_key();

        $repair = Sequence::collapse_duplicate_transitions( array(
            'statuses' => array(
                array(
                    'key' => 'review', 'label' => 'Review', 'status' => 'draft', 'region_entry' => true,
                    'transitions' => array(
                        array( 'to' => 'Live', 'label' => 'Publish it' ),
                        array( 'to' => 'live', 'label' => 'Publish it again' ),
                    ),
                ),
                array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish', 'region_entry' => true ),
            ),
        ) );

        $transitions = $repair['config']['statuses'][0]['transitions'];

        $this->assertCount( 1, $transitions );
        $this->assertSame( 'live', $transitions[0]['to'], 'The survivor carries the sanitized target.' );
        $this->assertSame( 'Publish it', $transitions[0]['label'], 'Keep-first is judged after sanitization, in config order.' );
        $this->assertSame(
            array( array( 'from' => 'review', 'to' => 'live' ) ),
            $repair['dropped'],
            'The collision is reported under the target the gate actually sees.'
        );

        Sequence::prepare_config_for_write( $repair['config'] );
    }

    /**
     * The collapse is a repair, not a normalization every caller gets: a config with
     * no duplicate comes back untouched, transition arrays included, so the
     * migration's "did anything change?" check still sees a no-op on an
     * already-repaired row.
     */
    public function test_collapse_leaves_a_config_without_duplicates_byte_identical(): void
    {
        $config = array(
            'statuses' => array(
                array(
                    'key' => 'writing', 'label' => 'Writing', 'status' => 'draft', 'region_entry' => true,
                    'transitions' => array( array( 'to' => 'live' ) ),
                ),
                array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish', 'region_entry' => true ),
            ),
        );

        $repair = Sequence::collapse_duplicate_transitions( $config );

        $this->assertSame( $config, $repair['config'] );
        $this->assertSame( array(), $repair['dropped'] );
    }

    /**
     * A gate failure with no inferable answer still throws. The collapse is one
     * repair, not an amnesty: a dangling target is a lost destination only the
     * author can resolve.
     */
    public function test_collapse_still_throws_on_a_failure_it_cannot_infer(): void
    {
        $this->expectException( \InvalidArgumentException::class );
        $this->expectExceptionMessage( 'is not a defined stage' );

        Sequence::collapse_duplicate_transitions( array(
            'statuses' => array(
                array(
                    'key' => 'writing', 'label' => 'Writing', 'status' => 'draft',
                    'transitions' => array( array( 'to' => 'nowhere' ) ),
                ),
            ),
        ) );
    }

    /**
     * Phase sequences carry a `phases` graph and have no stage transitions.
     */
    public function test_collapse_leaves_a_phase_sequence_untouched(): void
    {
        $config = array( 'phases' => array( array( 'key' => 'ideation' ) ) );

        $repair = Sequence::collapse_duplicate_transitions( $config, Sequence::TYPE_PHASE );

        $this->assertSame( $config, $repair['config'] );
        $this->assertSame( array(), $repair['dropped'] );
    }

    /**
     * The old at-most-one-publish-gate rule is gone: any number of stages may
     * live in the publish region.
     */
    public function test_gate_allows_multiple_publish_region_stages(): void
    {
        $config = Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish' ),
                array( 'key' => 'promoted', 'label' => 'Promoted', 'status' => 'publish' ),
                array( 'key' => 'archived-live', 'label' => 'Archived', 'status' => 'publish' ),
            ),
        ) );

        $this->assertCount( 3, $config['statuses'] );
    }

    /**
     * The gate rejects a stage-based sequence with no stages — an empty pipeline
     * cannot hold posts.
     */
    public function test_gate_rejects_empty_statuses(): void
    {
        $this->expectException( \InvalidArgumentException::class );

        Sequence::prepare_config_for_write( array( 'statuses' => array() ) );
    }

    /**
     * The gate rejects a stage with an empty (missing or sanitized-to-empty) key —
     * a blank key would make stage meta ambiguous.
     */
    public function test_gate_rejects_empty_stage_key(): void
    {
        $this->expectException( \InvalidArgumentException::class );

        Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'draft', 'label' => 'Draft' ),
                array( 'label' => 'No Key' ),
            ),
        ) );
    }

    /**
     * The gate rejects duplicate stage keys — including keys that only collide
     * AFTER normalization, which the pre-gate import path used to miss.
     */
    public function test_gate_rejects_duplicate_stage_keys_post_normalization(): void
    {
        $this->stub_real_sanitize_key();

        $this->expectException( \InvalidArgumentException::class );

        Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'Review', 'label' => 'Review' ),
                array( 'key' => 'review', 'label' => 'Second Review' ),
            ),
        ) );
    }

    /**
     * A stage's `transitions`, when present, must be an ARRAY. A bare string
     * used to slip past the is_array-guarded normalization AND the dangling-
     * target foreach (foreach over a string warns and skips), persisting a
     * shape that fatals in get_transitions_for_user() on every panel load.
     */
    public function test_gate_rejects_non_array_transitions(): void
    {
        $this->expectException( \InvalidArgumentException::class );

        Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'draft', 'label' => 'Draft', 'transitions' => 'review' ),
                array( 'key' => 'review', 'label' => 'Review' ),
            ),
        ) );
    }

    /**
     * Each transition entry must be an object — a bare string entry is the same
     * defeat one level down.
     */
    public function test_gate_rejects_non_array_transition_entry(): void
    {
        $this->expectException( \InvalidArgumentException::class );

        Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'draft', 'label' => 'Draft', 'transitions' => array( 'review' ) ),
                array( 'key' => 'review', 'label' => 'Review' ),
            ),
        ) );
    }

    /**
     * Each transition entry must carry a string `to` target.
     */
    public function test_gate_rejects_transition_without_string_to(): void
    {
        $this->expectException( \InvalidArgumentException::class );

        Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'draft', 'label' => 'Draft', 'transitions' => array( array( 'label' => 'No Target' ) ) ),
            ),
        ) );
    }

    /**
     * A JSON-null transitions value is treated as absent, not rejected.
     */
    public function test_gate_accepts_null_transitions(): void
    {
        $config = Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'done', 'label' => 'Done', 'transitions' => null ),
            ),
        ) );

        $this->assertSame( 'done', $config['statuses'][0]['key'] );
    }

    /**
     * `region_entry` accepts booleans only — the import path carries nested
     * JSON the REST schema never boolean-types, and truthiness would coerce
     * the string "false" to TRUE. Rejected, never coerced.
     */
    public function test_gate_rejects_non_boolean_region_entry(): void
    {
        $this->expectException( \InvalidArgumentException::class );

        Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'draft', 'label' => 'Draft', 'region_entry' => 'false' ),
            ),
        ) );
    }

    /**
     * A JSON-null region_entry is treated as absent (auto-assignment applies).
     */
    public function test_gate_accepts_null_region_entry(): void
    {
        $config = Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'draft', 'label' => 'Draft', 'region_entry' => null ),
            ),
        ) );

        $this->assertTrue( $config['statuses'][0]['region_entry'], 'Null marker treated as absent; sole stage auto-assigned.' );
    }

    /**
     * The gate rejects a transition whose target is not a defined stage (a typo,
     * or a core status like `future` that is never a workflow stage).
     */
    public function test_gate_rejects_dangling_transition_target(): void
    {
        $this->expectException( \InvalidArgumentException::class );

        Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array( 'key' => 'start', 'label' => 'Start', 'transitions' => array( array( 'to' => 'ghost' ) ) ),
                array( 'key' => 'end', 'label' => 'End' ),
            ),
        ) );
    }

    /**
     * Phase sequences are exempt from the stage rules. The exemption is keyed on
     * the TYPE argument, not the presence of a `phases` key (an empty `statuses`
     * must not reject a valid phase config).
     */
    public function test_gate_exempts_phase_type(): void
    {
        $config = array(
            'phases' => array(
                array( 'key' => 'ideation', 'label' => 'Ideation', 'transitions' => array( array( 'to' => 'editorial' ) ) ),
                array( 'key' => 'editorial', 'label' => 'Editorial', 'transitions' => array() ),
            ),
        );

        $this->assertSame( $config, Sequence::prepare_config_for_write( $config, Sequence::TYPE_PHASE ) );
    }

    /**
     * A workflow config cannot skip the stage-graph rules by smuggling in a stray
     * `phases` key: the gate keys off the TYPE, so a workflow with duplicate stage
     * keys is still rejected even when a `phases` key is present.
     */
    public function test_gate_ignores_stray_phases_on_workflow_type(): void
    {
        $this->expectException( \InvalidArgumentException::class );

        Sequence::prepare_config_for_write(
            array(
                'phases'   => array( array( 'key' => 'ideation' ) ),
                'statuses' => array(
                    array( 'key' => 'review', 'label' => 'Review' ),
                    array( 'key' => 'review', 'label' => 'Dup' ),
                ),
            ),
            Sequence::TYPE_WORKFLOW
        );
    }

    // =========================================================================
    // Region-crossing capability filter — get_transitions_for_user
    // =========================================================================

    /**
     * Sequence config used by the crossing-filter tests: same-region moves,
     * a crossing into publish, a crossing out of publish, and one into private.
     *
     * @return array
     */
    private function crossing_config(): array
    {
        return array(
            'statuses' => array(
                array(
                    'key'          => 'draft',
                    'label'        => 'Draft',
                    'status'       => 'draft',
                    'region_entry' => true,
                    'transitions'  => array(
                        array( 'to' => 'review', 'label' => 'Submit' ),
                    ),
                ),
                array(
                    'key'         => 'review',
                    'label'       => 'Review',
                    'status'      => 'draft',
                    'transitions' => array(
                        array( 'to' => 'draft', 'label' => 'Send Back' ),
                        array( 'to' => 'published', 'label' => 'Publish' ),
                        array( 'to' => 'members', 'label' => 'Members Only' ),
                    ),
                ),
                array(
                    'key'          => 'published',
                    'label'        => 'Published',
                    'status'       => 'publish',
                    'region_entry' => true,
                    'transitions'  => array(
                        array( 'to' => 'draft', 'label' => 'Retract' ),
                    ),
                ),
                array(
                    'key'          => 'members',
                    'label'        => 'Members Only',
                    'status'       => 'private',
                    'region_entry' => true,
                    'transitions'  => array(),
                ),
            ),
        );
    }

    /**
     * Stub the WP environment get_transitions_for_user() needs: a user with the
     * given roles and capabilities on a registered 'post' post type.
     *
     * @param array $roles User roles.
     * @param array $caps  Capabilities the user holds (e.g. publish_posts).
     */
    private function stub_transition_user( array $roles, array $caps ): void
    {
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'roles' => $roles ) );
        Functions\when( 'get_option' )->justReturn( array() ); // Settings: bypass roles default to administrator.
        Functions\when( 'get_post_type' )->justReturn( 'post' );
        Functions\when( 'get_post_type_object' )->justReturn(
            (object) array(
                'cap' => (object) array(
                    'publish_posts'        => 'publish_posts',
                    'edit_published_posts' => 'edit_published_posts',
                ),
            )
        );
        Functions\when( 'user_can' )->alias(
            fn( $user, $cap ) => in_array( $cap, $caps, true )
        );
    }

    /**
     * A user without publish_posts is not offered edges crossing into the
     * publish or private regions; same-region edges are unaffected.
     */
    public function test_crossing_edges_hidden_without_publish_posts(): void
    {
        $this->stub_transition_user( array( 'editor' ), array() );
        $sequence = $this->create_sequence( $this->crossing_config() );

        $offered = array_column( $sequence->get_transitions_for_user( 'review', 5, 123 ), 'to' );

        $this->assertSame( array( 'draft' ), $offered, 'Only the same-region edge survives.' );
    }

    /**
     * A user with publish_posts is offered the publish- and private-crossing edges.
     */
    public function test_crossing_edges_offered_with_publish_posts(): void
    {
        $this->stub_transition_user( array( 'editor' ), array( 'publish_posts' ) );
        $sequence = $this->create_sequence( $this->crossing_config() );

        $offered = array_column( $sequence->get_transitions_for_user( 'review', 5, 123 ), 'to' );

        $this->assertSame( array( 'draft', 'published', 'members' ), $offered );
    }

    /**
     * Crossing OUT of the publish region requires edit_published_posts.
     */
    public function test_crossing_out_of_publish_requires_edit_published_posts(): void
    {
        $this->stub_transition_user( array( 'editor' ), array() );
        $sequence = $this->create_sequence( $this->crossing_config() );

        $this->assertSame(
            array(),
            $sequence->get_transitions_for_user( 'published', 5, 123 ),
            'Retract edge hidden without edit_published_posts.'
        );

        $this->stub_transition_user( array( 'editor' ), array( 'edit_published_posts' ) );

        $offered = array_column( $sequence->get_transitions_for_user( 'published', 5, 123 ), 'to' );
        $this->assertSame( array( 'draft' ), $offered );
    }

    /**
     * Workflow bypass roles bypass workflow rules (roles/assignments) but NOT
     * core capabilities — a bypass-role user without publish_posts still isn't
     * offered the crossing edge.
     */
    public function test_crossing_filter_applies_to_bypass_roles(): void
    {
        $this->stub_transition_user( array( 'administrator' ), array() );
        $sequence = $this->create_sequence( $this->crossing_config() );

        $offered = array_column( $sequence->get_transitions_for_user( 'review', 5, 123 ), 'to' );

        $this->assertSame( array( 'draft' ), $offered );
    }

    /**
     * Without a post context the post type is not resolvable, so the crossing
     * filter does not apply (server-side enforcement still happens in
     * StatusManager::transition()).
     */
    public function test_crossing_filter_skipped_without_post_id(): void
    {
        $this->stub_transition_user( array( 'editor' ), array() );
        $sequence = $this->create_sequence( $this->crossing_config() );

        $offered = array_column( $sequence->get_transitions_for_user( 'review', 5 ), 'to' );

        $this->assertSame( array( 'draft', 'published', 'members' ), $offered );
    }

    /**
     * The role-only evaluation ignores region caps entirely: a user who is
     * OFFERED only the same-region edge (cap filter) is still PERMITTED the
     * crossings by workflow configuration — the distinction the edit-revocation
     * gate depends on (core caps must never revoke edit_post).
     */
    public function test_role_permitted_transitions_ignore_region_caps(): void
    {
        $this->stub_transition_user( array( 'editor' ), array() ); // No publish-level caps.
        $sequence = $this->create_sequence( $this->crossing_config() );

        $offered = array_column( $sequence->get_transitions_for_user( 'review', 5, 123 ), 'to' );
        $this->assertSame( array( 'draft' ), $offered, 'The cap-filtered list hides the crossings.' );

        $permitted = array_column( $sequence->get_role_permitted_transitions( 'review', 5, 123 ), 'to' );
        $this->assertSame( array( 'draft', 'published', 'members' ), $permitted, 'Role-only evaluation keeps them.' );
    }

    /**
     * The role-only evaluation still enforces explicit sequence role
     * configuration (the original edit-revocation feature) — and does so
     * without a single core capability check, so it can never recurse through
     * the edit_post meta-cap filter that calls it.
     */
    public function test_role_permitted_transitions_enforce_role_config_without_cap_checks(): void
    {
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'roles' => array( 'contributor' ) ) );
        Functions\when( 'get_option' )->justReturn( array() );
        Functions\expect( 'user_can' )->never();
        Functions\expect( 'current_user_can' )->never();

        $sequence = $this->create_sequence(
            array(
                'statuses' => array(
                    array(
                        'key'          => 'gated',
                        'label'        => 'Gated',
                        'status'       => 'draft',
                        'region_entry' => true,
                        'transitions'  => array(
                            array(
                                'to'            => 'done',
                                'allowed_roles' => array( 'editor' ),
                            ),
                        ),
                    ),
                    array(
                        'key'         => 'done',
                        'label'       => 'Done',
                        'status'      => 'draft',
                        'is_terminal' => true,
                        'transitions' => array(),
                    ),
                ),
            )
        );

        $this->assertSame(
            array(),
            $sequence->get_role_permitted_transitions( 'gated', 5, 123 ),
            'Explicit role configuration still excludes the user.'
        );
    }

    /**
     * A post type whose cap object doesn't declare the required capability
     * (e.g. an external CPT with map_meta_cap=false and a partial capabilities
     * map) fails CLOSED — the edge is hidden — but loudly: the data-integrity
     * condition is error_log'd so it's diagnosable, instead of user_can( null )
     * silently hiding the edge from everyone.
     */
    public function test_missing_cap_property_fails_closed_and_logs(): void
    {
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'roles' => array( 'editor' ) ) );
        Functions\when( 'get_option' )->justReturn( array() );
        Functions\when( 'get_post_type' )->justReturn( 'external_cpt' );
        // No edit_published_posts property on the cap object.
        Functions\when( 'get_post_type_object' )->justReturn(
            (object) array( 'cap' => (object) array( 'publish_posts' => 'publish_external_cpts' ) )
        );
        // The user holds every cap that CAN be resolved — the edge disappears
        // purely because the cap property is missing.
        Functions\when( 'user_can' )->justReturn( true );

        $sequence = $this->create_sequence( $this->crossing_config() );

        // Capture error_log output (phpunit.xml routes it to /dev/null by default).
        $log_file = tempnam( sys_get_temp_dir(), 'vipwf-log-' );
        $previous = ini_set( 'error_log', $log_file );
        try {
            // 'published' → 'draft' crosses out of publish: needs edit_published_posts.
            $offered = $sequence->get_transitions_for_user( 'published', 5, 123 );
        } finally {
            ini_set( 'error_log', $previous );
        }

        $log = (string) file_get_contents( $log_file );
        unlink( $log_file );

        $this->assertSame( array(), $offered, 'The unresolvable edge fails closed.' );
        $this->assertStringContainsString( 'edit_published_posts', $log, 'The missing cap is named in the log.' );
        $this->assertSame( 1, substr_count( $log, '[VIP Workflow]' ), 'Exactly one integrity log line.' );
    }
}
