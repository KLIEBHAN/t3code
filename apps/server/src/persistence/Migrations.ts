/**
 * MigrationsLive - Migration runner with inline loader
 *
 * Uses Migrator.make with fromRecord to define migrations inline.
 * All migrations are statically imported - no dynamic file system loading.
 *
 * Migrations run automatically when the MigrationLayer is provided,
 * ensuring the database schema is always up-to-date before the application starts.
 */

import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";

// Import all migrations statically
import Migration0001 from "./Migrations/001_OrchestrationEvents.ts";
import Migration0002 from "./Migrations/002_OrchestrationCommandReceipts.ts";
import Migration0003 from "./Migrations/003_CheckpointDiffBlobs.ts";
import Migration0004 from "./Migrations/004_ProviderSessionRuntime.ts";
import Migration0005 from "./Migrations/005_Projections.ts";
import Migration0006 from "./Migrations/006_ProjectionThreadSessionRuntimeModeColumns.ts";
import Migration0007 from "./Migrations/007_ProjectionThreadMessageAttachments.ts";
import Migration0008 from "./Migrations/008_ProjectionThreadActivitySequence.ts";
import Migration0009 from "./Migrations/009_ProviderSessionRuntimeMode.ts";
import Migration0010 from "./Migrations/010_ProjectionThreadsRuntimeMode.ts";
import Migration0011 from "./Migrations/011_OrchestrationThreadCreatedRuntimeMode.ts";
import Migration0012 from "./Migrations/012_ProjectionThreadsInteractionMode.ts";
import Migration0013 from "./Migrations/013_ProjectionThreadProposedPlans.ts";
import Migration0014 from "./Migrations/014_ProjectionThreadProposedPlanImplementation.ts";
import Migration0015 from "./Migrations/015_ProjectionTurnsSourceProposedPlan.ts";
import Migration0016 from "./Migrations/016_CanonicalizeModelSelections.ts";
import Migration0017 from "./Migrations/017_ProjectionThreadsArchivedAt.ts";
import Migration0018 from "./Migrations/018_ProjectionThreadsArchivedAtIndex.ts";
import Migration0019 from "./Migrations/019_ProjectionSnapshotLookupIndexes.ts";
import Migration0020 from "./Migrations/020_AuthAccessManagement.ts";
import Migration0021 from "./Migrations/021_AuthSessionClientMetadata.ts";
import Migration0022 from "./Migrations/022_AuthSessionLastConnectedAt.ts";
import Migration0023 from "./Migrations/023_ProjectionThreadShellSummary.ts";
import Migration0024 from "./Migrations/024_BackfillProjectionThreadShellSummary.ts";
import Migration0025 from "./Migrations/025_CleanupInvalidProjectionPendingApprovals.ts";
import Migration0026 from "./Migrations/026_CanonicalizeModelSelectionOptions.ts";
import Migration0027 from "./Migrations/027_ProviderSessionRuntimeInstanceId.ts";
import Migration0028 from "./Migrations/028_ProjectionThreadSessionInstanceId.ts";
import Migration0029 from "./Migrations/029_ProjectionThreadDetailOrderingIndexes.ts";
import Migration0030 from "./Migrations/030_ProjectionThreadShellArchiveIndexes.ts";
import Migration0031 from "./Migrations/031_AuthAuthorizationScopes.ts";
import Migration0032 from "./Migrations/032_AuthPairingProofKeyThumbprint.ts";

/**
 * Migration loader with all migrations defined inline.
 *
 * Key format: "{id}_{name}" where:
 * - id: numeric migration ID (determines execution order)
 * - name: descriptive name for the migration
 *
 * Uses Migrator.fromRecord which parses the key format and
 * returns migrations sorted by ID.
 */
export const migrationEntries = [
  [1, "OrchestrationEvents", Migration0001],
  [2, "OrchestrationCommandReceipts", Migration0002],
  [3, "CheckpointDiffBlobs", Migration0003],
  [4, "ProviderSessionRuntime", Migration0004],
  [5, "Projections", Migration0005],
  [6, "ProjectionThreadSessionRuntimeModeColumns", Migration0006],
  [7, "ProjectionThreadMessageAttachments", Migration0007],
  [8, "ProjectionThreadActivitySequence", Migration0008],
  [9, "ProviderSessionRuntimeMode", Migration0009],
  [10, "ProjectionThreadsRuntimeMode", Migration0010],
  [11, "OrchestrationThreadCreatedRuntimeMode", Migration0011],
  [12, "ProjectionThreadsInteractionMode", Migration0012],
  [13, "ProjectionThreadProposedPlans", Migration0013],
  [14, "ProjectionThreadProposedPlanImplementation", Migration0014],
  [15, "ProjectionTurnsSourceProposedPlan", Migration0015],
  [16, "CanonicalizeModelSelections", Migration0016],
  [17, "ProjectionThreadsArchivedAt", Migration0017],
  [18, "ProjectionThreadsArchivedAtIndex", Migration0018],
  [19, "ProjectionSnapshotLookupIndexes", Migration0019],
  [20, "AuthAccessManagement", Migration0020],
  [21, "AuthSessionClientMetadata", Migration0021],
  [22, "AuthSessionLastConnectedAt", Migration0022],
  [23, "ProjectionThreadShellSummary", Migration0023],
  [24, "BackfillProjectionThreadShellSummary", Migration0024],
  [25, "CleanupInvalidProjectionPendingApprovals", Migration0025],
  [26, "CanonicalizeModelSelectionOptions", Migration0026],
  [27, "ProviderSessionRuntimeInstanceId", Migration0027],
  [28, "ProjectionThreadSessionInstanceId", Migration0028],
  [29, "ProjectionThreadDetailOrderingIndexes", Migration0029],
  [30, "ProjectionThreadShellArchiveIndexes", Migration0030],
  [31, "AuthAuthorizationScopes", Migration0031],
  [32, "AuthPairingProofKeyThumbprint", Migration0032],
] as const;

