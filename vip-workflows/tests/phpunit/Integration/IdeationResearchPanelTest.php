<?php
/**
 * The ideation research panel's endpoint.
 *
 * Integration rather than unit because almost every claim here is a claim about
 * stored state: which cards come back is decided by the `vip_ideation_sources`
 * table joined against two JSON meta lists, and `get_ideation()` builds its
 * orchestrator itself rather than taking one, so there is no seam to mock. A
 * unit test would assert that we call `get_state()` the way we think we do,
 * which is not the question — the question is what the sidebar ends up showing.
 *
 * Two of the behaviours below look like bugs until you know they are not, and
 * both are pinned here on purpose: a project that has been deleted reads as "no
 * project" rather than erroring, and the discovery envelope is the only shape
 * the source is read from.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use ReflectionMethod;
use VIPWorkflow\API\WorkflowController;
use VIPWorkflow\Ideation\Research\IdeationPostTypes;
use WP_REST_Request;

/**
 * @covers \VIPWorkflow\API\WorkflowController::get_ideation
 * @covers \VIPWorkflow\API\WorkflowController::ideation_source
 * @covers \VIPWorkflow\API\WorkflowController::ideation_excerpt
 */
class IdeationResearchPanelTest extends TestCase {

	private const META_PROJECT   = '_vip_ideation_project_id';
	private const META_PROMPT    = '_vip_discovery_prompt';
	private const META_SEED      = '_vip_ideation_seed';
	private const META_PINNED    = '_vip_ideation_pinned_cards';
	private const META_DISMISSED = '_vip_ideation_dismissed_cards';

	private WorkflowController $controller;
	private string $table;
	private int $admin_id;
	private int $post_id;
	private int $project_id;

	public function set_up(): void {
		parent::set_up();

		global $wpdb;

		$this->controller = new WorkflowController();
		$this->table      = $wpdb->prefix . 'vip_ideation_sources';

		$this->admin_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->admin_id );

		$this->post_id = self::factory()->post->create(
			array( 'post_author' => $this->admin_id )
		);

		$this->project_id = self::factory()->post->create(
			array(
				'post_type'   => IdeationPostTypes::POST_TYPE,
				'post_title'  => 'Cycling desk, week 34',
				'post_author' => $this->admin_id,
			)
		);

