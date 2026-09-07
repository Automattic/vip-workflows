<?php
/**
 * Execute-path coverage for the sequence modification abilities.
 *
 * Update Sequence, Activate Sequence and Validate Sequence all run against a booted
 * WordPress + database so the real SequencesController -> SequenceRepository ->
 * Sequence::prepare_config_for_write() chain is exercised, and so the permission
 * gates can be asserted through `WP_Ability::execute()` — which does not exist in the
 * unit suite, where an `instanceof WP_Ability` check is unconditionally false.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\Sequence;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Database\Schema;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/helpers.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/update-sequence.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/activate-sequence.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/validate-sequence.php';

/**
 * Tests the update / activate / validate sequence abilities end to end.
 */
class SequenceWriteAbilitiesTest extends TestCase
{
    /**
     * Administrator used for the authorized paths.
     *
     * @var int
     */
    private int $admin_id = 0;

    public function set_up(): void
    {
        parent::set_up();

        $this->admin_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
        wp_set_current_user( $this->admin_id );
    }

    /**
     * Create a sequence through the write gate.
     *
     * @param array  $statuses Stage configs.
     * @param string $status   Lifecycle state to leave the row in.
     * @return Sequence
     */
    private function create_sequence( array $statuses, string $status = 'active' ): Sequence
    {
        $repository = new SequenceRepository();

        $id = $repository->create(
            'Fixture Flow',
            'fixture-flow-' . wp_generate_password( 6, false ),
            'Fixture',
            array(
                'post_types' => array( 'post' ),
                'statuses'   => $statuses,
            ),
            $this->admin_id
        );

        $this->assertIsInt( $id );

        if ( 'active' !== $status ) {
            $repository->update( $id, array( 'status' => $status ) );
        }

        return $repository->find( $id );
    }

    /**
     * Insert a sequence row directly, bypassing the write gate.
     *
     * The only way to produce a stored config that breaks a stage x status
     * invariant: every supported write path normalizes it away. This is what a row
     * persisted before the invariant landed looks like.
     *
     * @param array  $config Raw config to store verbatim.
     * @param string $status Lifecycle state.
     * @return Sequence
     */
    private function insert_ungated_sequence( array $config, string $status = 'active' ): Sequence
    {
        global $wpdb;

        $now = current_time( 'mysql' );

        $wpdb->insert(
            Schema::get_table_name( 'sequences' ),
            array(
                'uuid'        => wp_generate_uuid4(),
                'type'        => Sequence::TYPE_WORKFLOW,
                'name'        => 'Ungated Flow',
                'slug'        => 'ungated-flow-' . wp_generate_password( 6, false ),
                'description' => '',
                'version'     => 1,
                'status'      => $status,
                'config'      => wp_json_encode( $config ),
                'created_by'  => $this->admin_id,
                'created_at'  => $now,
                'updated_at'  => $now,
            )
        );

        $id = (int) $wpdb->insert_id;
        $this->assertGreaterThan( 0, $id );

        return ( new SequenceRepository() )->find( $id );
    }

