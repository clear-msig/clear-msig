export interface InitialAuthFlowState {
  sdkHasLoaded: boolean;
  hasUsableWallet: boolean;
  alreadyHandled: boolean;
  showAuthFlow: boolean;
}

export interface InitialAuthFlowDecision {
  handled: boolean;
  dismiss: boolean;
}

export function initialAuthFlowDecision(
  state: InitialAuthFlowState,
): InitialAuthFlowDecision {
  if (!state.sdkHasLoaded || !state.hasUsableWallet || state.alreadyHandled) {
    return { handled: state.alreadyHandled, dismiss: false };
  }
  return { handled: true, dismiss: state.showAuthFlow };
}
