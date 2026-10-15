/* test_strictreorder.js: 設備作業者＋現場段取り可の端末は、厳密モードの設備でも並べ替えられる（§9.606・利用者の報告）
   ============================================================
   「設備作業者で段取り可の状態で厳密モードの時、並び替えができない不具合が発生しています。
    設備作業者でも段取り可能にしていれば厳密モードであっても並び替えは可能でそうでないと
    ロットの開始ボタンが押せなくなり困ってしまいます。」

   物差し（同じ条件で直す前と後を測る）:
    M1. 行を掴めるか（`draggable`の行の数 > 0）
    M2. 実際に並べ替えられるか（Alt+↓で POST /plan/reorder が 200・一番上が入れ替わる）
    M4. 「この設備を並べ替えてよいか」の画面の答え（`WL.fieldReorderAllows`）とサーバーの答え
        （`field_reorder_equipment_allows`）が食い違う組の数（対象設備の書き方×設備名の綴り）→ 0
    M5. 並べ替えできない端末で、鍵の付いた「開始」の説明が「並べ替えてください」と**できないこと**を
        言う数 → 0（できない理由と直す場所を言う）
   条件: 権限マスタのこの端末の行を「設備作業者・編集可・スケジュール不可・現場段取り可・対象設備＝テスト設備A」、
   テスト設備A の運用モードを「厳密」。どちらも触る前の値を控えて戻す。
   ============================================================ */
'use strict';
const H=require('./lib/harness.js');
const {run}=H;
const {execFileSync}=require('child_process');
const EQ='テスト設備A';
/* M4 の組（対象設備, 設備名）。全角・半角、大文字・小文字、空白、読点、すべての設備。 */
const CASES=[['LS4','LS4'],['ＬＳ４','LS4'],['LS4','ＬＳ４'],['ls4','LS4'],[' LS4 , LS5','LS5'],['LS4、LS5','LS5'],
 ['*','LS4'],['','LS4'],['LS-4','LS－4'],['ｽﾘｯﾀｰ1','スリッター1'],['テスト設備Ａ','テスト設備A'],['LS4','LS5']];
const serverAnswers=()=>JSON.parse(execFileSync('python3',['-c',`
import json,sys
sys.path.insert(0,'.')
from backend.repositories.master_repo import field_reorder_equipment_allows as f
print(json.dumps([f(a,b) for a,b in json.loads(sys.argv[1])]))
`,JSON.stringify(CASES)],{cwd:__dirname+'/..',encoding:'utf-8'}));

/* この端末の権限の行を読み書きする（名乗りはランナーが環境変数で渡す・§9.370）。 */
const perm=(sets)=>JSON.parse(execFileSync('python3',['-c',`
import json,os,sqlite3,sys
cols=['編集可否','スケジュール可否','現場段取り可否','現場段取り対象設備','権限区分']
with sqlite3.connect('db/master.sqlite3') as c:
    w=(os.environ['WAVELOG_FIXTURE_LOGIN'],os.environ['WAVELOG_FIXTURE_PC'])
    old=c.execute('SELECT '+','.join('['+k+']' for k in cols)+' FROM [アクセス権限マスタ] WHERE [ログインID]=? AND [PC名]=?',w).fetchone()
    if old is None: sys.exit('この端末の行がありません')
    s=json.loads(sys.argv[1])
    for k,v in s.items():
        c.execute('UPDATE [アクセス権限マスタ] SET ['+k+']=? WHERE [ログインID]=? AND [PC名]=?',(v,)+w)
    c.commit()
print(json.dumps(dict(zip(cols,old)),ensure_ascii=False))
`,JSON.stringify(sets||{})],{cwd:__dirname+'/..',encoding:'utf-8'}));

