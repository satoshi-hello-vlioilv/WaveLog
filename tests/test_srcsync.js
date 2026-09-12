/* test_srcsync.js: 元データが変わったら予定へ取り込む（§9.375）
   ============================================================
   利用者の指示（⑤）:「スケジュールに組み込まれたデータの更新を行いたいです。
   例えば『出荷日』など変わる可能性がある部分、設計情報と多岐にわたるので、
   変更箇所を検知したら、自動で更新してほしいです（設定で、自動更新と
   確認して更新と切り替えられるようにしたい）」。

   予定の行が持っているのは**入れたときの仕掛データの写し**（`detail`）。
   あとから決まる項目はそこで凍るので、そのうち嘘になる。

   ここで固定すること:
    1. 予定の応答が**設定を運ぶ**（画面が綴りを覚えない・§9.163）
    2. `detail`を渡した更新は**重ねる**。渡さなかった鍵は消えない
    3. 書き換えてよいのは**作業の行だけ**（枠は断る）
    4. 自動: 写しが古い予定は、開いたときに最新へ直り、**黙らない**
    5. 確認: 帯で件数を言い、**押すまで直らない**。押したら直る

   材料は自分で用意し、finally で必ず片付ける（§9.351）。
   待ちは条件で置く（§9.347）。骨組みは`tests/lib/harness.js`。
   ============================================================ */
const {run}=require('./lib/harness.js');
const EQ='テスト設備A';
const STALE='RTSTALE'+process.pid;      // 写しにだけ入れる「古い値」（実行ごとに一意）
const KEEP='RTKEEP'+process.pid;        // 見ていない項目（消えてはいけない）

