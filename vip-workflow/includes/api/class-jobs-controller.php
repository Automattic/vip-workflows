<?php
/**
 * Jobs REST Controller.
 *
 * @package VIPWorkflow
 */

declare( strict_types=1 );

namespace VIPWorkflow\API;

use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;
use WP_Error;
use VIPWorkflow\Plugin;

/**
 * REST controller for background jobs.
 */
class JobsController extends WP_REST_Controller {


	/**
	 * Path segment that captures a job ID.
	 *
	 * A job ID is whatever a Job subclass returns from `get_id()`, and the only
	 * normalization the plugin declares for one is `sanitize_key()` — lowercase
	 * ASCII letters, digits, underscore and hyphen. The routes match exactly
	 * that, so every ID a job can legally declare is reachable on every route.
	 *
	 * Both parameterized routes share this so they cannot drift apart: a job
	 * whose settings are readable is by definition also runnable.
	 *
	 * It is a reachability guarantee, not an exclusion filter, and the
	 * difference matters: `WP_REST_Server::dispatch()` matches `@^{route}$@i`,
	 * so the lowercase class still admits `SlaCheck` at the router. What keeps
	 * an unservable ID out is `JobScheduler::register_job()`, which round trips
	 * through `sanitize_key()` case-sensitively and refuses to register one at
	 * all — so there is no job for the callback to find.
	 */
	private const JOB_ID_PATTERN = '(?P<id>[a-z0-9_-]+)';

	/**
	 * Argument schema for the `id` path parameter.
	 *
	 * @return array Argument schema keyed by parameter name.
	 */
	private static function job_id_arg(): array {
		return array(
			'id' => array(
				'type'              => 'string',
				'required'          => true,
				'sanitize_callback' => 'sanitize_key',
			),
		);
	}

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->namespace = 'vip-workflow/v1';
		$this->rest_base = 'jobs';
	}

	/**
	 * Register routes.
	 */
	public function register_routes(): void {
		// GET /jobs - List all jobs and their status.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_jobs' ),
				'permission_callback' => array( $this, 'admin_permissions_check' ),
			)
		);

		// POST /jobs/{id}/run - Run a job immediately.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/' . self::JOB_ID_PATTERN . '/run',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'run_job' ),
				'permission_callback' => array( $this, 'admin_permissions_check' ),
				'args'                => self::job_id_arg(),
			)
		);

		// GET /jobs/history - Get recent job executions.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/history',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_history' ),
				'permission_callback' => array( $this, 'admin_permissions_check' ),
				'args'                => array(
					'limit' => array(
						'type'              => 'integer',
						'default'           => 20,
						'sanitize_callback' => 'absint',
					),
				),
			)
		);

		// GET/POST /jobs/{id}/settings - Get/save job settings.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/' . self::JOB_ID_PATTERN . '/settings',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_job_settings' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'save_job_settings' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
				),
				// Shared by both endpoints above: register_rest_route() merges a
				// top-level 'args' into every method entry it registers.
				'args' => self::job_id_arg(),
			)
		);
	}

	/**
	 * Check admin permissions.
	 *
	 * @return bool
	 */
	public function admin_permissions_check(): bool {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Get all jobs and their status.
	 *
	 * @return WP_REST_Response
	 */
	public function get_jobs(): WP_REST_Response {
		$scheduler = Plugin::get_instance()->get_job_scheduler();
		$scheduler->init();

		$jobs = array();
		foreach ( $scheduler->get_jobs() as $job ) {
			$jobs[] = $job->to_array();
		}

		return new WP_REST_Response(
			array(
				'jobs'                    => $jobs,
				'action_scheduler_active' => function_exists( 'as_has_scheduled_action' ),
			)
		);
	}

	/**
	 * Run a job immediately.
	 *
	 * @param  WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function run_job( WP_REST_Request $request ) {
		$job_id = $request->get_param( 'id' );

		$scheduler = Plugin::get_instance()->get_job_scheduler();
		$success = $scheduler->run_now( $job_id );

		if ( ! $success ) {
			return new WP_Error(
				'job_not_found',
				/* translators: %s: job ID. */
				sprintf( __( 'Job "%s" not found.', 'vip-workflow' ), $job_id ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response(
			array(
				'success' => true,
				/* translators: %s: job ID. */
				'message' => sprintf( __( 'Job "%s" queued for immediate execution.', 'vip-workflow' ), $job_id ),
			)
		);
	}

	/**
	 * Get recent job execution history.
	 *
	 * @param  WP_REST_Request $request Request object.
	 * @return WP_REST_Response
	 */
	public function get_history( WP_REST_Request $request ): WP_REST_Response {
		if ( ! function_exists( 'as_get_scheduled_actions' ) ) {
			return new WP_REST_Response( array( 'history' => array() ) );
		}

		$limit = $request->get_param( 'limit' );

		$actions = as_get_scheduled_actions(
			array(
				'group'    => 'vip-workflow',
				'status'   => \ActionScheduler_Store::STATUS_COMPLETE,
				'per_page' => $limit,
				'orderby'  => 'date',
				'order'    => 'DESC',
			)
		);

		$history = array();
		foreach ( $actions as $action ) {
			$schedule = $action->get_schedule();
			$history[] = array(
				'id'       => $action->get_id(),
				'hook'     => $action->get_hook(),
				'name'     => str_replace( 'vip_workflow_job_', '', $action->get_hook() ),
				'date'     => $schedule ? $schedule->get_date()->format( 'Y-m-d H:i:s' ) : null,
				'date_gmt' => $schedule ? $schedule->get_date()->setTimezone( new \DateTimeZone( 'UTC' ) )->format( 'Y-m-d H:i:s' ) : null,
			);
		}

		return new WP_REST_Response( array( 'history' => $history ) );
	}

	/**
	 * Get settings for a specific job.
	 *
	 * @param  WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_job_settings( WP_REST_Request $request ) {
		$job_id = $request->get_param( 'id' );

		$scheduler = Plugin::get_instance()->get_job_scheduler();
		$scheduler->init();
		$job = $scheduler->get_job( $job_id );

		if ( ! $job ) {
			return new WP_Error(
				'job_not_found',
				/* translators: %s: job ID. */
				sprintf( __( 'Job "%s" not found.', 'vip-workflow' ), $job_id ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response(
			array(
				'job'      => $job->to_array(),
				'settings' => $job->get_settings(),
			)
		);
	}

	/**
	 * Save settings for a specific job.
	 *
	 * @param  WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function save_job_settings( WP_REST_Request $request ) {
		$job_id = $request->get_param( 'id' );

		$scheduler = Plugin::get_instance()->get_job_scheduler();
		$scheduler->init();
		$job = $scheduler->get_job( $job_id );

		if ( ! $job ) {
			return new WP_Error(
				'job_not_found',
				/* translators: %s: job ID. */
				sprintf( __( 'Job "%s" not found.', 'vip-workflow' ), $job_id ),
				array( 'status' => 404 )
			);
		}

		if ( ! $job->has_settings() ) {
			return new WP_Error(
				'no_settings',
				__( 'This job does not have configurable settings.', 'vip-workflow' ),
				array( 'status' => 400 )
			);
		}

		$input = $request->get_json_params();
		$sanitized = $job->sanitize_settings( $input );
		$job->update_settings( $sanitized );

		return new WP_REST_Response(
			array(
				'success'  => true,
				'settings' => $job->get_settings(),
			)
		);
	}
}
