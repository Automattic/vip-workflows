/**
 * Which move the editor header offers, and when it stands in for Publish.
 *
 * Kept apart from the component that draws it so the two rules can be read —
 * and tested — without rendering an editor.
 *
 * @package
 */

/**
 * The stage's primary transition: the first one the author listed.
 *
 * Authored order is a real declaration. The sequence editor's stage inspector
 * lets an author drag a stage's exits into order and badges the first as
 * primary, and that order is stored as-is in the stage's `transitions` array.
 * The list this reads is the role-filtered one the status endpoint serves, in
 * that same order, so a person who may not take the author's first exit is
 * offered the first one they can.
 *
 * A locked transition is still the primary. It is returned rather than
 * skipped so the header can draw it disabled with its reason: quietly
 * promoting the next exit would hide why the expected next step is not
 * available.
 *
 * @param {Array} transitions The offered transitions, in authored order.
 * @return {?Object} The primary transition, or null when there is none.
 */
export function getPrimaryTransition( transitions ) {
	return transitions?.[ 0 ] ?? null;
}

/**
 * The status regions in which core's Publish button would take the post live.
 *
 * In every other region the button is core's Save or Update for a post that is
 * already public — the only save control there — so it is never hidden.
 *
 * @type {string[]}
 */
const PRE_PUBLISH_REGIONS = [ 'draft', 'pending' ];

/**
 * Whether the workflow button stands in for core's Publish button.
 *
 * Hiding a core control is the exception. It happens only when pressing
 * Publish could do nothing but fail: the post is in a live workflow, sits on
 * the draft side of the publish boundary, the person cannot bypass the
 * workflow, and the stage has somewhere for them to send it instead. Everyone
 * else keeps core's controls, with the save guard's confirmations as before.
 *
 * The region is the guard's (`guard.current_region`), not the stage's own: it
 * is the server's answer to which side of the boundary the post is on, and it
 * counts a post that is live or scheduled as publish-side whatever stage it
 * holds.
 *
 * @param {?Object} workflow    The status endpoint's payload.
 * @param {Array}   transitions The offered transitions.
 * @return {boolean} True when core's Publish button should be hidden.
 */
export function replacesCorePublish( workflow, transitions ) {
	if ( ! workflow?.has_workflow || workflow.orphaned ) {
		return false;
	}

	if ( ! getPrimaryTransition( transitions ) ) {
		return false;
	}

	if ( workflow.guard?.can_bypass ) {
		return false;
	}

	return PRE_PUBLISH_REGIONS.includes( workflow.guard?.current_region );
}
