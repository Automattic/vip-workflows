<?php
/**
 * Plugin Name: Workflow: Parse.ly
 * Description: Bridges wp-parsely's Smart Linking, headline suggestions, Traffic Boost and analytics into VIP Workflow's abilities, agents, discovery providers and ideation assistants.
 * Version: 0.1.0
 * Author: WordPress VIP
 * Author URI: https://wpvip.com/
 * Requires Plugins: vip-workflow
 * Text Domain: workflow-parsely
 *
 * NOTE ON THE wp-parsely DEPENDENCY
 * ---------------------------------
 * wp-parsely is required at runtime but deliberately absent from the header.
 * WordPress's plugin-dependency resolver only sees plugins in wp-content/plugins,
 * and on VIP wp-parsely is commonly loaded as an mu-plugin. Naming it there makes this plugin permanently unactivatable on exactly
 * the sites it is built for, with the misleading message that wp-parsely is not
 * installed when it is loaded and working.
 *
 * The runtime guard is stronger anyway: wp_parsely_is_active() checks for the
 * classes this plugin actually calls, which is true for an mu-plugin, a regular
 * plugin, or a Composer-loaded copy alike. check_availability() then reports a
 * missing dependency as an unmet requirement on the Integrations card rather than
 * as a failed activation.
 *
 * @package WorkflowParsely
 */

declare( strict_types=1 );

namespace WorkflowParsely;

use VIPWorkflow\Abilities\Availability;
use VIPWorkflow\Abilities\RequirementFactory;
use VIPWorkflow\Abilities\RequirementGroup;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/includes/class-entitlement.php';
require_once __DIR__ . '/includes/class-suggestions-guard.php';
require_once __DIR__ . '/includes/class-parsely-client.php';
require_once __DIR__ . '/includes/class-performance-lens.php';
require_once __DIR__ . '/includes/abilities/class-smart-linking.php';
require_once __DIR__ . '/includes/abilities/class-headline-suggestions.php';
require_once __DIR__ . '/includes/abilities/class-performance-signals.php';
require_once __DIR__ . '/includes/abilities/class-performance-check.php';
require_once __DIR__ . '/includes/agents/class-smart-linking-agent.php';
require_once __DIR__ . '/includes/discovery/class-parsely-discovery-provider.php';
require_once __DIR__ . '/includes/discovery/class-prompt-scorer.php';
require_once __DIR__ . '/includes/discovery/class-discovery-poller.php';

// ── Abilities ────────────────────────────────────────────────────────

add_action( 'wp_abilities_api_init', array( Abilities\SmartLinking::class, 'register' ) );
add_action( 'wp_abilities_api_init', array( Abilities\HeadlineSuggestions::class, 'register' ) );
add_action( 'wp_abilities_api_init', array( Abilities\PerformanceSignals::class, 'register' ) );
add_action( 'wp_abilities_api_init', array( Abilities\PerformanceCheck::class, 'register' ) );

/*
 * Not on an abilities hook: the tier bounds are read wherever the signal is
 * computed, including the discovery filter and cron warming, which run nowhere
 * near ability registration.
 */
Abilities\PerformanceCheck::register_config_bridge();

/*
 * Nor is the warmer: its drain hook has to be listening on any request that
 * might run cron, whether or not that request registered any abilities.
 */
Abilities\PerformanceCheck::register_warmer();
add_action( 'wp_abilities_api_init', array( Agents\SmartLinkingAgent::class, 'register' ) );
add_action( 'vip_workflow_register_discovery_providers', array( Discovery\ParselyDiscoveryProvider::class, 'register' ) );

Discovery\PromptScorer::register();
Discovery\DiscoveryPoller::register();

/*
 * Deactivation has to be registered here rather than in the poller: the hook is
 * keyed on the plugin file, so `__FILE__` has to be this one. Without it a
 * deactivated plugin leaves its recurring event behind, firing at an action
 * nobody handles.
 */
register_deactivation_hook( __FILE__, array( Discovery\DiscoveryPoller::class, 'unschedule' ) );

// ── Dependency and credentials ───────────────────────────────────────

/**
 * Whether wp-parsely is loaded.
 *
 * Checked by class rather than by `is_plugin_active()`: the class is what this
 * plugin actually calls, and `is_plugin_active()` is unavailable outside the
 * admin without pulling in wp-admin/includes/plugin.php.
 */
function wp_parsely_is_active(): bool {
	return class_exists( \Parsely\Parsely::class )
		&& class_exists( \Parsely\Services\Content_API\Content_API_Service::class );
}

/**
 * Whether Parse.ly credentials are stored.
 *
 * Reads wp-parsely's own option rather than asking this plugin's user to enter
 * the credentials a second time. Both halves are required: the site id scopes
 * every call, and the Content API rejects requests without the secret.
 *
 * Deliberately local — no network call. See check_availability().
 */
function is_configured(): bool {
	if ( ! wp_parsely_is_active() ) {
		return false;
	}

	$options = get_option( 'parsely', array() );

	if ( ! is_array( $options ) ) {
		return false;
	}

	return '' !== trim( (string) ( $options['apikey'] ?? '' ) )
		&& '' !== trim( (string) ( $options['api_secret'] ?? '' ) );
}

