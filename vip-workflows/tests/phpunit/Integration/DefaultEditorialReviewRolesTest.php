<?php
/**
 * Who may approve in the Editorial Review sequence a new install seeds.
 *
 * The seeded sequence names its reviewers, but reviewer_roles only decides who
 * may claim a post. Who may move it is decided per transition, by
 * allowed_roles, so Approve has to carry the restriction itself or an author
 * can approve their own post.
 *
 * Both lists come from the site's own roles at seed time: every role that can
 * edit other people's posts. Sites replace and rename the core roles, so a
 * fixed list of `editor` and `administrator` could leave approval to
 * administrators alone, or to nobody.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Database\Seeder;
use VIPWorkflows\Sequences\Sequence;
use VIPWorkflows\Sequences\SequenceRepository;

class DefaultEditorialReviewRolesTest extends TestCase
{
    /**
     * Roles a test added, removed again in tear_down().
     *
     * @var string[]
     */
    private array $added_roles = array();

    public function tear_down(): void
    {
        foreach ( $this->added_roles as $role ) {
            remove_role( $role );
        }
        $this->added_roles = array();

        parent::tear_down();
    }

    /**
     * Add a role for the length of one test.
     *
     * @param string              $slug         Role slug.
     * @param array<string, bool> $capabilities Capabilities.
     */
    private function add_test_role( string $slug, array $capabilities ): void
    {
        add_role( $slug, ucwords( str_replace( '_', ' ', $slug ) ), $capabilities );
        $this->added_roles[] = $slug;
    }

    /**
     * The sequence exactly as a new install seeds it, given the site's roles now.
     */
    private function seeded_sequence(): Sequence
    {
        $repository = new SequenceRepository();

        // The tests environment is seeded once up front, and the seeder skips a
        // sequence that already exists. Remove it (the test's transaction puts
        // it back) so this reads what the seeder writes today.
        $existing = $repository->find_by_slug( 'editorial-review' );
        if ( $existing ) {
            $repository->delete( (int) $existing->id );
        }

        ( new Seeder() )->seed();

        $sequence = $repository->find_by_slug( 'editorial-review' );
        $this->assertInstanceOf( Sequence::class, $sequence );

        return $sequence;
    }

    /**
     * @return array<string, array{0: string, 1: bool}>
     */
    public static function approver_provider(): array
    {
        return array(
            'author'        => array( 'author', false ),
            'contributor'   => array( 'contributor', false ),
            'editor'        => array( 'editor', true ),
            'administrator' => array( 'administrator', true ),
        );
    }

    /**
     * @dataProvider approver_provider
     */
    public function test_on_a_stock_site_only_editors_and_administrators_can_approve( string $role, bool $can_approve ): void
    {
        $sequence = $this->seeded_sequence();
        $user_id  = (int) self::factory()->user->create( array( 'role' => $role ) );

        $this->assertSame( $can_approve, $sequence->can_user_transition( 'review', 'ready', $user_id ) );
    }

    public function test_an_author_can_still_submit_and_withdraw(): void
    {
        $sequence  = $this->seeded_sequence();
        $author_id = (int) self::factory()->user->create( array( 'role' => 'author' ) );

        $this->assertTrue( $sequence->can_user_transition( 'draft', 'review', $author_id ), 'Submit for review stays open to the author.' );
        $this->assertTrue( $sequence->can_user_transition( 'review', 'draft', $author_id ), 'Request changes stays open, so an author can pull a post back.' );
    }

    public function test_a_custom_editor_level_role_can_approve_and_claim(): void
    {
        $this->add_test_role(
            'managing_editor',
            array(
                'read'              => true,
                'edit_posts'        => true,
                'edit_others_posts' => true,
            )
        );
        $this->add_test_role(
            'staff_writer',
            array(
                'read'       => true,
                'edit_posts' => true,
            )
        );

        $sequence = $this->seeded_sequence();
        $managing = (int) self::factory()->user->create( array( 'role' => 'managing_editor' ) );
        $writer   = (int) self::factory()->user->create( array( 'role' => 'staff_writer' ) );

        $this->assertTrue( $sequence->can_user_transition( 'review', 'ready', $managing ) );
        $this->assertTrue( $sequence->can_user_claim( $managing ) );
        $this->assertFalse( $sequence->can_user_transition( 'review', 'ready', $writer ) );
    }

    public function test_reviewer_roles_name_only_roles_the_site_has(): void
    {
        $sequence = $this->seeded_sequence();

        foreach ( $sequence->get_reviewer_roles() as $role ) {
            $this->assertNotNull( get_role( $role ), "Seeded reviewer role {$role} does not exist." );
        }
    }

    public function test_approve_is_left_open_when_no_role_can_review(): void
    {
        // A site where no role can edit other people's posts.
        add_filter(
            'role_has_cap',
            static function ( array $capabilities ): array {
                unset( $capabilities['edit_others_posts'] );
                return $capabilities;
            }
        );

        $sequence  = $this->seeded_sequence();
        $author_id = (int) self::factory()->user->create( array( 'role' => 'author' ) );

        $this->assertTrue(
            $sequence->can_user_transition( 'review', 'ready', $author_id ),
            'With nobody able to review, a restricted Approve would leave every submitted post stuck.'
        );
    }
}
