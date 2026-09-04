import { useCallback, useState } from "react";

import {
  INITIAL_TURN_SCOPED_COLLAPSE_STATE,
  setTurnScopedCollapsed,
  syncTurnScopedCollapseState,
} from "../turnScopedCollapseState";

export function useTurnScopedCollapseState(turnId: string | null) {
  const [state, setState] = useState(INITIAL_TURN_SCOPED_COLLAPSE_STATE);
  // A collapse only applies to the turn it was made on, so a turn change is
  // resolved while rendering instead of by writing state back from an effect.
  const current = syncTurnScopedCollapseState(state, turnId);

  const show = useCallback(() => {
    setState((current) => setTurnScopedCollapsed(current, turnId, false));
  }, [turnId]);

  const hide = useCallback(() => {
    setState((current) => setTurnScopedCollapsed(current, turnId, true));
  }, [turnId]);

  return {
    collapsed: current.collapsed,
    show,
    hide,
  };
}
