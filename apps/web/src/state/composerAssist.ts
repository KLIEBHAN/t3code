import { createComposerAssistEnvironmentAtoms } from "@t3tools/client-runtime/state/composerAssist";

import { connectionAtomRuntime } from "../connection/runtime";

export const composerAssistEnvironment =
  createComposerAssistEnvironmentAtoms(connectionAtomRuntime);
