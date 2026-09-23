/* test_opinline.js: 測定画面からマスタへ間接登録する（§9.323 ①、利用者の指示）
   ============================================================
   「測定画面からマスタへ間接登録する経路を開通してほしいです」

   門（`role_can(...,'choice:inline-add')`／`MASTER_EDIT_INLINE_ENDPOINTS`）は
   §9.322で既に在り、通す口も`POST /api/operation-choice-master`の1本が在った
   ——**足りなかったのは測定画面から送る経路そのもの**で、CLAUDE.mdにも
   「現時点で存在しない…作るときはここを通すこと」と書いてあった。

   ここで固定すること。**どれも直す前なら落ちる**（A/Bで確かめてある）。
    1. **既定は今までどおり**（§9.132）——`[手打ちを登録]`が切の欄では
       手打ちの値を打ってもボタンが出ない（記録にだけ入る）
    2. 入にすると、**候補にない値を打ったときだけ**ボタンが出る
    3. **候補から選んだ値では出ない**（足すと二重になる）
    4. 何をするか・どこへ足すかを**字で言う**（§2）
    5. 押すと**マスタへ実際に入る**（「ボタンが出る」で終わらせない）
    6. 押した後は**ボタンが消える**（もう手打ちではない）——消えないと
       押すたびに同じ値がマスタへ並ぶ
    7. **効くのは「選択肢を持つ × 手打ち可」の欄だけ**——手打ちを切ると
       設定は残ったまま効かなくなる（`inlineAdd`が偽・`inlineAddSaved`は真）

   **サーバーだけを見る網では足りない**（§9.322と同じ理由）——口が正しく
   受けても、画面が送らなければ経路は開通していない。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
/* 実行ごとに一意（§tests/README）。落ちても次の実行とぶつからない。 */
const VAL='RT登録'+Date.now().toString(36).slice(-5);
const post=async(u,body)=>{
 const r=await fetch(B+u,{method:'POST',headers:{'Content-Type':'application/json'},
                         body:JSON.stringify(body)});
 let j={};try{j=await r.json()}catch(e){}
 return {code:r.status,...j};
};
const get=async u=>await (await fetch(B+u)).json();

/* 触る前の行を控える（§9.362 ⑤）。製品の「削除」は**論理削除**（`有効=0`）
   なので、APIで消しても行は残る。**この実行で増えた行だけ**を素の表から
   片付ける（名前で拾うと、同じ名前を使う他の網の期待と食い違う・§9.284）。 */