		// phpcs:ignore WordPress.DB
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$this->table} WHERE project_id = %d", $this->project_id ) );
	}

	// ─── Helpers ─────────────────────────────────────────────────

	/**
	 * Point the post at the project created in set_up.
	 */
	private function link_project( ?int $project_id = null ): void {
		update_post_meta( $this->post_id, self::META_PROJECT, $project_id ?? $this->project_id );
	}

	/**
	 * Insert one row into the ideation sources table.
	 *
	 * Ordering matters to two of the tests below and the orchestrator reads the
	 * table `ORDER BY added_at ASC`, so `added_at` is stepped explicitly rather
	 * than left to land on whatever second the test happens to run in — several
	 * rows inserted in the same second would otherwise come back in an order
	 * MySQL is free to choose.
	 */
	private function insert_source( string $source_id, array $args = array() ): void {
		global $wpdb;

		static $sequence = 0;
		++$sequence;

		$wpdb->insert(
			$this->table,
			array(
				'project_id'    => $args['project_id'] ?? $this->project_id,
				'source_id'     => $source_id,
				'url'           => $args['url'] ?? 'https://example.test/' . $source_id,
				'title'         => $args['title'] ?? 'Story ' . $source_id,
				'domain'        => $args['domain'] ?? 'example.test',
				'excerpt'       => $args['excerpt'] ?? 'An excerpt for ' . $source_id,
				'content'       => $args['content'] ?? '',
				'source_type'   => $args['source_type'] ?? 'article',
				'origin'        => $args['origin'] ?? 'search',
				'attachment_id' => $args['attachment_id'] ?? null,
				'tags'          => $args['tags'] ?? null,
				'added_by'      => $this->admin_id,
				'added_at'      => gmdate( 'Y-m-d H:i:s', strtotime( '2026-08-01 00:00:00' ) + $sequence ),
				'updated_at'    => gmdate( 'Y-m-d H:i:s', strtotime( '2026-08-01 00:00:00' ) + $sequence ),
			)
		);
	}

	private function pin( string ...$source_ids ): void {
		update_post_meta( $this->project_id, self::META_PINNED, wp_json_encode( $source_ids ) );
	}

	private function dismiss( string ...$source_ids ): void {
		update_post_meta( $this->project_id, self::META_DISMISSED, wp_json_encode( $source_ids ) );
	}

	/**
	 * Call the endpoint the way the route does.
	 */
	private function get_ideation( ?int $post_id = null ): array {
		$request = new WP_REST_Request( 'GET', '/vip-workflow/v1/workflow/post/1/ideation' );
		$request->set_param( 'id', $post_id ?? $this->post_id );

		return $this->controller->get_ideation( $request )->get_data();
	}

	/**
	 * Reach the private source reader directly.
	 *
	 * The envelope cases below are about one function's reading of one meta
	 * value; routing them through the whole endpoint would only add noise.
	 */
	private function ideation_source(): ?array {
		$method = new ReflectionMethod( WorkflowController::class, 'ideation_source' );

		return $method->invoke( null, $this->project_id );
	}

	/**
	 * Reach the private excerpt reducer directly.
	 */
	private function ideation_excerpt( array $card ): string {
		$method = new ReflectionMethod( WorkflowController::class, 'ideation_excerpt' );

		return $method->invoke( null, $card );
	}

	// ─── Absence is not an error ─────────────────────────────────

	/**
	 * The common case by a wide margin: a post nobody ideated.
	 */
	public function test_a_post_with_no_project_returns_the_empty_payload(): void {
		$data = $this->get_ideation();

		$this->assertSame( 0, $data['project_id'] );
		$this->assertSame( array(), $data['items'] );
	}

	/**
	 * The meta outlives the project. A dangling pointer reads as absence on
	 * purpose — the post is still perfectly editable, and a red notice in the
	 * sidebar would be the panel complaining about something the writer can
	 * neither fix nor act on.
	 */
	public function test_a_deleted_project_reads_as_no_project(): void {
		$this->link_project();
		wp_delete_post( $this->project_id, true );

		$data = $this->get_ideation();

		$this->assertSame( 0, $data['project_id'] );
		$this->assertSame( array(), $data['items'] );
	}

	/**
	 * Same reasoning, different cause: the id resolves, but to something that is
	 * not an ideation project.
	 */
	public function test_a_project_of_the_wrong_post_type_reads_as_no_project(): void {
		$impostor = self::factory()->post->create( array( 'post_type' => 'page' ) );
		$this->link_project( $impostor );

		$data = $this->get_ideation();

		$this->assertSame( 0, $data['project_id'] );
		$this->assertSame( array(), $data['items'] );
	}

	// ─── Only what somebody chose ────────────────────────────────

	/**
	 * The selection rule the panel exists for. A project accumulates dozens of
	 * assistant-found cards nobody has ruled on; the sidebar shows the two
	 * kinds that carry intent and leaves the rest in the workspace.
	 */
	public function test_only_pinned_and_hand_added_cards_come_back(): void {
		$this->link_project();

		$this->insert_source( 'aaa1' );                              // Found, untouched.
		$this->insert_source( 'bbb2' );                              // Found, then pinned.
		$this->insert_source( 'ccc3', array( 'origin' => 'manual' ) ); // Added by hand.
		$this->pin( 'bbb2' );

		$ids = wp_list_pluck( $this->get_ideation()['items'], 'id' );

		$this->assertContains( 'bbb2', $ids );
		$this->assertContains( 'ccc3', $ids );
		$this->assertNotContains( 'aaa1', $ids, 'An assistant-found card nobody ruled on must stay in the workspace.' );
	}

	/**
	 * Dismissal beats the hand that added it. Without this, a source someone
	 * added and then explicitly threw away would reappear in the sidebar,
	 * because being manual is otherwise enough on its own.
	 */
	public function test_a_dismissed_hand_added_card_is_excluded(): void {
		$this->link_project();

		$this->insert_source( 'ccc3', array( 'origin' => 'manual' ) );
		$this->dismiss( 'ccc3' );

		$this->assertSame( array(), $this->get_ideation()['items'] );
	}

	/**
	 * Pinning is the one signal the desk gives about what mattered, so it is the
	 * one thing worth reordering for — and only that: within each group the
	 * order the cards were added in survives.
	 */
	public function test_pinned_cards_lead_and_insertion_order_holds_within_each_group(): void {
		$this->link_project();

		$this->insert_source( 'man1', array( 'origin' => 'manual' ) );
		$this->insert_source( 'pin1' );
		$this->insert_source( 'man2', array( 'origin' => 'manual' ) );
		$this->insert_source( 'pin2' );
		$this->pin( 'pin1', 'pin2' );

		$ids = wp_list_pluck( $this->get_ideation()['items'], 'id' );

		$this->assertSame( array( 'pin1', 'pin2', 'man1', 'man2' ), $ids );
	}

	/**
	 * An uploaded PDF is a source with a file behind it rather than a link, and
	 * the panel renders it differently.
	 */
	public function test_a_card_backed_by_an_upload_is_flagged_as_uploaded(): void {
		$this->link_project();

		$this->insert_source( 'up01', array( 'origin' => 'manual', 'attachment_id' => 4242 ) );

		$items = $this->get_ideation()['items'];

		$this->assertCount( 1, $items );
		$this->assertTrue( $items[0]['uploaded'] );
	}

	// ─── The article the project was seeded from ─────────────────

	/**
	 * The panel leads with this: the thing being written about, rather than one
	 * row among many.
	 */
	public function test_the_source_is_read_from_the_discovery_envelope(): void {
		update_post_meta(
			$this->project_id,
			self::META_PROMPT,
			wp_json_encode(
				array(
					'provider' => 'foresight',
					'prompt'   => array(
						'title'       => 'Tour riders threaten to strike',
						'url'         => 'https://cyclingnews.test/strike',
						'description' => 'Riders met on the rest day.',
					),
				)
			)
		);

		$source = $this->ideation_source();

		$this->assertSame( 'Tour riders threaten to strike', $source['title'] );
		$this->assertSame( 'https://cyclingnews.test/strike', $source['url'] );
		$this->assertSame( 'cyclingnews.test', $source['domain'] );
		$this->assertSame( 'foresight', $source['provider'] );
		$this->assertStringContainsString( 'rest day', $source['excerpt'] );
	}

	/**
	 * The envelope is the only shape this key has ever held.
	 *
	 * A bare item used to be accepted through a fallback justified by a comment
	 * claiming older projects stored it that way. They never did: the discovery
	 * controller is the key's only writer and has wrapped the item in
	 * `{ provider, prompt }` since the key was introduced. Malformed metadata
	 * now reads as no source and falls through to the seed rather than being
	 * coerced into one.
	 */
	public function test_a_bare_unenveloped_item_is_not_read_as_a_source(): void {
		update_post_meta(
			$this->project_id,
			self::META_PROMPT,
			wp_json_encode(
				array(
					'title' => 'Bare item, no envelope',
					'url'   => 'https://cyclingnews.test/bare',
				)
			)
		);
		update_post_meta( $this->project_id, self::META_SEED, 'What the desk typed' );

		$source = $this->ideation_source();

		$this->assertSame( 'What the desk typed', $source['title'] );
		$this->assertSame( '', $source['url'] );
	}

	/**
	 * Garbage in the meta takes the same route as a bare item: no source, not a
	 * fatal.
	 */
	public function test_unparseable_prompt_metadata_falls_through_to_the_seed(): void {
		update_post_meta( $this->project_id, self::META_PROMPT, 'not json at all' );
		update_post_meta( $this->project_id, self::META_SEED, 'What the desk typed' );

		$this->assertSame( 'What the desk typed', $this->ideation_source()['title'] );
	}

	/**
	 * A project started by hand has no discovery item. The typed seed is still
	 * what the work started from — it just has nothing to link to.
	 */
	public function test_a_hand_started_project_falls_back_to_its_seed(): void {
		update_post_meta( $this->project_id, self::META_SEED, 'Cyclocross season preview angles' );

		$source = $this->ideation_source();

		$this->assertSame( 'Cyclocross season preview angles', $source['title'] );
		$this->assertSame( '', $source['url'] );
		$this->assertSame( '', $source['provider'] );
	}

	/**
	 * Neither an item nor a seed means there is nothing to lead with, and the
	 * panel renders no source block at all.
	 */
	public function test_a_project_with_no_item_and_no_seed_has_no_source(): void {
		$this->assertNull( $this->ideation_source() );
	}

	// ─── Cards are not one shape ─────────────────────────────────

	/**
	 * A source has an excerpt; an insight card carries its content, or a list of
	 * tags or entities, and no excerpt at all. Each is reduced to one line so
	 * the panel can render a row per card without knowing what kind it is.
	 *
	 * @dataProvider provide_card_shapes
	 */
	public function test_the_excerpt_reduces_every_card_shape_to_a_line( array $card, string $expected ): void {
		$this->assertSame( $expected, $this->ideation_excerpt( $card ) );
	}

	public function provide_card_shapes(): array {
		return array(
			'an excerpt wins'            => array(
				array( 'excerpt' => 'The riders met.', 'content' => 'Ignored.' ),
				'The riders met.',
			),
			'content stands in'          => array(
				array( 'content' => 'The riders met.' ),
				'The riders met.',
			),
			'tags when there is no prose' => array(
				array( 'tags' => array( 'tour', 'strike' ) ),
				'tour, strike',
			),
			'entities as objects'        => array(
				array( 'entities' => array( array( 'name' => 'Pogacar' ), array( 'name' => 'Vingegaard' ) ) ),
				'Pogacar, Vingegaard',
			),
			'entities as bare strings'   => array(
				array( 'entities' => array( 'Pogacar', 'Vingegaard' ) ),
				'Pogacar, Vingegaard',
			),
			'nothing at all'             => array(
				array(),
				'',
			),
		);
	}

	/**
	 * Markup in a card's excerpt reaches a sidebar that renders text, so it is
	 * stripped rather than escaped downstream.
	 */
	public function test_the_excerpt_strips_markup(): void {
		$line = $this->ideation_excerpt( array( 'excerpt' => '<script>alert(1)</script>The riders met.' ) );

		$this->assertStringNotContainsString( '<script>', $line );
	}

	// ─── Who gets the way in ─────────────────────────────────────

	/**
	 * Editing the post is the right permission for reading the research — it is
	 * what the route checks. But the project belongs to whoever ideated, and the
	 * post may since have been handed to a writer who cannot open it, so the
	 * link out is withheld from someone who could not follow it.
	 */
	public function test_the_workspace_link_is_withheld_from_someone_who_could_not_open_it(): void {
		$this->link_project();

		$this->assertNotSame( '', $this->get_ideation()['url'], 'The project author can open it.' );

		$contributor = self::factory()->user->create( array( 'role' => 'contributor' ) );
		wp_update_post( array( 'ID' => $this->post_id, 'post_author' => $contributor ) );
		wp_set_current_user( $contributor );

		$this->assertSame( '', $this->get_ideation()['url'] );
	}

	/**
	 * The route exists, and it is gated on the post rather than on the project.
	 */
	public function test_the_route_is_registered_and_refuses_someone_who_cannot_edit_the_post(): void {
		$this->link_project();

		// `get_routes()` is keyed by pattern, not by any concrete request path.
		$this->assertArrayHasKey(
			'/vip-workflow/v1/workflow/post/(?P<id>[\\d]+)/ideation',
			rest_get_server()->get_routes()
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$response = rest_do_request(
			new WP_REST_Request( 'GET', '/vip-workflow/v1/workflow/post/' . $this->post_id . '/ideation' )
		);

		$this->assertSame( 403, $response->get_status() );
	}
}
