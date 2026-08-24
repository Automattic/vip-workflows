<?php
/**
 * IdeationAnalyzer research-prompt migration tests.
 *
 * Both prompt builders are pure (no AI call), so each is invoked via
 * reflection and asserted byte-identical to its prior inline text.
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
use VIPWorkflow\Ideation\Research\IdeationAnalyzer;

class IdeationAnalyzerPromptsTest extends TestCase
{
    private array $prompt_overrides = array();

    protected function setUp(): void
    {
        parent::setUp();

        $this->prompt_overrides = array();

        Functions\when( 'get_option' )->alias(
            function ( string $option, $default = false ) {
                return 'vip_workflow_prompts' === $option ? $this->prompt_overrides : $default;
            }
        );
        Functions\when( 'update_option' )->alias(
            function ( string $option, $value ) {
                if ( 'vip_workflow_prompts' === $option ) {
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

    private function analyzer(): IdeationAnalyzer
    {
        return ( new ReflectionClass( IdeationAnalyzer::class ) )->newInstanceWithoutConstructor();
    }

    private function invoke( string $method, array $args ): string
    {
        return ( new ReflectionMethod( IdeationAnalyzer::class, $method ) )->invokeArgs( $this->analyzer(), $args );
    }

    public function test_research_prompts_are_registered_under_research_group(): void
    {
        $registry = PromptRegistry::get_instance();
        foreach ( array( 'research/source-summary', 'research/project-summary' ) as $id ) {
            $this->assertTrue( $registry->has( $id ), "Expected prompt {$id} to be registered" );
            $this->assertSame( 'Research', $registry->get_definition( $id )['group'] );
        }
    }

    public function test_source_summary_byte_identical(): void
    {
        $expected = 'Summarize the following article in approximately 150 words. '
            . 'Focus on the key information, main arguments, and notable findings. '
            . "Write in a neutral, informative tone suitable for editorial research.\n\n"
            . "Title: Test Title\n\n"
            . "Content:\nArticle body.";

        $this->assertStringStartsWith( $expected, $this->invoke( 'build_source_summary_prompt', array( 'Test Title', 'Article body.', 150 ) ) );
    }

    public function test_project_summary_byte_identical(): void
    {
        $expected = 'You are analyzing 3 research sources for an editorial project. '
            . "Synthesize the information and provide:\n\n"
            . '1. A comprehensive summary (approximately 200 words) that identifies common themes, '
            . "key findings, and the overall narrative across sources.\n\n"
            . "2. A list of 3-7 key points or takeaways.\n\n"
            . "Format your response as:\n"
            . "SUMMARY:\n[Your summary here]\n\n"
            . "KEY POINTS:\n- [Point 1]\n- [Point 2]\n...\n\n"
            . "Write the labels SUMMARY: and KEY POINTS: exactly as shown, on their own "
            . "lines, not as markdown headings.\n\n"
            . "Sources:\nSource context.";

        $this->assertStringStartsWith( $expected, $this->invoke( 'build_project_summary_prompt', array( 'Source context.', 3, 200 ) ) );
    }

    public function test_override_replaces_default_with_substitution(): void
    {
        PromptSettings::get_instance()->set_override( 'research/source-summary', "Summarize {title} in {max_length} words:\n{content}" );

        $this->assertStringStartsWith(
            "Summarize My Title in 40 words:\nMy content",
            $this->invoke( 'build_source_summary_prompt', array( 'My Title', 'My content', 40 ) )
        );
    }
}
