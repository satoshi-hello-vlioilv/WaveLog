/* test_rpsave.js: 帳票の配置は「触ったら裏で保存」（§9.303 ③・§9.312）
   ============================================================
   利用者の報告:
     「帳票レイアウトの編集で、帳票ブロックのサイズ変更するときに意図して
      いないブロックまで変化するような変な挙動があります。サイズ変更した
      際にその近くにある帳票ブロックのサイズも一緒に変更される不具合が
      発生しました。バックグラウンド保存を入れてから挙動が変わった可能性も
      あります。なんとなく位置が戻されるような感覚があります。」

   ここで固定するのは**保存の往復中に触ったぶんが消えないこと**。
   `WL.columnLayout.save()`は投げる前に下書きを捨てるので、往復のあいだに
   触ったぶんは**新しい下書き**に載る。往復が終わった側がそれを
   `discard()`し、`rpSaveDirty=false`で次の保存まで取り下げていたため、
   触ったぶんが**データからだけ消えて画面には残る**——次の描き直しで
   その塊だけが巻き戻り、「別の塊を触ったらこの塊の大きさが変わった」に
   見えていた。

   後片付けは finally で必ず行う。**列レイアウトマスタは実行をまたいで
   生き延びる**（§9.121）。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const TARGET='report:'+EQ;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const getj=p=>fetch(B+p).then(r=>r.json());
const cleanup=()=>post('/api/column-layout-master',{target:TARGET,clear:true,order:[],widths:{},hidden:[],
  names:{},formats:{},rules:{},formulas:{},locks:[],sorts:{},user_id:'test'}).catch(()=>{});
const settle=async page=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))};
const A='基本情報',C1='コース情報';
const UNIT=60;                                  /* RP_SPAN_UNIT（§9.169。幅） */
const CUNIT=30;                                 /* RP_COUNT_UNIT（行数・段数） */

