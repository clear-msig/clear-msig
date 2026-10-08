const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'../..'),out=process.env.CLEARSIG_REVIEW_OUTPUT||'/tmp/clearsig-inbox-review';
const keys=['11111111111111111111111111111111','So11111111111111111111111111111111111111112','TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','Vote111111111111111111111111111111111111111'];
const state={proposals:[],fail:false,holdMember:null},held=[],report=[];
const mocks={
 'next/link':`import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
 '@/lib/wallet':`import {useMemo,useSyncExternalStore} from 'react';const subscribe=f=>{window.addEventListener('identity-change',f);return()=>window.removeEventListener('identity-change',f)};export function useWallet(){const a=useSyncExternalStore(subscribe,()=>window.fixture.account);return {publicKey:a?{toBase58:()=>a}:null}}export function useConnection(){const e=useSyncExternalStore(subscribe,()=>window.fixture.endpoint);return useMemo(()=>({connection:{rpcEndpoint:e}}),[e])}`,
 '@/lib/memberships/client':`export const fetchOnchainMemberships=(address,opts)=>window.readFixture('membership',opts?.connection?.rpcEndpoint??'network-a',address);`,
 '@/lib/chain/wallets':`export async function fetchWalletByPda(c){const x=await window.readFixture('wallet',c.rpcEndpoint);return {...x,proposalIndex:BigInt(x.proposalIndex)}}`,
 '@/lib/chain/intents':`export const listIntents=c=>window.readFixture('intent',c.rpcEndpoint);`,
 '@/lib/chain/proposals':`export async function listProposalsForWallet(c,p,a){const rows=await window.readFixture('proposal',c.rpcEndpoint,undefined,a.proposalIndex.toString());return rows.map(r=>({...r,pda:{toBase58:()=>r.address},proposalIndex:BigInt(r.proposalIndex),account:{...r.account,proposedAt:BigInt(r.account.proposedAt)}}))}`,
};
(async()=>{fs.mkdirSync(out,{recursive:true});require('node:child_process').execFileSync(process.execPath,[require.resolve('tailwindcss/lib/cli.js',{paths:[root]}),'-i',root+'/src/app/globals.css','-o',out+'/style.css'],{cwd:root,stdio:'pipe'});
await esbuild.build({entryPoints:[__dirname+'/proposalInbox.fixture.jsx'],outfile:out+'/bundle.js',bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},tsconfig:root+'/tsconfig.json',nodePaths:[root+'/node_modules'],plugins:[{name:'synthetic-read-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'jsx',resolveDir:root}));}}]});
const server=http.createServer(async(req,res)=>{if(req.url==='/rpc'){let body='';for await(const chunk of req)body+=chunk;const x=JSON.parse(body);res.setHeader('Content-Type','application/json');if(state.fail){res.statusCode=503;return res.end('{}');}const member=keys.slice(0,3).includes(x.address);const exists=x.endpoint==='network-a';let result;
if(x.method==='membership')result=member&&exists?[{wallet:keys[0],wallet_name:'pro-fixture',roles:['approver'],intent_indexes:[3]}]:[];
if(x.method==='wallet')result={intentIndex:3,proposalIndex:state.proposals.length};
if(x.method==='intent')result=[{index:3,account:{approvers:keys.slice(0,3),approvalThreshold:2,approved:true,intentType:3,chainKind:0,template:'Send SOL'}}];
if(x.method==='proposal')result=state.proposals.slice(0,Number(x.count));
if(x.method==='membership'&&x.address===state.holdMember)await new Promise(resolve=>held.push(resolve));
return res.end(JSON.stringify(result));}
const file=req.url==='/bundle.js'?'bundle.js':req.url==='/style.css'?'style.css':null;res.setHeader('Content-Type',file?.endsWith('.js')?'application/javascript':file?'text/css':'text/html');res.end(file?fs.readFileSync(out+'/'+file):'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="bg-canvas"><div id="root"></div><script src="/bundle.js"></script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{const pages=await Promise.all(keys.map(async(account,i)=>{const p=await b.newPage({viewport:{width:i%2?390:1440,height:844},reducedMotion:'reduce'});p.fixtureErrors=[];p.on('pageerror',e=>p.fixtureErrors.push(e.message));await p.clock.install();await p.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());await p.goto(base+'/?account='+account);await p.waitForFunction(n=>window.fixture.reads.length>=n&&!window.inbox.loading,i===3?1:4);return p;}));
const [a,cB,cC,outsider]=pages;
// A creates externally after B/C have loaded empty inboxes; no websocket signal.
state.proposals.push({address:keys[1],proposalIndex:0,intentIndex:3,account:{status:0,statusLabel:'Active',approvalBitmap:1,proposer:keys[0],proposedAt:Math.floor(Date.now()/1000),actionKind:1}});
const before=await cB.evaluate(()=>window.fixture.reads.length);await cB.evaluate(()=>window.wake('focus'));await cC.evaluate(()=>window.wake('reconnect'));
if(process.env.INBOX_BASELINE==='1'){
 await cB.waitForTimeout(800);assert.equal(await cB.locator('[data-testid=count]').textContent(),'0');assert.equal(await cC.locator('[data-testid=count]').textContent(),'0');
 report.push({case:'recently loaded B focus / C reconnect',observed:'both remain empty',readsBefore:before,readsAfter:await cB.evaluate(()=>window.fixture.reads.length)});
 await cB.clock.fastForward(31_000);await cB.waitForFunction(()=>window.inbox.rows.length===1);report.push({case:'existing 30-second polling fallback',observed:'B discovers the proposal'});
 const membershipReads=await cB.evaluate(()=>window.fixture.reads.filter(r=>r.method==='membership').length);
 await cB.evaluate(()=>window.changeIdentity({endpoint:'network-b'}));
 await cB.waitForFunction(n=>window.fixture.reads.filter(r=>r.method==='membership').length>n,membershipReads);
 const used=await cB.evaluate(()=>window.fixture.reads.filter(r=>r.method==='membership').at(-1).endpoint);assert.equal(used,'network-a');
 report.push({case:'network change',active:'network-b',membershipReadUsed:used});
}else{
 await cB.waitForFunction(()=>window.inbox.rows.length===1,{},{timeout:5000});await cC.waitForFunction(()=>window.inbox.rows.length===1,{},{timeout:5000});
 assert.equal(await a.locator('[data-testid=count]').textContent(),'0');assert.equal(await outsider.locator('[data-testid=count]').textContent(),'0');
 await cB.getByRole('link').filter({hasText:'1 of 2 required approvals'}).waitFor();
 report.push({case:'A-created proposal discovered by B focus / C reconnect; A already voted; nonmember excluded',status:'passed'});
 const focusReads=await cB.evaluate(()=>window.fixture.reads.length)-before;
 assert(focusReads<=6,`one focus performed ${focusReads} reads`);
 await cB.getByRole('link').first().focus();assert.equal(await cB.getByRole('link').first().evaluate(e=>e===document.activeElement),true);
 for(const [p,width]of [[cB,390],[cC,1440]]){assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:`${out}/inbox-${width}.png`});}
 report.push({case:'bounded deduplicated focus reads; keyboard link; mobile/desktop no overflow',focusReads,status:'passed'});
 // Another session records a second approval; inboxes must converge from reads.
 state.proposals[0].account.approvalBitmap=3;state.proposals[0].account.status=1;state.proposals[0].account.statusLabel='Approved';
 await cB.evaluate(()=>window.wake('focus'));await cC.evaluate(()=>window.wake('reconnect'));
 for(const p of [cB,cC])await p.waitForFunction(()=>window.inbox.rows.length===0&&window.inbox.activity.allRows[0]?.status===1);
 report.push({case:'second approval removes the request from B/C action queues without inventing execution',status:'passed'});
 // No wake-up / websocket event: preserve the existing polling recovery path.
 state.proposals[0].account.status=2;state.proposals[0].account.statusLabel='Executed';
 await cB.clock.fastForward(31_000);await cB.waitForFunction(()=>window.inbox.activity.allRows[0]?.status===2);
 report.push({case:'missed events converge through existing 30-second poll',status:'passed'});
 // The same account on another endpoint has no memberships in this fixture.
 await cB.evaluate(()=>window.changeIdentity({endpoint:'network-b'}));
 await cB.waitForFunction(()=>!window.inbox.loading&&window.inbox.activity.allRows.length===0&&window.fixture.reads.some(r=>r.method==='membership'&&r.endpoint==='network-b'));
 assert.equal(await cB.evaluate(()=>window.fixture.reads.some(r=>r.endpoint==='network-b'&&r.method!=='membership')),false);
 report.push({case:'network switch uses the active endpoint and does not load old-network wallet data',status:'passed'});
 await cB.evaluate(account=>window.changeIdentity({account,endpoint:'network-a'}),keys[3]);
 await cB.waitForFunction(()=>!window.inbox.loading&&window.inbox.rows.length===0&&window.fixture.reads.some(r=>r.method==='membership'&&r.address===window.fixture.account));
 report.push({case:'account switch to nonmember clears action rows',status:'passed'});
 state.proposals.push({address:keys[2],proposalIndex:1,intentIndex:3,account:{status:0,statusLabel:'Active',approvalBitmap:1,proposer:keys[0],proposedAt:Math.floor(Date.now()/1000),actionKind:1}});
 await cB.evaluate(account=>window.changeIdentity({account}),keys[1]);await cB.evaluate(()=>window.wake('focus'));
 await cB.waitForFunction(()=>window.inbox.rows.length===1);
 state.fail=true;await cB.evaluate(()=>window.wake('focus'));await cB.waitForFunction(()=>!!window.inbox.activity.error);
 assert.equal(await cB.evaluate(()=>window.inbox.rows.length),1,'failed reads retain the last known request, not a fabricated empty feed');
 state.fail=false;await cB.evaluate(()=>window.wake('reconnect'));await cB.waitForFunction(()=>!window.inbox.activity.error&&!window.inbox.activity.refreshing);
 report.push({case:'read failure remains an error; reconnect recovers without submissions',status:'passed'});
 // Hold an old identity read, switch identity, then deliver its late response.
 state.holdMember=keys[1];await cB.evaluate(()=>window.wake('focus'));
 for(let n=0;n<50&&!held.length;n++)await cB.waitForTimeout(20);assert(held.length>0);
 await cB.evaluate(account=>window.changeIdentity({account}),keys[3]);await cB.waitForFunction(()=>window.inbox.rows.length===0);
 state.holdMember=null;held.splice(0).forEach(release=>release());await cB.waitForTimeout(150);
 assert.equal(await cB.evaluate(()=>window.inbox.rows.length),0);
 report.push({case:'late previous-member response cannot repopulate the nonmember inbox',status:'passed'});
 for(const p of pages){assert.deepEqual(p.fixtureErrors,[]);assert.equal(await p.evaluate(()=>window.queryClient.getQueryState(['canonical-proposal-review','unrelated','other-wallet','other-network']).isInvalidated),false);}
 report.push({case:'no page errors or broad canonical-review invalidations across A/B/C/nonmember',status:'passed'});

}
for(const p of pages)await p.close();
}finally{await b.close();await new Promise(r=>server.close(r));fs.writeFileSync(out+'/results.json',JSON.stringify(report,null,2));}console.log(report);
})().catch(e=>{console.error(e);process.exitCode=1});
