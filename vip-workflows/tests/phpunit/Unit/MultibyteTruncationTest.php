<?php
/**
 * Multibyte truncation regression tests for the remaining prompt-building sites.
 *
 * The same defect — a documented character budget enforced with strlen()/substr(),
 * which count bytes — existed at four independent inline truncations that feed AI
 * prompts. StageAgent, the site that produced the reported "Malformed UTF-8
 * characters" failure, is covered in StageAgentSourceTruncationTest. This file
 * covers the other three, each in its own section:
 *
 *   - EditorialMentor: pinned-card excerpt at 200 characters.
 *   - IdeationAnalyzer: source content at MAX_SIMPLE_TOKENS * CHARS_PER_TOKEN,
 *     at two separate call sites (single-source summary, and the multi-source
 *     context where the budget is spent down to a $remaining allowance).
 *   - MediaProcessor: first-paragraph fallback summary at 500 characters.
 *
 * These are copies of one bug rather than one shared helper, so each site needs
 * its own fixture; a green test at one site says nothing about the others.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use ReflectionClass;
use ReflectionMethod;
use VIPWorkflow\AI\CorePrompts;
use VIPWorkflow\AI\PromptRegistry;
use VIPWorkflow\AI\PromptSettings;
use VIPWorkflow\Ideation\Assistants\EditorialMentor;
use VIPWorkflow\Ideation\Research\IdeationAnalyzer;
use VIPWorkflow\Integrations\MediaProcessor;
use WordPress\AiClient\AiClient;

require_once __DIR__ . '/../../../includes/ideation/assistants/class-editorial-mentor.php';

/**
 * @covers \VIPWorkflow\Ideation\Assistants\EditorialMentor
 * @covers \VIPWorkflow\Ideation\Research\IdeationAnalyzer
 * @covers \VIPWorkflow\Integrations\MediaProcessor
 */
class MultibyteTruncationTest extends TestCase
{
    use MultibyteAssertions;

    /**
     * EditorialMentor's pinned-card excerpt budget, in characters.
     */
    private const MENTOR_EXCERPT_LIMIT = 200;

    /**
     * MediaProcessor's first-paragraph budget, in characters.
     */
    private const FIRST_PARAGRAPH_LIMIT = 500;

    protected function setUp(): void
    {
        parent::setUp();

        AiClient::$configured    = true;
        AiClient::$generatedText = '{"guidance":"ok","readiness":"developing","suggestions":[]}';
        AiClient::$lastPrompt    = '';

        Functions\when( 'get_option' )->alias(
            static function ( string $option, $default = false ) {
                if ( 'vip_workflow_ai_model' === $option ) {
                    return 'gpt-4o-mini';
                }
                if ( 'vip_workflow_prompts' === $option ) {
                    return array();
                }
                return $default;
            }
        );
        Functions\when( '_doing_it_wrong' )->justReturn( null );
        Functions\when( 'wp_get_abilities' )->justReturn( array() );

        PromptRegistry::get_instance()->reset();
        PromptSettings::get_instance()->clear_cache();
        CorePrompts::register( PromptRegistry::get_instance() );
    }

    /* =====================================================================
     * EditorialMentor — pinned-card excerpt at 200 characters
     *
     * Reached through the private evaluate(), the same seam
     * EditorialMentorTruncationTest uses; the assertion is made on the prompt the
     * AI client actually received, so the excerpt is observed where it matters.
     * ================================================================== */

    /**
     * Build the mentor prompt for a single pinned card carrying $excerpt.
     *
     * @param string $excerpt Raw excerpt on the pinned card.
     * @return string The prompt handed to the AI client.
     */
    private function mentor_prompt_for( string $excerpt ): string
    {
        $mentor = new EditorialMentor();
        $method = new ReflectionMethod( $mentor, 'evaluate' );
        $method->invoke(
            $mentor,
            'Council cuts library hours',
            array(),
            array(
                array(
                    'source_type' => 'article',
                    'origin'      => 'search',
                    'title'       => 'Library budget review',
                    'domain'      => 'example.com',
                    'excerpt'     => $excerpt,
                ),
            ),
            0,
            3
        );

        $this->assertNotSame( '', AiClient::$lastPrompt, 'The mentor must have reached the AI client.' );

        return AiClient::$lastPrompt;
    }

