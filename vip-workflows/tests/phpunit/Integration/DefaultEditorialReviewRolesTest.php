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
use VIPWorkflows\Workflow\StatusManager;

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

        // Remove any existing sequence so this reads what the seeder writes
        // today. The test's transaction restores it after the test.
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

    public function test_seeding_requires_a_reviewer_role_and_can_be_retried(): void
    {
        $without_reviewers = static function ( array $capabilities ): array {
            unset( $capabilities['edit_others_posts'] );
            return $capabilities;
        };
        add_filter( 'role_has_cap', $without_reviewers );

        $failure = null;
        try {
            $this->seeded_sequence();
        } catch ( \RuntimeException $error ) {
            $failure = $error;
        } finally {
            remove_filter( 'role_has_cap', $without_reviewers );
        }

        $this->assertInstanceOf( \RuntimeException::class, $failure, 'Seeding must reject a site with no reviewer role.' );
        $this->assertSame(
            'Editorial Review requires a reviewer role. Configure a role with edit_others_posts, then retry.',
            $failure->getMessage()
        );
        $this->assertNull( ( new SequenceRepository() )->find_by_slug( 'editorial-review' ) );

        ( new Seeder() )->seed();
        $sequence = ( new SequenceRepository() )->find_by_slug( 'editorial-review' );
        $this->assertInstanceOf( Sequence::class, $sequence );
        $this->assertSame( array( 'administrator', 'editor' ), $sequence->get_reviewer_roles() );
        $this->assertSame( $sequence->get_reviewer_roles(), $sequence->get_transition( 'review', 'ready' )['allowed_roles'] );
    }

    public function test_existing_sequence_is_preserved_when_no_role_can_review(): void
    {
        $sequence = $this->seeded_sequence();
        add_filter(
            'role_has_cap',
            static function ( array $capabilities ): array {
                unset( $capabilities['edit_others_posts'] );
                return $capabilities;
            }
        );

        ( new Seeder() )->seed();

        $existing = ( new SequenceRepository() )->find_by_slug( 'editorial-review' );
        $this->assertSame( $sequence->id, $existing->id );
        $this->assertSame( $sequence->config, $existing->config );
    }

    public function test_author_cannot_approve_but_editor_can(): void
    {
        $sequence  = $this->seeded_sequence();
        $author_id = (int) self::factory()->user->create( array( 'role' => 'author' ) );
        $editor_id = (int) self::factory()->user->create( array( 'role' => 'editor' ) );
        $post_id   = (int) self::factory()->post->create(
            array(
                'post_author' => $author_id,
                'post_status' => 'draft',
            )
        );
        update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $sequence->id );
        update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'draft' );

        $manager = new StatusManager();
        wp_set_current_user( $author_id );
        $this->assertTrue( $manager->transition( $post_id, 'review' ) );

        $result = $manager->transition( $post_id, 'ready' );
        $this->assertWPError( $result );
        $this->assertSame( 'forbidden_transition', $result->get_error_code() );
        $this->assertSame( 403, $result->get_error_data()['status'] );
        $this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
        $this->assertSame( 'draft', get_post_status( $post_id ) );

        wp_set_current_user( $editor_id );
        $this->assertTrue( $manager->transition( $post_id, 'ready' ) );
        $this->assertSame( 'ready', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
        $this->assertSame( 'draft', get_post_status( $post_id ) );
    }
}
