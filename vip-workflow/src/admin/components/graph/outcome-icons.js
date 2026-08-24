/**
 * The glyph each agent outcome is read by.
 *
 * Two layers draw it, and they have to agree: the exit badge on an AI stage's
 * border (`StageNode`) and the mark an outcome edge departs from
 * (`EdgeOverlay`). They are the same statement about the same route — one on
 * the card, one on the line — so a reader who learns the check on the badge
 * reads it again on the edge without being taught twice.
 *
 * The glyph is what keeps the three apart for anyone who cannot separate the
 * hues, which is why every surface that paints an outcome tone paints one of
 * these with it. `error` is the triangle: the round `caution` is already the
 * stage card's warning flag, and two exclamation circles on one node would read
 * as one thing.
 *
 * @package
 */

import { check, close, error as errorTriangle } from '@wordpress/icons';

export const OUTCOME_ICONS = {
	pass: check,
	fail: close,
	error: errorTriangle,
};
