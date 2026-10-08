const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const base = process.env.STORY_URL || 'http://127.0.0.1:3107';
const results = [];
const settle = async p => { await p.waitForTimeout(800); };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    for (const [width, height, motion, js] of [[1180,757,'no-preference',true],[1000,720,'no-preference',true],[390,844,'no-preference',true],[320,740,'no-preference',true],[1180,757,'reduce',true],[320,740,'no-preference',false]]) {
      const p = await browser.newPage({ viewport: { width, height }, reducedMotion: motion, javaScriptEnabled: js });
      const errors = [];
      p.on('pageerror', e => errors.push(e.message));
      await p.route('**/*', r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
      await p.goto(base, { waitUntil: 'networkidle' });
      const welcome = p.getByRole('complementary', { name: 'Sigi welcome', exact: true });
      if (js) await p.locator('[aria-label="Sigi welcome"][data-ready=true]').waitFor();
      const owl = welcome.getByRole('img', { name: 'Sigi, the ClearSig owl' });
      const png = await (await p.request.get(base + '/brand/sigi.png')).body();
      assert.equal(png.length, 53138);
      assert.equal(createHash('sha256').update(png).digest('hex'), 'e419154b60e0ec64aaa7d7c3c895c5a83d6ca7310b28070579ba819a8da383cf');
      assert.deepEqual(await owl.evaluate(e => [e.naturalWidth, e.naturalHeight]), [217,266]);
      const box = await owl.boundingBox();
      assert(box.width >= 100 && box.width <= 180, 'approved display size');
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no overflow');
      if (width < 1000 || motion === 'reduce') assert.equal(await owl.evaluate(e => getComputedStyle(e).transform), 'none', 'static mascot');
      await welcome.locator('summary').click();
      if (js) {
        await welcome.getByRole('link', { name: 'Show me around' }).focus();
        await p.keyboard.press('Enter');
        await settle(p);
        assert.equal(new URL(p.url()).hash, '#story-request');
        assert.equal(await p.locator('#story-request').evaluate(e => e === document.activeElement), true, 'guide focus moves to chapter');
        for (const [i,id] of ['request','rules','people','rules','request'].entries()) {
          await p.locator('#story-' + id).evaluate(e => e.scrollIntoView({ behavior: 'instant', block: 'start' }));
          await settle(p);
          assert.equal(await p.locator('#story-' + id).getByRole('complementary').isVisible(), true, 'contextual guide text');
          assert.equal(await p.locator('nav[aria-label="Approval story navigation"]').isVisible(), true);
          if (id === 'people') {
            const action = p.locator('#story-people > button');
            await action.focus(); await settle(p);
            assert.equal(await action.evaluate(e => { const b=e.getBoundingClientRect(); return e.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)); }), true, 'guided approval control unobscured');
          }
        }
        await p.locator('#story-request').getByRole('button', { name: 'End guide' }).click();
        assert.equal(await p.getByRole('complementary', { name: /Sigi guide/ }).count(), 0);
        assert.equal(await p.locator('#story-request').evaluate(e => e === document.activeElement), true, 'end-guide focus retained');
        await p.reload({ waitUntil: 'networkidle' });
        await p.locator('[aria-label="Sigi welcome"][data-ready=true]').waitFor();
        assert.equal(await p.getByRole('link', { name: 'Show me around' }).count(), 0, 'quiet preference survives reload');
        await p.locator('#resources').evaluate(e => e.scrollIntoView({ behavior: 'instant' })); await settle(p);
        const returning = p.getByRole('complementary', { name: 'A note from Sigi' });
        assert.equal(await returning.isVisible(), true);
        await returning.getByRole('button', { name: 'Dismiss Sigi' }).click();
        assert.equal(await p.getByRole('img', { name: 'Sigi, the ClearSig owl' }).count(), 0);
        assert.equal(await p.locator('#resources-title').evaluate(e => e === document.activeElement), true);
        await p.reload({ waitUntil: 'networkidle' }); await settle(p);
        assert.equal(await p.getByRole('img', { name: 'Sigi, the ClearSig owl' }).count(), 0, 'dismissal survives reload');
        await p.evaluate(() => sessionStorage.clear());
        await p.goto(base, { waitUntil: 'networkidle' });
        await p.locator('[aria-label="Sigi welcome"][data-ready=true]').waitFor();
        await welcome.locator('summary').click();
        await welcome.getByRole('button', { name: 'Explore myself' }).click();
        assert.equal(await p.getByRole('link', { name: 'Show me around' }).count(), 0);
        assert.equal(await p.locator('#explore-clearsig').evaluate(e => e === document.activeElement), true);
        await welcome.getByRole('button', { name: 'Dismiss Sigi' }).click();
        assert.equal(await p.getByRole('img', { name: 'Sigi, the ClearSig owl' }).count(), 0);
        assert.equal(await p.locator('#explore-clearsig').evaluate(e => e === document.activeElement), true, 'welcome dismissal restores focus');
      } else {
        await welcome.getByRole('link', { name: 'Show me around' }).click(); await settle(p);
        assert.equal(new URL(p.url()).hash, '#story-request');
        assert.equal(await p.locator('#story-request h3').isVisible(), true);
      }
      assert.deepEqual(errors, []);
      results.push({width,height,motion,js,status:'passed'});
      console.log(results.at(-1));
      await p.close();
    }
  } finally {
    await browser.close();
    fs.writeFileSync(process.env.SIGI_REPORT || '/tmp/clearsig-sigi-browser-results.json', JSON.stringify(results,null,2));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
