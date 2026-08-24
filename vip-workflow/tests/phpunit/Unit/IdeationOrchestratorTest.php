<?php
/**
 * Tests for the ideation orchestrator.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use ReflectionMethod;
use VIPWorkflow\Abilities\Availability;
use VIPWorkflow\Abilities\Destination;
use VIPWorkflow\Abilities\Requirement;
use VIPWorkflow\Abilities\RequirementGroup;
use VIPWorkflow\API\AvailabilitySerializer;
use VIPWorkflow\Ideation\Assistants\IdeationOrchestrator;

require_once __DIR__ . '/../../../includes/integrations/class-guideline-context-provider.php';
require_once __DIR__ . '/../../../includes/ideation/assistants/class-ideation-orchestrator.php';

/**
 * The runtime availability gate keeps its shape assertions here, and the
 * register-selection assertions in the integration suite: both gates run against
 * a `VIPWorkflow\Abilities\Ability`, which extends core's `WP_Ability` and so
 * cannot be instantiated without a booted WordPress. What *is* provable here is
 * the persisted shape — the contract that no rendered sentence is stored — and
 * that reading meta written before the structured contract neither fatals nor
 * invents an availability payload.
 *
 * @covers \VIPWorkflow\Ideation\Assistants\IdeationOrchestrator
 * @covers \VIPWorkflow\API\AvailabilitySerializer::to_persistable
 */
class IdeationOrchestratorTest extends TestCase {

	private const ADMIN_REASON = 'Tavily is not connected.';

	private const USER_MESSAGE = 'Web research is unavailable until an administrator connects it.';

	private const ADMIN_URL = 'https://example.test/wp-admin/options-connectors.php';

	/**
	 * Hand back whatever `$wpdb` was, so a stub cannot leak into a later test.
	 *
	 * @var mixed
	 */
	private $original_wpdb;

	protected function set_up() {
		parent::set_up();

		$this->original_wpdb = $GLOBALS['wpdb'] ?? null;
	}

	protected function tear_down() {
		$GLOBALS['wpdb'] = $this->original_wpdb;

		parent::tear_down();
	}

	public function test_brand_context_preserves_full_gutenberg_guideline_packet(): void {
		$long_guidelines = str_repeat( 'Use precise language. ', 30 ) . 'Keep this final instruction.';

		Functions\when( 'post_type_exists' )->justReturn( true );
		Functions\when( 'wp_guideline_scopes' )->justReturn(
			array( 'copy' => array( 'title' => 'Copy', 'order' => 20 ) )
		);
		Functions\when( 'get_posts' )->justReturn(
			array(
				$this->create_mock_post(
					array(
						'post_type'    => 'wp_knowledge',
						'post_status'  => 'publish',
						'post_name'    => 'guideline-copy',
						'post_content' => $long_guidelines,
					)
				),
			)
		);

		$method = new ReflectionMethod( IdeationOrchestrator::class, 'get_brand_context' );

		$context = $method->invoke( new IdeationOrchestrator(), 'story seed' );

		$this->assertCount( 1, $context );
		$this->assertSame( 'Content Guidelines', $context[0]['title'] );
		$this->assertStringContainsString( 'Keep this final instruction.', $context[0]['content'] );
		$this->assertGreaterThan( 500, strlen( $context[0]['content'] ) );
	}

	/**
	 * A requirement carrying both registers and a live admin destination.
	 *
	 * @param  string $id      Stable requirement identity.
	 * @param  array  $sources Source labels.
	 * @return Requirement
	 */
	private function make_requirement( string $id, array $sources ): Requirement {
		return new Requirement(
			$id,
			Requirement::KIND_MISSING_CREDENTIAL,
			self::ADMIN_REASON,
			self::USER_MESSAGE,
			Destination::admin_url( self::ADMIN_URL, 'Settings → Connectors' ),
			$sources
		);
	}

	public function test_persisted_requirements_carry_identity_kind_and_sources(): void {
		$availability = Availability::unmet(
			RequirementGroup::any(
				$this->make_requirement( 'credential:tavily', array( 'Web Images (Tavily)' ) ),
				$this->make_requirement( 'credential:youtube', array( 'YouTube Videos' ) )
			)
		);

		$this->assertSame(
			array(
				array(
					'satisfy'      => RequirementGroup::SATISFY_ANY,
					'requirements' => array(
						array(
							'id'      => 'credential:tavily',
							'kind'    => Requirement::KIND_MISSING_CREDENTIAL,
							'sources' => array( 'Web Images (Tavily)' ),
						),
						array(
							'id'      => 'credential:youtube',
							'kind'    => Requirement::KIND_MISSING_CREDENTIAL,
							'sources' => array( 'YouTube Videos' ),
						),
					),
				),
			),
			AvailabilitySerializer::to_persistable( $availability )
		);
	}

	public function test_persisted_requirements_contain_no_rendered_sentence_or_destination(): void {
		$availability = Availability::unmet(
			RequirementGroup::all( $this->make_requirement( 'credential:tavily', array( 'Web Researcher' ) ) )
		);

		$encoded = (string) json_encode( AvailabilitySerializer::to_persistable( $availability ) );

		$this->assertStringNotContainsString( self::ADMIN_REASON, $encoded );
		$this->assertStringNotContainsString( self::USER_MESSAGE, $encoded );
		$this->assertStringNotContainsString( '/wp-admin/', $encoded );
	}

