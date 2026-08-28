<?php
/**
 * Tests for ContentExtractor.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\Integrations\ContentExtractor;
use WP_Error;

/**
 * @group content-extractor
 */
class ContentExtractorTest extends TestCase
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
        $result = ContentExtractor::fetch( 'not-a-url' );

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

        $result = ContentExtractor::fetch( 'http://169.254.169.254/latest/meta-data/' );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_private_ip', $result->get_error_code(), 'link-local IP must be rejected by SSRF guard' );
        $this->assertFalse( $fetch_called, 'wp_safe_remote_get must not be called for a private IP' );
    }

    /**
     * @test
     * extract_text strips scripts, styles, nav, footer, header, aside and
     * returns trimmed plain text.
     */
    public function extract_text_strips_non_content_elements(): void
    {
        $html = '<html><head><style>body{color:red}</style></head><body>'
            . '<nav>Nav links</nav>'
            . '<header>Site Header</header>'
            . '<aside>Sidebar</aside>'
            . '<article><p>Hello world</p></article>'
            . '<footer>Footer</footer>'
            . '<script>alert("xss")</script>'
            . '</body></html>';

        $text = ContentExtractor::extract_text( $html );

        $this->assertStringNotContainsString( 'Nav links', $text );
        $this->assertStringNotContainsString( 'Site Header', $text );
        $this->assertStringNotContainsString( 'Sidebar', $text );
        $this->assertStringNotContainsString( 'Footer', $text );
        $this->assertStringNotContainsString( 'alert', $text );
        $this->assertStringContainsString( 'Hello world', $text );
    }

    /**
     * @test
     * extract_text truncates output to MAX_CHARS (4000) characters.
     */
    public function extract_text_truncates_to_max_chars(): void
    {
        Functions\stubs( array( 'wp_strip_all_tags' => null ) );

        $long_html = str_repeat( 'a', 5000 );

        $result = ContentExtractor::extract_text( $long_html );

        $this->assertLessThanOrEqual( 4000, mb_strlen( $result ) );
    }
}
