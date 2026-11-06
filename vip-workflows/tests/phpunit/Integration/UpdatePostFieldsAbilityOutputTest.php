<?php
/**
 * Integration coverage: update-post-fields output matches its registered schema.
 *
 * The output schema sets additionalProperties: false, and WP_Ability::execute()
 * validates the callback's return against it. The preview response carried four
 * keys the schema did not declare, so the preview step every caller has to take
 * first came back as an error.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

/**
 * Runs both response shapes through the registered ability.
 */
class UpdatePostFieldsAbilityOutputTest extends TestCase
{
	/**
	 * Post under edit.
	 *
	 * @var int
	 */
	private int $post_id;

	public function set_up(): void
	{
		parent::set_up();

		$admin_id = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin_id );

		$this->post_id = (int) self::factory()->post->create(
			array(
				'post_title'  => 'Original title',
				'post_status' => 'draft',
				'post_author' => $admin_id,
			)
		);
	}

	public function test_preview_output_matches_the_schema(): void
	{
		$result = wp_get_ability( 'vip-workflows/update-post-fields' )->execute(
			array(
				'post_id' => $this->post_id,
				'fields'  => array( 'title' => 'New title' ),
			)
		);

		$this->assertNotWPError( $result );
		$this->assertTrue( $result['requires_confirmation'] );
		$this->assertSame( 'Original title', $result['post_title'] );
		$this->assertSame( 'New title', $result['preview']['title']['new'] );
		$this->assertSame( 'Original title', get_post_field( 'post_title', $this->post_id ), 'A preview changes nothing.' );
	}

	public function test_confirmed_output_matches_the_schema(): void
	{
		$result = wp_get_ability( 'vip-workflows/update-post-fields' )->execute(
			array(
				'post_id'   => $this->post_id,
				'fields'    => array( 'title' => 'New title' ),
				'confirmed' => true,
			)
		);

		$this->assertNotWPError( $result );
		$this->assertTrue( $result['success'] );
		$this->assertSame( 'New title', get_post_field( 'post_title', $this->post_id ) );
	}
}