	public function test_bare_bool_false_persists_an_empty_requirement_set(): void {
		$this->assertSame( array(), AvailabilitySerializer::to_persistable( Availability::unmet() ) );
	}

	/**
	 * Install a $wpdb double returning the given per-assistant meta rows.
	 *
	 * @param array<string, array> $rows Assistant id => stored result.
	 */
	private function stub_assistant_meta_rows( array $rows ): void {
		$results = array();
		foreach ( $rows as $assistant_id => $data ) {
			$results[] = (object) array(
				'meta_key'   => '_vip_ideation_asst_' . str_replace( '/', '__', $assistant_id ),
				'meta_value' => (string) json_encode( $data ),
			);
		}

		global $wpdb;
		$wpdb = new class( $results ) {
			public string $postmeta = 'wp_postmeta';

			public function __construct( private array $results ) {}

			public function prepare( string $query, ...$args ): string {
				return $query;
			}

			public function esc_like( string $text ): string {
				return $text;
			}

			public function get_results( string $query ): array {
				return $this->results;
			}
		};
	}

	/**
	 * Invoke the private assistants-map reader.
	 *
	 * @return array<string, array>
	 */
	private function read_assistant_meta(): array {
		$method = new ReflectionMethod( IdeationOrchestrator::class, 'get_all_assistant_meta' );

		return $method->invoke( new IdeationOrchestrator(), 42 );
	}

	public function test_stored_result_for_a_deactivated_agent_keeps_its_stored_values(): void {
		// Meta written before the structured contract existed, for an agent whose
		// plugin is no longer active. With no live ability to read availability
		// from, nothing may be re-rendered for it and nothing may fatal on it.
		Functions\when( 'wp_get_abilities' )->justReturn( array() );

		$this->stub_assistant_meta_rows(
			array(
				'vip-workflow/web-researcher' => array(
					'status' => 'unavailable',
					'error'  => 'Research agent is not configured.',
				),
			)
		);

		$assistants = $this->read_assistant_meta();

		$this->assertSame( 'unavailable', $assistants['vip-workflow/web-researcher']['status'] );
		$this->assertSame(
			'Research agent is not configured.',
			$assistants['vip-workflow/web-researcher']['error']
		);
	}

	public function test_a_deactivated_agent_is_named_from_its_id_rather_than_rendering_the_id(): void {
		// The header iterates the stored map, so every entry needs a name. This one
		// has no live ability to ask and is not the analyst, and the id is the only
		// thing left — but `workflow-discovery-foresight/foresight-research` in a
		// status row is a leaked internal identifier, not a label.
		Functions\when( 'wp_get_abilities' )->justReturn( array() );

		$this->stub_assistant_meta_rows(
			array(
				'workflow-discovery-foresight/foresight-research' => array( 'status' => 'completed' ),
			)
		);

		$assistants = $this->read_assistant_meta();

		$this->assertSame(
			'Foresight Research',
			$assistants['workflow-discovery-foresight/foresight-research']['label']
		);
	}

	public function test_the_seed_analyst_is_named_although_it_is_no_registered_ability(): void {
		// The analyst is invoked directly, never registered, so the abilities
		// registry cannot name it and the client has no way to derive it either.
		Functions\when( 'wp_get_abilities' )->justReturn( array() );

		$this->stub_assistant_meta_rows(
			array( 'vip-workflow/seed-analyst' => array( 'status' => 'completed' ) )
		);

		$assistants = $this->read_assistant_meta();

		$this->assertSame( 'Seed Analyst', $assistants['vip-workflow/seed-analyst']['label'] );
	}

	public function test_every_stored_assistant_carries_a_label(): void {
		Functions\when( 'wp_get_abilities' )->justReturn( array() );

		$this->stub_assistant_meta_rows(
			array(
				'vip-workflow/seed-analyst'    => array( 'status' => 'completed' ),
				'vip-workflow/media_scout'     => array( 'status' => 'completed' ),
				'workflow-assistant-hackernews/hackernews' => array( 'status' => 'failed' ),
			)
		);

		foreach ( $this->read_assistant_meta() as $assistant_id => $data ) {
			$this->assertArrayHasKey( 'label', $data, $assistant_id );
			$this->assertNotSame( $assistant_id, $data['label'] );
			$this->assertStringNotContainsString( '/', $data['label'] );
		}
	}

	public function test_stored_requirements_get_no_payload_when_the_agent_is_no_longer_registered(): void {
		Functions\when( 'wp_get_abilities' )->justReturn( array() );

		$stored = array(
			'status'       => 'unavailable',
			'error'        => 'Research agent is not configured.',
			'requirements' => array(
				array(
					'satisfy'      => RequirementGroup::SATISFY_ALL,
					'requirements' => array(
						array(
							'id'      => 'credential:tavily',
							'kind'    => Requirement::KIND_MISSING_CREDENTIAL,
							'sources' => array( 'Web Researcher' ),
						),
					),
				),
			),
		);

		$this->stub_assistant_meta_rows( array( 'vip-workflow/web-researcher' => $stored ) );

		$assistants = $this->read_assistant_meta();

		// The stored identity stands as the record of what failed; with the agent
		// gone there is no live source to phrase either register from. The label is
		// resolved regardless, because the row still has to be named.
		$actual = $assistants['vip-workflow/web-researcher'];
		unset( $actual['label'] );

		$this->assertSame( $stored, $actual );
		$this->assertArrayNotHasKey( 'availability', $assistants['vip-workflow/web-researcher'] );
	}
}
