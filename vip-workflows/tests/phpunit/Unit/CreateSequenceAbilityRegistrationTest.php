<?php
/**
 * Registration-contract tests for the Create Sequence ability.
 *
 * Captures the args passed to wp_register_ability() so we can assert the
 * agent-facing label/description wording, the required input keys, the
 * sequence_* output keys, the manage_options permission gate, and public MCP
 * exposure — all without booting WordPress. The execute callback delegates to
 * SequencesController::create_item() (real WP create path), so its behavior is
 * covered by the integration suite, not here.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/create-sequence.php';

/**
 * Tests that the Create Sequence ability registers with the expected contract.
 */
class CreateSequenceAbilityRegistrationTest extends TestCase
{
    /**
     * Captured ability registrations, keyed by slug.
     *
     * @var array<string, array>
     */
    private array $registered = array();

    protected function set_up()
    {
        parent::set_up();

        $this->registered = array();
        Functions\when( 'wp_register_ability' )->alias(
            function ( $name, $args ) {
                $this->registered[ $name ] = $args;
                return true;
            }
        );
    }

    public function test_registers_under_stable_slug_with_sequence_terminology(): void
    {
        \VIPWorkflows\Abilities\Tools\register_create_sequence();

        $this->assertArrayHasKey( 'vip-workflows/create-sequence', $this->registered );
        $args = $this->registered['vip-workflows/create-sequence'];

        // Agent-facing wording uses "sequence", never "sequence".
        $this->assertSame( 'Create Sequence', $args['label'] );
        $this->assertStringContainsStringIgnoringCase( 'sequence', $args['description'] );
        $this->assertStringNotContainsStringIgnoringCase( 'blueprint', $args['description'] );
        $this->assertSame( 'vip-workflows', $args['category'] );
    }

    public function test_input_schema_requires_name_and_statuses(): void
    {
        \VIPWorkflows\Abilities\Tools\register_create_sequence();
        $args = $this->registered['vip-workflows/create-sequence'];

        $this->assertSame( array( 'name', 'statuses' ), $args['input_schema']['required'] );

        $props = $args['input_schema']['properties'];
        $this->assertArrayHasKey( 'name', $props );
        $this->assertArrayHasKey( 'statuses', $props );
        $this->assertSame( array( 'workflow', 'phase' ), $props['type']['enum'] );
    }

    public function test_status_and_metadata_item_schemas_match_the_rest_contract(): void
    {
        \VIPWorkflows\Abilities\Tools\register_create_sequence();
        $props = $this->registered['vip-workflows/create-sequence']['input_schema']['properties'];

        // statuses items declare required keys and the full property set the
        // controller's build_config() honours (parity with get_create_args()).
        $status_items = $props['statuses']['items'];
        $this->assertSame( array( 'key', 'label' ), $status_items['required'] );
        foreach ( array( 'key', 'label', 'color', 'is_terminal', 'is_initial', 'is_dead_end', 'is_in_progress', 'creates_post', 'status', 'region_entry', 'transitions' ) as $field ) {
            $this->assertArrayHasKey( $field, $status_items['properties'], "statuses item missing $field" );
        }

        // Stage × status matrix: the per-stage `status` region is constrained to
        // the core editorial statuses; the removed public/publish flags are gone.
        $this->assertSame( \VIPWorkflows\Sequences\Sequence::EDITORIAL_STATUSES, $status_items['properties']['status']['enum'] );
        $this->assertArrayNotHasKey( 'public', $status_items['properties'] );
        $this->assertArrayNotHasKey( 'publish', $status_items['properties'] );

        // metadata_fields items expose their shape + the valid type enum.
        $meta_items = $props['metadata_fields']['items'];
        $this->assertSame( array( 'key', 'label', 'type' ), $meta_items['required'] );
        $this->assertSame( array( 'text', 'textarea', 'select', 'date', 'user' ), $meta_items['properties']['type']['enum'] );
    }

    public function test_agent_routing_schema_exposes_only_binary_outcomes(): void
    {
        \VIPWorkflows\Abilities\Tools\register_create_sequence();
        $props = $this->registered['vip-workflows/create-sequence']['input_schema']['properties'];

        // Stage agents make a binary editorial judgment: routing exposes only
        // pass, fail, and the system-level error outcome — never warning.
        $routing_props = $props['statuses']['items']['properties']['agent']['properties']['routing']['properties'];
        $this->assertSame( array( 'pass', 'fail', 'error' ), array_keys( $routing_props ) );
        $this->assertArrayNotHasKey( 'warning', $routing_props );
    }

    public function test_output_schema_uses_sequence_id_key(): void
    {
        \VIPWorkflows\Abilities\Tools\register_create_sequence();
        $args = $this->registered['vip-workflows/create-sequence'];

        $props = $args['output_schema']['properties'];
        $this->assertArrayHasKey( 'sequence_id', $props );
        $this->assertArrayNotHasKey( 'blueprint_id', $props );
        $this->assertArrayHasKey( 'success', $props );
        $this->assertArrayHasKey( 'warnings', $props );
    }

    public function test_permission_callback_requires_manage_options(): void
    {
        \VIPWorkflows\Abilities\Tools\register_create_sequence();
        $args = $this->registered['vip-workflows/create-sequence'];

        Functions\expect( 'current_user_can' )
            ->once()
            ->with( 'manage_options' )
            ->andReturn( true );

        $this->assertTrue( ( $args['permission_callback'] )() );
    }

    public function test_permission_callback_denies_users_without_manage_options(): void
    {
        \VIPWorkflows\Abilities\Tools\register_create_sequence();
        $args = $this->registered['vip-workflows/create-sequence'];

        Functions\expect( 'current_user_can' )
            ->once()
            ->with( 'manage_options' )
            ->andReturn( false );

        $this->assertFalse( ( $args['permission_callback'] )() );
    }

    public function test_exposed_publicly_to_mcp_as_a_non_readonly_tool(): void
    {
        \VIPWorkflows\Abilities\Tools\register_create_sequence();
        $args = $this->registered['vip-workflows/create-sequence'];

        $this->assertTrue( $args['meta']['mcp']['public'] );
        $this->assertSame( 'tool', $args['meta']['mcp']['type'] );
        $this->assertFalse( $args['meta']['annotations']['readonly'] );
    }
}
