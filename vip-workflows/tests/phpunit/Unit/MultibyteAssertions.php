<?php
/**
 * Assertions for text that is about to be handed to the AI client.
 *
 * The reported failure was not "the excerpt is the wrong length" — it was
 * "json_encode refused the request body", surfaced to the editor as
 * "Malformed UTF-8 characters, possibly incorrectly encoded". A length
 * assertion alone passes for most inputs even with a byte-based cut in place,
 * so the encoding check is what actually pins the bug.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

/**
 * Shared UTF-8 / JSON-encodability assertions.
 */
trait MultibyteAssertions
{
    /**
     * Assert text is valid UTF-8 and survives json_encode().
     *
     * Both halves matter and neither implies the other in a useful way here:
     * mb_check_encoding() names the defect precisely, while json_encode() is the
     * operation that actually failed in production, inside the AI client's
     * request serialization.
     *
     * @param string $text    Text under test.
     * @param string $context Message prefix describing where the text came from.
     * @return void
     */
    protected function assertAiEncodable( string $text, string $context ): void
    {
        $this->assertTrue(
            mb_check_encoding( $text, 'UTF-8' ),
            $context . ': text is not valid UTF-8 — a cut landed inside a multibyte character.'
        );

        $encoded = json_encode( $text );
        $this->assertNotFalse(
            $encoded,
            $context . ': json_encode() refused the text — ' . json_last_error_msg()
        );
    }

    /**
     * Realistic ASCII prose padding of an exact character length.
     *
     * Used to position a multibyte character at a chosen offset so the byte-based
     * cut lands inside it. ASCII keeps character offsets and byte offsets equal,
     * which is what makes the placement predictable.
     *
     * @param int $chars Number of characters to produce.
     * @return string
     */
    protected function ascii_padding( int $chars ): string
    {
        $filler = 'The council met on Tuesday to review the library budget. ';
        $repeat = (int) ceil( $chars / strlen( $filler ) );

        return substr( str_repeat( $filler, max( 1, $repeat ) ), 0, $chars );
    }
}
