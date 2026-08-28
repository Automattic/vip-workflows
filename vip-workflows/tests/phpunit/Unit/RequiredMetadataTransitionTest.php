<?php
/**
 * A required metadata field is a requirement, not a decoration.
 *
 * The sequence editor offers a "Required" toggle on every metadata field and
 * the editor sidebar appends a `*` to its label — and for a long time that was
 * the whole of it: nothing anywhere read the flag, so a post could walk the
 * entire workflow with every required field blank. The gate now lives beside
 * the one for a transition's required TOOLS, in StatusManager::transition(), so
 * the two things the editor calls "required" refuse the same move in the same
 * shape.
 *
 * These cover the guard's three contracts: WHERE it applies (a crossing into the
 * publish region, and nowhere else — a field declared once for a whole sequence
 * cannot honestly be demanded at every step of it), which fields it consults
 * (only those of the post's own sequence, resolved through their namespaced
 * meta keys) and what it calls empty (a per-type rule, never `empty()` — a `0` a
 * person typed is an answer).
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
 * @covers \VIPWorkflow\Workflow\StatusManager::check_required_metadata
 * @covers \VIPWorkflow\Sequences\Sequence::metadata_value_is_empty
 */
class RequiredMetadataTransitionTest extends TestCase
{
    /**
     * The sequence the fixture post is seated in.
     */
    private const SEQUENCE_ID = 1;

    /**
     * Sequence repository mock.
     *
     * @var SequenceRepository|Mockery\MockInterface
     */
    private $sequence_repository;

    /**
     * Status manager under test.
     *
     * @var StatusManager
     */
    private StatusManager $status_manager;

    /**
     * Audit-log rows the guard wrote.
     *
     * @var array
     */
    private array $logged_events = array();

    protected function setUp(): void
    {
        parent::setUp();

        $this->sequence_repository = Mockery::mock( SequenceRepository::class );

        $this->status_manager = new StatusManager(
            $this->sequence_repository,
            Mockery::mock( PostTypeManager::class )
        );
    }

    // =========================================================================
    // Fixture
    // =========================================================================

