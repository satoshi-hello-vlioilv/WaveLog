/* test_scdragscroll.js: 掴んだまま表が送られる／色の意味が読める（§9.374）
   ============================================================
   利用者の報告・指摘:
    ②「ロットを下方向へドラッグして入れ替えようとしましたが、移動できませんでした」
    ④「背景色の濃い薄いの分類について少しわかりやすくしてください。初見の人が
       どういうゾーンなのか扱いがわかりにくいようです。表示の説明みたいな
       項目があるとよいかもしれないです」

   ②の本体は**自動スクロールが無かった**こと。掴んでいる間は`dragover`しか
   起きずホイールも効かないので、**動かせるのは「いま見えている行」だけ**
   だった——1画面に収まらない移動（別の直へ運ぶ等）は物理的にできない。

   ここで固定すること:
    1. 器の**下の縁**へ持っていくと表が送られる（掴んでいる間だけ）
    2. 器の**上の縁**でも送られる（戻れないと、行き過ぎたら詰む）
    3. 離したら**止まる**（掴んでいないのに動き続けない）
    4. 「表示」に**色と濃さの意味**があり、実物と同じクラスで見本が出る
   ============================================================ */
const {run}=require('./lib/harness.js');
const EQ='テスト設備A';

run('test_scdragscroll: 掴んだまま送る／色の意味（§9.374）',
 async({page,rec,B,idle,W})=>{
  const post=(p,body)=>page.evaluate(async a=>{
   const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({user_id:'test-scdrag'},a.b))});
   let j={};try{j=await r.json()}catch(e){j={parseError:String(e)}}
   return {status:r.status,body:j};
  },{p,b:body||{}});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.booted(page);
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
  await post('/api/access-mode',{mode:'schedule'});
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await idle(400,20000);

  /* ---- 1・2・3. 掴んだまま送られる ----
     **実際に掴む**（`dragstart`→`dragover`）。送りは30msごとなので、
     「送られた」ことは**位置が増えるのを条件で待って**見る（§9.347）。 */
  const host=await page.evaluate(()=>{
   const tl=document.getElementById('scTimeline');
   const sc=document.scrollingElement||document.documentElement;
   const h=(tl&&tl.scrollHeight>tl.clientHeight+4)?tl:sc;
   return {which:h===tl?'timeline':'page',
           canScroll:h.scrollHeight>h.clientHeight+4,
           top:h.scrollTop,h:h.clientHeight};
  });
  rec('前提: 表が1画面に収まっていない（送る余地がある）',host.canScroll,JSON.stringify(host));

  const dragTo=async y=>page.evaluate(cy=>{
   const row=document.querySelector('#scTimeline .sc-row-line');
   const dt=new DataTransfer();
   row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
   document.elementFromPoint(20,cy);
   const t=document.getElementById('scTimeline')||document.body;
   t.dispatchEvent(new DragEvent('dragover',{bubbles:true,clientY:cy,dataTransfer:dt}));
  },y);
  const scrollNow=()=>page.evaluate(()=>{
   const tl=document.getElementById('scTimeline');
   const sc=document.scrollingElement||document.documentElement;
   const h=(tl&&tl.scrollHeight>tl.clientHeight+4)?tl:sc;
   return h.scrollTop;
  });
  const before=await scrollNow();
  await dragTo(await page.evaluate(()=>window.innerHeight-10));
  const wentDown=await page.waitForFunction(t=>{
   const tl=document.getElementById('scTimeline');
   const sc=document.scrollingElement||document.documentElement;
   const h=(tl&&tl.scrollHeight>tl.clientHeight+4)?tl:sc;
   return h.scrollTop>t+4;
  },before,{timeout:6000}).then(()=>true,()=>false);
  rec('下の縁へ持っていくと表が送られる',wentDown,`${before} → ${await scrollNow()}`);

  /* 離したら止まる（掴んでいないのに動き続けない） */
  await page.evaluate(()=>{
   const row=document.querySelector('#scTimeline .sc-row-line');
   row.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:new DataTransfer()}));
  });
  /* **「止まった」を条件で見る**（§9.347）。送りは30msごとなので、
     位置が2回続けて同じなら止まっている。`waitForFunction`の巡回に
     数えさせる——`waitForTimeout`で1秒待つのは固定待ちで、しかも
     「たまたま止まっていただけ」と区別が付かない。 */
  const stopped=await page.waitForFunction(()=>{
   const tl=document.getElementById('scTimeline');
   const sc=document.scrollingElement||document.documentElement;
   const h=(tl&&tl.scrollHeight>tl.clientHeight+4)?tl:sc;
   const now=h.scrollTop;
   const same=(window.__wlLastTop===now);
   window.__wlLastTop=now;
   return same;
  },null,{timeout:4000,polling:60}).then(()=>true,()=>false);
  rec('離したら止まる',stopped,`位置 ${await scrollNow()}`);

  /* 上の縁でも戻れる（行き過ぎたら詰む、を作らない） */
  const mid=await scrollNow();
  await dragTo(await page.evaluate(()=>{
   const tl=document.getElementById('scTimeline');
   return tl?tl.getBoundingClientRect().top+8:10;
  }));
  const wentUp=await page.waitForFunction(t=>{
   const tl=document.getElementById('scTimeline');
   const sc=document.scrollingElement||document.documentElement;
   const h=(tl&&tl.scrollHeight>tl.clientHeight+4)?tl:sc;
   return h.scrollTop<t-4;
  },mid,{timeout:6000}).then(()=>true,()=>false);
  rec('上の縁でも戻れる',wentUp||mid<=4,`${mid} → ${await scrollNow()}`);
  await page.evaluate(()=>{
   const row=document.querySelector('#scTimeline .sc-row-line');
   row.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:new DataTransfer()}));
  });

  /* ---- 4. 色と濃さの意味 ---- */
  await page.evaluate(()=>WL.scheduleView.openViewPop());
  const hasBtn=await page.waitForSelector('#scLegendBtn',{timeout:8000}).then(()=>true,()=>false);
  rec('「表示」に色と濃さの意味がある',hasBtn);
  await page.click('#scLegendBtn');
  const shown=await page.waitForSelector('#scLegendPop .sc-legend-row',{timeout:8000})
    .then(()=>true,()=>false);
  rec('押すと開く',shown);
  const legend=await page.evaluate(()=>[...document.querySelectorAll('#scLegendPop .sc-legend-row')]
    .map(r=>({名:(r.querySelector('.sc-legend-name')||{}).textContent||'',
              説明:((r.querySelector('.sc-legend-why')||{}).textContent||'').length,
              見本:(r.querySelector('.sc-legend-swatch')||{}).className||''})));
  rec('作業中・済んだ行・固定・保存中・選択・作業以外がそろっている',legend.length>=6,
      legend.map(x=>x.名).join('/'));
  rec('どの行にも文字の説明が付いている（色だけで語らない・§CLAUDE 3）',
      legend.every(x=>x.説明>=6),JSON.stringify(legend.map(x=>x.説明)));
  /* **見本は実物と同じクラスで描く**——色を書き写すと、実物を直したとき
     ここだけ嘘になる（§9.163）。クラスが乗っていることを見る。 */
  rec('見本は実物と同じクラスで描いている',
      legend.every(x=>x.見本.includes('sc-row-line')),
      (legend[0]||{}).見本||'');
  await page.evaluate(()=>WL.scheduleView.closeViewPop&&WL.scheduleView.closeViewPop());
 },{mode:'schedule'});
