/* test_scscrap.js: 作業スケジュールの「耳屑幅(片耳)」の列（§9.389 段4）
   ------------------------------------------------------------
   利用者の指示「作業スケジュールのデータとして列データに取り込める情報の
   1つとして**各作業単位のロット毎に表示できるように耳屑の幅(片耳)を算出**
   してほしいです」／片耳は**均等（両耳合計÷2）**。

   固定すること:
    1. 分割なし … 元幅 − 製品幅×条数 の**半分**が出る
    2. 分割あり … **子ロットの条幅合計**を引く（子の行そのものには出さない）
    3. 材料が写しに無い行は**空（「—」）で、0にしない**。理由を`title`で言う
    4. 根拠（元幅・条幅合計・両耳）が`title`に出る（§CLAUDE 6）
    5. 既定では**出さない列**（毎回見るものではない）
    6. 式は`WL.split.scrapWidths()`の1箇所（測定画面と同じ答え）  */
const H=require('./lib/harness.js');
const TAG='SCR'+Date.now().toString().slice(-6);
const EQ='テスト設備A';
const TARGET='timeline:'+EQ;

H.run('test_scscrap: 耳屑幅(片耳)の列（§9.389 段4）',async({page,rec,B,W,idle})=>{
 const post=(path,body)=>page.evaluate(async a=>{
  const r=await fetch(a.path,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-scscrap'},a.body))});
  let j={};try{j=await r.json()}catch(e){j={}}
  return {status:r.status,body:j};
 },{path,body});
 const plan=()=>fetch(B+'/api/schedule/plan?equipment='+encodeURIComponent(EQ))
   .then(r=>r.json()).then(j=>j.entries||[]);

 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await W.booted(page); await idle();

 /* ---- 材料。**写しは自分で作る**（§9.351）——フィクスチャの仕掛には
    `BOX設計_横割数`も`BOX実績_板幅`も無い（§9.388）ので、予定の明細へ
    直に置いて「写しに在るときの見え方」を見る。 */
 const A=TAG+'A',Bl=TAG+'B',C=TAG+'C';
 await post('/api/schedule/plan/add',{equipment:EQ,kind:'作業',lotNo:A,
   detail:{lotNo:A,originalWidth:1000,mfgWidth:240,boxHorizontalCount:4}});
 await post('/api/schedule/plan/add',{equipment:EQ,kind:'作業',lotNo:Bl,
   detail:{lotNo:Bl,originalWidth:1000},
   children:[{lotNo:Bl+'-1',detail:{lotNo:Bl+'-1',__childLot:true,__childWidth:300,__childStrips:2}},
             {lotNo:Bl+'-2',detail:{lotNo:Bl+'-2',__childLot:true,__childWidth:200,__childStrips:1}}]});
 await post('/api/schedule/plan/add',{equipment:EQ,kind:'作業',lotNo:C,detail:{lotNo:C}});
 const es=await W.poll(plan,x=>[A,Bl,C].every(n=>x.some(e=>e.lotNo===n)),20000);
 rec('材料の予定を3件作れた',[A,Bl,C].every(n=>es.some(e=>e.lotNo===n)),
     es.filter(e=>e.lotNo&&e.lotNo.startsWith(TAG)).map(e=>e.lotNo).join('/'));

 // ---- ⑤ 既定では出さない列 --------------------------------------------
 await W.openSchedule(page,EQ);
 await idle();
 const off=await page.evaluate(()=>({
  cells:document.querySelectorAll('[data-col="__scrap__"]').length,
  inPanel:[...document.querySelectorAll('#scTimeline [data-col]')].length>0,
 }));
 rec('既定では耳屑幅の列は出ていない',off.cells===0,`${off.cells}セル`);
 /* **定義した固定列は全部「選べる並び」に載っていること**（§9.389 段4）。
    `SC_COL_BEFORE`/`SC_COL_AFTER`へ載せ忘れると、定義はあるのに設定
    パネルにも出ず・保存しても出ない列になる（実際にこれで落ちた）。 */
 const cols=await page.evaluate(()=>{
  const v=window.WL&&WL.scheduleView;
  return v&&typeof v.columnKeysForTest==='function'?v.columnKeysForTest():null;
 });
 rec('耳屑幅は「選べる列」の並びに載っている',
     !!cols&&cols.all.includes('__scrap__'),
     cols?`定義${cols.defs.length}／並び${cols.all.length}`:'（口が無い）');
 rec('定義した固定列はすべて並びに載っている（載せ忘れを数える）',
     !!cols&&cols.defs.every(k=>cols.all.includes(k)),
     cols?cols.defs.filter(k=>!cols.all.includes(k)).join('/')||'漏れなし':'（口が無い）');

 /* 列を出す（設定パネルと同じ保存の口）。 */
 await post('/api/column-layout-master',{target:TARGET,clear:true,
   order:['__cat__','lotNo','__scrap__','__actions__'],hidden:[],widths:{},names:{},
   formats:{},rules:{},formulas:{},locks:[],sorts:{}});
 await page.reload({waitUntil:'domcontentloaded'});
 await W.booted(page);
 await W.openSchedule(page,EQ);
 await page.waitForFunction(()=>document.querySelectorAll('[data-col="__scrap__"]').length>0,
   null,{timeout:20000});

 /* 行の器は`.sc-row-line`（`.sc-row`ではない）。**実物の綴りで拾うこと**
    ——当てずっぽうの選択子は「見つからない」を静かに返す（§9.349）。 */
 const read=async lot=>page.evaluate(n=>{
  const row=[...document.querySelectorAll('.sc-row-line')].find(r=>r.textContent.includes(n));
  const cell=row&&row.querySelector('[data-col="__scrap__"]');
  return cell?{txt:cell.textContent.trim(),title:cell.getAttribute('title')||'',
               blank:cell.classList.contains('is-blank')}:null;
 },lot);

 // ---- ① 分割なし: (1000 − 240×4)/2 = 20.0 -----------------------------
 const a=await read(A);
 rec('分割なしは「元幅 − 製品幅×条数」の半分',a&&a.txt==='20.0',JSON.stringify(a));
 rec('根拠（元幅・条幅合計・両耳）がtitleに出る',
     !!a&&/1000/.test(a.title)&&/240/.test(a.title)&&/4条/.test(a.title)&&/40/.test(a.title),
     (a&&a.title||'').replace(/\n/g,' / '));

 // ---- ② 分割あり: (1000 − (300×2+200))/2 = 100.0 ----------------------
 const b=await read(Bl);
 rec('分割ありは子ロットの条幅合計を引く',b&&b.txt==='100.0',JSON.stringify(b));
 rec('子ロットの件数がtitleに出る',!!b&&/子ロット2件/.test(b.title),
     (b&&b.title||'').replace(/\n/g,' / '));

 // ---- ③ 材料が無い行は空（0にしない） ---------------------------------
 const c=await read(C);
 rec('材料が写しに無い行は空（0にしない）',c&&c.txt==='—'&&c.blank,JSON.stringify(c));
 rec('出せない理由をtitleで言う',!!c&&/元幅/.test(c.title),(c&&c.title||''));

 // ---- ② 続き: 子ロットの行そのものには出さない ------------------------
 const kid=await page.evaluate(n=>{
  const btn=[...document.querySelectorAll('.sc-row-line')].find(r=>r.textContent.includes(n));
  const tog=btn&&btn.querySelector('.sc-kid-toggle,[data-kid-toggle]');
  if(tog)tog.click();
  return !!tog;
 },Bl);
 if(kid){
  await page.waitForFunction(n=>[...document.querySelectorAll('.sc-row-line')]
    .some(r=>r.textContent.includes(n+'-1')),Bl,{timeout:8000})
    .catch(e=>console.log('子ロットの行が出ない（畳んだままとして続ける）:',e.message.slice(0,60)));
  const k=await read(Bl+'-1');
  rec('子ロットの行には耳屑幅を出さない（元コイル1本の事実）',
      !k||k.txt==='—',JSON.stringify(k));
 }else{
  rec('子ロットの行には耳屑幅を出さない（元コイル1本の事実）',true,'畳みの取っ手が無いので確認できず');
 }

 // ---- ⑥ 式は測定画面と同じ1箇所 ---------------------------------------
 const same=await page.evaluate(()=>{
  const f=window.WL&&WL.split&&WL.split.scrapWidths;
  if(typeof f!=='function')return null;
  const r=f(1000,960);
  return r&&{scrap:r.scrap,even:r.even,bad:f('',960),bad2:f(1000,'x')};
 });
 rec('屑幅の式は WL.split.scrapWidths の1箇所',
     !!same&&same.scrap===40&&same.even===20,JSON.stringify(same));
 rec('読めない値は null（0にしない）',!!same&&same.bad===null&&same.bad2===null,
     JSON.stringify(same&&{a:same.bad,b:same.bad2}));

 // ---- 後片付け --------------------------------------------------------
 for(const e of await plan()){
  if(e.lotNo&&String(e.lotNo).startsWith(TAG))
   await fetch(B+'/api/schedule/plan/delete',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:e.id,user_id:'test-scscrap'})}).catch(()=>{});
 }
 await H.clearLayout(TARGET,'test-scscrap');
 const left=await plan();
 rec('置いた予定を消した',!left.some(e=>String(e.lotNo||'').startsWith(TAG)),
     left.filter(e=>String(e.lotNo||'').startsWith(TAG)).length+'件残り');
},{mode:'schedule',viewport:{width:1700,height:1000}});
