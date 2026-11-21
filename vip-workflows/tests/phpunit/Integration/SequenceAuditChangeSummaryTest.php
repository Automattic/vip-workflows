<?php
/**
 * The change summary an update's audit row carries.
 *
 * Integration rather than unit: role names come from the real role registry
 * and tool labels from the real Abilities registry.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\Sequence;
use VIPWorkflows\Sequences\SequenceAudit;

/**
 * @covers \VIPWorkflows\Sequences\SequenceAudit::change_summary
 */
class SequenceAuditChangeSummaryTest extends TestCase
{
    /**
     * A registered ability, used as a required tool whose label is known.
     */
    private const KNOWN_TOOL = 'vip-workflows/update-sequence';

    /**
     * A sequence built in memory from a raw config.
     *
     * @param array  $config Config.
     * @param string $type   Sequence type.
     * @param string $name   Sequence name.
     * @return Sequence
     */
    private function sequence( array $config, string $type = Sequence::TYPE_WORKFLOW, string $name = 'Desk' ): Sequence
    {
        return Sequence::from_row(
            (object) array(
                'id'          => 7,
                'uuid'        => 'uuid-7',
                'type'        => $type,
                'name'        => $name,
                'slug'        => 'desk',
                'description' => '',
                'version'     => 1,
                'status'      => 'active',
                'config'      => wp_json_encode( $config ),
                'created_by'  => 1,
                'created_at'  => '2026-01-01 00:00:00',
                'updated_at'  => '2026-01-01 00:00:00',
            )
        );
    }

    /**
     * Writing -> Review -> Ready -> Live.
     *
     * @return array
     */
    private function stages(): array
    {
        return array(
            array(
                'key'         => 'writing',
                'label'       => 'Writing',
                'status'      => 'draft',
                'is_initial'  => true,
                'transitions' => array( array( 'to' => 'review', 'label' => 'Submit' ) ),
            ),
            array(
                'key'         => 'review',
                'label'       => 'Review',
                'status'      => 'pending',
                'transitions' => array(
                    array(
                        'to'             => 'ready',
                        'label'          => 'Approve',
                        'allowed_roles'  => array( 'administrator' ),
                        'required_tools' => array( self::KNOWN_TOOL ),
                    ),
                ),
            ),
            array(
                'key'         => 'ready',
                'label'       => 'Ready',
                'status'      => 'pending',
                'transitions' => array( array( 'to' => 'live', 'label' => 'Publish' ) ),
            ),
            array(
                'key'    => 'live',
                'label'  => 'Live',
                'status' => 'publish',
            ),
        );
    }

    /**
     * Config around a stage list.
     *
     * @param array $stages Stages.
     * @return array
     */
    private function config( array $stages ): array
    {
        return array(
            'version'    => '2.0',
            'post_types' => array( 'post' ),
            'statuses'   => $stages,
        );
    }

    /**
     * Summary between the base stages and an edited copy.
     *
     * @param callable $edit Receives the stages by value, returns the edited list.
     * @return array
     */
    private function summary_after( callable $edit ): array
    {
        $before = $this->sequence( $this->config( $this->stages() ) );
        $after  = $this->sequence( $this->config( $edit( $this->stages() ) ) );

        return SequenceAudit::change_summary( $before, $after );
    }

    public function test_an_added_stage_is_listed_and_nothing_else(): void
    {
        $summary = $this->summary_after(
            function ( array $stages ): array {
                $stages[] = array( 'key' => 'legal', 'label' => 'Legal review', 'status' => 'pending' );
                return $stages;
            }
        );

        $this->assertSame(
            array( 'stages_added' => array( array( 'key' => 'legal', 'label' => 'Legal review' ) ) ),
            $summary
        );
    }

    public function test_a_removed_stage_takes_its_transitions_with_it(): void
    {
        $summary = $this->summary_after(
            function ( array $stages ): array {
                unset( $stages[2] );
                $stages[1]['transitions'][0]['to'] = 'live';
                return array_values( $stages );
            }
        );

        $this->assertSame( array( array( 'key' => 'ready', 'label' => 'Ready' ) ), $summary['stages_removed'] );

        $removed = array_map(
            fn( $t ) => $t['from'] . '>' . $t['to'],
            $summary['transitions_removed']
        );
        sort( $removed );
        $this->assertSame( array( 'ready>live', 'review>ready' ), $removed );
        $this->assertSame( 'review>live', $summary['transitions_added'][0]['from'] . '>' . $summary['transitions_added'][0]['to'] );
        $this->assertSame( 'Review', $summary['transitions_added'][0]['from_label'] );
        $this->assertSame( 'Live', $summary['transitions_added'][0]['to_label'] );
    }