run('test_strictreorder: 設備作業者＋現場段取りは厳密モードでも並べ替えられる（§9.606）', async ({page,rec,B,W,idle})=>{
 const before=perm({});
 let eqRow=null;
 const post=(p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(a.b)});
  let j={};try{j=await r.json()}catch(e){j={}}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 const setRunMode=mode=>post('/api/equipment-master/update',{id:eqRow.id,name:eqRow.name,kind:eqRow.kind,maxStrips:eqRow.maxStrips,
   standardMinutes:eqRow.standardMinutes,maxLineSpeed:eqRow.maxLineSpeed,runMode:mode});
 let oldMode='';
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.booted(page);
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  /* 運用モードは書ける間（いまの権限）に厳密へ。 */
  await post('/api/access-mode',{mode:'edit'});
  eqRow=((await page.evaluate(async()=>(await fetch('/api/equipment-master')).json())).items||[]).find(x=>x.name===EQ);
  oldMode=eqRow&&eqRow.runMode||'';
  const rm=await setRunMode('厳密');
  rec('前提: テスト設備A を厳密モードにできた',rm.status===200,JSON.stringify(rm.body).slice(0,120));
  perm({'権限区分':'設備作業者','編集可否':1,'スケジュール可否':0,'現場段取り可否':1,'現場段取り対象設備':EQ});
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);
  const am=await page.evaluate(async()=>(await fetch('/api/access-mode')).json());
  rec('前提: 端末は設備作業者・編集可能モード・現場段取り可',am.mode==='edit'&&am.canFieldReorder&&am.role==='設備作業者',
    JSON.stringify({mode:am.mode,role:am.role,fr:am.canFieldReorder,eq:am.fieldReorderEquipment}));
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:20000});
  await idle();
  const rows=()=>page.$$eval('.sc-row-line',n=>n.filter(x=>!/^actual:/.test(x.dataset.id||''))
    .map(x=>({id:x.dataset.id,drag:x.draggable})));
  const r0=await rows();
  const draggable=r0.filter(x=>x.drag);
  rec('M1. 厳密モードでも行を掴める',draggable.length>1,`掴める行 ${draggable.length}/${r0.length}`);
  if(draggable.length>1){
   const first=draggable[0].id;
   const done=page.waitForResponse(r=>r.url().includes('/plan/reorder'),{timeout:20000}).catch(()=>null);
   await (await page.$(`.sc-row-line[data-id="${first}"]`)).focus();
   await page.keyboard.down('Alt');await page.keyboard.press('ArrowDown');await page.keyboard.up('Alt');
   const res=await done;await idle(400,6000);
   const after=(await rows()).filter(x=>x.drag).map(x=>x.id);
   rec('M2. 実際に並べ替えられる',!!res&&res.status()===200&&after[0]!==first,
     `応答 ${res&&res.status()} 前 ${first} 後 ${after[0]}`);
   /* 戻しておく（ほかの網の並びを変えない） */
   const back=page.waitForResponse(r=>r.url().includes('/plan/reorder'),{timeout:20000}).catch(()=>null);
   await (await page.$(`.sc-row-line[data-id="${first}"]`)).focus();
   await page.keyboard.down('Alt');await page.keyboard.press('ArrowUp');await page.keyboard.up('Alt');
   await back;await idle(400,6000);
  }
  /* M4: 画面とサーバーの答えの食い違い */
  const srv=serverAnswers();
  const scr=await page.evaluate(c=>c.map(([a,b])=>WL.fieldReorderAllows(a,b)),CASES);
  const diff=CASES.filter((c,i)=>srv[i]!==scr[i]).map(c=>c.join('→'));
  rec('M4. 並べ替えてよいかの答えが画面とサーバーで食い違わない',diff.length===0,`食い違い ${diff.length}件 ${diff.join(' / ')}`);

  /* M5: 対象設備が未設定の端末（段取り可のまま）。鍵の「開始」の説明が何を言うか */
  perm({'現場段取り対象設備':''});
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:20000});
  await idle();
  const locked=await page.$$eval('.sc-row-start.is-locked',n=>n.map(x=>x.title));
  const tellsImpossible=locked.filter(t=>/並べ替えてください/.test(t)&&!/この端末は並べ替えできません/.test(t)).length;
  rec('M5. 並べ替えできない端末に「並べ替えてください」と言わない（理由と直す場所を言う）',
    locked.length>0&&tellsImpossible===0&&locked.every(t=>/対象設備/.test(t)),
    `鍵の開始 ${locked.length}本・できないことを言う ${tellsImpossible}本・例「${(locked[0]||'').slice(0,90)}」`);
 }finally{
  perm(before);
  if(eqRow){await post('/api/access-mode',{mode:'edit'});await setRunMode(oldMode)}
 }
});
