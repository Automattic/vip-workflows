<?php
/**
 * Card identity — the `source_id` a stored ideation source gets.
 *
 * `source_id` used to be `wp_generate_password()`, which made the UNIQUE KEY on
 * (project_id, source_id) unreachable: every assistant re-run inserted a fresh
 * set of rows for cards the project already held. Deriving it from the card's
 * content lets the index do the deduplication with no schema change.
 *
 * The risk this covers is the one that matters: too loose and re-runs keep
 * duplicating, too tight and two genuinely different sources collapse into one
 * card, silently losing the second.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use VIPWorkflows\Ideation\Assistants\IdeationOrchestrator;

require_once __DIR__ . '/../../../includes/integrations/class-guideline-context-provider.php';
require_once __DIR__ . '/../../../includes/ideation/assistants/class-ideation-orchestrator.php';

class IdeationCardIdentityTest extends TestCase
{
    private function identity( int $project_id, ?string $ability_id, array $card ): string
    {
        return IdeationOrchestrator::card_identity( $project_id, $ability_id, $card );
    }

    /**
     * The column is varchar(20); an id wider than that would be truncated by
     * MySQL and two distinct cards could then collide.
     */
    public function test_identity_fits_the_source_id_column(): void
    {
        $id = $this->identity( 7, 'x/y', array( 'url' => 'https://example.test/a' ) );

        $this->assertSame( 20, strlen( $id ) );
    }

    /**
     * The whole point: the same web result found twice is one source.
     */
    public function test_same_url_is_the_same_source(): void
    {
        $card = array( 'url' => 'https://example.test/a', 'title' => 'A' );

        $this->assertSame(
            $this->identity( 7, 'x/y', $card ),
            $this->identity( 7, 'x/y', $card )
        );
    }

    /**
     * A re-scrape can produce a different title for the same page (a headline
     * A/B test, a truncated tag). URL is identity, so that must not fork it.
     */
    public function test_url_identity_ignores_a_changed_title(): void
    {
        $this->assertSame(
            $this->identity( 7, 'x/y', array( 'url' => 'https://example.test/a', 'title' => 'First headline' ) ),
            $this->identity( 7, 'x/y', array( 'url' => 'https://example.test/a', 'title' => 'Rewritten headline' ) )
        );
    }

    public function test_different_urls_are_different_sources(): void
    {
        $this->assertNotSame(
            $this->identity( 7, 'x/y', array( 'url' => 'https://example.test/a' ) ),
            $this->identity( 7, 'x/y', array( 'url' => 'https://example.test/b' ) )
        );
    }

    /**
     * Generated content carries no URL, so identity falls back to title + body.
     */
    public function test_generated_content_dedupes_on_title_and_body(): void
    {
        $poem = array( 'url' => '', 'title' => 'Dawn', 'content' => "Light cracks the horizon,\nthen holds." );

        $this->assertSame(
            $this->identity( 7, 'poems', $poem ),
            $this->identity( 7, 'poems', $poem )
        );
    }

    /**
     * The tight-identity failure mode: two poems could share a title. Body has
     * to participate, or the second one silently disappears.
     */
    public function test_same_title_with_a_different_body_stays_distinct(): void
    {
        $this->assertNotSame(
            $this->identity( 7, 'poems', array( 'url' => '', 'title' => 'Dawn', 'content' => 'One body.' ) ),
            $this->identity( 7, 'poems', array( 'url' => '', 'title' => 'Dawn', 'content' => 'A different body.' ) )
        );
    }

    /**
     * Two assistants that surface the same URL each keep their own card: they
     * carry different analysis, and merging them would lose one's contribution.
     */
    public function test_two_assistants_keep_separate_cards_for_one_url(): void
    {
        $card = array( 'url' => 'https://example.test/a' );

        $this->assertNotSame(
            $this->identity( 7, 'web-researcher', $card ),
            $this->identity( 7, 'archive-scout', $card )
        );
    }

    /**
     * Identity is per project, so the same source in two projects is two rows —
     * each with its own notes and pin state.
     */
    public function test_identity_is_scoped_to_the_project(): void
    {
        $card = array( 'url' => 'https://example.test/a' );

        $this->assertNotSame(
            $this->identity( 7, 'x/y', $card ),
            $this->identity( 8, 'x/y', $card )
        );
    }

    /**
     * A manual add scopes to null, which is its own scope: the assistant's card
     * carries its analysis, the manual one carries the user's notes.
     */
    public function test_a_manual_add_is_distinct_from_an_assistant_card(): void
    {
        $card = array( 'url' => 'https://example.test/a' );

        $this->assertNotSame(
            $this->identity( 7, null, $card ),
            $this->identity( 7, 'web-researcher', $card )
        );
    }

    /**
     * The separator-forging case. Joined on a separator, these two hash
     * identically and the second card silently vanishes into the first. Scraped
     * titles are arbitrary bytes, so the separator cannot be assumed absent.
     */
    public function test_a_separator_inside_the_title_cannot_forge_another_cards_identity(): void
    {
        $this->assertNotSame(
            $this->identity( 7, 'poems', array( 'url' => '', 'title' => "a\0b", 'content' => 'c' ) ),
            $this->identity( 7, 'poems', array( 'url' => '', 'title' => 'a', 'content' => "b\0c" ) )
        );
    }

    /**
     * A URL identity and a title-plus-body identity must not be able to meet,
     * however the fields line up.
     */
    public function test_a_url_identity_cannot_collide_with_a_body_identity(): void
    {
        $this->assertNotSame(
            $this->identity( 7, 'x/y', array( 'url' => 'body' ) ),
            $this->identity( 7, 'x/y', array( 'url' => '', 'title' => '', 'content' => '' ) )
        );
    }

    /**
     * A card with neither URL nor title nor body should not silently share an
     * id with every other empty card — but it must still be deterministic
     * rather than throwing.
     */
    public function test_an_empty_card_still_yields_a_stable_id(): void
    {
        $this->assertSame(
            $this->identity( 7, 'x/y', array() ),
            $this->identity( 7, 'x/y', array() )
        );
    }
}