    public function test_mentor_excerpt_over_budget_in_bytes_but_not_characters_is_untouched(): void
    {
        $excerpt = str_repeat( 'é', 150 );

        $this->assertGreaterThan( self::MENTOR_EXCERPT_LIMIT, strlen( $excerpt ) );
        $this->assertLessThanOrEqual( self::MENTOR_EXCERPT_LIMIT, mb_strlen( $excerpt ) );

        $this->assertStringContainsString( $excerpt, $this->mentor_prompt_for( $excerpt ) );
    }

    public function test_mentor_cut_inside_a_three_byte_character_stays_encodable(): void
    {
        $prompt = $this->mentor_prompt_for(
            $this->ascii_padding( self::MENTOR_EXCERPT_LIMIT - 1 ) . '—' . ' the “final” figure, per Zoë.'
        );

        $this->assertAiEncodable( $prompt, 'Mentor prompt, three-byte character at the cut' );
    }

    public function test_mentor_cut_inside_a_four_byte_character_stays_encodable(): void
    {
        $prompt = $this->mentor_prompt_for(
            $this->ascii_padding( self::MENTOR_EXCERPT_LIMIT - 2 ) . '🧵' . ' thread continues below.'
        );

        $this->assertAiEncodable( $prompt, 'Mentor prompt, four-byte character at the cut' );
    }

    public function test_mentor_budget_is_counted_in_characters_not_bytes(): void
    {
        $prompt = $this->mentor_prompt_for( str_repeat( 'é', 400 ) );

        $this->assertStringContainsString(
            'Excerpt: ' . str_repeat( 'é', self::MENTOR_EXCERPT_LIMIT ) . '...',
            $prompt
        );
    }

    public function test_mentor_ascii_excerpt_behaviour_is_unchanged(): void
    {
        $excerpt = $this->ascii_padding( 400 );
        $prompt  = $this->mentor_prompt_for( $excerpt );

        $this->assertStringContainsString(
            'Excerpt: ' . substr( $excerpt, 0, self::MENTOR_EXCERPT_LIMIT ) . '...',
            $prompt
        );
    }

    /* =====================================================================
     * IdeationAnalyzer — source content at MAX_SIMPLE_TOKENS * CHARS_PER_TOKEN
     *
     * Both truncations live in private prompt builders. They are pure (no AI
     * call), and IdeationAnalyzerPromptsTest already drives them via reflection,
     * so the same seam is used here.
     * ================================================================== */

    /**
     * The analyzer's character budget, read off the class rather than duplicated.
     *
     * @return int
     */
    private function analyzer_budget(): int
    {
        $class = new ReflectionClass( IdeationAnalyzer::class );

        return (int) $class->getConstant( 'MAX_SIMPLE_TOKENS' ) * (int) $class->getConstant( 'CHARS_PER_TOKEN' );
    }

    /**
     * Invoke a private analyzer method on an uninitialized instance.
     *
     * @param string $method Method name.
     * @param array  $args   Positional arguments.
     * @return string
     */
    private function analyzer_invoke( string $method, array $args ): string
    {
        $analyzer = ( new ReflectionClass( IdeationAnalyzer::class ) )->newInstanceWithoutConstructor();

        return ( new ReflectionMethod( IdeationAnalyzer::class, $method ) )->invokeArgs( $analyzer, $args );
    }

    /* --- build_source_summary_prompt ---------------------------------- */

    public function test_analyzer_source_over_budget_in_bytes_but_not_characters_is_untouched(): void
    {
        $budget  = $this->analyzer_budget();
        $content = str_repeat( 'é', (int) ( $budget * 0.75 ) );

        $this->assertGreaterThan( $budget, strlen( $content ) );
        $this->assertLessThanOrEqual( $budget, mb_strlen( $content ) );

        $prompt = $this->analyzer_invoke( 'build_source_summary_prompt', array( 'Title', $content, 150 ) );

        $this->assertStringContainsString( $content, $prompt );
        $this->assertStringNotContainsString( '[truncated]', $prompt );
    }

    public function test_analyzer_source_cut_inside_a_three_byte_character_stays_encodable(): void
    {
        $budget  = $this->analyzer_budget();
        $content = $this->ascii_padding( $budget - 1 ) . '—' . ' the “final” figure, per Zoë.';

        $prompt = $this->analyzer_invoke( 'build_source_summary_prompt', array( 'Title', $content, 150 ) );

        $this->assertStringContainsString( '[truncated]', $prompt, 'Fixture must be over budget.' );
        $this->assertAiEncodable( $prompt, 'Source-summary prompt, three-byte character at the cut' );
    }

