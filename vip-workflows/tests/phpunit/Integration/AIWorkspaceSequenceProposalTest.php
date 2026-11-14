<?php
/**
 * The AI Workspace `workflow` proposal kind, end to end against the real sequence write path.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\AiWorkspace\AIWorkspace;
use VIPWorkflows\AiWorkspace\SequenceProposal;
use VIPWorkflows\Sequences\SequenceRepository;
use WordPress\AI\Experiments\AI_Workspace\Proposal_Kind;

require_once dirname( __DIR__ ) . '/stubs/ai-workspace.php';

/**
 * Drives SequenceProposal the way the AI plugin's proposal store and controller do.
 */
class AIWorkspaceSequenceProposalTest extends TestCase
{
    private SequenceProposal $kind;

    public function set_up(): void
    {
        parent::set_up();

        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

        $this->kind = new SequenceProposal();
    }

    /**
     * A three-stage workflow, as the model would propose it.
     *
     * @return array<string, mixed>
     */
    private function proposed(): array
    {
        return array(
            'name'        => 'Legal-reviewed explainers',
            'description' => 'Explainers pass legal review before they publish.',
            'post_types'  => array( 'post' ),
            'statuses'    => array(
                array(
                    'key'         => 'drafting',
                    'label'       => 'Drafting',
                    'status'      => 'draft',
                    'transitions' => array( array( 'to' => 'legal-review' ) ),
                ),
                array(
                    'key'         => 'legal-review',
                    'label'       => 'Legal review',
                    'status'      => 'pending',
                    'transitions' => array(
                        array( 'to' => 'drafting' ),
                        array( 'to' => 'published' ),
                    ),
                ),
                array(
                    'key'         => 'published',
                    'label'       => 'Published',
                    'status'      => 'publish',
                    'is_terminal' => true,
                ),
            ),
            // A field the kind does not own, such as a summary the model wrote, is dropped.
            'summary'     => 'I will create a great workflow.',
        );
    }

    /**
     * A stored proposal of one item, as the AI plugin's store builds it.
     *
     * @param array<string, string> $item The normalized item.
     * @return array<string, mixed>
     */
    private function stored( array $item ): array
    {
        return array(
            'id'              => 'proposal-1',
            'conversation_id' => 'conversation-1',
            'items'           => array( array_merge( array( 'key' => 'item-1' ), $item ) ),
        );
    }

    public function test_the_module_adds_the_kind_when_the_ai_workspace_is_loaded(): void
    {
        $this->assertTrue( AIWorkspace::is_available() );

        $kinds = ( new AIWorkspace() )->add_proposal_kind( array() );

        $this->assertCount( 1, $kinds );
        $this->assertInstanceOf( SequenceProposal::class, $kinds[0] );
    }

    public function test_the_kind_is_a_single_item_create_kind_gated_on_manage_options(): void
    {
        $this->assertSame( 'workflow', $this->kind->name() );
        $this->assertSame( 'vip-workflows/propose-sequence', $this->kind->ability() );
        $this->assertSame( 'manage_options', $this->kind->capability() );
        $this->assertSame( 1, $this->kind->max_items() );
        $this->assertFalse( $this->kind->is_update() );
        $this->assertFalse( $this->kind->accepts_edits() );
        $this->assertNotSame( '', $this->kind->instruction() );
    }

    public function test_normalize_keeps_only_the_kinds_fields(): void
    {
        $item = $this->kind->normalize_item( $this->proposed() );

        $this->assertIsArray( $item );
        $this->assertSame( array( 'name', 'description', 'statuses', 'post_types' ), array_keys( $item ) );
        $this->assertContainsOnly( 'string', $item );
        $this->assertSame( 'Legal-reviewed explainers', $item['name'] );
        $this->assertSame( array( 'post' ), json_decode( $item['post_types'], true ) );
    }

    public function test_normalize_refuses_a_stage_graph_the_write_gate_would_refuse(): void
    {
        $proposed                                          = $this->proposed();
        $proposed['statuses'][0]['transitions'][0]['to'] = 'nowhere';

        $result = $this->kind->normalize_item( $proposed );

        $this->assertWPError( $result );
        $this->assertSame( 'vip_workflows_proposal_invalid_sequence', $result->get_error_code() );
    }

