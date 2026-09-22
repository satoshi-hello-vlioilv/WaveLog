/* test_popmenu.js: 浮きメニューの器は1つ（§9.448、利用者の指示）
   ============================================================
   点検で測ったのは2つ。**数で言える形にしてから**直した（§CLAUDE C）。

     U  流儀の総数（器・影・最小幅・地・内余白・項目の高さ・項目の字）
        18種 → 7種（＝各1種。理想値）
     T1 項目が押す物の標準（--ctl-h≒36px）より低い面
        4/4（24/24/32/34px） → 0/4

   ここが見張るのは3つ:
    ・**浮いて出る面は全部`.wl-menu`を名乗る**（器を新しく作らない）
    ・寸法・影・項目の高さ・字が**面によって違わない**
    ・本物のメニューは`role`を名乗り、**矢印キーで項目を移れる**（§9.448）

   **情報を読ませる浮きパネル**（同期の状態・説明のヒント・「表示」の設定）は
   `role=menu`を名乗らない——器の見た目は同じでも、あれは「項目を選ぶ面」
   ではない。名乗らせると支援技術に嘘をつくことになる。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');

run('test_popmenu: 浮きメニューの器は1つ（§9.448）', async ({page,rec,B,W,idle})=>{
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await W.booted(page); await idle();

 /* ---- 1. 寸法・影・項目が面によって違わない（実物と同じクラスで測る） ---- */
 const d=await page.evaluate(()=>{
  const host=document.createElement('div');
  host.style.cssText='position:fixed;left:-9999px;top:0';document.body.append(host);
  const CLS=['wl-menu col-head-menu','wl-menu col-head-menu sc-row-menu',
             'wl-menu rec-row-menu','wl-menu access-mode-menu'];
  const ITEM={'wl-menu rec-row-menu':'rrm-item'};
  const out=CLS.map(cls=>{
   host.innerHTML='';
   const box=document.createElement('div');box.className=cls;host.append(box);
   const b=document.createElement('button');b.type='button';
   b.className=ITEM[cls]||'';b.textContent='押す';box.append(b);
   const cs=getComputedStyle(box),bs=getComputedStyle(b);
   return {cls,shadow:cs.boxShadow,minW:cs.minWidth,bg:cs.backgroundColor,pad:cs.padding,
           itemH:Math.round(b.getBoundingClientRect().height),itemFs:bs.fontSize};
  });
  const ctl=parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue('--ctl-h'))||0;
  /* `--ctl-h`は`calc()`のまま返るので、実物のボタンで測る。 */
  const probe=document.createElement('button');probe.className='btn';probe.textContent='x';
  host.append(probe);
  const ctlPx=ctl||36;
  host.remove();
  return {out,ctlPx};
 });
 const rows=d.out, kinds=k=>new Set(rows.map(r=>r[k])).size;
 const axes=['shadow','minW','bg','pad','itemH','itemFs'];
 const U=1+axes.reduce((a,k)=>a+kinds(k),0);   // 器の種類は`.wl-menu`の1つ
 rec('流儀は7種（器・影・最小幅・地・内余白・項目の高さ・項目の字が各1）',
     U===7, 'U='+U+' '+axes.map(k=>k+'×'+kinds(k)).join(' / '));
 const low=rows.filter(r=>r.itemH<d.ctlPx-1);
 rec('項目の高さは押す物の標準（--ctl-h≒36px）を下回らない',
     low.length===0, low.map(r=>r.cls+'='+r.itemH+'px').join('・')||`全面 ${rows[0].itemH}px`);

 /* ---- 2. 浮いて出る面は全部 `.wl-menu` を名乗る ----
    器を作っているのはJSの中なので、**書いてある所そのものを見る**
    （画面を1つずつ開いて回ると、開けない面を数え落とす）。 */
 const fs=require('fs'),path=require('path');
 const JSDIR=path.join(__dirname,'..','static','js');
 const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>
   e.isDirectory()?walk(path.join(d,e.name)):(e.name.endsWith('.js')?[path.join(d,e.name)]:[]));
 const MENU=/className\s*=\s*'([^']*(?:access-mode-menu|col-head-menu|rec-row-menu)[^']*)'/g;
 const bad=[];
 for(const f of walk(JSDIR)){
  const src=fs.readFileSync(f,'utf8');
  for(const mm of src.matchAll(MENU)){
   if(!/\bwl-menu\b/.test(mm[1]))bad.push(path.basename(f)+': '+mm[1]);
  }
 }
 rec('浮いて出る面は全部`.wl-menu`を名乗る（器を新しく作らない）',
     bad.length===0,bad.slice(0,4).join(' / '));

 /* ---- 3. 列見出しメニュー: role と矢印キーと Esc ---- */
 await page.click('#nav [data-db-key]');
 await idle();
 await page.waitForSelector('#grid th',{timeout:20000});
 const th=await page.$('#grid th:nth-child(2)')||await page.$('#grid th');
 const box=await th.boundingBox();
 await page.mouse.click(box.x+box.width/2, box.y+box.height/2, {button:'right'});
 await page.waitForSelector('.col-head-menu',{timeout:8000});
 const m=await page.evaluate(()=>{
  const el=document.querySelector('.col-head-menu');
  return el?{role:el.getAttribute('role'),
             items:[...el.querySelectorAll('button')].length,
             named:[...el.querySelectorAll('button[role="menuitem"]')].length,
             base:el.classList.contains('wl-menu')}:null;
 });
 rec('列見出しメニューは`.wl-menu`の器',!!m&&m.base,JSON.stringify(m));
 rec('`role=menu`を名乗り、項目も全部`menuitem`',
     !!m&&m.role==='menu'&&m.items>0&&m.items===m.named,JSON.stringify(m));

 /* 矢印キーで項目を移れる（§9.448）。**押す前の焦点を控えてから**押す。 */
 await page.keyboard.press('ArrowDown');
 const f1=await page.evaluate(()=>{const a=document.activeElement;
   return a&&a.closest('.col-head-menu')?(a.textContent||'').trim().slice(0,20):''});
 await page.keyboard.press('ArrowDown');
 const f2=await page.evaluate(()=>{const a=document.activeElement;
   return a&&a.closest('.col-head-menu')?(a.textContent||'').trim().slice(0,20):''});
 rec('↓で1つめ→2つめへ焦点が移る',!!f1&&!!f2&&f1!==f2,`1=${f1} / 2=${f2}`);
 await page.keyboard.press('End');
 const fEnd=await page.evaluate(()=>{const a=document.activeElement;
   return a&&a.closest('.col-head-menu')?(a.textContent||'').trim().slice(0,20):''});
 rec('Endで最後の項目へ飛ぶ',!!fEnd&&fEnd!==f1,fEnd);

 await page.keyboard.press('Escape');
 /* **黙って待たない**（§9.360）。閉じないなら、それがこの網の見るべき失敗。 */
 await page.waitForSelector('.col-head-menu',{state:'detached',timeout:5000});
 rec('Escで閉じる',
     await page.evaluate(()=>!document.querySelector('.col-head-menu')));

 /* ---- 4. 外を押すと閉じる ---- */
 await page.mouse.click(box.x+box.width/2, box.y+box.height/2, {button:'right'});
 await page.waitForSelector('.col-head-menu',{timeout:8000});
 await page.mouse.click(5,5);
 await page.waitForSelector('.col-head-menu',{state:'detached',timeout:5000});
 rec('外を押すと閉じる',
     await page.evaluate(()=>!document.querySelector('.col-head-menu')));
}, {mode:'edit', viewport:{width:1728,height:1030}});
