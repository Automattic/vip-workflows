<?php
/**
 * PromptSettings unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\AI\PromptSettings;

class PromptSettingsTest extends TestCase
{
    private array $stored = array();

    /**
     * Recorded update_option() calls: each entry is [option, value, autoload].
     *
     * @var array<int, array{0:string,1:mixed,2:mixed}>
     */
    private array $update_calls = array();

    /**
     * Return value the stubbed update_option() should produce.
     */
    private bool $update_result = true;

    protected function setUp(): void
    {
        parent::setUp();

        $this->stored        = array();
        $this->update_calls  = array();
        $this->update_result = true;

        Functions\when( 'get_option' )->alias(
            function ( string $option, $default = false ) {
                return 'vip_workflows_prompts' === $option ? $this->stored : $default;
            }
        );
        Functions\when( 'update_option' )->alias(
            function ( string $option, $value, $autoload = null ) {
                $this->update_calls[] = array( $option, $value, $autoload );
                if ( 'vip_workflows_prompts' === $option && $this->update_result ) {
                    $this->stored = $value;
                }
                return $this->update_result;
            }
        );

        PromptSettings::get_instance()->clear_cache();
    }

    public function test_get_override_returns_null_when_unset(): void
    {
        $this->assertNull( PromptSettings::get_instance()->get_override( 'a/b' ) );
    }

    public function test_set_then_get_override(): void
    {
        $settings = PromptSettings::get_instance();
        $this->assertTrue( $settings->set_override( 'a/b', 'Custom prompt' ) );
        $this->assertSame( 'Custom prompt', $settings->get_override( 'a/b' ) );
        $this->assertSame( array( 'a/b' => 'Custom prompt' ), $this->stored );
    }

    public function test_empty_or_whitespace_value_clears_override(): void
    {
        $settings = PromptSettings::get_instance();
        $settings->set_override( 'a/b', 'Custom' );
        $settings->set_override( 'a/b', '   ' );
        $this->assertNull( $settings->get_override( 'a/b' ) );
        $this->assertArrayNotHasKey( 'a/b', $this->stored );
    }

    public function test_delete_override_removes_key(): void
    {
        $settings = PromptSettings::get_instance();
        $settings->set_override( 'a/b', 'Custom' );
        $this->assertTrue( $settings->delete_override( 'a/b' ) );
        $this->assertNull( $settings->get_override( 'a/b' ) );
        $this->assertSame( array(), $this->stored );
    }

    public function test_delete_missing_override_is_noop_success(): void
    {
        $this->assertTrue( PromptSettings::get_instance()->delete_override( 'never/set' ) );
    }

    public function test_corrupted_option_fires_hook_and_falls_back_to_empty(): void
    {
        Functions\when( 'get_option' )->justReturn( 'corrupt' );

        $fired = array();
        Functions\when( 'do_action' )->alias(
            function ( string $hook, ...$args ) use ( &$fired ) {
                $fired[] = $hook;
            }
        );

        PromptSettings::get_instance()->clear_cache();

        // App stays usable: corruption is surfaced (hook) but resolves to an
        // empty override set rather than fataling.
        $this->assertSame( array(), PromptSettings::get_instance()->get_all() );
        $this->assertContains( 'vip_workflows_prompts_option_corrupted', $fired );
    }

    public function test_set_override_returns_false_when_persist_fails(): void
    {
        $this->update_result = false;

        $settings = PromptSettings::get_instance();
        $this->assertFalse( $settings->set_override( 'a/b', 'Custom' ) );

        // Cache must not advertise a value that was never written.
        $settings->clear_cache();
        $this->assertNull( $settings->get_override( 'a/b' ) );
    }

    public function test_set_override_unchanged_value_is_noop_success(): void
    {
        $settings = PromptSettings::get_instance();
        $this->assertTrue( $settings->set_override( 'a/b', 'Same' ) );
        $writes_after_first = count( $this->update_calls );

        // Setting the identical value again should not write again.
        $this->assertTrue( $settings->set_override( 'a/b', 'Same' ) );
        $this->assertCount( $writes_after_first, $this->update_calls );
    }

    public function test_overrides_are_persisted_with_autoload_disabled(): void
    {
        PromptSettings::get_instance()->set_override( 'a/b', 'Custom' );

        $this->assertNotEmpty( $this->update_calls );
        $last = end( $this->update_calls );
        $this->assertSame( 'vip_workflows_prompts', $last[0] );
        $this->assertFalse( $last[2], 'Expected autoload disabled (false) on the option write.' );
    }
}
