<?php
/**
 * DiscoveryProviderRegistry availability unit tests.
 *
 * The registry mirrors `Ability`'s availability contract so the Agents surface
 * can aggregate requirements from abilities and discovery providers through one
 * shape. These tests pin the mirrored behavior, including that `is_available()`
 * keeps its bool signature and its permissive default.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\Abilities\Availability;
use VIPWorkflow\Abilities\Destination;
use VIPWorkflow\Abilities\Requirement;
use VIPWorkflow\Abilities\RequirementGroup;
use VIPWorkflow\Discovery\DiscoveryProviderRegistry;

class DiscoveryProviderRegistryTest extends TestCase
{
    protected function set_up()
    {
        parent::set_up();

        Functions\when( 'get_option' )->justReturn( array() );
        $this->reset_singleton( DiscoveryProviderRegistry::class );
    }

    private function reset_singleton( string $class_name ): void
    {
        $property = new \ReflectionProperty( $class_name, 'instance' );
        $property->setValue( null, null );
    }

    /**
     * Register a minimally-valid provider.
     *
     * @param string $slug     Provider slug.
     * @param mixed  $callback Availability callback, or null for none.
     */
    private function register_provider( string $slug, $callback = null ): void
    {
        $args = array(
            'label'     => 'Test Provider',
            'features'  => array( 'recommend' ),
            'callbacks' => array(
                'recommend' => static fn() => array(),
                'seed'      => static fn() => array(),
            ),
        );

        if ( null !== $callback ) {
            $args['availability_callback'] = $callback;
        }

        DiscoveryProviderRegistry::get_instance()->register( $slug, $args );
    }

    private function make_requirement(): Requirement
    {
        return new Requirement(
            'settings:foresight',
            Requirement::KIND_MISSING_CREDENTIAL,
            'Foresight credentials are not set.',
            'Foresight research is unavailable.',
            Destination::in_card( 'Complete the fields below.' ),
            array( 'Foresight' )
        );
    }

    public function test_no_callback_is_available(): void
    {
        $this->register_provider( 'no-callback' );

        $registry = DiscoveryProviderRegistry::get_instance();

        $this->assertTrue( $registry->is_available( 'no-callback' ) );
        $this->assertSame( array(), $registry->get_availability( 'no-callback' )->get_requirements() );
    }

    public function test_unknown_provider_is_unavailable(): void
    {
        $registry = DiscoveryProviderRegistry::get_instance();

        $this->assertFalse( $registry->is_available( 'does-not-exist' ) );
        $this->assertSame( array(), $registry->get_availability( 'does-not-exist' )->get_requirements() );
    }

    public function test_bool_true_callback_is_available(): void
    {
        $this->register_provider( 'bool-true', '__return_true' );

        $this->assertTrue( DiscoveryProviderRegistry::get_instance()->is_available( 'bool-true' ) );
    }

    public function test_bool_false_callback_is_unavailable_without_requirements(): void
    {
        $this->register_provider( 'bool-false', '__return_false' );

        $registry = DiscoveryProviderRegistry::get_instance();

        $this->assertFalse( $registry->is_available( 'bool-false' ) );
        $this->assertSame( array(), $registry->get_availability( 'bool-false' )->get_requirements() );
    }

    public function test_structured_callback_preserves_requirements(): void
    {
        $requirement = $this->make_requirement();

        $this->register_provider(
            'structured',
            function () use ( $requirement ): Availability {
                return Availability::unmet( RequirementGroup::all( $requirement ) );
            }
        );

        $registry     = DiscoveryProviderRegistry::get_instance();
        $availability = $registry->get_availability( 'structured' );

        $this->assertFalse( $registry->is_available( 'structured' ) );
        $this->assertCount( 1, $availability->get_requirements() );
        $this->assertSame( 'settings:foresight', $availability->get_requirements()[0]->get_id() );
        $this->assertSame(
            Destination::KIND_IN_CARD,
            $availability->get_requirements()[0]->get_destination()->get_kind()
        );
    }

    /**
     * The historic contract cast every return to bool. A legacy callback handing
     * back a truthy array must keep reporting available rather than silently
     * dropping a working provider.
     */
    public function test_legacy_truthy_array_callback_stays_available(): void
    {
        $this->register_provider(
            'legacy-array',
            static function (): array {
                return array( 'legacy' => 'payload' );
            }
        );

        $this->assertTrue( DiscoveryProviderRegistry::get_instance()->is_available( 'legacy-array' ) );
    }

    public function test_is_available_returns_a_strict_bool(): void
    {
        $this->register_provider(
            'scalar',
            static function () {
                return 1;
            }
        );

        $this->assertIsBool( DiscoveryProviderRegistry::get_instance()->is_available( 'scalar' ) );
    }

    /**
     * get_available_by_feature() filters through is_available(), so a coercion
     * change here would silently drop providers from feature lookups.
     */
    public function test_get_available_by_feature_still_filters_on_availability(): void
    {
        $this->register_provider( 'yes', '__return_true' );
        $this->register_provider( 'no', '__return_false' );

        $available = DiscoveryProviderRegistry::get_instance()->get_available_by_feature( 'recommend' );

        $this->assertArrayHasKey( 'yes', $available );
        $this->assertArrayNotHasKey( 'no', $available );
    }

    public function test_get_available_by_feature_keeps_structured_unavailable_providers_out(): void
    {
        $requirement = $this->make_requirement();

        $this->register_provider( 'yes', '__return_true' );
        $this->register_provider(
            'structured-no',
            function () use ( $requirement ): Availability {
                return Availability::unmet( RequirementGroup::all( $requirement ) );
            }
        );

        $available = DiscoveryProviderRegistry::get_instance()->get_available_by_feature( 'recommend' );

        $this->assertArrayHasKey( 'yes', $available );
        $this->assertArrayNotHasKey( 'structured-no', $available );
    }

    /**
     * Mirrors workflow-discovery-test, which registers '__return_true'.
     */
    public function test_existing_external_registration_shape_is_unaffected(): void
    {
        $this->register_provider( 'workflow-discovery-test', '__return_true' );

        $registry = DiscoveryProviderRegistry::get_instance();

        $this->assertTrue( $registry->is_available( 'workflow-discovery-test' ) );
        $this->assertSame( array(), $registry->get_availability( 'workflow-discovery-test' )->get_requirements() );
    }
}
