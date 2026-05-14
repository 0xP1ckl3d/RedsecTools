module.exports = {
  id: "020_engage_control_plane_cleanup",
  description: "Separate Engage delivery status from QA review status and normalize Calendar allocations.",
  up(db) {
    db.exec(`
      UPDATE engage_engagements
      SET status = 'ready_for_delivery'
      WHERE status = 'qa_ready_for_delivery';

      UPDATE engage_engagements
      SET status = 'reporting_in_progress'
      WHERE status IN ('ready_for_qa', 'qa_assigned', 'qa_in_progress', 'qa_changes_required');

      UPDATE engage_qa_reviews
      SET status = 'ready_for_delivery',
          completed_at = COALESCE(completed_at, updated_at, unixepoch())
      WHERE status = 'delivered';

      UPDATE engage_qa_reviews
      SET completed_at = COALESCE(completed_at, updated_at, unixepoch())
      WHERE status IN ('ready_for_delivery', 'requires_more_work', 'cancelled');

      UPDATE calendar_entries
      SET type = 'assignment', updated_at = unixepoch()
      WHERE project_id IS NOT NULL AND type = 'project';
    `);
  },
};
