<?php
/**
 * Smart Linking as a stage agent.
 *
 * Where the helper ability answers "show me what I could link", this answers
 * "is this post linked well enough to advance" — and leaves editorial notes on
 * the blocks rather than touching the content.
 *
 * @package WorkflowParsely\Tests
 */

declare( strict_types=1 );

namespace WorkflowParsely\Tests;

use WP_Error;
use Yoast\WPTestUtils\WPIntegration\TestCase;

class SmartLinkingAgentTest extends TestCase {

	/**
	 * A post with three named blocks, each mentioning a distinct phrase.
	 */
	private const CONTENT = "<!-- wp:paragraph -->\n<p>Volkswagen rebuilt the CarOS dashboard on WordPress.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>The UltraBox 16 gaming console ships this holiday season.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>Editors lean on headline testing to pick a framing.</p>\n<!-- /wp:paragraph -->";

	/** @var FakeSuggestionsService|null */
	private $fake = null;

	public function set_up(): void {
		parent::set_up();

		/*
		 * StageAgent::read_post() runs require_post_edit_permission(), so an
		 * anonymous test user gets a WP_Error before the agent does anything.
		 * The agent is only ever invoked on behalf of someone editing a post.
		 */
		wp_set_current_user(
			self::factory()->user->create( array( 'role' => 'administrator' ) )
		);

		update_option(
			'parsely',
			array(
				'apikey'     => 'example.com',
				'api_secret' => 'a-secret',
			)
		);
	}

	public function tear_down(): void {
		remove_all_filters( 'workflow_parsely_suggestions_service' );
		delete_option( 'parsely' );
		$this->fake = null;

		parent::tear_down();
	}

	/**
	 * Install a fake Suggestions API service returning $result.
	 *
	 * @param mixed $result Value the fake returns from get_smart_links().
	 */
	private function fake_service( $result ): FakeSuggestionsService {
		$this->fake = new FakeSuggestionsService( $result );
		add_filter( 'workflow_parsely_suggestions_service', fn() => $this->fake );

		return $this->fake;
	}

	private function smart_link( string $text, string $href ): FakeSmartLink {
		return new FakeSmartLink(
			array(
				'uid'    => md5( $text . $href ),
				'href'   => array(
					'raw' => $href,
					'itm' => $href,
				),
				'title'  => 'Destination',
				'text'   => $text,
				'offset' => 0,
			)
		);
	}

	private function make_post( string $content = self::CONTENT ): int {
		return self::factory()->post->create(
			array(
				'post_content' => $content,
				'post_status'  => 'draft',
			)
		);
	}

	/**
	 * @param array $input Agent input.
	 * @return mixed
	 */
	private function execute( array $input ) {
		return \WorkflowParsely\Agents\SmartLinkingAgent::execute( $input );
	}

	/**
	 * Editorial notes left on a post, newest first.
	 *
	 * @param int $post_id Post ID.
	 * @return array<int, string> Comment bodies.
	 */
	private function notes( int $post_id ): array {
		return array_map(
			static fn( $c ) => $c->comment_content,
			get_comments(
				array(
					'post_id' => $post_id,
					'status'  => 'all',
					'type'    => 'note',
				)
			)
		);
	}

	// ── Registration ─────────────────────────────────────────────────

	public function test_agent_is_registered_and_stage_eligible(): void {
		$ability = wp_get_ability( \WorkflowParsely\Agents\SmartLinkingAgent::ABILITY_ID );

		$this->assertNotNull( $ability, 'The agent must register on wp_abilities_api_init.' );

		$meta = $ability->get_meta();
		$this->assertTrue(
			! empty( $meta['stage_eligible'] ),
			'A stage agent must be stage-eligible or it cannot own a workflow stage.'
		);
		$this->assertContains( 'stage', $meta['supports'] ?? array() );
	}

	// ── Verdict ──────────────────────────────────────────────────────

	public function test_unlinked_suggestions_fail_the_check(): void {
		$this->fake_service( array( $this->smart_link( 'CarOS dashboard', 'https://example.com/caros' ) ) );

		$result = $this->execute( array( 'post_id' => $this->make_post() ) );

		$this->assertSame( 'fail', $result['status'] );
		$this->assertNotEmpty( $result['summary'] );
	}

	public function test_no_suggestions_passes(): void {
		$this->fake_service(
			new WP_Error( 'NO_LINKS', 'Found related content but could not generate a suitable link.' )
		);

		$result = $this->execute( array( 'post_id' => $this->make_post() ) );

		$this->assertSame( 'pass', $result['status'] );
	}

	// ── Notes land on the right block ────────────────────────────────