const H=require('./lib/harness.js');
const SNAP_TABLES=['選択履歴マスタ','操業データ選択肢マスタ'];
let snapM=null;
run('test_opinline: 測定画面からマスタへ間接登録する（§9.323 ①、利用者の指示）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 let item=null;
 try{
  /* 材料は自分で用意する（§9.291 ①）——検証用マスタの欄がどんな設定かに
     頼らない。**組み込みの選択欄で見ること**——`[型]`は`文字`なので、
     族ではなく型で判定する実装はここで落ちる（§9.244と同じ罠）。 */
  snapM=await H.masterSnapshot(SNAP_TABLES);
  const items=(await get('/api/operation-item-master')).items||[];
  item=items.find(x=>x.choice&&x.name==='オペレータ')||items.find(x=>x.choice);
  rec('選択肢を持つ欄がマスタに在る',!!item,item&&item.name);
  if(!item)throw Error('選択肢を持つ欄が無い');

  await page.addInitScript(eq=>{try{localStorage.setItem('AccessMeasurementConfiguredEquipment',eq)}catch(e){}},EQ);
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.WL&&WL.opData&&WL.opData.load,null,{timeout:30000});

  /* 欄を1つ引き当てて、手打ちの値を入れたときのボタンの様子を返す。
     **`presentation()`の口を通す**（§9.226 ①）——測定画面と設定窓の見本が
     同じここを通るので、実機と同じ道で確かめられる。 */
  /* **段ごとに別の値で試すこと**——同じ値を使い回すと、前の段が（欠陥で）
     登録してしまったときに次の段では「もう候補に在る」＝手打ちではなくなり、
     **本当は何を確かめたかったのかが読めない失敗**になる。 */
  const probe=async(name,val)=>{
   await page.evaluate(v=>{window.__rtVal=v},val);
   return await page.evaluate(async nm=>{
   await WL.opData.forget();await WL.opData.load();
   const def=(WL.opData.defs()||[]).find(d=>d.name===nm);
   if(!def)return {err:'def not found'};
   const host=[...document.querySelectorAll('[data-opfield],[data-f]')]
     .find(h=>h.dataset.opfield===nm
            ||(h.dataset.f&&String(def.builtin||'')===h.dataset.f));
   if(!host)return {err:'host not found'};
   const sel=host.querySelector(':scope>select');
   if(!sel)return {err:'select not found'};
   const out={inlineAdd:!!def.inlineAdd,freeText:!!def.freeText,
              inlineAddSaved:!!def.inlineAddSaved};
   /* ① 候補から選んだ値 */
   const first=[...sel.options].find(o=>o.value&&o.dataset.opFree!=='1');
   if(first){sel.value=first.value;sel.dispatchEvent(new Event('change',{bubbles:true}))}
   WL.opData.presentation(host,def);
   out.候補では出ない=!host.querySelector('.opf-addchoice');
   /* ② 手打ちの値。**`data-op-free`を付けて入れる**——手打ちの印は候補の側が
      持つ（`isFreeValue`）ので、印なしで入れると候補と読み違える。 */
   const o=document.createElement('option');
   o.value=window.__rtVal;o.textContent=window.__rtVal;o.dataset.opFree='1';
   sel.appendChild(o);sel.value=window.__rtVal;
   sel.dispatchEvent(new Event('change',{bubbles:true}));
   WL.opData.presentation(host,def);
   const btn=host.querySelector('.opf-addchoice');
   out.手打ちで出る=!!btn;
   out.文=btn?String(btn.textContent||''):'';
   out.説明=btn?String(btn.title||''):'';
   if(btn){
    btn.click();
    /* 押してから往復ぶん待つ（固定待ちにしない・§9.102）。 */
    for(let i=0;i<60&&host.querySelector('.opf-addchoice');i++)
     await new Promise(r=>setTimeout(r,100));
    out.押した後は消える=!host.querySelector('.opf-addchoice');
   }
    return out;
   },name);
  };

  /* ---- 1. 既定（切）では出ない ---- */
  await post('/api/operation-item-master/update',
             Object.assign({},item,{user_id:'test',freeText:true,inlineAdd:false}));
  const off=await probe(item.name,VAL+'x');
  const offRows=((await get('/api/operation-choice-master')).items||[])
    .filter(x=>x.value===VAL+'x');
  rec('既定（登録しない）では手打ちの値でもボタンを出さない（§9.132）',
      !!off&&off.手打ちで出る===false&&off.inlineAdd===false,JSON.stringify(off));
  /* **「ボタンが出ない」だけでは足りない**——別の道で送っていないことまで見る。 */
  rec('既定ではマスタへ1行も足さない',offRows.length===0,JSON.stringify(offRows));

  /* ---- 2〜6. 入にすると経路が開く ---- */
  await post('/api/operation-item-master/update',
             Object.assign({},item,{user_id:'test',freeText:true,inlineAdd:true}));
  const on=await probe(item.name,VAL);
  rec('入にすると手打ちの値でボタンが出る',!!on&&on.手打ちで出る===true,JSON.stringify(on));
  rec('候補から選んだ値では出さない（足すと二重になる）',
      !!on&&on.候補では出ない===true,JSON.stringify(on));
  rec('何をするかを字で言う（§2）',!!on&&/選択肢に登録/.test(on.文||''),on&&on.文);
  rec('どこへ足すかを名指す',
      !!on&&String(on.説明||'').includes(item.choice)&&String(on.説明||'').includes(VAL),
      on&&on.説明);
  /* **「ボタンが出る」で終わらせないこと**——送っていなくても通る。 */
  const rows=(await get('/api/operation-choice-master')).items||[];
  const made=rows.filter(x=>x.value===VAL&&x.name===item.choice);
  rec('押すとマスタへ実際に入る（口は`POST /api/operation-choice-master`の1本）',
      made.length===1,JSON.stringify(made.map(x=>({name:x.name,value:x.value}))));
  rec('押した後はボタンが消える（もう手打ちではない）',
      !!on&&on.押した後は消える===true,JSON.stringify(on));

  /* ---- 7. 効くのは「選択肢を持つ × 手打ち可」だけ ---- */
  await post('/api/operation-item-master/update',
             Object.assign({},item,{user_id:'test',freeText:false,inlineAdd:true}));
  const noFree=(await get('/api/operation-item-master')).items
    .find(x=>x.id===item.id);
  rec('手打ちを切ると効かなくなる／設定そのものは残す（§9.233 ④と同じ作法）',
      !!noFree&&noFree.inlineAdd===false&&noFree.inlineAddSaved===true,
      JSON.stringify({inlineAdd:noFree&&noFree.inlineAdd,
                      inlineAddSaved:noFree&&noFree.inlineAddSaved}));

  /* ---- 8. 送っていない保存で消えない（§9.212 ②） ---- */
  await post('/api/operation-item-master/update',
             {id:item.id,name:item.name,equipment:item.equipment,user_id:'test'});
  const kept=(await get('/api/operation-item-master')).items.find(x=>x.id===item.id);
  rec('他の段だけ保存しても開けた経路が閉じない（§9.212 ②）',
      !!kept&&kept.inlineAddSaved===true,JSON.stringify(kept&&kept.inlineAddSaved));

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }finally{
  /* 後片付け（§9.121）。**組み込みの行は消せない**ので設定を戻す。
     マスタへ足した値は消す（実行のたびに1行ずつ溜まる）。 */
  try{if(item)await post('/api/operation-item-master/update',
        Object.assign({},item,{user_id:'test'}))}catch(e){}
  try{
   const rows=(await get('/api/operation-choice-master')).items||[];
   for(const x of rows.filter(y=>String(y.value||'').startsWith('RT登録')))
    await post('/api/operation-choice-master/delete',{user_id:'test',id:x.id});
  }catch(e){console.log('!! 足した選択肢を消せませんでした: '+(e&&e.message||e))}
  try{if(snapM)await H.dropNewMasterRows(snapM)}
 catch(e){console.log('!! 増えた行を消せませんでした: '+(e&&e.message||e))}
 }
}, {viewport:{width:1600,height:1000}});
