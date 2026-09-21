<?php
/**
 * Invalid assignees must be rejected before a transition changes the post.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\API\WorkflowController;
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
class InvalidAssignmentTransitionTest extends TestCase {

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
			fn( $user_id ) => in_array( (int) $user_id, array( 5, 7, 11 ), true ) ? (object) array(
				'ID'           => $user_id,
				'roles'        => array( 'editor' ),
				'display_name' => 'Reviewer ' . $user_id,
			) : false
		);
		$roles        = Mockery::mock( 'WP_Roles' );
		$roles->roles = array( 'editor' => array( 'name' => 'Editor' ) );
		$roles->shouldReceive( 'is_role' )->andReturnUsing( fn( $role ) => 'editor' === $role );
		Functions\when( 'wp_roles' )->justReturn( $roles );
		Functions\when( 'translate_user_role' )->alias( fn( $role ) => $role );
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
	 * @return StatusManager Status manager using the fixture sequence.
	 */
	private function manager( array $inputs, array $tools = array() ): StatusManager {
		$sequence   = Sequence::from_row(
			(object) array(
				'id'          => 1,
				'uuid'        => 'invalid-assignee-test',
				'type'        => Sequence::TYPE_WORKFLOW,
				'name'        => 'Assignee validation',
				'slug'        => 'assignee-validation',
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
								'transitions'  => array(),
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
	 * @param string $assignee_type The kind of target this input accepts.
	 * @return array Assignment input config.
	 */
	private function assignment_input( string $assignee_type = 'user' ): array {
		return array(
			'type'          => 'assignment',
			// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- Authored transition configuration, not a database query.
			'meta_key'      => 'reviewer',
			'assignee_type' => $assignee_type,
			'label'         => 'Reviewer',
			'required'      => false,
		);
	}

	/**
	 * Values that must not be coerced into a different or nonexistent assignee.
	 *
	 * @return array Named assignee types and invalid submitted values.
	 */
	public static function invalid_assignees(): array {
		return array(
			'deleted user'             => array( 'user', 999 ),
			'deleted user string'      => array( 'user', '999' ),
			'zero user'                => array( 'user', 0 ),
			'zero user string'         => array( 'user', '0' ),
			'false user'               => array( 'user', false ),
			'true user'                => array( 'user', true ),
			'fractional user'          => array( 'user', 7.5 ),
			'float user'               => array( 'user', 7.0 ),
			'negative user'            => array( 'user', -7 ),
			'negative user string'     => array( 'user', '-7' ),
			'user id with suffix'      => array( 'user', '7garbage' ),
			'fractional user string'   => array( 'user', '7.5' ),
			'exponent user string'     => array( 'user', '7e0' ),
			'signed user string'       => array( 'user', '+7' ),
			'user with leading space'  => array( 'user', ' 7' ),
			'user with trailing space' => array( 'user', '7 ' ),
			'user with newline'        => array( 'user', "7\n" ),
			'overflow user string'     => array( 'user', (string) PHP_INT_MAX . '0' ),
			'empty user array'         => array( 'user', array() ),
			'user array'               => array( 'user', array( 7 ) ),
			'unknown role'             => array( 'role', 'retired-role' ),
			'false role'               => array( 'role', false ),
			'true role'                => array( 'role', true ),
			'integer role'             => array( 'role', 7 ),
			'empty role array'         => array( 'role', array() ),
			'role array'               => array( 'role', array( 'editor' ) ),
			'blank custom identifier'  => array( 'external-reviewer', '   ' ),
			'custom identifier array'  => array( 'external-reviewer', array( 'case/123' ) ),
		);
	}

	/**
	 * Bad targets must leave publishing status, stage, and previous assignments intact.
	 *
	 * @dataProvider invalid_assignees
	 * @param string $assignee_type Assignee type from the authored input.
	 * @param mixed  $value         Submitted assignee value.
	 */
	public function test_invalid_assignee_is_rejected_before_any_post_write( string $assignee_type, $value ): void {
		$manager = $this->manager( array( $this->assignment_input( $assignee_type ) ) );
		$before  = $this->meta;

		$result = $manager->transition( 42, 'ready', array( 'input_data' => array( 'reviewer' => $value ) ) );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'invalid_assignee', $result->get_error_code() );
		$this->assertSame( 422, $result->get_error_data()['status'] );
		$this->assertSame( 'reviewer', $result->get_error_data()['meta_key'] );
		$this->assertSame( $assignee_type, $result->get_error_data()['assignee_type'] );
		$this->assertSame( 'draft', $this->post->post_status );
		$this->assertSame( $before, $this->meta );
		$this->assertSame( array(), $this->writes );
		$this->assertSame( array(), $this->actions );
		$this->assertNotContains( 'status_transition', array_column( $this->audit_rows, 'event_type' ) );
	}

	/**
	 * Invalid input must be rejected before checking and updating stale agent jobs.
	 */
	public function test_invalid_assignee_is_rejected_before_stale_job_updates(): void {
		$manager = $this->manager( array( $this->assignment_input() ) );
		$this->meta[ \VIPWorkflows\Workflow\StageAgentRunner::JOB_META ] = array(
			'stage_key' => 'draft',
			'status'    => 'pending',
			'queued_at' => '2000-01-01 00:00:00',
		);
		$before = $this->meta;

		$result = $manager->transition( 42, 'ready', array( 'input_data' => array( 'reviewer' => 999 ) ) );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'invalid_assignee', $result->get_error_code() );
		$this->assertSame( $before, $this->meta );
		$this->assertSame( array(), $this->writes );
	}

	/**
	 * Target validation must happen before a required tool can have side effects.
	 */
	public function test_invalid_assignee_is_checked_before_running_tools(): void {
		$manager = $this->manager( array( $this->assignment_input() ), array( 'test/quality-check' ) );
		// Supply the real executor's dependencies so an ordering regression fails
		// on tool execution rather than an unrelated missing plugin bootstrap.
		$plugin = ( new \ReflectionClass( Plugin::class ) )->newInstanceWithoutConstructor();
		( new \ReflectionProperty( Plugin::class, 'event_bus' ) )
		->setValue( $plugin, Mockery::mock( EventBus::class ) );
		( new \ReflectionProperty( Plugin::class, 'instance' ) )->setValue( null, $plugin );
		Functions\expect( 'wp_get_ability' )->never();

		$result = $manager->transition( 42, 'ready', array( 'input_data' => array( 'reviewer' => 999 ) ) );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'invalid_assignee', $result->get_error_code() );
		$this->assertSame( array(), $this->writes );
	}

	/**
	 * The accepted forms preserve their submitted value when stored.
	 *
	 * @return array Valid assignee types and values.
	 */
	public static function valid_assignees(): array {
		return array(
			'user id'           => array( 'user', 11 ),
			'user id string'    => array( 'user', '11' ),
			'registered role'   => array( 'role', 'editor' ),
			'custom identifier' => array( 'external-reviewer', 'case/123' ),
		);
	}

	/**
	 * Valid targets still publish, advance the stage, and create the requested assignment.
	 *
	 * @dataProvider valid_assignees
	 * @param string $assignee_type Assignee type from the authored input.
	 * @param mixed  $value         Submitted assignee value.
	 */
	public function test_valid_assignee_allows_the_transition( string $assignee_type, $value ): void {
		$manager = $this->manager( array( $this->assignment_input( $assignee_type ) ) );
		$other   = $this->meta[ self::OTHER_ASSIGNMENT_KEY ];

		$result = $manager->transition( 42, 'ready', array( 'input_data' => array( 'reviewer' => $value ) ) );

		$this->assertTrue( $result );
		$this->assertSame( 'publish', $this->post->post_status );
		$this->assertSame( 'ready', $this->meta[ StatusManager::STAGE_META_KEY ] );
		$this->assertSame( $value, $this->meta[ self::ASSIGNMENT_KEY ]['value'] );
		$this->assertSame( $assignee_type, $this->meta[ self::ASSIGNMENT_KEY ]['type'] );
		$this->assertSame( 'pending', $this->meta[ self::ASSIGNMENT_KEY ]['status'] );
		$this->assertSame( $other, $this->meta[ self::OTHER_ASSIGNMENT_KEY ] );
		$this->assertContains( 'vip_workflows_assignment_created', $this->actions );
		$this->assertContains( 'status_transition', array_column( $this->audit_rows, 'event_type' ) );
	}

	/**
	 * Missing optional selections are distinct from supplied invalid values.
	 *
	 * @return array Empty optional input payloads.
	 */
	public static function empty_optional_input(): array {
		return array(
			'absent key'   => array( array() ),
			'null'         => array( array( 'reviewer' => null ) ),
			'empty string' => array( array( 'reviewer' => '' ) ),
		);
	}

	/**
	 * Empty optional selections remain valid, independent of how clearing is handled.
	 *
	 * @dataProvider empty_optional_input
	 * @param array $input_data Submitted transition input.
	 */
	public function test_empty_optional_assignment_does_not_block_the_transition( array $input_data ): void {
		$manager = $this->manager( array( $this->assignment_input() ) );
		$before  = $this->meta[ self::ASSIGNMENT_KEY ];
		$other   = $this->meta[ self::OTHER_ASSIGNMENT_KEY ];

		$this->assertTrue( $manager->transition( 42, 'ready', array( 'input_data' => $input_data ) ) );
		if ( ! array_key_exists( 'reviewer', $input_data ) ) {
			$this->assertSame( $before, $this->meta[ self::ASSIGNMENT_KEY ] );
			$this->assertNotContains( 'vip_workflows_assignment_removed', $this->actions );
		}
		$this->assertSame( $other, $this->meta[ self::OTHER_ASSIGNMENT_KEY ] );
		$this->assertSame( 'publish', $this->post->post_status );
		$this->assertSame( 'ready', $this->meta[ StatusManager::STAGE_META_KEY ] );
		$this->assertNotContains( 'vip_workflows_assignment_created', $this->actions );
	}

	/**
	 * The REST controller must return the actionable validation error without committing.
	 */
	public function test_rest_controller_returns_the_invalid_assignee_error(): void {
		$manager = $this->manager( array( $this->assignment_input() ) );
		$plugin  = ( new \ReflectionClass( Plugin::class ) )->newInstanceWithoutConstructor();
		( new \ReflectionProperty( Plugin::class, 'status_manager' ) )->setValue( $plugin, $manager );
		( new \ReflectionProperty( Plugin::class, 'instance' ) )->setValue( null, $plugin );
		$request = new \WP_REST_Request();
		$request->set_param( 'id', 42 );
		$request->set_param( 'to_status', 'ready' );
		$request->set_param( 'input_data', array( 'reviewer' => 999 ) );
		$before = $this->meta;

		$result = ( new WorkflowController() )->transition_status( $request );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'invalid_assignee', $result->get_error_code() );
		$this->assertSame(
			array(
				'status'        => 422,
				'meta_key'      => 'reviewer',
				'assignee_type' => 'user',
			),
			$result->get_error_data()
		);
		$this->assertSame( 'draft', $this->post->post_status );
		$this->assertSame( $before, $this->meta );
		$this->assertSame( array(), $this->writes );
		$this->assertSame( array(), $this->actions );
	}
}
