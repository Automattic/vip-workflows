<?php
/**
 * StageAgent source-excerpt truncation regression tests.
 *
 * The reported failure: the Fact Check agent died with "Malformed UTF-8
 * characters, possibly incorrectly encoded" on any post whose research sources
 * contained non-ASCII punctuation. StageAgent::truncate_text() documented a
 * character budget but enforced it with strlen()/substr(), which count bytes, so
 * a cut landing inside a curly quote, an em dash or an accented name split the
 * character and left a dangling partial byte. That invalid UTF-8 reached the AI
 * request body and json_encode refused it.
 *
 * These drive the real production path rather than the private helper: a fake
 * search provider is installed in the registry, so the public
 * web_search_context() runs normalize_sources() -> truncate_text() exactly as it
 * does for a live fact check, and format_source_context() renders the prompt
 * block that json_encode actually choked on.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use ReflectionProperty;
use VIPWorkflows\Abilities\Agents\StageAgent;
use VIPWorkflows\Ideation\Research\SearchProviders\SearchProviderInterface;
use VIPWorkflows\Ideation\Research\SearchProviders\SearchProviderRegistry;

/**
 * @covers \VIPWorkflows\Abilities\Agents\StageAgent
 */
class StageAgentSourceTruncationTest extends TestCase
{
    use MultibyteAssertions;

    /**
     * The per-source excerpt budget normalize_sources() applies, in characters.
     */
    private const EXCERPT_LIMIT = 1200;

    protected function set_up()
    {
        parent::set_up();

        // web_search_context() treats a missing HTTP API as "no booted WordPress,
        // so no web grounding" and returns early. Defining wp_remote_post gets it
        // past that guard; the fake provider never calls it.
        Functions\when( 'wp_remote_post' )->justReturn( array() );

        // The registry reads the selected provider id from an option; the default
        // ('tavily') is the key the fake is installed under.
        Functions\when( 'get_option' )->alias(
            static function ( string $name, $default = false ) {
                return $default;
            }
        );
    }

    protected function tear_down()
    {
        ( new ReflectionProperty( SearchProviderRegistry::class, 'instance' ) )->setValue( null, null );

        parent::tear_down();
    }

    /* ---------------------------------------------------------------------
     * Fixtures
     * ------------------------------------------------------------------ */

    /**
     * Install a search provider that returns $rows, replacing the real one.
     *
     * @param array $rows Result rows in { title, url, excerpt } shape.
     * @return void
     */
    private function search_returns( array $rows ): void
    {
        $provider = new class( $rows ) implements SearchProviderInterface {
            /**
             * @param array $rows Result rows to return from search().
             */
            public function __construct( private array $rows ) {}

            public function get_id(): string
            {
                return 'tavily';
            }

            public function get_name(): string
            {
                return 'Fake';
            }

            public function get_description(): string
            {
                return 'Returns canned rows.';
            }

            public function is_configured(): bool
            {
                return true;
            }

            public function get_configuration_error(): ?string
            {
                return null;
            }

            public function search( string $query, int $max_results = 10 )
            {
                return array_slice( $this->rows, 0, $max_results );
            }
        };

        ( new ReflectionProperty( SearchProviderRegistry::class, 'providers' ) )
            ->setValue( SearchProviderRegistry::get_instance(), array( 'tavily' => $provider ) );
    }

    /**
     * Run one raw excerpt through the public gather path and return what the
     * agent would put in its prompt.
     *
     * @param string $raw Raw excerpt text as a search provider would supply it.
     * @return string
     */
    private function excerpt_for( string $raw ): string
    {
        $this->search_returns(
            array(
                array(
                    'title'   => 'Library budget review',
                    'url'     => 'https://example.com/report',
                    'excerpt' => $raw,
                ),
            )
        );

        $context = StageAgent::web_search_context( 'library budget' );

        $this->assertIsArray( $context, 'The fake provider must produce a context, not a WP_Error.' );
        $this->assertCount( 1, $context['sources'] );

        return $context['sources'][0]['excerpt'];
    }

    /* ---------------------------------------------------------------------
     * The mb_strlen half: over budget in bytes, inside it in characters
     * ------------------------------------------------------------------ */

    /**
     * Accented prose is roughly two bytes per character, so an excerpt well
     * inside the character budget can be well past it in bytes. Such an excerpt
     * must come back untouched — a byte-based length check truncates it, losing
     * source material the fact check was supposed to read.
     */
    public function test_excerpt_over_the_budget_in_bytes_but_not_in_characters_is_untouched(): void
    {
        $raw = str_repeat( 'é', 700 );

        $this->assertGreaterThan( self::EXCERPT_LIMIT, strlen( $raw ), 'Fixture must exceed the budget in bytes.' );
        $this->assertLessThanOrEqual( self::EXCERPT_LIMIT, mb_strlen( $raw ), 'Fixture must stay inside the budget in characters.' );

        $out = $this->excerpt_for( $raw );

        $this->assertSame( $raw, $out );
        $this->assertStringNotContainsString( '…', $out, 'An excerpt inside the character budget must not be truncated at all.' );
    }

