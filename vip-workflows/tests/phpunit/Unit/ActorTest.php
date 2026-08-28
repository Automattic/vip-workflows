<?php
/**
 * Unit tests for the shared actor description.
 *
 * Ten shapes used to describe a person across the REST layer. These pin the one
 * that replaced them — above all its two load-bearing decisions: that an
 * unresolvable user is `null` rather than an invented placeholder, and that an
 * agent is credited to the ability rather than to the human it impersonated.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Workflow\Actor;

/**
 * Tests for Actor::from_user() and Actor::from_event().
 */
class ActorTest extends TestCase
{
    /**
     * Actor memoizes per request, so each case starts from nothing — otherwise
     * a test would read the user the previous one stubbed.
     */
    protected function setUp(): void
    {
        parent::setUp();
        Actor::flush();
    }

    /**
     * Stub a resolvable user with an avatar.
     */
    private function stub_user( string $name = 'Ada Lovelace' ): void
    {
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'display_name' => $name ) );
        Functions\when( 'get_avatar_url' )->justReturn( 'https://example.test/a.png' );
    }

    /**
     * A person comes back fully described, and in the one shape.
     */
    public function test_person_is_described_in_the_shared_shape(): void
    {
        $this->stub_user();

        $this->assertSame(
            array(
                'id'           => 7,
                'type'         => 'user',
                'display_name' => 'Ada Lovelace',
                'agent_actor'  => null,
                'avatar'       => 'https://example.test/a.png',
            ),
            Actor::from_user( 7 )
        );
    }

    /**
     * Post meta hands ids back as strings, so the id must survive as an int —
     * the client compares it against the current user id.
     */
    public function test_string_id_from_post_meta_is_normalised(): void
    {
        $this->stub_user();

        $this->assertSame( 7, Actor::from_user( '7' )['id'] );
    }

    /**
     * No user, no actor. The view names the absence, not the server: this is
     * what stopped the eight different spellings of "nobody".
     */
    public function test_unresolvable_user_is_null(): void
    {
        Functions\when( 'get_userdata' )->justReturn( false );

        $this->assertNull( Actor::from_user( 999 ) );
    }

    /**
     * An absent id never reaches get_userdata() — an unassigned post has no
     * assignee, which is not the same as a lookup that failed.
     */
    public function test_empty_id_is_null(): void
    {
        $this->assertNull( Actor::from_user( 0 ) );
        $this->assertNull( Actor::from_user( '' ) );
        $this->assertNull( Actor::from_user( null ) );
    }

    /**
     * An agent is credited to the ability, carries its id, and has no picture.
     */
    public function test_agent_is_credited_to_the_ability(): void
    {
        Functions\when( 'wp_get_ability' )->justReturn(
            new class() {
                /**
                 * The registered ability's human-readable label.
                 *
                 * @return string
                 */
                public function get_label(): string
                {
                    return 'Fact Check Agent';
                }
            }
        );

        $actor = Actor::from_event(
            array(
                'actor_id'   => 7,
                'actor_type' => 'agent',
                'event_data' => array( 'agent_actor' => 'vip-workflows/fact-check' ),
            )
        );

        $this->assertSame( 'agent', $actor['type'] );
        $this->assertSame( 'Fact Check Agent', $actor['display_name'] );
        $this->assertSame( 'vip-workflows/fact-check', $actor['agent_actor'] );
        $this->assertNull( $actor['avatar'] );
    }

    /**
     * The runner impersonates a capable human for the write, so an agent event
     * must NOT be credited to whoever `actor_id` names.
     */
    public function test_agent_event_is_not_credited_to_the_impersonated_user(): void
    {
        $this->stub_user( 'Ada Lovelace' );
        Functions\when( 'wp_get_ability' )->justReturn( null );

        $actor = Actor::from_event(
            array(
                'actor_id'   => 7,
                'actor_type' => 'agent',
                'event_data' => array( 'agent_actor' => 'vip-workflows/fact-check' ),
            )
        );

        $this->assertNotSame( 'Ada Lovelace', $actor['display_name'] );
        // No registered ability object, so the id itself is the honest name.
        $this->assertSame( 'vip-workflows/fact-check', $actor['display_name'] );
    }

    /**
     * A plain user event goes down the same path as any other person, so the
     * two entry points cannot describe one person two ways.
     */
    public function test_user_event_matches_from_user(): void
    {
        $this->stub_user();

        $this->assertSame(
            Actor::from_user( 7 ),
            Actor::from_event(
                array(
                    'actor_id'   => 7,
                    'actor_type' => 'user',
                    'event_data' => array(),
                )
            )
        );
    }

    /**
     * A list describes the same author once, not once per row.
     *
     * `get_avatar_url()` runs the avatar filters on every call, so a calendar
     * of 500 posts by twenty writers used to pay 500 lookups on an install with
     * a local-avatars plugin hooked there.
     */
    public function test_a_person_is_described_once_per_request(): void
    {
        $calls = 0;
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'display_name' => 'Ada Lovelace' ) );
        Functions\when( 'get_avatar_url' )->alias(
            function () use ( &$calls ) {
                $calls++;
                return 'https://example.test/a.png';
            }
        );

        $first = Actor::from_user( 7 );
        $again = Actor::from_user( 7 );

        $this->assertSame( 1, $calls, 'the avatar was resolved more than once for one person' );
        $this->assertSame( $first, $again );

        // A second person is still their own lookup.
        Actor::from_user( 8 );
        $this->assertSame( 2, $calls );
    }

    /**
     * A missing user is remembered as missing, so a post whose author is gone
     * does not re-miss on every row it appears in.
     */
    public function test_an_absent_person_is_remembered_too(): void
    {
        $calls = 0;
        Functions\when( 'get_userdata' )->alias(
            function () use ( &$calls ) {
                $calls++;
                return false;
            }
        );

        $this->assertNull( Actor::from_user( 999 ) );
        $this->assertNull( Actor::from_user( 999 ) );
        $this->assertSame( 1, $calls );
    }

    /**
     * An event whose user no longer exists — a deleted account, a cron run — is
     * nobody, and the activity views read that as the site itself.
     */
    public function test_event_with_no_resolvable_user_is_null(): void
    {
        Functions\when( 'get_userdata' )->justReturn( false );

        $this->assertNull(
            Actor::from_event(
                array(
                    'actor_id'   => 0,
                    'actor_type' => 'user',
                    'event_data' => array(),
                )
            )
        );
    }
}
