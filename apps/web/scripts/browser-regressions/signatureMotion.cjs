const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.STORY_URL || 'http://127.0.0.1:3110';
const results = [];
const snapshot = p => p.locator('figure').first().evaluate(el => ({
  running: el.dataset.motion,
  turn: getComputedStyle(el.querySelector('[class*=signatureTurn]')).transform,
  scroll: getComputedStyle(el.querySelector('[class*=signatureCore]')).transform,
  particles: [...el.querySelectorAll('[class*=orbitParticle]')].map(x => getComputedStyle(x).offsetDistance),
  mascot: document.querySelector('[alt*=Sigi]')?.getBoundingClientRect().toJSON(),
}));
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    for (const [width, height, reduced, js] of [[1180,757,false,true],[390,844,false,true],[320,740,false,true],[1180,757,true,true],[390,844,true,true],[1180,757,false,false],[320,740,false,false]]) {
      const p = await browser.newPage({ viewport: { width,height }, reducedMotion: reduced ? 'reduce' : 'no-preference', javaScriptEnabled: js });
      const errors = [];
      p.on('pageerror', e => errors.push(e.message));
      await p.route('**/*', r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
      await p.goto(base, {waitUntil:'networkidle',timeout:120000});
      if (js && !reduced) await p.waitForSelector('figure[data-motion=running]');
      const before = await snapshot(p);
      await p.waitForTimeout(1600);
      const after = await snapshot(p);
      if (js && !reduced) {
        assert.notEqual(before.turn, after.turn, 'C rotates while stationary');
        assert.notDeepEqual(before.particles, after.particles, 'diamonds orbit while stationary');
        assert.deepEqual(before.mascot, after.mascot, 'Sigi remains independent of artwork motion');
        const toggle = p.getByRole('button',{name:'Pause motion',exact:true});
        const bounds = await toggle.boundingBox();
        assert(bounds.x >= 0 && bounds.x + bounds.width <= width, 'pause control stays inside viewport');
        assert(bounds.height >= 44, 'pause control has a touch target');
        await toggle.focus();
        await p.keyboard.press('Space');
        assert.equal(await toggle.getAttribute('aria-pressed'),'true');
        await p.waitForTimeout(100);
        const paused = await snapshot(p);
        await p.waitForTimeout(600);
        assert.deepEqual(await snapshot(p), paused, 'keyboard pause freezes both artwork layers');
        await p.keyboard.press('Space');
        await p.waitForTimeout(200);
        assert.notEqual((await snapshot(p)).turn, paused.turn, 'keyboard resumes motion');
        await p.evaluate(() => scrollTo({top:200,behavior:'instant'}));
        await p.waitForTimeout(250);
        assert.notEqual((await snapshot(p)).scroll, before.scroll, 'scroll transform composes with idle transform');
        await p.locator('#products').evaluate(e => e.scrollIntoView({behavior:'instant'}));
        await p.waitForTimeout(250);
        const offscreen = await snapshot(p);
        assert.equal(offscreen.running,'paused');
        await p.waitForTimeout(600);
        assert.equal((await snapshot(p)).turn,offscreen.turn,'offscreen stops C');
        assert.deepEqual((await snapshot(p)).particles,offscreen.particles,'offscreen stops particles');
        await p.evaluate(() => scrollTo({top:0,behavior:'instant'}));
        await p.waitForTimeout(250);
        assert.equal((await snapshot(p)).running,'running');
        assert.equal((await snapshot(p)).scroll,before.scroll,'reverse restores scroll transform');
        // Exercise the same visibilitychange branch used when a browser tab is hidden.
        await p.evaluate(() => {Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
        await p.waitForTimeout(100);
        const hidden = await snapshot(p);
        await p.waitForTimeout(400);
        assert.equal(hidden.running,'paused');
        assert.equal((await snapshot(p)).turn,hidden.turn);
        assert.deepEqual((await snapshot(p)).particles,hidden.particles);
        await p.evaluate(() => {delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
        assert.equal((await snapshot(p)).running,'running');
        await p.emulateMedia({reducedMotion:'reduce'});
        await p.waitForTimeout(100);
        const staticFrame = await snapshot(p);
        await p.waitForTimeout(300);
        assert.equal((await snapshot(p)).turn,staticFrame.turn);
        assert.deepEqual((await snapshot(p)).particles,staticFrame.particles);
      } else {
        assert.equal(before.turn,after.turn,'static C for reduced motion/no JS');
        assert.deepEqual(before.particles,after.particles,'static particles for reduced motion/no JS');
        assert.equal(await p.getByRole('button',{name:'Pause motion',exact:true}).count(),0);
      }
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
      assert.deepEqual(errors,[]);
      results.push({width,height,reduced,js,status:'passed'});
      console.log(results.at(-1));
      await p.close();
    }
  } finally {
    await browser.close();
    fs.writeFileSync(process.env.MOTION_REPORT || '/tmp/clearsig-motion-results.json',JSON.stringify(results,null,2));
  }
})().catch(e => {console.error(e);process.exitCode=1;});
