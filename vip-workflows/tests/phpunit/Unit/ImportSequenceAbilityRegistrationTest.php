<?php
/**
 * Registration-contract tests for the Import Sequence ability.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/import-sequence.php';

/**
 * Tests that the Import Sequence ability registers with the expected contract.
 */
class ImportSequenceAbilityRegistrationTest extends TestCase
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

    public function test_registers_with_sequence_terminology_and_required_input(): void
    {
        \VIPWorkflow\Abilities\Tools\register_import_sequence();

        $this->assertArrayHasKey( 'vip-workflow/import-sequence', $this->registered );
        $args = $this->registered['vip-workflow/import-sequence'];

        $this->assertSame( 'Import Sequence', $args['label'] );
        $this->assertStringContainsStringIgnoringCase( 'sequence', $args['description'] );
        $this->assertStringNotContainsStringIgnoringCase( 'blueprint', $args['description'] );
        $this->assertSame( array( 'sequence_json' ), $args['input_schema']['required'] );
        $this->assertArrayHasKey( 'sequence_id', $args['output_schema']['properties'] );
    }

    public function test_requires_manage_options_and_is_public_to_mcp(): void
    {
        \VIPWorkflow\Abilities\Tools\register_import_sequence();
        $args = $this->registered['vip-workflow/import-sequence'];

        Functions\expect( 'current_user_can' )
            ->once()
            ->with( 'manage_options' )
            ->andReturn( false );

        $this->assertFalse( ( $args['permission_callback'] )() );
        $this->assertTrue( $args['meta']['mcp']['public'] );
        $this->assertFalse( $args['meta']['annotations']['readonly'] );
    }
}