run('test_srcsync: 元データの変化を予定へ取り込む（§9.375）',
 async({page,rec,B,setMode,idle,W})=>{
  const made=[];
  let savedMode=null;                   // 触る前の設定（finally で戻す）
  const post=(p,body)=>page.evaluate(async a=>{
   const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({user_id:'test-srcsync'},a.b))});
   let j={};try{j=await r.json()}catch(e){j={parseError:String(e)}}
   return {status:r.status,body:j};
  },{p,b:body||{}});
  const planDetailOf=id=>planOf(id).then(r=>r.detail||{}).catch(()=>({}));
  const planOf=id=>page.evaluate(async a=>{
   const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(a.eq));
   const j=await r.json();
   const e=(j.entries||[]).find(x=>String(x.id)===String(a.id));
   return {mode:j.sourceSyncMode||'',detail:(e&&e.detail)||null};
  },{eq:EQ,id});
  const openSchedule=async()=>{
   await page.waitForSelector('#openSchedule',{timeout:25000});
   await page.click('#openSchedule');
   await page.waitForSelector('.sc-board-row',{timeout:25000});
   await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
     .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
   await page.waitForSelector('.sc-row-line',{timeout:30000});
   await idle(400,20000);
  };
  const bootInto = async mode=>{
   await setMode(mode);
   await page.goto(B+'/',{waitUntil:'domcontentloaded'});
   await W.booted(page);
   await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                           localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
   await page.reload({waitUntil:'domcontentloaded'});
   await W.booted(page);
  };
  /* 設定はアプリ全体で1つ（パス設定マスタ）。書けるのは編集モードだけなので
     行き来する。**触る前の値を控える**——戻さないと以降の網が別の既定で走る。 */
  const setSync=async v=>{
   await setMode('edit');
   const r=await post('/api/path-config-master',{schedule_source_sync:v});
   return r.status===200;
  };
  try{
   /* ---- 材料: 仕掛にいるロットと、その「今の値」を1つ取る ---- */
   await bootInto('schedule');
   await openSchedule();
   savedMode=await page.evaluate(async()=>{
    const r=await fetch('/api/path-config-master');const j=await r.json();
    return String((j.values||{}).schedule_source_sync||'');
   });
   const target=await page.evaluate(()=>{
    const A=WL.base.aliases;
    const col=(A.lotNo||[]).find(n=>S.columns.includes(n));
    const hidden=WL.scheduleView.hiddenLotSet()||new Set();
    /* **画面が実際に見る項目**から選ぶ（§9.163。別の並びを網が持たない）。 */
    const keys=(WL.scheduleView.sourceSync().keys||[]).filter(k=>k!=='lotNo');
    for(const r of (S.rows||[])){
     const lot=String(r[col]||'').trim();
     if(!lot||hidden.has(lot))continue;
     for(const k of keys){
      const names=[k,...(A[k]||[])];
      const hit=names.find(n=>String(r[n]===undefined||r[n]===null?'':r[n]).trim()!=='');
      if(hit)return {col,lot,key:k,name:hit,now:String(r[hit]).trim(),keys};
     }
    }
    return {col,lot:'',keys};
   });
   rec('材料: 仕掛に在るロットと、画面が見る項目の「今の値」を取れた',
       !!(target&&target.lot&&target.key),
       `lot=${target&&target.lot} 項目=${target&&target.key}(${target&&target.name})=${target&&target.now} / 見る項目${(target&&target.keys||[]).length}種`);
   if(!target||!target.lot||!target.key)throw new Error('材料を用意できない（仕掛一覧が空か、見る項目が無い）');

   /* ---- 1. 設定は予定の応答が運ぶ ---- */
   const mode0=await page.evaluate(async e=>{
    const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e));
    const j=await r.json();return j.sourceSyncMode;
   },EQ);
   rec('予定の応答が「元データの扱い」を運ぶ',mode0==='auto'||mode0==='confirm',String(mode0));
   const seen=await page.evaluate(()=>WL.scheduleView.sourceSync().mode);
   rec('画面は応答で受け取った値を持つ（綴りを覚えない）',seen===mode0,`画面=${seen} / 応答=${mode0}`);

   /* ---- 2・3. サーバー: 重ねる／作業の行だけ ---- */
   const seed=async()=>{
    const a=await post('/api/schedule/plan/add',{equipment:EQ,kind:'作業',lotNo:target.lot,
      detail:{lotNo:target.lot,[target.key]:STALE,[target.name]:STALE,テスト控え:KEEP}});
    const id=String((a.body&&a.body.id)||'');
    if(id)made.push(id);
    return id;
   };
   const id1=await seed();
   rec('材料（写しが古い予定）を置けた',!!id1,`id=${id1}`);
   const up=await post('/api/schedule/plan/update',{id:id1,detail:{[target.key]:'X1'}});
   const d1=(await planOf(id1)).detail||{};
   rec('detail を渡した更新は通る',up.status===200,JSON.stringify(up.body).slice(0,120));
   rec('渡した鍵だけが変わる',d1[target.key]==='X1',`${target.key}=${d1[target.key]}`);
   rec('渡さなかった鍵は消えない（全置換にしない）',d1['テスト控え']===KEEP,
       `テスト控え=${d1['テスト控え']}`);
   const frame=await post('/api/schedule/plan/add',{equipment:EQ,kind:'枠',
     detail:{frameDate:'2026-09-30',frameShift:'1直'}});
   const fid=String((frame.body&&frame.body.id)||'');
   if(fid)made.push(fid);
   const bad=await post('/api/schedule/plan/update',{id:fid,detail:{[target.key]:'X2'}});
   rec('枠の行は断る（書き換えてよいのは作業の行だけ）',
       bad.status>=400&&String((bad.body||{}).error||'').includes('作業'),
       `${bad.status} ${JSON.stringify(bad.body).slice(0,120)}`);

   /* ---- 4. 自動: 開いたら最新へ直り、黙らない ---- */
   await post('/api/schedule/plan/update',{id:id1,detail:{[target.key]:STALE,[target.name]:STALE}});
   const okAuto=await setSync('auto');
   rec('設定を「自動で更新」にできた',okAuto);
   await bootInto('schedule');
   await openSchedule();
   /* 共有DBへ書けたかは**サーバーに聞くしかない**ので、答えが変わるまで
      聞き直す。**`page.waitForFunction`では測れない**——あれは述語が返した
      Promiseを待たず、Promiseそのものを「真」と読んで即座に抜ける（§9.376）。
      待つのは条件であって時間ではないので、直ったらその場で抜ける。 */
   const fixed=await W.poll(()=>planDetailOf(id1),
     d=>String((d||{})[target.key]||'')===target.now,30000,400)
    .then(d=>String((d||{})[target.key]||'')===target.now);
   const d2=(await planOf(id1)).detail||{};
   rec('自動: 開いたら写しが最新の値へ直る',fixed,
       `${target.key}: ${STALE} -> ${d2[target.key]}（元データ=${target.now}）`);
   rec('自動でも、見ていない項目は消えない',d2['テスト控え']===KEEP,`テスト控え=${d2['テスト控え']}`);
   const told=await page.waitForFunction(()=>[...document.querySelectorAll('#toastArea .toast')]
     .some(x=>(x.textContent||'').includes('最新にしました')),null,{timeout:20000}).then(()=>true,()=>false);
   rec('自動でも黙らない（何件を最新にしたかを言う）',told,
       await page.evaluate(()=>[...document.querySelectorAll('#toastArea .toast')]
         .map(x=>(x.textContent||'').replace(/\s+/g,' ').trim()).join(' ／ ').slice(0,160)));

   /* ---- 5. 確認: 押すまで直らない ---- */
   await post('/api/schedule/plan/update',{id:id1,detail:{[target.key]:STALE,[target.name]:STALE}});
   const okConfirm=await setSync('confirm');
   rec('設定を「確認して更新」にできた',okConfirm);
   await bootInto('schedule');
   await openSchedule();
   const banner=await page.waitForFunction(()=>{
    const b=document.getElementById('scSrcBanner');
    return !!(b&&!b.hidden&&(b.textContent||'').includes('変更あり'));
   },null,{timeout:30000}).then(()=>true,()=>false);
   rec('確認: 件数を言う帯が出る',banner,
       await page.evaluate(()=>{const b=document.getElementById('scSrcBanner');
         return b?(b.textContent||'').replace(/\s+/g,' ').trim().slice(0,140):'(帯が無い)'}));
   const d3=(await planOf(id1)).detail||{};
   rec('確認: 押すまでは直らない',String(d3[target.key]||'')===STALE,`${target.key}=${d3[target.key]}`);
   await page.click('#scSrcShow');
   await page.waitForSelector('.sc-src-table tbody tr',{timeout:15000});
   const shown=await page.evaluate(()=>{
    const tr=document.querySelector('.sc-src-table tbody tr');
    return tr?[...tr.children].map(td=>(td.textContent||'').trim()):[];
   });
   rec('確認: 旧→新を並べて見せる',shown.length===4&&shown[2]===STALE&&!!shown[3],shown.join(' | '));
   await page.click('#appConfirmOk');
   const applied=await W.poll(()=>planDetailOf(id1),
     d=>String((d||{})[target.key]||'')===target.now,30000,400)
    .then(d=>String((d||{})[target.key]||'')===target.now);
   rec('確認: 「取り込む」で最新へ直る',applied,
       `${target.key}=${((await planOf(id1)).detail||{})[target.key]}`);
   const gone=await page.evaluate(()=>{
    const b=document.getElementById('scSrcBanner');return !!(b&&b.hidden);
   });
   rec('確認: 取り込んだら帯は消える',gone);
  }finally{
   /* **消すのが先**——予定の書込は schedule モードでしか通らない
      （パス設定の保存は edit モードでしか通らない）。順番を逆にすると
      片付けが黙って弾かれ、置いた予定が次の実行へ残る。 */
   await setMode('schedule').catch(()=>{});
   /* **ロックが空くまで試す**（§4.2。共有への書込ロックは1つ・TTL30秒）。
      直前に画面が書いた（取り込み）ので、そのまま消しに行くと423で弾かれる
      ——弾かれたことに気づかず「消したつもり」になると、置いた予定が
      次の実行へ残る（実測で2件残った）。 */
   const drop=id=>page.evaluate(async a=>{
    const t0=Date.now();let last=null;
    while(Date.now()-t0<25000){
     const r=await fetch('/api/schedule/plan/delete',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({user_id:'test-srcsync',equipment:a.eq,id:a.id})});
     last=r.status;
     if(r.status!==423)return last;
     await new Promise(z=>setTimeout(z,400));
    }
    return last;
   },{eq:EQ,id});
   const dropped=[];
   for(const id of made)if(id)dropped.push(await drop(id).catch(e=>'ERR:'+e.message));
   const after=await page.evaluate(async a=>{
    const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(a.eq)+'&history_hours=8');
    const j=await r.json();
    return (j.entries||[]).filter(x=>a.ids.includes(String(x.id))).length;
   },{eq:EQ,ids:made}).catch(e=>{console.log('残りを数えられない: '+e.message);return -1});
   rec('後片付け: 置いた予定が消えている',after===0,`残り${after}件 / 消した応答=${dropped.join(',')}`);
   /* 設定を触る前へ戻す（触った本が既定を書き換えたままにしない・§9.284）。 */
   await setMode('edit').catch(()=>{});
   if(savedMode!==null)await post('/api/path-config-master',{schedule_source_sync:savedMode}).catch(()=>{});
   const back=await page.evaluate(async()=>{
    const r=await fetch('/api/path-config-master');const j=await r.json();
    return String((j.values||{}).schedule_source_sync||'');
   }).catch(()=>'(読めない)');
   rec('後片付け: 設定を触る前へ戻した',back===savedMode,`${savedMode} -> ${back}`);
  }
 },{mode:'schedule'});
