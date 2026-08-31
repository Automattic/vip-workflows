<?php
/**
 * AssistantRegistry unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Abilities\AbilitySettings;
use VIPWorkflows\Abilities\Availability;
use VIPWorkflows\Abilities\Destination;
use VIPWorkflows\Abilities\Requirement;
use VIPWorkflows\Abilities\RequirementGroup;
use VIPWorkflows\Assistants\AssistantRegistry;
use VIPWorkflows\Discovery\DiscoveryProviderRegistry;

class AssistantRegistryTest extends TestCase
{
	protected function setUp(): void
	{
		parent::setUp();

		Functions\when( 'get_option' )->justReturn( array() );

		// Defined for every test so the provider-only cases below do not depend on
		// whether an earlier test happened to define it.
		Functions\when( 'wp_get_abilities' )->justReturn( array() );

		AbilitySettings::get_instance()->clear_cache();
		$this->reset_singleton( AssistantRegistry::class );
		$this->reset_singleton( DiscoveryProviderRegistry::class );
	}

	public function test_stage_eligible_ability_is_available_in_ai_stage(): void
	{
		Functions\when( 'wp_get_abilities' )->justReturn(
			array(
				$this->create_ability_stub(
					'workflow-agent-fact-check/fact-check',
					'vip-workflows',
					array(
						'supports'       => array( 'workflow', 'stage' ),
						'stage_eligible' => true,
						'icon'           => 'yes',
					)
				),
			)
		);

		$entries = AssistantRegistry::get_instance()->get_all();

		$this->assertCount( 1, $entries );
		$this->assertSame( 'workflow-agent-fact-check-fact-check', $entries[0]['slug'] );
		$this->assertSame( array( 'stage' ), $entries[0]['capabilities'] );
		$this->assertTrue( $entries[0]['available_in_ai_stage'] );
		$this->assertSame( array( 'workflow-agent-fact-check/fact-check' ), $entries[0]['ability_ids'] );
		$this->assert_available_with_no_requirements( $entries[0] );
	}

	public function test_research_only_ability_is_not_available_in_ai_stage(): void
	{
		Functions\when( 'wp_get_abilities' )->justReturn(
			array(
				$this->create_ability_stub(
					'workflow-agent-hackernews/hackernews',
					'research',
					array( 'type' => 'research' )
				),
			)
		);

		$entries = AssistantRegistry::get_instance()->get_all();

		$this->assertCount( 1, $entries );
		$this->assertSame( array( 'research' ), $entries[0]['capabilities'] );
		$this->assertFalse( $entries[0]['available_in_ai_stage'] );
		$this->assert_available_with_no_requirements( $entries[0] );
	}

	public function test_manifest_cannot_claim_stage_without_stage_eligible_ability(): void
	{
		Functions\when( 'wp_get_abilities' )->justReturn(
			array(
				$this->create_ability_stub(
					'workflow-agent-fact-check/fact-check',
					'vip-workflows',
					array(
						'supports'       => array( 'workflow' ),
						'stage_eligible' => false,
					)
				),
			)
		);

		$registry = AssistantRegistry::get_instance();
		$registry->register(
			'workflow-agent-fact-check',
			array(
				'label'        => 'Fact Check',
				'description'  => 'Checks factual claims.',
				'ability_ids'  => array( 'workflow-agent-fact-check/fact-check' ),
				'capabilities' => array( 'stage' ),
			)
		);

		$this->assertSame( array(), $registry->get_all() );
	}

	public function test_combined_research_and_stage_ability_reports_both_capabilities(): void
	{
		Functions\when( 'wp_get_abilities' )->justReturn(
			array(
				$this->create_ability_stub(
					'workflow-agent-combined/combined',
					'research',
					array(
						'type'           => 'research',
						'supports'       => array( 'workflow', 'stage' ),
						'stage_eligible' => true,
					)
				),
			)
		);

		$entries = AssistantRegistry::get_instance()->get_all();

		$this->assertCount( 1, $entries );
		$this->assertContains( 'research', $entries[0]['capabilities'] );
		$this->assertContains( 'stage', $entries[0]['capabilities'] );
		$this->assertTrue( $entries[0]['available_in_ai_stage'] );
		$this->assert_available_with_no_requirements( $entries[0] );
	}

	public function test_manifest_capabilities_are_consumed_when_backed_by_valid_sources(): void
	{
		Functions\when( 'wp_get_abilities' )->justReturn(
			array(
				$this->create_ability_stub(
					'workflow-agent-combined/combined',
					'research',
					array(
						'type'           => 'research',
						'supports'       => array( 'workflow', 'stage' ),
						'stage_eligible' => true,
					)
				),
			)
		);

		$registry = AssistantRegistry::get_instance();
		$registry->register(
			'workflow-agent-combined',
			array(
				'label'        => 'Combined',
				'description'  => 'Combined agent.',
				'ability_ids'  => array( 'workflow-agent-combined/combined' ),
				'capabilities' => array( 'stage', 'research', 'unsupported' ),
			)
		);

		$entries = $registry->get_all();

		$this->assertCount( 1, $entries );
		$this->assertSame( array( 'stage', 'research' ), $entries[0]['capabilities'] );
		$this->assert_available_with_no_requirements( $entries[0] );
	}

	public function test_core_stage_only_ability_is_not_auto_exposed_until_migrated(): void
	{
		Functions\when( 'wp_get_abilities' )->justReturn(
			array(
				$this->create_ability_stub(
					'vip-workflows/internal-stage-agent',
					'vip-workflows',
					array(
						'supports'       => array( 'workflow', 'stage' ),
						'stage_eligible' => true,
					)
				),
			)
		);

		$this->assertSame( array(), AssistantRegistry::get_instance()->get_all() );
	}

	public function test_availability_callback_on_a_non_vip_ability_warns(): void
	{
		// Registered through core's wp_register_ability() rather than the plugin
		// wrapper, so ability_class is unset and the callback is never consulted.
		Functions\expect( '_doing_it_wrong' )->once();

		Functions\when( 'wp_get_abilities' )->justReturn(
			array(
				$this->create_ability_stub(
					'workflow-agent-hackernews/hackernews',
					'research',
					array( 'availability_callback' => '__return_false' )
				),
			)
		);

		$entries = AssistantRegistry::get_instance()->get_all();

		// Diagnostic only — the entry is still collected, and still reports
		// available, exactly as it did before the warning existed.
		$this->assertCount( 1, $entries );
		$this->assertTrue( $entries[0]['available'] );

		// The structured channel does not invent a requirement for a callback the
		// ability class never received, so the card falls back to the generic copy.
		$this->assert_available_with_no_requirements( $entries[0] );
	}

	public function test_mis_registration_is_reported_once_per_request(): void
	{
		// get_all() runs on every Agents-page load and every /assistants request,
		// and several times over one settings save. Re-reporting the same
		// registration bug each time buries it in copies of itself.
		Functions\expect( '_doing_it_wrong' )->once();

		Functions\when( 'wp_get_abilities' )->justReturn(
			array(
				$this->create_ability_stub(
					'workflow-agent-hackernews/hackernews',
					'research',
					array( 'availability_callback' => '__return_false' )
				),
			)
		);

		$registry = AssistantRegistry::get_instance();

		$this->assertCount( 1, $registry->get_all() );
		$this->assertCount( 1, $registry->get_all() );
		$this->assertCount( 1, $registry->get_all() );
	}

	public function test_each_mis_registered_ability_is_reported_on_its_own(): void
	{
		// Once *per ability*, not once overall: silencing the second bug because
		// the first was already reported would hide it entirely.
		Functions\expect( '_doing_it_wrong' )->twice();

		Functions\when( 'wp_get_abilities' )->justReturn(
			array(
				$this->create_ability_stub(
					'workflow-agent-hackernews/hackernews',
					'research',
					array( 'availability_callback' => '__return_false' )
				),
				$this->create_ability_stub(
					'workflow-agent-wikipedia/wikipedia',
					'research',
					array( 'availability_callback' => '__return_false' )
				),
			)
		);

		$registry = AssistantRegistry::get_instance();

		$this->assertCount( 2, $registry->get_all() );
		$this->assertCount( 2, $registry->get_all() );
	}

	public function test_ability_without_availability_callback_does_not_warn(): void
	{
		Functions\expect( '_doing_it_wrong' )->never();

		Functions\when( 'wp_get_abilities' )->justReturn(
			array(
				$this->create_ability_stub(
					'workflow-agent-hackernews/hackernews',
					'research',
					array( 'icon' => 'search' )
				),
			)
		);

		$entries = AssistantRegistry::get_instance()->get_all();

		$this->assertCount( 1, $entries );
		$this->assert_available_with_no_requirements( $entries[0] );
	}

	public function test_two_abilities_from_one_plugin_get_distinct_slugs(): void
	{
		// Both core research agents share the vendor prefix "vip-workflows". While
		// the slug was derived from that prefix alone they collided, so get() and
		// update_settings() addressed whichever came first — saving one card wrote
		// to the other's ability, and no card could re-check itself.
		Functions\when( 'wp_get_abilities' )->justReturn(
			array(
				$this->create_ability_stub( 'test-plugin/web-researcher', 'research', array() ),
				$this->create_ability_stub( 'test-plugin/media-scout', 'research', array() ),
			)
		);

		$registry = AssistantRegistry::get_instance();
		$entries  = $registry->get_all();
		$slugs    = array_column( $entries, 'slug' );

		$this->assertCount( 2, $entries );
		$this->assertSame( $slugs, array_unique( $slugs ), 'Each ability needs its own addressable slug.' );

		// Each slug must resolve back to its own ability, not to a sibling.
		foreach ( $entries as $entry ) {
			$resolved = $registry->get( $entry['slug'] );

			$this->assertNotNull( $resolved );
			$this->assertSame( $entry['ability_ids'], $resolved['ability_ids'] );
		}
	}

	public function test_a_manifest_colliding_with_an_unclaimed_provider_warns(): void
	{
		// Manifests are keyed by slug, so two of them cannot collide. What can is a
		// manifest declaring a slug that matches a provider it forgot to claim —
		// the provider then generates its own entry under the same slug. Only the
		// first is reachable: get() and therefore update_settings() resolve to it,
		// so writes aimed at the other land on the wrong agent.
		Functions\expect( '_doing_it_wrong' )->once();

		Functions\when( 'wp_get_abilities' )->justReturn(
			array(
				$this->create_ability_stub( 'test-plugin/alpha', 'research', array() ),
			)
		);

		$this->register_provider( 'test-plugin' );

		$registry = AssistantRegistry::get_instance();
		$registry->register(
			'test-plugin',
			array(
				'label'       => 'Test Plugin',
				'ability_ids' => array( 'test-plugin/alpha' ),
				// 'provider_slugs' omitted on purpose — that is the mistake.
			)
		);

		$entries = $registry->get_all();

		// Diagnostic only: both entries are still returned, because refusing to
		// render the Agents page would be worse than rendering a duplicate.
		$this->assertSame(
			array( 'test-plugin', 'test-plugin' ),
			array_column( $entries, 'slug' )
		);
	}

	public function test_a_duplicate_slug_warns_once_per_request(): void
	{
		// get_all() runs on every Agents-page load, every /assistants request and
		// several times per settings save; an unguarded notice would storm.
		Functions\expect( '_doing_it_wrong' )->once();

		Functions\when( 'wp_get_abilities' )->justReturn(
			array(
				$this->create_ability_stub( 'test-plugin/alpha', 'research', array() ),
			)
		);

		$this->register_provider( 'test-plugin' );

		$registry = AssistantRegistry::get_instance();
		$registry->register(
			'test-plugin',
			array(
				'label'       => 'Test Plugin',
				'ability_ids' => array( 'test-plugin/alpha' ),
			)
		);

		$registry->get_all();
		$registry->get_all();
		$registry->get_all();
	}

	public function test_a_manifest_that_claims_its_provider_does_not_warn(): void
	{
		// The same plugin, wired correctly: claiming the provider folds it into the
		// one card instead of generating a second entry.
		Functions\expect( '_doing_it_wrong' )->never();

		Functions\when( 'wp_get_abilities' )->justReturn(
			array(
				$this->create_ability_stub( 'test-plugin/alpha', 'research', array() ),
			)
		);

		$this->register_provider( 'test-plugin' );

		$registry = AssistantRegistry::get_instance();
		$registry->register(
			'test-plugin',
			array(
				'label'          => 'Test Plugin',
				'ability_ids'    => array( 'test-plugin/alpha' ),
				'provider_slugs' => array( 'test-plugin' ),
			)
		);

		$this->assertCount( 1, $registry->get_all() );
	}

	public function test_unique_slugs_do_not_warn(): void
	{
		Functions\expect( '_doing_it_wrong' )->never();

		Functions\when( 'wp_get_abilities' )->justReturn(
			array(
				$this->create_ability_stub( 'plugin-one/alpha', 'research', array() ),
				$this->create_ability_stub( 'plugin-two/beta', 'research', array() ),
			)
		);

		$this->assertCount( 2, AssistantRegistry::get_instance()->get_all() );
	}

	public function test_manifest_claimed_entries_keep_their_declared_slug(): void
	{
		// Grouping several abilities onto one card is what a manifest is for, so a
		// declared slug must survive the derivation change untouched.
		Functions\when( 'wp_get_abilities' )->justReturn(
			array(
				$this->create_ability_stub( 'test-plugin/alpha', 'research', array() ),
				$this->create_ability_stub( 'test-plugin/beta', 'research', array() ),
			)
		);

		$registry = AssistantRegistry::get_instance();
		$registry->register(
			'test-plugin',
			array(
				'label'       => 'Test Plugin',
				'ability_ids' => array( 'test-plugin/alpha', 'test-plugin/beta' ),
			)
		);

		$entries = $registry->get_all();

		$this->assertCount( 1, $entries );
		$this->assertSame( 'test-plugin', $entries[0]['slug'] );
		$this->assertSame(
			array( 'test-plugin/alpha', 'test-plugin/beta' ),
			$entries[0]['ability_ids']
		);
	}

	// ── Requirement aggregation ───────────────────────────────────────────
	//
	// Aggregation is exercised through discovery providers rather than
	// abilities: `Ability` extends core's `WP_Ability`, which does not exist in
	// the unit suite, so `collect_agent_abilities()`'s `instanceof Ability`
	// branch can never be true here and an ability stub can only ever
	// contribute the bool channel. The ability-side and cross-registry cases
	// are proven against real `Ability` objects in
	// tests/phpunit/Integration/AssistantRegistryAggregationTest.php.

	public function test_all_available_sources_yield_no_requirements(): void
	{
		$this->register_provider( 'always-on', static fn() => true );
		$this->register_provider( 'no-callback' );

		$registry = AssistantRegistry::get_instance();
		$this->register_manifest( $registry, array( 'always-on', 'no-callback' ) );

		$entries = $registry->get_all();

		$this->assertCount( 1, $entries );
		$this->assert_available_with_no_requirements( $entries[0] );
	}

	public function test_bare_bool_false_source_is_unavailable_with_no_requirements(): void
	{
		$this->register_provider( 'legacy-bool', static fn() => false );

		$entries = AssistantRegistry::get_instance()->get_all();

		$this->assertCount( 1, $entries );
		$this->assertFalse( $entries[0]['available'] );
		$this->assertSame( AssistantRegistry::AVAILABILITY_UNAVAILABLE, $entries[0]['availability_state'] );

		// Generic-copy case: unavailable, but nothing to name.
		$this->assertFalse( $entries[0]['availability']->is_available() );
		$this->assertSame( array(), $entries[0]['availability']->get_requirements() );
	}

	public function test_source_returning_bare_true_contributes_nothing(): void
	{
		$this->register_provider( 'satisfied', static fn() => true );

		$entries = AssistantRegistry::get_instance()->get_all();

		$this->assertCount( 1, $entries );
		$this->assert_available_with_no_requirements( $entries[0] );
	}

	public function test_two_sources_sharing_one_requirement_id_collapse_to_one_row(): void
	{
		// The Foresight shape: one underlying requirement, emitted with the same
		// id from two capabilities on the same card.
		$this->register_provider(
			'foresight-discovery',
			static fn() => Availability::unmet(
				RequirementGroup::all( self::make_requirement( 'settings:foresight-news', array( 'Foresight Discovery' ) ) )
			)
		);
		$this->register_provider(
			'foresight-research',
			static fn() => Availability::unmet(
				RequirementGroup::all( self::make_requirement( 'settings:foresight-news', array( 'Foresight Research' ) ) )
			)
		);

		$registry = AssistantRegistry::get_instance();
		$this->register_manifest( $registry, array( 'foresight-discovery', 'foresight-research' ) );

		$entries = $registry->get_all();

		$this->assertCount( 1, $entries );
		$this->assertFalse( $entries[0]['available'] );

		$availability = $entries[0]['availability'];
		$this->assertCount( 1, $availability->get_groups() );

		$requirements = $availability->get_requirements();
		$this->assertCount( 1, $requirements );
		$this->assertSame( 'settings:foresight-news', $requirements[0]->get_id() );
		$this->assertSame(
			array( 'Foresight Discovery', 'Foresight Research' ),
			$requirements[0]->get_sources()
		);
	}

	public function test_any_group_survives_aggregation_with_its_satisfy_mode(): void
	{
		$this->register_provider(
			'media-scout',
			static fn() => Availability::unmet(
				RequirementGroup::any(
					self::make_requirement( 'credential:tavily', array( 'Tavily Images' ) ),
					self::make_requirement( 'credential:youtube', array( 'YouTube' ) )
				)
			)
		);

		$entries = AssistantRegistry::get_instance()->get_all();

		$groups = $entries[0]['availability']->get_groups();

		$this->assertCount( 1, $groups );
		$this->assertSame( RequirementGroup::SATISFY_ANY, $groups[0]->get_satisfy() );
		$this->assertCount( 2, $groups[0]->get_requirements() );
	}

	public function test_requirements_repeated_inside_one_any_group_collapse_without_flattening_it(): void
	{
		// Media Scout's live shape: the Tavily image and Tavily video providers
		// both name `credential:tavily` inside a single `any` group.
		$this->register_provider(
			'media-scout',
			static fn() => Availability::unmet(
				RequirementGroup::any(
					self::make_requirement( 'credential:tavily', array( 'Tavily Images' ) ),
					self::make_requirement( 'credential:tavily', array( 'Tavily Videos' ) ),
					self::make_requirement( 'credential:youtube', array( 'YouTube' ) )
				)
			)
		);

		$entries = AssistantRegistry::get_instance()->get_all();

		$groups = $entries[0]['availability']->get_groups();
		$this->assertCount( 1, $groups );
		$this->assertSame( RequirementGroup::SATISFY_ANY, $groups[0]->get_satisfy() );

		$requirements = $groups[0]->get_requirements();
		$this->assertCount( 2, $requirements );
		$this->assertSame( 'credential:tavily', $requirements[0]->get_id() );
		$this->assertSame( array( 'Tavily Images', 'Tavily Videos' ), $requirements[0]->get_sources() );
		$this->assertSame( 'credential:youtube', $requirements[1]->get_id() );
	}

	public function test_conflicting_requirements_sharing_an_id_keep_both_and_warn(): void
	{
		// The id is the dedupe key, so two genuinely different requirements sharing
		// one used to collapse to whichever arrived first — silently discarding the
		// loser's destination, and telling the reader to fix one thing when two are
		// broken.
		Functions\expect( '_doing_it_wrong' )->once();

		$this->register_provider(
			'first',
			static fn() => Availability::unmet(
				RequirementGroup::all(
					new Requirement(
						'credential:shared',
						Requirement::KIND_MISSING_CREDENTIAL,
						'Alpha is not connected.',
						'Alpha is not connected.',
						Destination::none( 'Set ALPHA_KEY in wp-config.php.' ),
						array( 'Alpha' )
					)
				)
			)
		);
		$this->register_provider(
			'second',
			static fn() => Availability::unmet(
				RequirementGroup::all(
					new Requirement(
						'credential:shared',
						Requirement::KIND_DEPENDENCY,
						'Beta is not installed.',
						'Beta is not installed.',
						Destination::none( 'Install the Beta plugin.' ),
						array( 'Beta' )
					)
				)
			)
		);

		$registry = AssistantRegistry::get_instance();
		$this->register_manifest( $registry, array( 'first', 'second' ) );

		$requirements = $registry->get_all()[0]['availability']->get_requirements();

		$this->assertCount( 2, $requirements, 'A conflict must stay visible, not collapse.' );
		$this->assertSame(
			array( 'Set ALPHA_KEY in wp-config.php.', 'Install the Beta plugin.' ),
			array_map(
				static fn( Requirement $requirement ): string => $requirement->get_destination()->get_hint(),
				$requirements
			)
		);
	}

	public function test_repeated_id_with_a_matching_shape_still_collapses(): void
	{
		// The Foresight case must not regress: the same requirement from two
		// capabilities is one row naming both.
		Functions\expect( '_doing_it_wrong' )->never();

		$this->register_provider(
			'first',
			static fn() => Availability::unmet(
				RequirementGroup::all( self::make_requirement( 'settings:foresight-news', array( 'Discovery' ) ) )
			)
		);
		$this->register_provider(
			'second',
			static fn() => Availability::unmet(
				RequirementGroup::all( self::make_requirement( 'settings:foresight-news', array( 'Research' ) ) )
			)
		);

		$registry = AssistantRegistry::get_instance();
		$this->register_manifest( $registry, array( 'first', 'second' ) );

		$requirements = $registry->get_all()[0]['availability']->get_requirements();

		$this->assertCount( 1, $requirements );
		$this->assertSame( array( 'Discovery', 'Research' ), $requirements[0]->get_sources() );
	}

	public function test_identical_any_groups_collapse_regardless_of_member_order(): void
	{
		// Group membership is a set. While the signature joined ids in arrival
		// order, these two groups failed to collapse and the card rendered the same
		// "configure at least one of" choice twice.
		$this->register_provider(
			'images',
			static fn() => Availability::unmet(
				RequirementGroup::any(
					self::make_requirement( 'credential:tavily', array( 'Web Images' ) ),
					self::make_requirement( 'credential:youtube', array( 'Web Images' ) )
				)
			)
		);
		$this->register_provider(
			'videos',
			static fn() => Availability::unmet(
				RequirementGroup::any(
					self::make_requirement( 'credential:youtube', array( 'Web Videos' ) ),
					self::make_requirement( 'credential:tavily', array( 'Web Videos' ) )
				)
			)
		);

		$registry = AssistantRegistry::get_instance();
		$this->register_manifest( $registry, array( 'images', 'videos' ) );

		$groups = $registry->get_all()[0]['availability']->get_groups();

		$this->assertCount( 1, $groups, 'One choice, however its members were ordered.' );
		$this->assertSame( RequirementGroup::SATISFY_ANY, $groups[0]->get_satisfy() );
		$this->assertCount( 2, $groups[0]->get_requirements() );

		// Both sources are still attributed on the surviving rows.
		foreach ( $groups[0]->get_requirements() as $requirement ) {
			$this->assertSame( array( 'Web Images', 'Web Videos' ), $requirement->get_sources() );
		}
	}

	public function test_groups_with_different_members_are_not_collapsed(): void
	{
		$this->register_provider(
			'images',
			static fn() => Availability::unmet(
				RequirementGroup::any(
					self::make_requirement( 'credential:tavily', array( 'Web Images' ) ),
					self::make_requirement( 'credential:youtube', array( 'Web Images' ) )
				)
			)
		);
		$this->register_provider(
			'videos',
			static fn() => Availability::unmet(
				RequirementGroup::any(
					self::make_requirement( 'credential:tavily', array( 'Web Videos' ) ),
					self::make_requirement( 'credential:vimeo', array( 'Web Videos' ) )
				)
			)
		);

		$registry = AssistantRegistry::get_instance();
		$this->register_manifest( $registry, array( 'images', 'videos' ) );

		$this->assertCount( 2, $registry->get_all()[0]['availability']->get_groups() );
	}

	public function test_partial_availability_is_distinguishable_from_wholly_unavailable(): void
	{
		$this->register_provider( 'discovery-works', static fn() => true );
		$this->register_provider(
			'research-broken',
			static fn() => Availability::unmet(
				RequirementGroup::all( self::make_requirement( 'credential:tavily', array( 'Research' ) ) )
			)
		);

		$registry = AssistantRegistry::get_instance();
		$this->register_manifest( $registry, array( 'discovery-works', 'research-broken' ) );

		$entries = $registry->get_all();

		$this->assertCount( 1, $entries );
		$this->assertFalse( $entries[0]['available'] );
		$this->assertSame( AssistantRegistry::AVAILABILITY_PARTIAL, $entries[0]['availability_state'] );
		$this->assertSame(
			array(
				array( 'type' => 'provider', 'id' => 'discovery-works', 'label' => 'Test Provider', 'available' => true ),
				array( 'type' => 'provider', 'id' => 'research-broken', 'label' => 'Test Provider', 'available' => false ),
			),
			$entries[0]['availability_sources']
		);
	}

	public function test_every_source_unavailable_reports_wholly_unavailable(): void
	{
		$this->register_provider(
			'research-broken',
			static fn() => Availability::unmet(
				RequirementGroup::all( self::make_requirement( 'credential:tavily', array( 'Research' ) ) )
			)
		);
		$this->register_provider( 'discovery-broken', static fn() => false );

		$registry = AssistantRegistry::get_instance();
		$this->register_manifest( $registry, array( 'research-broken', 'discovery-broken' ) );

		$entries = $registry->get_all();

		$this->assertCount( 1, $entries );
		$this->assertSame( AssistantRegistry::AVAILABILITY_UNAVAILABLE, $entries[0]['availability_state'] );
		$this->assertCount( 1, $entries[0]['availability']->get_requirements() );
	}

	public function test_bool_ability_and_structured_provider_aggregate_together(): void
	{
		Functions\when( 'wp_get_abilities' )->justReturn(
			array(
				$this->create_ability_stub(
					'workflow-discovery-foresight/research',
					'research',
					array( 'icon' => 'search' )
				),
			)
		);

		$this->register_provider(
			'foresight-discovery',
			static fn() => Availability::unmet(
				RequirementGroup::all( self::make_requirement( 'settings:foresight-news', array( 'Foresight News' ) ) )
			)
		);

		$registry = AssistantRegistry::get_instance();
		$registry->register(
			'workflow-discovery-foresight',
			array(
				'label'          => 'Foresight News',
				'ability_ids'    => array( 'workflow-discovery-foresight/research' ),
				'provider_slugs' => array( 'foresight-discovery' ),
			)
		);

		$entries = $registry->get_all();

		$this->assertCount( 1, $entries );
		$this->assertFalse( $entries[0]['available'] );
		$this->assertSame( AssistantRegistry::AVAILABILITY_PARTIAL, $entries[0]['availability_state'] );

		$requirements = $entries[0]['availability']->get_requirements();
		$this->assertCount( 1, $requirements );
		$this->assertSame( 'settings:foresight-news', $requirements[0]->get_id() );

		$this->assertSame(
			array( 'ability', 'provider' ),
			array_column( $entries[0]['availability_sources'], 'type' )
		);
	}

	public function test_entry_with_no_abilities_and_no_providers_is_permissively_available(): void
	{
		// Unreachable through get_all() — a manifest matching nothing is skipped —
		// so the permissive default is pinned directly on the builder.
		$registry = AssistantRegistry::get_instance();
		$method   = new \ReflectionMethod( AssistantRegistry::class, 'build_entry' );

		$entry = $method->invoke(
			$registry,
			'empty',
			array(
				'slug'            => 'empty',
				'label'           => 'Empty',
				'description'     => '',
				'icon'            => '',
				'ability_ids'     => array(),
				'provider_slugs'  => array(),
				'capabilities'    => array(),
				'settings_schema' => array(),
			),
			array(),
			array()
		);

		$this->assertTrue( $entry['available'] );
		$this->assertSame( array(), $entry['availability_sources'] );
		$this->assert_available_with_no_requirements( $entry );
	}

	/**
	 * Assert the entry is available and names nothing unmet.
	 *
	 * @param array $entry Assistant entry.
	 */
	private function assert_available_with_no_requirements( array $entry ): void
	{
		$this->assertTrue( $entry['available'] );
		$this->assertSame( AssistantRegistry::AVAILABILITY_AVAILABLE, $entry['availability_state'] );
		$this->assertTrue( $entry['availability']->is_available() );
		$this->assertSame( array(), $entry['availability']->get_groups() );
		$this->assertSame( array(), $entry['availability']->get_requirements() );
	}

	/**
	 * Register a minimally-valid discovery provider.
	 *
	 * @param string $slug     Provider slug.
	 * @param mixed  $callback Availability callback, or null for none.
	 */
	private function register_provider( string $slug, $callback = null ): void
	{
		$args = array(
			'label'     => 'Test Provider',
			'features'  => array( 'recommend' ),
			'callbacks' => array(
				'recommend' => static fn() => array(),
				'seed'      => static fn() => array(),
			),
		);

		if ( null !== $callback ) {
			$args['availability_callback'] = $callback;
		}

		DiscoveryProviderRegistry::get_instance()->register( $slug, $args );
	}

	/**
	 * Register a manifest grouping the given provider slugs onto one card.
	 *
	 * @param AssistantRegistry $registry       Registry instance.
	 * @param string[]          $provider_slugs Provider slugs to claim.
	 */
	private function register_manifest( AssistantRegistry $registry, array $provider_slugs ): void
	{
		$registry->register(
			'grouped',
			array(
				'label'          => 'Grouped Agent',
				'provider_slugs' => $provider_slugs,
			)
		);
	}

	/**
	 * Build an unmet requirement with a fixed id and source attribution.
	 *
	 * @param string   $id      Stable requirement identity.
	 * @param string[] $sources Labels needing it.
	 */
	private static function make_requirement( string $id, array $sources ): Requirement
	{
		return new Requirement(
			$id,
			Requirement::KIND_MISSING_CREDENTIAL,
			'Not connected.',
			'Not connected. Ask an administrator.',
			Destination::none( 'Set the constant in wp-config.php.' ),
			$sources
		);
	}

	private function reset_singleton( string $class_name ): void
	{
		$property = new \ReflectionProperty( $class_name, 'instance' );
		$property->setValue( null, null );
	}

	private function create_ability_stub( string $name, string $category, array $meta ): object
	{
		return new class( $name, $category, $meta ) {
			public function __construct(
				private string $name,
				private string $category,
				private array $meta
			) {}

			public function get_category(): string
			{
				return $this->category;
			}

			public function get_name(): string
			{
				return $this->name;
			}

			public function get_label(): string
			{
				return $this->name;
			}

			public function get_description(): string
			{
				return 'Test ability';
			}

			public function get_meta(): array
			{
				return $this->meta;
			}
		};
	}
}
