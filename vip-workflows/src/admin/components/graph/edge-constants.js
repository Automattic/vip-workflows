/**
 * The tuned constants for the edge pipeline, in one place.
 *
 * Every value here came out of the routing lab (the "Sequence Canvas Lab"
 * design session) where each was a live slider judged against seven scenarios:
 * the shipping sequence, back edges, an agent fan-out, a parallel fan, a
 * reciprocal pair, a crowded rank, and a cross-region jump. They are one
 * design, not independent dials — several deliberately share a value (the
 * underpass marks reuse the port pitch and inset so the two kinds of mark stay
 * consistent), so change them together or not at all.
 *
 * Notably absent: any obstacle-detour tuning. The lab's conclusion was that
 * routing *around* stages reads worse than passing behind them — a line under
 * a card is legible when the stroke breaks to say so (`edge-tunnel.js`), while
 * a line swinging wide around three stacked stages is not. So there is no
 * router: centre repulsion nudges edges off the middle of cards, the port
 * search keeps them off their own two, and the underpass breaks carry the
 * rest.
 *
 * @package
 */

/**
 * Base length of a port stub — the straight run square out of the border
 * before the curve takes over. A default rather than a literal distance: the
 * actual reach is this times a span-scaled multiplier (STUB_MIN–STUB_MAX), so
 * the value reads as one dial for how much bend an edge gets.
 */
export const PORT_STUB = 36;

/** Stub multiplier at the short end of the ramp (edges STUB_NEAR px long). */
export const STUB_MIN = 0.5;
/** Stub multiplier at the long end (edges STUB_FAR px and beyond). */
export const STUB_MAX = 1.5;
/** Span at which the stub ramp starts rising, in flow px. */
export const STUB_NEAR = 24;
/** Span past which more stub adds nothing, in flow px. */
export const STUB_FAR = 670;

/**
 * How hard the port-choice cost charges a port whose outward normal disagrees
 * with the direction the drawn curve actually sets off in (and arrives from).
 */
export const ALIGN_WEIGHT = 1.5;

/** How hard each curvature reversal in the drawn curve is charged. */
export const INFLECT_WEIGHT = 1;

/**
 * The penalty for an edge between ranks entering (and worse, also leaving) by
 * a cross-axis border. Arrival carries the meaning — in a downward flow a
 * stage is entered from above, and an arrowhead into a flank reads as a
 * sibling rather than a successor — so a cross-axis arrival is charged half
 * of this on its own and the full amount when both ends use one.
 */
export const FLOW_BIAS = 2.85;

/**
 * An edge never has to pass under the stage it starts from or ends at — moving
 * the port is always available and always simpler — so samples buried in its
 * own two cards are charged at this per-sample rate, far above any judgement
 * call the rest of the cost makes.
 */
export const SELF_HIT_WEIGHT = 12;

/**
 * The hysteresis handicap on port-search alternatives: the incumbent keeps
 * near-ties, so an edge doesn't flicker between borders while its stage is
 * dragged past the point where two pairings cost the same.
 */
export const SEARCH_KEEP = 0.92;

/**
 * How much longer than the natural route an alternative may be and still be
 * considered. The real limit adapts: this base plus a share of the natural
 * route's own misalignment, so a badly-aimed port is worth escaping at real
 * cost while a well-aimed one keeps the tolerance tight.
 */
export const SEARCH_TOLERANCE = 2;

/**
 * The one spacing between parallel things, in flow px: ports sharing a
 * border, the lanes of a bundle, and the underpass break marks all use this
 * same value. It used to be two dials (16px port spread, 8px lane pitch), and
 * the difference was visible as flicker — the moment a bundle formed or
 * dissolved, its ports re-spaced from one value to the other. One value means
 * a loom's ports are already at lane pitch and nothing ever re-spaces.
 */
export const PORT_SPREAD = 12;

/**
 * How far apart (in multiples of the pitch) two ports may sit and still be
 * gathered into one evenly-pitched cluster. Widens the catchment without
 * widening the spacing: close ports open out, loose ones pull in.
 */
export const CLUSTER_RANGE = 4.8;

/** How near a corner a port may sit, in flow px. */
export const BORDER_INSET = 4;

/**
 * How hard a port is drawn back toward the middle of its face, as a share of
 * its distance out. Quadratic in effect: a port near the middle is untouched,
 * one pinned to a corner moves most — which is where the outward normal points
 * 90° away from where the edge has to go.
 */
export const CENTER_PULL = 0.7;

/**
 * Two opposed ports closer together than this are moved to their average so
 * the short run between them draws dead straight instead of wagging an S
 * across a few pixels of lateral offset.
 */
export const INLINE_RANGE = 50;

/**
 * How far past a card's border its repulsion reaches, in flow px. The field
 * is elliptical, matched to the card's footprint: measured as a plain radius
 * from the centre, a 200×80 card's field reached 160px past its top and
 * bottom — across a whole tier — while reaching only 100px past its flanks,
 * so dragging a stage near an edge in x but a full rank away in y still
 * shoved it. Reach past the border is now this, on every side.
 */
