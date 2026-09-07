<?php
/**
 * Ability availability contract, against WordPress core's real WP_Ability.
 *
 * Lives in the integration suite because `Ability` extends core's `WP_Ability`,
 * whose constructor runs prepare_properties() + validation. The unit suite has
 * no `WP_Ability` at all, so the branch matrix below cannot be proven there —
 * only the value objects can (see tests/phpunit/Unit/AvailabilityTest.php).
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\Ability;
use VIPWorkflows\Abilities\Availability;
use VIPWorkflows\Abilities\Destination;
use VIPWorkflows\Abilities\Requirement;
use VIPWorkflows\Abilities\RequirementGroup;

class AbilityAvailabilityTest extends TestCase
{
    /**
     * Build an Ability whose availability_callback returns $return.
     *
     * @param mixed $return    What the callback hands back.
     * @param bool  $with_meta Whether to register a callback at all.
     */
    private function make_ability( $return, bool $with_meta = true ): Ability
    {
        $meta = array(
            'icon'             => '🧪',
            'thinking_message' => 'Thinking…',
            'success_message'  => 'Done.',
            'show_in_rest'     => true,
        );

        if ( $with_meta ) {
            $meta['availability_callback'] = static function () use ( $return ) {
                return $return;
            };
        }

        return new Ability(
            'vip-workflows/availability-fixture',
            array(
                'label'               => 'Availability Fixture',
                'description'         => 'An ability used to exercise the availability contract.',
                'category'            => 'research',
                'execute_callback'    => static fn() => 'ok',
                'permission_callback' => static fn() => true,
                'input_schema'        => array(
                    'type'       => 'object',
                    'properties' => array( 'text' => array( 'type' => 'string' ) ),
                ),
                'meta'                => $meta,
            )
        );
    }

    private function make_requirement(): Requirement
    {
        return new Requirement(
            'credential:tavily',
            Requirement::KIND_MISSING_CREDENTIAL,
            'Tavily is not connected.',
            'Web research is unavailable.',
            Destination::none( 'Set VIP_WORKFLOWS_TAVILY_KEY.' ),
            array( 'Web Researcher' )
        );
    }

    public function test_no_callback_is_available(): void
    {
        $ability = $this->make_ability( null, false );

        $this->assertTrue( $ability->is_available() );
        $this->assertSame( array(), $ability->get_availability()->get_requirements() );
    }

    public function test_bool_true_callback_is_available(): void
    {
        $ability = $this->make_ability( true );

        $this->assertTrue( $ability->is_available() );
        $this->assertSame( array(), $ability->get_availability()->get_requirements() );
    }

    public function test_bool_false_callback_is_unavailable_without_requirements(): void
    {
        $ability = $this->make_ability( false );

        $this->assertFalse( $ability->is_available() );
        $this->assertSame( array(), $ability->get_availability()->get_requirements() );
    }

    public function test_structured_callback_preserves_requirements(): void
    {
        $ability = $this->make_ability(
            Availability::unmet( RequirementGroup::all( $this->make_requirement() ) )
        );

        $availability = $ability->get_availability();

        $this->assertFalse( $ability->is_available() );
        $this->assertCount( 1, $availability->get_requirements() );
        $this->assertSame( 'credential:tavily', $availability->get_requirements()[0]->get_id() );
        $this->assertSame( array( 'Web Researcher' ), $availability->get_requirements()[0]->get_sources() );
    }

    public function test_structured_available_callback_reports_available(): void
    {
        $ability = $this->make_ability( Availability::available() );

        $this->assertTrue( $ability->is_available() );
        $this->assertSame( array(), $ability->get_availability()->get_requirements() );
    }

    /**
     * The historic contract cast every return value to bool. A legacy callback
     * handing back a truthy array must keep reporting available — silently
     * flipping it to unavailable would disable a working third-party agent.
     */
    public function test_legacy_truthy_array_callback_stays_available(): void
    {
        $ability = $this->make_ability( array( 'legacy' => 'payload' ) );

        $this->assertTrue( $ability->is_available() );
        $this->assertSame( array(), $ability->get_availability()->get_requirements() );
    }

    public function test_legacy_null_callback_is_unavailable(): void
    {
        $ability = $this->make_ability( null );

        $this->assertFalse( $ability->is_available() );
    }

    public function test_legacy_truthy_scalar_callback_stays_available(): void
    {
        $this->assertTrue( $this->make_ability( 1 )->is_available() );
        $this->assertTrue( $this->make_ability( 'yes' )->is_available() );
    }

    public function test_is_available_always_returns_a_strict_bool(): void
    {
        foreach ( array( true, false, null, 1, 'yes', array( 'x' ), Availability::available() ) as $return ) {
            $this->assertIsBool( $this->make_ability( $return )->is_available() );
        }
    }

    /**
     * Mirrors how workflow-discovery-foresight registers availability: a plain
     * named function returning bool, passed through meta.
     */
    public function test_plain_bool_function_callback_behaves_as_before(): void
    {
        $ability = new Ability(
            'vip-workflows/availability-fixture-fn',
            array(
                'label'               => 'Availability Fixture',
                'description'         => 'An ability used to exercise the availability contract.',
                'category'            => 'research',
                'execute_callback'    => static fn() => 'ok',
                'permission_callback' => static fn() => true,
                'input_schema'        => array( 'type' => 'object' ),
                'meta'                => array(
                    'availability_callback' => '__return_false',
                ),
            )
        );

        $this->assertFalse( $ability->is_available() );
        $this->assertSame( array(), $ability->get_availability()->get_requirements() );
    }
}
