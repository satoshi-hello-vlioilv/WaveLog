/* test_popmenu.js: 浮きメニューの器は1つ、ふるまいも1箇所（§9.448・§9.449）
   ============================================================
   §9.448 で「見た目を7種へ揃える」ことをやったが、**利用者の判断で撤回した**
   （§9.449。「文字の変更と行の高さの変更はあまり有益ではない」）。
   揃えるのは**値ではなく値の置き場**——面ごとに寸法が違うのは中身が違う
   からで、揃えること自体に用は無い。

   だからこの網が見るのは2つ:

     A 見た目が**§9.448より前と1つも違わない**こと
       （`tests/fixtures/menu_look.json` の13面と突き合わせる）
     B 器とふるまいは**1箇所**であること
       （`.wl-menu`を名乗る／`role`／矢印キー／Esc／外を押すと閉じる）

   A は「揃っていること」ではなく「**勝手に動かしていないこと**」を見る網。
   意図して変えるときは、変えた値をこの控えへ書き直すこと（黙って通さない）。

   **画面は 1728×1030 CSS px で測る**——`70vh` が効くので、器の大きさを
   変えると `max-height` の実測値が変わる。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const fs=require('fs');
const path=require('path');

const LOOK=JSON.parse(fs.readFileSync(
  path.join(__dirname,'fixtures','menu_look.json'),'utf8')).panes;
/* 面と、その面の項目クラス。**控えと同じ並び**で描くこと。 */
const PANES=[
 ['列見出し','col-head-menu',''],
 ['予定の行','col-head-menu sc-row-menu',''],
 ['予定の入れ子','col-head-menu sc-row-menu sc-row-submenu',''],
 ['測定データ一覧','rec-row-menu','rrm-item'],
 ['モード','access-mode-menu',''],
 ['同期の状態','access-mode-menu sc-sync-menu',''],
 ['表の切り替え','access-mode-menu hd-table-menu',''],
 ['再読込','access-mode-menu reload-menu',''],
 ['組み合わせ','access-mode-menu fb-preset-menu',''],
 ['条件','access-mode-menu fb-cond-menu',''],
 ['説明のヒント','access-mode-menu mm-hint-menu',''],
 ['見本の情報','access-mode-menu op-prev-info-pop',''],
 ['表示','access-mode-menu ui-size-menu',''],
];

run('test_popmenu: 浮きメニュー（§9.448・§9.449）', async ({page,rec,B,W,idle})=>{
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await W.booted(page); await idle();

 /* ---- A. 見た目が§9.448より前と1つも違わない ---- */
 const now=await page.evaluate(panes=>{
  const host=document.createElement('div');
  host.style.cssText='position:fixed;left:-9999px;top:0';document.body.append(host);
  const out={};
  for(const [name,cls,item] of panes){
   host.innerHTML='';
   const box=document.createElement('div');box.className='wl-menu '+cls;host.append(box);
   const b=document.createElement('button');b.type='button';
   b.className=item;b.textContent='押す';box.append(b);
   const c=getComputedStyle(box),s=getComputedStyle(b);
   out[name]={minW:c.minWidth,maxW:c.maxWidth,maxH:c.maxHeight,ovf:c.overflowY,
    pad:c.padding,bg:c.backgroundColor,shadow:c.boxShadow,radius:c.borderRadius,
    border:c.border,pos:c.position,z:c.zIndex,
    itemH:Math.round(b.getBoundingClientRect().height),
    itemFs:s.fontSize,itemPad:s.padding,itemDisp:s.display,itemColor:s.color};
  }
  host.remove();
  return out;
 },PANES);
 const diffs=[];
 for(const name of Object.keys(LOOK)){
  const a=LOOK[name],b=now[name];
  if(!b){diffs.push(`${name} 面が無い`);continue}
  for(const f of Object.keys(a))if(a[f]!==b[f])diffs.push(`${name}.${f} ${a[f]}→${b[f]}`);
 }
 rec('13面の見た目が控えと1つも違わない（§9.449。揃えるのは値ではなく置き場）',
     diffs.length===0, diffs.slice(0,5).join(' / '));

 /* ---- B-1. 浮いて出る面は全部`.wl-menu`を名乗る ----
    器を作っているのはJSの中なので、**書いてある所そのもの**を見る
    （画面を1つずつ開いて回ると、開けない面を数え落とす）。 */
 const JSDIR=path.join(__dirname,'..','static','js');
 const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>
   e.isDirectory()?walk(path.join(d,e.name)):(e.name.endsWith('.js')?[path.join(d,e.name)]:[]));
 const MENU=/className\s*=\s*'([^']*(?:access-mode-menu|col-head-menu|rec-row-menu)[^']*)'/g;
 const stray=[];
 for(const f of walk(JSDIR)){
  for(const m of fs.readFileSync(f,'utf8').matchAll(MENU)){
   if(!/\bwl-menu\b/.test(m[1]))stray.push(path.basename(f)+': '+m[1]);
  }
 }
 rec('浮いて出る面は全部`.wl-menu`を名乗る（器を新しく作らない）',
     stray.length===0,stray.slice(0,4).join(' / '));

 /* ---- B-2. 本物のメニューは role を名乗り、矢印キーで移れる ---- */
 await page.click('#nav [data-db-key]');
 await idle();
 await page.waitForSelector('#grid th',{timeout:25000});
 const th=await page.$('#grid th:nth-child(2)')||await page.$('#grid th');
 const box=await th.boundingBox();
 await page.mouse.click(box.x+box.width/2, box.y+box.height/2, {button:'right'});
 await page.waitForSelector('.col-head-menu',{timeout:8000});
 const m=await page.evaluate(()=>{
  const el=document.querySelector('.col-head-menu');
  return {role:el.getAttribute('role'),
          items:el.querySelectorAll('button').length,
          named:el.querySelectorAll('button[role="menuitem"]').length,
          base:el.classList.contains('wl-menu')};
 });
 rec('列見出しメニューは`.wl-menu`の器',m.base,JSON.stringify(m));
 rec('`role=menu`を名乗り、項目も全部`menuitem`',
     m.role==='menu'&&m.items>0&&m.items===m.named,JSON.stringify(m));

 const focused=()=>page.evaluate(()=>{const a=document.activeElement;
   return a&&a.closest('.col-head-menu')?(a.textContent||'').trim().slice(0,20):''});
 await page.keyboard.press('ArrowDown'); const f1=await focused();
 await page.keyboard.press('ArrowDown'); const f2=await focused();
 rec('↓で1つめ→2つめへ焦点が移る',!!f1&&!!f2&&f1!==f2,`1=${f1} / 2=${f2}`);
 await page.keyboard.press('End'); const fEnd=await focused();
 rec('Endで最後の項目へ飛ぶ',!!fEnd&&fEnd!==f1,fEnd);

 /* **黙って待たない**（§9.360）。閉じないなら、それがこの網の見るべき失敗。 */
 await page.keyboard.press('Escape');
 await page.waitForSelector('.col-head-menu',{state:'detached',timeout:5000});
 rec('Escで閉じる',
     await page.evaluate(()=>!document.querySelector('.col-head-menu')));

 await page.mouse.click(box.x+box.width/2, box.y+box.height/2, {button:'right'});
 await page.waitForSelector('.col-head-menu',{timeout:8000});
 await page.mouse.click(5,5);
 await page.waitForSelector('.col-head-menu',{state:'detached',timeout:5000});
 rec('外を押すと閉じる',
     await page.evaluate(()=>!document.querySelector('.col-head-menu')));
}, {mode:'edit', viewport:{width:1728,height:1030}});
