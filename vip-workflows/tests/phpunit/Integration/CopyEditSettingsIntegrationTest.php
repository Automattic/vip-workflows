<?php
/**
 * The copy-edit agent's stored stage settings against core's input validation.
 *
 * Stage settings are stored exactly as given and arrive as ability input, which
 * core validates against `input_schema` before the agent runs. A value the
 * schema rejects would route every run as `error`, so the schema deliberately
 * carries no range and the agent clamps instead. This checks that contract
 * against the registered ability and core's own validator.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

class CopyEditSettingsIntegrationTest extends TestCase
{
    private const ABILITY_ID = 'workflow-agent-copy-edit/copy-edit';

    /**
     * The registered ability's input schema.
     *
     * `vip_workflows_register_ability()` only works while `wp_abilities_api_init`
     * runs, so the hook is fired again with other listeners detached;
     * WP_UnitTestCase restores `$wp_filter` afterwards.
     *
     * @return array
     */
    private function input_schema(): array
    {
        require_once dirname( __DIR__, 4 ) . '/workflow-agent-copy-edit/workflow-agent-copy-edit.php';

        if ( ! wp_has_ability( self::ABILITY_ID ) ) {
            remove_all_actions( 'wp_abilities_api_init' );
            add_action( 'wp_abilities_api_init', 'WorkflowAgentCopyEdit\register' );
            do_action( 'wp_abilities_api_init' );
        }

        $ability = wp_get_ability( self::ABILITY_ID );
        $this->assertNotNull( $ability, 'The copy-edit agent registers.' );

        return $ability->get_input_schema();
    }

    /**
     * @dataProvider stored_settings
     *
     * @param array $settings Stage agent settings as stored.
     * @param int   $expected What the agent applies.
     */
    public function test_stored_settings_pass_input_validation_and_are_clamped( array $settings, int $expected ): void
    {
        $input = array( 'post_id' => 1 ) + $settings;

        $this->assertTrue(
            rest_validate_value_from_schema( $input, $this->input_schema(), 'input' ),
            'A stored value must never fail validation, or every run would route as error.'
        );
        $this->assertSame( $expected, \WorkflowAgentCopyEdit\max_change_percent( $input ) );
    }

    /**
     * @return array<string, array{array, int}>
     */
    public static function stored_settings(): array
    {
        return array(
            'absent'            => array( array(), 15 ),
            'above the ceiling' => array( array( 'max_change_percent' => 90 ), 50 ),
            'inside the range'  => array( array( 'max_change_percent' => 25 ), 25 ),
            'zero'              => array( array( 'max_change_percent' => 0 ), 1 ),
        );
    }

    public function test_stored_paragraph_settings_pass_input_validation_and_are_clamped(): void
    {
        $input = array(
            'post_id'                      => 1,
            'max_paragraph_change_percent' => 100,
            'min_paragraph_words'          => 500,
        );

        $this->assertTrue( rest_validate_value_from_schema( $input, $this->input_schema(), 'input' ) );
        $this->assertSame( 75, \WorkflowAgentCopyEdit\paragraph_change_percent( $input ) );
        $this->assertSame( 20, \WorkflowAgentCopyEdit\min_paragraph_words( $input ) );
        $this->assertSame( 50, \WorkflowAgentCopyEdit\paragraph_change_percent( array( 'post_id' => 1 ) ) );
        $this->assertSame( 8, \WorkflowAgentCopyEdit\min_paragraph_words( array( 'post_id' => 1 ) ) );
    }

    public function test_a_non_integer_setting_is_rejected_by_the_schema(): void
    {
        $this->assertWPError(
            rest_validate_value_from_schema(
                array(
                    'post_id'            => 1,
                    'max_change_percent' => 'lots',
                ),
                $this->input_schema(),
                'input'
            )
        );
    }

    public function test_every_settings_key_is_also_an_input_key(): void
    {
        $schema   = $this->input_schema();
        $settings = wp_get_ability( self::ABILITY_ID )->get_meta()['settings_schema'];

        foreach ( array_keys( $settings ) as $key ) {
            $this->assertArrayHasKey( $key, $schema['properties'], "Setting $key must be declared in input_schema." );
        }
    }
}
