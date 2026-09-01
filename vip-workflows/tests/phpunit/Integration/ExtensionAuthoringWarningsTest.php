<?php
/**
 * Two extension-authoring mistakes that used to fail in silence.
 *
 * Both produce a working request and a wrong outcome, with nothing anywhere
 * pointing at the cause — which is what makes them expensive rather than
 * merely annoying. These tests pin the diagnostics, and pin equally hard that
 * the diagnostics stay quiet for correct code.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\Ability;
use WP_Error;

class ExtensionAuthoringWarningsTest extends TestCase
{
    /**
     * Ability arguments over a valid baseline.
     *
     * @param  array $args Arguments to merge in.
     * @return array
     */
    private function args( array $args ): array
    {
        return (
            array_merge(
                array(
                    'label'               => 'Test Ability',
                    'description'         => 'Registered by ExtensionAuthoringWarningsTest.',
                    'category'            => 'vip-workflows',
                    'input_schema'        => array(
                        'type'                 => 'object',
                        'additionalProperties' => false,
                        'properties'           => array(
                            'post_id' => array( 'type' => 'integer' ),
                        ),
                        'required'             => array( 'post_id' ),
                    ),
                    'execute_callback'    => static fn(): array => array(),
                    'permission_callback' => static fn(): bool => true,
                ),
                $args
            )
        );
    }

    /**
     * Build the ability directly.
     *
     * `vip_workflows_register_ability()` returns null outside
     * `wp_abilities_api_init`, and firing that hook mid-test would register every
     * ability in the plugin. The subclass constructor is what these cases need.
     *
     * @param  string $name Ability name.
     * @param  array  $args Ability arguments.
     * @return Ability
     */
    private function build( string $name, array $args ): Ability
    {
        return new Ability( $name, $this->args( $args ) );
    }

    /**
     * A list ability whose rows the UI could never find says so at registration.
     *
     * `rowsFrom()` reads `output.suggestions` and no other key, so rows under
     * another name render as an empty modal rather than as a wrong one.
     */
    public function test_a_list_result_without_suggestions_warns_at_registration(): void
    {
        $this->setExpectedIncorrectUsage( 'vip_workflows_warn_on_unreadable_list_result' );

        vip_workflows_warn_on_unreadable_list_result(
            'vip-workflows-test/list-with-wrong-key',
            $this->args( array(
                'meta'          => array( 'result_type' => 'list' ),
                'output_schema' => array(
                    'type'       => 'object',
                    'properties' => array(
                        'applied' => array( 'type' => 'array' ),
                        'summary' => array( 'type' => 'string' ),
                    ),
                ),
            ) )
        );
    }

    public function test_a_list_result_declaring_suggestions_is_silent(): void
    {
        vip_workflows_warn_on_unreadable_list_result(
            'vip-workflows-test/list-with-right-key',
            $this->args( array(
                'meta'          => array( 'result_type' => 'list' ),
                'output_schema' => array(
                    'type'       => 'object',
                    'properties' => array(
                        'suggestions' => array( 'type' => 'array' ),
                        'summary'     => array( 'type' => 'string' ),
                    ),
                ),
            ) )
        );

        $this->assertTrue( true, 'Registration completed without an incorrect-usage notice.' );
    }

    /**
     * The contract is about list results, so nothing else is second-guessed.
     */
    public function test_a_non_list_result_type_is_silent(): void
    {
        vip_workflows_warn_on_unreadable_list_result(
            'vip-workflows-test/report-result',
            $this->args( array(
                'meta'          => array( 'result_type' => 'report' ),
                'output_schema' => array(
                    'type'       => 'object',
                    'properties' => array(
                        'issues' => array( 'type' => 'array' ),
                    ),
                ),
            ) )
        );

        $this->assertTrue( true, 'Registration completed without an incorrect-usage notice.' );
    }

    /**
     * An ability declaring no output properties has a different omission, and
     * guessing at intent from silence would only produce noise.
     */
    public function test_a_list_result_with_no_declared_properties_is_silent(): void
    {
        vip_workflows_warn_on_unreadable_list_result(
            'vip-workflows-test/list-without-schema',
            $this->args( array(
                'meta' => array( 'result_type' => 'list' ),
            ) )
        );

        $this->assertTrue( true, 'Registration completed without an incorrect-usage notice.' );
    }

    /**
     * The mistake this exists for: returning an error-or-nothing helper straight
     * out of a permission callback, which denies everyone who passes the check.
     */
    public function test_a_permission_callback_returning_null_warns_and_still_denies(): void
    {
        if ( ! has_filter( 'wp_ability_permission_result' ) ) {
            $this->markTestSkipped( 'wp_ability_permission_result requires WordPress 7.1 or later.' );
        }

        $this->setExpectedIncorrectUsage( 'VIPWorkflows\Plugin::warn_on_unusable_permission_result' );

        $ability = $this->build(
            'vip-workflows-test/null-permission',
            array(
                // Exactly the shape of the mistake: require_post_edit_permission()
                // returns null when the check passes.
                'permission_callback' => static fn() => null,
            )
        );

        $this->assertInstanceOf( Ability::class, $ability, 'Test ability constructed.' );

        $permission = $ability->check_permissions( array( 'post_id' => 1 ) );

        $this->assertFalse(
            $permission,
            'An unusable permission result must still deny. The warning reports; it must never rescue.'
        );
    }

    public function test_a_permission_callback_returning_true_is_silent(): void
    {
        $ability = $this->build( 'vip-workflows-test/true-permission', array() );

        $this->assertTrue(
            $ability->check_permissions( array( 'post_id' => 1 ) ),
            'A well-formed permission callback is untouched.'
        );
    }

    public function test_a_permission_callback_returning_wp_error_is_silent(): void
    {
        $ability = $this->build(
            'vip-workflows-test/error-permission',
            array(
                'permission_callback' => static fn() => new WP_Error( 'forbidden', 'No.' ),
            )
        );

        $this->assertWPError(
            $ability->check_permissions( array( 'post_id' => 1 ) ),
            'A WP_Error is a usable answer and passes through unchanged.'
        );
    }
}
