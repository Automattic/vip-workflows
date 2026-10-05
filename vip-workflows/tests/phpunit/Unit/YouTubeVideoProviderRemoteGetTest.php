<?php
/**
 * Tests for the YouTube provider's remote GET routing.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Ideation\Assistants\YouTubeVideoProvider;

/**
 * Covers the VIP and fallback branches of YouTubeVideoProvider::remote_get(),
 * driven through the public search_media().
 *
 * Each test runs in its own process: the API key constant and the
 * vip_safe_wp_remote_get() definition must not leak into other tests.
 */
class YouTubeVideoProviderRemoteGetTest extends TestCase
{
    private const URL = 'https://example.test/search?q=bikes';

    protected function set_up()
    {
        parent::set_up();

        if ( ! defined( 'VIP_WORKFLOWS_YOUTUBE_KEY' ) ) {
            define( 'VIP_WORKFLOWS_YOUTUBE_KEY', 'test-key' );
        }
        Functions\when( 'add_query_arg' )->justReturn( self::URL );
    }

    /**
     * On VIP the request goes through vip_safe_wp_remote_get() with the cap args.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_uses_vip_safe_wp_remote_get_when_available(): void
    {
        $error = new \WP_Error( 'throttled', 'Throttled' );

        Functions\expect( 'vip_safe_wp_remote_get' )
            ->once()
            ->with( self::URL, '', 3, 5, 20 )
            ->andReturn( $error );
        Functions\expect( 'wp_remote_get' )->never();

        $this->assertSame( $error, ( new YouTubeVideoProvider() )->search_media( 'bikes' ) );
    }

    /**
     * Off VIP the request falls back to wp_remote_get() with a 5s timeout.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_falls_back_to_wp_remote_get_with_five_second_timeout(): void
    {
        $error = new \WP_Error( 'failed', 'Failed' );

        Functions\expect( 'wp_remote_get' )
            ->once()
            ->with( self::URL, array( 'timeout' => 5 ) )
            ->andReturn( $error );

        $this->assertFalse( function_exists( 'vip_safe_wp_remote_get' ) );
        $this->assertSame( $error, ( new YouTubeVideoProvider() )->search_media( 'bikes' ) );
    }
}
