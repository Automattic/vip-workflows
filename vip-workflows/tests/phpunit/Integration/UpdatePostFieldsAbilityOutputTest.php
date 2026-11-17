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
				'post_title'   => 'Original title',
				'post_excerpt' => '',
				'post_status'  => 'draft',
				'post_author'  => $admin_id,
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

	/**
	 * A confirmed title and excerpt are stored with their backslashes, and the
	 * response reports the values as given, not slashed a second time.
	 */
	public function test_confirmed_update_keeps_backslashes(): void
	{
		$fields = array(
			'title'   => 'Path C:\\temp',
			'excerpt' => 'a\\b and a regex \\d+',
		);

		$result = wp_get_ability( 'vip-workflows/update-post-fields' )->execute(
			array(
				'post_id'   => $this->post_id,
				'fields'    => $fields,
				'confirmed' => true,
			)
		);

		$this->assertNotWPError( $result );
		$this->assertSame( $fields, $result['updated'] );

		clean_post_cache( $this->post_id );
		$this->assertSame( 'Path C:\\temp', get_post_field( 'post_title', $this->post_id ) );
		$this->assertSame( 'a\\b and a regex \\d+', get_post_field( 'post_excerpt', $this->post_id ) );
	}

	/**
	 * The preview shows the backslashes it would write, and writes nothing.
	 */
	public function test_preview_shows_backslashes_and_writes_nothing(): void
	{
		$result = wp_get_ability( 'vip-workflows/update-post-fields' )->execute(
			array(
				'post_id' => $this->post_id,
				'fields'  => array(
					'title'   => 'Path C:\\temp',
					'excerpt' => 'a\\b',
				),
			)
		);

		$this->assertNotWPError( $result );
		$this->assertSame( 'Path C:\\temp', $result['preview']['title']['new'] );
		$this->assertSame( 'a\\b', $result['preview']['excerpt']['new'] );

		clean_post_cache( $this->post_id );
		$this->assertSame( 'Original title', get_post_field( 'post_title', $this->post_id ) );
		$this->assertSame( '', get_post_field( 'post_excerpt', $this->post_id ) );
	}

	/**
	 * A non-text field in the same slashed update still lands.
	 */
	public function test_author_updates_alongside_a_backslashed_title(): void
	{
		$new_author = (int) self::factory()->user->create( array( 'role' => 'author' ) );

		$result = wp_get_ability( 'vip-workflows/update-post-fields' )->execute(
			array(
				'post_id'   => $this->post_id,
				'fields'    => array(
					'title'  => 'C:\\Users\\tom',
					'author' => $new_author,
				),
				'confirmed' => true,
			)
		);

		$this->assertNotWPError( $result );
		$this->assertSame( $new_author, $result['updated']['author'] );

		clean_post_cache( $this->post_id );
		$this->assertSame( $new_author, (int) get_post_field( 'post_author', $this->post_id ) );
		$this->assertSame( 'C:\\Users\\tom', get_post_field( 'post_title', $this->post_id ) );
	}

	/** Exercise Core's real REST controller with test-only REST visibility. */
	public function test_rest_json_keeps_single_backslashes_through_preview_and_update(): void
	{
		$ability = wp_get_ability( 'vip-workflows/update-post-fields' );
		$property = new \ReflectionProperty( \WP_Ability::class, 'meta' );
		$meta = $property->getValue( $ability );
		$property->setValue( $ability, array_merge( $meta, array( 'show_in_rest' => true ) ) );
		try {
			$fields = array( 'title' => 'C:\Users\tom "quoted"', 'excerpt' => 'C:\Users\tom and \\server\share, /\d+/, it\'s "quoted"' );
			foreach ( array( false, true ) as $confirmed ) {
				$request = new \WP_REST_Request( 'POST', '/wp-abilities/v1/abilities/vip-workflows/update-post-fields/run' );
				$request->set_header( 'Content-Type', 'application/json' );
				$request->set_body( wp_json_encode( array( 'input' => array( 'post_id' => $this->post_id, 'fields' => $fields, 'confirmed' => $confirmed ) ) ) );
				$this->assertSame( $fields, $request->get_json_params()['input']['fields'] );
				$response = rest_do_request( $request );
				$this->assertSame( 200, $response->get_status(), wp_json_encode( $response->get_data() ) );
				$data = $response->get_data();
				if ( $confirmed ) {
					$this->assertSame( $fields, $data['updated'] );
				} else {
					$this->assertSame( $fields['title'], $data['preview']['title']['new'] );
					$this->assertSame( $fields['excerpt'], $data['preview']['excerpt']['new'] );
					$this->assertSame( 'Original title', get_post_field( 'post_title', $this->post_id ) );
				}
			}
			clean_post_cache( $this->post_id );
			$this->assertSame( $fields['title'], get_post_field( 'post_title', $this->post_id ) );
			$this->assertSame( $fields['excerpt'], get_post_field( 'post_excerpt', $this->post_id ) );
		} finally {
			$property->setValue( $ability, $meta );
		}
	}

	public function test_author_with_kses_keeps_quotes_and_backslashes(): void
	{
		$author = self::factory()->user->create( array( 'role' => 'author' ) );
		wp_update_post( array( 'ID' => $this->post_id, 'post_author' => $author ) );
		wp_set_current_user( $author );
		kses_init();
		$this->assertFalse( current_user_can( 'unfiltered_html' ) );
		$fields = array( 'title' => 'C:\Users\tom "quoted"', 'excerpt' => 'Regex /\d+/ and it\'s "quoted" in C:\Users\tom' );
		$result = wp_get_ability( 'vip-workflows/update-post-fields' )->execute( array( 'post_id' => $this->post_id, 'fields' => $fields, 'confirmed' => true ) );
		$this->assertNotWPError( $result );
		$this->assertSame( $fields, $result['updated'] );
		clean_post_cache( $this->post_id );
		$this->assertSame( $fields['title'], get_post_field( 'post_title', $this->post_id ) );
		$this->assertSame( $fields['excerpt'], get_post_field( 'post_excerpt', $this->post_id ) );
	}

	public function test_date_update_alongside_backslashes(): void
	{
		// A pending post with a GMT date is not a date-floating draft.
		$this->post_id = self::factory()->post->create( array( 'post_status' => 'pending', 'post_date' => '2026-01-01 00:00:00', 'post_date_gmt' => '2026-01-01 00:00:00' ) );
		$date = '2026-01-02 03:04:05';
		$result = wp_get_ability( 'vip-workflows/update-post-fields' )->execute( array( 'post_id' => $this->post_id, 'fields' => array( 'title' => 'C:\Users\tom', 'date' => $date ), 'confirmed' => true ) );
		$this->assertNotWPError( $result );
		$this->assertSame( $date, $result['updated']['date'] );
		clean_post_cache( $this->post_id );
		$this->assertSame( $date, get_post_field( 'post_date', $this->post_id ) );
		$this->assertSame( 'C:\Users\tom', get_post_field( 'post_title', $this->post_id ) );
	}
}