    public function test_a_relabeled_stage_is_listed_as_renamed(): void
    {
        $summary = $this->summary_after(
            function ( array $stages ): array {
                $stages[1]['label'] = 'Copy desk';
                return $stages;
            }
        );

        $this->assertSame(
            array( 'stages_renamed' => array( array( 'key' => 'review', 'from' => 'Review', 'to' => 'Copy desk' ) ) ),
            $summary
        );
    }

    public function test_a_region_change_is_listed(): void
    {
        $summary = $this->summary_after(
            function ( array $stages ): array {
                $stages[2]['status'] = 'private';
                return $stages;
            }
        );

        $this->assertSame(
            array(
                'regions_changed' => array(
                    array( 'key' => 'ready', 'label' => 'Ready', 'from' => 'pending', 'to' => 'private' ),
                ),
            ),
            $summary
        );
    }

    public function test_role_and_tool_changes_on_one_transition_make_one_entry(): void
    {
        $summary = $this->summary_after(
            function ( array $stages ): array {
                $stages[1]['transitions'][0]['allowed_roles']  = array( 'administrator', 'editor' );
                $stages[1]['transitions'][0]['required_tools'] = array();
                return $stages;
            }
        );

        $this->assertSame( array( 'transitions_changed' ), array_keys( $summary ) );
        $this->assertCount( 1, $summary['transitions_changed'] );

        $entry = $summary['transitions_changed'][0];
        $this->assertSame( 'review', $entry['from'] );
        $this->assertSame( 'ready', $entry['to'] );
        $this->assertSame( 'Review', $entry['from_label'] );
        $this->assertSame( 'Ready', $entry['to_label'] );
        $this->assertSame( array( array( 'slug' => 'editor', 'name' => 'Editor' ) ), $entry['roles_added'] );
        $this->assertSame( array(), $entry['roles_removed'] );
        $this->assertSame( array(), $entry['tools_added'] );
        $this->assertSame(
            array( array( 'id' => self::KNOWN_TOOL, 'label' => wp_get_ability( self::KNOWN_TOOL )->get_label() ) ),
            $entry['tools_removed']
        );
    }

    public function test_agent_added_then_rerouted(): void
    {
        $agent = array(
            'ability_id' => 'vip-workflows/some-agent',
            'routing'    => array( 'pass' => 'ready', 'fail' => 'review' ),
        );

        $summary = $this->summary_after(
            function ( array $stages ) use ( $agent ): array {
                $stages[1]['agent'] = $agent;
                return $stages;
            }
        );

        $this->assertSame( 'added', $summary['agents_changed'][0]['change'] );
        $this->assertSame( 'review', $summary['agents_changed'][0]['key'] );
        $this->assertSame( 'vip-workflows/some-agent', $summary['agents_changed'][0]['ability']['to'] );

        $with_agent             = $this->stages();
        $with_agent[1]['agent'] = $agent;

        $rerouted                                = $with_agent;
        $rerouted[1]['agent']['routing']['fail'] = 'writing';

        $summary = SequenceAudit::change_summary(
            $this->sequence( $this->config( $with_agent ) ),
            $this->sequence( $this->config( $rerouted ) )
        );

        $this->assertSame(
            array(
                array(
                    'key'     => 'review',
                    'label'   => 'Review',
                    'change'  => 'routing',
                    'routing' => array( array( 'outcome' => 'fail', 'from' => 'review', 'to' => 'writing' ) ),
                ),
            ),
            $summary['agents_changed']
        );
    }

    public function test_identical_configs_have_no_summary(): void
    {
        $this->assertSame( array(), $this->summary_after( fn( array $stages ): array => $stages ) );
    }

    public function test_a_name_change_names_the_field_and_the_old_name(): void
    {
        $before = $this->sequence( $this->config( $this->stages() ), Sequence::TYPE_WORKFLOW, 'Desk' );
        $after  = $this->sequence( $this->config( $this->stages() ), Sequence::TYPE_WORKFLOW, 'News desk' );

        $this->assertSame(
            array(
                'fields_changed' => array( 'name' ),
                'previous_name'  => 'Desk',
            ),
            SequenceAudit::change_summary( $before, $after )
        );
    }

