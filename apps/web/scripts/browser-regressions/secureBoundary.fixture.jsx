import {useContext,createContext} from 'react';
export const WalletContext=createContext({});
export function useWallet(){return useContext(WalletContext)}
export function useConnection(){return {connection:window.fixtureConnection}}
export function usePathname(){return window.location.pathname}
