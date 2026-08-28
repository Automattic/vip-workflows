/**
 * AgentRequirements
 *
 * Renders the structured `availability` requirements an agent reports when its
 * dependencies are unmet: what is missing, which capabilities need it, and where
 * to satisfy it.
 *
 * Shared because two surfaces show the same thing and must not drift. The Agents
 * card explains why an agent will not run; the sequence editor's AI-stage picker
 * explains why the agent wired to a stage will not run. A reader who has seen one
 * should recognise the other.
 *
 * @package
 */

import { __, sprintf } from '@wordpress/i18n';
import { Link, Stack, Text } from '@wordpress/ui';

import './AgentRequirements.css';

/**
 * Where the credentials a requirement wants can be obtained.
 *
 * A separate affordance from the destination itself, because they answer different
 * questions: the destination says where to *enter* a value, this says where to go
 * and *get* one. Both can be true at once — Foresight News' email and password are
 * typed into the card's own fields, but only exist once someone has an account on
 * foresightnews.com — which is why this rides alongside the destination rather than
 * replacing it.
 *
 * Only reached through the admin register: the server strips the whole destination
 * from the user register, so an editor told to ask an administrator never receives
 * a sign-up link they have nowhere to store the result of.
 *
 * @param {Object} props                Component props.
 * @param {string} props.credentialsUrl Absolute external URL, already protocol-filtered server-side.
 * @return {JSX.Element|null} External link, or null when the service names no URL.
 */
export function CredentialsLink( { credentialsUrl } ) {
	if ( ! credentialsUrl ) {
		return null;
	}

	/*
	 * `openInNewTab` is the external treatment: it sets `target="_blank"` and
	 * appends the arrow glyph plus its "(opens in a new tab)" label, so the link's
	 * external nature is visible and announced. It does not set `rel`, and this one
	 * leaves wp-admin for a third-party site, so that is added here.
	 */
	return (
		<Link href={ credentialsUrl } openInNewTab rel="noopener noreferrer">
			{ __( 'Where to get these credentials', 'vip-workflow' ) }
		</Link>
	);
}

/**
 * Where a single requirement can be satisfied.
 *
 * Only `admin_url` produces a destination anchor. `in_card` is satisfied by
 * settings fields rendered elsewhere on the same surface, and `none` has no
 * destination at all — it names a `wp-config.php` constant instead. Rendering a
 * destination link for either of those is the exact dead-end this feature exists to
 * remove, so neither gets one.
 *
 * A credentials URL renders under the hint, so an `in_card` requirement can say
 * both "type it below" and "get one here" without either claiming to be the other.
 * Only `Destination::in_card()` accepts one, which is why the `admin_url` branch
 * returns without consulting it — a connector-backed service gets its sign-up link
 * from core's own `credentials_url` on the Connectors screen it links to.
 *
 * @param {Object} props             Component props.
 * @param {Object} props.destination Serialized destination.
 * @return {JSX.Element|null} Destination affordance, or null when there is nothing to show.
 */
export function RequirementDestination( { destination } ) {
	if ( ! destination ) {
		return null;
	}

	if ( 'admin_url' === destination.kind && destination.url ) {
		return (
			<Link href={ destination.url } openInNewTab>
				{ destination.label }
			</Link>
		);
	}

	const credentialsLink = (
		<CredentialsLink credentialsUrl={ destination.credentials_url } />
	);

	if ( ! destination.hint ) {
		return credentialsLink;
	}

	/*
	 * A fragment, not a nested Stack: every caller already renders this inside a
	 * column Stack, so letting that parent's `gap` space the two lines keeps
	 * spacing owned in one place instead of introducing a second gap to reconcile.
	 */
	return (
		<>
			<Text
				variant="body-sm"
				className="vip-workflow-agent-requirements__hint"
			>
				{ destination.hint }
			</Text>
			{ credentialsLink }
		</>
	);
}

