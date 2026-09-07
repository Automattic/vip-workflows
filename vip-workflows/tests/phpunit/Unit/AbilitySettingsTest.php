<?php
/**
 * AbilitySettings unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Abilities\AbilitySettings;

class AbilitySettingsTest extends TestCase
{
    private array $stored_settings = array();

    protected function setUp(): void
    {
        parent::setUp();

        $this->stored_settings = array(
            'test/ability' => array(
                'enabled'             => true,
                'options'             => array(),
                'check_modes'         => array(),
                'show_in_commands'    => true,
                'transition_eligible' => true,
            ),
        );

        Functions\when( 'get_option' )->alias(
            function ( string $option, $default = false ) {
                return 'vip_workflows_ability_settings' === $option
                    ? $this->stored_settings
                    : $default;
            }
        );

        Functions\when( 'update_option' )->alias(
            function ( string $option, $value ) {
                if ( 'vip_workflows_ability_settings' === $option ) {
                    $this->stored_settings = $value;
                }

                return true;
            }
        );

        AbilitySettings::get_instance()->clear_cache();
    }

    public function test_update_persists_false_for_toggle_settings(): void
    {
        $settings = AbilitySettings::get_instance();

        $result = $settings->update(
            'test/ability',
            array(
                'show_in_commands'    => false,
                'transition_eligible' => false,
            )
        );

        $this->assertTrue( $result );
        $this->assertFalse( $this->stored_settings['test/ability']['show_in_commands'] );
        $this->assertFalse( $this->stored_settings['test/ability']['transition_eligible'] );
    }

    public function test_update_bulk_persists_false_for_toggle_settings(): void
    {
        $settings = AbilitySettings::get_instance();

        $result = $settings->update_bulk(
            array(
                'test/ability' => array(
                    'show_in_commands'    => false,
                    'transition_eligible' => false,
                ),
            )
        );

        $this->assertTrue( $result );
        $this->assertFalse( $this->stored_settings['test/ability']['show_in_commands'] );
        $this->assertFalse( $this->stored_settings['test/ability']['transition_eligible'] );
    }

    public function test_show_in_commands_uses_meta_default_when_not_saved(): void
    {
        $settings = AbilitySettings::get_instance();

        // No saved setting for 'unsaved/ability' — should use meta_default.
        $this->assertFalse( $settings->show_in_commands( 'unsaved/ability' ) );
        $this->assertTrue( $settings->show_in_commands( 'unsaved/ability', true ) );
    }

    public function test_show_in_commands_saved_false_overrides_meta_default_true(): void
    {
        $settings = AbilitySettings::get_instance();

        // Explicitly save false; meta default is true — saved value must win.
        $settings->update( 'test/ability', array( 'show_in_commands' => false ) );
        $settings->clear_cache();

        $this->assertFalse( $settings->show_in_commands( 'test/ability', true ) );
    }

    public function test_show_in_commands_saved_true_overrides_meta_default_false(): void
    {
        $settings = AbilitySettings::get_instance();

        // 'test/ability' is stored with show_in_commands=true; meta default is false — saved value must win.
        $this->assertTrue( $settings->show_in_commands( 'test/ability', false ) );
    }
}