    public function test_normalize_refuses_a_missing_name_stages_or_post_type(): void
    {
        $no_name         = $this->proposed();
        $no_name['name'] = '  ';
        $this->assertSame( 'vip_workflows_proposal_missing_name', $this->kind->normalize_item( $no_name )->get_error_code() );

        $no_stages = $this->proposed();
        unset( $no_stages['statuses'] );
        $this->assertSame( 'vip_workflows_proposal_missing_statuses', $this->kind->normalize_item( $no_stages )->get_error_code() );

        $no_types               = $this->proposed();
        $no_types['post_types'] = array();
        $this->assertSame( 'vip_workflows_proposal_missing_post_types', $this->kind->normalize_item( $no_types )->get_error_code() );

        $unknown_type               = $this->proposed();
        $unknown_type['post_types'] = array( 'not_a_post_type' );
        $this->assertSame( 'vip_workflows_proposal_unknown_post_type', $this->kind->normalize_item( $unknown_type )->get_error_code() );
    }

    public function test_the_card_shows_the_stages_in_order_as_a_draft_workflow(): void
    {
        $presented = $this->kind->present_item( $this->kind->normalize_item( $this->proposed() ) );

        $this->assertSame(
            array(
                'title'     => 'Legal-reviewed explainers',
                'post_type' => 'workflow',
                'status'    => 'draft',
                'excerpt'   => 'Explainers pass legal review before they publish.',
                'content'   => 'Drafting → Legal review → Published',
            ),
            $presented
        );
    }

    public function test_approval_creates_the_sequence_as_a_draft_and_reports_every_count(): void
    {
        $proposal = $this->stored( $this->kind->normalize_item( $this->proposed() ) );
        $reported = array();

        $results = $this->kind->write(
            $proposal,
            array( 'item-1' ),
            static function ( array $outcome ) use ( &$reported ): void {
                $reported[] = $outcome;
            }
        );

        foreach ( Proposal_Kind::OUTCOMES as $count ) {
            $this->assertArrayHasKey( $count, $results );
        }
        $this->assertSame( 1, $results['created'] );
        $this->assertSame( $results['items'], $reported );

        $outcome = $results['items'][0];
        $this->assertSame( 'created', $outcome['outcome'] );
        $this->assertSame( 'item-1', $outcome['key'] );
        $this->assertSame( SequenceProposal::edit_link( $outcome['post_id'] ), $outcome['edit_link'] );
        $this->assertStringContainsString( 'page=vip-workflows-sequences#/edit/', $outcome['edit_link'] );

        $sequence = ( new SequenceRepository() )->find( $outcome['post_id'] );
        $this->assertNotNull( $sequence );
        $this->assertSame( 'Legal-reviewed explainers', $sequence->name );
        $this->assertSame( 'draft', $sequence->status );
        $this->assertSame( array( 'post' ), $sequence->config['post_types'] );
        $this->assertCount( 3, $sequence->config['statuses'] );
    }

    public function test_a_deselected_item_writes_nothing(): void
    {
        $results = $this->kind->write( $this->stored( $this->kind->normalize_item( $this->proposed() ) ), array() );

        $this->assertSame( 1, $results['deselected'] );
        $this->assertSame( 0, $results['created'] );
        $this->assertSame( '', $results['items'][0]['edit_link'] );
        $this->assertFalse( ( new SequenceRepository() )->slug_exists( 'legal-reviewed-explainers', 'workflow' ) );
    }

    public function test_approval_is_denied_when_the_capability_was_revoked_after_the_proposal(): void
    {
        $proposal = $this->stored( $this->kind->normalize_item( $this->proposed() ) );

        wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

        $results = $this->kind->write( $proposal, array( 'item-1' ) );

        $this->assertSame( 1, $results['denied'] );
        $this->assertSame( 'cannot_manage_options', $results['items'][0]['error_code'] );
        $this->assertFalse( ( new SequenceRepository() )->slug_exists( 'legal-reviewed-explainers', 'workflow' ) );
    }
}