    /* ---------------------------------------------------------------------
     * The mb_substr half: a cut landing inside a character
     * ------------------------------------------------------------------ */

    /**
     * Two-byte character (an accented name) straddling the cut.
     *
     * @return void
     */
    public function test_cut_inside_a_two_byte_character_stays_encodable(): void
    {
        $out = $this->excerpt_for(
            $this->ascii_padding( self::EXCERPT_LIMIT - 1 ) . 'é' . ' Müller confirmed the figure.'
        );

        $this->assertAiEncodable( $out, 'Two-byte character at the cut' );
    }

    /**
     * Three-byte characters (curly quotes, em dash) straddling the cut. These are
     * the ones scraped web text is full of, and the ones that produced the report.
     *
     * @return void
     */
    public function test_cut_inside_a_three_byte_character_stays_encodable(): void
    {
        $out = $this->excerpt_for(
            $this->ascii_padding( self::EXCERPT_LIMIT - 1 ) . '—' . ' the “final” figure, per Zoë.'
        );

        $this->assertAiEncodable( $out, 'Three-byte character at the cut' );
    }

    /**
     * Four-byte character (an emoji) straddling the cut. A 4-byte sequence breaks
     * differently from a 2- or 3-byte one: the cut can leave one, two or three
     * orphaned bytes depending on where it lands, so it is worth its own case.
     *
     * @return void
     */
    public function test_cut_inside_a_four_byte_character_stays_encodable(): void
    {
        $out = $this->excerpt_for(
            $this->ascii_padding( self::EXCERPT_LIMIT - 2 ) . '🧵' . ' thread continues below.'
        );

        $this->assertAiEncodable( $out, 'Four-byte character at the cut' );
    }

    /**
     * The reported symptom, end to end: the rendered prompt block for a set of
     * scraped sources must survive the json_encode the AI client performs on the
     * request body. Every source is positioned so the cut lands mid-character.
     */
    public function test_rendered_prompt_block_survives_json_encode(): void
    {
        $rows = array();
        foreach ( array( 'é', '—', '“', '🧵' ) as $i => $char ) {
            $rows[] = array(
                'title'   => 'Source ' . ( $i + 1 ) . ' — Zoë Müller',
                'url'     => 'https://example.com/' . $i,
                'excerpt' => $this->ascii_padding( self::EXCERPT_LIMIT - 1 ) . $char . ' and the report continues.',
            );
        }
        $this->search_returns( $rows );

        $context = StageAgent::web_search_context( 'library budget' );
        $this->assertIsArray( $context );
        $this->assertCount( 4, $context['sources'] );

        $block = StageAgent::format_source_context( $context );

        $this->assertNotSame( '', $block );
        $this->assertAiEncodable( $block, 'Rendered SOURCE MATERIAL block' );

        // The real request body is an object, not a bare string; json_encode fails
        // on the whole structure when any leaf is invalid, which is the shape of
        // the production failure.
        $this->assertNotFalse(
            json_encode( array( 'prompt' => $block ) ),
            'The AI request body must encode: ' . json_last_error_msg()
        );
    }

    /* ---------------------------------------------------------------------
     * Budget semantics and the unchanged ASCII case
     * ------------------------------------------------------------------ */

    /**
     * The budget is a character budget, as documented. Under byte counting a
     * Cyrillic or accented excerpt yielded roughly half the characters asked for,
     * so how much source material an agent saw depended on the language.
     */
    public function test_budget_is_counted_in_characters_not_bytes(): void
    {
        // Deliberately space-free: production rtrim()s the cut, and a cut landing
        // on a space would make the expected character count ambiguous.
        $out = $this->excerpt_for( str_repeat( 'é', 1500 ) );

        // The budget plus the one-character ellipsis production appends.
        $this->assertSame( self::EXCERPT_LIMIT + 1, mb_strlen( $out ) );
        $this->assertStringEndsWith( '…', $out );
        $this->assertAiEncodable( $out, 'Fully multibyte excerpt at the budget' );
    }

    /**
     * Pure ASCII behaviour is unchanged, so the fix is not a behaviour change for
     * the common case: a short excerpt passes through and a long one is cut at the
     * budget with an ellipsis appended.
     */
    public function test_ascii_excerpt_behaviour_is_unchanged(): void
    {
        $short = 'Egypt lost to Argentina in the group stage.';
        $this->assertSame( $short, $this->excerpt_for( $short ) );

        $long = $this->ascii_padding( 2000 );
        $out  = $this->excerpt_for( $long );

        $this->assertSame( rtrim( substr( $long, 0, self::EXCERPT_LIMIT ) ) . '…', $out );
        $this->assertAiEncodable( $out, 'Long ASCII excerpt' );
    }
}
