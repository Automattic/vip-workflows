<?php
/**
 * The addresses of an archive card, on a site that makes them without a host.
 *
 * The Archive Scout builds its cards from the site's own posts, so the link and
 * the thumbnail of a card come from WordPress, and WordPress makes both from
 * the site's settings. A site can be set up so that neither has a scheme or a
 * host. A card's address is stored only when it is an absolute `http` or
 * `https` address, so the scout has to complete these from the address of the
 * site, or the card loses its link and its image.
 *
 * Integration rather than unit because the claim starts with what WordPress
 * returns on such a site. A unit double can only repeat what its author expects
 * `get_permalink()` and `get_the_post_thumbnail_url()` to return.
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
 * @covers \VIPWorkflows\Integrations\SafeUrl::site_http_or_null
 */
class ArchiveCardSiteAddressTest extends TestCase {

	public function set_up(): void {
		parent::set_up();

		// No AI provider is configured, so the scout keeps the order of the
		// archive and makes no network call.
		Credentials::get_instance()->set_backend(
			new class() implements CredentialBackend {
				public function get_api_key( string $service ): string {
					return '';
				}
			}
		);
	}

	public function tear_down(): void {
		$this->remove_added_uploads();

		parent::tear_down();
	}

	/**
	 * A published post that the archive search can find, with a featured image.
	 *
	 * @return int Post ID.
	 */
	private function a_published_post_with_a_featured_image(): int {
		$post_id = (int) self::factory()->post->create(
			array(
				'post_title'  => 'Reservoir levels fell in 2025',
				'post_status' => 'publish',
			)
		);

		$attachment_id = (int) self::factory()->attachment->create_upload_object(
			DIR_TESTDATA . '/images/canola.jpg',
			$post_id
		);
		set_post_thumbnail( $post_id, $attachment_id );

		return $post_id;
	}

	/**
	 * The one card the Archive Scout builds for a seed that matches the post.
	 *
	 * @return array
	 */
	private function the_archive_card(): array {
		$result = ArchiveScout::execute( array( 'seed' => 'Reservoir levels fell' ) );

		$this->assertCount( 1, $result['cards'], 'The archive search did not find the post.' );

		return $result['cards'][0];
	}

	public function test_an_archive_card_has_absolute_addresses_on_a_site_that_makes_relative_ones(): void {
		$post_id = $this->a_published_post_with_a_featured_image();

		// What WordPress gives before the site is set up to leave the host out.
		// The completed addresses must be these: a browser on the site reads the
		// relative form as exactly this.
		$link      = get_permalink( $post_id );
		$thumbnail = get_the_post_thumbnail_url( $post_id, 'medium' );

		add_filter( 'post_link', 'wp_make_link_relative' );
		add_filter(
			'upload_dir',
			static function ( array $uploads ): array {
				$uploads['url']     = wp_make_link_relative( $uploads['url'] );
				$uploads['baseurl'] = wp_make_link_relative( $uploads['baseurl'] );

				return $uploads;
			}
		);

		// The premise: on this site WordPress returns addresses with no host.
		$this->assertStringStartsWith( '/', (string) get_permalink( $post_id ) );
		$this->assertStringStartsWith( '/', (string) get_the_post_thumbnail_url( $post_id, 'medium' ) );

		$card = $this->the_archive_card();

		$this->assertSame( $link, $card['url'] );
		$this->assertSame( $thumbnail, $card['thumbnail'] );
	}

	public function test_an_archive_card_has_the_addresses_wordpress_gives_on_a_default_site(): void {
		$post_id = $this->a_published_post_with_a_featured_image();

		$card = $this->the_archive_card();

		$this->assertSame( get_permalink( $post_id ), $card['url'] );
		$this->assertSame( get_the_post_thumbnail_url( $post_id, 'medium' ), $card['thumbnail'] );
	}
}
