<?php
/**
 * The `in_card` availability destination, and the cross-source dedupe path it
 * enables.
 *
 * Both used to be exercised only by requiring the real
 * workflow-discovery-foresight extension plugin directly — the sole in-repo
 * producer of an `in_card` destination, and of one availability callback
 * shared by a discovery provider and a research ability (the shape that makes
 * one requirement id arrive twice for a single card, which is the
 * cross-source dedupe path in AssistantRegistry::aggregate_availability()).
 * Without a test, both were guaranteed only structurally, by inspection.
 *
 * Foresight now lives in an external extension plugin. Coupling core's suite
 * to that extension would make coverage of
 * core's own contract depend on that repo staying in sync — so this exercises
 * the same two paths against a minimal fixture defined right here instead: a
 * synthetic availability callback, and a synthetic provider + ability pair
 * built to the same shape Foresight was, standing in for any extension that
 * needs a missing-credential requirement answered on the card itself rather
 * than by a link.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Fixtures\InCardSource {

	use VIPWorkflow\Abilities\Availability;
	use VIPWorkflow\Abilities\RequirementFactory;
	use VIPWorkflow\Abilities\RequirementGroup;

	/**
	 * Option the fixture stores its one credential in.
	 */
	const OPTION_KEY = 'vip_workflow_tests_in_card_fixture';

	/**
	 * Ability id the fixture registers, mirroring a real research assistant.
	 */
	const ABILITY_ID = 'vip-workflow-tests/in-card-fixture';

	/**
	 * Whether the fixture's one credential is set.
	 */
	function is_configured(): bool {
		$options = get_option( OPTION_KEY, array() );

		return is_array( $options ) && '' !== trim( (string) ( $options['token'] ?? '' ) );
	}

	/**
	 * The availability callback shared by the provider and the ability below.
	 *
	 * Same shape as a real in-card requirement: no destination URL, because
	 * the fields to fix it live on the card itself, and a credentials URL
	 * pointing at the third party the credential comes from.
	 */
	function check_availability(): bool|Availability {
		if ( is_configured() ) {
			return true;
		}

		return Availability::unmet(
			RequirementGroup::all(
				RequirementFactory::in_card(
					'settings:in-card-fixture',
					'Fixture sign-in details are missing. Add the token below.',
					'Fixture source is not connected. Ask an administrator to add its token.',
					'Complete the token field below.',
					array( 'In-Card Fixture' ),
					'https://example.test/in-card-fixture'
				)
			)
		);
	}

	/**
	 * Register a discovery provider pointing at check_availability(), mirroring
	 * how a real source registers.
	 *
	 * @param \VIPWorkflow\Discovery\DiscoveryProviderRegistry $registry Discovery provider registry.
	 */
	function register_provider( $registry ): void {
		$registry->register(
			'in-card-fixture',
			array(
				'label'                 => 'In-Card Fixture',
				'description'           => 'Test fixture for the in_card availability destination.',
				'icon'                  => 'admin-generic',
				'features'              => array( 'recommend' ),
				'callbacks'             => array(
					'recommend' => __NAMESPACE__ . '\get_recommendations',
					'seed'      => __NAMESPACE__ . '\generate_seed',
				),
				'availability_callback' => __NAMESPACE__ . '\check_availability',
			)
		);
	}

	/**
	 * A no-op recommend callback; nothing here calls it.
	 */
	function get_recommendations(): array {
		return array();
	}

	/**
	 * A no-op seed callback; nothing here calls it.
	 *
	 * DiscoveryProviderRegistry::register() requires a callable `seed`
	 * callback unconditionally, regardless of declared features.
	 */
	function generate_seed(): array {
		return array();
	}

	/**
	 * Register a research ability pointing at the *same* check_availability(),
	 * mirroring how a real source's provider and ability share one identity.
	 */
	function register_ability(): void {
		if ( ! function_exists( 'vip_workflow_register_ability' ) ) {
			return;
		}

		vip_workflow_register_ability(
			ABILITY_ID,
			array(
				'label'               => 'In-Card Fixture',
				'description'         => 'Test fixture for the in_card availability destination.',
				'category'            => 'research',
				'input_schema'        => array(
					'type'       => 'object',
					'properties' => array(
						'seed' => array( 'type' => 'string' ),
					),
					'required'   => array( 'seed' ),
				),
				'output_schema'       => array(
					'type'       => 'object',
					'properties' => array(
						'cards' => array( 'type' => 'array' ),
					),
				),
				'execute_callback'    => static function (): array {
					return array( 'cards' => array() );
				},
				'permission_callback' => static function (): bool {
					return current_user_can( 'edit_posts' );
				},
				'meta'                => array(
					'type'                  => 'research',
					'show_in_rest'          => true,
					'show_in_commands'      => false,
					'transition_eligible'   => false,
					'icon'                  => 'admin-generic',
					'availability_callback' => __NAMESPACE__ . '\check_availability',
				),
			)
		);
	}
}

namespace VIPWorkflow\Tests\Integration {

	use VIPWorkflow\Abilities\Availability;
	use VIPWorkflow\Abilities\Destination;
	use VIPWorkflow\Abilities\Requirement;
	use VIPWorkflow\Abilities\RequirementGroup;
	use VIPWorkflow\Discovery\DiscoveryProviderRegistry;

	use function VIPWorkflow\Tests\Fixtures\InCardSource\check_availability;
	use function VIPWorkflow\Tests\Fixtures\InCardSource\register_provider;

	use const VIPWorkflow\Tests\Fixtures\InCardSource\ABILITY_ID;
	use const VIPWorkflow\Tests\Fixtures\InCardSource\OPTION_KEY;