    /**
     * @return array<string, array{0: callable}>
     */
    public function data_unitemized_stage_changes(): array
    {
        return array(
            'start stage moved' => array(
                function ( array $stages ): array {
                    unset( $stages[0]['is_initial'] );
                    $stages[1]['is_initial'] = true;
                    return $stages;
                },
            ),
            'stages reordered'  => array(
                function ( array $stages ): array {
                    return array( $stages[1], $stages[0], $stages[2], $stages[3] );
                },
            ),
            'agent settings'    => array(
                function ( array $stages ): array {
                    $stages[1]['agent'] = array(
                        'ability_id' => 'vip-workflows/some-agent',
                        'routing'    => array( 'pass' => 'ready' ),
                        'settings'   => array( 'tone' => 'strict' ),
                    );
                    return $stages;
                },
            ),
        );
    }

    /**
     * @dataProvider data_unitemized_stage_changes
     *
     * @param callable $edit Edit to the stages.
     */
    public function test_an_unitemized_stage_change_is_still_recorded( callable $edit ): void
    {
        $base = $this->stages();
        if ( 'agent settings' === $this->dataName() ) {
            $base[1]['agent'] = array(
                'ability_id' => 'vip-workflows/some-agent',
                'routing'    => array( 'pass' => 'ready' ),
            );
        }

        $summary = SequenceAudit::change_summary(
            $this->sequence( $this->config( $base ) ),
            $this->sequence( $this->config( $edit( $this->stages() ) ) )
        );

        $this->assertSame( array( 'fields_changed' => array( 'stages' ) ), $summary );
    }

    /**
     * @return array<string, array{0: callable, 1: string}>
     */
    public function data_mixed_saves(): array
    {
        return array(
            'stage renamed, transition relabeled' => array(
                function ( array $stages ): array {
                    $stages[1]['label']                   = 'Copy desk';
                    $stages[0]['transitions'][0]['label'] = 'Send to desk';
                    return $stages;
                },
                'stages_renamed',
            ),
            'region changed, start stage moved'   => array(
                function ( array $stages ): array {
                    $stages[2]['status'] = 'private';
                    unset( $stages[0]['is_initial'] );
                    $stages[1]['is_initial'] = true;
                    return $stages;
                },
                'regions_changed',
            ),
            'stage renamed, stages reordered'     => array(
                function ( array $stages ): array {
                    $stages[3]['label'] = 'Published';
                    return array( $stages[1], $stages[0], $stages[2], $stages[3] );
                },
                'stages_renamed',
            ),
            'roles changed, transition relabeled' => array(
                function ( array $stages ): array {
                    $stages[1]['transitions'][0]['allowed_roles'] = array();
                    $stages[1]['transitions'][0]['label']         = 'Sign off';
                    return $stages;
                },
                'transitions_changed',
            ),
            'stage added, agent settings changed' => array(
                function ( array $stages ): array {
                    $stages[1]['agent']['settings'] = array( 'tone' => 'lenient' );
                    $stages[]                       = array( 'key' => 'legal', 'label' => 'Legal', 'status' => 'pending' );
                    return $stages;
                },
                'stages_added',
            ),
        );
    }

    /**
     * A save that changes something a list names and something none names
     * records both, each once.
     *
     * @dataProvider data_mixed_saves
     *
     * @param callable $edit Edit to the stages.
     * @param string   $list The one list the edit itemizes.
     */
    public function test_a_mixed_save_records_the_unitemized_part_too( callable $edit, string $list ): void
    {
        $base             = $this->stages();
        $base[1]['agent'] = array(
            'ability_id' => 'vip-workflows/some-agent',
            'routing'    => array( 'pass' => 'ready' ),
            'settings'   => array( 'tone' => 'strict' ),
        );

        $summary = SequenceAudit::change_summary(
            $this->sequence( $this->config( $base ) ),
            $this->sequence( $this->config( $edit( $base ) ) )
        );

        $this->assertSame( array( 'fields_changed', $list ), array_keys( $summary ) );
        $this->assertSame( array( 'stages' ), $summary['fields_changed'] );
        $this->assertCount( 1, $summary[ $list ] );
    }