/**
 * One unmet requirement.
 *
 * The server chose the message register by capability before serializing, so each
 * requirement carries exactly one of `reason` (a reader who can reach admin
 * settings) or `message` (a reader who cannot) — and a `destination` only ever
 * accompanies the admin register, which is what keeps an admin URL structurally
 * unable to reach an editor. Reading only one of the two would render a blank row
 * for every editor, which is why both are read here.
 *
 * @param {Object}  props                 Component props.
 * @param {Object}  props.requirement     Serialized requirement.
 * @param {string}  props.ownerLabel      The surface's own subject, to suppress self-referential attribution.
 * @param {boolean} props.showDestination Whether this row owns its destination, or the group renders a shared one.
 * @return {JSX.Element} Requirement row.
 */
export function RequirementRow( { requirement, ownerLabel, showDestination } ) {
	const sources = Array.isArray( requirement.sources )
		? requirement.sources
		: [];

	/*
	 * Attribution only earns its line when it says something the surface does
	 * not. On a single-capability agent the sole source *is* the agent, so
	 * "Needed by: Web Researcher" under the Web Researcher heading is noise; on
	 * Media Scout it names which of several providers need the key, which is the
	 * point.
	 */
	const showSources =
		sources.length > 1 ||
		( sources.length === 1 && sources[ 0 ] !== ownerLabel );

	return (
		<Stack
			className="vip-workflow-agent-requirements__requirement"
			direction="column"
			gap="xs"
		>
			<Text variant="body-md">
				{ requirement.reason ?? requirement.message }
			</Text>
			{ showSources && (
				<Text
					variant="body-sm"
					className="vip-workflow-agent-requirements__sources"
				>
					{ sprintf(
						/* translators: %s: comma-separated list of capability names that need this requirement. */
						__( 'Needed by: %s', 'vip-workflow' ),
						sources.join( ', ' )
					) }
				</Text>
			) }
			{ showDestination && (
				<RequirementDestination
					destination={ requirement.destination }
				/>
			) }
		</Stack>
	);
}

/**
 * The one destination every requirement in a group shares, if they share one.
 *
 * Media Scout's Tavily and YouTube requirements both resolve to Settings →
 * Connectors, so rendering each row's own link puts the same link on screen twice
 * under one "at least one of" heading.
 *
 * @param {Array} requirements Serialized requirements.
 * @return {Object|null} The shared destination, or null when they differ.
 */
export function sharedDestination( requirements ) {
	if ( requirements.length < 2 ) {
		return null;
	}

	const [ first ] = requirements;

	if ( 'admin_url' !== first.destination?.kind || ! first.destination.url ) {
		return null;
	}

	const allMatch = requirements.every(
		( requirement ) =>
			requirement.destination?.kind === first.destination.kind &&
			requirement.destination?.url === first.destination.url
	);

	return allMatch ? first.destination : null;
}

/**
 * One requirement group, rendered according to its satisfaction mode.
 *
 * An `any` group is a single "configure at least one of" block. Rendering its
 * members as separate blockers would tell the reader to satisfy all of them,
 * which is wrong for the motivating case (Media Scout needs Tavily *or* YouTube).
 *
 * The lead-in is omitted for a single-member `any` group: aggregation can reduce
 * one to a single row, and "configure at least one of" in front of one item reads
 * as a bug.
 *
 * @param {Object}  props                  Component props.
 * @param {Object}  props.group            Serialized requirement group.
 * @param {string}  props.ownerLabel       The surface's own subject, passed through to each row.
 * @param {boolean} props.showDestinations Whether this surface renders destinations at all.
 * @return {JSX.Element|null} Group block, or null when the group carries nothing.
 */
export function RequirementGroup( { group, ownerLabel, showDestinations } ) {
	const requirements = Array.isArray( group.requirements )
		? group.requirements
		: [];

	if ( 0 === requirements.length ) {
		return null;
	}

	const shared = showDestinations ? sharedDestination( requirements ) : null;

	const rows = requirements.map( ( requirement ) => (
		<RequirementRow
			key={ requirement.id }
			requirement={ requirement }
			ownerLabel={ ownerLabel }
			showDestination={ showDestinations && ! shared }
		/>
	) );

	if ( 'any' === group.satisfy ) {
		return (
			<Stack
				className="vip-workflow-agent-requirements__group"
				direction="column"
				gap="xs"
			>
				{ requirements.length > 1 && (
					<Text variant="body-md">
						{ __( 'Configure at least one of:', 'vip-workflow' ) }
					</Text>
				) }
				{ rows }
				{ shared && <RequirementDestination destination={ shared } /> }
			</Stack>
		);
	}

	return (
		<Stack
			className="vip-workflow-agent-requirements__group"
			direction="column"
			gap="md"
		>
			{ rows }
			{ shared && <RequirementDestination destination={ shared } /> }
		</Stack>
	);
}

