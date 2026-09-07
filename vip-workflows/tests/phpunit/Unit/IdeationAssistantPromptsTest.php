<?php
/**
 * Ideation assistant prompt migration tests.
 *
 * Guards that the Seed Analyst, Editorial Mentor and LLM-Assisted WP Search
 * prompts resolve through the PromptRegistry and reproduce the prior heredoc
 * output byte-for-byte. The seed/search call sites are exercised end to
 * end via reflection so the variable wiring is covered, not just the registered
 * default text.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use ReflectionMethod;
use VIPWorkflows\AI\CorePrompts;
use VIPWorkflows\AI\PromptRegistry;
use VIPWorkflows\AI\PromptSettings;
use VIPWorkflows\Ideation\Assistants\EditorialMentor;
use VIPWorkflows\Ideation\Assistants\LLMAssistedWPSearch;
use VIPWorkflows\Ideation\Assistants\SeedAnalyst;
use WordPress\AiClient\AiClient;

class IdeationAssistantPromptsTest extends TestCase
{
    private array $prompt_overrides = array();

    protected function setUp(): void
    {
        parent::setUp();

        AiClient::$configured    = true;
        AiClient::$generatedText = '{}';
        AiClient::$throwMessage  = null;
        AiClient::$lastPrompt    = '';

        $this->prompt_overrides = array();

        Functions\when( 'get_option' )->alias(
            function ( string $option, $default = false ) {
                if ( 'vip_workflows_ai_model' === $option ) {
                    return 'gpt-4o-mini';
                }
                if ( 'vip_workflows_prompts' === $option ) {
                    return $this->prompt_overrides;
                }
                return $default;
            }
        );
        Functions\when( 'update_option' )->alias(
            function ( string $option, $value ) {
                if ( 'vip_workflows_prompts' === $option ) {
                    $this->prompt_overrides = $value;
                }
                return true;
            }
        );
        Functions\when( '_doing_it_wrong' )->justReturn( null );

        PromptRegistry::get_instance()->reset();
        PromptSettings::get_instance()->clear_cache();
        CorePrompts::register( PromptRegistry::get_instance() );
    }

    // --- Independent golden templates (copies of the assistant heredocs). ---

    private function seed_template(): string
    {
        return <<<'PROMPT'
Analyze this story idea seed and extract structured metadata.

SEED: "{seed}"{brand_context}

Respond in JSON with exactly this structure:
{
  "tags": ["topic1", "topic2", "topic3"],
  "entities": {
    "people": ["Name1"],
    "organizations": ["Org1"],
    "places": ["Place1"]
  },
  "search_queries": ["query for archive search", "query for web search"],
  "news_angle": "One sentence describing the core news angle",
  "suggested_title": "Auto-generated project title from the seed"
}

Rules:
- Tags: 3-7 topic tags, lowercase, specific (e.g., "uk-energy-policy" not "politics")
- Entities: only extract if clearly referenced in the seed
- Search queries: 2-3 optimized queries for finding related content
- Keep everything concise
PROMPT;
    }

    private function mentor_template(): string
    {
        return <<<'PROMPT'
You are an editorial mentor guiding a journalist through story ideation. They started with a seed idea and assistants found related sources. The journalist has been curating by pinning sources they find valuable.

STORY SEED: "{seed}"
EXTRACTED TOPICS: {tags}
NEWS ANGLE: {news_angle}
TOTAL SOURCES FOUND: {total_cards}
SOURCES PINNED BY JOURNALIST: {pinned_count} ({pinned_breakdown})
SOURCES DISMISSED: {dismissed_count}

Pinned sources (what the journalist chose to keep):
{pinned_details}

Based on what the journalist has collected so far, evaluate across: clarity of angle, source diversity, newsworthiness, and feasibility. Then respond in JSON:
{
  "guidance": "2-3 short, conversational sentences of specific advice. Reference their actual sources and angle. Suggest what's missing or what to explore next.",
  "readiness": "needs-context|developing|looking-solid|ready-to-pitch",
  "suggestions": [
    { "label": "Short button label describing the action", "assistant": "exact-assistant-id-from-list-below", "query": "the actual search query to run" }
  ]
}

AVAILABLE ASSISTANTS (use the exact "id" value in suggestions):
{assistant_list}

Rules:
- Be specific. Name their sources, topics, or gaps. Never give generic advice.
- If they have no pins yet but sources exist, acknowledge the sources are there and encourage the journalist to start pinning the ones that support their angle. Never say "no information" when TOTAL SOURCES FOUND > 0.
- If they have pins, comment on the mix (e.g., all from one domain, missing a counter-perspective, strong visual material).
- Tone: supportive colleague, not a grader.
- "needs-context": few/no pinned sources, idea is still vague
- "developing": some good material pinned, but clear gaps remain
- "looking-solid": strong diverse sources, clear angle, minor suggestions
- "ready-to-pitch": comprehensive, well-sourced, clear angle, ready to move forward
- "suggestions": 1-3 actionable next steps the journalist can take. Each must use a valid assistant ID from the list above and include a specific, ready-to-execute search query. Make the label concise and action-oriented (e.g., "Find expert reactions", "Search for related images").
PROMPT;
    }

    private function search_template(): string
    {
        return <<<'PROMPT'
Given this story idea seed, rank the following articles by relevance. Return ONLY a JSON array of article indices (numbers) in order of relevance, most relevant first. Return at most {limit} indices.

SEED: "{seed}"

ARTICLES:
{candidate_text}

Respond with a JSON array of numbers, e.g. [3, 0, 7, 1]
PROMPT;
    }

    private function render( string $template, array $vars ): string
    {
        $replacements = array();
        foreach ( $vars as $name => $value ) {
            $replacements[ '{' . $name . '}' ] = (string) $value;
        }
        return strtr( $template, $replacements );
    }

    // --- Tests ---

    public function test_ideation_prompts_are_registered_under_ideation_group(): void
    {
        $registry = PromptRegistry::get_instance();
        foreach ( array( 'ideation/seed-analyst', 'ideation/editorial-mentor', 'ideation/wp-search-rerank' ) as $id ) {
            $this->assertTrue( $registry->has( $id ), "Expected prompt {$id} to be registered" );
            $this->assertSame( 'Ideation', $registry->get_definition( $id )['group'] );
        }
    }

    /**
     * Seed Analyst call site: the sent prompt is byte-identical to the prior
     * heredoc (no brand context), proving the {seed}/{brand_context} wiring.
     */
    public function test_seed_analyst_call_site_byte_identical(): void
    {
        $expected = $this->render( $this->seed_template(), array( 'seed' => 'Council cuts library hours', 'brand_context' => '' ) );

        $analyst = new SeedAnalyst();
        $method  = new ReflectionMethod( $analyst, 'analyze_seed' );
        $method->invoke( $analyst, 'Council cuts library hours', array() );

        $this->assertSame( $expected, AiClient::$lastPrompt );
    }

    /**
     * LLM-Assisted WP Search call site: byte-identical re-ranking prompt,
     * proving the {limit}/{seed}/{candidate_text} wiring.
     */
    public function test_wp_search_rerank_call_site_byte_identical(): void
    {
        AiClient::$generatedText = '[0]';

        $candidates = array(
            array( 'title' => 'Library funding falls', 'excerpt' => 'Spending on libraries dropped sharply this year.' ),
            array( 'title' => 'Opening hours reduced', 'excerpt' => 'Several branches will close on weekends.' ),
        );
        $candidate_text = "[0] \"Library funding falls\" - Spending on libraries dropped sharply this year.\n"
            . '[1] "Opening hours reduced" - Several branches will close on weekends.';

        $expected = $this->render(
            $this->search_template(),
            array( 'limit' => 5, 'seed' => 'Council cuts library hours', 'candidate_text' => $candidate_text )
        );

        $search = new LLMAssistedWPSearch();
        $method = new ReflectionMethod( $search, 'rerank_with_llm' );
        $method->invoke( $search, 'Council cuts library hours', $candidates, 5 );

        $this->assertSame( $expected, AiClient::$lastPrompt );
    }

    /**
     * Editorial Mentor registered default is byte-identical to the prior heredoc
     * once its variables are substituted. The call site derives many vars
     * from runtime state, so the default is guarded at the registry level.
     */
    public function test_editorial_mentor_default_byte_identical(): void
    {
        $vars = array(
            'seed'             => 'Council cuts library hours',
            'tags'             => 'libraries, austerity',
            'news_angle'       => 'Cuts hit the most deprived wards hardest',
            'total_cards'      => 12,
            'pinned_count'     => 3,
            'pinned_breakdown' => '2 articles, 1 image',
            'dismissed_count'  => 4,
            'pinned_details'   => "- [article, search] \"Funding falls\"",
            'assistant_list'   => '- id: web-search',
        );

        $expected = $this->render( $this->mentor_template(), $vars );
        $resolved = PromptRegistry::get_instance()->get( 'ideation/editorial-mentor', $vars );

        $this->assertSame( $expected, $resolved );
    }

    public function test_override_replaces_default_with_substitution(): void
    {
        PromptSettings::get_instance()->set_override( 'ideation/seed-analyst', 'Custom analysis for: {seed}' );

        $resolved = PromptRegistry::get_instance()->get( 'ideation/seed-analyst', array( 'seed' => 'Test seed', 'brand_context' => '' ) );
        $this->assertSame( 'Custom analysis for: Test seed', $resolved );
    }
}
