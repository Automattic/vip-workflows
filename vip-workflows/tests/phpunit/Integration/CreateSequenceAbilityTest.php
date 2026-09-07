<?php
/**
 * Execute-path coverage for the Create Sequence ability.
 *
 * Runs in the integration suite so execute_create_sequence() exercises the real
 * SequencesController::create_item() -> SequenceRepository::create() path
 * against a booted WordPress + database, proving a row is actually persisted and
 * that required-field guards surface the expected WP_Error.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/create-sequence.php';

/**
 * Tests the Create Sequence ability execute callback end to end.
 */
class CreateSequenceAbilityTest extends TestCase
{
    public function set_up(): void
    {
        parent::set_up();

        // Author sequences as an administrator (create path uses current user).
        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
    }

    public function tear_down(): void
    {
        // The experiment registry caches resolved state in-process, so disabling
        // here prevents an enabled-Ideation test from leaking into later tests.
        \VIPWorkflows\Plugin::get_instance()->get_experiment_registry()->disable( 'ideation' );

        parent::tear_down();
    }

    public function test_creates_a_workflow_sequence_and_persists_it(): void
    {
        $result = \VIPWorkflows\Abilities\Tools\execute_create_sequence(
            array(
                'name'     => 'Newsroom Flow',
                'statuses' => array(
                    array(
                        'key'   => 'draft',
                        'label' => 'Draft',
                    ),
                    array(
                        'key'         => 'published',
                        'label'       => 'Published',
                        'is_terminal' => true,
                    ),
                ),
            )
        );

        $this->assertIsArray( $result );
        $this->assertTrue( $result['success'] );
        $this->assertGreaterThan( 0, $result['sequence_id'] );
        $this->assertSame( 'Newsroom Flow', $result['name'] );
        $this->assertSame( 'workflow', $result['type'] );
        $this->assertSame( 2, $result['statuses_count'] );

        // No post types were passed, so the agent is warned the sequence is
        // not attached to any content type.
        $this->assertNotEmpty( $result['warnings'] );
        $this->assertStringContainsString( 'post types', $result['warnings'][0] );

        // The row is really in the database.
        $sequence = ( new SequenceRepository() )->find( $result['sequence_id'] );
        $this->assertNotNull( $sequence );
        $this->assertSame( 'Newsroom Flow', $sequence->name );
    }

    public function test_persisted_sequence_carries_gate_normalized_matrix_fields(): void
    {
        // One stage without a `status` (defaults to draft) and one publish-region
        // stage: the write gate normalizes both and marks each region's checkpoint.
        $result = \VIPWorkflows\Abilities\Tools\execute_create_sequence(
            array(
                'name'       => 'Matrix Flow',
                'post_types' => array( 'post' ),
                'statuses'   => array(
                    array(
                        'key'         => 'writing',
                        'label'       => 'Writing',
                        'transitions' => array( array( 'to' => 'live', 'label' => 'Go Live' ) ),
                    ),
                    array(
                        'key'    => 'live',
                        'label'  => 'Live',
                        'status' => 'publish',
                    ),
                ),
            )
        );

        $this->assertTrue( $result['success'] );

        $sequence = ( new SequenceRepository() )->find( $result['sequence_id'] );
        $this->assertNotNull( $sequence );

        // The persisted config resolves through the read API without throwing:
        // regions are present and each used region has its entry checkpoint.
        $this->assertSame( 'draft', $sequence->get_stage_status( 'writing' ) );
        $this->assertSame( 'publish', $sequence->get_stage_status( 'live' ) );
        $this->assertSame( 'writing', $sequence->get_region_entry_stage( 'draft' ) );
        $this->assertSame( 'live', $sequence->get_region_entry_stage( 'publish' ) );
        $this->assertNull( $sequence->get_region_entry_stage( 'pending' ), 'Unused region has no entry.' );
        $this->assertTrue( $sequence->is_region_crossing( 'writing', 'live' ) );
    }

    public function test_overlay_stage_region_is_rejected(): void
    {
        $result = \VIPWorkflows\Abilities\Tools\execute_create_sequence(
            array(
                'name'       => 'Overlay Flow',
                'post_types' => array( 'post' ),
                'statuses'   => array(
                    array( 'key' => 'scheduled', 'label' => 'Scheduled', 'status' => 'future' ),
                ),
            )
        );

        $this->assertWPError( $result );
        $this->assertSame( 'rest_sequence_invalid_config', $result->get_error_code() );
    }