export const makeMigrationLoader = (throughId?: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      migrationEntries
        .filter(([id]) => throughId === undefined || id <= throughId)
        .map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  );

/**
 * Migrator run function - no schema dumping needed
 * Uses the base Migrator.make without platform dependencies
 */
const run = Migrator.make({});

// Some alpha builds wrote compatibility migrations with IDs above the current
// linear migration sequence. Effect's migrator advances by the highest recorded
// ID, so those obsolete records can otherwise cause current migrations to be
// skipped on existing developer databases.
const obsoleteLegacyMigrationNamesById = new Map<number, ReadonlySet<string>>([
  [17, new Set(["ProjectionTurnUnifiedDiff"])],
  [18, new Set(["ProjectionThreadProposedPlanImplementationBackfill"])],
  [19, new Set(["BackfillLegacyModelSelections"])],
  [20, new Set(["ProjectionThreadProposedPlanImplementationBackfill"])],
  [21, new Set(["BackfillLegacyModelSelections"])],
  [100, new Set(["ProjectionThreadsArchivedAtCompatibilityBackfill"])],
  [101, new Set(["ProjectionThreadsArchivedAtIndexCompatibilityBackfill"])],
  [102, new Set(["ProjectionThreadsArchivedAtCompatibilityBackfill"])],
  [103, new Set(["ProjectionThreadsArchivedAtIndexCompatibilityBackfill"])],
  [104, new Set(["ProjectionThreadsArchivedAtCompatibilityBackfill"])],
  [105, new Set(["ProjectionThreadsArchivedAtIndexCompatibilityBackfill"])],
  [106, new Set(["AuthAccessManagementCompatibilityBackfill"])],
  [107, new Set(["AuthSessionClientMetadataCompatibilityBackfill"])],
  [108, new Set(["AuthSessionLastConnectedAtCompatibilityBackfill"])],
  [109, new Set(["ProjectionThreadShellSummaryCompatibilityBackfill"])],
]);

const normalizeLegacyMigrationTimeline = Effect.fn("normalizeLegacyMigrationTimeline")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const migrationTables = yield* sql<{ readonly name: string }>`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name = 'effect_sql_migrations'
  `;

    if (migrationTables.length === 0) {
      return;
    }

    const migrationRows = yield* sql<{
      readonly migrationId: number;
      readonly name: string;
    }>`
    SELECT
      migration_id AS "migrationId",
      name AS "name"
    FROM effect_sql_migrations
    WHERE migration_id BETWEEN 17 AND 21
      OR migration_id BETWEEN 100 AND 109
    ORDER BY migration_id
  `;

    const obsoleteMigrationIds = migrationRows
      .filter(
        (row) => obsoleteLegacyMigrationNamesById.get(row.migrationId)?.has(row.name) ?? false,
      )
      .map((row) => row.migrationId);

    if (obsoleteMigrationIds.length === 0) {
      return;
    }

    yield* Effect.logWarning("normalizing obsolete legacy migration records").pipe(
      Effect.annotateLogs({ migrationIds: obsoleteMigrationIds.join(",") }),
    );

    for (const migrationId of obsoleteMigrationIds) {
      yield* sql`
      DELETE FROM effect_sql_migrations
      WHERE migration_id = ${migrationId}
    `;
    }
  },
);

export interface RunMigrationsOptions {
  readonly toMigrationInclusive?: number | undefined;
}

/**
 * Run all pending migrations.
 *
 * Creates the migrations tracking table (effect_sql_migrations) if it doesn't exist,
 * then runs any migrations with ID greater than the latest recorded migration.
 *
 * Returns array of [id, name] tuples for migrations that were run.
 *
 * @returns Effect containing array of executed migrations
 */
export const runMigrations = Effect.fn("runMigrations")(function* ({
  toMigrationInclusive,
}: RunMigrationsOptions = {}) {
  yield* Effect.log(
    toMigrationInclusive === undefined
      ? "Running all migrations..."
      : `Running migrations 1 through ${toMigrationInclusive}...`,
  );
  yield* normalizeLegacyMigrationTimeline();
  const executedMigrations = yield* run({ loader: makeMigrationLoader(toMigrationInclusive) });
  yield* Effect.log("Migrations ran successfully").pipe(
    Effect.annotateLogs({ migrations: executedMigrations.map(([id, name]) => `${id}_${name}`) }),
  );
  return executedMigrations;
});

/**
 * Layer that runs migrations when the layer is built.
 *
 * Use this to ensure migrations run before your application starts.
 * Migrations are run automatically - no separate script is needed.
 *
 * @example
 * ```typescript
 * import { MigrationsLive } from "@acme/db/Migrations"
 * import * as SqliteClient from "@acme/db/SqliteClient"
 *
 * // Migrations run automatically when SqliteClient is provided
 * const AppLayer = MigrationsLive.pipe(
 *   Layer.provideMerge(SqliteClient.layer({ filename: "database.sqlite" }))
 * )
 * ```
 */
export const MigrationsLive = Layer.effectDiscard(runMigrations());
