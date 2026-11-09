<?php
/**
 * Who may approve in the Editorial Review sequence a new install seeds.
 *
 * The seeded sequence names editors and administrators as its reviewers, but
 * reviewer_roles only decides who may claim a post. Who may move it is decided
 * per transition, by allowed_roles, so Approve has to carry the restriction
 * itself or an author can approve their own post.
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
     * The sequence exactly as a new install seeds it.
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
    public function test_only_reviewer_roles_can_approve( string $role, bool $can_approve ): void
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
}
