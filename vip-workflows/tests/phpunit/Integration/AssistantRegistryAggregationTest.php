<?php
/**
 * Requirement aggregation on the Agents surface, driven by real abilities.
 *
 * Lives in the integration suite because `AssistantRegistry` only reads the
 * structured availability channel from a `VIPWorkflows\Abilities\Ability`, and
 * `Ability` extends core's `WP_Ability`, which does not exist in the unit suite.
 * The unit counterpart (tests/phpunit/Unit/AssistantRegistryTest.php) proves the
 * aggregation mechanics through discovery providers; only here can the
 * ability-side branch be exercised at all.
 *
 * These assertions run against the plugin's real Web Researcher and Media Scout
 * registrations on a clean test database — no credentials configured — which is
 * exactly the fresh-install state the feature exists to explain.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\Requirement;
use VIPWorkflows\Abilities\RequirementGroup;
use VIPWorkflows\Assistants\AssistantRegistry;
use VIPWorkflows\Ideation\Assistants\MediaScout;
use VIPWorkflows\Ideation\Assistants\WebResearcher;

class AssistantRegistryAggregationTest extends TestCase
{
    /**
     * How many times the counting ability's availability callback has run.
     *
     * @var int
     */
    public static int $availability_calls = 0;

    /**
     * Register the two research agents this test needs.
     *
     * The plugin registers them only when the `ideation` experiment is enabled,
     * which it is not on a clean test database. Abilities can only be registered
     * while `wp_abilities_api_init` is running, so the hook is fired again with
     * every other listener detached — WP_UnitTestCase restores `$wp_filter`
     * afterwards. Registration is global and outlives the test, hence the guard.
     */
    public function set_up(): void
    {
        parent::set_up();

        // Force the registry to initialize before re-firing its init hook, so the
        // plugin's own listener runs exactly once.
        $registered = array_map(
            static function ( $ability ): string {
                return $ability->get_name();
            },
            wp_get_abilities()
        );

        remove_all_actions( 'wp_abilities_api_init' );
        add_action(
            'wp_abilities_api_init',
            static function () use ( $registered ): void {
                // `wp_get_ability()` warns on a miss, so membership is tested
                // against the registered set instead.
                if ( ! in_array( 'vip-workflows/web-researcher', $registered, true ) ) {
                    WebResearcher::register_ability();
                }
                if ( ! in_array( 'vip-workflows/media-scout', $registered, true ) ) {
                    MediaScout::register_ability();
                }
                if ( ! in_array( 'test-plugin/counting-agent', $registered, true ) ) {
                    self::register_counting_ability();
                }
            }
        );
        do_action( 'wp_abilities_api_init' );
    }

    /**
     * An ability whose availability callback records how often it is consulted.
     *
     * Registered through `vip_workflows_register_ability()` so it is a real
     * `VIPWorkflows\Abilities\Ability` — the only kind whose structured
     * availability channel `AssistantRegistry` reads.
     */
    private static function register_counting_ability(): void
    {
        vip_workflows_register_ability(
            'test-plugin/counting-agent',
            array(
                'label'               => 'Counting Agent',
                'description'         => 'Counts availability callback invocations.',
                'category'            => 'research',
                'input_schema'        => array(
                    'type'       => 'object',
                    'properties' => array( 'seed' => array( 'type' => 'string' ) ),
                ),
                'execute_callback'    => static function (): array {
                    return array();
                },
                'permission_callback' => static function (): bool {
                    return true;
                },
                'meta'                => array(
                    'type'                  => 'research',
                    'availability_callback' => static function (): bool {
                        ++self::$availability_calls;
                        return false;
                    },
                ),
            )
        );
    }

    /**
     * One registry read must consult each availability callback exactly once.
     *
     * Asking an ability for `is_available()` and `get_availability()` separately
     * runs the registered callback twice — wasteful, and the two answers can
     * disagree when a callback is not perfectly idempotent (a remote probe, a
     * counter, anything with a side effect).
     */
    public function test_availability_callback_runs_once_per_registry_read(): void
    {
        self::$availability_calls = 0;

        $entry = $this->entry_for_ability( 'test-plugin/counting-agent' );

        $this->assertSame( 1, self::$availability_calls, 'The availability callback must be consulted exactly once per read.' );
        $this->assertSame(
            $entry['availability']->is_available(),
            $entry['available'],
            'Both keys must be derived from the same resolved result.'
        );
        $this->assertFalse( $entry['available'] );
    }

    /**
     * Find the auto-generated entry carrying the given ability id.
     *
     * @param string $ability_id Ability id.
     * @return array
     */
    private function entry_for_ability( string $ability_id ): array
    {
        foreach ( AssistantRegistry::get_instance()->get_all() as $entry ) {
            if ( in_array( $ability_id, $entry['ability_ids'], true ) ) {
                return $entry;
            }
        }

        $this->fail( sprintf( 'No assistant entry carries the ability "%s".', $ability_id ) );
    }

    public function test_ability_availability_reaches_the_entry(): void
    {
        $entry = $this->entry_for_ability( 'vip-workflows/web-researcher' );

        // No Tavily credential on a clean test database.
        $this->assertFalse( $entry['available'] );
        $this->assertSame( AssistantRegistry::AVAILABILITY_UNAVAILABLE, $entry['availability_state'] );
        $this->assertFalse( $entry['availability']->is_available() );

        $requirements = $entry['availability']->get_requirements();
        $this->assertCount( 1, $requirements );
        $this->assertSame( 'credential:tavily', $requirements[0]->get_id() );
        $this->assertSame( Requirement::KIND_MISSING_CREDENTIAL, $requirements[0]->get_kind() );
        $this->assertSame( array( 'Web Researcher' ), $requirements[0]->get_sources() );
    }

    public function test_source_attribution_names_the_contributing_ability(): void
    {
        $entry = $this->entry_for_ability( 'vip-workflows/web-researcher' );

        $this->assertSame(
            array(
                array(
                    'type'      => 'ability',
                    'id'        => 'vip-workflows/web-researcher',
                    'label'     => 'Web Researcher',
                    'available' => false,
                ),
            ),
            $entry['availability_sources']
        );
    }

    public function test_any_group_survives_aggregation_with_its_satisfy_mode(): void
    {
        $entry = $this->entry_for_ability( 'vip-workflows/media-scout' );

        $groups = $entry['availability']->get_groups();

        $this->assertCount( 1, $groups );
        $this->assertSame(
            RequirementGroup::SATISFY_ANY,
            $groups[0]->get_satisfy(),
            'Media Scout is an OR across media providers; flattening it to "all" would render three hard blockers.'
        );
    }

    public function test_two_media_providers_sharing_one_credential_collapse_to_one_row(): void
    {
        $entry = $this->entry_for_ability( 'vip-workflows/media-scout' );

        $tavily = array_values(
            array_filter(
                $entry['availability']->get_requirements(),
                static function ( Requirement $requirement ): bool {
                    return 'credential:tavily' === $requirement->get_id();
                }
            )
        );

        $this->assertCount( 1, $tavily, 'The Tavily image and video providers must share a single requirement row.' );
        $this->assertSame(
            array( 'Web Images (Tavily)', 'Web Videos (Tavily)' ),
            $tavily[0]->get_sources()
        );
    }
}
