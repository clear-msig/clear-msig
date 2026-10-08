// Synthetic read boundaries only; real feed hooks, QueryClient and inbox UI.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider,focusManager,onlineManager} from '@tanstack/react-query';
import {ActionNeededProvider,useActionNeeded} from '@/lib/hooks/useActionNeeded';
import {WalletApprovalPanel} from '@/components/wallet/detail/WalletApprovalPanel';
window.fixture={account:new URLSearchParams(location.search).get('account'),endpoint:'network-a',reads:[]};
window.changeIdentity=values=>{Object.assign(window.fixture,values);window.dispatchEvent(new Event('identity-change'));};
window.readFixture=async(method,endpoint,address,count)=>{
 const request={method,endpoint,address,count};window.fixture.reads.push(request);
 const r=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
 if(!r.ok)throw Error('Synthetic RPC unavailable');return r.json();
};
window.wake=kind=>{if(kind==='focus'){focusManager.setFocused(false);focusManager.setFocused(true);}else{onlineManager.setOnline(false);onlineManager.setOnline(true);}};
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});window.queryClient=client;
client.setQueryData(['canonical-proposal-review','unrelated','other-wallet','other-network'],{reviewId:'untouched'});
function Inbox(){const value=useActionNeeded();window.inbox=value;return <main className="mx-auto max-w-3xl p-4 text-text-strong"><p className="mb-5 text-sm">Isolated session · synthetic chain reads · no signing or transactions</p><p role="status">{value.loading?'Loading':value.activity.error?'Read unavailable':'Ready'}</p><WalletApprovalPanel rows={value.rows} reduce/><output data-testid="count">{value.rows.length}</output></main>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><ActionNeededProvider><Inbox/></ActionNeededProvider></QueryClientProvider>);
