<?php
/**
 * Registration-contract tests for the renamed Sequence abilities.
 *
 * Captures the args passed to wp_register_ability() so we can assert the
 * agent-facing label/description wording and the renamed input/output schema
 * keys (sequence_*), while proving the machine slugs are unchanged. The
 * execute_* functions instantiate SequenceRepository/WP_Query directly (no DI
 * seam), so the registered schema is the unit-testable surface; the renamed
 * nested output keys in the sibling tools are covered by the residual-term
 * audit + code review.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-sequences.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-workflow-summary.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-my-assignments.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-posts-by-status.php';

/**
 * Tests that the Sequence-renamed abilities register with sequence_* schema
 * keys under their unchanged slugs.
 */
class SequenceAbilityRegistrationTest extends TestCase
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

    public function test_get_sequences_keeps_slug_and_uses_sequence_terminology(): void
    {
        \VIPWorkflows\Abilities\Tools\register_get_sequences();

        // Slug is unchanged (keep-slugs decision).
        $this->assertArrayHasKey( 'vip-workflows/get-sequences', $this->registered );
        $args = $this->registered['vip-workflows/get-sequences'];

        // Agent-facing label/description say "sequence", not "sequence".
        $this->assertSame( 'Get Sequences', $args['label'] );
        $this->assertStringContainsStringIgnoringCase( 'sequence', $args['description'] );
        $this->assertStringNotContainsStringIgnoringCase( 'blueprint', $args['description'] );

        // Output key renamed.
        $props = $args['output_schema']['properties'];
        $this->assertArrayHasKey( 'sequences', $props );
        $this->assertArrayNotHasKey( 'blueprints', $props );
    }

    public function test_get_workflow_summary_renames_input_and_output_keys(): void
    {
        \VIPWorkflows\Abilities\Tools\register_get_workflow_summary();

        $this->assertArrayHasKey( 'vip-workflows/get-workflow-summary', $this->registered );
        $args = $this->registered['vip-workflows/get-workflow-summary'];

        // Input param renamed sequence_id -> sequence_id.
        $input_props = $args['input_schema']['properties'];
        $this->assertArrayHasKey( 'sequence_id', $input_props );
        $this->assertArrayNotHasKey( 'blueprint_id', $input_props );

        // Output key renamed sequences -> sequences.
        $output_props = $args['output_schema']['properties'];
        $this->assertArrayHasKey( 'sequences', $output_props );
        $this->assertArrayNotHasKey( 'blueprints', $output_props );
    }

    public function test_sibling_tools_register_under_unchanged_slugs(): void
    {
        \VIPWorkflows\Abilities\Tools\register_get_my_assignments();
        \VIPWorkflows\Abilities\Tools\register_get_posts_by_status();

        // The keep-slugs decision applies to every tool, not just the renamed
        // pair — these guard against an accidental slug rename.
        $this->assertArrayHasKey( 'vip-workflows/get-my-assignments', $this->registered );
        $this->assertArrayHasKey( 'vip-workflows/get-posts-by-status', $this->registered );
    }
}
