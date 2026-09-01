<?php
/**
 * Unit tests for agent attribution in the audit trail (Agent stage verification).
 *
 * Covers Actor::name_for(), the single agent-aware helper the
 * audit read surfaces share. Agent-driven transitions are credited to the acting
 * ability, not the human the runner impersonated for the write.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Workflow\Actor;

/**
 * Tests for Actor::name_for().
 */
class AgentAuditAttributionTest extends TestCase
{
    /**
     * A human transition resolves to the user's display name.
     */
    public function test_human_actor_resolves_to_display_name(): void
    {
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'display_name' => 'Ada Lovelace' ) );

        $name = Actor::name_for(
            array(
                'actor_id'   => 7,
                'actor_type' => 'user',
            )
        );

        $this->assertSame( 'Ada Lovelace', $name );
    }

    /**
     * A human transition with an unknown user falls back to "System".
     */
    public function test_unknown_human_actor_falls_back_to_system(): void
    {
        Functions\when( 'get_userdata' )->justReturn( false );

        $name = Actor::name_for(
            array(
                'actor_id'   => 999,
                'actor_type' => 'user',
            )
        );

        $this->assertSame( 'System', $name );
    }

    /**
     * An entry with no actor_type is treated as a human transition (back-compat
     * for rows written before agent attribution existed).
     */
    public function test_missing_actor_type_defaults_to_user(): void
    {
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'display_name' => 'Grace Hopper' ) );

        $name = Actor::name_for( array( 'actor_id' => 3 ) );

        $this->assertSame( 'Grace Hopper', $name );
    }

    /**
     * An agent transition resolves to the acting ability's label, not the
     * impersonated human — even when a valid actor_id is present.
     */
    public function test_agent_actor_resolves_to_ability_label(): void
    {
        // The runner impersonated a human, so get_userdata would return one —
        // name_for must ignore it for agent entries.
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'display_name' => 'Impersonated Human' ) );

        $ability = \Mockery::mock();
        $ability->shouldReceive( 'get_label' )->andReturn( 'Fact Check Agent' );
        Functions\when( 'wp_get_ability' )->justReturn( $ability );

        $name = Actor::name_for(
            array(
                'actor_id'    => 7,
                'actor_type'  => 'agent',
                'agent_actor' => 'vip-workflows/fact-check',
            )
        );

        $this->assertSame( 'Fact Check Agent', $name );
    }

    /**
     * When the ability id no longer resolves, fall back to the raw id so the
     * trail still names the agent rather than a human.
     */
    public function test_agent_actor_falls_back_to_ability_id(): void
    {
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'display_name' => 'Impersonated Human' ) );
        Functions\when( 'wp_get_ability' )->justReturn( null );

        $name = Actor::name_for(
            array(
                'actor_id'    => 7,
                'actor_type'  => 'agent',
                'agent_actor' => 'vip-workflows/fact-check',
            )
        );

        $this->assertSame( 'vip-workflows/fact-check', $name );
    }

    /**
     * An agent entry with no recorded ability id gets a generic label rather
     * than mis-crediting the impersonated human.
     */
    public function test_agent_actor_without_id_uses_generic_label(): void
    {
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'display_name' => 'Impersonated Human' ) );

        $name = Actor::name_for(
            array(
                'actor_id'    => 7,
                'actor_type'  => 'agent',
                'agent_actor' => '',
            )
        );

        $this->assertSame( 'Agent', $name );
    }
}