    /**
     * A two-stage sequence — draft -> review, with review -> draft back —
     * carrying the metadata fields a test hands in, with each stage seated in
     * the status region the caller names.
     *
     * The default is the shape the gate actually covers: a forward edge that
     * crosses into `publish`. Every emptiness, scoping and exemption test below
     * drives that edge, so each of them exercises a move the gate is asked
     * about at all. The scope tests name their own regions.
     *
     * @param  array  $metadata_fields Field configs for the sequence.
     * @param  string $from_region     Region the `draft` stage sits in.
     * @param  string $to_region       Region the `review` stage sits in.
     * @return Sequence
     */
    private function sequence_with_fields( array $metadata_fields, string $from_region = 'draft', string $to_region = 'publish' ): Sequence
    {
        $config = array(
            'statuses'        => array(
                array(
                    'key'          => 'draft',
                    'label'        => 'Draft',
                    'status'       => $from_region,
                    'region_entry' => true,
                    'transitions'  => array( array( 'to' => 'review', 'label' => 'Submit for Review' ) ),
                ),
                array(
                    'key'          => 'review',
                    'label'        => 'In Review',
                    'status'       => $to_region,
                    // Exactly one entry stage per region in use: `review` owns
                    // its own only when it is not sharing `draft`'s.
                    'region_entry' => $to_region !== $from_region,
                    'transitions'  => array( array( 'to' => 'draft', 'label' => 'Send back' ) ),
                ),
            ),
            'metadata_fields' => $metadata_fields,
        );

        $row = (object) array(
            'id'          => self::SEQUENCE_ID,
            'uuid'        => 'test-uuid-' . self::SEQUENCE_ID,
            'type'        => Sequence::TYPE_WORKFLOW,
            'name'        => 'Required Fields',
            'slug'        => 'required-fields',
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
     * Wire every stub a draft -> review transition by a human editor needs, and
     * seat the post in a sequence carrying $metadata_fields with $meta stored.
     *
     * The default regions make that edge a crossing into `publish`, so the gate
     * is in scope unless a test says otherwise.
     *
     * @param array  $metadata_fields Sequence metadata field configs.
     * @param array  $meta            Stored post meta, keyed by full meta key.
     * @param string $from_region     Region the `draft` stage sits in.
     * @param string $to_region       Region the `review` stage sits in.
     */
    private function stub_transition( array $metadata_fields, array $meta = array(), string $from_region = 'draft', string $to_region = 'publish' ): void
    {
        $this->stub_transition_from(
            $this->sequence_with_fields( $metadata_fields, $from_region, $to_region ),
            'draft',
            $meta
        );
    }

    /**
     * The same wiring, for a post seated somewhere other than the sequence's
     * first stage — the shape a retreat needs, where the move under test starts
     * at `review` and goes back.
     *
     * @param Sequence $sequence  Sequence the post is seated in.
     * @param string    $from_stage Stage key the post currently occupies.
     * @param array     $meta       Stored post meta, keyed by full meta key.
     */
    private function stub_transition_from( Sequence $sequence, string $from_stage, array $meta = array() ): void
    {
        $post_status = $sequence->get_stage_status( $from_stage );
        $post        = $this->create_mock_post( array( 'ID' => 1, 'post_status' => $post_status ) );

        $meta[ '_vip_workflow_sequence_id' ]  = (string) self::SEQUENCE_ID;
        $meta[ StatusManager::STAGE_META_KEY ] = $from_stage;

        Functions\when( 'get_post' )->justReturn( $post );
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key = '', $single = false ) use ( $meta ) {
                return $meta[ $key ] ?? '';
            }
        );

        $this->sequence_repository
            ->shouldReceive( 'find' )
            ->with( self::SEQUENCE_ID )
            ->andReturn( $sequence );

        // A plain editor: not a bypass role for either escape hatch.
        Functions\when( 'get_current_user_id' )->justReturn( 5 );
        Functions\when( 'get_userdata' )->justReturn(
            (object) array( 'roles' => array( 'editor' ), 'display_name' => 'Test Editor' )
        );
        Functions\when( 'get_option' )->justReturn( array() );
        Functions\when( 'get_post_type_object' )->justReturn(
            (object) array(
                'cap' => (object) array(
                    'publish_posts'        => 'publish_posts',
                    'edit_published_posts' => 'edit_published_posts',
                ),
            )
        );
        Functions\when( 'current_user_can' )->justReturn( true );
        Functions\when( 'get_post_status' )->justReturn( $post_status );

        // Stands in for core's list join, which the refusal sentence uses in
        // place of a hardcoded ", ". Unit tests run without WordPress, and only
        // the '%l' conversion is reached from here. Deliberately simpler than
        // the real thing, which reads "a and b" / "a, b, and c": no assertion
        // depends on the separator, they look for each label on its own, so
        // they hold against core's wording too. Implement the real shape before
        // asserting on a whole sentence.
        Functions\when( 'wp_sprintf' )->alias(
            function ( string $pattern, ...$args ): string {
                if ( '%l' === $pattern ) {
                    return implode( ', ', (array) ( $args[0] ?? array() ) );
                }

                return sprintf( $pattern, ...$args );
            }
        );
        Functions\when( 'update_post_meta' )->justReturn( true );
        Functions\when( 'do_action' )->justReturn( null );
        // Only reached by a region-crossing move: commit_post_status() writes the
        // target region and reads the committed value back. The same-region
        // fixtures never get here.
        Functions\when( 'wp_update_post' )->justReturn( 1 );

        $this->capture_audit_log();
    }

    /**
     * Capture the audit-log inserts so a refusal can be checked for having been
     * recorded, the way a blocked tool check is.
     */
    private function capture_audit_log(): void
    {
        global $wpdb;

        $events = &$this->logged_events;

        $wpdb            = Mockery::mock( 'wpdb' );
        $wpdb->prefix    = 'wp_';
        $wpdb->insert_id = 1;
        $wpdb->shouldReceive( 'insert' )->andReturnUsing(
            function ( $table, $data ) use ( &$events ) {
                $events[] = $data;
                return true;
            }
        );
    }

