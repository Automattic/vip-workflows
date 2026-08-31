<?php
/**
 * Registration-contract tests for the sequence modification abilities.
 *
 * Captures the args passed to the registrar so the agent-facing wording, the
 * manage_options gate, the deliberate absence of a lifecycle field on the update
 * surface, and public MCP exposure can be asserted without booting WordPress. The
 * execute callbacks reach the real controller/repository, so their behavior is covered
 * in the integration suite — `WP_Ability` does not exist here.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;

// The registrar these abilities use. Loaded here rather than left to whichever
// other test file happens to pull it in, so this file does not depend on
// execution order.
require_once dirname( __DIR__, 3 ) . '/includes/abilities/functions.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/update-sequence.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/activate-sequence.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/validate-sequence.php';

/**
 * Tests that update / activate / validate register with the expected contract.
 */
class SequenceWriteAbilityRegistrationTest extends TestCase
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

        // These abilities register through vip_workflows_register_ability(), which is
        // a real (already-loaded) function and therefore cannot be redefined by
        // Brain\Monkey. Capture at the boundary it delegates to instead — that also
        // proves the wrapper was used rather than core's registrar, because a plain
        // wp_register_ability() call would carry no `ability_class`.
        Functions\when( 'wp_register_ability' )->alias(
            function ( $name, $args ) {
                $this->registered[ $name ] = $args;
                // Null, not true: the wrapper's return type is `?WP_Ability`, and
                // WP_Ability does not exist in a suite that never boots WordPress.
                return null;
            }
        );

        \VIPWorkflows\Abilities\Tools\register_update_sequence();
        \VIPWorkflows\Abilities\Tools\register_activate_sequence();
        \VIPWorkflows\Abilities\Tools\register_validate_sequence();
    }

    /**
     * @return array<string, array{0: string, 1: string}>
     */
    public function data_abilities(): array
    {
        return array(
            'update'   => array( 'vip-workflows/update-sequence', 'Update Sequence' ),
            'activate' => array( 'vip-workflows/activate-sequence', 'Activate Sequence' ),
            'validate' => array( 'vip-workflows/validate-sequence', 'Validate Sequence' ),
        );
    }

    /**
     * @dataProvider data_abilities
     *
     * @param string $slug  Ability slug.
     * @param string $label Expected agent-facing label.
     */
    public function test_registers_with_sequence_terminology( string $slug, string $label ): void
    {
        $this->assertArrayHasKey( $slug, $this->registered );
        $args = $this->registered[ $slug ];

        $this->assertSame( $label, $args['label'] );
        $this->assertStringContainsStringIgnoringCase( 'sequence', $args['description'] );
        $this->assertStringNotContainsStringIgnoringCase( 'blueprint', $args['description'] );
        $this->assertSame( 'vip-workflows', $args['category'] );

        // Registered through the VIP wrapper: Core instantiates our Ability
        // subclass, so the ability keeps is_available() and the rest of the meta
        // extensions a plain WP_Ability silently discards.
        $this->assertSame( \VIPWorkflows\Abilities\Ability::class, $args['ability_class'] );
    }

    /**
     * A sequence write rewrites who may do what, so every one of these — the
     * read-only dry run included, since it returns the whole stored config — is
     * gated on manage_options.
     *
     * @dataProvider data_abilities
     *
     * @param string $slug Ability slug.
     */
    public function test_requires_manage_options( string $slug ): void
    {
        $callback = $this->registered[ $slug ]['permission_callback'];

        Functions\expect( 'current_user_can' )->once()->with( 'manage_options' )->andReturn( false );
        $this->assertFalse( $callback() );
    }

    /**
     * @dataProvider data_abilities
     *
     * @param string $slug Ability slug.
     */
    public function test_is_exposed_to_mcp_and_not_the_command_palette( string $slug ): void
    {
        $meta = $this->registered[ $slug ]['meta'];

        $this->assertTrue( $meta['mcp']['public'] );
        $this->assertSame( 'tool', $meta['mcp']['type'] );
        $this->assertFalse( $meta['show_in_commands'] );
        $this->assertFalse( $meta['transition_eligible'] );
    }

    /**
     * No availability callback: none of these depends on an external credential or
     * service, and the availability surface exists to report a missing dependency.
     *
     * @dataProvider data_abilities
     *
     * @param string $slug Ability slug.
     */
    public function test_declares_no_availability_callback( string $slug ): void
    {
        $this->assertArrayNotHasKey( 'availability_callback', $this->registered[ $slug ]['meta'] );
    }

    /**
     * The separation of concerns, pinned at the schema: an update call has no way to
     * express a lifecycle change, and the field allowlist it hands the controller has
     * no `status` member either.
     */
    public function test_update_cannot_express_a_lifecycle_change(): void
    {
        $schema = $this->registered['vip-workflows/update-sequence']['input_schema'];

        $this->assertFalse( $schema['additionalProperties'] );
        $this->assertArrayNotHasKey( 'status', $schema['properties'] );
        $this->assertArrayNotHasKey( 'active', $schema['properties'] );
        $this->assertSame( array( 'sequence_id', 'name', 'statuses' ), $schema['required'] );

        $this->assertNotContains( 'status', \VIPWorkflows\Abilities\Tools\UPDATE_SEQUENCE_FIELDS );
        $this->assertContains( 'statuses', \VIPWorkflows\Abilities\Tools\UPDATE_SEQUENCE_FIELDS );
    }

    /**
     * Activation intent is required with no default, so putting a sequence live is
     * always something the caller asked for in as many words.
     */
    public function test_activate_requires_an_explicit_boolean_intent(): void
    {
        $schema = $this->registered['vip-workflows/activate-sequence']['input_schema'];

        $this->assertSame( array( 'sequence_id', 'active' ), $schema['required'] );
        $this->assertSame( 'boolean', $schema['properties']['active']['type'] );
        $this->assertArrayNotHasKey( 'default', $schema['properties']['active'] );

        // And it cannot rewrite the configuration on the way through.
        $this->assertArrayNotHasKey( 'statuses', $schema['properties'] );
        $this->assertArrayNotHasKey( 'name', $schema['properties'] );
    }

    /**
     * The dry run is annotated read-only and takes exactly one of the two sources.
     */
    public function test_validate_is_read_only_and_reports_both_invariants(): void
    {
        $args = $this->registered['vip-workflows/validate-sequence'];

        $this->assertTrue( $args['meta']['annotations']['readonly'] );
        $this->assertTrue( $args['meta']['annotations']['idempotent'] );

        $props = $args['input_schema']['properties'];
        $this->assertArrayHasKey( 'sequence_id', $props );
        $this->assertArrayHasKey( 'config', $props );
        $this->assertArrayNotHasKey( 'required', $args['input_schema'], 'Either source is accepted; the callback enforces exactly one.' );

        $output = $args['output_schema']['properties'];
        $this->assertArrayHasKey( 'stages_missing_region', $output );
        $this->assertArrayHasKey( 'regions_missing_entry', $output );
        $this->assertArrayHasKey( 'normalization', $output );
        $this->assertArrayHasKey( 'normalized_config', $output );
    }

    /**
     * Update is annotated destructive: it replaces the whole configuration, so an
     * omitted field is a cleared field.
     */
    public function test_update_is_annotated_destructive(): void
    {
        $annotations = $this->registered['vip-workflows/update-sequence']['meta']['annotations'];

        $this->assertFalse( $annotations['readonly'] );
        $this->assertTrue( $annotations['destructive'] );
    }
}
