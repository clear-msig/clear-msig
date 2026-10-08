const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.STORY_URL||'http://127.0.0.1:3130';
const report=[];
const state=e=>({state:e.dataset.reveal,opacity:Number(getComputedStyle(e).opacity),top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height});
const revealOf=locator=>locator.locator('xpath=ancestor-or-self::*[contains(concat(" ",normalize-space(@class)," ")," landing-reveal ")][1]');
(async()=>{const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{
for(const [width,height,reduced,js]of [[1180,757,false,true],[390,844,false,true],[320,740,false,true],[1180,757,true,true],[390,844,true,true],[1180,757,false,false],[320,740,false,false]]){
 const p=await b.newPage({viewport:{width,height},reducedMotion:reduced?'reduce':'no-preference',javaScriptEnabled:js});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 await p.goto(base,{waitUntil:'networkidle',timeout:120000});await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(250);
 assert.equal(await p.locator('#hero-title').evaluate(e=>!!e.closest('.landing-reveal')),false,'hero never concealed');
 const targets=[p.locator('#how-it-works'),p.locator('#story-request'),p.locator('#story-rules'),p.locator('#story-people'),revealOf(p.getByRole('region',{name:'ClearSig network ecosystem'})),revealOf(p.getByText('FIND YOUR STARTING POINT',{exact:true})),...await p.locator('#products .landing-reveal').all(),revealOf(p.locator('#resources-title')),revealOf(p.getByRole('complementary',{name:'A note from Sigi'})),...await p.locator('#resources article').all(),revealOf(p.getByRole('heading',{name:'Questions worth asking.'})),revealOf(p.getByRole('heading',{name:'Read the source. Know the limits.'})),revealOf(p.getByRole('heading',{name:'Clarity is part of control.'})),p.locator('footer')];
 const initialHeight=await p.evaluate(()=>document.documentElement.scrollHeight);
 if(js&&!reduced){
  for(const t of targets){const x=await t.evaluate(state);assert.equal(x.state,'pending','later target waits below viewport');assert.equal(x.opacity,0);}
  if(width>=1000)assert.equal(await p.locator('[data-story-stage]').getAttribute('data-reveal'),'pending','desktop scene arms after enhancement');
  await p.waitForTimeout(1100);assert.equal(await revealOf(p.locator('#resources-title')).getAttribute('data-reveal'),'pending','no load timer reveals resources');
  // Cross the observation boundary, verifying the layout stays reserved.
  for(const t of targets){
   const before=await t.evaluate(e=>({height:e.offsetHeight,top:e.offsetTop}));
   await t.evaluate(e=>scrollTo({top:e.getBoundingClientRect().top+scrollY-innerHeight*.5,behavior:'instant'}));
   await p.waitForTimeout(1500);
   const x=await t.evaluate(state);assert.notEqual(x.state,'pending','entry reveals target');assert.equal(x.opacity,1);
   assert.deepEqual(await t.evaluate(e=>({height:e.offsetHeight,top:e.offsetTop})),before,'reveal does not change layout');
  }
  assert.equal(await p.evaluate(()=>document.documentElement.scrollHeight),initialHeight,'scroll document height stays fixed');
  await p.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await p.waitForTimeout(100);
  await p.waitForTimeout(400);
  for(const t of targets)assert.equal(await t.getAttribute('data-reveal'),'pending','retreat resets below-viewport sections');
  const replay=targets[0];await replay.evaluate(e=>scrollTo({top:e.getBoundingClientRect().top+scrollY-innerHeight*.5,behavior:'instant'}));await p.waitForTimeout(1500);assert.equal(await replay.evaluate(e=>Number(getComputedStyle(e).opacity)),1,'down-scroll replays');
  await p.evaluate(()=>scrollBy({top:-15,behavior:'instant'}));await p.waitForTimeout(100);assert.notEqual(await replay.getAttribute('data-reveal'),'pending','tiny upward movement does not blank current content');
  await p.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await p.waitForTimeout(400);
  const pause=p.getByRole('button',{name:'Pause motion',exact:true});await pause.click();assert.equal(await pause.getAttribute('aria-pressed'),'true');assert.equal(await p.locator('.landing-reveal').evaluateAll(es=>es.filter(e=>getComputedStyle(e).opacity!=='1').length),0,'pause exposes every section');await pause.click();await p.waitForTimeout(400);

  // Fresh page: keyboard access to an unseen link forces a visible destination.
  await p.goto(base,{waitUntil:'networkidle'});const source=p.getByRole('link',{name:'Product overview',exact:true});await source.focus();await p.waitForTimeout(100);assert.equal(await revealOf(source).evaluate(e=>Number(getComputedStyle(e).opacity)),1);assert.equal(await source.evaluate(e=>e===document.activeElement),true);
  // Fresh fast jump must reveal the arrival, leaving unread middle blocks armed.
  await p.goto(base,{waitUntil:'networkidle'});await p.locator('footer').evaluate(e=>e.scrollIntoView({behavior:'instant'}));await p.waitForTimeout(1500);assert.equal(await p.locator('footer').evaluate(e=>Number(getComputedStyle(e).opacity)),1);
  await p.locator('#story-rules').evaluate(e=>e.scrollIntoView({behavior:'instant'}));await p.waitForTimeout(1500);assert.equal(await p.locator('#story-rules').evaluate(e=>Number(getComputedStyle(e).opacity)),1);
  // Native refresh restoration without a hash.
  await p.locator('#resources-title').evaluate(e=>e.scrollIntoView({behavior:'instant',block:'center'}));await p.waitForTimeout(1500);const y=await p.evaluate(()=>scrollY);await p.reload({waitUntil:'networkidle'});await p.waitForTimeout(1500);assert(Math.abs(await p.evaluate(()=>scrollY)-y)<30,'refresh restores native scroll position');assert.equal(await revealOf(p.locator('#resources-title')).evaluate(e=>Number(getComputedStyle(e).opacity)),1);
  // Direct entry and refresh must not strand focused/anchored chapters.
  for(const hash of ['#story-rules','#resources','#products']){await p.goto(base+'/'+hash,{waitUntil:'networkidle'});await p.waitForTimeout(1500);const heading=p.locator(hash==='#story-rules'?'#story-rules':hash==='#resources'?'#resources-title':'#products-title');assert.equal(await revealOf(heading).evaluate(e=>Number(getComputedStyle(e).opacity)),1);await p.reload({waitUntil:'networkidle'});await p.waitForTimeout(1500);assert.equal(await revealOf(heading).evaluate(e=>Number(getComputedStyle(e).opacity)),1);}
  // Pointer focus must not snap a moving control away between down and up.
  await p.goto(base,{waitUntil:'networkidle'});
  const policy=p.locator('#story-rules button');
  await policy.evaluate(e=>scrollTo({top:e.getBoundingClientRect().top+scrollY-innerHeight*.45,behavior:'instant'}));
  await p.waitForTimeout(60);const hit=await policy.boundingBox();
  await p.mouse.move(hit.x+hit.width/2,hit.y+hit.height/2);await p.mouse.down();await p.waitForTimeout(20);await p.mouse.up();
  await p.waitForTimeout(100);assert.match(await p.locator('[role=status]').first().textContent(),/Policy failed/,'click during entry remains actionable');
  await p.goto(base,{waitUntil:'networkidle'});await p.emulateMedia({reducedMotion:'reduce'});await p.waitForTimeout(100);assert.equal(await p.locator('.landing-reveal[data-reveal=pending]').count(),0,'preference change releases pending content');
 }else{
  const hidden=await p.locator('.landing-reveal').evaluateAll(es=>es.filter(e=>getComputedStyle(e).opacity!=='1').length);assert.equal(hidden,0,'reduced motion/no JS stays readable');
 }
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);report.push({width,height,reduced,js,status:'passed'});console.log(report.at(-1));await p.close();
}
}finally{await b.close();fs.writeFileSync(process.env.REVEAL_REPORT||'/tmp/clearsig-reveal-results.json',JSON.stringify(report,null,2));}})().catch(e=>{console.error(e);process.exitCode=1});
