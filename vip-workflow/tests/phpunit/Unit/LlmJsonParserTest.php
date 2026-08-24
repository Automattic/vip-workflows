<?php
/**
 * LlmJsonParser unit tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use VIPWorkflow\Integrations\LlmJsonParser;
use WP_Error;

class LlmJsonParserTest extends TestCase
{
    public function test_parse_accepts_fenced_json(): void
    {
        $raw = <<<TEXT
Here is the draft:

```json
{"title":"Example headline","body":"Example body"}
```
TEXT;

        $parsed = LlmJsonParser::parse( $raw, 'draft generation' );

        $this->assertIsArray( $parsed );
        $this->assertSame( 'Example headline', $parsed['title'] );
        $this->assertSame( 'Example body', $parsed['body'] );
    }

    public function test_parse_accepts_prose_wrapped_json(): void
    {
        $raw = 'Sure, here is the requested draft: {"title":"Wrapped headline","body":"Wrapped body"} Thanks!';

        $parsed = LlmJsonParser::parse( $raw, 'draft generation' );

        $this->assertIsArray( $parsed );
        $this->assertSame( 'Wrapped headline', $parsed['title'] );
        $this->assertSame( 'Wrapped body', $parsed['body'] );
    }

    public function test_parse_returns_contextual_error_for_invalid_json(): void
    {
        $raw    = 'This is not JSON and has no parseable object.';
        $parsed = LlmJsonParser::parse( $raw, 'draft generation' );

        $this->assertInstanceOf( WP_Error::class, $parsed );
        $this->assertSame( 'parse_error', $parsed->get_error_code() );
        $this->assertStringContainsString( 'draft generation', $parsed->get_error_message() );
    }

    public function test_parse_accepts_bare_json(): void
    {
        $parsed = LlmJsonParser::parse( '  {"readiness":"developing","suggestions":[]}  ', 'mentor response' );

        $this->assertIsArray( $parsed );
        $this->assertSame( 'developing', $parsed['readiness'] );
        $this->assertSame( array(), $parsed['suggestions'] );
    }

    /**
     * A payload cut off mid-string is a distinct condition from a payload the
     * model shaped wrongly, and must not report as a generic parse failure.
     */
    public function test_parse_reports_truncated_object_as_incomplete(): void
    {
        $raw = '{' . "\n" . '  "guidance": "You have a nice tension building here between the two lists of best tac';

        $parsed = LlmJsonParser::parse( $raw, 'mentor response' );

        $this->assertInstanceOf( WP_Error::class, $parsed );
        $this->assertSame( 'incomplete_response', $parsed->get_error_code() );
        $this->assertStringContainsString( 'Incomplete mentor response', $parsed->get_error_message() );
        $this->assertStringNotContainsString( 'Failed to parse', $parsed->get_error_message() );
    }

    public function test_parse_reports_truncated_nested_array_as_incomplete(): void
    {
        // Closes the string and the inner object, but never the outer object.
        $raw = '{"readiness":"developing","suggestions":[{"label":"Find expert reactions"}';

        $parsed = LlmJsonParser::parse( $raw, 'mentor response' );

        $this->assertInstanceOf( WP_Error::class, $parsed );
        $this->assertSame( 'incomplete_response', $parsed->get_error_code() );
    }

    /**
     * Braces that only appear inside string values must not be read as nesting,
     * or complete-but-invalid payloads would be misreported as cut off.
     */
    public function test_parse_reports_balanced_but_invalid_json_as_malformed(): void
    {
        // Trailing comma: structurally balanced, still undecodable.
        $raw = '{"guidance":"Mentions a { brace and a } brace","readiness":"developing",}';

        $parsed = LlmJsonParser::parse( $raw, 'mentor response' );

        $this->assertInstanceOf( WP_Error::class, $parsed );
        $this->assertSame( 'parse_error', $parsed->get_error_code() );
    }

    public function test_parse_error_carries_json_error_and_length(): void
    {
        $raw    = '{"guidance":"Balanced but invalid",}';
        $parsed = LlmJsonParser::parse( $raw, 'mentor response' );

        $this->assertInstanceOf( WP_Error::class, $parsed );

        $data = $parsed->get_error_data();
        $this->assertSame( mb_strlen( $raw ), $data['length'] );
        $this->assertNotSame( 'No error', $data['json_error'] );

        // Both facts also reach the human-readable message.
        $this->assertStringContainsString( (string) mb_strlen( $raw ), $parsed->get_error_message() );
        $this->assertStringContainsString( $data['json_error'], $parsed->get_error_message() );
    }

    public function test_incomplete_error_carries_json_error_and_length(): void
    {
        $raw    = '{"guidance":"Cut off right here';
        $parsed = LlmJsonParser::parse( $raw, 'mentor response' );

        $this->assertInstanceOf( WP_Error::class, $parsed );
        $this->assertSame( 'incomplete_response', $parsed->get_error_code() );

        $data = $parsed->get_error_data();
        $this->assertSame( mb_strlen( $raw ), $data['length'] );
        $this->assertNotSame( 'No error', $data['json_error'] );
        $this->assertStringContainsString( $data['json_error'], $parsed->get_error_message() );
    }
}