    /**
     * Re-point the two bypass settings at a role the fixture user holds.
     *
     * The fixture wires a plain `editor` against the default bypass lists, so a
     * test that needs one hatch open and the other shut says so by naming the
     * roles for each, and by making the user a `chief`.
     *
     * @param array $workflow_roles   Roles in `bypass_workflow_roles`.
     * @param array $tool_check_roles Roles in `bypass_tool_check_roles`.
     */
    private function stub_bypass_roles( array $workflow_roles, array $tool_check_roles ): void
    {
        Functions\when( 'get_userdata' )->justReturn(
            (object) array( 'roles' => array( 'chief' ), 'display_name' => 'Chief Editor' )
        );
        Functions\when( 'get_option' )->justReturn(
            array(
                'bypass_workflow_roles'   => $workflow_roles,
                'bypass_tool_check_roles' => $tool_check_roles,
            )
        );
    }

    /**
     * A `text` field config.
     *
     * @param  string $key      Field key.
     * @param  string $label    Field label.
     * @param  bool   $required Whether the field is required.
     * @return array
     */
    private static function text_field( string $key, string $label, bool $required ): array
    {
        return array( 'key' => $key, 'label' => $label, 'type' => 'text', 'required' => $required );
    }

    /**
     * Full meta key for a field on the fixture sequence.
     *
     * @param  string $key          Field key.
     * @param  int    $sequence_id Sequence the field belongs to.
     * @return string
     */
    private static function meta_key( string $key, int $sequence_id = self::SEQUENCE_ID ): string
    {
        return 'wf_meta_' . $sequence_id . '_' . $key;
    }

    // =========================================================================
    // Blocked / allowed
    // =========================================================================

    /**
     * An empty required field holds the transition, and the refusal says which
     * field by its authored label — the same actionable shape a failed required
     * tool produces, so the editor's existing dialog renders it unchanged.
     */
    public function test_empty_required_field_blocks_the_transition(): void
    {
        $this->stub_transition( array( self::text_field( 'section', 'Section', true ) ) );

        $result = $this->status_manager->transition( 1, 'review' );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'required_fields_missing', $result->get_error_code() );

        $data = $result->get_error_data();
        $this->assertSame( 422, $data['status'] );
        $this->assertStringContainsString( 'Section', $result->get_error_message() );