	public function test_note_is_written_for_each_suggestion(): void {
		$this->fake_service(
			array(
				$this->smart_link( 'CarOS dashboard', 'https://example.com/caros' ),
				$this->smart_link( 'UltraBox 16 gaming console', 'https://example.com/ultrabox' ),
			)
		);

		$post_id = $this->make_post();
		$this->execute( array( 'post_id' => $post_id ) );

		$bodies = implode( "\n", $this->notes( $post_id ) );
		$this->assertStringContainsString( 'CarOS dashboard', $bodies );
		$this->assertStringContainsString( 'https://example.com/caros', $bodies );
		$this->assertStringContainsString( 'UltraBox 16 gaming console', $bodies );
	}

	public function test_a_clean_pass_still_records_a_note(): void {
		$this->fake_service(
			new WP_Error( 'NO_LINKS', 'Found related content but could not generate a suitable link.' )
		);

		$post_id = $this->make_post();
		$this->execute( array( 'post_id' => $post_id ) );

		$this->assertNotEmpty(
			$this->notes( $post_id ),
			'A clean pass should say so, rather than leaving the editor guessing whether it ran.'
		);
	}

	/**
	 * An anchor the blocks do not contain must not be dropped silently.
	 */
	public function test_unmatched_anchor_is_still_reported(): void {
		$this->fake_service( array( $this->smart_link( 'a phrase not in the post', 'https://example.com/x' ) ) );

		$post_id = $this->make_post();
		$result  = $this->execute( array( 'post_id' => $post_id ) );

		$this->assertSame( 'fail', $result['status'] );
		$this->assertStringContainsString(
			'a phrase not in the post',
			implode( "\n", $this->notes( $post_id ) ),
			'A suggestion that matches no block still belongs in front of the editor.'
		);
	}

	// ── The writing is never touched ─────────────────────────────────

	/**
	 * The agent annotates; it must never edit the prose.
	 *
	 * It does write to post_content — StageAgent anchors each note to its block
	 * by adding a `noteId` attribute, which is how a note knows where it
	 * belongs. So the raw markup legitimately changes. What must not change is
	 * the text a reader sees, and no anchor may appear that the writer did not
	 * put there.
	 */
	public function test_the_prose_is_left_alone(): void {
		$this->fake_service( array( $this->smart_link( 'CarOS dashboard', 'https://example.com/caros' ) ) );

		$post_id = $this->make_post();
		$before  = wp_strip_all_tags( get_post( $post_id )->post_content );

		$this->execute( array( 'post_id' => $post_id ) );

		$after = get_post( $post_id )->post_content;

		$this->assertSame(
			$before,
			wp_strip_all_tags( $after ),
			'The visible text must be identical — the agent suggests, it does not rewrite.'
		);
		$this->assertStringNotContainsString(
			'https://example.com/caros',
			$after,
			'The suggested URL must stay in the note, not get inserted into the post.'
		);
	}

	// ── Error paths ──────────────────────────────────────────────────

	public function test_no_data_is_an_error_not_a_pass(): void {
		$this->fake_service(
			new WP_Error( 'NO_DATA', 'Unable to retrieve related content. Please check data availability.' )
		);

		$this->assertInstanceOf(
			WP_Error::class,
			$this->execute( array( 'post_id' => $this->make_post() ) ),
			'No data is ambiguous — it must not read as a clean pass.'
		);
	}

	/**
	 * The stage failure must not quote Parse.ly at the editor.
	 *
	 * The helper ability rewrote this wording; the agent passed the raw error
	 * straight through, so a stage failure read "Please check data
	 * availability" — meaningless to someone writing a post. Both paths now
	 * share one message.
	 */
	public function test_no_data_uses_the_reader_facing_wording(): void {
		$this->fake_service(
			new WP_Error( 'NO_DATA', 'Unable to retrieve related content. Please check data availability.' )
		);

		$result = $this->execute( array( 'post_id' => $this->make_post() ) );

		$this->assertStringNotContainsString(
			'check data availability',
			$result->get_error_message(),
			"Parse.ly's raw wording must not reach a stage failure."
		);
		$this->assertStringContainsString(
			'Site ID',
			$result->get_error_message(),
			'The message must name the setup cause for the case where it is one.'
		);
	}

	public function test_missing_credentials_is_an_error(): void {
		delete_option( 'parsely' );

		$this->assertInstanceOf(
			WP_Error::class,
			$this->execute( array( 'post_id' => $this->make_post() ) )
		);
	}

	public function test_missing_post_is_an_error(): void {
		$this->fake_service( array() );

		$this->assertInstanceOf(
			WP_Error::class,
			$this->execute( array( 'post_id' => 99999999 ) )
		);
	}
}
