import { useCallback, useEffect, useState } from "react";

import {
  INITIAL_TURN_SCOPED_COLLAPSE_STATE,
  setTurnScopedCollapsed,
  syncTurnScopedCollapseState,
} from "../turnScopedCollapseState";

export function useTurnScopedCollapseState(turnId: string | null) {
  const [state, setState] = useState(INITIAL_TURN_SCOPED_COLLAPSE_STATE);

  useEffect(() => {
    setState((current) => syncTurnScopedCollapseState(current, turnId));
  }, [turnId]);

  const show = useCallback(() => {
    setState((current) => setTurnScopedCollapsed(current, turnId, false));
  }, [turnId]);

  const hide = useCallback(() => {
    setState((current) => setTurnScopedCollapsed(current, turnId, true));
  }, [turnId]);

  return {
    collapsed: state.turnId === turnId && state.collapsed,
    show,
    hide,
  };
}