	class InCardAvailabilityTest extends TestCase {

		public function set_up(): void {
			parent::set_up();

			delete_option( OPTION_KEY );
		}

		public function tear_down(): void {
			delete_option( OPTION_KEY );

			parent::tear_down();
		}

		/**
		 * The single requirement from an unconfigured check.
		 */
		private function only_requirement(): Requirement {
			$result = check_availability();

			$this->assertInstanceOf(
				Availability::class,
				$result,
				'An unconfigured source must report structured requirements, not a bare bool.'
			);
			$this->assertFalse( $result->is_available() );

			$requirements = $result->get_requirements();
			$this->assertCount( 1, $requirements );

			return $requirements[0];
		}

		public function test_unconfigured_reports_an_in_card_requirement(): void {
			$requirement = $this->only_requirement();

			$this->assertSame( 'settings:in-card-fixture', $requirement->get_id() );
			$this->assertSame(
				Destination::KIND_IN_CARD,
				$requirement->get_destination()->get_kind(),
				'Fixture credentials are entered in the card\'s own settings fields, so a link would point away from the fix.'
			);
		}

		/**
		 * The in-card destination must not offer a *destination* link: there is
		 * nowhere to go to enter the values, the fields are already on screen.
		 */
		public function test_in_card_destination_carries_no_url(): void {
			$destination = $this->only_requirement()->get_destination();

			$this->assertSame( '', $destination->get_url() );
			$this->assertNotSame( '', $destination->get_hint() );
		}

		/**
		 * It does say where to *obtain* the credentials.
		 */
		public function test_the_requirement_names_where_to_obtain_the_credentials(): void {
			$destination = $this->only_requirement()->get_destination();

			$this->assertSame( 'https://example.test/in-card-fixture', $destination->get_credentials_url() );
			$this->assertStringStartsWith(
				'https://',
				$destination->get_credentials_url(),
				'The URL survives the destination protocol filter.'
			);
		}

		/**
		 * The editor register carries no sign-up link.
		 */
		public function test_the_editor_register_carries_no_credentials_url(): void {
			$payload = $this->only_requirement()->to_array( Requirement::REGISTER_USER );

			$this->assertArrayNotHasKey( 'destination', $payload );
			$this->assertStringNotContainsString( 'example.test', (string) wp_json_encode( $payload ) );
		}

		public function test_the_group_requires_its_single_member(): void {
			$result = check_availability();
			$groups = $result->get_groups();

			$this->assertCount( 1, $groups );
			$this->assertSame( RequirementGroup::SATISFY_ALL, $groups[0]->get_satisfy() );
		}

		public function test_the_editor_register_names_no_screen(): void {
			$requirement = $this->only_requirement();

			$this->assertStringNotContainsString( '/wp-admin/', $requirement->get_user_message() );
			$this->assertNotSame( '', $requirement->get_user_message() );
		}

		public function test_configured_reports_a_bare_true(): void {
			update_option( OPTION_KEY, array( 'token' => 'a-token' ) );

			$this->assertTrue(
				check_availability(),
				'A satisfied check returns bare true so no consumer has to re-derive satisfaction.'
			);
		}

		/**
		 * @dataProvider provide_partial_configurations
		 *
		 * @param array $config Stored option value.
		 */
		public function test_a_partial_configuration_is_still_unconfigured( array $config ): void {
			update_option( OPTION_KEY, $config );

			$this->assertInstanceOf( Availability::class, check_availability() );
		}

		public static function provide_partial_configurations(): array {
			return array(
				'empty token' => array( array( 'token' => '' ) ),
				'no token key' => array( array() ),
			);
		}

		/**
		 * Both surfaces must register the *same* callback.
		 *
		 * That shared identity is what makes one requirement id arrive twice for
		 * a single card, which is the cross-source dedupe path in
		 * AssistantRegistry::aggregate_availability(). Registering two
		 * equivalent copies would still work here but would stop exercising it.
		 */
		public function test_provider_and_ability_share_one_availability_callback(): void {
			$registry = DiscoveryProviderRegistry::get_instance();
			register_provider( $registry );

			$provider = $registry->get( 'in-card-fixture' );
			$this->assertNotNull( $provider, 'The provider must register before its callback can be compared.' );

			$ability_meta = $this->fixture_ability_meta();

			$this->assertSame(
				$provider['availability_callback'],
				$ability_meta['availability_callback'] ?? null,
				'The provider and the ability must point at one callback so their requirement ids collide by construction.'
			);
			$this->assertSame(
				'VIPWorkflow\Tests\Fixtures\InCardSource\check_availability',
				$provider['availability_callback']
			);
		}

		/**
		 * Meta of the registered fixture ability.
		 *
		 * `vip_workflow_register_ability()` only functions while
		 * `wp_abilities_api_init` is running, so the hook is fired again with
		 * other listeners detached — WP_UnitTestCase restores `$wp_filter`
		 * afterwards. Registration is global and outlives the test, hence the
		 * guard.
		 *
		 * @return array
		 */
		private function fixture_ability_meta(): array {
			$registered = array_map(
				static function ( $ability ): string {
					return $ability->get_name();
				},
				wp_get_abilities()
			);

			if ( ! in_array( ABILITY_ID, $registered, true ) ) {
				remove_all_actions( 'wp_abilities_api_init' );
				add_action( 'wp_abilities_api_init', 'VIPWorkflow\Tests\Fixtures\InCardSource\register_ability' );
				do_action( 'wp_abilities_api_init' );
			}

			$ability = wp_get_ability( ABILITY_ID );

			$this->assertNotNull( $ability, 'The fixture ability must register before its callback can be compared.' );

			return $ability->get_meta();
		}
	}
}
