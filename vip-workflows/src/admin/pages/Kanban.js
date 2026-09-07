/**
 * Kanban Page Component
 *
 * Trello-style board view of workflow content. The page chrome (AdminPage
 * header, breadcrumbs, and the board's toolbar in the actions slot) lives in
 * KanbanBoard, where the toolbar state it drives is held.
 *
 * @package
 */

import { KanbanBoard } from '../components/KanbanBoard';

/**
 * Kanban page component.
 *
 * @return {JSX.Element} Kanban page.
 */
export default function Kanban() {
	return <KanbanBoard />;
}
