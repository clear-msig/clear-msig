const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '../..');
const out = process.env.CLEARSIG_REVIEW_OUTPUT || '/tmp/clearsig-membership-review';
const report = [];
const mocks = {
  'next/navigation': `import {useSyncExternalStore} from 'react';const subscribe=f=>{window.addEventListener('fixture-update',f);return()=>window.removeEventListener('fixture-update',f)};const router={replace:url=>window.fixture.navigations.push(url)};export const useRouter=()=>router;export const usePathname=()=>'/connect';export function useSearchParams(){const value=useSyncExternalStore(subscribe,()=>location.search);return new URLSearchParams(value)}`,
  '@/lib/wallet': `import {useSyncExternalStore,useMemo} from 'react';const subscribe=f=>{window.addEventListener('fixture-update',f);return()=>window.removeEventListener('fixture-update',f)};export function useWallet(){const address=useSyncExternalStore(subscribe,()=>window.fixture.account);return {connected:!!address,publicKey:address?{toBase58:()=>address}:null,connecting:false,disconnecting:false}}export function useConnection(){const endpoint=useSyncExternalStore(subscribe,()=>window.fixture.endpoint);return useMemo(()=>({connection:{rpcEndpoint:endpoint}}),[endpoint])}`,
  '@/lib/chain/memberships': `export const listMemberships=(connection,address)=>window.fixtureRead('rpc',address,connection.rpcEndpoint);`,
  '@/lib/chain/client': `export const getConnection=()=>{throw Error('Gate must pass its connection')};`,
  '@/lib/api/endpoints': `export const backendApi={memberships:address=>window.fixtureRead('backend',address)};`,
  '@dynamic-labs/sdk-react-core': `export const useDynamicContext=()=>({sdkHasLoaded:true,setShowAuthFlow:()=>{throw Error('No live sign-in')}});`,
  '@/features/wallet-runtime/infrastructure/ConnectDynamicProviderTree': `export default function Provider({children}){return children}`,
  '@/features/onboarding/ui/LedgerConnectRow': `export const LedgerConnectRow=()=>null;`,
  '@/components/landing/LandingChrome': `export const LandingAtmospherics=()=>null;`,
};
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 require('node:child_process').execFileSync(process.execPath,[require.resolve('tailwindcss/lib/cli.js',{paths:[root]}),'-i',root+'/src/app/globals.css','-o',out+'/style.css'],{cwd:root,stdio:'pipe'});
 await esbuild.build({entryPoints:[__dirname+'/membershipDiscovery.fixture.jsx'],outfile:out+'/bundle.js',bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},tsconfig:root+'/tsconfig.json',nodePaths:[root+'/node_modules'],plugins:[{name:'isolated-discovery',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'jsx',resolveDir:root}));}}]});
 const server=http.createServer((req,res)=>{const asset=req.url==='/bundle.js'?'bundle.js':req.url==='/style.css'?'style.css':null;res.setHeader('Content-Type',asset?.endsWith('.js')?'application/javascript':asset?'text/css':'text/html');res.end(asset?fs.readFileSync(out+'/'+asset):'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try {
  for(const width of [320,390,1440]){
   const p=await browser.newPage({viewport:{width,height:740},reducedMotion:'reduce'});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
   await p.goto(base+'/connect?surface=pro');
   const retry=p.getByRole('button',{name:'Retry loading wallets'});await retry.waitFor();
   assert.deepEqual(await p.evaluate(()=>window.fixture.navigations),[]);
   assert.match(await p.getByRole('status').textContent(),/couldn’t load/);
   await p.screenshot({path:`${out}/error-${width}.png`});
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await retry.focus();await p.keyboard.press('Enter');
   await p.waitForFunction(()=>window.fixture.calls.length>=4);await retry.waitFor();
   assert.equal(await retry.evaluate(e=>e===document.activeElement),true);
   assert.deepEqual(await p.evaluate(()=>window.fixture.navigations),[]);
   await p.evaluate(()=>window.updateFixture({mode:'pending'}));await p.keyboard.press('Enter');
   await p.getByRole('button',{name:'Checking wallets…'}).waitFor();
   assert.equal(await p.getByRole('button',{name:'Checking wallets…'}).evaluate(e=>e===document.activeElement),true);
   assert.equal(await p.getByRole('button',{name:'Checking wallets…'}).getAttribute('aria-disabled'),'true');
   const calls=await p.evaluate(()=>window.fixture.calls.length);await p.keyboard.press('Enter');assert.equal(await p.evaluate(()=>window.fixture.calls.length),calls);
   await p.evaluate(()=>window.fixture.pending.at(-1).resolve([{wallet:'So11111111111111111111111111111111111111112',wallet_name:'pro-team',roles:['approver'],intent_indexes:[0]}]));
   await p.waitForFunction(()=>window.fixture.navigations.length>0);assert.match(await p.evaluate(()=>window.fixture.navigations.at(-1)),/pro-team/);
   assert.deepEqual(errors,[]);report.push({width,case:'error, keyboard retry, duplicate suppression, preserved product destination',status:'passed'});await p.close();
  }
  async function page(initial={},query=''){const p=await browser.newPage();await p.addInitScript(value=>{window.initialFixture=value},initial);await p.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());await p.goto(base+'/connect'+query);return p;}
  for(const mode of ['empty','malformed','multiple','unnamed']){
   const p=await page({mode},'?surface=pro');
   if(mode==='malformed'){await p.getByRole('button',{name:'Retry loading wallets'}).waitFor();assert.deepEqual(await p.evaluate(()=>window.fixture.navigations),[]);}
   else if(mode==='multiple'){await p.getByRole('heading',{name:'Choose one to continue.'}).waitFor();assert.deepEqual(await p.evaluate(()=>window.fixture.navigations),[]);await p.getByRole('button').first().click();await p.waitForFunction(()=>window.fixture.navigations.length>0);}
   else if(mode==='unnamed'){await p.waitForFunction(()=>window.fixture.navigations.length>0);assert.equal(await p.evaluate(()=>window.fixture.navigations.at(-1)),'/app');}
   else {await p.waitForFunction(()=>window.fixture.navigations.length>0);assert.match(await p.evaluate(()=>window.fixture.navigations.at(-1)),/welcome|new/);}
   report.push({case:mode,status:'passed'});await p.close();
  }
  for(const next of ['/app/wallet/pro-team/send?asset=SOL','/app/proposals/example']){
   const p=await page({},'?next='+encodeURIComponent(next));await p.waitForFunction(()=>window.fixture.navigations.length>0);assert.equal(await p.evaluate(()=>window.fixture.navigations.at(-1)),next);assert.equal(await p.evaluate(()=>window.fixture.calls.length),0);report.push({case:'explicit deep link '+next,status:'passed'});await p.close();
  }
  // Late reads for the old account and endpoint cannot route the new identity.
  for(const field of ['account','endpoint']){
   const p=await page({mode:'pending'},'?surface=pro');await p.waitForFunction(()=>window.fixture.pending.length===1);
   await p.evaluate(field=>window.updateFixture({[field]:field==='account'?'So11111111111111111111111111111111111111112':'https://rpc-b.fixture.invalid'}),field);
   await p.waitForFunction(()=>window.fixture.pending.length===2);
   await p.evaluate(()=>window.fixture.pending[0].resolve([]));await p.waitForTimeout(100);assert.deepEqual(await p.evaluate(()=>window.fixture.navigations),[]);
   await p.evaluate(()=>window.fixture.pending[1].resolve([{wallet:'So11111111111111111111111111111111111111112',wallet_name:'pro-current',roles:['approver'],intent_indexes:[0]}]));await p.waitForFunction(()=>window.fixture.navigations.length>0);assert.match(await p.evaluate(()=>window.fixture.navigations.at(-1)),/pro-current/);report.push({case:field+' switch discards late old response',status:'passed'});await p.close();
  }
  const changed=await page({},'?surface=pro');await changed.getByRole('button',{name:'Retry loading wallets'}).waitFor();
  await changed.evaluate(()=>{history.replaceState(null,'','/connect?next=%2Fapp%2Fwallet%2Fpro-selected%2Fsend');window.dispatchEvent(new Event('fixture-update'));});
  await changed.waitForFunction(()=>window.fixture.navigations.length>0);assert.equal(await changed.evaluate(()=>window.fixture.navigations.at(-1)),'/app/wallet/pro-selected/send');await changed.close();report.push({case:'same-page destination change after failure',status:'passed'});
  const generic=await page({mode:'success'},'?next='+encodeURIComponent('/app?surface=pro'));await generic.waitForFunction(()=>window.fixture.navigations.length>0);assert.match(await generic.evaluate(()=>window.fixture.navigations.at(-1)),/pro-team/);assert.equal(await generic.evaluate(()=>window.fixture.calls.length),1);await generic.close();report.push({case:'generic product destination resolves membership',status:'passed'});
  const remembered=await browser.newPage();await remembered.addInitScript(()=>{sessionStorage.setItem('clear-msig:selected-product-wallet:v1:11111111111111111111111111111111:pro','/app/wallet/pro-saved');});await remembered.goto(base+'/connect?surface=pro');await remembered.waitForFunction(()=>window.fixture.navigations.length>0);assert.equal(await remembered.evaluate(()=>window.fixture.navigations.at(-1)),'/app/wallet/pro-saved');assert.equal(await remembered.evaluate(()=>window.fixture.calls.length),0);await remembered.close();report.push({case:'remembered validated same-origin selection',status:'passed'});
 }finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(out+'/results.json',JSON.stringify(report,null,2));}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
