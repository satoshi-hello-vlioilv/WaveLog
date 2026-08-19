/* test_measstore.js: 測定データの保存（§9.202）
   ------------------------------------------------------------
   利用者の報告:
    ・「準備に入力したり、データ入力した内容が完了に反映されない。
      『保存して一覧へ』を押すと反映された。仕組みをもう一回教えてほしい」
    ・「測定のバックアップデータを設定する部分がない」
    ・「『DBに同期』の使い方がわからない。バックアップ部分と統合してほしい」

   ここで固定すること:
    1. 置き場は3段（①この端末のブラウザ →②この端末のDB →③閲覧用の複製）で、
       **流れの順に左から右**へ並ぶ
    2. いま何件どこにあるかが数字で出る（数えられなければ「—」。0件と
       言い切らない）
    3. **次にすることを1つだけ**指す
    4. 複製先と間隔をここで設定でき、**共通設定には二重に置かない**
    5. サーバーが状態を答える（/api/measurement/storage）／複製先が
       未設定なら「いま複製する」は理由を返す
    6. 文字が見切れていない
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});

  /* ---- 5) サーバーが状態を答える ---- */
  const st=await page.evaluate(async()=>await api('/api/measurement/storage'));
  rec('サーバーが置き場の状態を答える',
      !!st&&!!st.local&&!!st.export&&Object.prototype.hasOwnProperty.call(st.export,'configured'),
      JSON.stringify({local:Object.keys(st.local||{}),export:Object.keys(st.export||{})}));
  rec('②のパスと件数を答える',
      typeof st.local.path==='string'&&st.local.path.endsWith('.sqlite3')
      &&(st.local.count===null||typeof st.local.count==='number'),
      JSON.stringify({path:st.local.path,count:st.local.count}));
  rec('③の間隔も答える（画面が矢印に書ける）',
      typeof st.export.intervalSec==='number'&&st.export.intervalSec>=30,String(st.export.intervalSec));

  /* 複製先が未設定なら「いま複製する」は**理由を返す**（黙って成功しない）。 */
  if(!st.export.configured){
   const r=await page.evaluate(async()=>{
    try{await api('/api/measurement/backup/export-now',{method:'POST',
      headers:{'Content-Type':'application/json'},body:'{}'});return {ok:true}}
    catch(e){return {ok:false,msg:String(e.message||'')}}
   });
   rec('複製先が無いときは理由を返す',!r.ok&&/設定/.test(r.msg||''),JSON.stringify(r).slice(0,140));
  }else rec('複製先が無いときは理由を返す（この環境は設定済みのため省略）',true,st.export.path);

  /* ---- 画面を開く ---- */
  await page.waitForSelector('#openMasterMaint',{timeout:20000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintForm',{timeout:20000});
  await page.waitForTimeout(1500);
  const tab=await page.$('#masterMaintNav [data-master="measStorage"]');
  rec('「測定データの保存」タブがある',!!tab);
  if(tab){
   await tab.click();
   await page.waitForSelector('.ms-flow',{timeout:20000});
   await page.waitForTimeout(900);
  }

  /* ---- 1) 3段が流れの順に並ぶ ---- */
  const flow=await page.evaluate(()=>{
   const st=[...document.querySelectorAll('.ms-flow .ms-stage')];
   const ar=[...document.querySelectorAll('.ms-flow .ms-arrow')];
   const box=s=>s.getBoundingClientRect();
   return {n:st.length,arrows:ar.length,
     no:st.map(s=>s.querySelector('.ms-no').textContent.trim()),
     title:st.map(s=>s.querySelector('b').textContent.trim()),
     lefts:st.map(s=>Math.round(box(s).left)),
     arrowText:ar.map(a=>a.textContent.replace(/\s+/g,' ').trim())};
  });
  rec('置き場は3段',flow.n===3&&flow.arrows===2,JSON.stringify({n:flow.n,arrows:flow.arrows}));
  rec('①②③の順に並ぶ',flow.no.join('')==='①②③',flow.no.join(''));
  rec('左から右へ流れる',flow.lefts[0]<flow.lefts[1]&&flow.lefts[1]<flow.lefts[2],JSON.stringify(flow.lefts));
  rec('矢印に「いつ動くか」を字で書く',
      /保存のたび/.test(flow.arrowText[0]||'')&&/分ごと|未設定/.test(flow.arrowText[1]||''),
      JSON.stringify(flow.arrowText));
  rec('3段の呼び名が違う（同じ名前を並べない）',new Set(flow.title).size===3,JSON.stringify(flow.title));

  /* ---- 2) 件数が出る（数えられなければ「—」） ---- */
  const kv=await page.evaluate(()=>{
   const out=[];
   document.querySelectorAll('.ms-flow .ms-stage').forEach(s=>{
    const rows=[...s.querySelectorAll('.ms-kv dt')].map((dt,i)=>
      [dt.textContent.trim(),s.querySelectorAll('.ms-kv dd')[i].textContent.trim()]);
    out.push(rows);
   });
   return out;
  });
  rec('①は編集中・完了・未送信の件数を出す',
      kv[0].length===3&&kv[0].every(([,v])=>v==='—'||/件$/.test(v)),JSON.stringify(kv[0]));
  rec('②は件数・最終書込・大きさを出す',kv[1].length===3,JSON.stringify(kv[1]));
  rec('数えられない欄は「—」で、0件と言い切らない',
      kv.flat().every(([,v])=>v!==''&&v!=='null'&&v!=='undefined'),JSON.stringify(kv.flat()).slice(0,180));

  /* ---- 3) 次にすることは1つだけ ---- */
  const next=await page.evaluate(()=>{
   const els=[...document.querySelectorAll('.ms-next')];
   return {n:els.length,text:els.map(x=>x.textContent.replace(/\s+/g,' ').trim()).join(' | ')};
  });
  rec('次にすることを1つだけ指す',next.n===1&&next.text.length>10,next.text.slice(0,120));

  /* ---- 4) 設定はここにあり、共通設定には無い ---- */
  const cfg=await page.evaluate(()=>({
   path:!!document.querySelector('#msExportPath'),
   interval:!!document.querySelector('#msExportInterval'),
   save:!!document.querySelector('#msSaveCfg'),
   syncBtn:!!document.querySelector('#msSyncNow'),
   exportBtn:!!document.querySelector('#msExportNow'),
  }));
  rec('複製先と間隔をここで設定できる',cfg.path&&cfg.interval&&cfg.save,JSON.stringify(cfg));
  rec('「未送信を今すぐ送る」「いま複製する」がここにある',cfg.syncBtn&&cfg.exportBtn,JSON.stringify(cfg));
  /* 「DBに同期」が何をするのかを画面に書いてある。 */
  const explains=await page.evaluate(()=>document.querySelector('#masterMaintForm').textContent);
  rec('「DBへ同期」が何をするボタンかを書く',/DBへ同期/.test(explains),
      (explains.match(/.{0,30}DBへ同期.{0,40}/)||[''])[0]);
  rec('打っている最中はどこにも入らないことを書く',/保存して一覧へ|保存を押すまで|まだどこにも/.test(explains),'');

  /* 保存できること（空欄でも通る＝複製しない設定） */
  await page.fill('#msExportInterval','300');
  await page.click('#msSaveCfg');
  await page.waitForTimeout(2500);
  const saved=await page.evaluate(async()=>{
   const r=await api('/api/path-config-master');
   return {iv:(r.values||{}).records_backup_export_interval_sec,
           share:(r.values||{}).schedule_share_path};
  });
  rec('間隔を保存できる',String(saved.iv)==='300',JSON.stringify(saved.iv));
  const live=await page.evaluate(async()=>(await api('/api/measurement/storage')).export.intervalSec);
  rec('間隔は再起動なしで効く',live===300,String(live));

  /* 共通設定タブへ移り、複製先の欄が**二重に無い**こと。 */
  await page.click('#masterMaintNav [data-master="pathConfig"]');
  await page.waitForTimeout(1800);
  const pc=await page.evaluate(()=>({
   field:!!document.querySelector('[data-pc-field="records_backup_export_path"]'),
   hint:/測定データの保存/.test(document.querySelector('#masterMaintForm').textContent||''),
  }));
  rec('共通設定に複製先の欄を二重に置かない',!pc.field,String(pc.field));
  rec('共通設定からは移動先を案内する',pc.hint,String(pc.hint));

  /* ---- 6) 見切れていない ---- */
  await page.click('#masterMaintNav [data-master="measStorage"]');
  await page.waitForSelector('.ms-flow',{timeout:20000});
  await page.waitForTimeout(900);
  const clipped=await page.evaluate(()=>{
   const bad=[];
   document.querySelectorAll('#masterMaintForm *').forEach(el=>{
    const r=el.getBoundingClientRect();if(r.width<2||r.height<2)return;
    const s=getComputedStyle(el);
    if(s.textOverflow==='ellipsis')return;
    if(/auto|scroll/.test(s.overflowX)||/auto|scroll/.test(s.overflowY))return;
    const ox=el.scrollWidth-el.clientWidth,oy=el.scrollHeight-el.clientHeight;
    if(ox>1||oy>1)bad.push(((el.className&&el.className.baseVal)||el.className||el.tagName)+':'+ox+'/'+oy);
   });
   return bad.slice(0,8);
  });
  rec('文字が見切れていない',clipped.length===0,clipped.join(' '));

  // 後始末: 間隔を既定へ戻す
  await page.evaluate(async()=>{await api('/api/path-config-master',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({records_backup_export_interval_sec:''})})});

 }catch(e){console.log('FATAL '+e.message);R.push({n:'FATAL',ok:false,d:e.message})}
 finally{
  try{await b.close()}catch(e){}
  const ng=R.filter(x=>!x.ok).length;
  console.log(`\n${R.length-ng}/${R.length} PASS`);
  process.exit(ng?1:0);
 }
})();
