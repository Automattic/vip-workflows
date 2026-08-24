<?php
/**
 * Deduplication of stored ideation sources.
 *
 * Integration rather than unit because the behaviour under test IS the database:
 * `source_id` is derived from the card so that the UNIQUE KEY on
 * (project_id, source_id) does the deduplication, and a mocked `$wpdb` would
 * assert only that we call it the way we think we do. The interesting claims —
 * a re-run adds no rows, and a card the user has annotated is not rewritten —
 * are claims about what the table holds afterwards.
 *
 * `store_cards_as_sources()` is private and reached by reflection. The public
 * entry point runs the assistants, which needs live AI credentials; the storage
 * step is a separable unit and this keeps the test about storage.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use ReflectionMethod;
use VIPWorkflow\Ideation\Assistants\IdeationOrchestrator;

/**
 * @covers \VIPWorkflow\Ideation\Assistants\IdeationOrchestrator::store_cards_as_sources
 * @covers \VIPWorkflow\Ideation\Assistants\IdeationOrchestrator::card_identity
 */
class IdeationSourceDedupeTest extends TestCase
{
    private const ABILITY = 'vip-workflow/web-researcher';

    private int $project_id;

    public function set_up(): void
    {
        parent::set_up();

        $this->project_id = self::factory()->post->create(
            array( 'post_type' => 'post', 'post_title' => 'Dedupe project' )
        );
    }

    /**
     * Invoke the private storage step against the real table.
     *
     * @param array   $cards      Cards to store.
     * @param ?string $ability_id Ability that produced them, null for manual.
     */
    private function store( array $cards, ?string $ability_id = self::ABILITY ): void
    {
        // No setAccessible(): a no-op since PHP 8.1 and deprecated in 8.5, where
        // the notice trips beStrictAboutOutputDuringTests.
        $method = new ReflectionMethod( IdeationOrchestrator::class, 'store_cards_as_sources' );
        $method->invoke( new IdeationOrchestrator(), $this->project_id, $cards, 1, $ability_id );
    }

    private function row_count(): int
    {
        global $wpdb;

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        return (int) $wpdb->get_var(
            $wpdb->prepare(
                "SELECT COUNT(*) FROM {$wpdb->prefix}vip_ideation_sources WHERE project_id = %d",
                $this->project_id
            )
        );
    }

    private function article( string $url, string $title = 'A title' ): array
    {
        return array( 'type' => 'article', 'url' => $url, 'title' => $title );
    }

    /**
     * The whole point of the change: re-running an assistant must not re-insert
     * the cards it already stored.
     */
    public function test_storing_the_same_batch_twice_adds_no_rows(): void
    {
        $cards = array(
            $this->article( 'https://example.test/a' ),
            $this->article( 'https://example.test/b' ),
        );

        $this->store( $cards );
        $this->assertSame( 2, $this->row_count() );

        $this->store( $cards );
        $this->assertSame( 2, $this->row_count(), 'A re-run inserted duplicates.' );
    }

    /**
     * The in-batch case. The existence check reads state from before the loop, so
     * two identical cards in ONE batch would both pass it — and the second insert
     * would fail on the unique index with nothing watching.
     */
    public function test_duplicate_cards_within_one_batch_collapse(): void
    {
        $this->store(
            array(
                $this->article( 'https://example.test/a' ),
                $this->article( 'https://example.test/a', 'Rewritten headline' ),
            )
        );

        $this->assertSame( 1, $this->row_count() );
    }

    /**
     * A re-run must not rewrite a row the user has annotated: notes are keyed on
     * source_id, so refreshing content would quietly discard the context they
     * were written against.
     */
    public function test_a_re_run_leaves_an_annotated_row_alone(): void
    {
        global $wpdb;

        $this->store( array( $this->article( 'https://example.test/a', 'Original headline' ) ) );

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery
        $wpdb->update(
            $wpdb->prefix . 'vip_ideation_sources',
            array( 'notes' => 'Worth a follow-up call.' ),
            array( 'project_id' => $this->project_id )
        );

        $this->store( array( $this->article( 'https://example.test/a', 'Rewritten headline' ) ) );

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT title, notes FROM {$wpdb->prefix}vip_ideation_sources WHERE project_id = %d",
                $this->project_id
            ),
            ARRAY_A
        );

        $this->assertSame( 'Worth a follow-up call.', $row['notes'] );
        $this->assertSame( 'Original headline', $row['title'], 'The re-run overwrote annotated content.' );
    }

    /**
     * Generated content carries no URL and dedupes on title plus body. Two poems
     * that share a title are still two poems — collapsing them loses one.
     */
    public function test_generated_cards_dedupe_on_body_not_title_alone(): void
    {
        $this->store(
            array(
                array( 'type' => 'article', 'url' => '', 'title' => 'Dawn', 'content' => "Light cracks the horizon,\nthen holds." ),
                array( 'type' => 'article', 'url' => '', 'title' => 'Dawn', 'content' => 'A different poem entirely.' ),
            ),
            'vip-workflow/poems'
        );

        $this->assertSame( 2, $this->row_count() );
    }

    /**
     * Two assistants that surface one URL each keep their own card, because each
     * carries its own analysis of it.
     */
    public function test_two_abilities_keep_separate_rows_for_one_url(): void
    {
        $cards = array( $this->article( 'https://example.test/a' ) );

        $this->store( $cards, 'vip-workflow/web-researcher' );
        $this->store( $cards, 'vip-workflow/archive-scout' );

        $this->assertSame( 2, $this->row_count() );
    }

    /**
     * Board cards live in project meta and are re-minted on every analysis; they
     * must not leak into the sources table.
     */
    public function test_board_cards_are_not_stored_as_sources(): void
    {
        $this->store(
            array(
                array( 'type' => 'tag-cloud', 'title' => 'Tags' ),
                array( 'type' => 'entity', 'title' => 'An entity' ),
                array( 'type' => 'news-angle', 'title' => 'An angle' ),
                array( 'type' => 'mentor-guidance', 'title' => 'Guidance' ),
                $this->article( 'https://example.test/a' ),
            )
        );

        $this->assertSame( 1, $this->row_count() );
    }
}