    /**
     * @return array<string, array{0: callable}>
     */
    public function data_itemized_only_saves(): array
    {
        return array(
            'agent added with settings'   => array(
                function ( array $stages ): array {
                    $stages[1]['agent'] = array(
                        'ability_id' => 'vip-workflows/some-agent',
                        'routing'    => array( 'pass' => 'ready' ),
                        'settings'   => array( 'tone' => 'strict' ),
                    );
                    return $stages;
                },
            ),
            'transition retargeted'       => array(
                function ( array $stages ): array {
                    $stages[1]['transitions'][0]['to'] = 'live';
                    return $stages;
                },
            ),
            'stage and transition added'  => array(
                function ( array $stages ): array {
                    $stages[]                   = array( 'key' => 'legal', 'label' => 'Legal', 'status' => 'pending' );
                    $stages[0]['transitions'][] = array( 'to' => 'legal', 'label' => 'To legal' );
                    return $stages;
                },
            ),
        );
    }

    /**
     * What a list names is not counted again under `stages`.
     *
     * @dataProvider data_itemized_only_saves
     *
     * @param callable $edit Edit to the stages.
     */
    public function test_an_itemized_change_is_not_also_named_as_stages( callable $edit ): void
    {
        $summary = $this->summary_after( $edit );

        $this->assertNotEmpty( $summary );
        $this->assertArrayNotHasKey( 'fields_changed', $summary );
    }

    public function test_a_dropped_duplicate_is_counted_once(): void
    {
        $legacy = $this->stages();
        foreach ( $legacy as &$stage ) {
            unset( $stage['status'] );
        }
        unset( $stage );
        $legacy[0]['transitions'][] = array( 'to' => 'review', 'label' => 'Submit again' );

        $summary = SequenceAudit::change_summary(
            $this->sequence( $this->config( $legacy ) ),
            $this->sequence( $this->config( $this->stages() ) ),
            array( array( 'from' => 'writing', 'to' => 'review' ) )
        );

        $this->assertSame( array( 'regions_changed', 'transitions_removed' ), array_keys( $summary ) );
        $this->assertCount( 1, $summary['transitions_removed'] );
    }

    public function test_a_long_list_is_capped_and_counts_what_it_dropped(): void
    {
        $summary = $this->summary_after(
            function ( array $stages ): array {
                for ( $i = 1; $i <= 60; $i++ ) {
                    $stages[] = array( 'key' => 'extra_' . $i, 'label' => 'Extra ' . $i, 'status' => 'draft' );
                }
                return $stages;
            }
        );

        $this->assertCount( SequenceAudit::LIST_CAP, $summary['stages_added'] );
        $this->assertSame( array( 'stages_added' => 10 ), $summary['truncated'] );
    }

    public function test_an_unregistered_tool_is_labeled_by_its_id_without_a_notice(): void
    {
        $summary = $this->summary_after(
            function ( array $stages ): array {
                $stages[0]['transitions'][0]['required_tools'] = array( 'acme/not-registered' );
                return $stages;
            }
        );

        $this->assertSame(
            array( array( 'id' => 'acme/not-registered', 'label' => 'acme/not-registered' ) ),
            $summary['transitions_changed'][0]['tools_added']
        );
        // WP_UnitTestCase fails the test on any unexpected _doing_it_wrong.
    }

    public function test_a_pre_gate_config_without_regions_diffs_from_null(): void
    {
        $legacy = $this->stages();
        foreach ( $legacy as &$stage ) {
            unset( $stage['status'] );
        }
        unset( $stage );

        $summary = SequenceAudit::change_summary(
            $this->sequence( $this->config( $legacy ) ),
            $this->sequence( $this->config( $this->stages() ) )
        );

        $this->assertCount( 4, $summary['regions_changed'] );
        $this->assertNull( $summary['regions_changed'][0]['from'] );
        $this->assertSame( 'draft', $summary['regions_changed'][0]['to'] );
    }

    public function test_malformed_legacy_transition_target_does_not_raise_a_notice(): void
    {
        $before = $this->stages();
        $before[0]['transitions'][0]['to'] = array( 'review' );
        $summary = SequenceAudit::change_summary(
            $this->sequence( $this->config( $before ) ),
            $this->sequence( $this->config( $this->stages() ) )
        );
        $this->assertNotEmpty( $summary );
    }

