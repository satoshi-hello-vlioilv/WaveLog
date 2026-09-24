/* test_stdmodal.js: 刃組基準値マスタの編集窓（§9.463）。
   利用者の指摘「モーダルサイズがころころ変わり安定せず、入力項目の配置も整列して
   いないのでバラバラ統一感もない…モーダルのタイトル名も変です」。
   物差し: ①段を切り替えても窓の高さ・上端が動かない（前: 428〜927px・上端249px動く）
   ②どの段でも入力の左端が1本（前: 5/6段で2〜3種）③入力が説明に重ならない
   ④題は設備の名前（前: 「1599.6 を編集」）⑤空欄の数の欄は既定値を薄字で言う
   ⑥選ぶ欄は「（既定）」を持ち、登録の無い値はそれが選ばれている */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';
run('test_stdmodal: 刃組基準値の編集窓は大きさが動かず、欄が1本にそろう（§9.463）', async ({page,rec,W,idle})=>{
 await page.setViewportSize({width:1728,height:1030});
 const post=(u,b)=>page.evaluate(([u,b])=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json()),[u,b]);
 await page.goto(API+'/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
 await W.booted(page);await idle();
 await post(API+'/api/access-mode',{mode:'edit'});
 const made=await post(API+'/api/bladeset-standard-master',{equipment:'テスト設備A',arborLen:'1599.6',note:'probe'});
 try{
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintForm',{timeout:10000});
  await page.evaluate(()=>document.querySelector('[data-master="bladesetStandard"]').click());
  /* 一覧に行が出るまで（網が作った1行）。 */
  await page.waitForFunction(()=>[...document.querySelectorAll('#masterMaintList button')].some(b=>/編集/.test(b.textContent)),null,{timeout:10000});
  await idle();
  const opened=await page.evaluate(()=>{
   const row=[...document.querySelectorAll('#masterMaintList [data-edit],#masterMaintList button')].find(b=>/編集/.test(b.textContent));
   if(row){row.click();return 'edit'}
   const a=document.getElementById('masterMaintAdd');if(a){a.click();return 'add'}
   return '';
  });
  await page.waitForSelector('.mm-editor-modal:not([hidden]) .mm-tab',{timeout:10000});
  await idle();
  const out=await page.evaluate(async()=>{
   const dlg=document.querySelector('.mm-editor-dialog');
   const tabs=[...document.querySelectorAll('.mm-editor-modal .mm-tab')];
   const res=[];
   for(const t of tabs){
    t.click();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const panel=document.querySelector('.mm-editor-modal .mm-tabpanel:not([hidden])');
    const ctl=[...panel.querySelectorAll('.mm-field')].map(f=>{
     /* 入力の並びの**先頭の部品**（数の欄は−ボタン、選ぶ欄は枠）の左端 */
     const c=f.querySelector('.mm-num,select,input:not([type=hidden]),textarea');
     return c?Math.round(c.getBoundingClientRect().left):null}).filter(x=>x!=null);
    const over=[...panel.querySelectorAll('.mm-field')].filter(f=>{const c=f.querySelector('.mm-num,select,input:not([type=hidden])');const h=f.querySelector('.mm-field-hint');
      if(!c||!h)return false;
      /* 入力の部品の**いちばん右**（＋ボタン・単位・中の欄まで）で見る。器の幅では見ない（中身がはみ出す）。 */
      const right=Math.max(c.getBoundingClientRect().right,...[...c.querySelectorAll('*')].map(n=>n.getBoundingClientRect().right));
      return right>h.getBoundingClientRect().left+1}).length;
    const rows=new Map();
    [...panel.querySelectorAll('.mm-field')].forEach(f=>{const y=Math.round(f.getBoundingClientRect().top);rows.set(y,(rows.get(y)||0)+1)});
    const r=dlg.getBoundingClientRect();
    res.push({tab:t.querySelector('.mm-fieldgroup').textContent,h:Math.round(r.height),top:Math.round(r.top),
      lefts:new Set(ctl).size,fields:ctl.length,over,perRow:[...rows.values()].join('/')});
   }
   return {title:document.getElementById('maintEditorTitle').textContent,
     eyebrow:document.getElementById('maintEditorEyebrow').textContent,res};
  });
  const hs=out.res.map(x=>x.h), tops=out.res.map(x=>x.top);
  console.log('開き方',opened,'／題名「'+out.title+'」／上の小見出し「'+out.eyebrow+'」');
  out.res.forEach(x=>console.log(`  ${x.tab.padEnd(12)} 高さ${x.h} 上端${x.top} 欄${x.fields} 入力の左端${x.lefts}種 説明に重なる${x.over} 1行の欄数${x.perRow}`));
  console.log(`高さの揺れ ${Math.max(...hs)-Math.min(...hs)}px（${Math.min(...hs)}〜${Math.max(...hs)}）／上端の揺れ ${Math.max(...tops)-Math.min(...tops)}px`);
  console.log(`左端がそろっていない段 ${out.res.filter(x=>x.lefts>1).length}/${out.res.length}`);
  if(process.env.PROBE_OUT){
   for(const i of [1,4]){
    await page.evaluate(i=>document.querySelectorAll('.mm-editor-modal .mm-tab')[i].click(),i);
    await page.screenshot({path:`${process.env.PROBE_OUT}/std_${process.env.PROBE_TAG||'x'}_${i}.png`});
   }
  }
  const plc=await page.evaluate(()=>{
   const q=k=>document.querySelector(`.mm-editor-modal [data-field="${k}"]`);
   /* 選ぶ欄の見本は「図の基準原点の位置」（§9.470 で「基準面」の欄は外した）。 */
   return {shaft:q('shaftDia')&&q('shaftDia').placeholder, pos:q('viewDatumPos')&&q('viewDatumPos').value,
     posOpt:q('viewDatumPos')&&q('viewDatumPos').options[0].textContent,
     naka:q('canNakanukiText')&&q('canNakanukiText').value};
  });
  rec('段を切り替えても窓の高さが動かない',Math.max(...hs)-Math.min(...hs)===0,hs.join('/'));
  rec('段を切り替えても窓の上端が動かない',Math.max(...tops)-Math.min(...tops)===0,tops.join('/'));
  rec('どの段でも入力の左端が1本にそろう',out.res.every(x=>x.lefts===1),out.res.map(x=>x.lefts).join('/'));
  rec('入力（＋ボタン・単位まで）が説明に重ならない',out.res.every(x=>!x.over),out.res.map(x=>x.over).join('/'));
  rec('題は設備の名前（先頭の列の数ではない）',/テスト設備A/.test(out.title)&&!/^[\d.,]+ を編集/.test(out.title),out.title);
  rec('空欄の数の欄は、効いている既定値を薄字で言う',/^既定 \d/.test(plc.shaft||''),String(plc.shaft));
  rec('選ぶ欄は「（既定）」を持ち、登録の無い値はそれが選ばれている（保存で固定しない）',
      plc.pos===''&&/（既定）右/.test(plc.posOpt||'')&&plc.naka==='',JSON.stringify(plc));
  rec('「基準面」の欄は無い（§9.470・DSに固定）',
      await page.evaluate(()=>!document.querySelector('.mm-editor-modal [data-field="datumSide"]')));
 }finally{
  /* 後片付け。消せなかったら黙らない（§9.360）。 */
  if(made&&made.id){const del=await post(API+'/api/bladeset-standard-master/delete',{id:made.id});
   if(!del||!del.ok)console.log('  [cleanup] 刃組基準値の行を消せない:',JSON.stringify(del))}
 }
});
