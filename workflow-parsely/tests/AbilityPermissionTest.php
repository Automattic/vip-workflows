<?php
/**
 * Object-level authorization on the Parse.ly abilities.
 *
 * Both abilities read a post body and send it to Parse.ly. Their permission
 * callbacks used to ask only whether the caller was an editor of *something*,
 * so a contributor could name any post — including another author's private
 * draft — and have its contents forwarded to the vendor.
 *
 * These run against real users and posts because the property under test is a
 * capability decision, and a mocked `current_user_can()` proves nothing about
 * how WordPress actually maps it.
 *
 * @package WorkflowParsely\Tests
 */

declare( strict_types=1 );

namespace WorkflowParsely\Tests;

use WP_Error;
use Yoast\WPTestUtils\WPIntegration\TestCase;

/**
 * Holds the Parse.ly abilities to object-scoped authorization.
 */
class AbilityPermissionTest extends TestCase {

	/** @var int A private draft owned by somebody else. */
	private int $victim_post;

	/** @var int A draft owned by the calling contributor. */
	private int $own_post;

	/** @var int The calling contributor. */
	private int $contributor;

	public function set_up(): void {
		parent::set_up();

		$this->contributor = self::factory()->user->create( array( 'role' => 'contributor' ) );

		$this->own_post = self::factory()->post->create(
			array(
				'post_author'  => $this->contributor,
				'post_status'  => 'draft',
				'post_content' => 'A draft the contributor wrote.',
			)
		);

		$this->victim_post = self::factory()->post->create(
			array(
				'post_author'  => self::factory()->user->create( array( 'role' => 'author' ) ),
				'post_status'  => 'private',
				'post_content' => 'Embargoed reporting.',
			)
		);
	}

	/**
	 * The permission callbacks under test, keyed by a readable label.
	 *
	 * @return array<string, array{0: callable}>
	 */
	public static function ability_permission_callbacks(): array {
		return array(
			'headline suggestions' => array( array( \WorkflowParsely\Abilities\HeadlineSuggestions::class, 'can_execute' ) ),
			'smart linking'        => array( array( \WorkflowParsely\Abilities\SmartLinking::class, 'can_execute' ) ),
			'smart linking agent'  => array( array( \WorkflowParsely\Agents\SmartLinkingAgent::class, 'can_execute' ) ),
		);
	}

	/**
	 * @dataProvider ability_permission_callbacks
	 */
	public function test_refuses_a_post_the_caller_cannot_edit( callable $can_execute ): void {
		wp_set_current_user( $this->contributor );

		$result = $can_execute( array( 'post_id' => $this->victim_post ) );

		$this->assertInstanceOf( WP_Error::class, $result, 'Expected a refusal, not a permitted run.' );
		$this->assertSame( 'forbidden', $result->get_error_code() );
	}

	/**
	 * @dataProvider ability_permission_callbacks
	 */
	public function test_permits_a_post_the_caller_owns( callable $can_execute ): void {
		wp_set_current_user( $this->contributor );

		$this->assertTrue( $can_execute( array( 'post_id' => $this->own_post ) ) );
	}

	/**
	 * The gate is the capability, not authorship.
	 *
	 * @dataProvider ability_permission_callbacks
	 */
	public function test_permits_an_editor_against_another_authors_post( callable $can_execute ): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$this->assertTrue( $can_execute( array( 'post_id' => $this->victim_post ) ) );
	}

	/**
	 * @dataProvider ability_permission_callbacks
	 */
	public function test_refuses_when_no_post_is_named( callable $can_execute ): void {
		wp_set_current_user( $this->contributor );

		$this->assertInstanceOf( WP_Error::class, $can_execute( array() ) );
	}

	/**
	 * A refusal must not carry array error-data.
	 *
	 * `AbilityExecutor` reads a `WP_Error` whose data is an array as a *success*
	 * payload, so a denial shaped that way would be stored and reported as a
	 * successful ability result. The failure mode is silent, so it is asserted
	 * rather than assumed.
	 *
	 * @dataProvider ability_permission_callbacks
	 */
	public function test_refusal_carries_no_array_error_data( callable $can_execute ): void {
		wp_set_current_user( $this->contributor );

		$result = $can_execute( array( 'post_id' => $this->victim_post ) );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertIsNotArray( $result->get_error_data() );
	}

	/**
	 * A refused caller's content never reaches the vendor.
	 *
	 * The callback is the whole gate here — `execute()` does not repeat the
	 * check — so this pins the outcome that actually matters: no Parse.ly call
	 * is made on behalf of a caller who was refused.
	 */
	public function test_a_refused_caller_sends_nothing_to_parsely(): void {
		wp_set_current_user( $this->contributor );

		$calls = 0;
		add_filter(
			'workflow_parsely_suggestions_service',
			static function () use ( &$calls ) {
				++$calls;
				return null;
			}
		);

		$refusal = \WorkflowParsely\Abilities\HeadlineSuggestions::can_execute(
			array( 'post_id' => $this->victim_post )
		);

		$this->assertInstanceOf( WP_Error::class, $refusal );
		$this->assertSame( 0, $calls, 'The suggestions service was reached despite a refusal.' );

		remove_all_filters( 'workflow_parsely_suggestions_service' );
	}
}
