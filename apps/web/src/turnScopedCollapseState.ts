export interface TurnScopedCollapseState {
  turnId: string | null;
  collapsed: boolean;
}

export const INITIAL_TURN_SCOPED_COLLAPSE_STATE: TurnScopedCollapseState = {
  turnId: null,
  collapsed: false,
};

export function syncTurnScopedCollapseState(
  state: TurnScopedCollapseState,
  turnId: string | null,
): TurnScopedCollapseState {
  if (!turnId) {
    return state.turnId === null && !state.collapsed ? state : INITIAL_TURN_SCOPED_COLLAPSE_STATE;
  }
  if (state.turnId === turnId) {
    return state;
  }
  return {
    turnId,
    collapsed: false,
  };
}

export function setTurnScopedCollapsed(
  state: TurnScopedCollapseState,
  turnId: string | null,
  collapsed: boolean,
): TurnScopedCollapseState {
  if (!turnId) {
    return INITIAL_TURN_SCOPED_COLLAPSE_STATE;
  }
  if (state.turnId !== turnId) {
    return {
      turnId,
      collapsed,
    };
  }
  if (state.collapsed === collapsed) {
    return state;
  }
  return {
    ...state,
    collapsed,
  };
}
