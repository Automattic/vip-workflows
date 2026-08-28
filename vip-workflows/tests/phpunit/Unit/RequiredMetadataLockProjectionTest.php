<?php
/**
 * A rule that blocks a move has to say so before the move is attempted.
 *
 * Every other blocking rule in the sequence advertises itself: an unsatisfied
 * `requires_assignment` comes back on the transition as `_locked` plus a reason,
 * and the board, My Queue and the editor rail all read it. The required-field
 * gate was the one that stayed silent until the 422, so the board computed a
 * card as a legal drop target, the drop was refused, the card snapped back and
 * an audit row was written for a move the board had just shown as permitted.
 *
 * These pin the projection against the gate it mirrors — same answer, same
 * scope, same exemptions. Scope matters most: the gate holds only a crossing
 * INTO the publish region, so a projection that locked every edge would disable
 * moves the server would happily perform, which is the same class of bug in the
 * opposite direction.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflow\Sequences\Sequence;
use VIPWorkflow\Sequences\SequenceRepository;
use VIPWorkflow\Workflow\PostTypeManager;
use VIPWorkflow\Workflow\StatusManager;

/**
 * @covers \VIPWorkflow\Sequences\Sequence::get_missing_required_metadata
 * @covers \VIPWorkflow\Sequences\Sequence::get_role_permitted_transitions
 * @covers \VIPWorkflow\Sequences\Sequence::crosses_into_publish
 * @covers \VIPWorkflow\Workflow\StatusManager::get_available_transitions
 */
class RequiredMetadataLockProjectionTest extends TestCase
{
    /**
     * The post the projection is asked about.
     */
    private const POST_ID = 123;