        $this->assertCount( 1, $data['hard_failures'] );
        $this->assertSame( 'section', $data['hard_failures'][0]['field'] );
        $this->assertSame( 'Section', $data['hard_failures'][0]['label'] );
        // The label names the field; the message says what is wrong with it and
        // does not name it again. ToolFailuresModal prints the two as
        // "{label}: {message}", so a message that repeated the label read
        // "Section: Section is required and has no value."
        $this->assertStringNotContainsString( 'Section', $data['hard_failures'][0]['message'] );
        $this->assertStringContainsString( 'required', $data['hard_failures'][0]['message'] );
        $this->assertSame( 'hard', $data['hard_failures'][0]['severity'] );
    }

    /**
     * Every empty required field is named, not just the first: a person fixing
     * this should have to come back once, not once per field.
     */
    public function test_every_empty_required_field_is_named(): void
    {
        $this->stub_transition(
            array(
                self::text_field( 'section', 'Section', true ),
                self::text_field( 'desk', 'Desk', true ),
            )
        );

        $result = $this->status_manager->transition( 1, 'review' );

        $this->assertCount( 2, $result->get_error_data()['hard_failures'] );
        $this->assertStringContainsString( 'Section', $result->get_error_message() );
        $this->assertStringContainsString( 'Desk', $result->get_error_message() );
    }

    /**
     * A filled required field is no obstacle.
     */
    public function test_filled_required_field_allows_the_transition(): void
    {
        $this->stub_transition(
            array( self::text_field( 'section', 'Section', true ) ),
            array( self::meta_key( 'section' ) => 'Politics' )
        );

        $this->assertTrue( $this->status_manager->transition( 1, 'review' ) );
    }

    /**
     * A field that is not required may be left empty forever.
     */
    public function test_optional_field_left_empty_allows_the_transition(): void
    {
        $this->stub_transition( array( self::text_field( 'section', 'Section', false ) ) );

        $this->assertTrue( $this->status_manager->transition( 1, 'review' ) );
    }

    /**
     * Whitespace is not an answer: a field holding only spaces reads empty.
     */
    public function test_whitespace_only_value_is_empty(): void
    {
        $this->stub_transition(
            array( self::text_field( 'section', 'Section', true ) ),
            array( self::meta_key( 'section' ) => "  \n\t " )
        );

        $result = $this->status_manager->transition( 1, 'review' );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'required_fields_missing', $result->get_error_code() );
    }

    /**
     * The refusal reaches the audit trail, the way a blocked tool check does.
     */
    public function test_the_refusal_is_logged(): void
    {
        $this->stub_transition( array( self::text_field( 'section', 'Section', true ) ) );

        $this->status_manager->transition( 1, 'review' );

        $blocked = array_values(
            array_filter( $this->logged_events, fn( $row ) => 'transition_blocked' === $row['event_type'] )
        );

        $this->assertCount( 1, $blocked );
        $this->assertStringContainsString( 'Section', $blocked[0]['event_data'] );
    }

    // =========================================================================
    // What counts as empty
    // =========================================================================

    /**
     * A `user` field cleared in the editor stores 0 — the canonical "no user"
     * sentinel, because the meta is registered as an integer and an empty
     * string fails that schema before any sanitiser runs. 0 is empty.
     */
    public function test_user_field_cleared_to_zero_blocks_the_transition(): void
    {
        $this->stub_transition(
            array( array( 'key' => 'lead', 'label' => 'Lead editor', 'type' => 'user', 'required' => true ) ),
            array( self::meta_key( 'lead' ) => 0 )
        );

        $result = $this->status_manager->transition( 1, 'review' );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'required_fields_missing', $result->get_error_code() );
        $this->assertSame( 'Lead editor', $result->get_error_data()['hard_failures'][0]['label'] );
    }

    /**
     * A `user` field holding a real id is filled in.
     */
    public function test_user_field_with_an_id_allows_the_transition(): void
    {
        $this->stub_transition(
            array( array( 'key' => 'lead', 'label' => 'Lead editor', 'type' => 'user', 'required' => true ) ),
            array( self::meta_key( 'lead' ) => 7 )
        );

        $this->assertTrue( $this->status_manager->transition( 1, 'review' ) );
    }

    /**
     * `'0'` on a non-user field is a value someone entered — a section named
     * "0", an option keyed "0" — and `empty()` would have called it blank.
     *
     * @dataProvider provide_non_user_zero_values
     *
     * @param string $type  Field type.
     * @param mixed  $value Stored value.
     */
    public function test_zero_on_a_non_user_field_is_not_empty( string $type, $value ): void
    {
        $field = array( 'key' => 'section', 'label' => 'Section', 'type' => $type, 'required' => true );

        if ( 'select' === $type ) {
            $field['options'] = array( '0', '1' );
        }

        $this->stub_transition( array( $field ), array( self::meta_key( 'section' ) => $value ) );

        $this->assertTrue(
            $this->status_manager->transition( 1, 'review' ),
            sprintf( 'A %s field holding "0" is filled in, not empty.', $type )
        );
    }

    /**
     * Every non-`user` type a literal zero can actually reach.
     *
     * `text` and `textarea` take whatever is typed, and a `select`'s authored
     * option list can contain "0". The fifth authorable type, `date`, stores
     * `Y-m-d` and has no way to hold one, so it has no case here — its share of
     * the rule is covered by test_whitespace_only_value_is_empty(), which
     * exercises the same string branch.
     *
     * @return array
     */
    public static function provide_non_user_zero_values(): array
    {
        return array(
            'text'     => array( 'text', '0' ),
            'textarea' => array( 'textarea', '0' ),
            'select'   => array( 'select', '0' ),
        );
    }

    // =========================================================================
    // Scoping
    // =========================================================================

    /**
     * Fields are read through their sequence-namespaced meta key, so a value
     * stored under ANOTHER sequence's copy of the same field key does not
     * satisfy this sequence's requirement.
     */
    public function test_another_sequences_value_does_not_satisfy_the_requirement(): void
    {
        $this->stub_transition(
            array( self::text_field( 'section', 'Section', true ) ),
            array( self::meta_key( 'section', 2 ) => 'Politics' )
        );

        $result = $this->status_manager->transition( 1, 'review' );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'required_fields_missing', $result->get_error_code() );
    }

    /**
     * And the converse: this sequence's own key is what is read, whatever
     * another sequence's same-named field happens to hold.
     */
    public function test_only_the_posts_own_sequence_fields_are_consulted(): void
    {
        $this->stub_transition(
            array( self::text_field( 'section', 'Section', true ) ),
            array(
                self::meta_key( 'section' )    => 'Politics',
                self::meta_key( 'section', 2 ) => '',
            )
        );

        $this->assertTrue( $this->status_manager->transition( 1, 'review' ) );
    }

    // =========================================================================
    // Exemptions
    // =========================================================================

    /**
     * A stage agent's own exit transition IS its run finishing. Blocking it
     * would strand the post mid-stage on an omission no agent can fix, so the
     * agent actor passes the gate the way it passes every other human-facing
     * check.
     */
    public function test_agent_actor_is_not_held_by_an_empty_required_field(): void
    {
        $this->stub_transition( array( self::text_field( 'section', 'Section', true ) ) );
        Functions\when( 'user_can' )->alias(
            fn( $user_id, $capability, $post_id = null ) => 7 === $user_id
                && ( ( 'edit_post' === $capability && 1 === $post_id ) || 'publish_posts' === $capability )
        );

        $result = $this->status_manager->transition(
            1,
            'review',
            array(
                'agent_actor'      => 'test/agent',
                'agent_actor_user' => 7,
            )
        );

        $this->assertTrue( $result );
    }

    /**
     * A workflow-bypass role is not held by an empty required field.
     *
     * The sibling gate on this transition — `requires_assignment` — has always
     * deferred to `bypass_workflow_roles`, and it is the same kind of rule: a
     * workflow requirement about the person performing the move, always within
     * that person's reach. Holding one and waiving the other was an
     * inconsistency rather than a decision, and it is the required-field gate
     * that had no escape at all.
     */
    public function test_workflow_bypass_role_is_not_held_by_an_empty_required_field(): void
    {
        $this->stub_transition( array( self::text_field( 'section', 'Section', true ) ) );
        $this->stub_bypass_roles( array( 'chief' ), array() );

        $this->assertTrue( $this->status_manager->transition( 1, 'review' ) );
    }

    /**
     * The TOOL-check bypass is a different escape hatch and does not open this
     * gate. It exists for checks that fail for reasons the author cannot reach
     * — a service that is down, a heuristic that will never agree. An empty
     * field is not one of those: the answer is to type it in.
     */
    public function test_tool_check_bypass_role_is_still_held_by_an_empty_required_field(): void
    {
        $this->stub_transition( array( self::text_field( 'section', 'Section', true ) ) );
        $this->stub_bypass_roles( array(), array( 'chief' ) );

        $result = $this->status_manager->transition( 1, 'review' );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'required_fields_missing', $result->get_error_code() );
    }

    // =========================================================================
    // Where the gate applies
    // =========================================================================

    /**
     * The crossing the gate exists for. A field the sequence declares once, for
     * the whole sequence, has exactly one deadline every stage agrees on: the
     * post going live. So the publish boundary is where it is asked for.
     */
    public function test_crossing_into_publish_is_held_by_an_empty_required_field(): void
    {
        $this->stub_transition( array( self::text_field( 'section', 'Section', true ) ), array(), 'draft', 'publish' );

        $result = $this->status_manager->transition( 1, 'review' );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'required_fields_missing', $result->get_error_code() );
    }

    /**
     * A move INSIDE one region is not.
     *
     * This is the complaint the scope answers. `required_tools` is declared on
     * one edge and asks its question there; a `required` field is declared on
     * the sequence and has no edge of its own, so demanding it everywhere made
     * one flag refuse every move in the sequence — starting with the first step
     * out of the entry stage, where a "Final headline" is precisely the thing
     * the author does not have yet.
     */
    public function test_move_within_a_non_publish_region_is_not_held(): void
    {
        $this->stub_transition( array( self::text_field( 'section', 'Section', true ) ), array(), 'draft', 'draft' );

        $this->assertTrue( $this->status_manager->transition( 1, 'review' ) );
    }

    /**
     * Nor is a crossing between two regions that are both short of publish —
     * Submit-for-review, in most sequences. The post is not going anywhere the
     * public can see it, so the omission has not run out of time.
     */
    public function test_crossing_between_two_non_publish_regions_is_not_held(): void
    {
        $this->stub_transition( array( self::text_field( 'section', 'Section', true ) ), array(), 'draft', 'pending' );

        $this->assertTrue( $this->status_manager->transition( 1, 'review' ) );
    }

    /**
     * Nor is a move that is already publish-side on both ends. The post is live;
     * the boundary the fields are a condition of was crossed some time ago, and
     * there is nothing left for this gate to defend.
     */
    public function test_move_between_two_publish_side_stages_is_not_held(): void
    {
        $this->stub_transition( array( self::text_field( 'section', 'Section', true ) ), array(), 'publish', 'publish' );

        $this->assertTrue( $this->status_manager->transition( 1, 'review' ) );
    }

    /**
     * An authored retreat is not held either — now by construction rather than
     * by a clause of its own. `publish` is the last region in the editorial
     * progression, so no edge entering it can be travelling backwards, and a
     * send-back is outside the gate's scope for the same reason every other
     * short-of-publish move is.
     *
     * The exemption still matters, and this pins it: fields declared
     * sequence-wide once froze a post with an empty field in BOTH directions,
     * and on a surface with no field editor (the board, My Queue) there was no
     * way out of the stage at all.
     */
    public function test_authored_retreat_is_not_held_by_an_empty_required_field(): void
    {
        $this->stub_transition_from(
            $this->sequence_with_fields( array( self::text_field( 'section', 'Section', true ) ), 'draft', 'publish' ),
            'review'
        );

        $this->assertTrue( $this->status_manager->transition( 1, 'draft' ) );
    }

    // =========================================================================
    // One rule, one place
    // =========================================================================

    /**
     * The guard does not own its emptiness rule — Sequence does, and the
     * metadata REST endpoint reads the same answer out of it. The two used to
     * decide separately and disagreed about whitespace, so a sync job could
     * read a field back as filled that the workflow refused to move past.
     *
     * @dataProvider provide_emptiness_cases
     *
     * @param string $type     Field type.
     * @param mixed  $value    Stored value.
     * @param bool   $expected Whether the value counts as empty.
     */
    public function test_the_shared_rule_decides_what_is_empty( string $type, $value, bool $expected ): void
    {
        $this->assertSame( $expected, Sequence::metadata_value_is_empty( $type, $value ) );
    }

    /**
     * @return array
     */
    public static function provide_emptiness_cases(): array
    {
        return array(
            'unset text'          => array( 'text', '', true ),
            'whitespace text'     => array( 'text', "  \n\t ", true ),
            'whitespace textarea' => array( 'textarea', '   ', true ),
            'filled text'         => array( 'text', 'Politics', false ),
            'zero text'           => array( 'text', '0', false ),
            'zero select'         => array( 'select', '0', false ),
            'unset date'          => array( 'date', '', true ),
            'filled date'         => array( 'date', '2026-08-18', false ),
            'cleared user'        => array( 'user', 0, true ),
            'unset user'          => array( 'user', '', true ),
            'assigned user'       => array( 'user', 7, false ),
        );
    }
}
