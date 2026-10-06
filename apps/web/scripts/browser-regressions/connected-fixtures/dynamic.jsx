"use client";
import { member } from "./data";
// Public SDK hook boundary only. App-owned SignInSecurityRow remains unchanged.
export function useDynamicContext() {
  return {
    sdkHasLoaded:
      typeof window === "undefined" ||
      !window.location.search.includes("auth-delayed"),
    setShowAuthFlow: () => {
      window.__fixtureAuthRequests = (window.__fixtureAuthRequests || 0) + 1;
    },
    user: { userId: "fixture-only" },
    primaryWallet: {
      address: member,
      connector: { key: "fixture-external-wallet" },
    },
    setShowDynamicUserProfile: () => {
      throw new Error("Third-party profile UI is outside the local fixture");
    },
  };
}
export const getAuthToken = () => undefined;
export const useUserWallets = () => [];
export const useIsLoggedIn = () => true;
export const useGetPasskeys = () => ({ data: [], isLoading: false });
export const useRegisterPasskey = () => ({
  registerPasskey: async () => {
    throw new Error("External device UI is not exercised in this fixture");
  },
});
export const DynamicContextProvider = ({ children }) => children;
