<?php
/**
 * Structured availability contract unit tests.
 *
 * Covers the value objects behind `Ability::get_availability()` — the
 * requirement/group/destination shapes, the legacy-return coercion matrix, the
 * admin-vs-user message registers, and the credential requirement factory.
 *
 * The `Ability`-level branch matrix itself lives in the integration suite, since
 * `Ability` extends core's `WP_Ability`, which only exists on a booted
 * WordPress. See tests/phpunit/Integration/AbilityAvailabilityTest.php.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\AI\ConnectorsCredentialBackend;
use VIPWorkflow\AI\Credentials;
use VIPWorkflow\AI\LegacyCredentialBackend;
use VIPWorkflow\Abilities\Availability;
use VIPWorkflow\Abilities\Destination;
use VIPWorkflow\Abilities\Requirement;
use VIPWorkflow\Abilities\RequirementFactory;
use VIPWorkflow\Abilities\RequirementGroup;

class AvailabilityTest extends TestCase
{
    protected function set_up()
    {
        parent::set_up();

        Functions\when( 'admin_url' )->alias(
            static function ( string $path = '' ): string {
                return 'https://example.test/wp-admin/' . $path;
            }
        );
    }

    protected function tear_down()
    {
        Credentials::get_instance()->set_backend( null );

        parent::tear_down();
    }

    /**
     * Install a credential backend so the factory resolves a known destination.
     *
     * Uses the real backend classes rather than doubles: whether an admin
     * credential screen exists is a property of which backend is active, so
     * swapping in the genuine classes is what actually exercises the branch.
     *
     * @param bool $connectors Whether the Connectors backend (and so its admin screen) is active.
     */
    private function use_backend( bool $connectors ): void
    {
        Credentials::get_instance()->set_backend(
            $connectors ? new ConnectorsCredentialBackend() : new LegacyCredentialBackend()
        );
    }

    private function make_requirement( string $id = 'credential:tavily', array $sources = array( 'Web Researcher' ) ): Requirement
    {
        return new Requirement(
            $id,
            Requirement::KIND_MISSING_CREDENTIAL,
            'Tavily is not connected.',
            'Web research is unavailable.',
            Destination::none( 'Set VIP_WORKFLOW_TAVILY_KEY.' ),
            $sources
        );
    }

    /* ---------------------------------------------------------------------
     * Legacy return coercion
     * ------------------------------------------------------------------ */

    public function test_true_return_is_available_with_no_requirements(): void
    {
        $availability = Availability::from_callback_return( true );

        $this->assertTrue( $availability->is_available() );
        $this->assertSame( array(), $availability->get_requirements() );
    }

    public function test_false_return_is_unavailable_with_no_requirements(): void
    {
        $availability = Availability::from_callback_return( false );

        $this->assertFalse( $availability->is_available() );
        $this->assertSame( array(), $availability->get_requirements() );
    }

    /**
     * Legacy callbacks return all sorts of truthy values; today they are cast to
     * bool, and that observable behavior must not change.
     *
     * @dataProvider provide_legacy_truthy_returns
     *
     * @param mixed $value Callback return value.
     */
    public function test_legacy_truthy_returns_stay_available( $value ): void
    {
        $availability = Availability::from_callback_return( $value );

        $this->assertTrue(
            $availability->is_available(),
            'A truthy non-Availability return must keep coercing to available.'
        );
        $this->assertSame( array(), $availability->get_requirements() );
    }

    public static function provide_legacy_truthy_returns(): array
    {
        return array(
            'integer one'   => array( 1 ),
            'string yes'    => array( 'yes' ),
            'non-empty array' => array( array( 'anything' ) ),
            'object'        => array( new \stdClass() ),
            'float'         => array( 1.0 ),
        );
    }

    /**
     * @dataProvider provide_legacy_falsy_returns
     *
     * @param mixed $value Callback return value.
     */
    public function test_legacy_falsy_returns_stay_unavailable( $value ): void
    {
        $availability = Availability::from_callback_return( $value );

        $this->assertFalse( $availability->is_available() );
        $this->assertSame( array(), $availability->get_requirements() );
    }

    public static function provide_legacy_falsy_returns(): array
    {
        return array(
            'null'         => array( null ),
            'zero'         => array( 0 ),
            'empty string' => array( '' ),
            'empty array'  => array( array() ),
        );
    }

    public function test_availability_instance_passes_through_unchanged(): void
    {
        $requirement = $this->make_requirement();
        $original    = Availability::unmet( RequirementGroup::all( $requirement ) );

        $this->assertSame( $original, Availability::from_callback_return( $original ) );
    }

    /* ---------------------------------------------------------------------
     * Near-miss returns fail closed
     *
     * A callback that reached for the structured shape and stopped short would
     * otherwise coerce to *truthy* and report the ability available with its
     * dependencies never checked. Failing closed is safe here and nowhere else,
     * because these types postdate the bool contract: no legacy callback can
     * produce one.
     * ------------------------------------------------------------------ */

    /**
     * @dataProvider provide_near_miss_returns
     *
     * @param callable $build Builds the near-miss return value.
     */
    public function test_near_miss_returns_are_unmet_and_warn( callable $build ): void
    {
        Functions\expect( '_doing_it_wrong' )->once();

        $availability = Availability::from_callback_return( $build( $this ) );

        $this->assertFalse(
            $availability->is_available(),
            'A near-miss return must not coerce to available with its dependencies unchecked.'
        );
        $this->assertSame( array(), $availability->get_requirements() );
    }

    public static function provide_near_miss_returns(): array
    {
        return array(
            'a bare group'         => array(
                static fn( self $test ) => RequirementGroup::all( $test->make_requirement() ),
            ),
            'a bare requirement'   => array(
                static fn( self $test ) => $test->make_requirement(),
            ),
            'an array of groups'   => array(
                static fn( self $test ) => array( RequirementGroup::all( $test->make_requirement() ) ),
            ),
            'an array of requirements' => array(
                static fn( self $test ) => array( $test->make_requirement() ),
            ),
        );
    }

    /**
     * @dataProvider provide_legacy_returns_that_must_stay_silent
     *
     * @param mixed $value Callback return value.
     */
    public function test_legacy_returns_emit_no_diagnostic( $value ): void
    {
        // The asymmetry is the point: these shapes are indistinguishable from a
        // callback written years before this contract, so warning about them would
        // punish code that is behaving exactly as documented.
        Functions\expect( '_doing_it_wrong' )->never();

        Availability::from_callback_return( $value );
    }

    public static function provide_legacy_returns_that_must_stay_silent(): array
    {
        return array(
            'true'                 => array( true ),
            'false'                => array( false ),
            'null'                 => array( null ),
            'integer'              => array( 1 ),
            'string'               => array( 'yes' ),
            'array of plain values' => array( array( 'anything', 2 ) ),
            'unrelated object'     => array( new \stdClass() ),
        );
    }

    /* ---------------------------------------------------------------------
     * Availability shape
     * ------------------------------------------------------------------ */

    public function test_unmet_without_groups_is_still_unavailable(): void
    {
        $availability = Availability::unmet();

        $this->assertFalse( $availability->is_available() );
        $this->assertSame( array(), $availability->get_requirements() );
    }

    public function test_unmet_reports_unavailable_and_exposes_requirements(): void
    {
        $requirement  = $this->make_requirement();
        $availability = Availability::unmet( RequirementGroup::all( $requirement ) );

        $this->assertFalse( $availability->is_available() );
        $this->assertCount( 1, $availability->get_requirements() );
        $this->assertSame( 'credential:tavily', $availability->get_requirements()[0]->get_id() );
    }

    public function test_get_requirements_flattens_across_groups(): void
    {
        $availability = Availability::unmet(
            RequirementGroup::all( $this->make_requirement( 'credential:tavily' ) ),
            RequirementGroup::any(
                $this->make_requirement( 'credential:youtube' ),
                $this->make_requirement( 'credential:vimeo' )
            )
        );

        $ids = array_map(
            static fn( Requirement $r ): string => $r->get_id(),
            $availability->get_requirements()
        );

        $this->assertSame(
            array( 'credential:tavily', 'credential:youtube', 'credential:vimeo' ),
            $ids
        );
    }

    public function test_any_group_records_its_satisfy_mode(): void
    {
        $group = RequirementGroup::any( $this->make_requirement() );

        $this->assertSame( RequirementGroup::SATISFY_ANY, $group->get_satisfy() );
    }

    public function test_all_group_records_its_satisfy_mode(): void
    {
        $group = RequirementGroup::all( $this->make_requirement() );

        $this->assertSame( RequirementGroup::SATISFY_ALL, $group->get_satisfy() );
    }

    /* ---------------------------------------------------------------------
     * Message registers
     * ------------------------------------------------------------------ */

    public function test_admin_register_carries_reason_and_destination(): void
    {
        $requirement = new Requirement(
            'credential:tavily',
            Requirement::KIND_MISSING_CREDENTIAL,
            'Tavily is not connected. Add its API key in Settings → Connectors.',
            'Web research is unavailable.',
            Destination::admin_url( 'https://example.test/wp-admin/options-connectors.php', 'Settings → Connectors' ),
            array( 'Web Researcher' )
        );

        $payload = $requirement->to_array( Requirement::REGISTER_ADMIN );

        $this->assertSame( 'Tavily is not connected. Add its API key in Settings → Connectors.', $payload['reason'] );
        $this->assertSame( Destination::KIND_ADMIN_URL, $payload['destination']['kind'] );
        $this->assertSame( 'https://example.test/wp-admin/options-connectors.php', $payload['destination']['url'] );
    }

    public function test_user_register_omits_destination_entirely(): void
    {
        $requirement = new Requirement(
            'credential:tavily',
            Requirement::KIND_MISSING_CREDENTIAL,
            'Tavily is not connected. Add its API key in Settings → Connectors.',
            'Web research is unavailable. Ask an administrator to connect a search provider.',
            Destination::admin_url( 'https://example.test/wp-admin/options-connectors.php', 'Settings → Connectors' ),
            array( 'Web Researcher' )
        );

        $payload = $requirement->to_array( Requirement::REGISTER_USER );

        $this->assertArrayNotHasKey( 'destination', $payload );
        $this->assertArrayNotHasKey( 'reason', $payload );
        $this->assertSame(
            'Web research is unavailable. Ask an administrator to connect a search provider.',
            $payload['message']
        );
    }

    public function test_user_register_payload_contains_no_admin_url_anywhere(): void
    {
        $availability = Availability::unmet(
            RequirementGroup::all(
                new Requirement(
                    'credential:tavily',
                    Requirement::KIND_MISSING_CREDENTIAL,
                    'Add its API key at https://example.test/wp-admin/options-connectors.php',
                    'Web research is unavailable.',
                    Destination::admin_url( 'https://example.test/wp-admin/options-connectors.php', 'Settings → Connectors' ),
                    array( 'Web Researcher' )
                )
            )
        );

        $encoded = wp_json_encode( $availability->to_array( Requirement::REGISTER_USER ) );

        $this->assertStringNotContainsString( '/wp-admin/', (string) $encoded );
    }

    public function test_admin_register_payload_preserves_group_satisfy_mode(): void
    {
        $availability = Availability::unmet(
            RequirementGroup::any(
                $this->make_requirement( 'credential:tavily' ),
                $this->make_requirement( 'credential:youtube' )
            )
        );

        $payload = $availability->to_array( Requirement::REGISTER_ADMIN );

        $this->assertFalse( $payload['available'] );
        $this->assertSame( RequirementGroup::SATISFY_ANY, $payload['groups'][0]['satisfy'] );
        $this->assertCount( 2, $payload['groups'][0]['requirements'] );
    }

    /* ---------------------------------------------------------------------
     * Source attribution (feeds registry-level dedupe)
     * ------------------------------------------------------------------ */

    public function test_with_sources_unions_without_duplicating(): void
    {
        $requirement = $this->make_requirement( 'credential:tavily', array( 'Web Researcher' ) );

        $merged = $requirement->with_sources( array( 'Media Scout', 'Web Researcher' ) );

        $this->assertSame(
            array( 'Web Researcher', 'Media Scout' ),
            $merged->get_sources(),
            'Sources union in first-seen order with no duplicates.'
        );
    }

    public function test_with_sources_returns_a_new_instance(): void
    {
        $requirement = $this->make_requirement( 'credential:tavily', array( 'Web Researcher' ) );

        $merged = $requirement->with_sources( array( 'Media Scout' ) );

        $this->assertNotSame( $requirement, $merged );
        $this->assertSame( array( 'Web Researcher' ), $requirement->get_sources() );
    }

    /* ---------------------------------------------------------------------
     * Destination kinds
     * ------------------------------------------------------------------ */

    public function test_none_destination_exposes_no_url(): void
    {
        $destination = Destination::none( 'Set VIP_WORKFLOW_TAVILY_KEY in wp-config.php.' );

        $this->assertSame( Destination::KIND_NONE, $destination->get_kind() );
        $this->assertSame( '', $destination->get_url() );
        $this->assertSame( 'Set VIP_WORKFLOW_TAVILY_KEY in wp-config.php.', $destination->get_hint() );
    }

    public function test_in_card_destination_exposes_no_url(): void
    {
        $destination = Destination::in_card( 'Complete the fields below.' );

        $this->assertSame( Destination::KIND_IN_CARD, $destination->get_kind() );
        $this->assertSame( '', $destination->get_url() );
    }

    /* ---------------------------------------------------------------------
     * The in-card credentials URL
     *
     * "Where do I enter this?" and "where do I get one?" are different
     * questions, and an in-card requirement is the case where the answers
     * differ: the fields are on screen, the account is not. So the credentials
     * URL must never be mistaken for the destination's own `url`, which is what
     * makes the renderer emit a "go here to fix it" anchor.
     * ------------------------------------------------------------------ */

    public function test_in_card_destination_omits_a_credentials_url_by_default(): void
    {
        $this->assertSame( '', Destination::in_card( 'Complete the fields below.' )->get_credentials_url() );
    }

    public function test_in_card_destination_carries_a_credentials_url_without_becoming_a_link_destination(): void
    {
        Functions\when( 'esc_url_raw' )->alias( array( $this, 'protocol_filter' ) );

        $destination = Destination::in_card( 'Complete the fields below.', 'https://foresightnews.com' );

        $this->assertSame( 'https://foresightnews.com', $destination->get_credentials_url() );
        $this->assertSame(
            '',
            $destination->get_url(),
            'A sign-up URL must not populate the destination url, which means "go here to fix it".'
        );
        $this->assertSame(
            Destination::KIND_IN_CARD,
            $destination->get_kind(),
            'The fields are still the place to type, so the kind must not change.'
        );
        $this->assertSame( 'Complete the fields below.', $destination->get_hint() );
    }

    public function test_in_card_credentials_url_drops_a_hostile_scheme_and_warns(): void
    {
        // Same threat model as the admin destination: an extension authors this
        // value and React puts it straight into an href.
        Functions\when( 'esc_url_raw' )->alias( array( $this, 'protocol_filter' ) );
        Functions\expect( '_doing_it_wrong' )->once();

        $destination = Destination::in_card(
            'Complete the fields below.',
            'javascript:alert(1)' // phpcs:ignore -- deliberately hostile input.
        );

        $this->assertSame( '', $destination->get_credentials_url() );
        $this->assertSame(
            'Complete the fields below.',
            $destination->get_hint(),
            'A rejected URL must leave the hint intact, so the row still says where to type.'
        );
    }

    public function test_in_card_does_not_warn_when_no_credentials_url_is_supplied(): void
    {
        Functions\when( 'esc_url_raw' )->alias( array( $this, 'protocol_filter' ) );
        Functions\expect( '_doing_it_wrong' )->never();

        Destination::in_card( 'Complete the fields below.' );
    }

    public function test_admin_and_none_destinations_expose_an_empty_credentials_url(): void
    {
        // The serialized shape is uniform, so consumers never branch on the key's
        // presence — only on its truthiness.
        Functions\when( 'esc_url_raw' )->alias( array( $this, 'protocol_filter' ) );

        $this->assertSame(
            '',
            Destination::admin_url( 'https://example.test/wp-admin/options-connectors.php', 'Settings → Connectors' )->get_credentials_url()
        );
        $this->assertSame( '', Destination::none( 'Set the constant.' )->get_credentials_url() );
    }

    /**
     * The user register drops the destination, and the credentials URL with it.
     *
     * Obtaining credentials means opening an account, and an editor has no screen
     * to store the result in — the card's settings fields are `manage_options`.
     * Pairing "ask an administrator" with a sign-up link would invite exactly that
     * dead end. Carrying the URL inside the destination is what makes this hold
     * automatically rather than needing a second rule.
     */
    public function test_user_register_omits_the_credentials_url_with_the_destination(): void
    {
        Functions\when( 'esc_url_raw' )->alias( array( $this, 'protocol_filter' ) );

        $availability = Availability::unmet(
            RequirementGroup::all(
                RequirementFactory::in_card(
                    'settings:foresight-news',
                    'Foresight News sign-in details are missing.',
                    'Foresight News is not connected. Ask an administrator to add its sign-in details.',
                    'Complete the email and password fields below.',
                    array( 'Foresight News' ),
                    'https://foresightnews.com'
                )
            )
        );

        $encoded = (string) wp_json_encode( $availability->to_array( Requirement::REGISTER_USER ) );

        $this->assertStringNotContainsString( 'foresightnews.com', $encoded );
        $this->assertStringNotContainsString( 'credentials_url', $encoded );

        $admin_requirement = $availability->to_array( Requirement::REGISTER_ADMIN )['groups'][0]['requirements'][0];

        $this->assertSame(
            'https://foresightnews.com',
            $admin_requirement['destination']['credentials_url'],
            'The administrator, who can act on it, does receive the link.'
        );
    }

    public function test_admin_destination_keeps_a_well_formed_url_intact(): void
    {
        // Query parameters must survive: an admin destination is routinely
        // `admin.php?page=…&tab=…`, and both consumers put the value in an href.
        Functions\when( 'esc_url_raw' )->alias( array( $this, 'protocol_filter' ) );

        $destination = Destination::admin_url(
            'https://example.test/wp-admin/admin.php?page=vip-workflow&tab=connectors',
            'Settings → Connectors'
        );

        $this->assertSame(
            'https://example.test/wp-admin/admin.php?page=vip-workflow&tab=connectors',
            $destination->get_url()
        );
    }

    public function test_admin_destination_drops_a_hostile_scheme_and_warns(): void
    {
        // Requirement authoring is a documented third-party surface and the React
        // renderer puts this value straight into an href, so a script URL must not
        // survive. The renderer needs a truthy url to emit a link, so dropping it
        // degrades to the hint path with no anchor.
        Functions\when( 'esc_url_raw' )->alias( array( $this, 'protocol_filter' ) );
        Functions\expect( '_doing_it_wrong' )->once();

        $destination = Destination::admin_url(
            'javascript:alert(1)', // phpcs:ignore -- deliberately hostile input.
            'Settings → Connectors',
            'Add its API key in Settings → Connectors.'
        );

        $this->assertSame( '', $destination->get_url() );
        $this->assertSame( 'Add its API key in Settings → Connectors.', $destination->get_hint() );
    }

    public function test_admin_destination_does_not_warn_about_an_empty_url(): void
    {
        Functions\when( 'esc_url_raw' )->alias( array( $this, 'protocol_filter' ) );
        Functions\expect( '_doing_it_wrong' )->never();

        $this->assertSame( '', Destination::admin_url( '', 'Nowhere' )->get_url() );
    }

    /**
     * Stand-in for `esc_url_raw()`'s protocol whitelist.
     *
     * The test-suite stub returns its input unchanged, which cannot exercise the
     * rejection branch. This keeps only the schemes WordPress allows.
     *
     * @param  string $url Candidate URL.
     * @return string The URL, or '' when its protocol is not allowed.
     */
    public function protocol_filter( string $url ): string
    {
        if ( '' === $url ) {
            return '';
        }

        return preg_match( '#^(https?|mailto):#i', $url ) ? $url : '';
    }

    /* ---------------------------------------------------------------------
     * Credential requirement factory
     * ------------------------------------------------------------------ */

    public function test_factory_resolves_admin_destination_on_connectors_backend(): void
    {
        $this->use_backend( true );

        $requirement = RequirementFactory::missing_credential( 'tavily', 'Tavily', array( 'Web Researcher' ) );

        $this->assertSame( 'credential:tavily', $requirement->get_id() );
        $this->assertSame( Requirement::KIND_MISSING_CREDENTIAL, $requirement->get_kind() );
        $this->assertSame( Destination::KIND_ADMIN_URL, $requirement->get_destination()->get_kind() );
        $this->assertSame(
            'https://example.test/wp-admin/options-connectors.php',
            $requirement->get_destination()->get_url()
        );
        $this->assertSame( array( 'Web Researcher' ), $requirement->get_sources() );
    }

    public function test_factory_names_the_constant_and_omits_url_on_legacy_backend(): void
    {
        $this->use_backend( false );

        $requirement = RequirementFactory::missing_credential( 'tavily', 'Tavily' );

        $this->assertSame( Destination::KIND_NONE, $requirement->get_destination()->get_kind() );
        $this->assertSame( '', $requirement->get_destination()->get_url() );
        $this->assertStringContainsString(
            'VIP_WORKFLOW_TAVILY_KEY',
            $requirement->get_destination()->get_hint(),
            'The legacy path has no admin UI, so it must name the constant instead.'
        );
        $this->assertStringNotContainsString( '/wp-admin/', $requirement->get_admin_reason() );
    }

    public function test_factory_user_message_never_names_an_admin_screen(): void
    {
        $this->use_backend( true );

        $requirement = RequirementFactory::missing_credential( 'tavily', 'Tavily' );

        $this->assertStringNotContainsString( '/wp-admin/', $requirement->get_user_message() );
        $this->assertStringNotContainsString( 'Connectors', $requirement->get_user_message() );
    }

    /**
     * A service outside `Credentials` has neither a constant nor a connector.
     *
     * Reachable because `WebResearcher` passes a third-party provider's own id
     * straight through. Both backends must decline honestly: the legacy branch
     * must not interpolate the empty constant name into "Set the  constant in
     * wp-config.php", and the Connectors branch must not link to a connector
     * that does not exist.
     *
     * @dataProvider provide_credential_backends
     *
     * @param bool $connectors Whether the Connectors backend is active.
     */
    public function test_factory_declines_a_service_it_does_not_manage( bool $connectors ): void
    {
        $this->use_backend( $connectors );

        $requirement = RequirementFactory::missing_credential( 'acme-search', 'Acme Search', array( 'Acme Search' ) );

        $this->assertSame( Destination::KIND_NONE, $requirement->get_destination()->get_kind() );
        $this->assertSame( '', $requirement->get_destination()->get_url() );

        foreach ( array( $requirement->get_admin_reason(), $requirement->get_user_message(), $requirement->get_destination()->get_hint() ) as $copy ) {
            $this->assertStringNotContainsString( '/wp-admin/', $copy );
            $this->assertStringNotContainsString( 'the  constant', $copy, 'An empty constant name must never be rendered.' );
        }

        $this->assertStringContainsString( 'Acme Search', $requirement->get_admin_reason() );
        $this->assertStringNotContainsString( 'Connectors', $requirement->get_user_message() );
        $this->assertSame( array( 'Acme Search' ), $requirement->get_sources() );
    }

    /**
     * @return array<string, array{bool}>
     */
    public static function provide_credential_backends(): array
    {
        return array(
            'connectors backend' => array( true ),
            'legacy backend'     => array( false ),
        );
    }

    public function test_factory_produces_a_stable_id_per_service(): void
    {
        $this->use_backend( true );

        $this->assertSame(
            RequirementFactory::missing_credential( 'tavily', 'Tavily' )->get_id(),
            RequirementFactory::missing_credential( 'tavily', 'Tavily Images' )->get_id(),
            'Two providers backed by the same credential must dedupe to one id.'
        );
    }

    public function test_factory_builds_unsupported_environment_requirements(): void
    {
        $requirement = RequirementFactory::unsupported_environment(
            'dependency:ai-client',
            'The WordPress AI client is not available in this environment.',
            'AI image generation is unavailable in this environment.',
            array( 'Media Scout' )
        );

        $this->assertSame( Requirement::KIND_UNSUPPORTED_ENVIRONMENT, $requirement->get_kind() );
        $this->assertSame( Destination::KIND_NONE, $requirement->get_destination()->get_kind() );
    }

    public function test_factory_builds_in_card_requirements(): void
    {
        $requirement = RequirementFactory::in_card(
            'settings:foresight',
            'Foresight credentials are not set.',
            'Foresight research is unavailable.',
            'Complete the fields below.',
            array( 'Foresight' )
        );

        $this->assertSame( Destination::KIND_IN_CARD, $requirement->get_destination()->get_kind() );
        $this->assertSame( 'Complete the fields below.', $requirement->get_destination()->get_hint() );
        $this->assertSame(
            '',
            $requirement->get_destination()->get_credentials_url(),
            'A service that names no sign-up URL must not acquire one.'
        );
    }

    public function test_factory_passes_a_credentials_url_through_to_the_destination(): void
    {
        Functions\when( 'esc_url_raw' )->alias( array( $this, 'protocol_filter' ) );

        $requirement = RequirementFactory::in_card(
            'settings:foresight',
            'Foresight credentials are not set.',
            'Foresight research is unavailable.',
            'Complete the fields below.',
            array( 'Foresight' ),
            'https://foresightnews.com'
        );

        $this->assertSame( 'https://foresightnews.com', $requirement->get_destination()->get_credentials_url() );
    }

    /**
     * The credentials URL is an affordance, not a location, so it stays out of the
     * flat-text composition that `WP_Error` messages and log lines use.
     */
    public function test_admin_text_does_not_absorb_the_credentials_url(): void
    {
        Functions\when( 'esc_url_raw' )->alias( array( $this, 'protocol_filter' ) );

        $requirement = RequirementFactory::in_card(
            'settings:foresight',
            'Foresight credentials are not set.',
            'Foresight research is unavailable.',
            'Complete the fields below.',
            array( 'Foresight' ),
            'https://foresightnews.com'
        );

        $this->assertSame(
            'Foresight credentials are not set. Complete the fields below.',
            $requirement->get_admin_text()
        );
    }
}
