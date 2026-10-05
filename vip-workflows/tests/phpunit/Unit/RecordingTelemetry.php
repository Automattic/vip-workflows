<?php
/**
 * Recording double for the VIP Telemetry library.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

/**
 * Stands in for Automattic\VIP\Telemetry\Telemetry, which exists only in the VIP
 * mu-plugins. It sends to Pendo on production and to Tracks everywhere. Install
 * it with Tracker::set_telemetry() and assert on what a call site handed over.
 *
 * Each event is stored with the current user at the moment it was recorded,
 * because the library reads the user then and drops the event when there is none.
 */
class RecordingTelemetry
{
    /**
     * Events in the order they were recorded.
     *
     * @var array<int, array{event: string, properties: array, user: int}>
     */
    public array $events = array();

    /**
     * Record an event, as the library's Telemetry class does.
     *
     * @param string $event      Event name, without the prefix.
     * @param array  $properties Event properties.
     * @return bool
     */
    public function record_event( string $event, array $properties = array() ): bool
    {
        $this->events[] = array(
            'event'      => $event,
            'properties' => $properties,
            'user'       => get_current_user_id(),
        );

        return true;
    }

    /**
     * The recorded events with the given name.
     *
     * @param string $event Event name.
     * @return array<int, array{event: string, properties: array, user: int}>
     */
    public function of( string $event ): array
    {
        return array_values(
            array_filter(
                $this->events,
                static fn( array $recorded ): bool => $recorded['event'] === $event
            )
        );
    }
}
