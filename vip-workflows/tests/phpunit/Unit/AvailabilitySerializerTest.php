<?php
/**
 * Register selection at the read boundary.
 *
 * The serializer owns the plugin's only capability-to-register mapping, so both
 * halves of it are pinned here: the request-bound inference, and the explicit
 * entry point a caller with no bound user has to reach for instead.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\API\AvailabilitySerializer;
use VIPWorkflows\Abilities\Availability;
use VIPWorkflows\Abilities\Destination;
use VIPWorkflows\Abilities\Requirement;
use VIPWorkflows\Abilities\RequirementGroup;

class AvailabilitySerializerTest extends TestCase
{
    public function test_admin_capability_selects_the_admin_register(): void
    {
        Functions\when( 'current_user_can' )->justReturn( true );

        $this->assertSame(
            Requirement::REGISTER_ADMIN,
            AvailabilitySerializer::register_for_current_user()
        );
    }

    public function test_missing_admin_capability_selects_the_user_register(): void
    {
        Functions\when( 'current_user_can' )->justReturn( false );

        $this->assertSame(
            Requirement::REGISTER_USER,
            AvailabilitySerializer::register_for_current_user()
        );
    }

    public function test_explicit_register_does_not_consult_the_current_user(): void
    {
        // The point of the entry point: a cron or WP-CLI caller has no bound user,
        // so inference would silently hand it the user register. Asking
        // `current_user_can()` here at all would be the bug.
        Functions\expect( 'current_user_can' )->never();

        $payload = AvailabilitySerializer::serialize_for_register(
            $this->unmet_availability(),
            Requirement::REGISTER_ADMIN
        );

        $requirement = $payload['groups'][0]['requirements'][0];

        $this->assertFalse( $payload['available'] );
        $this->assertSame( 'Tavily is not connected.', $requirement['reason'] );
        $this->assertArrayHasKey( 'destination', $requirement );
    }

    public function test_explicit_user_register_omits_admin_wording(): void
    {
        Functions\expect( 'current_user_can' )->never();

        $payload = AvailabilitySerializer::serialize_for_register(
            $this->unmet_availability(),
            Requirement::REGISTER_USER
        );

        $requirement = $payload['groups'][0]['requirements'][0];

        $this->assertSame( 'Ask an administrator to connect it.', $requirement['message'] );
        $this->assertArrayNotHasKey( 'reason', $requirement );
        $this->assertArrayNotHasKey( 'destination', $requirement );
    }

    /**
     * The schema describes every key the destination actually serializes.
     *
     * `get_schema()` is the REST contract, so a field added to `Destination`
     * without a matching property here ships an undocumented key — and, under a
     * strict schema, one that gets stripped from the response.
     */
    public function test_schema_documents_every_destination_key_the_payload_carries(): void
    {
        Functions\when( 'esc_url_raw' )->returnArg();
        Functions\expect( 'current_user_can' )->never();

        $payload = AvailabilitySerializer::serialize_for_register(
            Availability::unmet(
                RequirementGroup::all(
                    new Requirement(
                        'settings:foresight-news',
                        Requirement::KIND_MISSING_CREDENTIAL,
                        'Foresight News sign-in details are missing.',
                        'Ask an administrator to add its sign-in details.',
                        Destination::in_card( 'Complete the fields below.', 'https://foresightnews.com' ),
                        array( 'Foresight News' )
                    )
                )
            ),
            Requirement::REGISTER_ADMIN
        );

        $destination = $payload['groups'][0]['requirements'][0]['destination'];

        $documented = array_keys(
            AvailabilitySerializer::get_schema()['properties']['groups']['items']['properties']['requirements']['items']['properties']['destination']['properties']
        );

        $this->assertSame(
            array(),
            array_diff( array_keys( $destination ), $documented ),
            'Every serialized destination key must appear in the schema.'
        );
        $this->assertContains( 'credentials_url', $documented );
        $this->assertSame( 'https://foresightnews.com', $destination['credentials_url'] );
    }

    private function unmet_availability(): Availability
    {
        return Availability::unmet(
            RequirementGroup::all(
                new Requirement(
                    'credential:tavily',
                    Requirement::KIND_MISSING_CREDENTIAL,
                    'Tavily is not connected.',
                    'Ask an administrator to connect it.',
                    Destination::none( 'Set the constant in wp-config.php.' ),
                    array( 'Web Researcher' )
                )
            )
        );
    }
}
