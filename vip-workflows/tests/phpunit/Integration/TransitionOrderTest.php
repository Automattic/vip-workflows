<?php
/**
 * The order a stage's transitions reach the editor.
 *
 * The stored `transitions` array is the only ranking a sequence carries: the
 * stage inspector lets an author drag a stage's exits into the order a writer
 * should read them in, and nothing between that array and the editor sidebar is
 * allowed to disturb it. If the API reordered, the author's drag would have no
 * effect and the cause would be invisible from the editor.
 *
 * Role filtering runs in between, so the order has to survive a transition
 * dropping out of the middle of the list.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use VIPWorkflow\Sequences\SequenceRepository;
use VIPWorkflow\Workflow\StatusManager;

class TransitionOrderTest extends TestCase
{
    /**
     * @var int
     */
    private int $sequence_id = 0;

    /**
     * @var int
     */
    private int $post_id = 0;

    /**
     * @var int
     */
    private int $admin_id = 0;

    public function set_up(): void
    {
        parent::set_up();

        $this->admin_id = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
        wp_set_current_user( $this->admin_id );
    }

    /**
     * Seat a post in a draft stage whose transitions are the given list.
     *
     * @param array $transitions Transition configs for the draft stage.
     */
    private function seed( array $transitions ): void
    {
        $this->sequence_id = (int) ( new SequenceRepository() )->create(
            'Transition Order Flow',
            'transition-order-flow',
            '',
            array(
                'post_types' => array( 'post' ),
                'statuses'   => array(
                    array(
                        'key'         => 'draft_stage',
                        'label'       => 'Draft Stage',
                        'status'      => 'draft',
                        'transitions' => $transitions,
                    ),
                    /*
                     * Every destination shares the source's status region. What
                     * is under test is the order of the transitions delivered to
                     * the editor, and a region has a single entry checkpoint —
                     * so putting three destinations in a region the draft stage
                     * transitions into would make two of the three transitions
                     * illegal for reasons this test is not about.
                     */
                    array(
                        'key'         => 'fact_check',
                        'label'       => 'Fact Check',
                        'status'      => 'draft',
                        'transitions' => array(),
                    ),
                    array(
                        'key'         => 'copy_desk',
                        'label'       => 'Copy Desk',
                        'status'      => 'draft',
                        'transitions' => array(),
                    ),
                    array(
                        'key'         => 'review',
                        'label'       => 'Review',
                        'status'      => 'draft',
                        'transitions' => array(),
                    ),
                ),
            ),
            $this->admin_id
        );

        $this->post_id = (int) self::factory()->post->create(
            array( 'post_status' => 'draft' )
        );

        update_post_meta( $this->post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
        update_post_meta( $this->post_id, StatusManager::STAGE_META_KEY, 'draft_stage' );
    }

    /**
     * Destination keys in the order the sidebar receives them.
     *
     * @return array<int, string>
     */
    private function received_order(): array
    {
        return array_map(
            static fn( array $t ): string => $t['to'],
            ( new StatusManager() )->get_available_transitions( $this->post_id )
        );
    }

    public function test_the_stored_array_order_is_the_order_delivered(): void
    {
        $this->seed(
            array(
                array( 'to' => 'review' ),
                array( 'to' => 'fact_check' ),
                array( 'to' => 'copy_desk' ),
            )
        );

        $this->assertSame(
            array( 'review', 'fact_check', 'copy_desk' ),
            $this->received_order()
        );
    }

    /**
     * Role filtering runs between the stored config and the sidebar, and it must
     * not disturb the order of what survives.
     *
     * Runs as an author rather than an administrator — a role in
     * `Settings::get_bypass_workflow_roles()` returns every transition unfiltered,
     * so an admin never exercises the filtering path at all.
     */
    public function test_order_survives_a_filtered_out_middle_transition(): void
    {
        $this->seed(
            array(
                array( 'to' => 'fact_check' ),
                array(
                    'to'            => 'copy_desk',
                    'allowed_roles' => array( 'editor' ),
                ),
                array( 'to' => 'review' ),
            )
        );

        // Authors may only edit their own posts, so the post has to be theirs for
        // the transitions to be offered at all.
        $author_id = (int) self::factory()->user->create( array( 'role' => 'author' ) );
        wp_update_post(
            array(
                'ID'          => $this->post_id,
                'post_author' => $author_id,
            )
        );
        wp_set_current_user( $author_id );

        $order = $this->received_order();

        $this->assertNotContains(
            'copy_desk',
            $order,
            'A transition gated to editors should not be offered to an author.'
        );
        $this->assertSame(
            array( 'fact_check', 'review' ),
            $order,
            'The survivors must keep their authored relative order.'
        );
    }

    public function test_reordering_the_stored_config_reorders_what_is_delivered(): void
    {
        $this->seed(
            array(
                array( 'to' => 'fact_check' ),
                array( 'to' => 'review' ),
            )
        );

        $repo     = new SequenceRepository();
        $statuses = $repo->find( $this->sequence_id )->get_statuses();

        foreach ( $statuses as &$status ) {
            if ( 'draft_stage' === $status['key'] ) {
                $status['transitions'] = array_reverse( $status['transitions'] );
            }
        }
        unset( $status );

        $repo->update(
            $this->sequence_id,
            array(
                'config' => array(
                    'post_types' => array( 'post' ),
                    'statuses'   => $statuses,
                ),
            )
        );

        $this->assertSame( array( 'review', 'fact_check' ), $this->received_order() );
    }

    /**
     * The transition payload is built from an explicit allowlist that drops any
     * field not named in it, silently. `inputs` is the conditional member of that
     * list, so it is the one worth pinning: adding or removing a field must not
     * shadow it.
     */
    public function test_optional_transition_config_survives_the_allowlist(): void
    {
        $this->seed(
            array(
                array(
                    'to'     => 'review',
                    'label'  => 'Send to Review',
                    'inputs' => array(
                        array(
                            'type'  => 'text',
                            'label' => 'Anything to flag?',
                        ),
                    ),
                ),
            )
        );

        $received = ( new StatusManager() )->get_available_transitions( $this->post_id )[0];

        $this->assertSame( 'Send to Review', $received['label'] );
        $this->assertSame( 'text', $received['inputs'][0]['type'] ?? null );
    }
}