    public function test_malformed_stored_stage_values_remain_auditable_without_notices(): void
    {
        $paths = array(
            array( 'key' ),
            array( 'label' ),
            array( 'status' ),
            array( 'transitions' ),
            array( 'transitions', 0, 'to' ),
            array( 'transitions', 0, 'allowed_roles' ),
            array( 'transitions', 0, 'required_tools' ),
            array( 'agent', 'ability_id' ),
            array( 'agent', 'routing', 'pass' ),
        );
        foreach ( $paths as $path ) {
            foreach ( array( array( 'unexpected' ), (object) array( 'bad' => 'value' ), null, false, 123 ) as $value ) {
                $valid = $this->stages();
                $valid[0]['agent'] = array(
                    'ability_id' => 'vip-workflows/some-agent',
                    'routing' => array( 'pass' => 'review' ),
                );
                $invalid = $valid;
                $slot = &$invalid[0];
                foreach ( $path as $key ) {
                    $slot = &$slot[$key];
                }
                $slot = $value;
                unset( $slot );
                $before = $this->sequence( $this->config( $invalid ) );
                $after = $this->sequence( $this->config( $valid ) );
                $context = implode( '.', $path ) . ': ' . wp_json_encode( $value );
                $this->assertNotEmpty( SequenceAudit::change_summary( $before, $after ), $context );
                $this->assertNotEmpty( SequenceAudit::change_summary( $after, $before ), $context );
                $this->assertSame( array(), SequenceAudit::change_summary( $before, $before ), $context );
            }
        }
    }

    public function test_rekeying_a_stage_is_remove_and_add(): void
    {
        $summary = $this->summary_after( function ( array $stages ): array {
            $stages[2]['key'] = 'proof';
            $stages[1]['transitions'][0]['to'] = 'proof';
            return $stages;
        } );
        $this->assertSame( 'ready', $summary['stages_removed'][0]['key'] );
        $this->assertSame( 'proof', $summary['stages_added'][0]['key'] );
        $this->assertArrayNotHasKey( 'stages_renamed', $summary );
    }

    public function test_custom_role_label_is_copied_at_write_time(): void
    {
        add_role( 'audit_custom', 'Custom desk', array() );
        try {
            $summary = $this->summary_after( function ( array $stages ): array {
                $stages[0]['transitions'][0]['allowed_roles'] = array( 'audit_custom', 'retired_role' );
                return $stages;
            } );
            remove_role( 'audit_custom' );
            $this->assertSame( array(
                array( 'slug' => 'audit_custom', 'name' => 'Custom desk' ),
                array( 'slug' => 'retired_role', 'name' => 'retired_role' ),
            ), $summary['transitions_changed'][0]['roles_added'] );
        } finally {
            remove_role( 'audit_custom' );
        }
    }

    public function test_empty_agent_and_nonarray_roles_and_tools_are_tolerated(): void
    {
        $before = $this->stages();
        $before[0]['agent'] = array();
        $before[0]['transitions'][0]['allowed_roles'] = false;
        $before[0]['transitions'][0]['required_tools'] = 'legacy-tool';
        $this->assertNotEmpty( SequenceAudit::change_summary(
            $this->sequence( $this->config( $before ) ),
            $this->sequence( $this->config( $this->stages() ) )
        ) );
    }

    public function test_a_phase_hand_off_is_diffed_like_a_transition(): void
    {
        $phases = function ( array $tools ): array {
            return array(
                'version' => '1.0',
                'phases'  => array(
                    array(
                        'key'         => 'ideation',
                        'label'       => 'Ideation',
                        'transitions' => array(
                            array(
                                'to'             => 'editorial',
                                'label'          => 'Commission',
                                'required_tools' => $tools,
                                'allowed_roles'  => array(),
                            ),
                        ),
                    ),
                    array(
                        'key'         => 'editorial',
                        'label'       => 'Editorial',
                        'transitions' => array(),
                    ),
                ),
            );
        };

        $summary = SequenceAudit::change_summary(
            $this->sequence( $phases( array() ), Sequence::TYPE_PHASE ),
            $this->sequence( $phases( array( self::KNOWN_TOOL ) ), Sequence::TYPE_PHASE )
        );

        $this->assertSame( array( 'transitions_changed' ), array_keys( $summary ) );
        $this->assertSame( 'ideation', $summary['transitions_changed'][0]['from'] );
        $this->assertSame( 'editorial', $summary['transitions_changed'][0]['to'] );
        $this->assertSame( self::KNOWN_TOOL, $summary['transitions_changed'][0]['tools_added'][0]['id'] );
    }
}
