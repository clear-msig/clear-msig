// Run against the isolated Next review app. Never use this fixture as live auth evidence.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.CLEARSIG_REVIEW_URL||'http://127.0.0.1:3104';
const out=process.env.CLEARSIG_REVIEW_OUTPUT||'/workspace/scratch/quantus-design';
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const results=[];try {
for(const width of [320,360,390,430,768,1440]){
 const context=await browser.newContext({viewport:{width,height:width===1440?1000:844}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('heading',{name:'Every approval. Crystal clear.'}).waitFor();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert(await page.getByRole('link',{name:'Explore ClearSig',exact:true}).evaluate(e=>e.getBoundingClientRect().bottom<innerHeight));
 if(width===1440||width===390)await page.screenshot({path:path.join(out,`landing-${width}.png`)});
 await page.getByRole('link',{name:'See an approval',exact:true}).click();await page.waitForTimeout(650);
 assert(await page.locator('#approval').evaluate(e=>e.getBoundingClientRect().top>=72));
 for(let i=0;i<2;i++){await page.getByRole('button',{name:'Try the approval demo',exact:true}).click();await page.getByText('3 members · threshold met in demo',{exact:true}).waitFor();await page.getByRole('button',{name:'Reset demonstration'}).click();}
 await page.getByRole('button',{name:'Pause network animation'}).click();await page.getByRole('button',{name:'Resume network animation'}).waitFor();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Pause network animation'}).waitFor();
 for(let y=0;y<await page.evaluate(()=>document.body.scrollHeight);y+=550){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(80)}await page.waitForTimeout(650);
 assert.equal(await page.locator('.landing-reveal[data-reveal="pending"]').count(),0);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(width===1440||width===390)await page.screenshot({path:path.join(out,`landing-full-${width}.png`),fullPage:true});
 await page.goto(base+'/choose',{waitUntil:'networkidle'});await page.getByRole('heading',{name:'What are you setting up?'}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.locator('main ul li').count(),4);
 if(width===1440||width===390)await page.screenshot({path:path.join(out,`choose-${width}.png`),fullPage:true});
 await page.getByRole('link',{name:'ClearSig home',exact:true}).click();await page.waitForURL(base+'/');await page.goBack();await page.waitForURL(base+'/choose');
 await page.goto(base+'/design-review',{waitUntil:'networkidle'});await page.locator('[data-fixture-ready="true"]').waitFor();await page.getByRole('heading',{name:'Operations',exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(width===1440||width===390)await page.screenshot({path:path.join(out,`wallet-${width}.png`),fullPage:true});
 await page.getByRole('link',{name:'Proposal',exact:true}).click();await page.getByRole('heading',{name:'Send 5 SOL',exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(width===1440||width===390)await page.screenshot({path:path.join(out,`proposal-${width}.png`),fullPage:true});
 await page.getByRole('button',{name:'Review approval →',exact:true}).click();
 await page.getByRole('button',{name:'Approve request · demo',exact:true}).click();
 assert(await page.getByRole('button',{name:'Awaiting simulated response…',exact:true}).isDisabled());
 await page.getByRole('alert').filter({hasText:'Simulated wallet rejection'}).waitFor();
 await page.getByRole('button',{name:'Retry demo approval',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Simulated wallet rejection'}).waitFor();
 await page.getByRole('button',{name:'Cancel review',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Review cancelled'}).waitFor();
 await page.goBack();await page.getByRole('button',{name:'Review approval →',exact:true}).waitFor();
 await page.goForward();await page.getByRole('button',{name:'Approve request · demo',exact:true}).waitFor();
 assert.equal(errors.length,0,errors.join('\n'));results.push({width,landing:'CTA before fold, demo/reset, pause/resume, all reveals visible, no overflow',navigation:'chooser/home/back passed',app:'real wallet/receipt components; synthetic approval pending, rejection, retry, cancel, back/forward; no live auth'});await context.close();console.log('PASS',width);
}
for(const options of [{javaScriptEnabled:false},{reducedMotion:'reduce'}]){const context=await browser.newContext({viewport:{width:390,height:844},...options});const page=await context.newPage();await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());await page.goto(base,{waitUntil:'networkidle'});assert.equal(await page.locator('h1').count(),1);assert(await page.locator('.landing-reveal').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).opacity==='1')));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));results.push({...options,content:'all landing chapters visible'});await context.close();}
fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(results,null,2));console.log('ALL PASS');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