/**
 * The same unmet requirements as one line of prose.
 *
 * For the places that name a blocked capability in passing and have no room for
 * the block above: a menu entry saying why a tool cannot be added, a tooltip on
 * a row that already carries it. Neither can hold a destination — a link inside
 * a menu item or a tooltip is a link nobody can reach — so this drops them and
 * keeps the reasons, which is the half that answers "why is this greyed out?".
 *
 * An `any` group says so rather than running its members together: "needs a
 * Tavily key, needs a YouTube key" reads as two demands when either would do.
 *
 * @param {Array} groups Serialized requirement groups.
 * @return {string} One line naming what is missing, or '' when nothing is.
 */
export function requirementText( groups ) {
	const list = Array.isArray( groups ) ? groups : [];

	return list
		.map( ( group ) => {
			const reasons = (
				Array.isArray( group.requirements ) ? group.requirements : []
			)
				// The server sends exactly one of the two, chosen by the
				// reader's capability — see `RequirementRow`.
				.map(
					( requirement ) => requirement.reason ?? requirement.message
				)
				.filter( Boolean );

			if ( 0 === reasons.length ) {
				return '';
			}

			if ( 'any' === group.satisfy && reasons.length > 1 ) {
				return sprintf(
					/* translators: %s: semicolon-separated list of requirements, any one of which is enough. */
					__( 'Needs one of: %s', 'vip-workflow' ),
					reasons.join( '; ' )
				);
			}

			return reasons.join( ' ' );
		} )
		.filter( Boolean )
		.join( ' ' );
}

/**
 * Stable React key for a group, derived from its shape rather than its index.
 *
 * Ids are sorted, because group membership is a set: two `any` groups listing the
 * same providers in different orders are the same choice. The server collapses
 * them on an identically sorted signature (`AssistantRegistry::aggregate_availability()`),
 * and the key has to agree with that decision or a collapse would look like a
 * remount.
 *
 * @param {Object} group Serialized requirement group.
 * @return {string} Group key.
 */
export function groupKey( group ) {
	const ids = (
		Array.isArray( group.requirements ) ? group.requirements : []
	)
		.map( ( requirement ) => requirement.id )
		.sort();

	return `${ group.satisfy }|${ ids.join( ',' ) }`;
}

/**
 * Every unmet requirement group for one agent.
 *
 * Renders nothing when there is nothing to report, so a caller can mount it
 * unconditionally. Callers own the surrounding treatment — a warning notice, an
 * inline hint — because what is appropriate differs by surface.
 *
 * `showDestinations` exists for a surface that names requirements but owns no way
 * to satisfy them. The register the server chose is the reader's, not the surface's,
 * so an administrator reading the ideation workspace receives the admin register —
 * whose `in_card` destination says "complete the fields below" about fields that
 * only exist on the Agents screen. Naming the requirement is still worth doing
 * there; pointing at a destination that is not present is the dead end this
 * component was built to remove.
 *
 * @param {Object}  props                         Component props.
 * @param {Array}   props.groups                  Serialized requirement groups.
 * @param {string}  props.ownerLabel              The agent's own name, to suppress self-referential attribution.
 * @param {boolean} [props.showDestinations=true] Whether this surface can act on a destination.
 * @return {JSX.Element|null} Requirement blocks, or null when there are none.
 */
export function AgentRequirements( {
	groups,
	ownerLabel,
	showDestinations = true,
} ) {
	const list = Array.isArray( groups ) ? groups : [];

	if ( 0 === list.length ) {
		return null;
	}

	return (
		<Stack
			className="vip-workflow-agent-requirements"
			direction="column"
			gap="md"
		>
			{ list.map( ( group ) => (
				<RequirementGroup
					key={ groupKey( group ) }
					group={ group }
					ownerLabel={ ownerLabel }
					showDestinations={ showDestinations }
				/>
			) ) }
		</Stack>
	);
}