    public function test_analyzer_source_cut_inside_a_four_byte_character_stays_encodable(): void
    {
        $budget  = $this->analyzer_budget();
        $content = $this->ascii_padding( $budget - 2 ) . '🧵' . ' thread continues below.';

        $prompt = $this->analyzer_invoke( 'build_source_summary_prompt', array( 'Title', $content, 150 ) );

        $this->assertAiEncodable( $prompt, 'Source-summary prompt, four-byte character at the cut' );
    }

    public function test_analyzer_source_budget_is_counted_in_characters_not_bytes(): void
    {
        $budget = $this->analyzer_budget();

        $prompt = $this->analyzer_invoke(
            'build_source_summary_prompt',
            array( 'Title', str_repeat( 'é', $budget + 5000 ), 150 )
        );

        $this->assertStringContainsString( str_repeat( 'é', $budget ) . '... [truncated]', $prompt );
    }

    public function test_analyzer_source_ascii_behaviour_is_unchanged(): void
    {
        $budget  = $this->analyzer_budget();
        $content = $this->ascii_padding( $budget + 5000 );

        $prompt = $this->analyzer_invoke( 'build_source_summary_prompt', array( 'Title', $content, 150 ) );

        $this->assertStringContainsString( substr( $content, 0, $budget ) . '... [truncated]', $prompt );
    }

    /* --- build_sources_context (the $remaining allowance) -------------- */

    /**
     * Build the multi-source context for a single source carrying $content.
     *
     * @param string $content Raw source content.
     * @return string
     */
    private function sources_context_for( string $content ): string
    {
        return $this->analyzer_invoke(
            'build_sources_context',
            array(
                array(
                    array(
                        'title'   => 'Library budget review',
                        'domain'  => 'example.com',
                        'content' => $content,
                    ),
                ),
            )
        );
    }

    public function test_analyzer_context_over_budget_in_bytes_but_not_characters_is_untouched(): void
    {
        $budget  = $this->analyzer_budget();
        $content = str_repeat( 'é', (int) ( $budget * 0.66 ) );

        $this->assertGreaterThan( $budget, strlen( $content ) );

        $context = $this->sources_context_for( $content );

        $this->assertStringContainsString( $content, $context );
        $this->assertStringNotContainsString( '[truncated]', $context );
    }

    public function test_analyzer_context_cut_inside_a_three_byte_character_stays_encodable(): void
    {
        // The allowance the truncating branch computes: the budget less the 200
        // characters it reserves for the surrounding header. $used is 0 on the
        // first source, so the cut lands at exactly this offset.
        $remaining = $this->analyzer_budget() - 200;

        $context = $this->sources_context_for(
            $this->ascii_padding( $remaining - 1 ) . '—' . ' the “final” figure, per Zoë. ' . $this->ascii_padding( 500 )
        );

        $this->assertStringContainsString( '[truncated]', $context, 'Fixture must reach the truncating branch.' );
        $this->assertAiEncodable( $context, 'Multi-source context, three-byte character at the cut' );
    }

    public function test_analyzer_context_cut_inside_a_four_byte_character_stays_encodable(): void
    {
        $remaining = $this->analyzer_budget() - 200;

        $context = $this->sources_context_for(
            $this->ascii_padding( $remaining - 2 ) . '🧵' . ' thread continues below. ' . $this->ascii_padding( 500 )
        );

        $this->assertStringContainsString( '[truncated]', $context, 'Fixture must reach the truncating branch.' );
        $this->assertAiEncodable( $context, 'Multi-source context, four-byte character at the cut' );
    }

    public function test_analyzer_context_allowance_is_counted_in_characters_not_bytes(): void
    {
        $remaining = $this->analyzer_budget() - 200;

        $context = $this->sources_context_for( str_repeat( 'é', $this->analyzer_budget() + 5000 ) );

        $this->assertStringContainsString( str_repeat( 'é', $remaining ) . '... [truncated]', $context );
    }

