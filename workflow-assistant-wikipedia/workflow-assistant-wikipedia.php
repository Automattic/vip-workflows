<?php
/**
 * Plugin Name: Workflow Assistant: Wikipedia
 * Description: Research assistant that searches Wikipedia for background context and reference material during ideation.
 * Version: 1.0.0
 * Author: WordPress VIP
 * Author URI: https://wpvip.com
 * Requires Plugins: vip-workflows
 * Text Domain: workflow-assistant-wikipedia
 *
 * @package WorkflowAssistantWikipedia
 */

declare( strict_types=1 );

namespace WorkflowAssistantWikipedia;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'wp_abilities_api_init', __NAMESPACE__ . '\register' );

/**
 * Register the Wikipedia assistant ability.
 */
function register(): void {
	if ( ! function_exists( 'vip_workflows_register_ability' ) ) {
		return;
	}

	vip_workflows_register_ability(
		'workflow-assistant-wikipedia/wikipedia',
		array(
			'label'               => __( 'Wikipedia', 'workflow-assistant-wikipedia' ),
			'description'         => __( 'Searches Wikipedia for background context, definitions, and reference material.', 'workflow-assistant-wikipedia' ),
			'category'            => 'research',
			'input_schema'        => array(
				'type'       => 'object',
				'properties' => array(
					'seed'          => array( 'type' => 'string' ),
					'seed_analysis' => array( 'type' => 'object' ),
					'project_id'    => array( 'type' => 'integer' ),
					'query'         => array( 'type' => 'string' ),
					'brand_context' => array( 'type' => 'array' ),
				),
				'required'   => array( 'seed' ),
			),
			'output_schema'       => array(
				'type'       => 'object',
				'properties' => array(
					'cards'   => array( 'type' => 'array' ),
					'summary' => array( 'type' => 'string' ),
				),
			),
			'execute_callback'    => __NAMESPACE__ . '\execute',
			'permission_callback' => function () {
				return current_user_can( 'edit_posts' );
			},
			'meta'                => array(
				'type'                => 'research',
				'display_order'       => 40,
				'show_in_rest'        => true,
				'show_in_commands'    => false,
				'transition_eligible' => false,
				'icon'                => 'page',
				'thinking_message'    => __( 'Searching Wikipedia...', 'workflow-assistant-wikipedia' ),
				'success_message'     => __( 'Wikipedia search complete.', 'workflow-assistant-wikipedia' ),
			),
		)
	);
}

/**
 * Execute Wikipedia search.
 *
 * Uses the MediaWiki API to search for articles and fetch extracts + thumbnails.
 *
 * @param array $input Input parameters.
 * @return array { cards: array, summary: string }
 */
function execute( array $input ): array {
	$query = $input['query'] ?? $input['seed'] ?? '';
	if ( empty( $query ) ) {
		return array(
			'cards' => array(),
			'summary' => 'No search query provided.',
		);
	}

	$is_manual_query = isset( $input['query'] );
	$search_terms    = $is_manual_query
		? array( $query )
		: build_search_terms( $query, $input['seed_analysis'] ?? array() );
	$all_cards       = array();

	foreach ( $search_terms as $term ) {
		$cards     = search_wikipedia( $term );
		$all_cards = array_merge( $all_cards, $cards );
	}

	$all_cards = deduplicate_cards( $all_cards );
	$all_cards = array_slice( $all_cards, 0, 12 );

	return array(
		'cards'   => $all_cards,
		'summary' => sprintf( 'Found %d Wikipedia articles for background context.', count( $all_cards ) ),
	);
}

/**
 * Build a list of search terms from the seed and analysis.
 *
 * @param string $seed     Raw seed text.
 * @param array  $analysis Seed analysis with entities, topics, etc.
 * @return string[]
 */
