<?php
/**
 * The SEO check's minimum paragraph count gates a transition.
 *
 * The setting and its Soft/Hard control used to persist and do nothing: set to
 * Hard, a transition requiring the SEO check still went through, because no
 * issue was ever emitted for the paragraph count. This drives the real
 * `vip-workflows/seo-check` ability through the transition gate.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\AbilitySettings;
use VIPWorkflows\Workflow\StatusManager;

/**
 * @covers \VIPWorkflows\Workflow\StatusManager::run_transition_tools
 */
class SeoCheckParagraphGateTest extends TestCase {

	private const TOOL = 'vip-workflows/seo-check';

	/**
	 * Post the gate is run against: two paragraphs.
	 *
	 * @var int
	 */
	private int $post_id;

	public function set_up(): void {
		parent::set_up();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$this->post_id = (int) self::factory()->post->create(
			array(
				'post_title'   => 'A title long enough to pass the title length check',
				'post_content' => "<!-- wp:paragraph -->\n<p>One.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>Two.</p>\n<!-- /wp:paragraph -->",
			)
		);
	}

	public function tear_down(): void {
		delete_option( 'vip_workflows_ability_settings' );
		AbilitySettings::get_instance()->clear_cache();

		parent::tear_down();
	}

	private function configure( string $mode ): void {
		update_option(
			'vip_workflows_ability_settings',
			array(
				self::TOOL => array(
					'options'     => array( 'min_paragraphs' => 3 ),
					'check_modes' => array( 'min_paragraphs' => $mode ),
				),
			)
		);
		AbilitySettings::get_instance()->clear_cache();
	}

	/**
	 * @return true|array|\WP_Error Whatever the gate answered.
	 */
	private function check_transition() {
		$method = new \ReflectionMethod( StatusManager::class, 'run_transition_tools' );

		return $method->invoke(
			new StatusManager(),
			$this->post_id,
			array(
				'to'             => 'review',
				'required_tools' => array( self::TOOL ),
			),
			false
		);
	}

	public function test_hard_minimum_paragraph_count_blocks_the_transition(): void {
		$this->configure( 'hard' );

		$answer = $this->check_transition();

		$this->assertInstanceOf( \WP_Error::class, $answer, 'A Hard paragraph minimum the post misses must block the move.' );
		$this->assertSame( 'tool_check_failed', $answer->get_error_code() );
		$this->assertContains( 'min_paragraphs', array_column( $answer->get_error_data()['hard_failures'], 'key' ) );
	}

	public function test_soft_minimum_paragraph_count_holds_for_acknowledgement(): void {
		$this->configure( 'soft' );

		$answer = $this->check_transition();

		$this->assertIsArray( $answer, 'A Soft paragraph minimum must hold the move for acknowledgement, not block it.' );
		$this->assertContains( 'min_paragraphs', array_column( $answer['soft_warnings'], 'key' ) );
	}
}
