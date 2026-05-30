import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";

import { ServerSettingsService } from "./serverSettings.ts";
import * as TextGeneration from "./textGeneration/TextGeneration.ts";

/**
 * Acquire the services once at layer construction; the returned runner sends a
 * composer-assist prompt to the user's configured text generation model.
 */
export const makeComposerAssistTextGeneration = Effect.gen(function* () {
  const textGeneration = yield* TextGeneration.TextGeneration;
  const serverSettings = yield* ServerSettingsService;

  return <S extends Schema.Decoder<unknown>>(input: {
    readonly cwd: string;
    readonly prompt: string;
    readonly outputSchema: S;
  }) =>
    serverSettings.getSettings.pipe(
      Effect.flatMap((settings) =>
        textGeneration.generateStructured({
          ...input,
          modelSelection: settings.textGenerationModelSelection,
        }),
      ),
    );
});
