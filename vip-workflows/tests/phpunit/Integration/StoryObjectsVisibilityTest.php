<?php
/**
 * A story's serialized objects are the ones its reader can read.
 *
 * `Story::to_array()` names every object linked to the story — ideation
 * project and posts — with its title. A story outlives the hands it passes
 * through: the writer who gets a commissioned post need not be able to read
 * the project it came from, and the ideator need not be able to read the
 * draft written from it. The serializer therefore keeps only the objects
 * the current user can `read_post`, the same check the audit log applies to
 * a post title before it ships.
 *
 * Both post types register `capability_type => post` with `map_meta_cap`,
 * so one predicate covers both.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Ideation\Research\IdeationPostTypes;
use VIPWorkflows\Story\Story;

class StoryObjectsVisibilityTest extends TestCase {

	/**
	 * Somebody who can edit every post.
	 *
	 * @var int
	 */
	private int $editor_id;

	/**
	 * Somebody who can edit only their own unpublished posts.
	 *
	 * @var int
	 */
	private int $contributor_id;

	/**
	 * The story under test, with a project and two drafts linked to it.
	 *
	 * @var Story
	 */
	private Story $story;

	/**
	 * The contributor's own draft.
	 *
	 * @var int
	 */
	private int $own_draft;

	/**
	 * The editor's draft.
	 *
	 * @var int
	 */
	private int $editor_draft;

	/**
	 * The editor's ideation project.
	 *
	 * @var int
	 */
	private int $editor_project;

	public function set_up(): void {
		parent::set_up();

		// Ideation sits behind an experiment that is off on a clean test
		// database, so the post type it declares is absent and `map_meta_cap`
		// would fall back to generic post handling. Register just the post type.
		( new IdeationPostTypes() )->register_post_type();

		$admin = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin );

		$this->editor_id      = (int) self::factory()->user->create( array( 'role' => 'editor' ) );
		$this->contributor_id = (int) self::factory()->user->create( array( 'role' => 'contributor' ) );

		$story = Story::create( 'An editorial effort', Story::STATUS_EDITORIAL );
		$this->assertInstanceOf( Story::class, $story );
		$this->story = $story;

		$this->own_draft      = $this->make_post( 'post', $this->contributor_id );
		$this->editor_draft   = $this->make_post( 'post', $this->editor_id );
		$this->editor_project = $this->make_post( IdeationPostTypes::POST_TYPE, $this->editor_id );

		$this->story->add_object( $this->editor_project, 'ideation' );
		$this->story->add_object( $this->own_draft, 'post' );
		$this->story->add_object( $this->editor_draft, 'post' );
	}

	/**
	 * Create a draft of the given type.
	 *
	 * @param  string $post_type Post type.
	 * @param  int    $author_id Post author.
	 * @return int Post ID.
	 */
	private function make_post( string $post_type, int $author_id ): int {
		return (int) self::factory()->post->create(
			array(
				'post_type'   => $post_type,
				'post_status' => 'draft',
				'post_author' => $author_id,
				'post_title'  => 'A ' . $post_type . ' of user ' . $author_id,
			)
		);
	}

	/**
	 * The ids of the serialized objects, as the given user.
	 *
	 * @param  int $user_id User to assume.
	 * @return int[]
	 */
	private function object_ids_as( int $user_id ): array {
		wp_set_current_user( $user_id );

		return array_column( $this->story->to_array()['objects'], 'id' );
	}

	/**
	 * A Contributor is given their own draft and nothing of the editor's.
	 */
	public function test_objects_the_reader_cannot_read_are_left_out(): void {
		$this->assertSame( array( $this->own_draft ), $this->object_ids_as( $this->contributor_id ) );
	}

	/**
	 * An Editor is given all three, with their titles and types.
	 */
	public function test_a_reader_who_can_read_every_object_is_given_them_all(): void {
		wp_set_current_user( $this->editor_id );

		$objects = $this->story->to_array()['objects'];

		$this->assertEqualsCanonicalizing(
			array( $this->editor_project, $this->own_draft, $this->editor_draft ),
			array_column( $objects, 'id' )
		);

		$by_id = array_column( $objects, null, 'id' );
		$this->assertSame( 'ideation', $by_id[ $this->editor_project ]['type'] );
		$this->assertSame( get_the_title( $this->own_draft ), $by_id[ $this->own_draft ]['title'] );
	}

	/**
	 * The linking itself is not what is filtered: the rows are still there for
	 * a caller that reads the table directly, and a type filter still works.
	 */
	public function test_get_objects_lists_every_link_of_a_type(): void {
		wp_set_current_user( $this->contributor_id );

		$this->assertEqualsCanonicalizing(
			array( $this->own_draft, $this->editor_draft ),
			array_map( 'intval', array_column( $this->story->get_objects( 'post' ), 'object_id' ) )
		);
		$this->assertSame( array(), $this->story->get_objects( 'note' ) );
	}

	/**
	 * A read that fails answers an empty list, for the typed lookup too.
	 *
	 * The two lookups used to be two copies of the query with their own
	 * returns; this pins the one contract they share now that there is one
	 * return. The `query` filter swaps the SELECT for one MySQL refuses.
	 */
	public function test_a_failed_read_answers_an_empty_list(): void {
		global $wpdb;

		$break = static function ( string $sql ): string {
			if ( str_starts_with( $sql, 'SELECT' ) && str_contains( $sql, 'vip_story_objects' ) ) {
				return 'SELECT object_id FROM no_such_table_for_this_test';
			}

			return $sql;
		};
		add_filter( 'query', $break );
		$wpdb->suppress_errors( true );

		try {
			$this->assertSame( array(), $this->story->get_objects( 'post' ) );
			$this->assertSame( array(), $this->story->get_objects() );
		} finally {
			$wpdb->suppress_errors( false );
			remove_filter( 'query', $break );
		}
	}
}