run('test_rpsave: 帳票の配置は「触ったら裏で保存」（§9.303 ③・§9.312）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 await cleanup();
 let lastGeo=null;
 /* 保存の要求が「出た」ことを数える。**時間でなくこの数で待つ**——
    「保存#1が飛ぶところまで」は、要求が出たかどうかそのものだから。 */
 let posts=0;
 page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/column-layout-master'))posts++});
 const posted=async n0=>W.poll(async()=>posts,v=>v>n0,8000);
 const openReport=async()=>{
  /* **見本のロットで開く**（§9.253）——測定データが1件も無い端末でも同じ紙を
     組める。この網が見るのは「保存の往復」なので、ロットの中身には依らない。 */
  await page.evaluate(e=>WL.reportSample.open({equipment:e}),EQ);
  await page.waitForSelector('#reportContent .rp-blocks',{timeout:25000}).catch(e=>{throw new Error('帳票が出ない: '+e.message.slice(0,60))});
  await idle(); await settle(page);
  };
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:30000}).catch(e=>{throw new Error('起動しない: '+e.message.slice(0,60))});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  /* **形は自分で作る**（§9.121の裏返し）——このロットの中身次第で塊の数も
     高さも変わるので、そのままだと縁が画面の外に来て「掴めないから通る」
     網になる。3枚だけ・同じ大きさに揃えてから見る。 */
  await post('/api/column-layout-master',{target:TARGET,user_id:'test',
    order:[A,C1],hidden:[],widths:{[A]:6*UNIT,[C1]:6*UNIT}});
  await openReport();
  const allKeys=await page.evaluate(()=>(window.__rpKeys?window.__rpKeys():[]));
  await post('/api/column-layout-master',{target:TARGET,user_id:'test',
    order:[A,C1],hidden:allKeys.filter(k=>k!==A&&k!==C1),
    widths:{[A]:6*UNIT,[C1]:6*UNIT}});
  await page.evaluate(t=>WL.columnLayout.forget(t),TARGET);
  await page.evaluate(()=>window.exitReportView&&window.exitReportView());
  await openReport();
  await page.click('#reportArrange');
  await page.waitForSelector('#reportContent .rp-blocks.is-arranging',{timeout:15000}).catch(e=>{throw new Error('組み換えに入れない: '+e.message.slice(0,60))});
  await idle(); await settle(page);

  const spotOf=key=>page.evaluate(k=>{
   const el=document.querySelector(`#reportContent [data-rp-block="${CSS.escape(k)}"]`);
   if(!el)return null;
   const c=/^(\d+)\s*\/\s*span\s*(\d+)/.exec(el.style.gridColumn||'');
   const r=/^(\d+)\s*\/\s*span\s*(\d+)/.exec(el.style.gridRow||'');
   return c&&r?{col:+c[1],span:+c[2],row:+r[1],rows:+r[2]}:null;
  },key);
  const gripDrag=async(key,kind,dc,dr)=>{
   const geo=await page.evaluate(([k,g])=>{
    const pg=document.getElementById('reportContent'),grid=pg.querySelector('.rp-blocks');
    const el=pg.querySelector(`[data-rp-block="${CSS.escape(k)}"]`);
    const gp=el&&el.querySelector(`[data-rp-grip="${g}"]`);
    if(!gp)return null;
    const r=gp.getBoundingClientRect();
    const gcs=getComputedStyle(grid),gr=grid.getBoundingClientRect();
    const sc=Number(getComputedStyle(pg).getPropertyValue('--rp-scale'))||1;
    const cols=Number(gcs.getPropertyValue('--rp-grid'))||24;
    const gapX=parseFloat(gcs.columnGap)||0;
    const cw=(((gr.width/sc)-gapX*(cols-1))/cols+gapX)*sc;
    const rh=((parseFloat(gcs.gridAutoRows)||0)+(parseFloat(gcs.rowGap)||0))*sc;
    const x=Math.round(r.left+r.width/2);
    const lo=Math.max(r.top+2,4),hi=Math.min(r.bottom-2,window.innerHeight-4);
    if(!(hi>lo))return null;
    /* **本当にその縁が掴めるところを探す**——背の低い塊では、辺の縁の
       まん中が**角の縁**（`br`／`tr`）に覆われる（実測: 3行の塊で
       `elementFromPoint`が`rp-size-br`を返した）。覆われたまま引くと
       「引いたのに何も変わらない」としか出ず、**直っていても落ちる網**に
       なる。上から順に当たる点を探す。 */
    let y=null;
    for(let t=0;t<=1.0001;t+=0.05){
     const cand=Math.round(lo+(hi-lo)*t);
     if(document.elementFromPoint(x,cand)===gp){y=cand;break}
    }
    if(y===null)return null;
    return {x,y,cw,rh,当:true};
   },[key,kind]);
   if(!geo){lastGeo={掴めない:key+'/'+kind};return false}
   lastGeo=geo;
   await page.mouse.move(geo.x,geo.y);
   await page.mouse.down();
   await page.mouse.move(geo.x+geo.cw*dc,geo.y+geo.rh*dr,{steps:6});
   await page.mouse.up();
   await settle(page);
   return true;
  };
  const savedWidths=async()=>{
   const j=await getj('/api/column-layout-master?target='+encodeURIComponent(TARGET));
   return (j&&j.widths)||{};
  };

  /* ---------- ① 往復が速いときは今までどおり保存される（前提の確認） ---------- */
  const s0=await savedWidths();
  const a0=await spotOf(A);
  await gripDrag(A,'r',-2,0);
  /* 間引き（400ms）のあと保存が飛んで戻るまで。静かさは間引きより長く取る。 */
  await idle(800);
  const a1=await spotOf(A);
  const w1=await savedWidths();
  rec('前提: ふつうに縁を引けば大きさがマスタへ入る',
      !!a0&&!!a1&&a1.span!==a0.span&&w1[A]!==s0[A],
      JSON.stringify({前:a0,後:a1,保存前:s0[A],保存後:w1[A]}));

  /* ---------- ② 保存の往復中に別の塊を触っても消えない（§9.312） ----------
     **遅らせるのは応答だけ**（共有にマスタを置いた端末では実測で数秒・
     §9.273）。手元にマスタがある検証環境では往復が一瞬で終わるので、
     遅らせないとこの道を**一度も通らないまま通る**。 */
  let slow=true;
  await page.route('**/api/column-layout-master',async route=>{
   if(slow&&route.request().method()==='POST'){await new Promise(r=>setTimeout(r,2200))}
   await route.continue();
  });
  const s1=await savedWidths();
  const b0=await spotOf(C1);
  /* 1つ目を引く→400msで保存が飛ぶ→**その往復のあいだに**2つ目を引く。 */
  {const n0=posts; await gripDrag(A,'r',-1,0); await posted(n0);}  /* 保存#1が飛ぶところまで待つ */
  await gripDrag(C1,'r',-2,0);                                      /* 保存#1の往復中に触る */
  const b1=await spotOf(C1);
  rec('前提: 往復中に触ったぶんは画面には出ている',
      !!b0&&!!b1&&b1.span!==b0.span,JSON.stringify({前:b0,後:b1,掴み:lastGeo}));
  /* 往復が終わって、追いかけの保存も落ち着くまで待つ。遅らせた往復（2.2秒）が
     2回続くので、**取得中が0のまま1秒静か**を条件にする（間引きの400msより長い）。 */
  await idle(1000,15000);
  slow=false;
  const w2=await savedWidths();
  rec('保存の往復中に触ったぶんもマスタへ入る（§9.312）',
      w2[C1]!==s1[C1]&&w2[A]!==s1[A],
      JSON.stringify({保存前:{A:s1[A],C1:s1[C1]},保存後:{A:w2[A],C1:w2[C1]}}));
  /* ---------- 巻き戻りは「次に別の塊を触ったとき」に出る ----------
     `discard()`はデータだけを捨てるので、その瞬間は画面が変わらない。
     利用者が次に**別の塊**を触ると`rpRepaint()`が走り、そこで初めて
     さっき触った塊が元の大きさへ戻る——これが報告された
     「サイズ変更した際にその近くにある帳票ブロックのサイズも一緒に
     変更される」の見え方。**本物の操作で確かめること**（`stage()`を
     直に呼ぶ網は描き直しを起こさないので、巻き戻っていても通る）。 */
  await gripDrag(A,'r',-1,0);
  const b2=await spotOf(C1);
  rec('別の塊を触っても、さっき触った塊の大きさが巻き戻らない',
      !!b1&&!!b2&&b2.span===b1.span&&b2.col===b1.col,
      JSON.stringify({直後:b1,別の塊を触った後:b2}));

  rec('画面のJSで例外が出ていない',errs.length===0,errs.join(' / '));
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }finally{
  await cleanup();
 }
}, {viewport:{width:1700,height:1000}});
