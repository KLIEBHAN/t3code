import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("031_AuthAuthorizationScopes", (it) => {
  it.effect("invalidates role-based auth records and installs scoped auth tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 30 });

      yield* sql`
        INSERT INTO auth_pairing_links (
          id,
          credential,
          method,
          role,
          subject,
          created_at,
          expires_at
        )
        VALUES (
          'link-owner',
          'bootstrap-owner',
          'desktop-bootstrap',
          'owner',
          'desktop',
          '2026-05-29T00:00:00.000Z',
          '2026-05-29T01:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO auth_sessions (
          session_id,
          subject,
          role,
          method,
          issued_at,
          expires_at
        )
        VALUES (
          'session-owner',
          'desktop',
          'owner',
          'browser-session-cookie',
          '2026-05-29T00:00:00.000Z',
          '2026-05-29T01:00:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 31 });

      const pairingColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(auth_pairing_links)
      `;
      const sessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(auth_sessions)
      `;
      const pairingRows = yield* sql<{ readonly id: string }>`
        SELECT id FROM auth_pairing_links
      `;
      const sessionRows = yield* sql<{ readonly sessionId: string }>`
        SELECT session_id AS "sessionId" FROM auth_sessions
      `;

      assert.isTrue(pairingColumns.some((column) => column.name === "scopes"));
      assert.isFalse(pairingColumns.some((column) => column.name === "role"));
      assert.isTrue(sessionColumns.some((column) => column.name === "scopes"));
      assert.isFalse(sessionColumns.some((column) => column.name === "role"));
      assert.deepStrictEqual(pairingRows, []);
      assert.deepStrictEqual(sessionRows, []);
    }),
  );

  it.effect("normalizes obsolete legacy high-watermark records before scoped auth migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 21 });

      const obsoleteLowMigrationNames = [
        [17, "ProjectionTurnUnifiedDiff"],
        [18, "ProjectionThreadProposedPlanImplementationBackfill"],
        [19, "BackfillLegacyModelSelections"],
        [20, "ProjectionThreadProposedPlanImplementationBackfill"],
        [21, "BackfillLegacyModelSelections"],
      ] as const;
      for (const [migrationId, name] of obsoleteLowMigrationNames) {
        yield* sql`
          UPDATE effect_sql_migrations
          SET name = ${name}
          WHERE migration_id = ${migrationId}
        `;
      }

      const obsoleteHighMigrationNames = [
        [100, "ProjectionThreadsArchivedAtCompatibilityBackfill"],
        [101, "ProjectionThreadsArchivedAtIndexCompatibilityBackfill"],
        [102, "ProjectionThreadsArchivedAtCompatibilityBackfill"],
        [103, "ProjectionThreadsArchivedAtIndexCompatibilityBackfill"],
        [104, "ProjectionThreadsArchivedAtCompatibilityBackfill"],
        [105, "ProjectionThreadsArchivedAtIndexCompatibilityBackfill"],
        [106, "AuthAccessManagementCompatibilityBackfill"],
        [107, "AuthSessionClientMetadataCompatibilityBackfill"],
        [108, "AuthSessionLastConnectedAtCompatibilityBackfill"],
        [109, "ProjectionThreadShellSummaryCompatibilityBackfill"],
      ] as const;
      for (const [migrationId, name] of obsoleteHighMigrationNames) {
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (${migrationId}, ${name})
        `;
      }

      // The legacy compatibility backfills already applied later schema changes,
      // so rerunning the current migrations must tolerate pre-existing columns.
      yield* sql`
        ALTER TABLE projection_threads
        ADD COLUMN latest_user_message_at TEXT
      `;
      yield* sql`
        ALTER TABLE projection_threads
        ADD COLUMN pending_approval_count INTEGER NOT NULL DEFAULT 0
      `;
      yield* sql`
        ALTER TABLE projection_threads
        ADD COLUMN pending_user_input_count INTEGER NOT NULL DEFAULT 0
      `;
      yield* sql`
        ALTER TABLE projection_threads
        ADD COLUMN has_actionable_proposed_plan INTEGER NOT NULL DEFAULT 0
      `;

      yield* sql`
        INSERT INTO auth_pairing_links (
          id,
          credential,
          method,
          role,
          subject,
          created_at,
          expires_at
        )
        VALUES (
          'legacy-link-owner',
          'legacy-bootstrap-owner',
          'desktop-bootstrap',
          'owner',
          'desktop',
          '2026-05-29T00:00:00.000Z',
          '2026-05-29T01:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO auth_sessions (
          session_id,
          subject,
          role,
          method,
          issued_at,
          expires_at
        )
        VALUES (
          'legacy-session-owner',
          'desktop',
          'owner',
          'browser-session-cookie',
          '2026-05-29T00:00:00.000Z',
          '2026-05-29T01:00:00.000Z'
        )
      `;

      yield* runMigrations();

      const obsoleteRows = yield* sql<{ readonly migrationId: number }>`
        SELECT migration_id AS "migrationId"
        FROM effect_sql_migrations
        WHERE migration_id BETWEEN 100 AND 109
        ORDER BY migration_id
      `;
      const normalizedRows = yield* sql<{
        readonly migrationId: number;
        readonly name: string;
      }>`
        SELECT
          migration_id AS "migrationId",
          name AS "name"
        FROM effect_sql_migrations
        WHERE migration_id BETWEEN 17 AND 32
        ORDER BY migration_id
      `;
      const snapshotIndexes = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND name = 'idx_projection_projects_workspace_root_deleted_at'
      `;
      const pairingColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(auth_pairing_links)
      `;
      const sessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(auth_sessions)
      `;
      const pairingRows = yield* sql<{ readonly id: string }>`
        SELECT id FROM auth_pairing_links
      `;
      const sessionRows = yield* sql<{ readonly sessionId: string }>`
        SELECT session_id AS "sessionId" FROM auth_sessions
      `;

      assert.deepStrictEqual(obsoleteRows, []);
      assert.deepStrictEqual(
        normalizedRows.map((row) => row.migrationId),
        Array.from({ length: 16 }, (_, index) => index + 17),
      );
      assert.equal(
        normalizedRows.find((row) => row.migrationId === 31)?.name,
        "AuthAuthorizationScopes",
      );
      assert.equal(snapshotIndexes.length, 1);
      assert.isTrue(pairingColumns.some((column) => column.name === "scopes"));
      assert.isTrue(pairingColumns.some((column) => column.name === "proof_key_thumbprint"));
      assert.isFalse(pairingColumns.some((column) => column.name === "role"));
      assert.isTrue(sessionColumns.some((column) => column.name === "scopes"));
      assert.isFalse(sessionColumns.some((column) => column.name === "role"));
      assert.deepStrictEqual(pairingRows, []);
      assert.deepStrictEqual(sessionRows, []);
    }),
  );
});
