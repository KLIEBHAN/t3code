import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const partialMigrationLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

partialMigrationLayer("027_028_ProviderInstanceIdColumns", (it) => {
  it.effect("continues when provider_session_runtime was partially migrated", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 26 });
      yield* sql`
        ALTER TABLE provider_session_runtime
        ADD COLUMN provider_instance_id TEXT
      `;

      yield* runMigrations({ toMigrationInclusive: 28 });

      const migrations = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id IN (27, 28)
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(migrations, [
        {
          migration_id: 27,
          name: "ProviderSessionRuntimeInstanceId",
        },
        {
          migration_id: 28,
          name: "ProjectionThreadSessionInstanceId",
        },
      ]);

      const providerSessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(provider_session_runtime)
      `;
      assert.ok(providerSessionColumns.some((column) => column.name === "provider_instance_id"));

      const projectionThreadSessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_sessions)
      `;
      assert.ok(
        projectionThreadSessionColumns.some((column) => column.name === "provider_instance_id"),
      );

      const providerSessionIndexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(provider_session_runtime)
      `;
      assert.ok(
        providerSessionIndexes.some(
          (index) => index.name === "idx_provider_session_runtime_instance",
        ),
      );

      const projectionThreadSessionIndexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_thread_sessions)
      `;
      assert.ok(
        projectionThreadSessionIndexes.some(
          (index) => index.name === "idx_projection_thread_sessions_instance",
        ),
      );
    }),
  );
});

const repairMigrationLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

repairMigrationLayer("normalizeLegacyMigrationTimeline", (it) => {
  it.effect("normalizes legacy high-watermarks and runs the current migration timeline", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 26 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (109, 'ProjectionThreadShellSummaryCompatibilityBackfill')
      `;

      yield* runMigrations();

      const migrations = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id BETWEEN 27 AND 34
          OR migration_id = 109
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(migrations, [
        { migration_id: 27, name: "ProviderSessionRuntimeInstanceId" },
        { migration_id: 28, name: "ProjectionThreadSessionInstanceId" },
        { migration_id: 29, name: "ProjectionThreadDetailOrderingIndexes" },
        { migration_id: 30, name: "ProjectionThreadShellArchiveIndexes" },
        { migration_id: 31, name: "AuthAuthorizationScopes" },
        { migration_id: 32, name: "AuthPairingProofKeyThumbprint" },
        { migration_id: 33, name: "ProjectionThreadsSettled" },
        { migration_id: 34, name: "ProjectionThreadsSnoozed" },
      ]);

      const projectionThreadColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      for (const columnName of ["settled_override", "settled_at", "snoozed_until", "snoozed_at"]) {
        assert.ok(projectionThreadColumns.some((column) => column.name === columnName));
      }

      const providerSessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(provider_session_runtime)
      `;
      assert.ok(providerSessionColumns.some((column) => column.name === "provider_instance_id"));

      const projectionThreadSessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_sessions)
      `;
      assert.ok(
        projectionThreadSessionColumns.some((column) => column.name === "provider_instance_id"),
      );

      const providerSessionIndexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(provider_session_runtime)
      `;
      assert.ok(
        providerSessionIndexes.some(
          (index) => index.name === "idx_provider_session_runtime_instance",
        ),
      );

      const projectionThreadSessionIndexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_thread_sessions)
      `;
      assert.ok(
        projectionThreadSessionIndexes.some(
          (index) => index.name === "idx_projection_thread_sessions_instance",
        ),
      );
    }),
  );
});