export const REPEL_RANGE = 100;
/** How far the repulsion pushes at full strength, in flow px. */
export const REPEL_FORCE = 20;

/**
 * The lane gap a bundle of co-travelling edges closes to — the same value as
 * the port pitch, on purpose (see `PORT_SPREAD`).
 */
export const EDGE_PITCH = PORT_SPREAD;
/**
 * How far apart two edges may run (in multiples of the pitch) and still count
 * as travelling alongside each other. Rescaled when the pitch went from 8 to
 * 12 so the absolute catchment (48px) stayed what the lab tuned.
 */
export const EDGE_REACH = 4;
/**
 * How close two edges must actually come (in multiples of the pitch), inside
 * the stretch where they run alongside, to be worth gathering. Rescaled with
 * the pitch: the absolute catchment stays 20px.
 */
export const EDGE_GATHER = 1.67;
/** Share of an edge's length that must run alongside a neighbour to bundle. */
export const EDGE_OVERLAP = 0.25;
/** How far out of parallel two edges may point, in degrees, and still bundle. */
export const EDGE_PARALLEL_DEG = 60;
/**
 * The hysteresis on loom membership: how much the gather and reach gates widen
 * for a pair that was bundled last frame. The counterpart of `SEARCH_KEEP` —
 * without it a pair sitting at the gather threshold joins and leaves its loom
 * on alternate frames of a drag, and every toggle moves ports and levers.
 */
export const EDGE_KEEP = 1.4;
/**
 * How far below its target a bundle's settled gap may fall before the guard
 * rolls the loom back. The lane and pitch passes converge to within a few
 * tenths of a pixel and the sampled polylines cut curve corners by a little
 * more, so a guard with no slack sits inside its own measurement noise and
 * turns bundling into a coin flip — gathered one frame, rolled back the next.
 */
export const EDGE_GUARD_SLACK = 1;

/**
 * How far a lane pass may pull an edge's control point from where the plan put
 * it, as a share of the edge's own span — across the edge, and along it.
 *
 * A loom's lanes are held by shifting each member's lever along the *loom's*
 * perpendicular, and a loom is a transitive thing: A gathers with B, B with C,
 * and C ends up in a bundle whose direction is nothing like its own. When the
 * loom's perpendicular lands near a member's own axis, the shift stops bowing
 * that member and starts stretching it — its lever slides past its own target,
 * and the curve loops out and back to reach it. That is what put a 77px edge's
 * control point 226px beyond the stage it was going to.
 *
 * So the two components are bounded separately, and unequally. Across the edge
 * is what lane separation actually needs, and the bound there is generous; along
 * it buys nothing — it only changes how the curve is paced between fixed ends —
 * so it is held near zero. An edge the loom can only move the wrong way keeps
 * its shape and drops out of the lane order, which is the honest outcome: it was
 * never travelling with the others.
 */
export const LEVER_ACROSS = 0.6;
export const LEVER_ALONG = 0.25;
/**
 * Floor under the across bound, in px, so a genuinely short edge can still take
 * a lane or two. Three pitches: half the width of a six-member loom.
 */
export const LEVER_FLOOR = EDGE_PITCH * 3;

/**
 * Clearance between a mark on the line and the card it points at, in px.
 *
 * One number for both marks the Figma port spec (`2210:680`) puts near a
 * border: the arrowhead's tip, and the dome of the cup closing an underpass.
 * A head and a mouth on the same border stop level with each other, which is
 * what makes them read as two ends of one line rather than two decorations.
 * The line is trimmed to leave it (`trimPathEnd`), so it is a gap and not an
 * overlap.
 */
export const MARK_STANDOFF = 1.5;

/** Diameter of the cup closing each end of an underpass break, in px. */
export const TUNNEL_CAP = 7;
/**
 * Standoff between an underpass break — where the visible stroke stops — and
 * the card it passes under. The cup is centred there and domes half its width
 * toward the card, so the clearance left is `MARK_STANDOFF`.
 */
export const TUNNEL_GAP = MARK_STANDOFF + TUNNEL_CAP / 2;
/** Opacity of the ghost — the hidden span drawn faintly above the card. */
export const TUNNEL_GHOST = 0.3;
/**
 * The ghost's dot and the space after it, in px. Faint was not enough on its
 * own: a low-opacity line over a card still reads as a line drawn on the card.
 * Dotted says "this is the same edge, and it is behind this" in a way no amount
 * of transparency does. Fixed lengths rather than multiples of the stroke, so
 * the texture holds when the line thickens on hover.
 *
 * The spec draws its dots as zero-length dashes under a round cap; these are 1px
 * dashes under a butt cap, keeping the spec's 3.1px rhythm and its ink. The
 * pattern carries zero-length entries of its own to stay in phase
 * (`edge-tunnel.js`), and a round cap would render every one of those as a stray
 * dot — at this size the two are indistinguishable anyway.
 */
export const TUNNEL_DOT = 1;
export const TUNNEL_DOT_GAP = 2.1;
