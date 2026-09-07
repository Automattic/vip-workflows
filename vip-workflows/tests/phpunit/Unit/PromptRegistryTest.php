<?php
/**
 * PromptRegistry unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\AI\PromptRegistry;
use VIPWorkflows\AI\PromptSettings;

class PromptRegistryTest extends TestCase
{
    private array $stored = array();

    protected function setUp(): void
    {
        parent::setUp();

        $this->stored = array();

        Functions\when( 'get_option' )->alias(
            function ( string $option, $default = false ) {
                return 'vip_workflows_prompts' === $option ? $this->stored : $default;
            }
        );
        Functions\when( 'update_option' )->alias(
            function ( string $option, $value ) {
                if ( 'vip_workflows_prompts' === $option ) {
                    $this->stored = $value;
                }
                return true;
            }
        );
        Functions\when( '_doing_it_wrong' )->justReturn( null );

        PromptRegistry::get_instance()->reset();
        PromptSettings::get_instance()->clear_cache();
    }

    private function register_sample(): PromptRegistry
    {
        $registry = PromptRegistry::get_instance();
        $registry->register(
            'sample/greeting',
            array(
                'label'     => 'Sample greeting',
                'group'     => 'Samples',
                'default'   => 'Hello {name}, welcome to {place}.',
                'variables' => array( 'name', 'place' ),
            )
        );
        return $registry;
    }

    public function test_get_returns_default_with_variables_substituted(): void
    {
        $registry = $this->register_sample();
        $result   = $registry->get( 'sample/greeting', array( 'name' => 'Ada', 'place' => 'VIP' ) );
        $this->assertSame( 'Hello Ada, welcome to VIP.', $result );
    }

    public function test_override_takes_precedence_over_default(): void
    {
        $registry = $this->register_sample();
        PromptSettings::get_instance()->set_override( 'sample/greeting', 'Hi {name}!' );

        $this->assertSame( 'Hi Ada!', $registry->get( 'sample/greeting', array( 'name' => 'Ada' ) ) );
    }

    public function test_missing_variable_left_intact(): void
    {
        $registry = $this->register_sample();
        $this->assertSame(
            'Hello Ada, welcome to {place}.',
            $registry->get( 'sample/greeting', array( 'name' => 'Ada' ) )
        );
    }

    public function test_unknown_prompt_errors_and_returns_empty_string(): void
    {
        // _doing_it_wrong is stubbed in setUp; the contract is that an
        // unregistered id resolves to an empty string, never an inline literal.
        $this->assertSame( '', PromptRegistry::get_instance()->get( 'does/not-exist' ) );
    }

    public function test_duplicate_registration_is_rejected(): void
    {
        $registry = $this->register_sample();
        $this->assertFalse(
            $registry->register( 'sample/greeting', array( 'label' => 'Dup', 'default' => 'x' ) )
        );
    }

    public function test_missing_required_key_is_rejected(): void
    {
        $registry = PromptRegistry::get_instance();
        $this->assertFalse( $registry->register( 'no/default', array( 'label' => 'No default' ) ) );
        $this->assertFalse( $registry->register( 'no/label', array( 'default' => 'text' ) ) );
        $this->assertFalse( $registry->has( 'no/default' ) );
    }

    public function test_invalid_id_format_is_rejected(): void
    {
        $registry = PromptRegistry::get_instance();
        // Ids must match the REST route pattern [a-z0-9_/-]; anything else would
        // register but be un-saveable via the API.
        foreach ( array( 'Has/Uppercase', 'has spaces', 'has:colon', 'has?query', 'has#hash' ) as $bad_id ) {
            $this->assertFalse(
                $registry->register( $bad_id, array( 'label' => 'Bad', 'default' => 'x' ) ),
                "Expected id '{$bad_id}' to be rejected"
            );
            $this->assertFalse( $registry->has( $bad_id ) );
        }

        // A canonical id with slashes/hyphens/underscores is still accepted.
        $this->assertTrue(
            $registry->register( 'group_a/sub-prompt', array( 'label' => 'OK', 'default' => 'x' ) )
        );
    }

    public function test_has_and_get_definition(): void
    {
        $registry = $this->register_sample();
        $this->assertTrue( $registry->has( 'sample/greeting' ) );

        $def = $registry->get_definition( 'sample/greeting' );
        $this->assertSame( 'Sample greeting', $def['label'] );
        $this->assertSame( 'Samples', $def['group'] );
        $this->assertSame( array( 'name', 'place' ), $def['variables'] );
    }

    public function test_get_all_returns_registered_prompts(): void
    {
        $this->register_sample();
        $all = PromptRegistry::get_instance()->get_all();
        $this->assertArrayHasKey( 'sample/greeting', $all );
    }

    public function test_extensions_can_register_via_action(): void
    {
        // The registration hook fires on first access; simulate an extension by
        // registering inside the action, then resolving.
        Functions\when( 'do_action' )->alias(
            function ( string $hook, ...$args ): void {
                if ( 'vip_workflows_register_prompts' === $hook && isset( $args[0] ) ) {
                    $args[0]->register(
                        'ext/custom',
                        array( 'label' => 'Ext', 'default' => 'From extension.' )
                    );
                }
            }
        );

        $this->assertSame( 'From extension.', PromptRegistry::get_instance()->get( 'ext/custom' ) );
    }
}
