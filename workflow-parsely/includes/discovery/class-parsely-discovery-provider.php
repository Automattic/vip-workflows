<?php
/**
 * Parse.ly as a story discovery provider.
 *
 * What Parse.ly can answer is "which of your published stories is drawing
 * traffic right now" — the `/analytics/posts` endpoint ranks your own archive.
 * It is not a feed of topics trending in the world, and the cards are written to
 * say so: each one is a story that already ran and did well, offered as the
 * starting point for a follow-up rather than as a commission.
 *
 * That is a narrower promise than "trending topics", and a more useful one. An
 * editor who knows a piece is climbing has a concrete reason to write the next
 * one, which a generic topic feed cannot give them.
 *
 * Recommend-only by design. The analytics endpoint ranks; it does not answer a
 * text query, and the discovery spec allows a provider to declare `recommend`
 * alone precisely so this is not faked with client-side filtering that would
 * look like search and behave nothing like it.
 *
 * @package WorkflowParsely
 */

declare( strict_types=1 );

namespace WorkflowParsely\Discovery;

use VIPWorkflow\Abilities\Availability;
use WorkflowParsely\ParselyClient;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Turns Parse.ly's top-content analytics into story prompts.
 */
class ParselyDiscoveryProvider {

	/**
	 * Provider slug.
	 */
	public const SLUG = 'parsely-trending';

	/**
	 * How many prompts to offer when the provider has no configured limit.
	 *
	 * Eight fills the landing page's row without pushing the other providers
	 * below the fold.
	 */
	private const DEFAULT_LIMIT = 8;

	/**
	 * Traffic window, in days, when none is configured.
	 *
	 * Seven is also the analytics endpoint's own maximum for its `max_days`
	 * shorthand, so a longer window would silently be cut back to this anyway.
	 */
	private const DEFAULT_PERIOD_DAYS = 7;

	/**
	 * How many leading prompts are marked as top stories.
	 */
	private const TOP_STORY_COUNT = 3;

	/**
	 * Parse.ly appends this to every URL it returns.
	 *
	 * Left in place it would be shown to the editor, folded into the seed, and
	 * eventually published as a link to our own site carrying Parse.ly's
	 * attribution parameter.
	 */
	private const TRACKING_PARAM = 'itm_source';

	/**
	 * Register the provider.
	 *
	 * @param \VIPWorkflow\Discovery\DiscoveryProviderRegistry $registry Registry instance.
	 */
	public static function register( $registry ): void {
		$registry->register(
			self::SLUG,
			array(
				'label'                 => __( 'Parse.ly Trending', 'workflow-parsely' ),
				'description'           => __( 'Your best-performing published stories right now, as starting points for a follow-up.', 'workflow-parsely' ),
				'icon'                  => 'chart-line',
				'features'              => array( 'recommend' ),
				'callbacks'             => array(
					'recommend' => array( self::class, 'recommend' ),
					'seed'      => array( self::class, 'seed' ),
				),
				'availability_callback' => array( self::class, 'check_availability' ),
			)
		);
	}

	/**
	 * Whether Parse.ly is set up.
	 *
	 * @return bool|Availability True when configured, otherwise the unmet requirement.
	 */
	public static function check_availability(): bool|Availability {
		return \WorkflowParsely\check_availability();
	}

	/**
	 * Story prompts for the ideation landing page.
	 *
	 * Always returns an array. The discovery controller catches throwables per
	 * provider and coerces a non-array to empty, so a failure here already
	 * degrades this section alone — but a `WP_Error` returned rather than
	 * swallowed would be serialized into the ideation screen on its way through,
	 * so failures are converted here instead of relying on that safety net.
	 *
	 * Results are not cached here: the controller already stores them under
	 * `vip_discovery_recommend_*` for the provider's configured `cache_minutes`,
	 * and a second cache would only make the first one harder to reason about.
	 *
	 * @param array $config The provider's saved settings.
	 * @return array Story prompts, possibly empty.
	 */
	public static function recommend( array $config = array() ): array {
		$service = ParselyClient::content();

		if ( $service instanceof WP_Error ) {
			return array();
		}

		$limit = (int) ( $config['limit'] ?? self::DEFAULT_LIMIT );
		$days  = (int) ( $config['period_days'] ?? self::DEFAULT_PERIOD_DAYS );

		$posts = $service->get_posts(
			array(
				'period_start' => $days . 'd',
				'sort'         => 'views',
				'limit'        => $limit,
			)
		);

		if ( $posts instanceof WP_Error || ! is_array( $posts ) ) {
			return array();
		}

		$prompts = array();

		foreach ( array_values( $posts ) as $index => $post ) {
			if ( ! is_array( $post ) ) {
				continue;
			}

			$prompt = self::format_prompt( $post, $index );

			if ( null !== $prompt ) {
				$prompts[] = $prompt;
			}
		}

		return $prompts;
	}