    public function test_no_warning_when_a_valid_post_type_is_supplied(): void
    {
        $result = \VIPWorkflows\Abilities\Tools\execute_create_sequence(
            array(
                'name'       => 'Attached Flow',
                'post_types' => array( 'post' ),
                'statuses'   => array(
                    array( 'key' => 'draft', 'label' => 'Draft' ),
                ),
            )
        );

        $this->assertTrue( $result['success'] );
        $this->assertSame( array(), $result['warnings'] );
    }

    public function test_warns_when_no_post_type_is_registered(): void
    {
        // A sequence names the post types it drives; it cannot bring one into
        // existence. A slug nothing has registered attaches the sequence to no
        // content, and the agent only learns that from this warning.
        $result = \VIPWorkflows\Abilities\Tools\execute_create_sequence(
            array(
                'name'       => 'Prospect Pipeline',
                'post_types' => array( 'prospect_pipeline' ),
                'statuses'   => array(
                    array( 'key' => 'identified', 'label' => 'Identified' ),
                ),
            )
        );

        $this->assertTrue( $result['success'] );
        $this->assertCount( 1, $result['warnings'] );
        $this->assertStringContainsString( 'no valid post types', $result['warnings'][0] );
    }

    public function test_phase_type_without_ideation_returns_error(): void
    {
        // Ideation is disabled by default; a phase sequence must be rejected and
        // the controller's WP_Error surfaced through the ability.
        $result = \VIPWorkflows\Abilities\Tools\execute_create_sequence(
            array(
                'name'     => 'Lifecycle Off',
                'type'     => 'phase',
                'statuses' => array( array( 'key' => 'ideation', 'label' => 'Ideation' ) ),
            )
        );

        $this->assertWPError( $result );
        $this->assertSame( 'rest_sequence_type_disabled', $result->get_error_code() );
    }

    public function test_creates_a_phase_sequence_when_ideation_enabled(): void
    {
        \VIPWorkflows\Plugin::get_instance()->get_experiment_registry()->enable( 'ideation' );

        $result = \VIPWorkflows\Abilities\Tools\execute_create_sequence(
            array(
                'name'     => 'Lifecycle',
                'type'     => 'phase',
                'statuses' => array(
                    array(
                        'key'         => 'ideation',
                        'label'       => 'Ideation',
                        'transitions' => array( array( 'to' => 'editorial', 'label' => 'Move to Editorial' ) ),
                    ),
                    array( 'key' => 'editorial', 'label' => 'Editorial' ),
                ),
            )
        );

        $this->assertTrue( $result['success'] );
        $this->assertSame( 'phase', $result['type'] );
        $this->assertGreaterThan( 0, $result['sequence_id'] );
        // Phase sequences store phases (not statuses) and skip the workflow-only
        // statuses/post-types warnings.
        $this->assertSame( array(), $result['warnings'] );

        $sequence = ( new SequenceRepository() )->find( $result['sequence_id'] );
        $this->assertNotNull( $sequence );
        $this->assertSame( 'phase', $sequence->type );
    }

    public function test_missing_name_returns_error(): void
    {
        $result = \VIPWorkflows\Abilities\Tools\execute_create_sequence(
            array(
                'statuses' => array( array( 'key' => 'draft', 'label' => 'Draft' ) ),
            )
        );

        $this->assertWPError( $result );
        $this->assertSame( 'missing_name', $result->get_error_code() );
    }

    public function test_missing_statuses_returns_error(): void
    {
        $result = \VIPWorkflows\Abilities\Tools\execute_create_sequence(
            array( 'name' => 'No Statuses' )
        );

        $this->assertWPError( $result );
        $this->assertSame( 'missing_statuses', $result->get_error_code() );
    }

    public function test_empty_statuses_array_is_rejected(): void
    {
        // An empty statuses array has no workflow stages, so it is rejected at write
        // time (a controlled error, not a created-but-unusable sequence).
        $result = \VIPWorkflows\Abilities\Tools\execute_create_sequence(
            array(
                'name'       => 'No Stages',
                'post_types' => array( 'post' ),
                'statuses'   => array(),
            )
        );

        $this->assertWPError( $result );
        $this->assertSame( 'rest_sequence_invalid_config', $result->get_error_code() );
    }

    public function test_controller_error_is_propagated_as_wp_error(): void
    {
        // An invalid metadata field type makes SequencesController::create_item()
        // return a WP_Error before any DB write; the adapter must surface it.
        $result = \VIPWorkflows\Abilities\Tools\execute_create_sequence(
            array(
                'name'            => 'Bad Metadata',
                'post_types'      => array( 'post' ),
                'statuses'        => array( array( 'key' => 'draft', 'label' => 'Draft' ) ),
                'metadata_fields' => array(
                    array( 'key' => 'grade', 'label' => 'Grade', 'type' => 'not-a-real-type' ),
                ),
            )
        );

        $this->assertWPError( $result );
    }
}
