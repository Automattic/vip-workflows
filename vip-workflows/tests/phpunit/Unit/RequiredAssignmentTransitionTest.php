<?php
/**
 * Required assignments must be validated before a transition changes the post.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\Automation\EventBus;
use VIPWorkflows\Plugin;
use VIPWorkflows\Sequences\Sequence;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\Actor;
use VIPWorkflows\Workflow\PostTypeManager;
use VIPWorkflows\Workflow\StatusManager;

/**
 * Exercises the real transition pipeline with in-memory WordPress storage.
 */
class RequiredAssignmentTransitionTest extends TestCase {

	private const ASSIGNMENT_KEY       = '_vip_workflows_assignment_reviewer';
	private const OTHER_ASSIGNMENT_KEY = '_vip_workflows_assignment_copy_editor';

	/**
	 * Current post state.
	 *
	 * @var \WP_Post
	 */
	private \WP_Post $post;

	/**
	 * Post meta backing the WordPress stubs.
	 *
	 * @var array
	 */
	private array $meta = array();

	/**
	 * Status and meta writes, including attempted writes.
	 *
	 * @var array
	 */
	private array $writes = array();

	/**
	 * Emitted action names.
	 *
	 * @var array
	 */
	private array $actions = array();

	/**
	 * Audit rows captured instead of writing to a database.
	 *
	 * @var array
	 */
	private array $audit_rows = array();

	/**
	 * Database global to restore after this fixture.
	 *
	 * @var mixed
	 */
	private $previous_wpdb;

	/**
	 * Set up a publish-capable editor and mutable post storage.
	 */
	protected function setUp(): void {
		parent::setUp();
		Actor::flush();

		$this->post = $this->create_mock_post(
			array(
				'ID'          => 42,
				'post_status' => 'draft',
			)
		);
		$this->meta = array(
			StatusManager::SEQUENCE_META_KEY => '1',
			StatusManager::STAGE_META_KEY    => 'draft',
			self::ASSIGNMENT_KEY             => array(
				'value'  => 7,
				'type'   => 'user',
				'status' => 'pending',
			),
			self::OTHER_ASSIGNMENT_KEY       => array(
				'value'  => 9,
				'type'   => 'user',
				'status' => 'pending',
			),
		);

		Functions\when( 'get_post' )->alias( fn() => $this->post );
		Functions\when( 'get_post_status' )->alias( fn() => $this->post->post_status );
		Functions\when( 'get_post_meta' )->alias(
			fn( $post_id, $key = '' ) => $this->meta[ $key ] ?? ''
		);
		Functions\when( 'update_post_meta' )->alias(
			function ( $post_id, $key, $value ) {
				$this->writes[]     = array( 'update_meta', $key, $value );
				$this->meta[ $key ] = $value;
				return true;
			}
		);
		Functions\when( 'delete_post_meta' )->alias(
			function ( $post_id, $key ) {
				$this->writes[] = array( 'delete_meta', $key );
				unset( $this->meta[ $key ] );
				return true;
			}
		);
		Functions\when( 'wp_update_post' )->alias(
			function ( $data ) {
				$this->writes[]          = array( 'update_post', $data );
				$this->post->post_status = $data['post_status'];
				return $this->post->ID;
			}
		);
		Functions\when( 'do_action' )->alias(
			function ( $hook ) {
				$this->actions[] = $hook;
			}
		);
		Functions\when( 'current_user_can' )->justReturn( true );
		Functions\when( 'get_current_user_id' )->justReturn( 5 );
		Functions\when( 'get_userdata' )->alias(
			fn( $user_id ) => (object) array(
				'ID'           => $user_id,
				'roles'        => array( 'editor' ),
				'display_name' => 'Reviewer ' . $user_id,
			)
		);
		Functions\when( 'get_avatar_url' )->justReturn( 'https://example.com/avatar.png' );
		Functions\when( 'get_option' )->justReturn( array() );
		Functions\when( 'get_post_type_object' )->justReturn(
			(object) array(
				'cap' => (object) array(
					'publish_posts'        => 'publish_posts',
					'edit_published_posts' => 'edit_published_posts',
				),
			)
		);

		global $wpdb;
		$this->previous_wpdb = $wpdb;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Capture audit writes in the unit fixture; restored in tearDown().
		$wpdb            = Mockery::mock( 'wpdb' );
		$wpdb->prefix    = 'wp_';
		$wpdb->insert_id = 1;
		$wpdb->shouldReceive( 'insert' )->andReturnUsing(
			function ( $table, $data ) {
				$this->audit_rows[] = $data;
				return true;
			}
		);
	}

	/**
	 * Restore process-wide state before removing the WordPress function stubs.
	 */
	protected function tearDown(): void {
		global $wpdb;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Restore the fixture's saved database global.
		$wpdb = $this->previous_wpdb;
		Actor::flush();
		parent::tearDown();
	}