    /**
     * Configuration audit rows for a sequence, newest first.
     *
     * @param int $sequence_id Sequence ID.
     * @return array Raw workflow_events rows.
     */
    private function get_configuration_events( int $sequence_id ): array
    {
        global $wpdb;

        $rows = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM %i WHERE event_type LIKE %s ORDER BY id DESC',
                Schema::get_table_name( 'workflows_events' ),
                'sequence.%'
            )
        );

        return array_values(
            array_filter(
                $rows,
                function ( $row ) use ( $sequence_id ) {
                    $data = json_decode( $row->event_data, true ) ?? array();
                    return (int) ( $data['sequence_id'] ?? 0 ) === $sequence_id;
                }
            )
        );
    }

    /**
     * A two-stage graph that passes the write gate.
     *
     * @return array
     */
    private function valid_statuses(): array
    {
        return array(
            array(
                'key'         => 'writing',
                'label'       => 'Writing',
                'status'      => 'draft',
                'transitions' => array( array( 'to' => 'live', 'label' => 'Go Live' ) ),
            ),
            array(
                'key'    => 'live',
                'label'  => 'Live',
                'status' => 'publish',
            ),
        );
    }

    // =========================================================================
    // Permission gates
    // =========================================================================

    /**
     * @return array<string, array{0: string, 1: array}>
     */
    public function data_write_abilities(): array
    {
        return array(
            'update'   => array(
                'vip-workflows/update-sequence',
                array( 'sequence_id' => 1, 'name' => 'Nope', 'statuses' => array( array( 'key' => 'a', 'label' => 'A' ) ) ),
            ),
            'activate' => array(
                'vip-workflows/activate-sequence',
                array( 'sequence_id' => 1, 'active' => true ),
            ),
            'validate' => array(
                'vip-workflows/validate-sequence',
                array( 'sequence_id' => 1 ),
            ),
        );
    }

    /**
     * A sequence write rewrites who may do what, so nothing below an administrator
     * may reach one — not even the read-only dry run, whose output carries the full
     * stored configuration.
     *
     * @dataProvider data_write_abilities
     *
     * @param string $ability_id Ability under test.
     * @param array  $input      Schema-valid input.
     */
    public function test_ability_refuses_a_non_administrator( string $ability_id, array $input ): void
    {
        $ability = wp_get_ability( $ability_id );
        $this->assertNotNull( $ability, "Ability {$ability_id} should be registered." );

        wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

        $result = $ability->execute( $input );

        $this->assertWPError( $result );
        $this->assertSame( 'ability_invalid_permissions', $result->get_error_code() );

        // The same call succeeds for an administrator, so the refusal is the
        // capability gate rather than a malformed request.
        wp_set_current_user( $this->admin_id );
        $this->assertTrue( true === $ability->check_permissions( $input ) );
    }

    // =========================================================================
    // Update
    // =========================================================================

    public function test_update_replaces_the_configuration_and_persists_it(): void
    {
        $sequence = $this->create_sequence( $this->valid_statuses() );

        $result = \VIPWorkflows\Abilities\Tools\execute_update_sequence(
            array(
                'sequence_id' => $sequence->id,
                'name'        => 'Renamed Flow',
                'post_types'  => array( 'post' ),
                'statuses'    => array(
                    array( 'key' => 'writing', 'label' => 'Writing', 'status' => 'draft' ),
                    array( 'key' => 'editing', 'label' => 'Editing', 'status' => 'pending' ),
                    array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish' ),
                ),
            )
        );

        $this->assertIsArray( $result );
        $this->assertTrue( $result['success'] );
        $this->assertSame( 3, $result['statuses_count'] );
        $this->assertSame( array(), $result['warnings'] );

        $stored = ( new SequenceRepository() )->find( $sequence->id );
        $this->assertSame( 'Renamed Flow', $stored->name );
        $this->assertCount( 3, $stored->get_statuses() );
        $this->assertSame( 'pending', $stored->get_stage_status( 'editing' ) );
    }

    /**
     * The write gate is the repository's, not a copy: a dangling transition target
     * is refused and nothing is persisted.
     */
    public function test_update_cannot_persist_a_config_the_write_gate_rejects(): void
    {
        $sequence = $this->create_sequence( $this->valid_statuses() );

        $result = \VIPWorkflows\Abilities\Tools\execute_update_sequence(
            array(
                'sequence_id' => $sequence->id,
                'name'        => 'Broken Flow',
                'post_types'  => array( 'post' ),
                'statuses'    => array(
                    array(
                        'key'         => 'writing',
                        'label'       => 'Writing',
                        'transitions' => array( array( 'to' => 'nowhere', 'label' => 'Dangling' ) ),
                    ),
                ),
            )
        );

        $this->assertWPError( $result );
        $this->assertSame( 'rest_sequence_invalid_config', $result->get_error_code() );

        // The stored row is untouched.
        $stored = ( new SequenceRepository() )->find( $sequence->id );
        $this->assertSame( 'Fixture Flow', $stored->name );
        $this->assertCount( 2, $stored->get_statuses() );
    }

    /**
     * An invalid stage region is likewise refused — the gate's other stage rule,
     * reached through the same ability.
     */
    public function test_update_refuses_an_overlay_stage_region(): void
    {
        $sequence = $this->create_sequence( $this->valid_statuses() );

        $result = \VIPWorkflows\Abilities\Tools\execute_update_sequence(
            array(
                'sequence_id' => $sequence->id,
                'name'        => 'Overlay Flow',
                'post_types'  => array( 'post' ),
                'statuses'    => array( array( 'key' => 'scheduled', 'label' => 'Scheduled', 'status' => 'future' ) ),
            )
        );

        $this->assertWPError( $result );
        $this->assertSame( 'rest_sequence_invalid_config', $result->get_error_code() );
    }

    public function test_update_of_a_missing_sequence_is_an_error(): void
    {
        $result = \VIPWorkflows\Abilities\Tools\execute_update_sequence(
            array(
                'sequence_id' => 99999999,
                'name'        => 'Ghost',
                'statuses'    => array( array( 'key' => 'draft', 'label' => 'Draft' ) ),
            )
        );

        $this->assertWPError( $result );
        $this->assertSame( 'sequence_not_found', $result->get_error_code() );
    }

    public function test_update_warns_when_the_replacement_detaches_every_post_type(): void
    {
        $sequence = $this->create_sequence( $this->valid_statuses() );

        // `post_types` omitted: an update is a full replacement, so the sequence is
        // silently detached from all content unless the agent is told.
        $result = \VIPWorkflows\Abilities\Tools\execute_update_sequence(
            array(
                'sequence_id' => $sequence->id,
                'name'        => 'Detached Flow',
                'statuses'    => array( array( 'key' => 'writing', 'label' => 'Writing' ) ),
            )
        );

        $this->assertTrue( $result['success'] );
        $this->assertNotEmpty( $result['warnings'] );
        $this->assertStringContainsString( 'post types', $result['warnings'][0] );
    }

    // =========================================================================
    // Update is not activate
    // =========================================================================

    /**
     * Lifecycle state is not part of the update surface at all: the schema has no
     * `status` property, and the field allowlist handed to the controller has no
     * `status` member.
     */
    public function test_update_input_schema_cannot_express_a_lifecycle_change(): void
    {
        $ability = wp_get_ability( 'vip-workflows/update-sequence' );
        $schema  = $ability->get_input_schema();

        $this->assertFalse( $schema['additionalProperties'] );
        $this->assertArrayNotHasKey( 'status', $schema['properties'] );
        $this->assertArrayNotHasKey( 'active', $schema['properties'] );
        $this->assertNotContains( 'status', \VIPWorkflows\Abilities\Tools\UPDATE_SEQUENCE_FIELDS );
    }

    /**
     * And the allowlist enforces it, not just the schema: a caller reaching the
     * execute callback directly with a `status` key still cannot promote a draft.
     */
    public function test_update_ignores_a_smuggled_lifecycle_field(): void
    {
        $sequence = $this->create_sequence( $this->valid_statuses(), 'draft' );

        $result = \VIPWorkflows\Abilities\Tools\execute_update_sequence(
            array(
                'sequence_id' => $sequence->id,
                'name'        => 'Smuggled',
                'post_types'  => array( 'post' ),
                'statuses'    => $this->valid_statuses(),
                'status'      => 'active',
            )
        );

        $this->assertTrue( $result['success'] );
        $this->assertSame( 'draft', $result['status'] );
        $this->assertFalse( $result['status_changed'] );
        $this->assertSame( 'draft', ( new SequenceRepository() )->find( $sequence->id )->status );
    }

    /**
     * A draft sequence stays a draft across an update. An agent asked to fix a draft
     * sequence must not be able to enable it in the same call.
     */
    public function test_update_leaves_a_draft_sequence_in_draft(): void
    {
        $sequence = $this->create_sequence( $this->valid_statuses(), 'draft' );
        $this->assertSame( 'draft', $sequence->status );

        $result = \VIPWorkflows\Abilities\Tools\execute_update_sequence(
            array(
                'sequence_id' => $sequence->id,
                'name'        => 'Still Draft',
                'post_types'  => array( 'post' ),
                'statuses'    => $this->valid_statuses(),
            )
        );

        $this->assertTrue( $result['success'] );
        $this->assertSame( 'draft', $result['status'] );
        $this->assertFalse( $result['status_changed'] );
        $this->assertSame( 'draft', ( new SequenceRepository() )->find( $sequence->id )->status );
    }

    /**
     * And an active sequence is not demoted by an update either — the allowlist
     * omits status, it does not blank it.
     */
    public function test_update_leaves_an_active_sequence_active(): void
    {
        $sequence = $this->create_sequence( $this->valid_statuses() );

        $result = \VIPWorkflows\Abilities\Tools\execute_update_sequence(
            array(
                'sequence_id' => $sequence->id,
                'name'        => 'Still Active',
                'post_types'  => array( 'post' ),
                'statuses'    => $this->valid_statuses(),
            )
        );

        $this->assertSame( 'active', $result['status'] );
        $this->assertFalse( $result['status_changed'] );
        $this->assertSame( 'active', ( new SequenceRepository() )->find( $sequence->id )->status );
    }

    // =========================================================================
    // Activate
    // =========================================================================

    public function test_activate_puts_a_draft_sequence_live(): void
    {
        $sequence = $this->create_sequence( $this->valid_statuses(), 'draft' );

        $result = \VIPWorkflows\Abilities\Tools\execute_activate_sequence(
            array( 'sequence_id' => $sequence->id, 'active' => true )
        );

        $this->assertTrue( $result['success'] );
        $this->assertTrue( $result['changed'] );
        $this->assertSame( 'draft', $result['previous_status'] );
        $this->assertSame( 'active', $result['status'] );
        $this->assertSame( 'active', ( new SequenceRepository() )->find( $sequence->id )->status );
    }

    public function test_activate_returns_a_live_sequence_to_draft(): void
    {
        $sequence = $this->create_sequence( $this->valid_statuses() );

        $result = \VIPWorkflows\Abilities\Tools\execute_activate_sequence(
            array( 'sequence_id' => $sequence->id, 'active' => false )
        );

        $this->assertTrue( $result['changed'] );
        $this->assertSame( 'draft', $result['status'] );
        $this->assertSame( 'draft', ( new SequenceRepository() )->find( $sequence->id )->status );
    }

    public function test_activate_requires_an_explicit_intent(): void
    {
        $sequence = $this->create_sequence( $this->valid_statuses(), 'draft' );

        $result = \VIPWorkflows\Abilities\Tools\execute_activate_sequence(
            array( 'sequence_id' => $sequence->id )
        );

        $this->assertWPError( $result );
        $this->assertSame( 'missing_active', $result->get_error_code() );
        $this->assertSame( 'draft', ( new SequenceRepository() )->find( $sequence->id )->status );
    }

    public function test_activate_is_a_no_op_when_already_in_the_requested_state(): void
    {
        $sequence = $this->create_sequence( $this->valid_statuses() );

        $result = \VIPWorkflows\Abilities\Tools\execute_activate_sequence(
            array( 'sequence_id' => $sequence->id, 'active' => true )
        );

        $this->assertTrue( $result['success'] );
        $this->assertFalse( $result['changed'] );
        $this->assertSame( array(), $this->get_configuration_events( $sequence->id ), 'Nothing was written, so nothing is audited.' );
    }

    /**
     * A status-only write runs no write gate, so activation checks the stored config
     * itself. Without this, a sequence every write path would reject could still be
     * switched live.
     */
    public function test_activate_refuses_a_sequence_with_regions_but_no_entry_checkpoint(): void
    {
        // Regions present on every stage, no `region_entry` anywhere:
        // get_stages_missing_region() reports nothing, yet every reseat into
        // either region fatals.
        $sequence = $this->insert_ungated_sequence(
            array(
                'post_types' => array( 'post' ),
                'statuses'   => array(
                    array( 'key' => 'writing', 'label' => 'Writing', 'status' => 'draft' ),
                    array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish' ),
                ),
            ),
            'draft'
        );

        $this->assertSame( array(), $sequence->get_stages_missing_region() );

        $result = \VIPWorkflows\Abilities\Tools\execute_activate_sequence(
            array( 'sequence_id' => $sequence->id, 'active' => true )
        );

        $this->assertWPError( $result );
        $this->assertSame( 'sequence_invalid', $result->get_error_code() );
        $this->assertStringContainsString( 'entry checkpoint', $result->get_error_message() );
        $this->assertSame( 'draft', ( new SequenceRepository() )->find( $sequence->id )->status );
    }

    public function test_activate_refuses_a_sequence_with_a_region_less_stage(): void
    {
        $sequence = $this->insert_ungated_sequence(
            array(
                'post_types' => array( 'post' ),
                'statuses'   => array( array( 'key' => 'writing', 'label' => 'Writing' ) ),
            ),
            'draft'
        );

        $result = \VIPWorkflows\Abilities\Tools\execute_activate_sequence(
            array( 'sequence_id' => $sequence->id, 'active' => true )
        );

        $this->assertWPError( $result );
        $this->assertSame( 'sequence_invalid', $result->get_error_code() );
        $this->assertStringContainsString( 'status region', $result->get_error_message() );
    }

    /**
     * Deactivation can only reduce exposure, so a broken sequence can always be
     * taken back off.
     */
    public function test_deactivate_is_allowed_for_a_broken_sequence(): void
    {
        $sequence = $this->insert_ungated_sequence(
            array(
                'post_types' => array( 'post' ),
                'statuses'   => array( array( 'key' => 'writing', 'label' => 'Writing' ) ),
            )
        );

        $result = \VIPWorkflows\Abilities\Tools\execute_activate_sequence(
            array( 'sequence_id' => $sequence->id, 'active' => false )
        );

        $this->assertTrue( $result['changed'] );
        $this->assertSame( 'draft', $result['status'] );
    }

    // =========================================================================
    // Validate
    // =========================================================================

    public function test_validate_reports_errors_without_writing(): void
    {
        $sequence = $this->create_sequence( $this->valid_statuses() );

        $result = \VIPWorkflows\Abilities\Tools\execute_validate_sequence(
            array(
                'config' => array(
                    'statuses' => array(
                        array(
                            'key'         => 'writing',
                            'label'       => 'Writing',
                            'transitions' => array( array( 'to' => 'nowhere' ) ),
                        ),
                    ),
                ),
            )
        );

        $this->assertFalse( $result['valid'] );
        $this->assertNotEmpty( $result['errors'] );
        $this->assertStringContainsString( 'nowhere', $result['errors'][0] );
        $this->assertNull( $result['normalized_config'] );
        $this->assertNull( $result['sequence_id'] );

        // Nothing was created and nothing existing changed.
        $stored = ( new SequenceRepository() )->find( $sequence->id );
        $this->assertSame( 'Fixture Flow', $stored->name );
        $this->assertCount( 2, $stored->get_statuses() );
        $this->assertSame( array(), $this->get_configuration_events( $sequence->id ) );
    }

    public function test_validate_returns_the_normalized_config_and_describes_the_changes(): void
    {
        $result = \VIPWorkflows\Abilities\Tools\execute_validate_sequence(
            array(
                'config' => array(
                    'statuses' => array(
                        array( 'key' => 'Writing Stage', 'label' => 'Writing' ),
                        array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish' ),
                    ),
                ),
            )
        );

        $this->assertTrue( $result['valid'] );
        $this->assertSame( array(), $result['errors'] );

        // The gate's silent normalizations are reported rather than merely applied.
        $normalization = implode( "\n", $result['normalization'] );
        $this->assertStringContainsString( 'writingstage', $normalization, 'Key normalization is surfaced.' );
        $this->assertStringContainsString( 'no status region', $normalization );
        $this->assertStringContainsString( 'entry', $normalization );

        $normalized = $result['normalized_config']['statuses'];
        $this->assertSame( 'writingstage', $normalized[0]['key'] );
        $this->assertSame( 'draft', $normalized[0]['status'] );
        $this->assertTrue( $normalized[0]['region_entry'] );
        $this->assertTrue( $normalized[1]['region_entry'] );
    }

    /**
     * The invariant get_stages_missing_region() does not cover. Reported here
     * because a validator that answers "what is wrong" has to ask both questions.
     */
    public function test_validate_flags_regions_with_stages_but_no_entry_checkpoint(): void
    {
        $sequence = $this->insert_ungated_sequence(
            array(
                'post_types' => array( 'post' ),
                'statuses'   => array(
                    array( 'key' => 'writing', 'label' => 'Writing', 'status' => 'draft' ),
                    array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish' ),
                ),
            )
        );

        $result = \VIPWorkflows\Abilities\Tools\execute_validate_sequence(
            array( 'sequence_id' => $sequence->id )
        );

        $this->assertSame( $sequence->id, $result['sequence_id'] );
        $this->assertSame( array(), $result['stages_missing_region'], 'The region detector alone reports nothing here.' );
        $this->assertEqualsCanonicalizing( array( 'draft', 'publish' ), $result['regions_missing_entry'] );

        // The gate itself accepts the config — it auto-assigns the checkpoints — so
        // `valid` alone would have hidden the stored defect entirely.
        $this->assertTrue( $result['valid'] );
        $this->assertNotEmpty( $result['normalization'] );
    }

    public function test_validate_flags_a_stored_region_less_stage(): void
    {
        $sequence = $this->insert_ungated_sequence(
            array(
                'post_types' => array( 'post' ),
                'statuses'   => array( array( 'key' => 'writing', 'label' => 'Writing' ) ),
            )
        );

        $result = \VIPWorkflows\Abilities\Tools\execute_validate_sequence(
            array( 'sequence_id' => $sequence->id )
        );

        $this->assertSame( array( 'writing' ), $result['stages_missing_region'] );
        $this->assertSame( array(), $result['regions_missing_entry'], 'A region-less stage belongs to the other invariant only.' );
    }

    public function test_validate_requires_exactly_one_source(): void
    {
        $neither = \VIPWorkflows\Abilities\Tools\execute_validate_sequence( array() );
        $this->assertWPError( $neither );
        $this->assertSame( 'missing_input', $neither->get_error_code() );

        $both = \VIPWorkflows\Abilities\Tools\execute_validate_sequence(
            array( 'sequence_id' => 1, 'config' => array( 'statuses' => array() ) )
        );
        $this->assertWPError( $both );
        $this->assertSame( 'ambiguous_input', $both->get_error_code() );
    }

    /**
     * Registered output schemas have to actually describe what the callbacks
     * return: WP_Ability::execute() validates the output and turns a mismatch into
     * a WP_Error, so this covers all three at once.
     */
    public function test_registered_output_schemas_accept_the_real_payloads(): void
    {
        $sequence = $this->create_sequence( $this->valid_statuses(), 'draft' );

        $validated = wp_get_ability( 'vip-workflows/validate-sequence' )
            ->execute( array( 'sequence_id' => $sequence->id ) );
        $this->assertIsArray( $validated );
        $this->assertTrue( $validated['valid'] );

        $updated = wp_get_ability( 'vip-workflows/update-sequence' )->execute(
            array(
                'sequence_id' => $sequence->id,
                'name'        => 'Schema Flow',
                'post_types'  => array( 'post' ),
                'statuses'    => $this->valid_statuses(),
            )
        );
        $this->assertIsArray( $updated );
        $this->assertTrue( $updated['success'] );

        $activated = wp_get_ability( 'vip-workflows/activate-sequence' )
            ->execute( array( 'sequence_id' => $sequence->id, 'active' => true ) );
        $this->assertIsArray( $activated );
        $this->assertTrue( $activated['changed'] );
    }

    // =========================================================================
    // Attribution
    // =========================================================================

    /**
     * A configuration write has no post, so it is audited with a NULL `post_id` —
     * which the column already allows — and credited to the acting ability through
     * the existing agent scheme (`actor_type` = 'agent' plus `event_data.agent_actor`),
     * while `actor_id` still records the account that authorized it.
     */
    public function test_update_records_an_agent_attributed_configuration_event(): void
    {
        $sequence = $this->create_sequence( $this->valid_statuses() );

        \VIPWorkflows\Abilities\Tools\execute_update_sequence(
            array(
                'sequence_id' => $sequence->id,
                'name'        => 'Audited Flow',
                'post_types'  => array( 'post' ),
                'statuses'    => $this->valid_statuses(),
            )
        );

        $events = $this->get_configuration_events( $sequence->id );
        $this->assertCount( 1, $events );

        $event = $events[0];
        $this->assertSame( 'sequence.updated', $event->event_type );
        $this->assertNull( $event->post_id, 'A configuration event has no post.' );
        $this->assertSame( 'agent', $event->actor_type );
        $this->assertSame( $this->admin_id, (int) $event->actor_id );

        $data = json_decode( $event->event_data, true );
        $this->assertSame( 'vip-workflows/update-sequence', $data['agent_actor'] );
        $this->assertSame( 'Audited Flow', $data['sequence_name'] );
        $this->assertSame( $sequence->id, $data['sequence_id'] );

        // The audit trail renders the ability, not the impersonated human.
        $this->assertSame(
            'Update Sequence',
            \VIPWorkflows\Workflow\Actor::name_for(
                array(
                    'actor_id'    => (int) $event->actor_id,
                    'actor_type'  => $event->actor_type,
                    'agent_actor' => $data['agent_actor'],
                )
            )
        );
    }

    public function test_activate_records_a_distinct_agent_attributed_event(): void
    {
        $sequence = $this->create_sequence( $this->valid_statuses(), 'draft' );

        \VIPWorkflows\Abilities\Tools\execute_activate_sequence(
            array( 'sequence_id' => $sequence->id, 'active' => true )
        );
        \VIPWorkflows\Abilities\Tools\execute_activate_sequence(
            array( 'sequence_id' => $sequence->id, 'active' => false )
        );

        $events = $this->get_configuration_events( $sequence->id );
        $this->assertCount( 2, $events );

        // Newest first.
        $this->assertSame( 'sequence.deactivated', $events[0]->event_type );
        $this->assertSame( 'sequence.activated', $events[1]->event_type );

        foreach ( $events as $event ) {
            $this->assertNull( $event->post_id );
            $this->assertSame( 'agent', $event->actor_type );
            $data = json_decode( $event->event_data, true );
            $this->assertSame( 'vip-workflows/activate-sequence', $data['agent_actor'] );
        }

        $activated = json_decode( $events[1]->event_data, true );
        $this->assertSame( 'draft', $activated['previous_status'] );
        $this->assertSame( 'active', $activated['sequence_status'] );
    }

    /**
     * The audit surface can render a post-less configuration event: the REST
     * response reports no post rather than fabricating one, and the event type has a
     * label.
     */
    public function test_audit_log_response_renders_a_post_less_configuration_event(): void
    {
        $sequence = $this->create_sequence( $this->valid_statuses(), 'draft' );

        \VIPWorkflows\Abilities\Tools\execute_activate_sequence(
            array( 'sequence_id' => $sequence->id, 'active' => true )
        );

        $request = new \WP_REST_Request( 'GET', '/vip-workflows/v1/audit-log/events' );
        $request->set_param( 'page', 1 );
        $request->set_param( 'per_page', 50 );
        $request->set_param( 'event_type', 'sequence.activated' );
        // Route defaults are applied by the REST server on dispatch; this calls the
        // handler directly, so the ordering params have to be supplied.
        $request->set_param( 'orderby', 'created_at' );
        $request->set_param( 'order', 'desc' );

        $response = ( new \VIPWorkflows\API\AuditLogController() )->get_events( $request );
        $events   = $response->get_data()['events'];

        $this->assertNotEmpty( $events );
        $event = $events[0];

        $this->assertNull( $event['post'] );
        $this->assertSame( 'Sequence Activated', $event['event_type_label'] );
        $this->assertSame( 'agent', $event['actor']['type'] );
        $this->assertSame( 'Activate Sequence', $event['actor']['display_name'] );
    }
}
