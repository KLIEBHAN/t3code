import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Legacy alpha builds may have added these columns through compatibility
  // backfills, so each column addition must stay idempotent.
  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  const hasColumn = (name: string) => threadColumns.some((column) => column.name === name);

  if (!hasColumn("latest_user_message_at")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN latest_user_message_at TEXT
    `;
  }

  if (!hasColumn("pending_approval_count")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN pending_approval_count INTEGER NOT NULL DEFAULT 0
    `;
  }

  if (!hasColumn("pending_user_input_count")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN pending_user_input_count INTEGER NOT NULL DEFAULT 0
    `;
  }

  if (!hasColumn("has_actionable_proposed_plan")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN has_actionable_proposed_plan INTEGER NOT NULL DEFAULT 0
    `;
  }
});