	/**
	 * Build a real sequence and the status manager that will transition it.
	 *
	 * @param array $inputs Authored transition inputs.
	 * @param array $tools Required transition tools.
	 * @param bool  $reverse_edge Whether to author a reverse edge with the same inputs.
	 * @return StatusManager Status manager using the fixture sequence.
	 */
	private function manager( array $inputs, array $tools = array(), bool $reverse_edge = false ): StatusManager {
		$sequence   = Sequence::from_row(
			(object) array(
				'id'          => 1,
				'uuid'        => 'required-assignment-test',
				'type'        => Sequence::TYPE_WORKFLOW,
				'name'        => 'Assignment requirements',
				'slug'        => 'assignment-requirements',
				'description' => '',
				'version'     => 1,
				'status'      => 'active',
				'created_by'  => 5,
				'created_at'  => '2026-01-01 00:00:00',
				'updated_at'  => '2026-01-01 00:00:00',
				'config'      => wp_json_encode(
					array(
						'statuses' => array(
							array(
								'key'          => 'draft',
								'label'        => 'Draft',
								'status'       => 'draft',
								'region_entry' => true,
								'transitions'  => array(
									array(
										'to'             => 'ready',
										'inputs'         => $inputs,
										'required_tools' => $tools,
									),
								),
							),
							array(
								'key'          => 'ready',
								'label'        => 'Ready',
								'status'       => 'publish',
								'region_entry' => true,
								'transitions'  => $reverse_edge ? array(
									array(
										'to'     => 'draft',
										'inputs' => $inputs,
									),
								) : array(),
							),
						),
					)
				),
			)
		);
		$repository = Mockery::mock( SequenceRepository::class );
		$repository->shouldReceive( 'find' )->with( 1 )->andReturn( $sequence );

		return new StatusManager( $repository, Mockery::mock( PostTypeManager::class ) );
	}

	/**
	 * The input attached to the fixture's publish transition.
	 *
	 * @param bool $required Whether an assignee is required.
	 * @return array Assignment input config.
	 */
	private function assignment_input( bool $required ): array {
		return array(
			'type'          => 'assignment',
			// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- Authored transition configuration, not a database query.
			'meta_key'      => 'reviewer',
			'assignee_type' => 'user',
			'label'         => 'Reviewer',
			'required'      => $required,
		);
	}

	/**
	 * No value that the assignment writer treats as empty can clear a required slot.
	 *
	 * @return array Named transition input payloads.
	 */
	public static function missing_assignment_data(): array {
		return array(
			'absent key'   => array( array() ),
			'null'         => array( array( 'reviewer' => null ) ),
			'empty string' => array( array( 'reviewer' => '' ) ),
			'false'        => array( array( 'reviewer' => false ) ),
			'zero'         => array( array( 'reviewer' => 0 ) ),
			'zero string'  => array( array( 'reviewer' => '0' ) ),
			'empty array'  => array( array( 'reviewer' => array() ) ),
		);
	}