/**
 * Report availability for every capability this plugin contributes.
 *
 * Registered as the `availability_callback` from all of them on purpose: the
 * requirement is the same one, so the Agents card renders a single row naming
 * every capability rather than repeating itself per ability.
 *
 * This is a *configured* check, not a *validated* one. It reads an option and
 * returns; it never calls Parse.ly. Availability is read on every Agents-page
 * load and several times per settings save, so a network round trip here would
 * make the admin crawl. Credential validation is a separate, deliberate act —
 * Content_API_Service::validate_credentials() exists for that.
 *
 * The destination is `dependency` rather than `in_card`: these credentials live
 * in wp-parsely's own settings screen, so this plugin has no field to point at.
 * Sending the administrator to the screen that actually owns the value is the
 * only honest instruction available.
 *
 * @return bool|Availability True when configured, otherwise the unmet requirement.
 */
function check_availability(): bool|Availability {
	if ( is_configured() ) {
		return true;
	}

	$sources = array( __( 'Parse.ly', 'workflow-parsely' ) );

	if ( ! wp_parsely_is_active() ) {
		return Availability::unmet(
			RequirementGroup::all(
				RequirementFactory::dependency(
					'plugin:wp-parsely',
					__( 'The Parse.ly plugin (wp-parsely) is not active. Parse.ly capabilities cannot run without it.', 'workflow-parsely' ),
					__( 'Parse.ly is not set up. Ask an administrator to activate the Parse.ly plugin.', 'workflow-parsely' ),
					$sources
				)
			)
		);
	}

	return Availability::unmet(
		RequirementGroup::all(
			RequirementFactory::dependency(
				'credentials:parsely',
				__( 'Parse.ly is missing its Site ID or API Secret. Add both under Settings → Parse.ly.', 'workflow-parsely' ),
				__( 'Parse.ly is not connected. Ask an administrator to finish setting it up.', 'workflow-parsely' ),
				$sources
			)
		)
	);
}

/**
 * Availability for the Suggestions-backed capabilities.
 *
 * Everything `check_availability()` reports, plus one thing it cannot know:
 * Parse.ly entitles its analytics endpoints and its Suggestions endpoints
 * separately on the same Site ID. A key can have full analytics access and no
 * Suggestions access, which is the common case rather than the exotic one — of
 * four real Site IDs tested, three were in exactly that state.
 *
 * Nothing local distinguishes them, so this reports what Parse.ly has already
 * refused. Smart Linking and headline suggestions use it; the discovery provider
 * does not, because the Content API it calls was never refused.
 *
 * @return bool|Availability True when usable, otherwise the unmet requirement.
 */
function check_suggestions_availability(): bool|Availability {
	$configured = check_availability();

	if ( true !== $configured ) {
		return $configured;
	}

	if ( ! Entitlement::suggestions_denied() ) {
		return true;
	}

	/*
	 * Parse.ly's own sentence — "Suggestions API access not enabled for this
	 * site" — is written for whoever called the API. An administrator needs to
	 * know their Site ID is right and the entitlement is not, or they will spend
	 * the afternoon re-checking a correct credential.
	 */
	return Availability::unmet(
		RequirementGroup::all(
			RequirementFactory::dependency(
				'entitlement:parsely-suggestions',
				__( 'This Parse.ly Site ID does not include Suggestions API access, so Smart Linking and headline suggestions cannot run. The Site ID and secret are correct; the feature is not enabled on the account. Ask Parse.ly to enable Content Helper for it.', 'workflow-parsely' ),
				__( 'Parse.ly smart linking and headline suggestions are not enabled for this site. Ask an administrator to have the feature turned on.', 'workflow-parsely' ),
				array( __( 'Parse.ly', 'workflow-parsely' ) )
			)
		)
	);
}

// ── Unified Assistants Tab ───────────────────────────────────────────

add_action( 'vip_workflow_register_assistant_meta', __NAMESPACE__ . '\register_assistant_meta' );

/**
 * Group every Parse.ly capability into one Integrations card.
 *
 * Registered with no settings_schema: unlike Foresight, this plugin collects no
 * credentials of its own. wp-parsely owns them, and duplicating the fields here
 * would create two places to set one value.
 *
 * The registry drops a manifest whose abilities and providers are all absent, so
 * this card appears only once a capability is registered — which is the behaviour
 * we want: a card advertising an integration that contributes nothing is worse
 * than no card. Later units append their ids here.
 *
 * @param \VIPWorkflow\Assistants\AssistantRegistry $registry Registry instance.
 */
function register_assistant_meta( $registry ): void {
	$registry->register(
		'parsely',
		array(
			'label'          => __( 'Parse.ly', 'workflow-parsely' ),
			'description'    => __( 'Smart linking, headline suggestions, trending topics and audience performance data from Parse.ly.', 'workflow-parsely' ),
			'icon'           => 'chart-line',
			'ability_ids'    => array(
				Abilities\SmartLinking::ABILITY_ID,
				Abilities\HeadlineSuggestions::ABILITY_ID,
				Abilities\PerformanceSignals::ABILITY_ID,
				Abilities\PerformanceCheck::ABILITY_ID,
				Agents\SmartLinkingAgent::ABILITY_ID,
			),
			'provider_slugs' => array(
				Discovery\ParselyDiscoveryProvider::SLUG,
			),
		)
	);
}
