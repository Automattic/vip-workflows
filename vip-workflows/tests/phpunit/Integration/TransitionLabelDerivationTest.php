<?php
/**
 * Transition labels follow the stage they point at.
 *
 * A transition with no label of its own is presented as an action naming its
 * destination. Deriving it at read time rather than storing a copy is what keeps
 * it from going stale: renaming a stage used to leave every auto-labelled
 * transition pointing at it still saying the old name, on the buttons writers
 * use to move posts.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StatusManager;

class TransitionLabelDerivationTest extends TestCase
{
    /**
     * Sequence ID.
     *
     * @var int
     */
    private int $sequence_id = 0;

    /**
     * Post in the draft stage.
     *
     * @var int
     */
    private int $post_id = 0;

    public function set_up(): void
    {
        parent::set_up();

        $admin_id = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
        wp_set_current_user( $admin_id );

        $this->sequence_id = (int) ( new SequenceRepository() )->create(
            'Label Derivation Flow',
            'label-derivation-flow',
            '',
            array(
                'post_types' => array( 'post' ),
                'statuses'   => array(
                    array(
                        'key'         => 'draft_stage',
                        'label'       => 'Draft Stage',
                        'status'      => 'draft',
                        'transitions' => array(
                            // No label: presentation must be derived.
                            array( 'to' => 'derived_target' ),
                            // Explicit label: must be left exactly alone.
                            array(
                                'to'    => 'explicit_target',
                                'label' => 'Send it onward',
                            ),
                        ),
                    ),
                    array(
                        'key'         => 'derived_target',
                        'label'       => 'Original Name',
                        'status'      => 'pending',
                        'transitions' => array(),
                    ),
                    array(
                        'key'         => 'explicit_target',
                        'label'       => 'Explicit Target',
                        // Its own region, so it is that region's entry
                        // checkpoint. A region can only be entered through one,
                        // and this flow needs both destinations reachable
                        // directly from the draft stage: one unlabelled to prove
                        // derivation, one labelled to prove derivation leaves it
                        // alone. Which regions they sit in is incidental.
                        'status'      => 'private',
                        'transitions' => array(),
                    ),
                ),
            ),
            $admin_id
        );

        $this->post_id = (int) self::factory()->post->create(
            array( 'post_status' => 'draft' )
        );

        // Seated via meta, the way the other integration tests do it — the
        // public transition API would run guards this test does not care about.
        update_post_meta( $this->post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
        update_post_meta( $this->post_id, StatusManager::STAGE_META_KEY, 'draft_stage' );
    }

    /**
     * Transitions as the editor sidebar receives them, keyed by destination.
     *
     * @return array<string, string> Destination key => label.
     */
    private function labels(): array
    {
        $transitions = ( new StatusManager() )->get_available_transitions(
            $this->post_id
        );

        $out = array();
        foreach ( (array) $transitions as $t ) {
            $out[ $t['to'] ] = $t['label'];
        }

        return $out;
    }

    /**
     * Rename a stage in the stored sequence.
     *
     * @param string $key   Stage key.
     * @param string $label New label.
     */
    private function rename_stage( string $key, string $label ): void
    {
        $repo     = new SequenceRepository();
        $bp       = $repo->find( $this->sequence_id );
        $statuses = $bp->get_statuses();

        foreach ( $statuses as &$status ) {
            if ( $key === $status['key'] ) {
                $status['label'] = $label;
            }
        }
        unset( $status );

        $repo->update(
            $this->sequence_id,
            array( 'config' => array( 'post_types' => array( 'post' ), 'statuses' => $statuses ) )
        );
    }

    public function test_unlabelled_transition_names_its_destination(): void
    {
        $labels = $this->labels();

        $this->assertArrayHasKey( 'derived_target', $labels );
        $this->assertStringContainsString(
            'Original Name',
            $labels['derived_target'],
            'A transition with no label must name the stage it leads to.'
        );
    }

    public function test_derived_label_reads_as_an_action(): void
    {
        $labels = $this->labels();

        $this->assertNotSame(
            'Original Name',
            $labels['derived_target'],
            'The bare stage name reads as a state, not a button. It must be phrased as an action.'
        );
    }

    /**
     * The bug: rename the destination and the label used to keep the old name.
     */
    public function test_renaming_the_destination_updates_the_derived_label(): void
    {
        $this->rename_stage( 'derived_target', 'Renamed Stage' );

        $labels = $this->labels();

        $this->assertStringContainsString(
            'Renamed Stage',
            $labels['derived_target'],
            'A derived label must follow the rename.'
        );
        $this->assertStringNotContainsString(
            'Original Name',
            $labels['derived_target'],
            'The old name must not survive the rename.'
        );
    }

    public function test_explicit_label_is_never_rewritten(): void
    {
        $labels = $this->labels();

        $this->assertSame(
            'Send it onward',
            $labels['explicit_target'],
            'An authored label is the author\'s to control.'
        );
    }

    public function test_explicit_label_survives_a_rename_of_its_destination(): void
    {
        $this->rename_stage( 'explicit_target', 'Something Else Entirely' );

        $this->assertSame(
            'Send it onward',
            $this->labels()['explicit_target'],
            'Renaming a stage must not overwrite a label someone chose.'
        );
    }
}
