<?php
/**
 * Draft + video-transcript prompt migration tests.
 *
 * Guards that the IdeationController draft system/user prompts and the
 * video-transcript prompt resolve through the PromptRegistry and reproduce the
 * prior inline text byte-for-byte, including the conditional image blocks.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\AI\CorePrompts;
use VIPWorkflows\AI\PromptRegistry;
use VIPWorkflows\AI\PromptSettings;

class IdeationDraftPromptsTest extends TestCase
{
    private array $prompt_overrides = array();

    protected function setUp(): void
    {
        parent::setUp();

        $this->prompt_overrides = array();

        Functions\when( 'get_option' )->alias(
            function ( string $option, $default = false ) {
                return 'vip_workflows_prompts' === $option ? $this->prompt_overrides : $default;
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

    private function get( string $id, array $vars ): string
    {
        return PromptRegistry::get_instance()->get( $id, $vars );
    }

    private function draft_system_golden( string $image_placement ): string
    {
        return "You are a professional editorial writer.\n\n"
            . "EDITORIAL GUIDELINES:\nHouse style: neutral.\n\n"
            . 'TASK: Write a complete article draft of approximately 800 words based on the provided research. '
            . "Write in the voice and style described in the editorial guidelines above.\n\n"
            . "OUTPUT FORMAT: Return valid JSON with exactly two fields:\n"
            . "- \"title\": A compelling headline for the article\n"
            . '- "body": The article body in clean markdown. Use ## for section headings, '
            . 'plain paragraphs separated by blank lines, > for blockquotes, and - for bullet lists. '
            . 'Do NOT use # (h1) in the body. Do NOT include the title in the body.'
            . $image_placement
            . "\n\nReturn ONLY the JSON object. No wrapping text, no code fences.";
    }

    public function test_draft_and_transcript_prompts_registered(): void
    {
        $registry = PromptRegistry::get_instance();
        $this->assertSame( 'Draft', $registry->get_definition( 'ideation/draft-system' )['group'] );
        $this->assertSame( 'Draft', $registry->get_definition( 'ideation/draft-user' )['group'] );
        $this->assertSame( 'Research', $registry->get_definition( 'research/video-transcript' )['group'] );
    }

    public function test_draft_system_byte_identical_without_images(): void
    {
        $resolved = $this->get(
            'ideation/draft-system',
            array( 'guideline_context' => 'House style: neutral.', 'word_count' => 800, 'image_placement' => '' )
        );

        $this->assertSame( $this->draft_system_golden( '' ), $resolved );
    }

    public function test_draft_system_byte_identical_with_images(): void
    {
        $placement = ' Place [IMAGE:N] tokens on their own line where images belong.';
        $resolved  = $this->get(
            'ideation/draft-system',
            array( 'guideline_context' => 'House style: neutral.', 'word_count' => 800, 'image_placement' => $placement )
        );

        $this->assertSame( $this->draft_system_golden( $placement ), $resolved );
    }

    public function test_draft_user_byte_identical_without_images(): void
    {
        $expected = "Research project: Library cuts\n\n"
            . "Research Context:\nThree sources on funding.\n\n"
            . 'Write the draft article now.';

        $resolved = $this->get(
            'ideation/draft-user',
            array( 'project_name' => 'Library cuts', 'research_context' => 'Three sources on funding.', 'image_instructions' => '' )
        );

        $this->assertSame( $expected, $resolved );
    }

    public function test_draft_user_byte_identical_with_image_instructions(): void
    {
        $image_instructions = "\n\nAVAILABLE IMAGES:\n"
            . 'You have the following images to place in the article. '
            . 'Insert [IMAGE:N] on its own line where the image fits editorially. '
            . "Not all images must be used, but place at least one if any are available.\n"
            . "[IMAGE:0] \"Branch closed\" - A shuttered library\n";

        $expected = "Research project: Library cuts\n\n"
            . "Research Context:\nThree sources on funding." . $image_instructions . "\n\n"
            . 'Write the draft article now.';

        $resolved = $this->get(
            'ideation/draft-user',
            array( 'project_name' => 'Library cuts', 'research_context' => 'Three sources on funding.', 'image_instructions' => $image_instructions )
        );

        $this->assertSame( $expected, $resolved );
    }

    public function test_video_transcript_byte_identical(): void
    {
        $expected = "Analyze this video transcript for editorial research.\n\n"
            . "VIDEO TITLE: \"Council debate\"\n\n"
            . "TRANSCRIPT:\nThe council voted to...\n\n"
            . "Provide a thorough editorial analysis covering:\n"
            . "1. Key topics and arguments presented\n"
            . "2. Notable quotes or statements\n"
            . "3. People, organizations, or events mentioned\n"
            . "4. Relevance for journalism and editorial use\n"
            . "5. A concise summary (2-3 sentences)\n\n"
            . 'Be specific and reference content from the transcript.';

        $resolved = $this->get(
            'research/video-transcript',
            array( 'title' => 'Council debate', 'transcript' => 'The council voted to...' )
        );

        $this->assertStringStartsWith( $expected, $resolved );
    }

    public function test_override_replaces_default_with_substitution(): void
    {
        PromptSettings::get_instance()->set_override( 'ideation/draft-user', 'Project {project_name}: write it.' );

        $resolved = $this->get(
            'ideation/draft-user',
            array( 'project_name' => 'Test', 'research_context' => 'x', 'image_instructions' => '' )
        );

        $this->assertSame( 'Project Test: write it.', $resolved );
    }
}