	/**
	 * Normalize one analytics row into a story prompt.
	 *
	 * @param array $post  A row from `/analytics/posts`.
	 * @param int   $index Its position in the ranked response.
	 * @return array|null The prompt, or null when the row cannot make a card.
	 */
	private static function format_prompt( array $post, int $index ): ?array {
		$title = trim( (string) ( $post['title'] ?? '' ) );

		/*
		 * Title is one of the discovery framework's three required fields, and a
		 * card is nothing without it. Parse.ly occasionally ranks a URL it has
		 * traffic for but no metadata on — a redirect, or a page crawled before
		 * its tags were in place.
		 */
		if ( '' === $title ) {
			return null;
		}

		$url     = self::clean_url( (string) ( $post['url'] ?? $post['link'] ?? '' ) );
		$section = trim( (string) ( $post['section'] ?? '' ) );
		$author  = trim( (string) ( $post['author'] ?? '' ) );

		$metrics = is_array( $post['metrics'] ?? null ) ? $post['metrics'] : array();
		$views   = (int) ( $metrics['views'] ?? 0 );

		$tags = array_values(
			array_filter(
				(array) ( $post['tags'] ?? array() ),
				static fn( $tag ) => is_string( $tag ) && '' !== $tag
			)
		);

		return array(
			'id'          => self::SLUG . '-' . md5( '' !== $url ? $url : $title ),
			'provider'    => self::SLUG,
			'title'       => $title,
			'description' => self::compose_description( $section, $author, $views, (string) ( $post['pub_date'] ?? '' ) ),
			'url'         => $url,
			'date'        => (string) ( $post['pub_date'] ?? '' ),
			'date_end'    => null,
			'tags'        => $tags,
			'importance'  => $index < self::TOP_STORY_COUNT ? 'top_story' : 'normal',
			'meta'        => array(
				'views'               => $views,
				'recirculation_rate'  => (float) ( $metrics['recirculation_rate'] ?? 0 ),
				'avg_engaged_minutes' => (float) ( $metrics['avg_engaged'] ?? 0 ),
				'section'             => $section,
				'author'              => $author,
				'word_count'          => (int) ( $post['full_content_word_count'] ?? 0 ),
				'thumbnail'           => (string) ( $post['thumb_url_medium'] ?? $post['image_url'] ?? '' ),
			),
		);
	}

	/**
	 * Compose the card's second line.
	 *
	 * Parse.ly returns no description, excerpt, or summary of any kind, so the
	 * line has to be built from the facts it does give. Each clause is added only
	 * when its source is present rather than printing an empty section name or a
	 * bare "0 views", both of which read as a broken card rather than a thin one.
	 *
	 * @param string $section  Section name, possibly empty.
	 * @param string $author   Author name, possibly empty.
	 * @param int    $views    View count over the traffic window.
	 * @param string $pub_date Publication date as Parse.ly returns it.
	 * @return string
	 */
	private static function compose_description( string $section, string $author, int $views, string $pub_date ): string {
		$published = '';

		if ( '' !== $pub_date ) {
			$timestamp = strtotime( $pub_date );

			if ( false !== $timestamp ) {
				$published = (string) wp_date( 'M j', $timestamp );
			}
		}

		$origin = array_filter(
			array(
				'' !== $published ? sprintf(
					/* translators: %s: abbreviated publication date. */
					__( 'Published %s', 'workflow-parsely' ),
					$published
				) : '',
				'' !== $section ? sprintf(
					/* translators: %s: section name. */
					__( 'in %s', 'workflow-parsely' ),
					$section
				) : '',
				'' !== $author ? sprintf(
					/* translators: %s: author name. */
					__( 'by %s', 'workflow-parsely' ),
					$author
				) : '',
			)
		);

		$sentences = array();

		if ( ! empty( $origin ) ) {
			$sentences[] = implode( ' ', $origin ) . '.';
		}

		if ( $views > 0 ) {
			$sentences[] = sprintf(
				/* translators: %s: formatted view count. */
				_n( '%s view since publication.', '%s views since publication.', $views, 'workflow-parsely' ),
				number_format_i18n( $views )
			);
		}

		return implode( ' ', $sentences );
	}

	/**
	 * Strip Parse.ly's attribution parameter, keeping every other one.
	 *
	 * Removing the whole query string would be simpler and wrong: paginated and
	 * filtered URLs are real content, and truncating them would point the editor
	 * at a different page than the one that earned the traffic.
	 *
	 * @param string $url URL as Parse.ly returns it.
	 * @return string
	 */
	private static function clean_url( string $url ): string {
		if ( '' === $url || ! str_contains( $url, self::TRACKING_PARAM ) ) {
			return $url;
		}

		return (string) remove_query_arg( self::TRACKING_PARAM, $url );
	}

	/**
	 * Compose the seed an editor's selection becomes.
	 *
	 * The framing matters more than the detail. Without it the seed reads as a
	 * commission for a story that already ran last week, and the ideation
	 * assistants will dutifully develop the piece we have already published.
	 *
	 * @param array $prompt The selected story prompt.
	 * @return string
	 */
	public static function seed( array $prompt ): string {
		$title = (string) ( $prompt['title'] ?? '' );
		$meta  = is_array( $prompt['meta'] ?? null ) ? $prompt['meta'] : array();

		$parts = array(
			sprintf(
				/* translators: %s: headline of the published story. */
				__( 'We published "%s" and it is among our best-performing stories right now.', 'workflow-parsely' ),
				$title
			),
		);

		$section = (string) ( $meta['section'] ?? '' );
		$views   = (int) ( $meta['views'] ?? 0 );

		if ( '' !== $section && $views > 0 ) {
			$parts[] = sprintf(
				/* translators: 1: formatted view count, 2: section name. */
				_n(
					'It has drawn %1$s view in %2$s.',
					'It has drawn %1$s views in %2$s.',
					$views,
					'workflow-parsely'
				),
				number_format_i18n( $views ),
				$section
			);
		}

		$tags = array_filter( (array) ( $prompt['tags'] ?? array() ) );

		if ( ! empty( $tags ) ) {
			$parts[] = sprintf(
				/* translators: %s: comma-separated tag names. */
				__( 'Topics: %s.', 'workflow-parsely' ),
				implode( ', ', $tags )
			);
		}

		$parts[] = __( 'Develop the follow-up: what has changed since, what the coverage left unanswered, and which angle is worth taking next.', 'workflow-parsely' );

		return implode( ' ', $parts );
	}
}
