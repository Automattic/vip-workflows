<?php
/**
 * Core prompt registration tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\AI\CorePrompts;
use VIPWorkflow\AI\PromptRegistry;
use VIPWorkflow\AI\PromptSettings;

class PromptRegistrationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Functions\when( 'get_option' )->justReturn( array() );
        Functions\when( 'update_option' )->justReturn( true );
        Functions\when( '_doing_it_wrong' )->justReturn( null );

        PromptRegistry::get_instance()->reset();
        PromptSettings::get_instance()->clear_cache();
    }

    public function test_core_media_prompts_are_registered(): void
    {
        $registry = PromptRegistry::get_instance();
        CorePrompts::register( $registry );

        foreach ( array( 'media/image-analysis', 'media/pdf-analysis', 'media/text-summary' ) as $id ) {
            $this->assertTrue( $registry->has( $id ), "Expected prompt {$id} to be registered" );
            $def = $registry->get_definition( $id );
            $this->assertNotSame( '', $def['default'] );
            $this->assertSame( 'Media', $def['group'] );
        }
    }

    public function test_summary_prompt_substitutes_content_type(): void
    {
        $registry = PromptRegistry::get_instance();
        CorePrompts::register( $registry );

        $resolved = $registry->get( 'media/text-summary', array( 'content_type' => 'audio transcript' ) );
        $this->assertStringContainsString( 'Summarize this audio transcript in 2-3 concise paragraphs', $resolved );
    }

    /**
     * Byte-identical guard: the registered default must match the text the
     * MediaProcessor call site uses today.
     */
    public function test_image_default_is_byte_identical_to_source(): void
    {
        $registry = PromptRegistry::get_instance();
        CorePrompts::register( $registry );

        $expected = "Analyze this image for editorial research. Provide:\n\n"
            . "DESCRIPTION:\n"
            . "A detailed description of what is shown (people, objects, setting, context).\n\n"
            . "KEY DETAILS:\n"
            . "- Any text visible in the image\n"
            . "- Notable elements or data points\n"
            . "- The mood/tone/style\n\n"
            . "EDITORIAL NOTES:\n"
            . "- How this image might be relevant for research\n"
            . "- Any potential concerns (sensitive content, rights issues)\n\n"
            . 'Be thorough but concise.';

        $this->assertStringStartsWith( $expected, $registry->get( 'media/image-analysis' ) );

        // The guard's own subject: the stored default is still byte-identical.
        // Resolution composes it with the output contract, which is why the
        // assertion above is a prefix rather than an equality.
        $this->assertSame( $expected, $registry->get_definition( 'media/image-analysis' )['default'] );
    }

    /**
     * A prompt whose output the admin renders declares `markdown`, and the
     * contract is appended when it resolves — not stored in the default, so that
     * a user editing the prompt in the settings UI cannot drop it.
     */
    public function test_markdown_prompts_gain_the_output_contract_on_resolve(): void
    {
        $registry = PromptRegistry::get_instance();
        CorePrompts::register( $registry );

        $definition = $registry->get_definition( 'research/source-summary' );
        $this->assertSame( 'markdown', $definition['output'] );
        $this->assertStringNotContainsString( 'You may use markdown', $definition['default'] );

        $resolved = $registry->get(
            'research/source-summary',
            array( 'max_length' => 150, 'title' => 'T', 'content' => 'C' )
        );
        $this->assertStringContainsString( 'You may use markdown', $resolved );
    }

    /**
     * The contract survives customization — that is the reason it is appended at
     * resolve time rather than baked into each default.
     */
    public function test_the_contract_survives_a_user_override(): void
    {
        $registry = PromptRegistry::get_instance();
        CorePrompts::register( $registry );

        PromptSettings::get_instance()->set_override( 'research/source-summary', 'Just summarize it.' );

        $resolved = $registry->get( 'research/source-summary' );

        $this->assertStringStartsWith( 'Just summarize it.', $resolved );
        $this->assertStringContainsString( 'You may use markdown', $resolved );
    }

    /**
     * Prompts parsed by code rather than shown to a reader must not gain it: the
     * seed analyst returns JSON, and inviting markdown would corrupt the parse.
     */
    public function test_json_prompts_do_not_gain_the_contract(): void
    {
        $registry = PromptRegistry::get_instance();
        CorePrompts::register( $registry );

        $resolved = $registry->get(
            'ideation/seed-analyst',
            array( 'seed' => 'A seed', 'brand_context' => '' )
        );

        $this->assertStringNotContainsString( 'You may use markdown', $resolved );
    }

    /**
     * An unrecognised kind is a typo. Accepting it would register a prompt that
     * silently never gains its contract.
     */
    public function test_an_unknown_output_kind_is_refused(): void
    {
        $registry = PromptRegistry::get_instance();

        $registered = $registry->register(
            'test/bad-output',
            array( 'label' => 'Bad', 'default' => 'Text.', 'output' => 'markdwon' )
        );

        $this->assertFalse( $registered );
        $this->assertFalse( $registry->has( 'test/bad-output' ) );
    }
}
