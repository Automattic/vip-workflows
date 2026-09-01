<?php
/**
 * SsrfGuard unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Integrations\SsrfGuard;
use WP_Error;

/**
 * Tests for the SsrfGuard class.
 *
 * validate() is callsite-agnostic, so this suite covers every caller in the
 * AI image upload path: IdeationController::sideload_image(),
 * IdeationController::analyze_image_source(), and AiImageProvider::search_media().
 */
class SsrfGuardTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Functions\stubs(
            array(
                'wp_parse_url'                            => function ( $url, $component = -1 ) {
                    return -1 === $component ? parse_url( $url ) : parse_url( $url, $component );
                },
                'VIPWorkflows\Integrations\dns_get_record' => function ( $host, $type ) {
                    unset( $host );

                    if ( DNS_A === $type ) {
                        return array( array( 'ip' => '8.8.8.8' ) );
                    }

                    return array();
                },
                'VIPWorkflows\Integrations\gethostbynamel' => fn() => array( '8.8.8.8' ),
            )
        );
    }

    public function test_approved_domain_passes(): void
    {
        // 8.8.8.8 is a public unicast IP. Use it as both URL host and allowlist
        // entry so the IP-resolution branch resolves to itself and passes.
        $result = SsrfGuard::validate( 'https://8.8.8.8/image.png', array( '8.8.8.8' ) );
        $this->assertTrue( $result, 'public IP in allowlist should validate' );
    }

    public function test_unapproved_domain_rejected(): void
    {
        $result = SsrfGuard::validate( 'https://evil.example.com/x.png', array( 'cdn.openai.com' ) );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_host_not_allowed', $result->get_error_code() );
    }

    public function test_subdomain_match_passes_allowlist(): void
    {
        // The allowlist entry "openai.com" should also accept "files.openai.com".
        // We can test the host-match path independently using an IP literal under
        // a sub-allowlist, but to exercise subdomain matching directly we use a
        // hostname plus a permissive allowlist; the DNS step is what may fail in
        // an offline test runner, so we accept either a pass or an unresolvable
        // error — both prove the host check itself passed.
        $result = SsrfGuard::validate( 'https://files.openai.com/x.png', array( 'openai.com' ) );
        if ( $result instanceof WP_Error ) {
            $this->assertNotSame(
                'ssrf_host_not_allowed',
                $result->get_error_code(),
                'subdomain should match the bare allowlist entry'
            );
        } else {
            $this->assertTrue( $result );
        }
    }

    public function test_loopback_ipv4_rejected(): void
    {
        // Even with the host explicitly allowlisted, loopback must be rejected
        // (defends against DNS rebinding where the allowlisted name resolves
        // to 127.0.0.1).
        $result = SsrfGuard::validate( 'https://127.0.0.1/x.png', array( '127.0.0.1' ) );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_private_ip', $result->get_error_code() );
    }

    public function test_loopback_ipv6_rejected(): void
    {
        $result = SsrfGuard::validate( 'https://[::1]/x.png', array( '::1' ) );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_private_ip', $result->get_error_code() );
    }

    public function test_rfc1918_private_rejected(): void
    {
        foreach ( array( '10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1' ) as $ip ) {
            $result = SsrfGuard::validate( 'https://' . $ip . '/x.png', array( $ip ) );
            $this->assertInstanceOf( WP_Error::class, $result, $ip . ' should be rejected' );
            $this->assertSame( 'ssrf_private_ip', $result->get_error_code(), $ip . ' code' );
        }
    }

    public function test_link_local_rejected(): void
    {
        $result = SsrfGuard::validate( 'https://169.254.169.254/latest/meta-data/', array( '169.254.169.254' ) );
        $this->assertInstanceOf( WP_Error::class, $result, 'AWS metadata IP must be rejected' );
        $this->assertSame( 'ssrf_private_ip', $result->get_error_code() );
    }

    public function test_multicast_rejected(): void
    {
        $result = SsrfGuard::validate( 'https://224.0.0.1/x.png', array( '224.0.0.1' ) );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_private_ip', $result->get_error_code() );
    }

    public function test_zero_network_rejected(): void
    {
        $result = SsrfGuard::validate( 'https://0.0.0.0/x.png', array( '0.0.0.0' ) );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_private_ip', $result->get_error_code() );
    }

    public function test_ipv6_unique_local_rejected(): void
    {
        $result = SsrfGuard::validate( 'https://[fc00::1]/x.png', array( 'fc00::1' ) );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_private_ip', $result->get_error_code() );
    }

    public function test_ipv6_link_local_rejected(): void
    {
        $result = SsrfGuard::validate( 'https://[fe80::1]/x.png', array( 'fe80::1' ) );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_private_ip', $result->get_error_code() );
    }

    public function test_non_http_scheme_rejected(): void
    {
        $result = SsrfGuard::validate( 'file:///etc/passwd', array( 'localhost' ) );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_bad_scheme', $result->get_error_code() );
    }

    public function test_gopher_scheme_rejected(): void
    {
        $result = SsrfGuard::validate( 'gopher://evil/', array( 'evil' ) );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_bad_scheme', $result->get_error_code() );
    }

    public function test_empty_url_rejected(): void
    {
        $result = SsrfGuard::validate( '', array( 'cdn.openai.com' ) );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_empty_url', $result->get_error_code() );
    }

    public function test_malformed_url_rejected(): void
    {
        $result = SsrfGuard::validate( 'not-a-url', array() );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_invalid_url', $result->get_error_code() );
    }

    // -------------------------------------------------------------------------
    // validate_open_internet()
    // -------------------------------------------------------------------------

    public function test_validate_open_internet_passes_public_ip(): void
    {
        $result = SsrfGuard::validate_open_internet( 'https://8.8.8.8/path' );
        $this->assertTrue( $result, 'public IP must pass open-internet validation' );
    }

    public function test_validate_open_internet_no_allowlist_for_public_ip(): void
    {
        // validate_open_internet() has no allowlist — any public IP must pass.
        // Use an IP literal so the test is deterministic offline (no DNS needed).
        $result = SsrfGuard::validate_open_internet( 'https://8.8.8.8/article' );
        $this->assertTrue( $result, 'public IP must pass open-internet validation without an allowlist' );
    }

    public function test_validate_open_internet_rejects_private_ip(): void
    {
        foreach ( array( '10.0.0.1', '172.16.0.1', '192.168.1.1' ) as $ip ) {
            $result = SsrfGuard::validate_open_internet( 'https://' . $ip . '/secret' );
            $this->assertInstanceOf( WP_Error::class, $result, $ip . ' should be rejected' );
            $this->assertSame( 'ssrf_private_ip', $result->get_error_code(), $ip . ' code' );
        }
    }

    public function test_validate_open_internet_rejects_loopback(): void
    {
        $result = SsrfGuard::validate_open_internet( 'http://127.0.0.1/admin' );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_private_ip', $result->get_error_code() );
    }

    public function test_validate_open_internet_rejects_link_local(): void
    {
        $result = SsrfGuard::validate_open_internet( 'http://169.254.169.254/latest/meta-data/' );
        $this->assertInstanceOf( WP_Error::class, $result, 'AWS metadata endpoint must be rejected' );
        $this->assertSame( 'ssrf_private_ip', $result->get_error_code() );
    }

    public function test_validate_open_internet_rejects_non_http_scheme(): void
    {
        $result = SsrfGuard::validate_open_internet( 'file:///etc/passwd' );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_bad_scheme', $result->get_error_code() );
    }

    public function test_validate_open_internet_rejects_empty_url(): void
    {
        $result = SsrfGuard::validate_open_internet( '' );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_empty_url', $result->get_error_code() );
    }

    public function test_validate_open_internet_rejects_malformed_url(): void
    {
        $result = SsrfGuard::validate_open_internet( 'not-a-url' );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_invalid_url', $result->get_error_code() );
    }

    public function test_validate_open_internet_rejects_ipv6_unique_local(): void
    {
        $result = SsrfGuard::validate_open_internet( 'https://[fc00::1]/secret' );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_private_ip', $result->get_error_code(), 'IPv6 ULA fc00::/7 must be rejected' );
    }

    public function test_validate_open_internet_rejects_ipv6_link_local(): void
    {
        $result = SsrfGuard::validate_open_internet( 'https://[fe80::1]/secret' );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_private_ip', $result->get_error_code(), 'IPv6 link-local fe80::/10 must be rejected' );
    }

    public function test_validate_open_internet_rejects_ipv6_loopback(): void
    {
        $result = SsrfGuard::validate_open_internet( 'https://[::1]/secret' );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_private_ip', $result->get_error_code(), 'IPv6 loopback ::1 must be rejected' );
    }

    public function test_validate_open_internet_rejects_ipv6_multicast(): void
    {
        $result = SsrfGuard::validate_open_internet( 'https://[ff00::1]/secret' );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_private_ip', $result->get_error_code(), 'IPv6 multicast ff00::/8 must be rejected' );
    }

    public function test_ip_is_public_unicast_rejects_nat64_embedded_private_ipv4(): void
    {
        // NAT64 well-known prefix 64:ff9b::/96 embeds IPv4 addresses.
        // An attacker can encode 169.254.169.254 as 64:ff9b::169.254.169.254.
        // PHP's FILTER_FLAG_NO_PRIV_RANGE does not catch this — we block it explicitly.
        $result = SsrfGuard::validate_open_internet( 'https://[64:ff9b::169.254.169.254]/secret' );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_private_ip', $result->get_error_code(), 'NAT64-embedded private IPv4 must be rejected' );
    }

    // -------------------------------------------------------------------------
    // remote_get_validated()
    // -------------------------------------------------------------------------

    public function test_remote_get_validated_skips_fetch_when_validation_fails(): void
    {
        $fetch_called = false;
        Functions\when( 'wp_safe_remote_get' )->alias( function () use ( &$fetch_called ) {
            $fetch_called = true;
            return array( 'body' => '' );
        } );

        $result = SsrfGuard::remote_get_validated( 'http://169.254.169.254/latest/meta-data/' );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_private_ip', $result->get_error_code() );
        $this->assertFalse( $fetch_called, 'wp_safe_remote_get must not run when SSRF guard rejects the URL' );
    }

    public function test_remote_get_validated_disables_redirects_for_request_url(): void
    {
        $url               = 'https://8.8.8.8/page';
        $captured_callback = null;
        $remove_called     = false;

        Functions\stubs(
            array(
                'add_filter' => function ( $hook, $callback ) use ( &$captured_callback ) {
                    if ( 'http_request_args' === $hook ) {
                        $captured_callback = $callback;
                    }
                    return true;
                },
                'remove_filter' => function ( $hook ) use ( &$remove_called ) {
                    if ( 'http_request_args' === $hook ) {
                        $remove_called = true;
                    }
                    return true;
                },
                'wp_safe_remote_get' => function () {
                    return array( 'response' => array( 'code' => 200 ), 'body' => '<html></html>' );
                },
            )
        );

        $result = SsrfGuard::remote_get_validated( $url );

        $this->assertIsArray( $result );
        $this->assertNotNull( $captured_callback, 'helper must register an http_request_args filter' );
        $this->assertTrue( $remove_called, 'helper must remove the filter after fetch' );

        // Filter is unconditional — redirection is forced to 0 for any URL.
        $args = ( $captured_callback )( array( 'redirection' => 5, 'timeout' => 10 ), $url );
        $this->assertSame( 0, $args['redirection'], 'redirection must be 0' );
        $this->assertSame( 10, $args['timeout'], 'other args must pass through unchanged' );

        // The filter is scoped by the try/finally block, not by URL matching.
        // Within the scoped block it applies globally, but the block covers only one request.
        $other = ( $captured_callback )( array( 'redirection' => 5 ), 'https://other.example.com/' );
        $this->assertSame( 0, $other['redirection'], 'scoped filter applies unconditionally within the block' );
    }

    // -------------------------------------------------------------------------
    // allowlisted remote requests
    // -------------------------------------------------------------------------

    public function test_remote_post_allowlisted_skips_request_when_validation_fails(): void
    {
        $post_called = false;
        Functions\when( 'wp_safe_remote_post' )->alias( function () use ( &$post_called ) {
            $post_called = true;
            return array( 'body' => '' );
        } );

        $result = SsrfGuard::remote_post_allowlisted(
            'https://evil.example.com/webhook',
            array(),
            'test-webhook',
            array( 'hooks.slack.com' )
        );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_host_not_allowed', $result->get_error_code() );
        $this->assertFalse( $post_called, 'wp_safe_remote_post must not run when allowlist validation fails' );
    }

    public function test_remote_post_allowlisted_disables_redirects_for_request_url(): void
    {
        $url               = 'https://8.8.8.8/webhook';
        $captured_callback = null;
        $remove_called     = false;

        Functions\stubs(
            array(
                'add_filter' => function ( $hook, $callback ) use ( &$captured_callback ) {
                    if ( 'http_request_args' === $hook ) {
                        $captured_callback = $callback;
                    }
                    return true;
                },
                'remove_filter' => function ( $hook ) use ( &$remove_called ) {
                    if ( 'http_request_args' === $hook ) {
                        $remove_called = true;
                    }
                    return true;
                },
                'wp_safe_remote_post' => function () {
                    return array( 'response' => array( 'code' => 200 ), 'body' => '' );
                },
            )
        );

        $result = SsrfGuard::remote_post_allowlisted( $url, array( 'timeout' => 10 ), '', array( '8.8.8.8' ) );

        $this->assertIsArray( $result );
        $this->assertNotNull( $captured_callback, 'helper must register an http_request_args filter' );
        $this->assertTrue( $remove_called, 'helper must remove the filter after POST' );

        $args = ( $captured_callback )( array( 'redirection' => 5, 'timeout' => 10 ), $url );
        $this->assertSame( 0, $args['redirection'], 'redirection must be 0' );
        $this->assertSame( 10, $args['timeout'], 'other args must pass through unchanged' );
    }

    public function test_remote_get_allowlisted_skips_request_when_validation_fails(): void
    {
        $get_called = false;
        Functions\when( 'wp_safe_remote_get' )->alias( function () use ( &$get_called ) {
            $get_called = true;
            return array( 'body' => '' );
        } );

        $result = SsrfGuard::remote_get_allowlisted(
            'https://evil.example.com/captions',
            array(),
            'test-caption',
            array( 'youtube.com' )
        );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_host_not_allowed', $result->get_error_code() );
        $this->assertFalse( $get_called, 'wp_safe_remote_get must not run when allowlist validation fails' );
    }

    public function test_remote_get_allowlisted_disables_redirects_for_request_url(): void
    {
        $url               = 'https://8.8.8.8/captions';
        $captured_callback = null;
        $remove_called     = false;

        Functions\stubs(
            array(
                'add_filter' => function ( $hook, $callback ) use ( &$captured_callback ) {
                    if ( 'http_request_args' === $hook ) {
                        $captured_callback = $callback;
                    }
                    return true;
                },
                'remove_filter' => function ( $hook ) use ( &$remove_called ) {
                    if ( 'http_request_args' === $hook ) {
                        $remove_called = true;
                    }
                    return true;
                },
                'wp_safe_remote_get' => function () {
                    return array( 'response' => array( 'code' => 200 ), 'body' => '' );
                },
            )
        );

        $result = SsrfGuard::remote_get_allowlisted( $url, array( 'timeout' => 10 ), '', array( '8.8.8.8' ) );

        $this->assertIsArray( $result );
        $this->assertNotNull( $captured_callback, 'helper must register an http_request_args filter' );
        $this->assertTrue( $remove_called, 'helper must remove the filter after GET' );

        $args = ( $captured_callback )( array( 'redirection' => 5, 'timeout' => 10 ), $url );
        $this->assertSame( 0, $args['redirection'], 'redirection must be 0' );
        $this->assertSame( 10, $args['timeout'], 'other args must pass through unchanged' );
    }

    public function test_remote_get_allowlisted_requires_explicit_allowlist(): void
    {
        $result = SsrfGuard::remote_get_allowlisted( 'https://cdn.openai.com/file.png' );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_no_allowlist', $result->get_error_code() );
    }

    // -------------------------------------------------------------------------
    // download_validated_no_redirects()
    // -------------------------------------------------------------------------

    public function test_download_validated_no_redirects_skips_download_when_validation_fails(): void
    {
        // Validation invariant: a disallowed host must never reach download_url.
        $download_called = false;
        Functions\when( 'download_url' )->alias( function () use ( &$download_called ) {
            $download_called = true;
            return '/tmp/should-not-happen';
        } );

        $result = SsrfGuard::download_validated_no_redirects( 'https://evil.example.com/x.png' );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ssrf_host_not_allowed', $result->get_error_code() );
        $this->assertFalse( $download_called, 'download_url must not run when validation fails' );
    }

    public function test_download_validated_no_redirects_disables_redirects_on_request_url(): void
    {
        // 8.8.8.8 in its own allowlist passes validate() without needing DNS
        // (resolve_host returns the IP literal as-is), so this test is
        // deterministic offline. Intercept add_filter / remove_filter to
        // capture and invoke the closure that the helper installs.
        $url               = 'https://8.8.8.8/image.png';
        $captured_callback = null;
        $remove_called     = false;

        Functions\stubs(
            array(
                'add_filter' => function ( $hook, $callback ) use ( &$captured_callback ) {
                    if ( 'http_request_args' === $hook ) {
                        $captured_callback = $callback;
                    }
                    return true;
                },
                'remove_filter' => function ( $hook ) use ( &$remove_called ) {
                    if ( 'http_request_args' === $hook ) {
                        $remove_called = true;
                    }
                    return true;
                },
                'download_url' => function () {
                    return '/tmp/downloaded';
                },
            )
        );

        $result = SsrfGuard::download_validated_no_redirects( $url, 30, '', array( '8.8.8.8' ) );

        $this->assertSame( '/tmp/downloaded', $result );
        $this->assertNotNull( $captured_callback, 'helper must register an http_request_args filter' );
        $this->assertTrue( $remove_called, 'helper must remove the filter after download' );

        // Filter is unconditional — redirection is forced to 0 for any URL, with
        // other args untouched.
        $args = ( $captured_callback )( array( 'redirection' => 5, 'method' => 'GET' ), $url );
        $this->assertSame( 0, $args['redirection'], 'redirection must be 0' );
        $this->assertSame( 'GET', $args['method'], 'other args must pass through unchanged' );

        // The filter is scoped by the try/finally block, not by URL matching.
        // Within the scoped block it applies globally, but the block covers only
        // one download_url call.
        $other = ( $captured_callback )( array( 'redirection' => 5 ), 'https://other.example.com/' );
        $this->assertSame( 0, $other['redirection'], 'scoped filter applies unconditionally within the block' );
    }
}
