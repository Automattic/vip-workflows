<?php
/**
 * Archive Scout and password-protected posts.
 *
 * Archive Scout searches the site's published posts. A post with a password is
 * left out: it gets no card, and neither its title nor its text is in the
 * re-rank prompt sent to the AI provider. The rule is the same for every user,
 * the post's own author and editors included, because the results are cached
 * and stored on the project for its other readers.
 *
 * Core already leaves password-protected posts out of search for visitors who
 * aren't logged in, so each search here runs as a logged-in user.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\AI\CredentialBackend;
use VIPWorkflows\AI\Credentials;
use VIPWorkflows\Ideation\Assistants\ArchiveScout;

/**
 * @covers \VIPWorkflows\Ideation\Assistants\LLMAssistedWPSearch
 * @covers \VIPWorkflows\Ideation\Assistants\ArchiveScout::execute
 */
class ArchiveScoutPasswordProtectedPostsTest extends TestCase {

	use CannedOpenAiProvider;

	private const QUERY = 'Millbrook';

	private const OPEN_TITLE = 'Millbrook reservoir reopens for swimming';

	private const PROTECTED_TITLE = 'Millbrook reservoir board minutes';

	private const PROTECTED_PHRASE = 'spillway inspection schedule';

	/**
	 * The text of the canned re-rank reply: candidate indices, best first.
	 *
	 * @var string
	 */
	private string $rerank_reply = '[0, 1]';

	public function set_up(): void {
		parent::set_up();

		// No AI provider unless a test sets one up, so the scout keeps the order
		// of the archive and makes no network call.
		Credentials::get_instance()->set_backend(
			new class() implements CredentialBackend {
				public function get_api_key( string $service ): string {
					return '';
				}
			}
		);
	}

	public function tear_down(): void {
		try {
			$this->tear_down_canned_openai_provider();
		} finally {
			parent::tear_down();
		}
	}

	/**
	 * The canned re-rank reply.
	 *
	 * @return string
	 */
	protected function canned_reply_text(): string {
		return $this->rerank_reply;
	}

	public function test_archive_scout_leaves_out_password_protected_posts(): void {
		$this->log_in_as( 'contributor' );
		$open_id      = $this->open_post();
		$protected_id = $this->protected_post();

		$result = $this->run_archive_scout();

		$this->assertSame( array( $open_id ), array_column( $result['cards'], 'post_id' ) );
		$this->assertNotContains( $protected_id, array_column( $result['cards'], 'post_id' ) );
		$this->assertStringNotContainsString( self::PROTECTED_PHRASE, (string) wp_json_encode( $result['cards'] ) );
		$this->assertStringNotContainsString( self::PROTECTED_TITLE, (string) wp_json_encode( $result['cards'] ) );
	}

	public function test_the_rerank_prompt_leaves_out_password_protected_posts(): void {
		$this->set_up_canned_openai_provider( 'gpt-4o' );
		$this->log_in_as( 'contributor' );
		$open_id = $this->open_post();
		$this->protected_post();

		$result = $this->run_archive_scout();

		$bodies = $this->provider_request_bodies( '/v1/responses' );
		$this->assertCount( 1, $bodies, 'Exactly one re-rank request is made.' );

		// The control: the capture holds the prompt with the post that has no password.
		$this->assertStringContainsString( self::OPEN_TITLE, $bodies[0] );

		$this->assertStringNotContainsString( self::PROTECTED_TITLE, $bodies[0] );
		$this->assertStringNotContainsString( self::PROTECTED_PHRASE, $bodies[0] );
		$this->assertSame( array( $open_id ), array_column( $result['cards'], 'post_id' ) );
	}

	public function test_an_editor_of_the_post_does_not_get_it_either(): void {
		$editor_id    = $this->log_in_as( 'editor' );
		$open_id      = $this->open_post();
		$protected_id = $this->protected_post( $editor_id );

		$this->assertTrue( current_user_can( 'edit_post', $protected_id ) );

		$result = $this->run_archive_scout();

		$this->assertSame( array( $open_id ), array_column( $result['cards'], 'post_id' ) );
	}

	public function test_only_password_protected_matches_give_the_empty_result(): void {
		$this->log_in_as( 'contributor' );
		$this->protected_post();

		$result = $this->run_archive_scout();

		$this->assertSame( array(), $result['cards'] );
		$this->assertSame( 'No related articles found in your archive.', $result['summary'] );
	}

	public function test_archive_scout_leaves_out_posts_with_a_space_password(): void {
		$this->log_in_as( 'contributor' );
		$open_id      = $this->open_post();
		$protected_id = $this->protected_post();
		wp_update_post(
			array(
				'ID'            => $protected_id,
				'post_password' => ' ',
			)
		);

		$this->assertSame( ' ', get_post( $protected_id )->post_password );
		$this->assertTrue( post_password_required( $protected_id ) );

		$result = $this->run_archive_scout();

		$this->assertSame( array( $open_id ), array_column( $result['cards'], 'post_id' ) );
	}

	/**
	 * Log in as a new user with a role.
	 *
	 * @param  string $role Role.
	 * @return int User ID.
	 */
	private function log_in_as( string $role ): int {
		$user_id = (int) self::factory()->user->create( array( 'role' => $role ) );
		wp_set_current_user( $user_id );
		$this->assertTrue( is_user_logged_in() );

		return $user_id;
	}

	/**
	 * A published post without a password that matches the query.
	 *
	 * @return int Post ID.
	 */
	private function open_post(): int {
		return (int) self::factory()->post->create(
			array(
				'post_title'   => self::OPEN_TITLE,
				'post_content' => 'The Millbrook reservoir beach opens on Saturday.',
				'post_status'  => 'publish',
			)
		);
	}

	/**
	 * A published post with a password that matches the query.
	 *
	 * @param  int $author_id Post author, or 0 for the factory default.
	 * @return int Post ID.
	 */
	private function protected_post( int $author_id = 0 ): int {
		$args = array(
			'post_title'    => self::PROTECTED_TITLE,
			'post_excerpt'  => 'The board agreed the ' . self::PROTECTED_PHRASE . '.',
			'post_content'  => 'Millbrook reservoir: the board agreed the ' . self::PROTECTED_PHRASE . '.',
			'post_status'   => 'publish',
			'post_password' => 'members-only',
		);
		if ( $author_id ) {
			$args['post_author'] = $author_id;
		}

		return (int) self::factory()->post->create( $args );
	}

	/**
	 * Run Archive Scout with a free-text query matching both posts.
	 *
	 * @return array{cards: array, summary: string}
	 */
	private function run_archive_scout(): array {
		return ArchiveScout::execute(
			array(
				'seed'  => 'Summer at the lake',
				'query' => self::QUERY,
			)
		);
	}
}