function build_search_terms( string $seed, array $analysis ): array {
	$terms = array();

	foreach ( $analysis['search_queries'] ?? array() as $query ) {
		if ( ! empty( $query ) ) {
			$terms[] = $query;
		}
	}

	$entities = $analysis['entities'] ?? array();
	foreach ( $entities as $group ) {
		if ( ! is_array( $group ) ) {
			continue;
		}
		foreach ( $group as $name ) {
			if ( ! empty( $name ) && ! in_array( $name, $terms, true ) ) {
				$terms[] = $name;
			}
		}
	}

	if ( empty( $terms ) ) {
		$terms[] = $seed;
	}

	return array_slice( $terms, 0, 5 );
}

/**
 * Search Wikipedia and return cards.
 *
 * @param string $term Search term.
 * @return array Cards array.
 */
function search_wikipedia( string $term ): array {
	$search_url = add_query_arg(
		array(
			'action'   => 'query',
			'list'     => 'search',
			'srsearch' => $term,
			'srlimit'  => 5,
			'srprop'   => 'snippet|titlesnippet',
			'format'   => 'json',
			'origin'   => '*',
		),
		'https://en.wikipedia.org/w/api.php'
	);

	// phpcs:ignore WordPressVIPMinimum.Performance.RemoteRequestTimeout.timeout_timeout -- editor-initiated ideation assistant request expected to take time.
	$response = wp_remote_get( $search_url, array( 'timeout' => 10 ) );
	if ( is_wp_error( $response ) ) {
		return array();
	}

	$body = json_decode( wp_remote_retrieve_body( $response ), true );
	$results = $body['query']['search'] ?? array();

	if ( empty( $results ) ) {
		return array();
	}

	$page_ids = array_column( $results, 'pageid' );

	return fetch_page_details( $page_ids );
}

/**
 * Fetch page extracts and thumbnails from Wikipedia.
 *
 * @param int[] $page_ids Wikipedia page IDs.
 * @return array Cards array.
 */
function fetch_page_details( array $page_ids ): array {
	if ( empty( $page_ids ) ) {
		return array();
	}

	$details_url = add_query_arg(
		array(
			'action'      => 'query',
			'pageids'     => implode( '|', $page_ids ),
			'prop'        => 'extracts|pageimages|info',
			'exintro'     => '1',
			'explaintext' => '1',
			'exsentences' => 3,
			'piprop'      => 'thumbnail',
			'pithumbsize' => 400,
			'inprop'      => 'url',
			'format'      => 'json',
			'origin'      => '*',
		),
		'https://en.wikipedia.org/w/api.php'
	);

	// phpcs:ignore WordPressVIPMinimum.Performance.RemoteRequestTimeout.timeout_timeout -- editor-initiated ideation assistant request expected to take time.
	$response = wp_remote_get( $details_url, array( 'timeout' => 10 ) );
	if ( is_wp_error( $response ) ) {
		return array();
	}

	$body  = json_decode( wp_remote_retrieve_body( $response ), true );
	$pages = $body['query']['pages'] ?? array();
	$cards = array();

	foreach ( $pages as $page ) {
		if ( isset( $page['missing'] ) ) {
			continue;
		}

		$cards[] = array(
			'type'        => 'article',
			'source_type' => 'article',
			'origin'      => 'wikipedia',
			'title'       => $page['title'] ?? '',
			'url'         => $page['fullurl'] ?? ( 'https://en.wikipedia.org/wiki/' . rawurlencode( str_replace( ' ', '_', $page['title'] ?? '' ) ) ),
			'excerpt'     => $page['extract'] ?? '',
			'domain'      => 'en.wikipedia.org',
			'image'       => $page['thumbnail']['source'] ?? null,
			'author'      => 'Wikipedia',
			'source'      => 'wikipedia',
		);
	}

	return $cards;
}

/**
 * Remove duplicate cards by URL.
 *
 * @param array $cards Cards array.
 * @return array Deduplicated cards.
 */
function deduplicate_cards( array $cards ): array {
	$seen = array();
	$unique = array();

	foreach ( $cards as $card ) {
		$key = $card['url'] ?? '';
		if ( empty( $key ) || isset( $seen[ $key ] ) ) {
			continue;
		}
		$seen[ $key ] = true;
		$unique[]     = $card;
	}

	return $unique;
}