	/**
	 * A rejected publish transition must not publish, move stage, or alter assignments.
	 *
	 * @dataProvider missing_assignment_data
	 * @param array $input_data Submitted transition input.
	 */
	public function test_required_assignment_is_rejected_before_any_post_write( array $input_data ): void {
		$manager = $this->manager( array( $this->assignment_input( true ) ) );
		$before  = $this->meta;

		$result = $manager->transition( 42, 'ready', array( 'input_data' => $input_data ) );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'required_assignment_missing', $result->get_error_code() );
		$this->assertSame( 422, $result->get_error_data()['status'] );
		$this->assertSame( 'reviewer', $result->get_error_data()['meta_key'] );
		$this->assertStringContainsString( 'Reviewer', $result->get_error_message() );
		$this->assertSame( 'draft', $this->post->post_status );
		$this->assertSame( $before, $this->meta );
		$this->assertSame( array(), $this->writes );
		$this->assertSame( array(), $this->actions );
		$this->assertNotContains( 'status_transition', array_column( $this->audit_rows, 'event_type' ) );
	}

	/**
	 * Invalid input must not trigger a transition tool before it is rejected.
	 */
	public function test_required_assignment_is_checked_before_running_tools(): void {
		$manager = $this->manager( array( $this->assignment_input( true ) ), array( 'test/quality-check' ) );
		// Let the real executor initialize if validation is ever moved too late,
		// so the regression fails on tool execution rather than missing bootstrap.
		$plugin = ( new \ReflectionClass( Plugin::class ) )->newInstanceWithoutConstructor();
		( new \ReflectionProperty( Plugin::class, 'event_bus' ) )
			->setValue( $plugin, Mockery::mock( EventBus::class ) );
		( new \ReflectionProperty( Plugin::class, 'instance' ) )->setValue( null, $plugin );
		Functions\expect( 'wp_get_ability' )->never();

		$result = $manager->transition( 42, 'ready', array( 'input_data' => array( 'reviewer' => '' ) ) );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'required_assignment_missing', $result->get_error_code() );
		$this->assertSame( array(), $this->writes );
	}

	/**
	 * An agent's normal exit still has to satisfy the authored assignment requirement.
	 */
	public function test_agent_exit_without_required_input_is_rejected(): void {
		$manager = $this->manager( array( $this->assignment_input( true ) ) );
		$before  = $this->meta;
		Functions\when( 'user_can' )->justReturn( true );

		$result = $manager->transition(
			42,
			'ready',
			array(
				'agent_actor'      => 'test/reviewer',
				'agent_actor_user' => 5,
			)
		);

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'required_assignment_missing', $result->get_error_code() );
		$this->assertSame( 422, $result->get_error_data()['status'] );
		$this->assertSame( 'draft', $this->post->post_status );
		$this->assertSame( $before, $this->meta );
		$this->assertSame( array(), $this->writes );
		$this->assertSame( array(), $this->actions );
	}

	/**
	 * Supplying the required assignee still commits both the publish and assignment.
	 */
	public function test_supplied_required_assignment_allows_the_transition(): void {
		$manager = $this->manager( array( $this->assignment_input( true ) ) );

		$result = $manager->transition( 42, 'ready', array( 'input_data' => array( 'reviewer' => '11' ) ) );

		$this->assertTrue( $result );
		$this->assertSame( 'publish', $this->post->post_status );
		$this->assertSame( 'ready', $this->meta[ StatusManager::STAGE_META_KEY ] );
		$this->assertSame( '11', $this->meta[ self::ASSIGNMENT_KEY ]['value'] );
		$this->assertSame( 'pending', $this->meta[ self::ASSIGNMENT_KEY ]['status'] );
		$this->assertContains( 'vip_workflows_assignment_created', $this->actions );
		$this->assertContains( 'status_transition', array_column( $this->audit_rows, 'event_type' ) );
	}

	/**
	 * Omitting an optional assignment means no assignment change was requested.
	 */
	public function test_optional_assignment_is_preserved_when_omitted(): void {
		$manager = $this->manager( array( $this->assignment_input( false ) ) );
		$before  = $this->meta[ self::ASSIGNMENT_KEY ];

		$this->assertTrue( $manager->transition( 42, 'ready' ) );
		$this->assertSame( $before, $this->meta[ self::ASSIGNMENT_KEY ] );
		$this->assertNotContains( 'vip_workflows_assignment_removed', $this->actions );
		$this->assertNotContains( 'vip_workflows_assignment_created', $this->actions );
	}

	/**
	 * Both explicit representations of an empty optional assignment clear its slot.
	 *
	 * @return array Explicit empty input values.
	 */
	public static function optional_clear_values(): array {
		return array(
			'empty string' => array( '' ),
			'null'         => array( null ),
		);
	}

	/**
	 * Clearing one optional slot must preserve the post's other assignments.
	 *
	 * @dataProvider optional_clear_values
	 * @param mixed $value Explicit empty assignment value.
	 */
	public function test_optional_assignment_can_be_explicitly_cleared( $value ): void {
		$manager = $this->manager( array( $this->assignment_input( false ) ) );
		$other   = $this->meta[ self::OTHER_ASSIGNMENT_KEY ];

		$this->assertTrue( $manager->transition( 42, 'ready', array( 'input_data' => array( 'reviewer' => $value ) ) ) );
		$this->assertArrayNotHasKey( self::ASSIGNMENT_KEY, $this->meta );
		$this->assertSame( $other, $this->meta[ self::OTHER_ASSIGNMENT_KEY ] );
		$this->assertSame( 1, count( array_keys( $this->actions, 'vip_workflows_assignment_removed', true ) ) );
		$this->assertNotContains( 'vip_workflows_assignment_created', $this->actions );
	}

	/**
	 * A transition without assignment inputs must not demand or clear an assignee.
	 */
	public function test_transition_without_assignment_inputs_is_unaffected(): void {
		$manager = $this->manager( array() );
		$before  = $this->meta[ self::ASSIGNMENT_KEY ];

		$this->assertTrue( $manager->transition( 42, 'ready' ) );
		$this->assertSame( $before, $this->meta[ self::ASSIGNMENT_KEY ] );
		$this->assertSame( 'ready', $this->meta[ StatusManager::STAGE_META_KEY ] );
	}

	/**
	 * Emergency go-back does not inherit inputs even when an authored reverse edge exists.
	 */
	public function test_revert_does_not_require_inputs_from_an_authored_reverse_edge(): void {
		$manager                                     = $this->manager( array( $this->assignment_input( true ) ), array(), true );
		$this->meta[ StatusManager::STAGE_META_KEY ] = 'ready';
		$this->post->post_status                     = 'publish';
		$before                                      = $this->meta[ self::ASSIGNMENT_KEY ];

		$this->assertTrue( $manager->transition( 42, 'draft', array( 'agent_revert' => true ) ) );
		$this->assertSame( $before, $this->meta[ self::ASSIGNMENT_KEY ] );
		$this->assertSame( 'draft', $this->post->post_status );
		$this->assertSame( 'draft', $this->meta[ StatusManager::STAGE_META_KEY ] );
	}
}
