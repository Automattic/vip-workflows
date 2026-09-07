<?php
/**
 * Tests for UrlMetaExtractor.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Integrations\UrlMetaExtractor;
use WP_Error;

/**
 * @group url-meta-extractor
 */
class UrlMetaExtractorTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Functions\stubs(
            array(
                'wp_parse_url' => function ( $url, $component = -1 ) {
                    return -1 === $component ? parse_url( $url ) : parse_url( $url, $component );
                },
            )
        );
    }

    /**
     * @test
     * Malformed URL returns a WP_Error without making any HTTP request.
     */
    public function fetch_rejects_invalid_url(): void
    {
        $result = UrlMetaExtractor::fetch( 'not-a-url' );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_invalid_url', $result->get_error_code() );
    }

    /**
     * @test
     * Private / reserved IPs are blocked by SsrfGuard before any HTTP request
     * is made (SSRF guard validates the resolved IP, not just the URL syntax).
     */
    public function fetch_blocks_private_ip_before_http_request(): void
    {
        $fetch_called = false;
        Functions\when( 'wp_safe_remote_get' )->alias( function () use ( &$fetch_called ) {
            $fetch_called = true;
            return array( 'body' => '' );
        } );

        $result = UrlMetaExtractor::fetch( 'http://169.254.169.254/latest/meta-data/' );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_private_ip', $result->get_error_code(), 'link-local IP must be rejected by SSRF guard' );
        $this->assertFalse( $fetch_called, 'wp_safe_remote_get must not be called for a private IP' );
    }

    /**
     * @test
     * parse_html extracts the <title> tag.
     */
    public function parse_html_extracts_title(): void
    {
        $html = '<html><head><title>My Article Title</title></head><body></body></html>';

        $meta = UrlMetaExtractor::parse_html( $html );

        $this->assertSame( 'My Article Title', $meta['title'] );
    }

    /**
     * @test
     * parse_html prefers og:title when the HTML title is short/missing.
     */
    public function parse_html_prefers_og_title_over_short_html_title(): void
    {
        $html = '<html><head>'
            . '<title>Short</title>'
            . '<meta property="og:title" content="Full OG Title Here"/>'
            . '</head><body></body></html>';

        $meta = UrlMetaExtractor::parse_html( $html );

        $this->assertSame( 'Full OG Title Here', $meta['title'] );
    }

    /**
     * @test
     * parse_html extracts og:description and og:image.
     */
    public function parse_html_extracts_og_description_and_image(): void
    {
        $html = '<html><head>'
            . '<meta property="og:description" content="Great article about things"/>'
            . '<meta property="og:image" content="https://example.com/img.jpg"/>'
            . '</head><body></body></html>';

        $meta = UrlMetaExtractor::parse_html( $html );

        $this->assertSame( 'Great article about things', $meta['description'] );
        $this->assertSame( 'https://example.com/img.jpg', $meta['image'] );
    }

    /**
     * @test
     * parse_html resolves root-relative image URLs against the base URL.
     */
    public function parse_html_resolves_relative_image_url(): void
    {
        Functions\stubs( array( 'wp_parse_url' => 'parse_url' ) );

        $html = '<html><head>'
            . '<meta property="og:image" content="/images/hero.jpg"/>'
            . '</head><body></body></html>';

        $meta = UrlMetaExtractor::parse_html( $html, 'https://example.com/article' );

        $this->assertSame( 'https://example.com/images/hero.jpg', $meta['image'] );
    }

    /**
     * @test
     * parse_html returns only non-empty fields.
     */
    public function parse_html_omits_empty_fields(): void
    {
        $html = '<html><head><title>Title Only</title></head><body></body></html>';

        $meta = UrlMetaExtractor::parse_html( $html );

        $this->assertArrayHasKey( 'title', $meta );
        $this->assertArrayNotHasKey( 'description', $meta );
        $this->assertArrayNotHasKey( 'image', $meta );
    }
}