    /**
     * The budget is spent down across sources, so the accumulator has to count the
     * same unit as the comparison. Counting consumption in bytes while comparing
     * in characters overstates what earlier sources used — roughly double for
     * accented prose — and the loop then breaks on a source that still fits.
     *
     * Asserted on the consequence rather than on the arithmetic: a later source
     * inside the character budget is present in full. Checking the byte counts
     * directly would pass with either unit and prove nothing.
     */
    public function test_analyzer_context_budget_is_spent_down_in_characters_not_bytes(): void
    {
        $budget = $this->analyzer_budget();

        // Accented prose runs two bytes per character, so this first source spends
        // under half the character budget but the whole of it in bytes — enough
        // that a byte-counting accumulator has nothing left for the second source.
        $first  = str_repeat( 'é', (int) ( $budget * 0.47 ) );
        $second = $this->ascii_padding( (int) ( $budget * 0.33 ) );

        // Both together are comfortably inside the character budget, headers
        // included, so nothing should be dropped or cut...
        $this->assertLessThan( $budget, mb_strlen( $first ) + mb_strlen( $second ) + 500 );

        // ...while in bytes they are past it, which is the miscount under test.
        $this->assertGreaterThan( $budget, strlen( $first ) + strlen( $second ) );

        $context = $this->analyzer_invoke(
            'build_sources_context',
            array(
                array(
                    array(
                        'title'   => 'Rapport du conseil',
                        'domain'  => 'example.fr',
                        'content' => $first,
                    ),
                    array(
                        'title'   => 'Library budget review',
                        'domain'  => 'example.com',
                        'content' => $second,
                    ),
                ),
            )
        );

        $this->assertStringContainsString( $first, $context, 'The first source must be present in full.' );
        $this->assertStringContainsString(
            $second,
            $context,
            'A later source inside the character budget must survive: the budget was spent down in bytes.'
        );
        $this->assertStringNotContainsString( '[truncated]', $context );
    }

    public function test_analyzer_context_ascii_behaviour_is_unchanged(): void
    {
        $budget  = $this->analyzer_budget();
        $content = $this->ascii_padding( $budget + 5000 );

        $context = $this->sources_context_for( $content );

        $this->assertStringContainsString( substr( $content, 0, $budget - 200 ) . '... [truncated]', $context );
    }

    /* =====================================================================
     * MediaProcessor — first-paragraph fallback summary at 500 characters
     *
     * extract_first_paragraph() is private and its public callers (process_pdf,
     * summarize_text) need a real file on disk plus an AI round trip, so it is
     * driven by reflection. Its output becomes the source summary that later
     * reaches a prompt, which is why invalid UTF-8 here matters.
     * ================================================================== */

    /**
     * Extract the first paragraph of $text as MediaProcessor would.
     *
     * @param string $text Full extracted document text.
     * @return string
     */
    private function first_paragraph_of( string $text ): string
    {
        return ( new ReflectionMethod( MediaProcessor::class, 'extract_first_paragraph' ) )
            ->invoke( new MediaProcessor(), $text );
    }

    public function test_first_paragraph_over_budget_in_bytes_but_not_characters_is_untouched(): void
    {
        $text = str_repeat( 'é', 300 );

        $this->assertGreaterThan( self::FIRST_PARAGRAPH_LIMIT, strlen( $text ) );
        $this->assertLessThanOrEqual( self::FIRST_PARAGRAPH_LIMIT, mb_strlen( $text ) );

        $this->assertSame( $text, $this->first_paragraph_of( $text ) );
    }

    public function test_first_paragraph_cut_inside_a_three_byte_character_stays_encodable(): void
    {
        $out = $this->first_paragraph_of(
            $this->ascii_padding( self::FIRST_PARAGRAPH_LIMIT - 1 ) . '—' . ' the “final” figure, per Zoë.'
        );

        $this->assertAiEncodable( $out, 'First paragraph, three-byte character at the cut' );
    }

    public function test_first_paragraph_cut_inside_a_four_byte_character_stays_encodable(): void
    {
        $out = $this->first_paragraph_of(
            $this->ascii_padding( self::FIRST_PARAGRAPH_LIMIT - 2 ) . '🧵' . ' thread continues below.'
        );

        $this->assertAiEncodable( $out, 'First paragraph, four-byte character at the cut' );
    }

    public function test_first_paragraph_budget_is_counted_in_characters_not_bytes(): void
    {
        $out = $this->first_paragraph_of( str_repeat( 'é', 900 ) );

        $this->assertSame( str_repeat( 'é', self::FIRST_PARAGRAPH_LIMIT ) . '...', $out );
    }

    public function test_first_paragraph_ascii_behaviour_is_unchanged(): void
    {
        $short = 'A short opening paragraph.';
        $this->assertSame( $short, $this->first_paragraph_of( $short ) );

        $long = $this->ascii_padding( 900 );
        $this->assertSame( substr( $long, 0, self::FIRST_PARAGRAPH_LIMIT ) . '...', $this->first_paragraph_of( $long ) );
    }
}
