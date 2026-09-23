/* test_opparent.js: 親を選ぶと子の候補が絞られる（§9.306-C、利用者の指示）
   ============================================================
   利用者の指示:
     「選択肢の値マスタ同士を親子関係として紐づけるためにリンクさせ、リンク
      させた場合、子となったマスタは登録内容毎、どの親か親マスタから選ぶことが
      できるようにしたい」
   利用者に確かめたこと:
     ・親の欄をまだ選んでいないとき → **全部出す**（今までどおり）

   サーバー側（`/api/operation-form`が`parentField`と`choicesByParent`を
   先に解いて返すこと）は`tests/test_choicelink.py`が固定してある。
   **ここが見るのは測定画面**——サーバーが正しく答えていても、画面が
   引かなければ候補は1つも減らない。

   ここで固定すること。**どれも直す前なら落ちる**ことを確かめてある。
    1. 親を選ぶ前は**全部出る**（絞らない・利用者の指示）
    2. 親＝Aで**Aのものだけ**になる（親の値が空の値は**どの親でも出る**）
    3. 親＝Bで**Bのものだけ**になる（片側だけ見る網は素通りする）
    4. 親を戻すと**全部に戻る**（絞りっぱなしにしない）
    5. **絞っていることを文字で言う**（§3）。絞っていないときは出さない
    6. **記録済みの値は候補から消さない**（§9.204。`select.value`へ候補に
       無い値を入れると空になり、**記録が黙って消える**）
    7. **器を被せる形（セグメント）でも札が絞られる**（§9.218 ②。
       `<select>`だけ書き換える実装は、札が前の候補のまま残る）
    8. **描き直しても絞りが残る**（`layout()`が当て直す）——`change`だけで
       当てる実装は、入力内容を切り替えた瞬間に絞りが解ける
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const TAG='OP'+process.pid;
const PARENT=TAG+'親', CHILD=TAG+'子';
const P_FIELD=TAG+'親欄', C_FIELD=TAG+'子欄', C_SEG=TAG+'札欄';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)}).then(async r=>await r.json().catch(()=>({})));
const get=p=>fetch(B+p).then(r=>r.json());
let b=null;const madeChoices=[],madeItems=[];let link=null;

run('test_opparent: 親を選ぶと子の候補が絞られる（§9.306-C、利用者の指示）', async ({page,rec,B,W,idle,paint,errs,browser})=>{

 /* いま画面に出ているその欄の姿。**`<select>`の候補と器の札を両方見る**
    ——片方だけだと、器を作り直していない実装（札が前のまま）を見逃す。 */
 const shot=name=>page.evaluate(nm=>{
  const host=document.querySelector(`[data-opfield="${CSS.escape(nm)}"]`);
  if(!host)return null;
  const sel=host.querySelector(':scope>select');
  const note=host.querySelector(':scope>.opf-note');
  return {
   候補:sel?[...sel.options].map(o=>o.value).filter(v=>v!==''):null,
   値:sel?sel.value:null,
   札:[...host.querySelectorAll('.opf-widget [data-opv]')].map(x=>x.getAttribute('data-opv')),
   案内:note&&!note.hidden?String(note.textContent||''):'',
  };
 },name);
 /* 親を選ぶ。**`change`を飛ばす**——実機と同じ道（`.value`への代入だけでは
    飛ばない・§9.218 ②）。 */
 const pick=async v=>{
  await page.evaluate(([nm,val])=>{
   const host=document.querySelector(`[data-opfield="${CSS.escape(nm)}"]`);
   const sel=host&&host.querySelector(':scope>select');
   if(sel){sel.value=val;sel.dispatchEvent(new Event('change',{bubbles:true}))}
  },[P_FIELD,v]);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 };
 const setChild=async v=>{
  await page.evaluate(([nm,val])=>{
   const host=document.querySelector(`[data-opfield="${CSS.escape(nm)}"]`);
   const sel=host&&host.querySelector(':scope>select');
   if(sel){sel.value=val;sel.dispatchEvent(new Event('change',{bubbles:true}))}
  },[C_FIELD,v]);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 };
 const sorted=a=>(a||[]).slice().sort();

 try{
  await post('/api/access-mode',{mode:'edit'});

  /* ---------- 材料は自分で注ぎ込む（フィクスチャは親子を1本も持たない） ----------
     親2値・子4値（親A→2件／親B→1件／**親の値が空**→どの親でも出る1件）。 */
  const addChoice=async(name,value,parentValue)=>{
   const r=await post('/api/operation-choice-master',
     {name,value,parentValue:parentValue||'',order:0,enabledText:'出す',user_id:'tests'});
   if(r&&r.id)madeChoices.push(r.id);
   return r;
  };
  await addChoice(PARENT,'甲');await addChoice(PARENT,'乙');
  await addChoice(CHILD,'甲用1','甲');await addChoice(CHILD,'甲用2','甲');
  await addChoice(CHILD,'乙用1','乙');await addChoice(CHILD,'どれでも','');
  const lk=await post('/api/choice-link-master',{parent:PARENT,child:CHILD,user_id:'tests'});
  link=lk&&lk.id;
  rec('前提: 親子を1本張れた',!!link,JSON.stringify(lk));

  const addItem=async(name,choice,order,widget)=>{
   const r=await post('/api/operation-item-master',
     {name,equipment:'*',place:'準備',group:TAG,type:'選択',choice,
      order,enabled:true,widget:widget||'',user_id:'tests'});
   if(r&&r.id)madeItems.push(r.id);
   return r;
  };
  await addItem(P_FIELD,PARENT,9201);
  await addItem(C_FIELD,CHILD,9202);                /* 素のプルダウン */
  await addItem(C_SEG,  CHILD,9203,'セグメント');   /* 器を被せる形 */

  /* サーバーがちゃんと答えていること（ここが偽なら画面の話ではない）。 */
  const form=await get('/api/operation-form?equipment='+encodeURIComponent(EQ));
  const kid=(form.items||[]).find(x=>x.name===C_FIELD)||{};
  rec('前提: サーバーが親の欄と親の値ごとの候補を返す',
      (kid.parentField||{}).name===P_FIELD&&!!(kid.choicesByParent||{})['甲'],
      JSON.stringify({親:kid.parentField,表:kid.choicesByParent}));

  /* ---------- 測定画面を開く ---------- */
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#grid tbody tr',{timeout:30000});
  await page.evaluate(()=>document.querySelector('#grid tbody tr')
    .dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));
  await page.waitForSelector('.measure-shell',{timeout:25000});
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
  await page.waitForFunction(()=>!!(window.WL&&WL.opData&&WL.opData.defs&&WL.opData.defs().length),
    null,{timeout:25000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

  const ALL=['甲用1','甲用2','乙用1','どれでも'];

  /* ---- 1) 親を選ぶ前は全部出る（利用者の指示） ---- */
  let s=await shot(C_FIELD);
  if(!s){rec('前提: 子の欄が測定画面に出ている',false,C_FIELD);throw Error('欄が無い')}
  rec('① 親を選ぶ前は全部出る（絞らない）',
      JSON.stringify(sorted(s.候補))===JSON.stringify(sorted(ALL)),JSON.stringify(s.候補));
  rec('⑤-a 絞っていないときは案内を出さない',s.案内==='',s.案内);

  /* ---- 2) 親＝甲 ---- */
  await pick('甲');
  s=await shot(C_FIELD);
  rec('② 親＝甲では甲のものだけ（親の値が空の値はどの親でも出る）',
      JSON.stringify(sorted(s.候補))===JSON.stringify(sorted(['甲用1','甲用2','どれでも'])),
      JSON.stringify(s.候補));
  rec('⑤-b 絞っていることを文字で言う（親の欄の名前と件数）',
      s.案内.includes(P_FIELD)&&s.案内.includes('甲')&&s.案内.includes('3'),s.案内);

  /* ---- 3) 親＝乙（片側だけ見る網は素通りする） ---- */
  await pick('乙');
  s=await shot(C_FIELD);
  rec('③ 親＝乙では乙のものだけ',
      JSON.stringify(sorted(s.候補))===JSON.stringify(sorted(['乙用1','どれでも'])),
      JSON.stringify(s.候補));

  /* ---- 7) 器を被せる形でも札が絞られる ---- */
  const seg=await shot(C_SEG);
  rec('⑦ セグメント（器を被せる形）でも札が絞られる',
      !!seg&&JSON.stringify(sorted((seg.札||[]).filter(v=>v!==''&&v!=null)))
        ===JSON.stringify(sorted(['乙用1','どれでも'])),
      JSON.stringify(seg&&seg.札));

  /* ---- 6) 記録済みの値は候補から消さない（§9.204） ---- */
  await setChild('乙用1');
  await pick('甲');
  s=await shot(C_FIELD);
  rec('⑥ 記録済みの値は親の外になっても消さない（値が残る）',
      s.値==='乙用1'&&(s.候補||[]).indexOf('乙用1')>=0,
      JSON.stringify({値:s.値,候補:s.候補}));
  rec('⑥-b その値が「この親では選べない」ことを字で言う',
      /この親では選べません/.test(await page.evaluate(nm=>{
       const h=document.querySelector(`[data-opfield="${CSS.escape(nm)}"]`);
       const o=h&&[...h.querySelectorAll(':scope>select option')].find(x=>x.value==='乙用1');
       return o?o.textContent:'';
      },C_FIELD)),'');

  /* ---- 8) 描き直しても絞りが残る（`layout()`が当て直す） ---- */
  await setChild('');
  await pick('甲');
  await page.evaluate(()=>WL.opData.layout());
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  s=await shot(C_FIELD);
  rec('⑧ 描き直しても絞りが残る（layout()が当て直す）',
      JSON.stringify(sorted(s.候補))===JSON.stringify(sorted(['甲用1','甲用2','どれでも'])),
      JSON.stringify(s.候補));

  /* ---- 4) 親を戻すと全部に戻る（絞りっぱなしにしない） ---- */
  await pick('');
  s=await shot(C_FIELD);
  rec('④ 親を戻すと全部に戻る',
      JSON.stringify(sorted(s.候補))===JSON.stringify(sorted(ALL))&&s.案内==='',
      JSON.stringify({候補:s.候補,案内:s.案内}));

 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }finally{
  /* **後始末は自分が作ったものだけ**（§9.121。マスタは実行をまたいで残る）。 */
  try{if(link)await post('/api/choice-link-master/delete',{id:link,user_id:'tests'})}catch(e){}
  for(const id of madeItems){try{await post('/api/operation-item-master/delete',{id,user_id:'tests'})}catch(e){}}
  for(const id of madeChoices){try{await post('/api/operation-choice-master/delete',{id,user_id:'tests'})}catch(e){}}
 }
}, {viewport:{width:1800,height:1000}});
