<?php
/**
 * Tests for the web-address allowlist applied to URLs supplied by a provider.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use VIPWorkflows\Integrations\SafeUrl;

require_once __DIR__ . '/../../../includes/integrations/class-safe-url.php';

/**
 * A URL that arrives in a provider payload is stored and later rendered as a
 * link or image target. Only an `http` or `https` address may be stored, and
 * the decision is made on the string a browser would parse, not on the string
 * as written: a browser discards C0 controls and spaces around a URL, and tabs
 * and newlines anywhere in it, before it reads the scheme.
 *
 * @covers \VIPWorkflows\Integrations\SafeUrl
 */
class SafeUrlTest extends TestCase {

	/**
	 * @return array<string, array{0: string}>
	 */
	public static function web_addresses(): array {
		return array(
			'https'                                  => array( 'https://example.test/story?id=7#top' ),
			'http'                                   => array( 'http://example.test/' ),
			'upper-case scheme'                      => array( 'HTTPS://EXAMPLE.TEST/Path' ),
			'a space inside the path'                => array( 'https://example.test/annual report.pdf' ),
			'a script scheme later in the address'   => array( 'https://example.test/?next=javascript:alert(1)' ),
			'non-ASCII path'                         => array( 'https://example.test/caf%C3%A9/é' ),
		);
	}

	/**
	 * @dataProvider web_addresses
	 */
	public function test_a_web_address_is_returned_as_written( string $url ): void {
		$this->assertSame( $url, SafeUrl::http_or_null( $url ) );
	}

	/**
	 * @return array<string, array{0: string, 1: string}>
	 */
	public static function padded_web_addresses(): array {
		return array(
			'spaces around it'          => array( '  https://example.test/a  ', 'https://example.test/a' ),
			'a newline after it'        => array( "https://example.test/a\n", 'https://example.test/a' ),
			'a control character first' => array( "\x01https://example.test/a", 'https://example.test/a' ),
			'a tab inside it'           => array( "https://example.test/a\tb", 'https://example.test/ab' ),
			'a line break inside it'    => array( "https://exam\r\nple.test/a", 'https://example.test/a' ),
		);
	}

	/**
	 * @dataProvider padded_web_addresses
	 */
	public function test_a_web_address_is_returned_as_a_browser_reads_it( string $url, string $expected ): void {
		$this->assertSame( $expected, SafeUrl::http_or_null( $url ) );
	}

	/**
	 * @return array<string, array{0: string}>
	 */
	public static function script_capable_addresses(): array {
		return array(
			'javascript'                           => array( 'javascript:alert(1)' ),
			'javascript in mixed case'             => array( 'JaVaScRiPt:alert(1)' ),
			'javascript after a tab'               => array( "\tjavascript:alert(1)" ),
			'javascript after spaces'              => array( '   javascript:alert(1)' ),
			'javascript after a control character' => array( "\x01javascript:alert(1)" ),
			'javascript split by a newline'        => array( "java\nscript:alert(1)" ),
			'javascript split by a tab'            => array( "java\tscript:alert(1)" ),
			'javascript with a web address in it'  => array( 'javascript:fetch("https://example.test/")' ),
			'data'                                 => array( 'data:text/html,<script>alert(1)</script>' ),
			'vbscript'                             => array( 'vbscript:msgbox(1)' ),
		);
	}

	/**
	 * @dataProvider script_capable_addresses
	 */
	public function test_an_address_that_can_run_script_is_not_returned( string $url ): void {
		$this->assertNull( SafeUrl::http_or_null( $url ) );
	}

	/**
	 * @return array<string, array{0: string}>
	 */
	public static function other_addresses(): array {
		return array(
			'file'                             => array( 'file:///etc/passwd' ),
			'ftp'                              => array( 'ftp://example.test/file' ),
			'mailto'                           => array( 'mailto:desk@example.test' ),
			'tel'                              => array( 'tel:+15550100' ),
			'no scheme, two slashes'           => array( '//example.test/a' ),
			'no scheme, a path'                => array( '/wp-admin/' ),
			'no scheme, a host'                => array( 'example.test/a' ),
			'http scheme with no slashes'      => array( 'https:example.test' ),
			'a scheme that starts with http'   => array( 'httpx://example.test/' ),
			// A browser removes a tab or a newline from inside a URL, but not a NUL,
			// so this is a path that happens to hold the word, not a script URL.
			'a NUL inside the word javascript' => array( "java\x00script:alert(1)" ),
			'empty'                            => array( '' ),
			'only spaces'                      => array( '   ' ),
		);
	}

	/**
	 * @dataProvider other_addresses
	 */
	public function test_anything_that_is_not_a_web_address_is_not_returned( string $url ): void {
		$this->assertNull( SafeUrl::http_or_null( $url ) );
	}

	/**
	 * @return array<string, array{0: mixed}>
	 */
	public static function non_strings(): array {
		return array(
			'null'    => array( null ),
			'integer' => array( 7 ),
			'true'    => array( true ),
			'array'   => array( array( 'https://example.test/' ) ),
			'object'  => array( (object) array( 'url' => 'https://example.test/' ) ),
		);
	}

	/**
	 * A provider payload is decoded JSON, so a field can hold any type.
	 *
	 * @dataProvider non_strings
	 *
	 * @param mixed $value A value that is not a string.
	 */
	public function test_a_value_that_is_not_a_string_is_not_returned( $value ): void {
		$this->assertNull( SafeUrl::http_or_null( $value ) );
	}
}
