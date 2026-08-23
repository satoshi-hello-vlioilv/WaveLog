/* test_opunit.js: 自動で入る値の見せ方・単位の置き場・出どころの添え書き（§9.233）
   ================================================================
   利用者の指示（2①②③④⑤）:
     ①「自動で入る値についても、選んで設定できるようにしてください」
     ②「自動で入る値の場合、単位設定や外観変更などしても変更が効かないものが
        多いです。不具合修正してください」
     ③「追加したばかりの『母材』のところだけ、単位を内部に入れ込んで設定した
        ときにデータ入力を右寄せにすると単位と被ってしまいます」
     ④「単位を設定するときに位置を選べますが、選択したUIによっては、単位の
        位置のずれや単位が出ないということがあるので、間違いなくUIの位置に
        対して指定した位置に出ているか確認して修正してください」
     ⑤「こういった自動の連携内容の補助的な説明文字のONOFFができるように、
        もっとコンパクトにかつ位置も選べるようにしてほしいです」

   ここで固定すること:
    - 自動で入る値（`<output>`）にも選ばせ方が3つある（プルダウン／文字だけ／強調）
    - 単位・寄せ・意匠が`<output>`にも効く（以前は`valueEl()`が拾わず全部落ちていた）
    - 母材の欄で「内部の単位 × 右寄せ」でも値が単位に重ならない
    - **どの入力方法でも**、指定した位置に単位が出る（器を被せた欄では
      「見えている操作面」が基準。以前は外下が器の**上**へ出ていた）
    - 手打ちを許したプルダウンは内部に重ねられない（`<select>`が裏方になる）
    - 出どころの添え書きは1行・置き場3通り・選び直したら消える

   **数や有無だけを見ないこと**——「単位の要素がある」だけでは、器の上に
   出ていても通る。**実寸で位置を突き合わせる**。
   ================================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const post=(p,x)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(x)}).then(async r=>({st:r.status,body:await r.json().catch(()=>({}))}));
const get=p=>fetch(B+p).then(r=>r.json());

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1680,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('dialog',d=>d.accept());
 /* 触った行は**丸ごと控えて丸ごと戻す**（§9.121）——`item_upsert`は全列を
    書くので、1項目だけ送り返すと他の設定が消える。 */
 const backup=[];
 const saveItem=x=>post('/api/operation-item-master/update',{user_id:'tests',
   id:x.id,equipment:x.equipment||'*',group:x.group,name:x.name,type:x.type||'',
   place:x.place,span:x.span,required:!!x.required,enabled:x.enabled!==false,
   widget:x.widget,unit:x.unit||'',note:x.note||'',initial:x.initial||'',
   layout:x.layout||'自動',groupSpan:x.groupSpan||0,dummy:!!x.dummy,noBlank:!!x.noBlank,
   role:x.role||'',look:x.look||null,unitPlace:x.unitPlace,align:x.align,
   valueFormat:x.valueFormat,digits:x.digits,choice:x.choice||'',freeText:!!x.freeText,
   /* **畳みと開く条件も必ず送る**（§9.121／§9.212 ②）——`item_upsert`は
      全列を書くので、送らないと`[群折りたたみ]`が0で上書きされ、**次の
      実行の`test_msteps`が「その他の設定を畳めない」で落ちる**（実際に
      落とした。群の畳みは「1つでも畳むと言えば畳む」なので、1行消しただけで
      群ごと開く）。 */
   fold:!!x.fold,showWhen:x.showWhen||[],
   minFrom:x.minFrom||'',maxFrom:x.maxFrom||'',sourceNote:x.sourceNote||''});
 try{
  await post('/api/access-mode',{mode:'edit'});

  /* ==========================================================
     1) サーバー: 語彙（**画面へ書き写さない**・§9.163）
     ========================================================== */
  const list=await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
  rec('自動で入る値にも選ばせ方がある（①）',
      JSON.stringify((list.widgetFamilies||{}).output||[])==='["プルダウン","文字だけ","強調"]',
      JSON.stringify((list.widgetFamilies||{}).output));
  rec('添え書きの置き場をサーバーが答える（⑤）',
      JSON.stringify(list.sourceNotePlaces||[])==='["欄の下","名前の横","出さない"]',
      JSON.stringify(list.sourceNotePlaces));
  rec('添え書きを持つ項目もサーバーが答える（⑤）',
      (list.sourceNoteKeys||[]).includes('innerDiameter'),
      JSON.stringify(list.sourceNoteKeys));
  /* **手打ちを許すと重ねられない**（④）。規則はサーバーの`unit_in_ok()`が
     1箇所で持ち、画面は一覧を引くだけ。 */
  rec('手打ちのプルダウンは内部に重ねられないとサーバーが言う（④）',
      JSON.stringify(list.unitInFreeTextBlocked||[])==='["プルダウン"]',
      JSON.stringify(list.unitInFreeTextBlocked));
  rec('自動で入る値の3つは内部に重ねられる（②）',
      !(list.unitInBlocked||[]).includes('文字だけ')
      &&!(list.unitInBlocked||[]).includes('強調'),
      JSON.stringify(list.unitInBlocked));

  const items=list.items||[];
  const byKey=k=>items.find(x=>x.builtin===k&&(x.equipment==='*'||x.equipment===EQ));
  const inner=byKey('innerDiameter'),width=byKey('motherOriginalWidth'),
        manual=byKey('motherManual'),coil=byKey('coilStop');
  rec('前提: 触る4つの行がある',!!(inner&&width&&manual&&coil),
      JSON.stringify({inner:!!inner,width:!!width,manual:!!manual,coil:!!coil}));
  if(!(inner&&width&&manual&&coil))throw Error('前提の行が無い');
  /* 控えは**保存値**で持つ（`unitPlace`は「効いている値」なので、
     落ちた状態のまま書き戻すと元の設定が消える）。 */
  [inner,width,manual,coil].forEach(x=>backup.push(
    {...x,unitPlace:x.unitPlaceSaved||x.unitPlace}));

  /* ==========================================================
     2) サーバー: 添え書きの置き場が往復する（⑤）
     ========================================================== */
  await saveItem({...inner,sourceNote:'名前の横'});
  let now=(await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ)))
    .items.find(x=>x.id===inner.id);
  rec('添え書きの置き場が保存できる（⑤）',now&&now.sourceNote==='名前の横',
      now&&now.sourceNote);
  /* **送らなければ今の値を保つ**（§9.212 ②「送った項目だけ書く」）。 */
  await post('/api/operation-item-master/update',
    {user_id:'tests',id:inner.id,name:inner.name,equipment:inner.equipment,
     group:inner.group,type:inner.type||''});
  now=(await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ)))
    .items.find(x=>x.id===inner.id);
  rec('置き場を送らない保存で消えない（⑤・§9.212 ②）',
      now&&now.sourceNote==='名前の横',now&&now.sourceNote);
  /* **知らない値は既定へ**（保存済みの行が「知らない値」になって消えない）。 */
  await saveItem({...inner,sourceNote:'よそ'});
  now=(await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ)))
    .items.find(x=>x.id===inner.id);
  rec('知らない置き場は既定（欄の下）へ落とす（⑤）',
      now&&now.sourceNote==='欄の下',now&&now.sourceNote);

  /* 手打ちを許したプルダウン＋内部 → サーバーが外下左へ落とす（④）。
     **保存値は残す**（手打ちを外したら復活する）。 */
  await saveItem({...coil,widget:'プルダウン',freeText:true,unit:'mm',unitPlace:'内部'});
  now=(await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ)))
    .items.find(x=>x.id===coil.id);
  rec('手打ち＋内部は外下左へ落ちる（④）',
      now&&now.unitPlace==='外下左'&&now.unitPlaceSaved==='内部',
      JSON.stringify(now&&{効:now.unitPlace,保存:now.unitPlaceSaved}));
  await saveItem({...coil,widget:'プルダウン',freeText:false,unit:'mm',unitPlace:'内部'});
  now=(await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ)))
    .items.find(x=>x.id===coil.id);
  rec('手打ちを外すと内部が復活する（④）',now&&now.unitPlace==='内部',
      now&&now.unitPlace);

  /* ==========================================================
     3) 測定画面
     ========================================================== */
  const openMeasure=async()=>{
   await page.goto(B+'/',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('#openSchedule',{timeout:25000});
   await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForSelector('#openSchedule',{timeout:25000});
   await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
   await page.click('#openSchedule');
   await page.waitForSelector('.sc-row-line',{timeout:25000});
   const ok=await page.evaluate(()=>{
    const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
    if(r){r.querySelector('.sc-row-start').click();return true}return false;
   });
   if(!ok)throw Error('開始できる行が無い');
   await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
   await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
   await page.waitForTimeout(700);
  };
  await openMeasure();

  /* いま効いている定義を直に差し替えて割り付け直す。**サーバーの規則を
     迂回してよいのは「置き方」を確かめる場面だけ**——規則そのものは上の
     2)で当てている（判定を2つ持たない・§9.163）。 */
  const setDef=(k,p)=>page.evaluate(([k,p])=>{
   const d=WL.opData.defs().find(x=>x.builtin===k);
   if(!d)return false;
   Object.assign(d,p);
   if(p.widget!==undefined)d.widgetLive=p.widget;
   WL.opData.layout();
   return true;
  },[k,p]);
  /* 見えている操作面（器があれば器）を基準に、単位がどこに在るかを読む。 */
  const where=sel=>page.evaluate(s=>{
   const host=document.querySelector(s);
   if(!host)return null;
   const num=el=>{const x=el.getBoundingClientRect();
     return {l:Math.round(x.left),r:Math.round(x.right),t:Math.round(x.top),
             b:Math.round(x.bottom),w:Math.round(x.width),h:Math.round(x.height)}};
   const ctl=host.querySelector(':scope>select,:scope>input:not([type=hidden]),:scope>output');
   const box=host.querySelector(':scope>.opf-widget:not(.opf-plain)');
   const uin=host.querySelector(':scope>.opf-unit-in');
   const ul=host.querySelector(':scope>.opf-unit-line');
   const shown=box||ctl;
   let at='なし';
   if(uin)at='内部';
   else if(ul&&shown){
    const a=ul.getBoundingClientRect(),c=shown.getBoundingClientRect();
    if(!a.height&&!c.height)at='測れず';
    else at=(a.bottom<=c.top+2?'上':(a.top>=c.bottom-2?'下':'重'))+(ul.dataset.at||'');
   }
   const cs=ctl?getComputedStyle(ctl):null;
   /* 値の右端＝欄の右端 − 右余白 − 罫線。ここが単位の左端より右なら重なる。 */
   const right=ctl?Math.round(ctl.getBoundingClientRect().right
     -parseFloat(cs.paddingRight)-parseFloat(cs.borderRightWidth)):null;
   return {位置:at,欄:ctl?num(ctl):null,器:box?num(box):null,
     単位:(uin||ul)?num(uin||ul):null,値の右端:right,
     寄せ:cs?cs.textAlign:null,並び:cs?cs.justifyContent:null,
     枠:cs?cs.borderTopColor:null,文字:cs?cs.fontSize:null,高さ:cs?cs.height:null,
     見出し:cs?null:null,
     opout:host.dataset.opout||'',opunit:host.dataset.opunit||'',
     意匠:[...host.classList].filter(c=>/^opf-[crz]-/.test(c)).join(' ')};
  },sel);

  /* ---------- ④ 入力方法 × 単位の位置 ---------- */
  await page.evaluate(()=>WL.measureSteps.go(1));
  await page.waitForTimeout(500);
  const want={'外上左':'上左','外上中央':'上中央','外上右':'上右',
              '内部':'内部','外下左':'下左','外下中央':'下中央','外下右':'下右',
              '出さない':'なし'};
  /* 器を被せない（プルダウン）・被せる（セグメント／ボタン群／一覧）を混ぜる
     ——以前は器が後から末尾へ足されるせいで、**外下が器の上へ**出ていた。 */
  for(const w of ['プルダウン','セグメント','ボタン群','一覧']){
   const bad=[];
   for(const pl of Object.keys(want)){
    await setDef('coilStop',{unit:'mm',unitPlace:pl,widget:w,freeText:false});
    await page.waitForTimeout(160);
    const r=await where('[data-f="coilStop"]');
    if(!r||r.位置!==want[pl])bad.push(pl+'→'+(r?r.位置:'?'));
   }
   rec('「'+w+'」でも単位が指定どおりの位置に出る（④）',bad.length===0,bad.join(' '));
  }

  /* ---------- ③ 母材: 内部の単位 × 右寄せ ---------- */
  await page.evaluate(()=>WL.measureSteps.go(2));
  await page.waitForTimeout(600);
  await setDef('motherManual',{unit:'mm',unitPlace:'内部',align:'右'});
  await page.waitForTimeout(250);
  await page.evaluate(()=>{const i=document.getElementById('motherManual');if(i)i.value='1234.5'});
  const m=await where('[data-f="motherManual"]');
  rec('前提: 母材の欄に内部の単位が出ている（③）',
      !!(m&&m.位置==='内部'&&m.単位&&m.単位.w>0),JSON.stringify(m&&{位:m.位置,単:m.単位}));
  rec('母材で右寄せにしても値が単位に重ならない（③）',
      !!(m&&m.単位&&m.値の右端!=null&&m.単位.l>=m.値の右端),
      JSON.stringify(m&&{値の右端:m.値の右端,単位の左端:m.単位&&m.単位.l,寄せ:m.寄せ}));
  rec('単位と値は同じ段に出る（③）',
      !!(m&&m.単位&&m.欄&&Math.abs((m.単位.t+m.単位.h/2)-(m.欄.t+m.欄.h/2))<=3),
      JSON.stringify(m&&{欄:m.欄,単位:m.単位}));

  /* ---------- ①② 自動で入る値 ---------- */
  const base=await where('[data-f="motherOriginalWidth"]');
  rec('前提: 元幅（実績）は自動で入る値（`<output>`）',
      !!(base&&base.欄&&base.欄.h>0),JSON.stringify(base&&base.欄));
  await setDef('motherOriginalWidth',{unit:'mm',unitPlace:'内部',align:'右',
    widget:'強調',look:{color:'赤',shape:'大きめ',size:'大'}});
  await page.waitForTimeout(250);
  const strong=await where('[data-f="motherOriginalWidth"]');
  rec('自動で入る値にも単位が出る（②）',
      !!(strong&&strong.位置==='内部'&&strong.単位&&strong.単位.w>0),
      JSON.stringify(strong&&{位:strong.位置,単:strong.単位}));
  rec('自動で入る値の寄せが効く（②）',strong&&strong.並び==='flex-end',
      strong&&strong.並び);
  rec('自動で入る値に意匠（色・形・大きさ）が効く（②）',
      !!(strong&&strong.意匠.includes('opf-c-red')&&strong.意匠.includes('opf-z-lg')
         &&base&&parseFloat(strong.文字)>parseFloat(base.文字)),
      JSON.stringify({意匠:strong&&strong.意匠,前:base&&base.文字,後:strong&&strong.文字}));
  rec('自動で入る値でも値が単位に重ならない（②）',
      !!(strong&&strong.単位&&strong.値の右端!=null&&strong.単位.l>=strong.値の右端),
      JSON.stringify(strong&&{値の右端:strong.値の右端,単位の左端:strong.単位&&strong.単位.l}));
  await setDef('motherOriginalWidth',{unit:'mm',unitPlace:'外下右',align:'中央',
    widget:'文字だけ',look:{}});
  await page.waitForTimeout(250);
  const bare=await where('[data-f="motherOriginalWidth"]');
  rec('選ばせ方「文字だけ」で枠が消える（①）',
      !!(bare&&bare.opout==='文字だけ'&&/rgba\(0, 0, 0, 0\)|transparent/.test(bare.枠)),
      JSON.stringify(bare&&{opout:bare.opout,枠:bare.枠}));
  rec('「文字だけ」でも単位は指定どおり外下右（①②）',
      bare&&bare.位置==='下右',bare&&bare.位置);

  /* ---------- ⑤ 出どころの添え書き ---------- */
  await page.evaluate(()=>WL.measureSteps.go(1));
  await page.waitForTimeout(500);
  const preset=await page.evaluate(()=>{
   /* 仕掛から目標値が来た状態を作る（検証用フィクスチャにこの列は無い）。 */
   S.measure.source=S.measure.source||{};
   S.measure.source['ｺｲﾙ_内径目標']='508';
   S.measure.settings.innerDiameter='-';
   return WL.innerDiameter.apply(S.measure.source);
  });
  rec('前提: 仕掛からの初期値が当たっている（⑤）',preset==='508',String(preset));
  const note=()=>page.evaluate(()=>{
   const n=document.getElementById('innerDiameterFrom');
   const host=document.querySelector('[data-f="innerDiameter"]');
   const nb=host&&host.querySelector(':scope>.opf-name');
   const other=document.querySelector('[data-f="spool"]');
   const cs=n?getComputedStyle(n):null;
   const h=n&&!n.hidden?n.getBoundingClientRect().height:0;
   return {隠:n?n.hidden:null,文:(n&&n.textContent)||'',
     親:n&&n.parentElement?(n.parentElement.className||n.parentElement.tagName):'',
     折返:cs?cs.whiteSpace:null,
     行数:h?+(h/parseFloat(cs.lineHeight)).toFixed(2):0,
     欄の高さ:host?Math.round(host.getBoundingClientRect().height):null,
     隣の高さ:other?Math.round(other.getBoundingClientRect().height):null,
     ヒント:!!(n&&n.title)};
  });
  const seen={};
  for(const at of ['欄の下','名前の横','出さない']){
   await setDef('innerDiameter',{sourceNote:at,widget:'プルダウン'});
   await page.waitForTimeout(220);
   seen[at]=await note();
  }
  rec('「欄の下」は欄の下に1行で出る（⑤）',
      !!(seen['欄の下'].隠===false&&seen['欄の下'].行数<=1.05
         &&seen['欄の下'].折返==='nowrap'),JSON.stringify(seen['欄の下']));
  rec('コンパクトになった（「仕掛 508」）（⑤）',
      seen['欄の下'].文==='仕掛 508',seen['欄の下'].文);
  rec('「名前の横」は名前の器の中へ入り、行を増やさない（⑤）',
      !!(seen['名前の横'].隠===false
         &&/opf-name/.test(seen['名前の横'].親)
         &&seen['名前の横'].欄の高さ===seen['名前の横'].隣の高さ),
      JSON.stringify(seen['名前の横']));
  rec('「欄の下」は1行ぶん背が高くなる（置き場が実際に効いている）（⑤）',
      seen['欄の下'].欄の高さ>seen['名前の横'].欄の高さ,
      JSON.stringify({下:seen['欄の下'].欄の高さ,横:seen['名前の横'].欄の高さ}));
  rec('「出さない」で消える（出どころはツールチップに残る）（⑤）',
      seen['出さない'].隠===true&&seen['出さない'].欄の高さ===seen['名前の横'].欄の高さ,
      JSON.stringify(seen['出さない']));
  /* **選び直したら消える**——「仕掛から来た値」でなくなるので（§9.204）。 */
  await setDef('innerDiameter',{sourceNote:'欄の下',widget:'プルダウン'});
  await page.evaluate(()=>{
   const el=document.getElementById('innerDiameter');
   if(![...el.options].some(o=>o.value==='400'))el.add(new Option('400','400'));
   el.value='400';WL.innerDiameter.refresh();
  });
  await page.waitForTimeout(200);
  rec('選び直すと添え書きは消える（⑤）',(await note()).隠===true);

  console.log('\n合計 '+R.filter(r=>r.ok).length+'/'+R.length+' PASS'
    +'  (FAIL: '+R.filter(r=>!r.ok).length+')');
  process.exitCode=R.some(r=>!r.ok)?1:0;
 }catch(e){
  console.log('FATAL: '+(e&&e.message));process.exitCode=1;
 }finally{
  for(const x of backup){try{await saveItem(x)}catch(e){}}
  if(b)await b.close();
 }
})();
