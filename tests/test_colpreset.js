/* test_colpreset.js: 列の設定を名前で覚える／式で列を作る（§9.111 ⑤⑦）
   ============================================================
   要望は2つ。
    ⑤「細かい設定をエクスポート/インポートしたい。マスタ側に名前を付けて
       登録できるならそれでもよい。他のPCからも使えるようにしたい」
    ⑦「計算式で条件を追加できるが、元の列が無いと使えない。純粋に追加
       したい時に困る」

   ここで固定するのは、崩れると使えなくなる点。
    1. 名前を付けて登録すると**マスタに入る**（他のPCから読めることの根拠）
    2. 読み込むと一覧にその場で当たる（保存しなくても見える）
    3. 削除できる
    4. 式で作った列が一覧に出て、**保存すると次に開いても出る**
    5. 式で作った列は「計算・操作」に分類される
    6. 式で作った列を消せる（元のデータには影響しない）
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const NAME='検証プリセット'+Date.now();
const COL='検証計算列'+String(Date.now()).slice(-4);
let target='';
async function cleanup(){
 if(!target)return;
 try{await post('/api/column-layout-master',{target,clear:true,order:[],widths:{},hidden:[],names:{},
   formats:{},rules:{},formulas:{},user_id:'test'})}catch(e){}
 try{
  const r=await (await fetch(B+'/api/column-preset-master?target='+encodeURIComponent(target))).json();
  for(const p of (r.items||[]))if(String(p.name).startsWith('検証プリセット'))
   await post('/api/column-preset-master/delete',{id:p.id,target,user_id:'test'});
 }catch(e){}
}
run('test_colpreset: 列の設定を名前で覚える／式で列を作る（§9.111 ⑤⑦）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 try{
  await post('/api/access-mode',{mode:'edit'});
  /* 名前を聞く窓は素の`prompt()`ではなくなった（§9.342）ので、
     `page.on('dialog')`では答えられない。**開いた窓に打つ。** */
  const {answerPrompt}=require('./lib/wait.js');
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:30000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#grid table',{timeout:30000});
  await page.waitForFunction(()=>document.querySelectorAll('#grid thead th').length>5,{timeout:20000});
  target=await page.evaluate(()=>WL.list.listLayoutTarget());
  await cleanup();
  await page.evaluate(()=>{WL.columnLayout.forget();return WL.list.load()});
  await page.waitForFunction(()=>document.querySelectorAll('#grid thead th').length>5,{timeout:20000});

  const heads=()=>page.evaluate(()=>[...document.querySelectorAll('#grid thead th')].map(t=>t.dataset.col));
  await W.listView(page);await page.click('#listColumnBtn');
  await page.waitForSelector('#lcList .lc-item',{timeout:15000});

  /* ================= ⑤ 名前を付けて覚える ================= */
  const victim=(await heads()).find(k=>k&&!k.startsWith('__')&&k!=='#');
  await page.evaluate(k=>{
   document.querySelector(`#lcList .lc-item[data-key="${k}"] input[type=checkbox]`).click();
  },victim);
  await idle();
  await page.click('#lcPresetSave');
  await answerPrompt(page,NAME);
  await page.waitForFunction(n=>[...document.querySelectorAll('#lcPresetSel option')]
    .some(o=>o.textContent===n),NAME,{timeout:10000});
  rec('名前を付けて登録できる',true,NAME);

  const stored=await (await fetch(B+'/api/column-preset-master?target='+encodeURIComponent(target))).json();
  const mine=(stored.items||[]).find(p=>p.name===NAME);
  rec('マスタに入る（他のPCから読める根拠）',!!mine,`${(stored.items||[]).length}件`);
  rec('登録した中身に「隠した列」が入っている',
   !!mine&&(mine.body.hidden||[]).includes(victim),JSON.stringify(mine&&mine.body.hidden));

  // 既定へ戻してから読み込み直す
  await page.click('#lcReset');
  await idle();
  rec('「既定に戻す」でいったん全部出る',(await heads()).includes(victim));
  await page.selectOption('#lcPresetSel',{label:NAME});
  await page.waitForFunction(k=>![...document.querySelectorAll('#grid thead th')]
    .some(t=>t.dataset.col===k),victim,{timeout:10000});
  rec('読み込むと一覧にその場で当たる（保存しなくても見える）',!(await heads()).includes(victim));

  /* ================= ⑦ 式で列を作る ================= */
  const beforeN=await page.evaluate(()=>document.querySelectorAll('#lcList .lc-item').length);
  await page.click('#lcAddCol');
  await answerPrompt(page,COL);
  await page.waitForSelector('#lcFormula',{timeout:10000});
  const afterN=await page.evaluate(()=>document.querySelectorAll('#lcList .lc-item').length);
  rec('列を1つ足せる',afterN===beforeN+1,`${beforeN} -> ${afterN}`);
  rec('式が空のうちは「まだ式が入っていません」と言う',
   /まだ式が入っていません/.test(await page.evaluate(()=>document.querySelector('.lc-fx-state').textContent)));
  rec('作った列は「計算・操作」に分類される',
   await page.evaluate(k=>document.querySelector(`#lcList .lc-item[data-key="${k}"]`)?.dataset.origin==='calc',COL));

  // 壊れた式は書いている時点で言う
  await page.fill('#lcFormula','len([ロット番号]) * ');
  await page.waitForFunction(()=>/is-ng/.test(document.querySelector('.lc-fx-state').className)
    &&/途中/.test(document.querySelector('.lc-fx-state').textContent),null,{timeout:8000});
  rec('壊れた式は書いている時点で断る',true,
   await page.evaluate(()=>document.querySelector('.lc-fx-state').textContent.trim()));

  await page.fill('#lcFormula','concat([ロット番号], "/", len([ロット番号]))');
  await page.waitForFunction(()=>/is-ok/.test(document.querySelector('.lc-fx-state').className),null,{timeout:8000});
  rec('使える式だと分かる',true,
   await page.evaluate(()=>document.querySelector('.lc-fx-state').textContent.trim()));
  rec('先頭3件の結果が出る',
   await page.evaluate(()=>document.querySelectorAll('.lc-fx-row').length===3));
  /* §9.483（利用者の指示「作業スケジュールの表示列の編集…同じように…共通化」）: 式の列も**左の見本と
     右の「値のある行」に値が出る**。列の生の値の答えはパネルの`rawOfDraft()`1箇所——以前は6箇所が口を直に
     呼び、式を自前で解いていたスケジュール表だけ出て、仕掛一覧は「値のある行がありません（0件）」だった。 */
  /* 待ちは黙らない（§9.360）——`wait.js`の`until`は切れたら何を待っていたかを言う。 */
  await require('./lib/wait.js').until(page,k=>{const it=document.querySelector(`#lcList .lc-item[data-key="${k}"]`);
    return !!it&&/\//.test(it.textContent)},COL,{ms:8000,what:'式の列の見本'});
  const fxSide=await page.evaluate(k=>({
   item:(document.querySelector(`#lcList .lc-item[data-key="${k}"]`)||{}).textContent||'',
   stat:(((document.querySelector('#lcDetail')||{}).textContent||'').replace(/\s+/g,' ').match(/値のある行\s*(\d+)/)||[])[1]}),COL);
  rec('式の列も左の見本と「値のある行」に式の結果が出る（パネルの1箇所が答える）',
   /\//.test(fxSide.item)&&!/値のある行がありません/.test(fxSide.item)&&+fxSide.stat>0,
   `見本「${fxSide.item.replace(/\s+/g,' ').trim().slice(0,40)}」／値のある行 ${fxSide.stat}`);

  await page.waitForFunction(k=>[...document.querySelectorAll('#grid thead th')]
    .some(t=>t.dataset.col===k),COL,{timeout:10000});
  rec('作った列が一覧に出る',(await heads()).includes(COL));
  const cell=await page.evaluate(k=>document.querySelector(`#grid tbody tr td[data-col="${k}"]`)?.textContent,COL);
  rec('一覧のセルに計算した値が入る',/\/\d/.test(String(cell)),String(cell));

  /* 保存 → 開き直しても残る（保存していなければ意味が無い機能） */
  await page.click('#lcSave');
  await idle(600,10000);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#grid table',{timeout:30000});
  await page.waitForFunction(k=>[...document.querySelectorAll('#grid thead th')]
    .some(t=>t.dataset.col===k),COL,{timeout:20000});
  rec('保存すると次に開いても出る',(await heads()).includes(COL));
  const cell2=await page.evaluate(k=>document.querySelector(`#grid tbody tr td[data-col="${k}"]`)?.textContent,COL);
  rec('開き直しても計算した値が出る',/\/\d/.test(String(cell2)),String(cell2));

  /* 消せる（元のデータには影響しない＝データ列の数は変わらない） */
  await W.listView(page);await page.click('#listColumnBtn');
  await page.waitForSelector('#lcList .lc-item',{timeout:15000});
  await page.evaluate(k=>{document.querySelector(`#lcList .lc-item[data-key="${k}"]`).click()},COL);
  await page.waitForSelector('#lcFormulaDel',{timeout:8000});
  await page.click('#lcFormulaDel');
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:5000});
  await page.click('#appConfirmOk');
  await page.waitForFunction(k=>![...document.querySelectorAll('#grid thead th')]
    .some(t=>t.dataset.col===k),COL,{timeout:10000});
  rec('式で作った列は消せる',!(await heads()).includes(COL));

  /* ================= ⑤ 削除 ================= */
  await page.selectOption('#lcPresetSel',{label:NAME});
  await idle();
  await page.click('#lcPresetDel');
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:5000});
  await page.click('#appConfirmOk');
  await idle();
  const left=await (await fetch(B+'/api/column-preset-master?target='+encodeURIComponent(target))).json();
  rec('登録した設定を削除できる',
   !(left.items||[]).some(p=>p.name===NAME),`${(left.items||[]).length}件`);

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }finally{
  try{await cleanup()}catch(e){}
 }
}, {viewport:{width:1520,height:940}});
