<?php
/**
 * Registration-contract test for get-available-transitions.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-available-transitions.php';

/**
 * The ability must not accept a caller-supplied user_id — transitions are always
 * resolved for the authenticated caller, so another user's effective workflow
 * permissions can't be enumerated.
 */
class GetAvailableTransitionsRegistrationTest extends TestCase
{
    /**
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

    public function test_input_schema_does_not_accept_user_id(): void
    {
        \VIPWorkflows\Abilities\Tools\register_get_available_transitions();

        $args   = $this->registered['vip-workflows/get-available-transitions'];
        $schema = $args['input_schema'];

        $this->assertArrayNotHasKey( 'user_id', $schema['properties'] );
        // additionalProperties:false means a supplied user_id is rejected outright.
        $this->assertFalse( $schema['additionalProperties'] );
        $this->assertSame( array( 'post_id' ), $schema['required'] );
    }
}