    /**
     * A plain editor, not a bypass role. The bypass short-circuit returns the
     * transition list untouched before the projection is ever reached, so a
     * bypass user is covered by that existing early return rather than here.
     */
    private function stub_editor(): void
    {
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'roles' => array( 'editor' ) ) );
        Functions\when( 'get_option' )->justReturn( array() );

        // Stands in for core's list join, which the lock reason uses in place of
        // a hardcoded ", ". Only the '%l' conversion is reached from here, and no
        // assertion depends on the separator — they look for a label on its own,
        // so they hold against core's real "a and b" wording too.
        Functions\when( 'wp_sprintf' )->alias(
            function ( string $pattern, ...$args ): string {
                if ( '%l' === $pattern ) {
                    return implode( ', ', (array) ( $args[0] ?? array() ) );
                }

                return sprintf( $pattern, ...$args );
            }
        );
    }

    /**
     * A draft -> review -> published sequence spanning three regions, carrying
     * one metadata field.
     *
     * @param  bool $required Whether the `section` field is required.
     * @return Sequence
     */
    private function sequence( bool $required ): Sequence
    {
        $config = array(
            'post_types'      => array( 'post' ),
            'statuses'        => array(
                array(
                    'key'          => 'draft',
                    'label'        => 'Draft',
                    'status'       => 'draft',
                    'region_entry' => true,
                    'transitions'  => array( array( 'to' => 'review', 'label' => 'Submit' ) ),
                ),
                array(
                    'key'          => 'review',
                    'label'        => 'In Review',
                    'status'       => 'pending',
                    'region_entry' => true,
                    'transitions'  => array(
                        array( 'to' => 'published', 'label' => 'Publish' ),
                        array( 'to' => 'draft', 'label' => 'Send back' ),
                    ),
                ),
                array(
                    'key'          => 'published',
                    'label'        => 'Published',
                    'status'       => 'publish',
                    'region_entry' => true,
                    'transitions'  => array(),
                ),
            ),
            'metadata_fields' => array(
                array(
                    'key'      => 'section',
                    'label'    => 'Section',
                    'type'     => 'text',
                    'required' => $required,
                ),
            ),
        );

        $row = (object) array(
            'id'          => 1,
            'uuid'        => 'test-uuid-1234',
            'type'        => Sequence::TYPE_WORKFLOW,
            'name'        => 'Test Sequence',
            'slug'        => 'test-sequence',
            'description' => '',
            'version'     => 1,
            'status'      => 'active',
            'config'      => wp_json_encode( $config ),
            'created_by'  => 1,
            'created_at'  => '2026-01-01 00:00:00',
            'updated_at'  => '2026-01-01 00:00:00',
        );

        return Sequence::from_row( $row );
    }

    /**
     * Stub the stored value of the sequence's `section` field.
     *
     * @param string $value Stored meta value ('' for an unfilled field).
     */
    private function stub_section_value( string $value ): void
    {
        Functions\when( 'get_post_meta' )->alias(
            fn( $post_id, $key = '', $single = false ) => 'wf_meta_1_section' === $key ? $value : ''
        );
    }

    /**
     * Index the projected transitions by their destination.
     *
     * @param  array $transitions Result of get_role_permitted_transitions().
     * @return array Destination stage key => transition.
     */
    private function by_destination( array $transitions ): array
    {
        $indexed = array();
        foreach ( $transitions as $transition ) {
            $indexed[ $transition['to'] ] = $transition;
        }
        return $indexed;
    }

    // =========================================================================
    // The gate's scope
    // =========================================================================

    /**
     * The one definition of where the required-field gate applies, read off the
     * regions an edge joins. Entering publish from anywhere else qualifies;
     * everything else — a move inside one region, a crossing between two
     * non-publish regions in either direction, and a move that is already
     * publish-side on both ends — does not.
     */
    public function test_crosses_into_publish_reads_the_regions_an_edge_joins(): void
    {
        $this->assertTrue( Sequence::crosses_into_publish( 'draft', 'publish' ) );
        $this->assertTrue( Sequence::crosses_into_publish( 'pending', 'publish' ) );
        $this->assertTrue( Sequence::crosses_into_publish( 'private', 'publish' ) );

        $this->assertFalse( Sequence::crosses_into_publish( 'publish', 'publish' ) );
        $this->assertFalse( Sequence::crosses_into_publish( 'publish', 'draft' ) );
        $this->assertFalse( Sequence::crosses_into_publish( 'draft', 'pending' ) );
        $this->assertFalse( Sequence::crosses_into_publish( 'pending', 'draft' ) );
        $this->assertFalse( Sequence::crosses_into_publish( 'draft', 'draft' ) );
    }

    // =========================================================================
    // Which fields are missing
    // =========================================================================

    /**
     * An empty required field is reported with the config a caller needs to name
     * it — its authored label, and the namespaced meta key it was read from.
     */
    public function test_missing_required_metadata_names_the_empty_field(): void
    {
        $this->stub_section_value( '' );

        $missing = $this->sequence( true )->get_missing_required_metadata( self::POST_ID );

        $this->assertCount( 1, $missing );
        $this->assertSame( 'section', $missing[0]['key'] );
        $this->assertSame( 'Section', $missing[0]['label'] );
        $this->assertSame( 'wf_meta_1_section', $missing[0]['meta_key'] );
    }

    /**
     * A filled field is not missing, and an optional one is never asked about.
     */
    public function test_filled_and_optional_fields_are_not_missing(): void
    {
        $this->stub_section_value( 'Politics' );
        $this->assertSame( array(), $this->sequence( true )->get_missing_required_metadata( self::POST_ID ) );

        $this->stub_section_value( '' );
        $this->assertSame( array(), $this->sequence( false )->get_missing_required_metadata( self::POST_ID ) );
    }

    // =========================================================================
    // The projection
    // =========================================================================

    /**
     * The move the gate will refuse is offered locked, with the empty field
     * named — so the board can render it as unavailable instead of accepting a
     * drop it is about to have rolled back.
     */
    public function test_an_empty_required_field_locks_the_edge_into_publish(): void
    {
        $this->stub_editor();
        $this->stub_section_value( '' );

        $offered = $this->by_destination(
            $this->sequence( true )->get_role_permitted_transitions( 'review', 5, self::POST_ID )
        );

        $this->assertTrue( $offered['published']['_locked'] );
        $this->assertStringContainsString( 'Section', $offered['published']['_locked_reason'] );
    }

    /**
     * And nothing else is. The retreat out of review stays unlocked — it is the
     * move that gets the post back to where the field can be filled — and so
     * does the step that only crosses draft into pending, which is nowhere near
     * the publish boundary the fields are a condition of.
     *
     * A projection wider than the gate is the same bug as one narrower than it:
     * the board would render a move as unavailable that the server performs
     * without complaint, and the author would have no way to find that out.
     */
    public function test_no_edge_short_of_publish_is_locked(): void
    {
        $this->stub_editor();
        $this->stub_section_value( '' );

        $sequence = $this->sequence( true );

        $from_review = $this->by_destination(
            $sequence->get_role_permitted_transitions( 'review', 5, self::POST_ID )
        );
        $this->assertArrayNotHasKey( '_locked', $from_review['draft'] );

        $from_draft = $this->by_destination(
            $sequence->get_role_permitted_transitions( 'draft', 5, self::POST_ID )
        );
        $this->assertArrayNotHasKey( '_locked', $from_draft['review'] );
    }

    /**
     * Nothing is locked once the field is filled.
     */
    public function test_a_filled_field_locks_nothing(): void
    {
        $this->stub_editor();
        $this->stub_section_value( 'Politics' );

        $offered = $this->by_destination(
            $this->sequence( true )->get_role_permitted_transitions( 'review', 5, self::POST_ID )
        );

        $this->assertArrayNotHasKey( '_locked', $offered['draft'] );
        $this->assertArrayNotHasKey( '_locked', $offered['published'] );
    }

    /**
     * Without a post there is nothing to read meta from, so no field can be
     * judged missing. can_user_transition() calls through this path with no post
     * context; a projection that guessed there would answer "locked" for every
     * post in the site at once.
     */
    public function test_no_post_context_means_no_lock(): void
    {
        $this->stub_editor();
        Functions\expect( 'get_post_meta' )->never();

        // Asked from `review`, whose `published` edge is exactly the one a post
        // context would have locked — so this proves the missing context, not
        // the narrowed scope.
        $offered = $this->by_destination(
            $this->sequence( true )->get_role_permitted_transitions( 'review', 5 )
        );

        $this->assertArrayNotHasKey( '_locked', $offered['published'] );
    }

    /**
     * A locked edge is still OFFERED — the lock is a reason attached to the
     * transition, not a removal. Surfaces render it disabled with the reason
     * showing; dropping it from the list instead would make the move vanish with
     * no explanation, and would change what can_user_transition() answers.
     */
    public function test_a_locked_edge_is_still_listed(): void
    {
        $this->stub_editor();
        $this->stub_section_value( '' );

        $offered = $this->by_destination(
            $this->sequence( true )->get_role_permitted_transitions( 'review', 5, self::POST_ID )
        );

        $this->assertCount( 2, $offered );
        $this->assertArrayHasKey( 'published', $offered );
        $this->assertTrue( $offered['published']['_locked'] );
    }

    // =========================================================================
    // Naming the rule
    // =========================================================================

    /**
     * The lock says which rule is holding the edge, not just that something is.
     *
     * `_locked_reason` is prose for a reader; `_locked_code` is the same fact for
     * code, and the block editor needs it. Fields typed into the sidebar are
     * editor-store edits until the post is saved, so the editor holds meta this
     * projection has not seen — it re-judges THIS lock against what the author
     * has actually filled in, and takes every other lock (role, assignment,
     * capability) on trust. Without a name on the lock it cannot tell them
     * apart, and either re-judges all of them or none.
     */
    public function test_the_metadata_lock_names_the_rule_holding_it(): void
    {
        $this->stub_editor();
        $this->stub_section_value( '' );

        $offered = $this->by_destination(
            $this->sequence( true )->get_role_permitted_transitions( 'review', 5, self::POST_ID )
        );

        $this->assertSame(
            Sequence::CODE_REQUIRED_METADATA,
            $offered['published']['_locked_code']
        );

        // And the same string the transition endpoint refuses with, so the
        // editor's projected view of the rule and the 422 that enforces it are
        // one name rather than two that have to be kept in step.
        $this->assertSame( 'required_fields_missing', Sequence::CODE_REQUIRED_METADATA );
    }

    /**
     * An edge nothing is holding carries no rule name.
     */
    public function test_an_unlocked_edge_names_no_rule(): void
    {
        $this->stub_editor();
        $this->stub_section_value( 'Politics' );

        $offered = $this->by_destination(
            $this->sequence( true )->get_role_permitted_transitions( 'review', 5, self::POST_ID )
        );

        $this->assertArrayNotHasKey( '_locked_code', $offered['published'] );
    }

    /**
     * Build a StatusManager over a real Sequence, wired with mocked collaborators.
     *
     * @param  Sequence $sequence Sequence the repository resolves the post to.
     * @return StatusManager
     */
    private function status_manager( Sequence $sequence ): StatusManager
    {
        $repository = Mockery::mock( SequenceRepository::class );
        $repository->shouldReceive( 'find' )->andReturn( $sequence );

        $post_type_manager = Mockery::mock( PostTypeManager::class );
        $post_type_manager->shouldReceive( 'get_unprefixed_status' )->andReturnUsing( fn( $s ) => $s );
        $post_type_manager->shouldReceive( 'get_prefixed_status' )->andReturnUsing( fn( $s ) => 'wf_test_' . $s );

        return new StatusManager( $repository, $post_type_manager );
    }

    /**
     * The rule name survives the trip to the client.
     *
     * get_available_transitions() rebuilds each transition from an explicit
     * ALLOWLIST — a key absent from that list never reaches the editor, the board
     * or My Queue, and the omission is silent. So the projection carrying
     * `_locked_code` proves nothing on its own: this drives the payload the
     * status endpoint actually serves and looks for the code on the other side.
     */
    public function test_the_lock_code_survives_the_status_payload_allowlist(): void
    {
        $this->stub_editor();

        $sequence = $this->sequence( true );

        Functions\when( 'get_post' )->justReturn( $this->create_mock_post( array( 'ID' => self::POST_ID ) ) );
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key = '', $single = false ) {
                if ( '_vip_workflow_sequence_id' === $key ) {
                    return 1;
                }
                if ( '_vip_workflow_current_stage_key' === $key ) {
                    return 'review';
                }
                // Including 'wf_meta_1_section': the field is empty, which is
                // what puts the lock on the publish edge in the first place.
                return '';
            }
        );

        // The crossing capability is granted, so the edge survives the filter
        // that runs after the projection and is offered locked rather than
        // withheld outright.
        Functions\when( 'current_user_can' )->justReturn( true );
        Functions\when( 'user_can' )->justReturn( true );
        Functions\when( 'get_post_type' )->justReturn( 'post' );
        Functions\when( 'get_post_type_object' )->justReturn(
            (object) array(
                'cap' => (object) array(
                    'publish_posts'        => 'publish_posts',
                    'edit_published_posts' => 'edit_published_posts',
                ),
            )
        );

        $offered = $this->by_destination(
            $this->status_manager( $sequence )->get_available_transitions( self::POST_ID, 5 )
        );

        $this->assertTrue( $offered['published']['_locked'] );
        $this->assertSame(
            Sequence::CODE_REQUIRED_METADATA,
            $offered['published']['_locked_code']
        );
        $this->assertStringContainsString( 'Section', $offered['published']['_locked_reason'] );
    }
}
