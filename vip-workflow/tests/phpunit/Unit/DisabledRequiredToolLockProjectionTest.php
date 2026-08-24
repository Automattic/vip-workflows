<?php
/**
 * Disabled required tools must be projected before a move is attempted.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\Sequences\Sequence;

/**
 * @covers \VIPWorkflow\Sequences\Sequence::get_role_permitted_transitions
 */
class DisabledRequiredToolLockProjectionTest extends TestCase
{
    /**
     * Build a sequence whose only move requires one tool.
     */
    private function sequence(): Sequence
    {
        $row = (object) array(
            'id'          => 1,
            'uuid'        => 'test-uuid-1234',
            'type'        => Sequence::TYPE_WORKFLOW,
            'name'        => 'Test Sequence',
            'slug'        => 'test-sequence',
            'description' => '',
            'version'     => 1,
            'status'      => 'active',
            'config'      => wp_json_encode(
                array(
                    'post_types' => array( 'post' ),
                    'statuses'   => array(
                        array(
                            'key'          => 'draft',
                            'label'        => 'Draft',
                            'status'       => 'draft',
                            'region_entry' => true,
                            'transitions'  => array(
                                array(
                                    'to'             => 'review',
                                    'label'          => 'Submit',
                                    'required_tools' => array( 'test/required-check' ),
                                ),
                            ),
                        ),
                        array(
                            'key'          => 'review',
                            'label'        => 'Review',
                            'status'       => 'pending',
                            'region_entry' => true,
                            'transitions'  => array(),
                        ),
                    ),
                )
            ),
            'created_by'  => 1,
            'created_at'  => '2026-01-01 00:00:00',
            'updated_at'  => '2026-01-01 00:00:00',
        );

        return Sequence::from_row( $row );
    }

    /**
     * Configure one editor and the saved tool state.
     *
     * @param bool  $enabled          Whether the required tool is enabled.
     * @param array $tool_bypass_roles Roles allowed to bypass tool checks.
     */
    private function stub_settings( bool $enabled, array $tool_bypass_roles = array( 'administrator' ) ): void
    {
        Functions\when( 'get_current_user_id' )->justReturn( 5 );
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'roles' => array( 'editor' ) ) );
        Functions\when( 'wp_sprintf' )->alias(
            static fn( string $pattern, $values ) => '%l' === $pattern ? implode( ', ', (array) $values ) : sprintf( $pattern, $values )
        );
        Functions\when( 'get_option' )->alias(
            static function ( string $option, $default = false ) use ( $enabled, $tool_bypass_roles ) {
                if ( 'vip_workflow_ability_settings' === $option ) {
                    return array(
                        'test/required-check' => array( 'enabled' => $enabled ),
                    );
                }

                if ( 'vip_workflow_settings' === $option ) {
                    return array(
                        'bypass_workflow_roles'   => array( 'administrator' ),
                        'bypass_tool_check_roles' => $tool_bypass_roles,
                    );
                }

                return $default;
            }
        );
    }

    public function test_disabled_required_tool_locks_the_transition_with_a_reason(): void
    {
        $this->stub_settings( false );

        $transitions = $this->sequence()->get_role_permitted_transitions( 'draft', 5 );

        $this->assertCount( 1, $transitions );
        $this->assertTrue( $transitions[0]['_locked'] );
        $this->assertStringContainsString( 'test/required-check', $transitions[0]['_locked_reason'] );
    }

    public function test_enabled_required_tool_does_not_lock_the_transition(): void
    {
        $this->stub_settings( true );

        $transitions = $this->sequence()->get_role_permitted_transitions( 'draft', 5 );

        $this->assertArrayNotHasKey( '_locked', $transitions[0] );
    }

    public function test_tool_check_bypass_role_does_not_receive_the_lock(): void
    {
        $this->stub_settings( false, array( 'editor' ) );

        $transitions = $this->sequence()->get_role_permitted_transitions( 'draft', 5 );

        $this->assertArrayNotHasKey( '_locked', $transitions[0] );
    }
}
