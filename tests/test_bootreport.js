/* test_bootreport.js: 起動の状況をアプリから取れる（§9.316）

   ============================================================
   ここで固定すること
   ------------------------------------------------------------
    1. `/api/boot-report` が **読むだけ**で1つにまとまって返る
    2. **版は「いま動いているコード」のもの**（/api/build と一致する）
       ——「直したはずの版が実際に動いているか」はここでしか分からない
    3. 置き場は**解決した実際のパス**（設定の綴りではない）
    4. **「在る」だけで済ませない**——0バイトの写しは「読めない」と言う
       （§9.314。隔離されて中身が消える形が実際に起きうる）
    5. 直近の起動1回ぶんのログが入り、区切りが無ければそう書く
    6. 画面は開いた時点で取りに行く（押さないと材料が揃わない、にしない）
    7. 読めない置き場は行そのものが目立つ（§3。文字にも出す）
    8. 「まとめてコピー」は**サーバーが作った文章をそのまま**写す
       （画面で組み立て直すと、貼ってもらった文と実物が食い違いうる）

   4は**材料を自分で注ぎ込む**（§9.291 ①）——健全な端末では写しは読めるので、
   そのまま見ても直す前の実装で通ってしまう。終わったら必ず戻す。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const fs=require('fs');
const B='http://127.0.0.1:5029';
let restore=null;

run('test_bootreport: 起動の状況をアプリから取れる（§9.316）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 /* 注ぎ込んだ写しは落ちても必ず戻す（旧い骨組みの尻尾の .catch が持っていた後片付け） */
 try{

 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openLogView',{timeout:20000});

 const get=u=>page.evaluate(async x=>(await fetch(x)).json(),u);

 // ---- 1. まとまって返る ----
 const d=await get('/api/boot-report');
 rec('起動の状況が1つにまとまって返る',
     d&&d.ok===true&&Array.isArray(d.places)&&Array.isArray(d.records)&&typeof d.text==='string',
     d&&d.text?String(d.text.length)+'文字':JSON.stringify(d).slice(0,80));
 rec('貼れる文章に版・置き場・ログの3つが入る',
     /版\s*:/.test(d.text)&&/置き場（いま見に行っている先）/.test(d.text)&&/直近の起動のログ/.test(d.text));

 // ---- 2. 版は「いま動いているコード」のもの ----
 const build=await get('/api/build');
 rec('版はいま動いているコードのもの（/api/build と一致）',
     !!d.env&&d.env.version===build.version&&new RegExp('VER'+String(build.version).replace(/\./g,'\\.')).test(d.text),
     'report='+(d.env||{}).version+' build='+build.version);
 rec('Python と端末も名乗る（どの実体が動いているか）',
     !!(d.env&&d.env.python&&d.env.pythonVersion&&d.env.pcName!==undefined),
     (d.env||{}).pythonVersion+' / '+((d.env||{}).pcName||''));

 // ---- 3. 置き場は解決した実際のパス ----
 const by=n=>d.places.find(p=>p.label===n);
 const copy=by('待機画面の写し'), root=by('アプリ本体');
 rec('待機画面の写しが解決したパスで出る',
     !!copy&&/[\\/]runtime[\\/]loading\.html$/.test(copy.path),copy&&copy.path);
 rec('アプリ本体の置き場も出る（写しの元がどこか）',!!root&&!!root.path,root&&root.path);
 rec('見に行く先が一通り並ぶ（ログ・進捗・刻印・作業用・local.json・DB）',
     ['ログ','起動の進捗','起動前確認の刻印','作業用フォルダ','config/local.json'].every(by)
     && d.places.some(p=>/^DB: /.test(p.label)),
     d.places.map(p=>p.label).join(' / '));

 // ---- 5. 直近の起動のログ ----
 rec('直近の起動のログが入る',d.records.length>0,d.records.length+'件');
 rec('区切りが見つかったかを言う（見つからなければ末尾と書く）',
     typeof d.bootMarkFound==='boolean'
     && (d.bootMarkFound ? !/末尾を出しています/.test(d.text) : /末尾を出しています/.test(d.text)),
     'bootMarkFound='+d.bootMarkFound);

 // ---- 4. 0バイトの写しを「在る」で済ませない（材料を注ぎ込む） ----
 if(copy&&copy.path&&fs.existsSync(copy.path)){
  const keep=fs.readFileSync(copy.path);
  restore=()=>{try{fs.writeFileSync(copy.path,keep)}catch(e){}};
  fs.writeFileSync(copy.path,'');
  const d2=await get('/api/boot-report');
  const c2=d2.places.find(p=>p.label==='待機画面の写し');
  rec('中身が空の写しは「読めない」と言う（在る、で済ませない）',
      !!c2&&c2.exists===true&&c2.readable===false,
      c2?('exists='+c2.exists+' readable='+c2.readable+' size='+c2.size):'—');
  // **その行を見ること**——文章まるごとで見ると、たまたま別の置き場が
  // 読めないだけで通る（`loading.next.html`は無いのがふつう）。
  const line=(d2.text||'').split('\n').find(l=>/\s待機画面の写し: /.test(l))||'';
  rec('貼れる文章にも「読めない」と出る',/\*\*読めない\*\*/.test(line),line.trim().slice(0,90));

  // ---- 7. 読めない置き場は行そのものが目立つ ----
  await page.click('#openLogView');
  await page.waitForSelector('#logPanel:not([hidden])',{timeout:15000});
  // **待って落ちる形にしない**——自動で取りに行かない実装だと FATAL になって
  // 何が壊れたのか読めない。待ってから、出たかどうかを1件として言う。
  let auto=true;
  try{await page.waitForFunction(()=>document.querySelectorAll('#lgBootBody .lg-boot-table tbody tr').length>0,
                                 null,{timeout:8000})}
  catch(e){auto=false;await page.click('#lgBootRun');
           await page.waitForSelector('#lgBootBody .lg-boot-table tbody tr',{timeout:8000})}
  const ui=await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('#lgBootBody .lg-boot-table tbody tr')];
   // **置き場の名前の欄で選ぶこと**——行まるごとを見ると、備考に同じ語を
   // 持つ別の行（runtime）に当たって何も確かめないまま通る。
   const label=r=>((r.children[1]||{}).textContent||'').trim();
   const hit=rows.find(r=>label(r)==='待機画面の写し');
   return {rows:rows.length,bad:!!(hit&&hit.classList.contains('is-bad')),
           text:hit?hit.textContent.replace(/\s+/g,' ').slice(0,80):'',
           badCount:rows.filter(r=>r.classList.contains('is-bad')).length,
           env:(document.querySelector('#lgBootBody .lg-boot-env')||{}).textContent||''};
  });
  rec('開いた時点で取りに行く（押さなくても材料が揃う）',auto&&ui.rows>1,
      auto?(ui.rows+'行'):'「取得」を押すまで空だった');
  rec('読めない置き場は行が目立つ',ui.bad,ui.text);
  rec('文字でも読める（色だけで伝えない）',/読めない|無い/.test(ui.text),ui.text);
  rec('版は画面にも出る',new RegExp('VER'+String(build.version).replace(/\./g,'\\.')).test(ui.env),ui.env.slice(0,60));

  // ---- 8. コピーはサーバーが作った文章をそのまま ----
  const copied=await page.evaluate(async()=>{
   let got='';
   const orig=navigator.clipboard&&navigator.clipboard.writeText;
   try{Object.defineProperty(navigator,'clipboard',{configurable:true,
     value:{writeText:t=>{got=t;return Promise.resolve()}}})}catch(e){}
   document.getElementById('lgBootCopy').click();
   await new Promise(r=>setTimeout(r,300));
   const want=(WL.logView.bootState&&WL.logView.bootState.last||{}).text||'';
   if(orig){try{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:orig}})}catch(e){}}
   return {got,want};
  });
  rec('「まとめてコピー」はサーバーが作った文章をそのまま写す',
      !!copied.got && copied.got===copied.want,
      'copied='+copied.got.length+' server='+copied.want.length);

  restore();restore=null;
  const d3=await get('/api/boot-report');
  const c3=d3.places.find(p=>p.label==='待機画面の写し');
  rec('戻したら「読める」に戻る（後片付け）',!!c3&&c3.readable===true,
      c3?('readable='+c3.readable+' size='+c3.size):'—');
 }else{
  rec('待機画面の写しを注ぎ込めた',false,'写しが見つかりません: '+(copy&&copy.path));
 }

 }finally{if(restore){restore();restore=null}}
}, {viewport:{width:1600,height:950}});
