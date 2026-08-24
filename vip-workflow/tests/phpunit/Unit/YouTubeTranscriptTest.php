<?php
/**
 * YouTubeTranscript unit tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\Integrations\YouTubeTranscript;
use WP_Error;

/**
 * Tests for YouTube transcript fetching hardening.
 */
class YouTubeTranscriptTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Functions\stubs(
            array(
                'wp_parse_url'                            => function ( $url, $component = -1 ) {
                    return -1 === $component ? parse_url( $url ) : parse_url( $url, $component );
                },
                'VIPWorkflow\Integrations\dns_get_record' => function ( $host, $type ) {
                    unset( $host );

                    if ( DNS_A === $type ) {
                        return array( array( 'ip' => '8.8.8.8' ) );
                    }

                    return array();
                },
                'VIPWorkflow\Integrations\gethostbynamel' => fn() => array( '8.8.8.8' ),
            )
        );
    }

    public function test_fetch_rejects_non_youtube_caption_url_without_fetching_caption(): void
    {
        $caption_fetch_called = false;

        Functions\stubs(
            array(
                'is_wp_error'               => fn( $thing ) => $thing instanceof WP_Error,
                'wp_remote_retrieve_body'   => fn( $response ) => $response['body'] ?? '',
                'wp_remote_retrieve_response_code' => fn( $response ) => $response['response']['code'] ?? 0,
                'wp_safe_remote_post'       => fn() => array(
                    'response' => array( 'code' => 200 ),
                    'body'     => wp_json_encode(
                        array(
                            'captions' => array(
                                'playerCaptionsTracklistRenderer' => array(
                                    'captionTracks' => array(
                                        array(
                                            'baseUrl'      => 'https://evil.example.com/captions',
                                            'languageCode' => 'en',
                                        ),
                                    ),
                                ),
                            ),
                        )
                    ),
                ),
                'wp_safe_remote_get'        => function () use ( &$caption_fetch_called ) {
                    $caption_fetch_called = true;
                    return array( 'response' => array( 'code' => 200 ), 'body' => '{}' );
                },
            )
        );

		$result = YouTubeTranscript::fetch( 'dQw4w9WgXcQ' );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'transcript_fetch_failed', $result->get_error_code() );
		$this->assertFalse( $caption_fetch_called, 'caption fetch must not run for a non-YouTube caption URL.' );
	}
}
