<?php
/**
 * AbilityRegistry / Ability coverage against WordPress core's WP_Ability.
 *
 * This runs in the integration suite so it binds to the *same* `WP_Ability`
 * the plugin uses in production — the one bundled with WordPress core (6.9+),
 * not a Composer-pinned snapshot. The real constructor runs
 * prepare_properties() + validation, so these tests fail if either the plugin's
 * Ability subclass *or* core's Ability shape drifts. (Previously this lived in
 * the unit suite and loaded a vendored `wordpress/abilities-api` RC, which
 * could silently drift from core and hide — or invent — failures.)
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use ReflectionClass;
use VIPWorkflow\Abilities\Ability;
use VIPWorkflow\Abilities\AbilityRegistry;

class AbilityRegistryTest extends TestCase
{
    public function set_up(): void
    {
        parent::set_up();

        // AbilityRegistry is a singleton; reset between tests.
        AbilityRegistry::get_instance()->clear();
    }

    /**
     * Build a valid Ability backed by core's real WP_Ability.
     */
    private function make_ability( string $name, string $category = 'research', array $overrides = array() ): Ability
    {
        $args = array_merge(
            array(
                'label'               => 'Test Ability',
                'description'         => 'An ability used in tests.',
                'category'            => $category,
                'execute_callback'    => static fn() => 'ok',
                'permission_callback' => static fn() => true,
                'input_schema'        => array(
                    'type'       => 'object',
                    'properties' => array( 'text' => array( 'type' => 'string' ) ),
                ),
                'meta'                => array(
                    'icon'             => '🧪',
                    'thinking_message' => 'Thinking…',
                    'success_message'  => 'Done.',
                    'show_in_rest'     => true,
                ),
            ),
            $overrides
        );

        return new Ability( $name, $args );
    }

    public function test_ability_extends_core_wp_ability(): void
    {
        $this->assertTrue( class_exists( '\WP_Ability' ), 'WordPress core must provide WP_Ability.' );

        // The class under test must resolve to core's WP_Ability — i.e. somewhere
        // under the booted WordPress install — and NOT to a plugin-vendored copy.
        $reflection = new ReflectionClass( '\WP_Ability' );
        $file       = $reflection->getFileName();

        $this->assertStringNotContainsString(
            'vendor/wordpress/abilities-api',
            $file,
            'WP_Ability must resolve to WordPress core, not a vendored Abilities API package.'
        );
        $this->assertStringStartsWith(
            ABSPATH,
            $file,
            'WP_Ability must be loaded from the booted WordPress core install.'
        );

        $this->assertInstanceOf( '\WP_Ability', $this->make_ability( 'vip-workflow/sample' ) );
    }

    public function test_real_wp_ability_exposes_constructor_properties(): void
    {
        $ability = $this->make_ability( 'vip-workflow/summarize', 'research' );

        $this->assertSame( 'vip-workflow/summarize', $ability->get_name() );
        $this->assertSame( 'Test Ability', $ability->get_label() );
        $this->assertSame( 'An ability used in tests.', $ability->get_description() );
        $this->assertSame( 'research', $ability->get_category() );
        $this->assertSame( 'string', $ability->get_input_schema()['properties']['text']['type'] );

        // VIP extensions live in meta, read back via the subclass accessors.
        $this->assertSame( '🧪', $ability->get_icon() );
        $this->assertSame( 'Thinking…', $ability->get_thinking_message() );
        $this->assertSame( 'Done.', $ability->get_success_message() );
        $this->assertTrue( $ability->get_meta()['show_in_rest'] );
    }

    public function test_real_wp_ability_validation_rejects_missing_required_property(): void
    {
        $this->expectException( \InvalidArgumentException::class );

        // Omit the required label. Core's prepare_properties() validates label/
        // description/category for every ability (no subclass carve-out), so this
        // is a property that genuinely exercises validation on our subclass.
        $this->make_ability( 'vip-workflow/broken', 'research', array( 'label' => null ) );
    }

    public function test_subclass_is_exempt_from_execute_callback_validation(): void
    {
        // Core validates execute_callback/permission_callback only when the
        // instance is exactly WP_Ability (`get_class( $this ) === self::class`).
        // The plugin registers via `ability_class => Ability::class`, so the
        // subclass is intentionally exempt: constructing one without an
        // execute_callback must NOT throw. This pins core's real contract — the
        // previous unit test asserted the opposite against a vendored RC, which
        // is exactly the drift this suite now guards against.
        $ability = $this->make_ability( 'vip-workflow/no-exec', 'research', array( 'execute_callback' => null ) );

        $this->assertInstanceOf( Ability::class, $ability );
    }

    public function test_register_and_retrieve_ability(): void
    {
        $registry = AbilityRegistry::get_instance();
        $ability  = $this->make_ability( 'vip-workflow/alpha' );

        $registry->register_ability( $ability );

        $this->assertTrue( $registry->has( 'vip-workflow/alpha' ) );
        $this->assertSame( $ability, $registry->get( 'vip-workflow/alpha' ) );
        $this->assertNull( $registry->get( 'vip-workflow/missing' ) );
        $this->assertCount( 1, $registry->get_all() );
    }

    public function test_duplicate_registration_throws(): void
    {
        $registry = AbilityRegistry::get_instance();
        $registry->register_ability( $this->make_ability( 'vip-workflow/dup' ) );

        $this->expectException( \InvalidArgumentException::class );
        $registry->register_ability( $this->make_ability( 'vip-workflow/dup' ) );
    }

    public function test_get_by_category_filters_on_real_ability_category(): void
    {
        $registry = AbilityRegistry::get_instance();
        $registry->register_ability( $this->make_ability( 'vip-workflow/research-1', 'research' ) );
        $registry->register_ability( $this->make_ability( 'vip-workflow/research-2', 'research' ) );
        $registry->register_ability( $this->make_ability( 'vip-workflow/editing-1', 'editing' ) );

        $research = $registry->get_by_category( 'research' );
        $editing  = $registry->get_by_category( 'editing' );

        $this->assertCount( 2, $research );
        $this->assertCount( 1, $editing );
        $this->assertArrayHasKey( 'vip-workflow/research-1', $research );
        $this->assertArrayNotHasKey( 'vip-workflow/editing-1', $research );
    }

    public function test_unregister_and_clear(): void
    {
        $registry = AbilityRegistry::get_instance();
        $registry->register_ability( $this->make_ability( 'vip-workflow/temp' ) );

        $this->assertTrue( $registry->unregister( 'vip-workflow/temp' ) );
        $this->assertFalse( $registry->unregister( 'vip-workflow/temp' ) );
        $this->assertFalse( $registry->has( 'vip-workflow/temp' ) );

        $registry->register_ability( $this->make_ability( 'vip-workflow/again' ) );
        $registry->clear();
        $this->assertCount( 0, $registry->get_all() );
    }
}
