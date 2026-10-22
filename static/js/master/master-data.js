"use strict";
/* master-data.js: マスタ管理の専用画面——データと接続・作業スケジュール・管理
   ============================================================
   §9.324 R3 で master-maint.js から切り出した（中身はそのまま）。
   データ引継ぎ・
   データ接続（§9.168）・クエリ結合（§9.193）・共通設定（§9.208 ⑨）・
   勤務形態・不要ファイル掃除（§9.249 ①）・テーブル生データ（§9.249 ②）・
   接続状況（§9.272）。
   盤（master-maint.js）から `WL.mm` で受け取り、`registerSpecial` で名乗る。
   換算係数は §9.543 で `master-loadfactor.js` へ移した（散布図・積み上げ・係数の図）。
   ============================================================ */
(function(){
 const {CAPABILITY_LABEL,CAPABILITY_ORDER,CAPABILITY_SHORT,allDefs,bindInputHelpers,bindMaintTabs,bindPathFields,closeMaintEditor,editorMore,ensureMaintEditor,firstVisibleDefKey,fmtDT,hintHtml,listBar,loadMaint,maintState,numFieldHtml,numRaw,openActMenu,pageFoldHtml,pageTabsHtml,paintFootState,renderMaintNav,requireMaintUser,setHeadActs,setMaintLoading,syncNav,tipHtml}=WL.mm;

 /* ---------- 設定型の画面の型（§9.601・ステップ3） ----------
    データ引継ぎ・データ接続・クエリ結合・接続状況・不要ファイル掃除の5画面は（測定データの保存は§9.619で消した）、共通設定と同じ骨組みに載せる:
    頭の行（画面名＋ⓘ＋用途の1行・範囲の札・右に ⋯ と主の操作1つ）→ 頭のすぐ下に全幅の状態の図（どの段を開いても見える）→
    段が2つ以上なら左の段（共通設定と同じ札が状態を名乗る）→ 段の中身（1行＝名前｜値｜状態、または表）→ 段の下端の足元。
    表はステップ2の型（札の行＋見出し＋行・行を押すと直す）。**行ごとに危ない操作を並べない**（窓や行のメニューの ⋯ の先）。
    主役の前に説明の帯を置かない（説明は頭の ⓘ・行の ⓘ）。 */
 function setPageHtml(o){
  const sec=s=>`<div class="mm-set-body">${s.body}</div>${s.foot?`<div class="pc-save mm-set-foot">${s.foot}</div>`:''}`;
  const fig=o.figure?`<div class="mm-set-fig">${o.figure}</div>`:'';
  if(o.secs.length<2)return `${fig}<div class="mm-set-one">${sec(o.secs[0])}</div>`;
  return `${fig}<div class="pc-page is-rail mm-set-page">${pageTabsHtml(o.secs.map(s=>({...s,body:sec(s)})),{scroll:true,rail:true})}</div>`;
 }
 /* 器へ描いて配線する。描き直し（読み直し・保存のあと）でも**開いていた段のまま**（最初の段へ跳ねない）。 */
 function mountSetPage(o){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form)return null;
  const keep=form.dataset.setKey===o.key?(form.dataset.setTab||''):'';
  form.className='mm-form mm-form-page mm-set';form.hidden=false;form.dataset.setKey=o.key;
  form.addEventListener('mm-tab',setTabMemo);
  form.onsubmit=ev=>ev.preventDefault();
  form.innerHTML=setPageHtml(o);
  if(list)list.innerHTML='';
  bindInputHelpers(form);
  if(o.secs.length>1){
   bindMaintTabs(form);
   const i=o.secs.findIndex(s=>s.key===keep);if(i>0)form.__mmShowTab(i);
   o.secs.forEach(s=>setTabState(form,s.key,s.state,s.tone,s.stateTitle));
  }
  WL.popMenu.tips(form);
  return form;
 }
 /* 開いている段を器に控える（読み直しで器が空になっても、描き直したら同じ段を開く）。 */
 function setTabMemo(ev){const p=ev.detail&&ev.detail.panel;if(p&&p.dataset.tabKey)ev.currentTarget.dataset.setTab=p.dataset.tabKey}
 /* 左の段の状態の札（共通設定と同じ・正常は中立の灰・要対応は橙・届かないは赤）。 */
 function setTabState(form,key,state,tone,title){
  const p=form.querySelector(`.mm-tabpanel[data-tab-key="${key}"]`);if(!p)return;
  p.dataset.tabState=state||'';p.dataset.tabStateTone=tone||'';p.dataset.tabBadgeTitle=title||'';
  if(typeof form.__mmPaintTabs==='function')form.__mmPaintTabs();
 }
 const setPanel=(form,key)=>form&&form.querySelector(`.mm-tabpanel[data-tab-key="${key}"]`);
 /* 1行＝名前（＋ⓘ）｜値・欄｜状態（共通設定の`pcKit().row`そのもの）。 */
 const setRow=(label,ctl,o)=>pcKit({}).row((o&&o.key)||'',label,ctl,o);
 const setRowsHtml=rows=>`<div class="pc-rows">${rows.filter(Boolean).join('')}</div>`;
 /* 量の帯（図）: 部分ごとの長さ＋凡例（名前と数を字で・色だけで言わない）。`right`＝右端の HTML（呼ぶ側が逃がす）。 */
 function setBarHtml(parts,right,label){
  return `<div class="mm-set-bar" role="img" aria-label="${esc(label)}"><div class="mm-set-bar-track">${
    parts.map(p=>p.v>0?`<i class="${p.cls}" style="flex:${p.v}" title="${esc(p.name+(p.text?' '+p.text:''))}"></i>`:'').join('')}</div>`
   +`<div class="mm-set-legend">${parts.map(p=>`<span class="mm-set-leg"><i class="${p.cls}" aria-hidden="true"></i>${esc(p.name)}${
    p.text?` <b${p.id?` id="${p.id}"`:''}>${esc(p.text)}</b>`:''}</span>`).join('')}${right?`<small>${right}</small>`:''}</div></div>`;
 }
 /* 表（ステップ2の型）: 列は{label,w,num,tip}、行は{cells,cls,attrs,note,title}。2行目（言うことがあるときだけ）は`note`。 */
 const setEmptyHtml=e=>`<div class="mm-empty is-none"><i class="fa-regular fa-rectangle-list mm-empty-ico" aria-hidden="true"></i>`
  +`<b>${esc((e||{}).title||'まだ1行もありません')}</b>${(e||{}).text?`<span>${esc(e.text)}</span>`:''}</div>`;
 function setTableHtml(cols,rows,empty){
  const tmpl=cols.map(c=>c.w||'minmax(0,1fr)').join(' '),num=i=>cols[i]&&cols[i].num?' class="is-num"':'';
  return `<div class="mm-row head" style="grid-template-columns:${tmpl}">${cols.map(c=>
    `<span class="mm-th${c.num?' is-num':''}"${c.tip?` title="${esc(c.tip)}"`:''}>${c.html||`<b>${esc(c.label)}</b>`}</span>`).join('')}</div>`
   +(rows.length?rows.map(r=>`<div class="mm-row${r.cls?' '+r.cls:''}" style="grid-template-columns:${tmpl}"${r.title?` title="${esc(r.title)}"`:''}${r.attrs||''}>`
     +r.cells.map((c,i)=>`<span${num(i)}>${c}</span>`).join('')+(r.note?`<span class="mm-row-note">${r.note}</span>`:'')+'</div>').join('')
    :setEmptyHtml(empty));
 }
 /* 札の行（`listBar()`・汎用の一覧と同じ部品）＋表を器へ。`tabs`＝[{key,label,n,tone}]（1枚なら押す物ではない）。
    `onRow(id,row)`＝行を押す・Enter（押せる行だけが`data-set-row`を名乗る）。 */
 function fillSetList(el,o){
  if(!el)return;
  const badge=t=>t.n!==''&&t.n!=null?`<i class="mm-ltab-b${t.tone?' is-'+esc(t.tone):''}">${esc(t.n)}</i>`:'';
  const tabsHtml=o.tabs.length<2?`<span class="mm-ltab is-on is-only">${esc(o.tabs[0].label)}${badge(o.tabs[0])}</span>`
   :o.tabs.map(t=>`<button type="button" role="tab" class="mm-ltab${t.key===o.now?' is-on':''}" aria-selected="${t.key===o.now}" data-set-ltab="${esc(t.key)}">${esc(t.label)}${badge(t)}</button>`).join('');
  listBar(el,{key:o.key,label:o.label||'',tabsHtml,findOn:false,note:o.note||'',extraHtml:o.extra||''});
  el.insertAdjacentHTML('beforeend',setTableHtml(o.cols,o.rows,o.empty));
  fitSetCols(el,o.cols);
  if(o.onTab)el.querySelectorAll('[data-set-ltab]').forEach(b=>{b.onclick=()=>o.onTab(b.dataset.setLtab)});
  if(o.onRow)el.querySelectorAll('.mm-row[data-set-row]').forEach(r=>{
   r.onclick=ev=>{if(!ev.target.closest('input,button,a,label'))o.onRow(r.dataset.setRow,r)};
   r.onkeydown=ev=>{if(ev.key==='Enter'&&ev.target===r){ev.preventDefault();o.onRow(r.dataset.setRow,r)}};
  });
 }
 /* `fit:true`の列は中身なりの幅（見出しと全行の中身を測った最大・ステップ2の「列の幅は中身なり」と同じ考え・§9.599）。
    短い値の列が決め打ちの幅で場所を取り、長い道の列が 1536 で切れていた（§9.601）。余りは`fit`でない列が受ける。
    測れない（段が伏せてある）ときは`w`のまま。字の幅は中身の範囲で測る（折り返さない・切れる字も全部の幅）。 */
 function fitSetCols(el,cols){
  if(!cols.some(c=>c.fit))return;
  const rows=[...el.querySelectorAll('.mm-row')],w=cols.map(()=>0);
  rows.forEach(r=>cols.forEach((c,i)=>{
   const cell=c.fit&&r.children[i];if(!cell||cell.classList.contains('mm-row-note'))return;
   const rg=document.createRange();rg.selectNodeContents(cell);
   const st=getComputedStyle(cell),pad=(parseFloat(st.paddingLeft)||0)+(parseFloat(st.paddingRight)||0);
   w[i]=Math.max(w[i],rg.getBoundingClientRect().width+pad);
  }));
  if(!cols.every((c,i)=>!c.fit||w[i]>0))return;
  const tmpl=cols.map((c,i)=>c.fit?`${Math.ceil(w[i])+2}px`:(c.w||'minmax(0,1fr)')).join(' ');
  rows.forEach(r=>{r.style.gridTemplateColumns=tmpl});
 }
 const setRowAttrs=(id,how)=>` data-set-row="${esc(String(id))}" role="button" tabindex="0" title="${esc(how||'押すと直す窓を開きます')}"`;
 /* 足元（共通設定の`.pc-save`と同じ並び）: 左に状態の字、右にボタン。 */
 const setFootHtml=(state,btns,id)=>`<span class="mm-form-hint pc-dirty"${id?` id="${id}"`:''} aria-live="polite">${esc(state)}</span><span class="mm-set-fill"></span>${btns}`;
 const SET_SAVE_BTNS='<button type="button" class="mm-btn-ghost" data-set-cancel>キャンセル</button><button type="button" class="mm-btn-primary" data-set-save>保存</button>';
 /* 保存の足元: 段の中の`[data-set-field]`を描いたときの値と比べ、変えた数を言う（共通設定と同じ`paintFootState`）。
    `save(body)`は欄の値（鍵→字）を受ける。保存の道は画面に1つ（欄ごとに保存しない）。 */
 function wireSetSave(panel,save,saveId){
  if(!panel)return;
  const fields=[...panel.querySelectorAll('[data-set-field]')];
  fields.forEach(f=>{f.dataset.setInit=f.value});
  const foot=panel.querySelector('.mm-set-foot'),st=foot.querySelector('.pc-dirty');
  const cancel=foot.querySelector('[data-set-cancel]'),ok=foot.querySelector('[data-set-save]');
  if(saveId)ok.id=saveId;
  const paint=()=>{const n=fields.filter(f=>f.value!==f.dataset.setInit).length;paintFootState(st,[cancel,ok],false,!!n,n)};
  panel.addEventListener('input',paint);panel.addEventListener('change',paint);
  panel.addEventListener('click',()=>requestAnimationFrame(paint));   // ±（値は欄が持つ）を押したあとに数える
  cancel.onclick=()=>{fields.forEach(f=>{f.value=f.dataset.setInit});paint()};
  ok.onclick=()=>save(Object.fromEntries(fields.map(f=>[f.dataset.setField,String(f.value||'').trim()])));
  paint();
 }
 /* 保存していない変更があるか（離れる前に聞く・`registerSpecial(key,{dirty})`・§9.598）。 */
 const setDirty=()=>[...document.querySelectorAll('#masterMaintForm.mm-set [data-set-field]')]
  .some(f=>f.dataset.setInit!=null&&f.value!==f.dataset.setInit);
 /* 置き場の設定（パス設定マスタ）へ**送った鍵だけ**書く（§9.192）。不要ファイル掃除の足元が使う。 */
 async function savePathSettings(body,done,after){
  try{
   setMaintLoading(true,'保存しています…');
   await api('/api/path-config-master',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...body,user_id:String($('#masterUserId')?.value||'').trim()})});
   pathConfigState.loaded=false;
   showToast&&showToast('保存しました',done,5000);
  }catch(e){showToast&&showToast('保存できませんでした',e.message,7000)}
  finally{setMaintLoading(false);after()}
 }
 /* ---------- データ引継ぎ（PC引継ぎ等でrecords.sqlite3からIndexedDBへ取り込む） ----------
    通常はIndexedDB→records.sqlite3の一方通行だが、PC更新等でIndexedDBが
    空の端末に対しては逆方向の取り込みが必要になる。対象のペイロードは
    codec='json-full-v32'（現行の完全JSONスナップショット）のみをサポートし、
    それ以外(旧形式等)は安全側に倒して「非対応」として選択不可にする。
    既存IDと衝突する場合は上書きになるため、選択状態を可視化した上で
    確認ダイアログを挟んでから実行する。 ---------- */
 let importBackupState={items:[],loaded:false,localIds:new Set(),sel:new Set()};
 async function loadImportBackupMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&importBackupState.loaded){renderImportBackup();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">records.sqlite3を読み込んでいます…</div>';
  try{
   const [backupResult,localItems]=await Promise.all([api('/api/measurement/backup/list'),WL.records.reliableAll().catch(()=>[])]);
   importBackupState.items=(backupResult&&backupResult.items)||[];
   importBackupState.localIds=new Set(localItems.map(x=>x.id));
   importBackupState.sel=new Set();   // 読み直したら選び直す（消えた・取り込んだ行を選んだままにしない）
   importBackupState.loaded=true;
   renderImportBackup();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 /* データ引継ぎ（§9.68 → §9.601）: 頭の下に「取り込むと何が起きるか」の帯（上書き／新しく追加／取り込めない形式）→ 表（札で絞る・
    行を押すか左の印で選ぶ）→ 足元に選んだ件数と結果・「選んだ N件を取り込む」1つ。**バックアップから消すは頭の ⋯ の先**
    （以前は取り込むの隣に赤い大きな「削除」——逆の結果になる取り消せない操作を主の動線に並べていた・§CLAUDE 5）。
    注意の帯（赤）は ⓘ へ、件数の箱は帯と札へ。 */
 const impView={tab:'all'};
 const impOk=it=>it.codec==='json-full-v32';
 function renderImportBackup(){
  const ib=importBackupState,items=ib.items,ok=items.filter(impOk);
  setHeadActs({more:[{label:'読み直す',data:{impAct:'reload'},onClick:()=>loadImportBackupMaint(true)},
   {label:'選んだ記録をバックアップから消す…',danger:true,note:'予定の実績表示からも消えます（この端末のデータは残ります）',data:{impAct:'delete'},onClick:()=>deleteBackupSelection()}]});
  /* 帯の凡例は名前だけ（件数は表の札が言う・同じ数を2か所に出さない）。札の無い「取り込めない形式」だけ数を添える。0件なら帯を出さない。 */
  const ng=items.length-ok.length;
  const fig=items.length?setBarHtml([{cls:'is-old',name:'この端末にも有る（取り込むと上書き）',v:ok.filter(x=>ib.localIds.has(x.id)).length},
    {cls:'is-ok',name:'この端末に無い（新しく追加）',v:ok.filter(x=>!ib.localIds.has(x.id)).length},
    {cls:'is-rest',name:'取り込めない形式',v:ng,text:ng?`${ng}件`:''}],'','バックアップを取り込むと何が起きるか'):'';
  const form=mountSetPage({key:'importBackup',figure:fig,secs:[{key:'list',name:'バックアップ',body:'<div class="mm-list mm-set-list" id="mmImpList"></div>',
   foot:setFootHtml('','<button type="button" id="mmImpRun" class="mm-btn-primary">選んだ記録を取り込む</button>','mmImpPreview')}]});
  if(!form)return;
  impFillList();
  $('#mmImpRun').onclick=()=>runImportBackup();
 }
 function impFillList(){
  const ib=importBackupState,items=ib.items,miss=items.filter(x=>!ib.localIds.has(x.id)),has=items.length-miss.length;
  const shown=impView.tab==='miss'?miss:impView.tab==='has'?items.filter(x=>ib.localIds.has(x.id)):items;
  const list=$('#mmImpList');
  fillSetList(list,{key:'importBackup:'+impView.tab,label:'バックアップ',now:impView.tab,onTab:k=>{impView.tab=k;impFillList()},
   tabs:[{key:'all',label:'すべて',n:`${items.length}件`},{key:'miss',label:'この端末に無い',n:`${miss.length}件`,tone:miss.length?'warn':''},
    {key:'has',label:'この端末にも有る',n:`${has}件`}],
   /* 端末に無い記録は、データ一覧に出ないのに予定の実績突合には効く残骸の候補（§9.52）。なぜかは ⓘ。 */
   note:miss.length?`この端末に無い ${miss.length}件は、予定にだけ「作業中」を出す元になります（消すのは ⋯ から）`:'',
   cols:[{label:'',w:'36px',html:'<input type="checkbox" id="mmImpAll" aria-label="見えている行をすべて選ぶ" title="見えている行（取り込める形式）をすべて選ぶ／外す">'},
    {label:'ロット番号',w:'minmax(120px,1fr)'},{label:'検査番号',w:'minmax(100px,1fr)'},{label:'状態',w:'96px'},{label:'設備',w:'minmax(100px,.8fr)'},
    {label:'更新日時',w:'150px'},{label:'取り込むと',w:'minmax(170px,1.2fr)'}],
   rows:shown.map(it=>{
    const ok=impOk(it),on=ib.localIds.has(it.id),dash='<em class="mm-blank">—</em>';
    return {cls:'mm-imp-row'+(on?'':' is-orphan')+(ok?'':' is-off'),title:ok?'押すと選ぶ／外す':`この形式（${it.codec||'不明'}）は取り込めません`,
     cells:[`<input type="checkbox" data-imp-id="${esc(it.id)}" data-imp-orphan="${on?0:1}"${ib.sel.has(it.id)?' checked':''}${ok?'':' disabled'} aria-label="${esc(it.lotNo||it.id)}を選ぶ">`,
      esc(it.lotNo)||dash,esc(it.inspectionNo)||dash,esc(it.status)||dash,esc(it.equipment)||dash,`<span class="mm-date">${esc(fmtDT(it.updated_at))}</span>`,
      ok?(on?'<span class="mm-set-tag is-warn mm-imp-badge overwrite">上書きされる</span>':'<span class="mm-set-tag mm-imp-badge new">新しく追加</span>')
       :'<span class="mm-set-tag-off mm-imp-badge unsupported">取り込めない形式</span>']};
   }),
   empty:{title:'取り込めるバックアップはありません',
    text:items.length?'この札に当たる記録はありません。':'records.sqlite3 にバックアップがまだありません。ほかの PC で「DBへ同期」すると、ここに並びます。'}});
  /* 選ぶ的は行いっぱい（§9.363）。選んだ記録は札を替えても残る（`ib.sel`）。 */
  const boxes=()=>[...list.querySelectorAll('[data-imp-id]:not(:disabled)')];
  const pick=b=>{if(b.checked)ib.sel.add(b.dataset.impId);else ib.sel.delete(b.dataset.impId)};
  const all=$('#mmImpAll');
  const paintAll=()=>{if(all){const bs=boxes();all.checked=bs.length>0&&bs.every(b=>b.checked);all.disabled=!bs.length}};
  list.querySelectorAll('[data-imp-id]').forEach(b=>b.addEventListener('change',()=>{pick(b);paintAll();updateImportPreview()}));
  if(all)all.onchange=()=>{boxes().forEach(b=>{b.checked=all.checked;pick(b)});updateImportPreview()};
  list.querySelectorAll('.mm-imp-row').forEach(r=>r.addEventListener('click',ev=>{
   if(ev.target.closest('input'))return;
   const b=r.querySelector('[data-imp-id]');if(!b||b.disabled)return;
   b.checked=!b.checked;b.dispatchEvent(new Event('change',{bubbles:true}));
  }));
  paintAll();updateImportPreview();
 }
 /* 選んだ内容で「何がどう変わるか」を押す前に字で言う（§9.68）。取り込みも削除も元に戻せないので、押す前に結果を読めることが要る。 */
 function updateImportPreview(){
  const ib=importBackupState,box=$('#mmImpPreview'),run=$('#mmImpRun');if(!box||!run)return;
  const ids=impSelected(),over=ids.filter(id=>ib.localIds.has(id)).length,add=ids.length-over;
  run.disabled=!ids.length;run.textContent=ids.length?`選んだ ${ids.length}件を取り込む`:'選んだ記録を取り込む';
  run.title=ids.length?'取り込む前に、何が上書きされるかを確かめの窓で言います':'行を選ぶと押せます';
  box.classList.toggle('is-active',!!ids.length);
  box.textContent=ids.length?`${ids.length}件を選択中 — 取り込むと 新しく追加 ${add}件・上書き ${over}件${over?'（元に戻せません）':''}`
   :'選んでいません（行を押すか、左の印で選びます）';
 }
 const impSelected=()=>[...importBackupState.sel].filter(id=>importBackupState.items.some(x=>x.id===id));
/* バックアップ(records.sqlite3)から選択行を削除する(§9.52)。

    端末内データの削除はreliableDelete()がバックアップも消すようになったが、
    それ以前に消したもの・他端末で消したものは残骸として残っている。
    実績突合はこのテーブルを見るため、残骸があるとスケジュールにだけ
    「作業中」が出続ける。ここから明示的に消せるようにする。 */
 async function deleteBackupSelection(){
  const ids=impSelected();
  if(!ids.length){showToast('選択されていません','消す記録を表で選んでから、もう一度押してください。',4000);return}
  const orphan=ids.filter(id=>!importBackupState.localIds.has(id)).length;
  const msg=`バックアップから ${ids.length}件を削除します。`
   +(orphan<ids.length?`\n\nうち ${ids.length-orphan}件はこの端末のデータ一覧にも存在します。削除するとスケジュールの実績表示から消えますが、端末内のデータは残ります。`:'')
   +'\n\nよろしいですか？';
  const ok=await confirmModal({message:msg,confirmLabel:'削除する',danger:true,facts:[{text:'戻せません',danger:true}]});
  if(!ok)return;
  try{
   setMaintLoading(true,`バックアップから ${ids.length}件を削除しています…`);
   const r=await api('/api/measurement/backup/delete',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ids})});
   /* 手元に残す記録は「利用者が共有から外した」と控える（§9.621）——一覧を開いたときの送り直しで戻さない。 */
   for(const id of ids.filter(i=>importBackupState.localIds.has(i))){
    const m=await WL.records.reliableGet(id);
    if(m){m.syncState={...(m.syncState||{}),status:'withdrawn',lastError:''};await WL.records.reliablePut(m)}
   }
   // 実績が変わったので作業スケジュールの予定キャッシュを捨てる
   if(typeof window.invalidateSchedulePlanCache==='function')window.invalidateSchedulePlanCache();
   await loadImportBackupMaint(true);
   showToast('バックアップから削除しました',`${r.deleted}/${r.requested}件`,4600);
  }catch(e){showToast('削除できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }
 async function runImportBackup(){
  const uid=requireMaintUser();if(uid===null)return;
  const checked=impSelected();
  if(!checked.length){showToast&&showToast('取込対象が選択されていません','取込可能な項目にチェックを付けてください。',4000);return}
  const targets=importBackupState.items.filter(it=>checked.includes(it.id));
  const overwriteCount=targets.filter(it=>importBackupState.localIds.has(it.id)).length;
  // 取り消せない操作なので、何がどう変わるかを箇条書きで示してから確認する
  // (確認の窓は`confirmModal`の1つ。§9.342)。
  const okRun=await confirmModal({
   title:'この端末へ取り込みます',
   danger:true,confirmLabel:'取り込む',
   bodyHtml:`<p class="confirm-modal-message">選択した <b>${esc(String(targets.length))}件</b> をこの端末のデータへ取り込みます。</p>
    <ul class="confirm-modal-points">
     <li>新しく追加: <b>${esc(String(targets.length-overwriteCount))}</b>件</li>
     <li>既存データを上書き: <b>${esc(String(overwriteCount))}</b>件${overwriteCount?'（<b>元に戻せません</b>）':''}</li>
     <li>PC更新・端末交換の引継ぎ以外では実行しないでください。</li>
    </ul>`});
  if(!okRun)return;
  let okCount=0,ngCount=0;const errors=[];
  try{
   setMaintLoading(true,`インポートしています… (0/${targets.length})`);
   for(let i=0;i<targets.length;i++){
    const it=targets[i];
    setMaintLoading(true,`インポートしています… (${i+1}/${targets.length})`);
    try{
     const record=WL.measureView.ensureMeasureShape(JSON.parse(it.payload));
     record.id=it.id;
     await WL.records.reliablePut(record);okCount++;
    }catch(e){ngCount++;errors.push(`${it.lotNo||it.id}: ${e.message}`)}
   }
  }finally{setMaintLoading(false)}
  await WL.records.refreshDraftCount();importBackupState.loaded=false;await loadImportBackupMaint(true);
  showToast&&showToast('インポートが完了しました',`成功 ${okCount}件 / 失敗 ${ngCount}件`+(errors.length?`\n${errors.slice(0,3).join('\n')}`:''),8000);
 }
 /* ======================================================================
    データ接続（§9.168。利用者の指示「データソースマスタとパス設定マスタの
    統合／今のUIが使いにくくわかりにくいので再構築」）
    ----------------------------------------------------------------------
    直す前の問題は3つだった。
      ① 同じ「どこを読むか」が2画面に分かれていた（データソースの共有パス・
         出力ファイルと、パス設定の個別上書き）。どちらが効くのかは画面の
         どこにも書いていなかった。
      ② 読み方を決めるのが`sikalot_source`という**全体で1つのスイッチ**
         だけで、「このソースは共有、あのソースはRNE」が表現できなかった。
         RNEの無い端末では、使わない抽出が回り続けて失敗ログだけが残る。
      ③ 保存しても接続先は再起動まで変わらないので、**打ち間違いに
         気づけるのが再起動のあと**だった。
    そこで、
      ・1行＝1カードにして「何か／どこから／何ができるか」を同時に見せる
      ・読み方は行ごとに選ぶ（共有 / RNEから作る / 直接指定）
      ・編集ウィンドウは**スクロールさせない**代わりに大きく取り、
        右半分で「この設定でできること」を**保存する前に**確かめる
    という形にした。 */
 let dsState={items:[],loaded:false,assets:{},editing:null,probe:null,probePath:'',probeSeq:0,probing:false};
 /* 読み方の呼び名は**1箇所**。サーバー（backend/db_access.pyの
    source_read_mode）が返す語をそのまま画面の言葉へ写す。 */
 const DS_MODES=[
  {v:'share',label:'共有フォルダのファイルを読む',
   hint:'ネットワーク共有に置いてある .sqlite3 をそのまま読みます。RNEは要りません。'},
  {v:'rne',label:'この端末でRNEから作って読む',
   hint:'RNE（抽出定義）から .sqlite3 を作り、それを読みます。RNEの資材を置いた端末だけです。'},
  {v:'direct',label:'このファイルを直接読む（検証・一時的な差し替え）',
   hint:'上の2つに関わらず、ここに入れた場所を最優先で読みます。空にすると上の設定へ戻ります。'},
 ];
 const DS_MODE_SHORT={share:'共有フォルダ',rne:'RNEから作る',direct:'直接指定'};
 async function loadDataSourceMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&dsState.loaded){renderDataSource();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const r=await api('/api/data-source-master');
   dsState.items=r.items||[];
   dsState.assets={assetsDir:r.assetsDir||'',confPath:r.confPath||'',confExists:!!r.confExists};
   /* 選べる役割と、いま埋まっている行は**サーバーが答える**(§9.193)。
      「各1件」という決まりを持っているのはあちらなので、画面で数え直さない
      ——無効にした行まで数えて「埋まっている」と言ってしまう。 */
   dsState.purposes=Array.isArray(r.purposes)&&r.purposes.length?r.purposes:['仕掛','品質','実績','スケジュール'];
   /* 既定の突合キー（§9.364）。**語彙はサーバーが持つ**——画面へ写すと
      片方だけ直したときに食い違う。 */
   dsState.purposeHolders=r.purposeHolders||{};
   dsState.loaded=true;
   renderDataSource();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 /* データ接続（§9.168 → §9.601）: ステップ2の表の型。行を押すと直す窓、無効にするは窓の ⋯ の先（行ごとのボタンにしない）。
    「何として使うか」は役割の札、「この設定で何ができるか」は使える所の札（使える所は地のある札・使えない所は薄い字）。
    **どの行でも使えない種類は列に並べず、見出しの ⓘ が名前を言う**（3行とも同じ薄い字が並ぶと読む量だけ増え、道の列が 1536 で切れた）。
    以前は表の前に件数の帯と説明の段落があった——件数は表の札、説明は ⓘ、再起動待ちと仕掛なしは札の行の右の札。 */
 function renderDataSource(){
  setHeadActs({primary:{id:'dsAddBtn',label:'データソースを追加',onClick:()=>openDataSourceEditor(null)},
   more:[{label:'共通設定の置き場へ',note:'共有パス・RNE資材の置き場・間隔',data:{dsAct:'common'},onClick:()=>document.querySelector('#masterMaintNav [data-master="pathConfig"]')?.click()}]});
  const form=mountSetPage({key:'dataSource',secs:[{key:'list',name:'',body:'<div class="mm-list mm-set-list" id="dsList"></div>'}]});
  if(!form)return;
  const items=dsState.items,on=items.filter(x=>x.active),pending=on.filter(dsPending).length,work=on.some(x=>x.purpose==='仕掛');
  const canOf=(x,k)=>{const f=(x.capability||{}).features||{};return !!(f[k]&&f[k].ok)};
  const shown=CAPABILITY_ORDER.filter(k=>items.some(x=>canOf(x,k))),none=CAPABILITY_ORDER.filter(k=>!shown.includes(k));
  const capTip='この設定でできること（地のある札＝使える・薄い字＝使えない）'
   +(none.length?`。どの行でも使えないもの: ${none.map(k=>CAPABILITY_LABEL[k]).join('・')}（使えるデータソースを登録すると列に出ます）`:'');
  fillSetList($('#dsList'),{key:'dataSource',label:'データ接続',tabs:[{key:'list',label:'一覧',n:`${items.length}件`}],
   extra:(work?'':'<span class="mm-set-tag is-warn" title="測定・作業スケジュールへの投入ができません。役割「仕掛」のデータソースを登録してください">仕掛なし</span>')
    +(pending?`<span class="mm-set-tag is-warn" title="名称・読み込み先・一覧に出すかは、サーバーを再起動すると効きます">再起動待ち ${pending}</span>`:''),
   cols:[{label:'役割',w:'96px',fit:true,tip:'このデータを何として使うか。仕掛・品質・スケジュールは各1件です'},{label:'名称',w:'minmax(200px,1.3fr)'},
    {label:'一覧に出す',w:'96px',fit:true,tip:'左メニュー「元データ」に出すかどうか'},{label:'読み方',w:'100px',fit:true},{label:'いま読んでいる',w:'minmax(200px,2fr)'},
    {label:'使える所',w:'minmax(200px,1fr)',fit:true,html:'<b>使える所</b>'+tipHtml(capTip)}],
   rows:items.map(x=>dsRow(x,shown)),empty:{title:'データソースがまだありません',text:'右上の「＋ データソースを追加」から登録します。'},
   onRow:id=>{const x=items.find(i=>String(i.id)===id);if(x)openDataSourceEditor(x)}});
 }
 /* 1行＝1データソース。2行目は**打つ手があるときだけ**（再起動後の読み込み先・名称・読めない理由）。 */
 function dsRow(x,shown){
  const cap=x.capability||{},f=cap.features||{},kinds=dsPendingKinds(x),role=x.purpose||'その他',listed=x.listed!==false;
  const notes=[];
  if(String(x.plannedPath||'')!==String(x.activePath||''))notes.push(`再起動後は ${esc(x.plannedPath||'—')} を読みます`);
  if(x.activeLabel!=null&&String(x.label||'')!==String(x.activeLabel||''))notes.push(`再起動すると名称が「${esc(x.label||'')}」になります（いまは ${esc(x.activeLabel||'—')}）`);
  if(cap.error)notes.push(esc(cap.error));
  const caps=shown.map(k=>{const ok=f[k]&&f[k].ok,t=`${CAPABILITY_LABEL[k]}: ${(f[k]&&f[k].note)||(ok?'使えます':'使えません')}`;
   return ok?`<span class="mm-set-tag" title="${esc(t)}">${esc(CAPABILITY_SHORT[k])}</span>`:`<span class="mm-set-tag-off" title="${esc(t)}">${esc(CAPABILITY_SHORT[k])}</span>`}).join('');
  return {cls:'ds-item'+(x.active?'':' is-off')+(kinds.length?' is-pending':''),attrs:setRowAttrs(x.id,'押すと直す窓を開きます（無効にするは窓の ⋯）'),
   note:notes.join(' ／ '),
   cells:[`<span class="mm-set-tag${role==='仕掛'?' is-teal':''} ds-role">${esc(role)}</span>`,
    `<b class="ds-name" title="${esc(x.label||'')}">${esc(x.label||x.key)}</b> <code class="mm-set-key">${esc(x.key)}</code>`
     +(x.active?'':' <span class="mm-set-tag-off">無効</span>')+(kinds.length?` <span class="mm-set-tag is-warn" title="${esc(kinds.join('・'))}が再起動待ちです">再起動待ち</span>`:''),
    `<span class="ds-listed" title="${listed?'左メニュー「元データ」に出ます':'左メニューには出しません（結合の相手としては読めます）'}">${listed?'出す':'出さない'}</span>`,
    esc(DS_MODE_SHORT[x.readMode]||'—'),
    `<code class="mm-set-path" title="${esc(x.activePath||'')}">${esc(x.activePath||'（この端末ではまだ読んでいません）')}</code>`,
    `<span class="mm-set-tags">${caps||'<span class="mm-set-tag-off">—</span>'}</span>`]};
 }
 /* 保存値と、いま効いている場所が違う＝再起動待ち。**まだ読んでいない
    データソース**（登録したばかり）も待ちに含める（§9.163）。 */
 function dsPending(x){return dsPendingKinds(x).length>0}
 /* 何が再起動待ちなのかを**文字で**返す(§9.183)。以前は読み込み先だけを
    見ていたため、**名称を変えても何も言わなかった**（表示名も接続先と同じく
    起動時に1回だけ決まる）。 */
 function dsPendingKinds(x){
  if(!x.active)return [];
  if(x.loaded===false)return ['この端末ではまだ読んでいません'];
  const out=[];
  if(String(x.plannedPath||'')!==String(x.activePath||''))out.push('読み込み先');
  if(x.activeLabel!=null&&String(x.label||'')!==String(x.activeLabel||''))out.push('名称');
  /* 一覧に出すかどうか(§9.193)も起動時に1回だけ決まる（左メニューの元に
     なるカタログはDBSの写しから作る）。**黙っていると「設定したのに
     消えない」**ので、名称と同じ扱いで再起動待ちに数える。 */
  if(x.activeListed!=null&&(x.listed!==false)!==(x.activeListed!==false))out.push('一覧に出すかどうか');
  return out;
 }
 /* ==================================================================
    クエリ結合(§9.193) — 読んだデータ同士を突合キーでつなぐ
    ------------------------------------------------------------------
    **組み合わせられるのはデータ接続に登録済みのものだけ**（利用者の指示）。
    選択肢はサーバーが返す `sources` から作る——画面で別に一覧を組み立てると、
    無効にしたデータソースが選択肢に残る。

    並びは作業の順番そのもの:「①どの一覧に足すか → ②どこから → ③どうつなぐ
    → ④何を追加 → ⑤結果」。**保存する前に当ててみられる**(下見)のが値打ちで、
    読み込み先は起動時に1回だけ決まるため、これが無いと打ち間違いに気づける
    のが再起動のあとになる（§9.168と同じ作法）。
    ================================================================== */
 /* 用途(§9.365)。**語彙はサーバーが持つ**（§9.163と同じ理由）——画面に
    書くと、増やしたときに片方だけ古い並びを見る。 */
 const QJ_PURPOSE_FINISH='完了突合';
 let qjState={items:[],sources:[],builtin:null,
              purposes:[],purposeDefault:'',finishWhens:[],builtinEnabled:true,kinds:[],kindDefault:'left',
              loaded:false,editing:null,
              cols:{},probe:null,probeSeq:0,probing:false,probeSig:'',
              /* 突合キーを選んでいる最中の状態(§9.197)。`pick`＝1つ目に押した列、
                 `search`＝列名の絞り込み（左右それぞれ）。 */
              pick:null,search:{left:'',right:''}};
 /* 結合の仕方(§9.194)。**説明も動きも「一致した行／左だけ／右だけ」の3つの
    真偽値から作る**——サーバー(query_join.JOIN_KINDS)が答えるものをそのまま
    使い、画面で別の判定を書かない。見本の表も同じ3つから組み立てるので、
    「説明はこう書いてあるのに実際は違う」が原理的に起きない。 */
 const QJ_SAMPLE={
  left:{title:'この一覧',cols:['ロット番号','品名'],rows:[['L001','帯鋼'],['L002','条']]},
  right:{title:'相手',cols:['ロット番号','等級'],rows:[['L001','A'],['L003','B']]}};
 function qjKind(key){
  const list=qjState.kinds||[];
  return list.find(k=>k.key===key)||list.find(k=>k.key===(qjState.kindDefault||'left'))||null;
 }
 function qjPurpose(key){
  const list=qjState.purposes||[];
  return list.find(p=>p.key===(key||''))||list[0]||null;
 }
 /* 2つの円で「どこを残すか」を塗る。**色だけで伝えない**(§3)ので、名前・
    一行説明・見本の表を必ず添える。idは同じ図が2箇所に出ても衝突しないよう
    場所ごとの接頭辞を付ける。 */
 function qjVennHtml(k,scope){
  if(!k)return '';
  const id=x=>`qjv-${scope}-${k.key}-${x}`;
  return `<svg class="qj-venn" viewBox="0 0 100 52" role="img" aria-label="${esc(k.label)}の図">
   <defs>
    <clipPath id="${id('c')}"><circle cx="38" cy="26" r="20"/></clipPath>
    <mask id="${id('ml')}"><rect x="0" y="0" width="100" height="52" fill="#fff"/><circle cx="62" cy="26" r="20" fill="#000"/></mask>
    <mask id="${id('mr')}"><rect x="0" y="0" width="100" height="52" fill="#fff"/><circle cx="38" cy="26" r="20" fill="#000"/></mask>
   </defs>
   ${k.leftOnly?`<circle class="on" cx="38" cy="26" r="20" mask="url(#${id('ml')})"/>`:''}
   ${k.rightOnly?`<circle class="on" cx="62" cy="26" r="20" mask="url(#${id('mr')})"/>`:''}
   ${k.matched?`<circle class="on" cx="62" cy="26" r="20" clip-path="url(#${id('c')})"/>`:''}
   <circle class="ring" cx="38" cy="26" r="20"/><circle class="ring" cx="62" cy="26" r="20"/>
  </svg>`;
 }
 /* 行がどう増減するかを**文字で**言う（図と色だけでは伝わらない）。 */
 function qjRowEffect(k){
  if(!k)return '';
  if(k.matched&&k.leftOnly&&!k.rightOnly)return '行は減らない';
  if(k.rightOnly&&k.leftOnly)return '行が増えることがある';
  if(k.rightOnly&&k.matched)return '行が減り、増えることもある';
  if(k.rightOnly)return 'この一覧の行は残らない';
  return '行が減る';
 }
 /* 結合の見本。左2行・右2行の作り物を、上の3つの真偽値どおりに突き合わせる。 */
 function qjSampleHtml(k){
  if(!k)return '';
  const addCols=k.matched||k.rightOnly;
  const cols=['ロット番号','品名'].concat(addCols?['等級']:[]);
  const rows=[];
  if(k.matched)rows.push(['L001','帯鋼','A']);
  if(k.leftOnly)rows.push(['L002','条','']);
  if(k.rightOnly)rows.push(['L003','','B']);
  const cell=v=>v===''?'<td class="is-blank">（空）</td>':`<td>${esc(v)}</td>`;
  const src=(x)=>`<table class="qj-sample-t"><caption>${esc(x.title)}</caption><thead><tr>${
    x.cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
    x.rows.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return `<div class="qj-sample">
    ${src(QJ_SAMPLE.left)}${src(QJ_SAMPLE.right)}
    <span class="qj-sample-arrow" aria-hidden="true">→</span>
    <table class="qj-sample-t is-result"><caption>結合した結果</caption><thead><tr>${
      cols.slice(0,addCols?3:2).map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
      rows.length?rows.map(r=>`<tr>${r.slice(0,addCols?3:2).map(cell).join('')}</tr>`).join('')
        :'<tr><td class="is-blank" colspan="3">1行も残りません</td></tr>'}</tbody></table>
   </div>`;
 }
 const QJ_MULTI_LABEL={first:'最初の1件を使う',blank:'空にする（どれか決められないので出さない）'};
 /* 用途ごとの言葉（§9.596）。**完了突合は「一覧に列を追加」ではない**——同じ窓を使うので、言い方だけは用途で
    分ける（答えは`qjWord()`の1箇所。画面のあちこちに「完了突合なら」を書かない）。 */
 const QJ_WORDS={
  left:{list:'この一覧（足す先）',finish:'作業スケジュールの予定'},
  right:{list:'相手（持ってくる側）',finish:'実績のデータ'},
  here:{list:'この一覧',finish:'予定のロット'},
  other:{list:'相手',finish:'実績のデータ'},
  nameHint:{list:'一覧の帯と、列の設定パネルの「結合」欄に出ます。',
            finish:'作業スケジュールで「何で完了にしたか」に出ます。'},
  enabledHint:{list:'「無効」にすると列を足しません（設定は残ります）。',
               finish:'「無効」にするとこの突合では完了にしません（設定は残ります）。'},
  keysHint:{list:'すべてのキーが一致した行だけを結び付けます。全角/半角と前後の空白は無視します。',
            finish:'すべてのキーが一致した実績の行に当てます。全角/半角と前後の空白は無視します。予定のロットの値は、**予定へ入れたときの写し → いまの仕掛の行**の順に引きます。'},
  prefixLabel:{list:'足す列の名前に付ける文字',finish:'残す値の名前に付ける文字'},
  prefixHint:{list:'空のままだと、一覧に同じ名前の列があるものは**足しません**（元の一覧の値を残します）。付けると両方を並べられます。',
              finish:'付けると、作業スケジュールの内容欄で仕掛の列と見分けられます。'},
  multiHint:{list:'当たった件数は下の「結果」に出ます。',
             finish:'同じキーの実績が2件以上あるとき。「空にする」なら、そのロットは完了にしません（右の答えに「決められない」と出ます）。'},
  pairWarn:{list:'いま選んでいる表にこの列がありません',
            finish:'この列が無い側があります（予定のロットの値は、予定へ入れたときの写しに無ければ当たりません）'},
  noCols:{list:'相手の列がまだ分かりません。②でデータと表を選んでください。',finish:'実績のデータの列がまだ分かりません。③でデータと表を選んでください。'},
  multiLabel:{list:'相手が2件以上あったら',finish:'実績に同じキーが2件以上あったら'},
  pickAll:{list:'相手の列をすべて',finish:''},
  addHead:{list:'④ 何を追加するか',finish:'④ 予定へ何を残すか'},
  addIntro:{list:'',finish:'当たった実績の行から、**作業スケジュールの予定へ**残す値を選びます。実績のデータが次の更新で消えても、残したぶんは消えません。'},
  footer:{list:'足した列は一覧を開き直すと反映されます（サーバー再起動は要りません）。',
          finish:'保存すると、次に作業スケジュールを開いたとき（と書込役の裏の見回り）から効きます。'}};
 function qjIsFinish(){return qjEdit().purpose===QJ_PURPOSE_FINISH}
 function qjWord(k){return (QJ_WORDS[k]||{})[qjIsFinish()?'finish':'list']||''}
 function qjSourceLabel(key){
  const x=(qjState.sources||[]).find(s=>s.key===key);
  return x?(x.label||x.key):(key||'—');
 }
 /* 完了突合の「足す先」の呼び名（§9.605）。左のデータは仕掛だが、突き合わせるのは作業スケジュールの予定。 */
 const QJ_SCHEDULE_LABEL='作業スケジュールの予定';
 /* 予定へ残す値（§9.605）。鍵は`times`／`some`／`all`、呼び名はサーバーの語彙（`takes`）。 */
 function qjTakeOf(x){
  const v=String(x.take||'');
  if(v==='times'||v==='all'||v==='some')return v;
  return (x.columns||[]).length?'some':'all';
 }
 function qjTakeLabel(x){
  const k=qjTakeOf(x),t=(qjState.takes||[]).find(v=>v.key===k)||{};
  /* 「選んだ列も残す」は数を事実どおりに: 作業時間の列（外せない）＋選んだ列。 */
  return k==='some'?`作業時間の${qjTimeCols(x).length}列＋選んだ${(x.columns||[]).length}列`:(t.label||k);
 }
 /* 作業時間に使う列（外せない・§9.605）。 */
 function qjTimeCols(x){return [x.startColumn,x.finishColumn].filter(Boolean)}
 async function loadQueryJoinMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&qjState.loaded){renderQueryJoin();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const r=await api('/api/query-join-master');
   qjState.items=r.items||[];qjState.sources=r.sources||[];qjState.builtin=r.builtin||null;
   qjState.kinds=r.kinds||[];qjState.kindDefault=r.kindDefault||'left';
   qjState.purposes=r.purposes||[];qjState.purposeDefault=r.purposeDefault||'';
   /* 完了突合の「いつ完了にするか」(§9.595)。語彙と札の中身はサーバーが持つ。 */
   qjState.finishWhens=r.finishWhens||[];
   /* 予定へ残す値（§9.605）と、一覧の結合の相手にできないデータ（設備ごとのファイル）。語彙はサーバー。 */
   qjState.takes=r.takes||[];qjState.patternSources=r.patternSources||[];
   qjState.builtinEnabled=r.builtinEnabled!==false;
   qjState.loaded=true;
   renderQueryJoin();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 /* クエリ結合（§9.193 → §9.601）: ステップ2の表の型。つなぎ方は「足す先 ← 相手」の図（線の上に突合キー・矢印は相手の列が入る向き）。
    行を押すと直す窓、削除は窓の ⋯ の先。既定の結合（保存されていない・自動で効く）は押すと「複製して編集／解除する」のメニュー。
    以前は表の前に件数の帯と説明の段落、行ごとに「編集」「削除」「解除する」が並んでいた。 */
 function renderQueryJoin(){
  const few=(qjState.sources||[]).length<2;
  setHeadActs({primary:few?null:{id:'qjAddBtn',label:'結合を追加',onClick:()=>openQueryJoinEditor(null)},
   more:[{label:'データ接続へ',note:'つなげるデータを登録する画面',data:{qjAct:'source'},onClick:()=>document.querySelector('#masterMaintNav [data-master="dataSource"]')?.click()}]});
  const form=mountSetPage({key:'queryJoin',secs:[{key:'list',name:'',body:'<div class="mm-list mm-set-list" id="qjList"></div>'}]});
  if(!form)return;
  const b=qjState.builtin,rows=(b?[qjBuiltinRow(b)]:[]).concat(qjState.items.map(qjRow));
  fillSetList($('#qjList'),{key:'queryJoin',label:'クエリ結合',tabs:[{key:'list',label:'一覧',n:`${rows.length}件`}],
   note:few?'つなげるデータが足りません（結合にはデータ接続が2件以上要ります）':'',
   cols:[{label:'用途',w:'110px'},{label:'結合名',w:'minmax(160px,1fr)'},{label:'つなぎ方（← は値の向き・線の上は突合キー）',w:'minmax(360px,3fr)'},
    {label:'結合の仕方',w:'110px'},{label:'足す列・残す値',w:'minmax(150px,1fr)'}],
   rows,empty:{title:'結合はまだありません',text:'右上の「＋ 結合を追加」から登録します。'},
   onRow:(id,row)=>{
    if(id==='builtin')return qjBuiltinMenu(row);
    const x=qjState.items.find(i=>String(i.id)===id);if(x)openQueryJoinEditor(x);
   }});
 }
 /* つなぎ方の図: 足す先の札 ← 細い灰の線（上に突合キー）← 相手の札。 */
 const qjJoinHtml=(left,right,keys)=>`<span class="mm-set-join"><span class="mm-set-tag">${esc(left)}</span>`
  +`<span class="mm-set-join-k" title="突合キー: ${esc(keys||'—')}"><em>${esc(keys||'—')}</em><i aria-hidden="true"></i></span><span class="mm-set-tag">${esc(right)}</span></span>`;
 /* 用途の札は`qj-use`（窓の用途の札`.qj-purpose`は縁と地を持つ選ぶ札——同じ名を名乗ると一覧の札にだけ縁が付いた・§9.601）。 */
 function qjRow(x){
  const keys=(x.keys||[]).map(k=>k.left===k.right?k.left:`${k.left}＝${k.right}`).join('・');
  const kind=qjKind(x.kind||qjState.kindDefault),pp=qjPurpose(x.purpose)||{},isFin=pp.key===QJ_PURPOSE_FINISH;
  const missing=[];
  /* 完了突合の行は**作業スケジュールの予定へ**突き合わせる（§9.605）。足す先を仕掛と書かない（仕掛へ列を足すように読める）。 */
  if(!(qjState.sources||[]).some(s=>s.key===x.left))missing.push(isFin?'仕掛':'足す先');
  if(!(qjState.sources||[]).some(s=>s.key===x.right))missing.push('相手');
  return {cls:'qj-item'+(x.active?'':' is-off')+(missing.length?' is-pending':''),attrs:setRowAttrs(x.id,'押すと直す窓を開きます（削除は窓の ⋯）'),
   note:missing.length?`${esc(missing.join('と'))}のデータ接続が見つかりません（無効にした・キーを変えた・再起動していない、のいずれかです）。この結合は当たりません。`
     :(x.issue?`この結合は効いていません: ${esc(x.issue)}`:''),
   cells:[`<span class="mm-set-tag${isFin?' is-teal':''} qj-use" title="${esc(pp.summary||'')}">${esc(pp.short||pp.label||'列を追加')}</span>`
     +(isFin?'':`<small class="mm-set-sub">${x.useInSchedule===false?'一覧だけ':'予定でも使う'}</small>`),
    `<b class="qj-name" title="${esc(x.name)}">${esc(x.name)}</b>${x.prefix?` <code class="mm-set-key" title="足す列の名前に付ける文字">${esc(x.prefix)}…</code>`:''}`
     +(x.active?'':' <span class="mm-set-tag-off">停止中</span>'),
    qjJoinHtml(isFin?QJ_SCHEDULE_LABEL:qjSourceLabel(x.left)+(x.leftTable?` / ${x.leftTable}`:''),qjSourceLabel(x.right)+(x.rightTable?` / ${x.rightTable}`:''),keys),
    `<span title="${esc(isFin?(pp.summary||''):(kind?kind.summary:''))}">${esc(isFin?'当たれば完了':(kind?kind.label:'左外部結合'))}</span>`,
    isFin?esc(qjTakeLabel(x))+(x.startColumn||x.finishColumn?`<small class="mm-set-sub">作業時間: ${esc([x.startColumn,x.finishColumn].filter(Boolean).join(' 〜 '))}</small>`:'')
     :esc((x.columns||[]).length?`${x.columns.length}列を選択`:'相手の全列')]};
 }
 /* 既定の品質データ結合（§9.194）。保存されていないが効いているものは画面に出す（出どころを言う）。解除しても内容は見えたまま。 */
 function qjBuiltinRow(b){
  const on=qjState.builtinEnabled!==false,kind=qjKind(b.kind||qjState.kindDefault);
  return {cls:'qj-item is-builtin'+(on?'':' is-off'),attrs:setRowAttrs('builtin','押すと「複製して編集」「既定を解除する」を選べます'),
   note:on?'':'解除中です。品質データの列は一覧に出ません（エラーにはならず、その列を見ていた設定は静かに落ちます）。品質データは相手として選べるので、自分で結合を登録すれば出せます。',
   cells:['<span class="mm-set-tag qj-use">列を追加</span>',
    `<b class="qj-name">${esc(b.name)}</b> ${on?'<span class="mm-set-tag-off" title="役割「仕掛」と「品質」が揃っているので自動で効いています。同じ相手への結合を登録すると、そちらが優先されます">既定</span>':'<span class="mm-set-tag is-warn">解除中</span>'}`,
    qjJoinHtml(qjSourceLabel(b.left),qjSourceLabel(b.right),(b.keys||[]).map(k=>k.left).join('・')),
    esc(kind?kind.label:'左外部結合'),'相手の全列']};
 }
 function qjBuiltinMenu(row){
  const on=qjState.builtinEnabled!==false;
  openActMenu(row,[{label:'複製して編集…',note:'この設定を下敷きにした結合を新しく作ります',data:{qjAct:'copy'},onClick:()=>openQueryJoinEditor(qjBuiltinDraft(),{copy:true})},
   on?{label:'既定を解除する…',danger:true,note:'品質データの列が一覧に出なくなります（確かめてから）',data:{qjAct:'toggle'},onClick:()=>qjToggleBuiltin(false)}
     :{label:'既定に戻す',data:{qjAct:'toggle'},onClick:()=>qjToggleBuiltin(true)}],'既定の結合');
 }
 /* 既定の結合を下敷きにした「新規の1件」。**IDを持たせない**——上書きでは
    なく複製なので、保存すると普通の登録として1行増える。 */
 function qjBuiltinDraft(){
  const b=qjState.builtin||{};
  return {id:null,name:`${b.name||'品質データ'}（複製）`,
          left:b.left||'',leftTable:b.leftTable||'',right:b.right||'',rightTable:b.rightTable||'',
          keys:(b.keys||[]).map(k=>({left:k.left,right:k.right})),
          columns:[],prefix:'',multi:b.multi||'first',kind:b.kind||qjState.kindDefault,
          purpose:'',finishColumn:'',startColumn:'',finishWhen:'',useInSchedule:true,
          order:(qjState.items.length+1)*10,active:true};
 }
 async function qjToggleBuiltin(on){
  const uid=requireMaintUser();if(uid===null)return;
  if(!on&&!await confirmModal({message:'既定の品質データ結合を解除します。\n品質データの列（鋳造番号・製造材質・検査結果など）は一覧に出なくなります。\nエラーにはならず、その列を見ていた設定は静かに落ちます。よろしいですか？',confirmLabel:'解除する'}))return;
  try{
   setMaintLoading(true,on?'既定に戻しています…':'解除しています…');
   const r=await api('/api/query-join-master/builtin',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:on,user_id:uid})});
   qjState.loaded=false;await loadQueryJoinMaint(true);
   window.invalidateTableCache&&window.invalidateTableCache();
   showToast&&showToast(on?'既定に戻しました':'既定を解除しました',(r&&r.message)||'一覧を開き直すと反映されます',4500);
  }catch(e){showToast&&showToast('切り替えられませんでした',e.message,6000)}
  finally{setMaintLoading(false)}
 }
 async function qjDelete(id){
  const x=qjState.items.find(i=>String(i.id)===String(id));if(!x)return;
  if(!await confirmModal({confirmLabel:'削除する',message:`結合「${x.name}」を削除します。\nこの結合で足していた列は一覧から消えます。よろしいですか？`,danger:true}))return;
  const uid=requireMaintUser();if(uid===null)return;
  try{
   setMaintLoading(true,'削除しています…');
   await api('/api/query-join-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:x.id,user_id:uid})});
   qjState.loaded=false;await loadQueryJoinMaint(true);
   window.invalidateTableCache&&window.invalidateTableCache();
   showToast&&showToast('削除しました','一覧を開き直すと反映されます',4000);
  }catch(e){showToast&&showToast('削除に失敗しました',e.message,5000)}
  finally{setMaintLoading(false)}
 }
 /* 列の名前は**名前だけを引く**(/api/table-columns)。`/api/table`を叩くと
    実データ200列ぶんの行まで運ぶことになる(§9.94)。1度引いたら覚える。 */
 async function qjColumns(db,table){
  const key=db+'\t'+(table||'');
  if(qjState.cols[key])return qjState.cols[key];
  if(!db)return {tables:[],columns:[]};
  try{
   const q=new URLSearchParams({db:db,samples:'1'});if(table)q.set('table',table);
   const r=await api('/api/table-columns?'+q.toString());
   const v={tables:r.tables||[],columns:r.columns||[],table:r.table||'',
            normalized:r.normalized||{},samples:r.samples||{}};
   qjState.cols[key]=v;
   if(!table&&v.table)qjState.cols[db+'\t'+v.table]=v;
   return v;
  }catch(e){
   const v={tables:[],columns:[],normalized:{},samples:{},error:e.message};
   qjState.cols[key]=v;return v;
  }
 }
 function openQueryJoinEditor(item,opts){
  const modal=ensureMaintEditor();
  /* **中身が縦に長いのでスクロールさせる**(§9.197)。データ接続の編集窓は
     「スクロールさせない代わりに大きく取る」(§9.168)ため
     `.is-wide .mm-editor-body{overflow:hidden}`にしてあり、そのままだと
     ここは**下の節（結果の下見）が丸ごと切れて見えなかった**（実機で
     「モーダル内で表示が一部切れている」と指摘）。 */
  const dlg=modal.querySelector('.mm-editor-dialog');
  if(dlg){dlg.classList.add('is-wide');dlg.classList.add('is-tall')}
  const sources=qjState.sources||[];
  const copy=!!(opts&&opts.copy);
  qjState.editing=item?JSON.parse(JSON.stringify(item)):{
   id:null,name:'',left:(sources.find(s=>s.purpose==='仕掛')||sources[0]||{}).key||'',
   leftTable:'',right:(sources.find(s=>s.purpose==='品質')||sources[1]||sources[0]||{}).key||'',
   rightTable:'',keys:[],columns:[],prefix:'',multi:'first',
   kind:qjState.kindDefault||'left',
   purpose:(opts&&opts.purpose)||qjState.purposeDefault||'',
   finishColumn:'',startColumn:'',finishWhen:'',useInSchedule:true,take:'times',
   order:(qjState.items.length+1)*10,active:true};
  if(!qjState.editing.kind)qjState.editing.kind=qjState.kindDefault||'left';
  qjState.probe=null;qjState.probeSig='';
  /* **開くたびに選びかけ・絞り込みを白紙へ**——前に開いた結合の状態が
     残っていると、押していないのに列が選ばれているように見える。 */
  qjState.pick=null;qjState.search={left:'',right:''};
  $('#maintEditorEyebrow').textContent='クエリ結合';
  $('#maintEditorTitle').textContent=copy?'既定の結合を下敷きに作る'
    :(item&&item.id?`${item.name} を編集`:'結合を追加');
  /* 完了突合の左は役割「仕掛」（§9.596）。古い行が別の左を持っていたら、開いた時点で寄せる（保存で直る）。 */
  if(qjState.editing.purpose===QJ_PURPOSE_FINISH){
   const work=sources.find(s=>s.purpose==='仕掛');
   if(work&&qjState.editing.left!==work.key){qjState.editing.left=work.key;qjState.editing.leftTable=''}
  }
  qjState.trial=null;
  $('#maintEditorSave').textContent=(item&&item.id)?'更新を保存':'追加登録';
  $('#maintEditorSave').onclick=()=>saveQueryJoinEditor();
  renderQueryJoinEditor();
  /* 削除は窓の ⋯ の先（§9.601・行ごとのボタンにしない）。保存済みの結合だけ。 */
  editorMore(item&&item.id?[{label:'この結合を削除する…',danger:true,note:'この結合で足していた列は一覧から消えます（確かめてから）',
   data:{qjAct:'delete'},onClick:()=>{closeMaintEditor();qjDelete(item.id)}}]:null);
  modal.hidden=false;
  qjRefreshColumns();
 }
 function qjEdit(){return qjState.editing||{}}
 function renderQueryJoinEditor(){
  const form=$('#maintEditorForm');if(!form)return;
  $('#maintEditorHint').textContent=qjWord('footer');
  form.innerHTML=qjEditorHtml(qjEdit());
  form.onsubmit=ev=>{ev.preventDefault();saveQueryJoinEditor()};
  qjBindEditor(form);
 }
 function qjOptions(list,sel,blank){
  const head=blank?`<option value=""${sel?'':' selected'}>${esc(blank)}</option>`:'';
  return head+list.map(v=>{
   const value=typeof v==='string'?v:v.value;
   const label=typeof v==='string'?v:v.label;
   return `<option value="${esc(value)}"${value===sel?' selected':''}>${esc(label)}</option>`;
  }).join('');
 }
 function qjSourceOptions(sel){
  /* 設備ごとのファイル（§9.595）は一覧に列を足せない（1つの表ではない）。一覧の結合では**選べない形で並べ、理由を言う**（§9.605）。 */
  const fin=qjIsFinish(),pat=new Set(qjState.patternSources||[]);
  const head=`<option value=""${sel?'':' selected'}>選んでください</option>`;
  return head+(qjState.sources||[]).map(s=>{
   const off=!fin&&pat.has(s.key)&&s.key!==sel;
   return `<option value="${esc(s.key)}"${s.key===sel?' selected':''}${off?' disabled':''}>${esc((s.label||s.key)+(s.purpose?`（${s.purpose}）`:'')
    +(s.listed?'':'・一覧に出さない')+(pat.has(s.key)?'・設備ごとのファイル（完了突合で使う）':''))}</option>`;
  }).join('');
 }
 /* ---------- 突合キーは「両側の列を並べて結ぶ」(§9.197、利用者の指示) ----------
    以前は`<select>`を左右に並べた行で、①どんな列があるのか探せない
    ②いま何と何が結ばれているのかが読み取りにくい ③選ぶ相手のデータ・表が
    ただのプルダウンで「どのファイルのどの表を見ているのか」が画面に出て
    いない、という状態だった（実機で「対象ファイルを選ぶところの視覚表示が
    少なくわかりづらい」と指摘）。
    **EXCELのパワークエリのマージと同じ作法**にする——左右に表を1枚ずつ置き、
    列を1つずつ押す（またはドラッグして重ねる）と、その2列が結ばれる。
    結ばれた列には両側に同じ「鍵N」の印が付き、下に組の一覧が出る。 */
 function qjSampleText(c,col){
  const v=((c.samples||{})[col]||[]).slice(0,3);
  return v.join(' / ');
 }
 function qjSide(x,side){
  const db=side==='left'?x.left:x.right;
  const table=side==='left'?x.leftTable:x.rightTable;
  const key=db+'\t'+(table||'');
  return {db,table,c:qjState.cols[key]||{},loaded:!!qjState.cols[key]};
 }
 /* この列が何番目の鍵か（0=鍵ではない）。**両側に同じ番号を出す**ので、
    どの列とどの列が組んでいるのかが列の一覧だけで読める。 */
 function qjKeyIndexOf(x,side,col){
  const arr=x.keys||[];
  for(let i=0;i<arr.length;i++)if((side==='left'?arr[i].left:arr[i].right)===col)return i+1;
  return 0;
 }
 /* 同じ名前の列を候補として出す。**名前のゆれを吸収する規則は画面に
    書かない**——サーバーが返した正規化済みの名前(normalized)どうしを
    比べるだけにする(§9.163)。 */
 function qjSuggestPairs(x,lc,rc){
  const ln=lc.normalized||{},rn=rc.normalized||{};
  if(!Object.keys(ln).length||!Object.keys(rn).length)return [];
  const byNorm={};Object.keys(rn).forEach(c=>{if(!(rn[c] in byNorm))byNorm[rn[c]]=c});
  const used=new Set((x.keys||[]).map(k=>k.left+'\t'+k.right));
  const out=[];
  Object.keys(ln).forEach(c=>{
   const hit=byNorm[ln[c]];
   if(!hit)return;
   if(used.has(c+'\t'+hit))return;
   out.push({left:c,right:hit});
  });
  return out;
 }
 /* 列の一覧。**実データの例を必ず添える**——キーが合うかどうかは形を見れば
    分かる（L0001 と A-1 は突き合わない）ので、選ぶ前に出す。 */
 function qjFieldsHtml(side){
  const x=qjEdit(),s=qjSide(x,side);
  const cols=s.c.columns||[];
  /* **「読めていない」と「選んでいない」を分ける**——同じ空欄にすると、
     待てばよいのか操作が要るのかが分からない。 */
  if(!cols.length)return `<p class="qj-fields-empty">${
    s.c.error?esc(s.c.error)
    :(!s.db?'データを選ぶと、列がここに並びます。'
     :(s.loaded?'この表には列がありません。':'列を読み込んでいます…'))}</p>`;
  const q=String((qjState.search||{})[side]||'').trim().toLowerCase();
  const hit=cols.filter(c=>!q||String(c).toLowerCase().includes(q));
  if(!hit.length)return `<p class="qj-fields-empty">「${esc(q)}」に当てはまる列がありません。</p>`;
  const pick=qjState.pick;
  const other=side==='left'?qjWord('other'):qjWord('here');
  return hit.map(c=>{
   const n=qjKeyIndexOf(x,side,c);
   const on=!!(pick&&pick.side===side&&pick.col===c);
   const eg=qjSampleText(s.c,c);
   return `<button type="button" class="qj-field${n?' is-key':''}${on?' is-pick':''}" draggable="true"`
    +` data-qj-fld="${side}" data-col="${esc(c)}"`
    +` title="${esc(c)}${eg?'\n例: '+eg:''}\n押してから${esc(other)}の列を押すと結び付きます（ドラッグして重ねても同じです）">`
    +`<span class="qj-fld-name">${esc(c)}</span>`
    +(eg?`<span class="qj-fld-eg">${esc(eg)}</span>`
        :'<span class="qj-fld-eg is-empty">先頭20行が空</span>')
    +(n?`<i class="qj-fld-key">鍵${n}</i>`:'')
    +`</button>`;
  }).join('');
 }
 /* **次にすることを1つだけ指す**(§2)。選んでいる列があるときは「次に反対側を
    押す」、無いときは「1つずつ押す」。 */
 function qjStatusHtml(){
  const x=qjEdit(),p=qjState.pick;
  const n=(x.keys||[]).length;
  if(p){
   const here=p.side==='left'?qjWord('here'):qjWord('other');
   const other=p.side==='left'?qjWord('other'):qjWord('here');
   return `<span class="qj-status-now">${esc(here)}の<b>${esc(p.col)}</b>を選んでいます。`
    +`次に${esc(other)}の列を押すと結び付きます</span>`
    +`<button type="button" class="qj-status-cancel" id="qjPickCancel">選ぶのをやめる</button>`;
  }
  return n
   ?`<span class="qj-status-now">突合キーは<b>${n}</b>組。列をもう1組押せば追加できます</span>`
   :'<span class="qj-status-now"><b>突合キーがまだありません。</b>'
    +'左右の列を1つずつ押すか、片方をもう片方へドラッグしてください</span>';
 }
 /* 結ばれた組。**外す手立てを組の隣に置く**——一覧の下に別の「外す」を
    並べると、どの組を外すのか数え直すことになる。 */
 function qjPairsHtml(x){
  const keys=x.keys||[];
  if(!keys.length)return '';
  const L=qjSide(x,'left').c,R=qjSide(x,'right').c;
  const gone=(col,side)=>{const cs=(side==='left'?L:R).columns;return !!(cs&&cs.length&&!cs.includes(col))};
  return keys.map((k,i)=>{
   const bad=gone(k.left,'left')||gone(k.right,'right');
   return `<span class="qj-pair${bad?' is-missing':''}" data-qj-pair="${i}">`
    +`<i class="qj-pair-no">鍵${i+1}</i>`
    +`<b>${esc(k.left)}</b><i class="qj-pair-eq">＝</i><b>${esc(k.right)}</b>`
    +(bad?`<i class="qj-pair-warn">${esc(qjWord('pairWarn'))}</i>`:'')
    +`<button type="button" class="qj-pair-del" data-qj-keydel="${i}" title="この組を外す">×</button>`
    +`</span>`;
  }).join('');
 }
 /* 片側の表。**どのデータのどの表を見ているのかを画面に出す**——列数と表名を
    添えると、選び間違いがその場で分かる(以前はプルダウンだけだった)。 */
 function qjPaneHtml(side){
  const x=qjEdit(),s=qjSide(x,side);
  const isL=side==='left';
  const cnt=(s.c.columns||[]).length;
  const meta=cnt
   ?`表: <b>${esc(s.c.table||s.table||'—')}</b> ／ <b>${cnt}</b>列`
   :(s.c.error?`<span class="is-warn">${esc(s.c.error)}</span>`:'列を読み込んでいます…');
  /* 完了突合の左は**役割「仕掛」で決まる**（`finish_definitions()`が左＝仕掛の行だけを使う）。選べる形にすると、
     選び替えた定義が黙って効かなくなる（§9.596）——名前と出どころだけを言う。 */
  if(isL&&qjIsFinish()){
   /* 突き合わせるのは**作業スケジュールの予定**（§9.605）。列は予定へ入れたときの仕掛の行の写しなので、名前は仕掛のデータから引く。 */
   const src=(qjState.sources||[]).find(v=>v.key===x.left)||{};
   return `<div class="qj-pane" data-qj-pane="left">
   <div class="qj-pane-head">
    <span class="qj-pane-tag is-plan">${esc(qjWord('left'))}</span>
    <span class="qj-pane-meta" title="列の名前は「${esc(src.label||x.left||'—')}」から引きます">予定へ入れたときの仕掛の行の写し・${cnt?`${cnt}列`:meta}</span>
   </div>
   <input type="search" class="qj-search" data-qj-search="left" placeholder="列名で絞り込み"
     value="${esc((qjState.search||{}).left||'')}" autocomplete="off" spellcheck="false">
   <div class="qj-fields" data-qj-list="left">${qjFieldsHtml('left')}</div>
  </div>`;
  }
  return `<div class="qj-pane" data-qj-pane="${side}">
   <div class="qj-pane-head">
    <span class="qj-pane-tag${isL?'':' is-right'}">${esc(qjWord(isL?'left':'right'))}</span>
    <select data-qj-field="${isL?'left':'right'}" data-qj-re aria-label="${esc(qjWord(isL?'left':'right'))}">${
      qjSourceOptions(isL?x.left:x.right)}</select>
    <select data-qj-field="${isL?'leftTable':'rightTable'}" data-qj-re aria-label="表">${
      qjOptions(s.c.tables||[],(isL?x.leftTable:x.rightTable)||'',isL?'どの表でも':'既定の表')}</select>
    <span class="qj-pane-meta">${meta}</span>
   </div>
   <input type="search" class="qj-search" data-qj-search="${side}" placeholder="列名で絞り込み"
     value="${esc((qjState.search||{})[side]||'')}" autocomplete="off" spellcheck="false">
   <div class="qj-fields" data-qj-list="${side}">${qjFieldsHtml(side)}</div>
  </div>`;
 }
 /* ③ いつ完了にするか（完了突合だけ・§9.595）。**決める順に**: 完了の条件の札 → 作業時間にする列（開始→終了）
    → いまのデータで当てた見本1件と内訳。見本は下見の答えを読むだけ（判定を画面に写さない）。 */
 function qjWhenHtml(x,rc){
  const whens=qjState.finishWhens||[];
  const now=whens.find(w=>w.key===(x.finishWhen||'gone'))||whens[0]||{};
  const cards=whens.map(w=>`<label class="qj-purpose qj-when${w.key===now.key?' is-on':''}">
    <input type="radio" name="qjWhen" value="${esc(w.key)}"${w.key===now.key?' checked':''}>
    <b>${esc(w.label)}</b><span>${esc(w.summary||'')}</span></label>`).join('');
  const sel=(k,v)=>`<select data-qj-field="${k}" data-qj-re>${qjOptions((rc.columns||[]),v||'','選ばない')}</select>`;
  return `<section class="qj-sec qj-sec-kind qj-sec-when" data-qj-jump-to="when">
    <h4 class="mm-fieldgroup">② いつ完了にするか — <span class="qj-kind-now">${esc(now.label||'')}</span></h4>
    ${cards?`<div class="qj-purposes qj-whens">${cards}</div>`:''}
    <div class="mm-field qj-f-span" data-qj-jump-to="span"><span>作業時間にする列</span>
     <div class="qj-span-row">
      <label class="qj-f-start"><span>開始の列</span>${sel('startColumn',x.startColumn)}</label>
      <span class="qj-span-arrow" aria-hidden="true">→</span>
      <label class="qj-f-finish"><span>終了の列</span>${sel('finishColumn',x.finishColumn)}</label>
     </div>
     <small class="mm-field-hint">両方読めた行は、その時刻を<b>作業時間</b>として登録して完了にします（人が入れた時刻があればそちらが先）。
      終了だけなら完了時刻として記録し、開始の時刻は入力を求めます。</small></div>
    <div class="qj-span-sample" id="qjSpanSample">${qjSpanSampleHtml(x)}</div>
   </section>`;
 }
 /* 見本1件（§9.596）: **いまの予定で**当てて、作業時間を登録できた最初のロット（開始→終了・1日の中の位置・分）。
    数えるのはサーバー（`trial`）。1日の帯は0〜24時の中で作業がどこにあるかを描く（日をまたぐ分は右端で止める）。 */
 function qjSpanSampleHtml(x){
  const t=qjState.trial;
  if(!x.startColumn||!x.finishColumn)return '<p class="mm-field-hint">開始と終了の列を選ぶと、いまの予定で当てた作業時間の見本がここに出ます。</p>';
  if(!t||t.error)return '';
  const hits=(t.examples||{}).hit||[];
  const sm=hits.find(e=>e.timed);
  if(!sm)return hits.length?'<p class="mm-field-hint is-warn">当たったロットはありますが、開始・終了の時刻を読めません（列か書式を確かめてください）。</p>':'';
  const d1=new Date(sm.startAt),d2=new Date(sm.endAt);
  const md=d=>`${d.getMonth()+1}/${d.getDate()}`,hm=d=>`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  const mins=Math.round((d2.getTime()-d1.getTime())/60000);
  const left=(d1.getHours()*60+d1.getMinutes())/1440*100;
  const width=Math.max(.6,Math.min(100-left,mins/1440*100));
  return `<div class="qj-span-box"><p>見本（いまの予定） <b>${esc(sm.lot)}</b>${sm.equipment?`（${esc(sm.equipment)}）`:''} → <b>完了</b>
     <span class="qj-span-time">${md(d1)} ${hm(d1)}</span>
     <span class="qj-day" title="1日（0〜24時）の中で作業がどこにあるか"><i style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></i></span>
     <span class="qj-span-time">${md(d2)===md(d1)?'':md(d2)+' '}${hm(d2)}</span>
     <b>${mins}分</b>・出どころ「実績データ」</p></div>`;
 }
 /* 右の列の頭: いまの設定を文で言う（§9.596）。札を押すとその欄へ（`data-qj-jump`）。 */
 function qjFinSummaryHtml(x){return qjFinFigHtml(x)}
 /* 流れの図（§9.605）: 節を矢印で縦に結ぶ。節は主の列の欄（`data-qj-jump-to`）と同じ鍵を名乗り、欄に入ると同じ節が光る。 */
 function qjLightNode(ev){
  const form=ev.currentTarget,to=ev.target.closest('[data-qj-jump-to]'),key=to?to.dataset.qjJumpTo:'';
  form.querySelectorAll('.qj-fig-node').forEach(n=>n.classList.toggle('is-lit',!!key&&n.dataset.qjNode===key));
 }
 function qjFinFigHtml(x){
  const whens=qjState.finishWhens||[];
  const now=whens.find(w=>w.key===(x.finishWhen||'gone'))||{};
  const src=(qjState.sources||[]).find(v=>v.key===x.right)||{};
  const keys=(x.keys||[]).map(k=>k.right).filter(Boolean);
  const chip=(jump,text,empty)=>`<button type="button" class="qj-fin-chip${text?'':' is-empty'}" data-qj-jump="${jump}">${esc(text||empty)}</button>`;
  /* 描き直し（下見の答えが届くたび）でも、いま焦点のある欄の節は光ったまま。 */
  const lit=((document.activeElement&&document.activeElement.closest('#maintEditorForm [data-qj-jump-to]'))||{dataset:{}}).dataset.qjJumpTo||'';
  const node=(key,label,body,plan)=>`<li class="qj-fig-node${plan?' is-plan':''}${key&&key===lit?' is-lit':''}" data-qj-node="${key}"><span class="qj-fig-label">${esc(label)}</span><span class="qj-fig-body">${body}</span></li>`;
  return `<ol class="qj-fig" aria-label="いまの設定の流れ">
    ${node('','作業スケジュールの予定','<span class="qj-fig-off">仕掛の一覧には足しません</span>',true)}
    ${node('keys','実績で探す',`${chip('keys',src.label||x.right,'実績のデータを選ぶ')}の${chip('keys',keys.join('・'),'突合キーを選ぶ')}`)}
    ${node('when','完了にする',chip('when',now.label,'いつ完了にするか'))}
    ${node('span','作業時間',chip('span',x.startColumn&&x.finishColumn?`${x.startColumn} 〜 ${x.finishColumn}`:'','開始・終了の列を選ぶ'))}
    ${node('take','予定へ残す',chip('take',qjTakeLabel(x),'残す値を選ぶ'))}
   </ol>`;
 }
 /* いまの予定で試した答え（§9.596）。種類の呼び名・意味・色の調子はサーバーの語彙（`TRIAL_KINDS`）。 */
 function qjTrialHtml(){
  const t=qjState.trial;
  if(qjState.probing&&!t)return '<p class="mm-field-hint">いまの予定で確かめています…</p>';
  if(!t)return '<p class="mm-field-hint">突合キーを選ぶと、いまの予定で当てた答えがここに出ます。</p>';
  if(t.error)return `<p class="mm-field-hint is-warn">${esc(t.error)}</p>`;
  const c=t.counts||{},n=t.plans||0,kinds=t.kinds||{},order=(t.order||[]).filter(k=>c[k]);
  const bar=order.map(k=>`<span class="is-${esc((kinds[k]||{}).tone||'mid')}" style="width:${(100*c[k]/Math.max(1,n)).toFixed(1)}%"></span>`).join('');
  const rows=order.map(k=>{const v=kinds[k]||{},ex=((t.examples||{})[k]||[]).slice(0,3);
   /* 鍵が揃わないときは**どの鍵が無いか**を名前と件数で言う（直す列が分かる）。 */
   const lack=k==='keys'?Object.entries(t.lacking||{}).map(([n,m])=>`「${esc(n)}」が無い ${m}件`).join('・'):'';
   return `<div class="qj-trial-row is-${esc(v.tone||'mid')}"><span>${esc(v.label||k)}</span><b>${c[k]}件</b>
    <i>${lack?lack+'。':esc(v.meaning||'')}${ex.length?` 例: ${ex.map(e=>esc(e.lot)+(e.equipment?`（${esc(e.equipment)}）`:'')).join('・')}`:''}</i></div>`}).join('');
  return `<div class="qj-trial">
    <h5>いまの予定で試す <span class="ds-probe-state">${qjState.probing?'確かめています…':''}</span></h5>
    <p class="qj-trial-head">まだ完了していない作業 <b>${n}</b>件のうち、完了にする <b>${c.hit||0}</b>件（作業時間つき ${t.timed||0}件）</p>
    ${n?`<div class="qj-trial-bar" aria-hidden="true">${bar}</div>${rows}`:'<p class="mm-field-hint">まだ完了していない作業の予定がありません。</p>'}
   </div>`;
 }
 /* ④ 予定へ何を残すか（§9.605）。札は①②と同じ顔（`.qj-purpose`）の3枚で、一言は1行。作業時間に使う開始・終了の列は
    **外せない**——「選んだ列も残す」の格子の先頭に鍵の札で出し、押すと②へ移る。「時刻だけ」では名前に付ける文字を伏せ、
    「2件以上あったら」と見本を左右に並べる。説明の続きは見出しの ⓘ。 */
 function qjTakeChoiceHtml(x){
  const now=qjTakeOf(x);
  return `<div class="qj-purposes qj-takes">${(qjState.takes||[]).map(t=>`<label class="qj-purpose qj-take${t.key===now?' is-on':''}">
    <input type="radio" name="qjTake" value="${esc(t.key)}"${t.key===now?' checked':''}><b>${esc(t.label)}</b><span>${esc(t.summary||'')}</span></label>`).join('')}</div>`;
 }
 function qjTakeColsHtml(x,rc){
  if(qjTakeOf(x)!=='some')return '';
  const lock=qjTimeCols(x);
  const colList=(rc.columns||[]).filter(c=>!lock.includes(c)&&!(x.keys||[]).some(k=>k.right===c));
  const locks=[[x.startColumn,'開始'],[x.finishColumn,'終了']].filter(([c])=>c).map(([c,w])=>`<button type="button" class="qj-col-lock" data-qj-jump="span"
    title="作業時間に使う列なので外せません。押すと②（作業時間にする列）へ移ります"><i class="fa-solid fa-lock" aria-hidden="true"></i><span>${esc(c)}</span><small>${w}</small></button>`).join('');
  return `<div class="qj-cols">${locks}${colList.length?colList.map(c=>
    `<label class="qj-col"><input type="checkbox" data-qj-col="${esc(c)}"${(x.columns||[]).includes(c)?' checked':''}><span>${esc(c)}</span></label>`).join('')
    :`<p class="mm-field-hint">${esc(qjWord('noCols'))}</p>`}</div>`;
 }
 function qjFinAddHtml(x,rc){
  const times=qjTakeOf(x)==='times';
  const multi=`<label class="mm-field"><span>${esc(qjWord('multiLabel'))}</span>
      <select data-qj-field="multi" data-qj-re>${qjOptions(
        Object.keys(QJ_MULTI_LABEL).map(m=>({value:m,label:QJ_MULTI_LABEL[m]})),x.multi||'first')}</select>
      <small class="mm-field-hint">${esc(qjWord('multiHint'))}</small></label>`;
  const prefix=`<label class="mm-field"><span>${esc(qjWord('prefixLabel'))}</span>
      <input data-qj-field="prefix" type="text" value="${esc(x.prefix||'')}" maxlength="20" autocomplete="off" spellcheck="false" placeholder="例: 実績_">
      <small class="mm-field-hint">${WL.markup(qjWord('prefixHint'))}</small></label>`;
  const preview='<div class="qj-add-preview" id="qjAddPreview"></div>';
  return `<section class="qj-sec qj-sec-add" data-qj-jump-to="take">
    <h4 class="mm-fieldgroup">${esc(qjWord('addHead'))}${tipHtml(qjWord('addIntro').replace(/\*\*/g,''))}</h4>
    ${qjTakeChoiceHtml(x)}${qjTakeColsHtml(x,rc)}
    ${times?`<div class="qj-add-opts is-pair">${multi}${preview}</div>`:`<div class="qj-add-opts">${prefix}${multi}</div>${preview}`}
   </section>`;
 }
 function qjAddHtml(x,rc,kind,isFinish){
  if(isFinish)return qjFinAddHtml(x,rc);
  const pickAll=!(x.columns||[]).length;
  const colList=(rc.columns||[]).filter(c=>!(x.keys||[]).some(k=>k.right===c));
  return `<section class="qj-sec qj-sec-add">
    <h4 class="mm-fieldgroup">④ 何を追加するか</h4>
    ${(kind.key&&!kind.matched&&!kind.rightOnly)?`<p class="mm-field-hint">
      <b>この結合は列を足しません。</b>「${esc(kind.label)}」は相手に当たらなかった行だけを残す使い方なので、
      相手の値がありません（足しても全部空欄になります）。列を足したいときは、③で
      「${esc((qjKind('left')||{}).label||'左外部結合')}」などを選んでください。</p>`:`
    <div class="qj-pick">
     <label class="qj-radio"><input type="radio" name="qjPick" value="all" data-qj-re${pickAll?' checked':''}>
      <span>${esc(qjWord('pickAll'))}</span></label>
     <label class="qj-radio"><input type="radio" name="qjPick" value="some" data-qj-re${pickAll?'':' checked'}>
      <span>選んだ列だけ<i>（${(x.columns||[]).length}列を選択中）</i></span></label>
    </div>
    ${pickAll?'':`<div class="qj-cols">${colList.length?colList.map(c=>
      `<label class="qj-col"><input type="checkbox" data-qj-col="${esc(c)}"${(x.columns||[]).includes(c)?' checked':''}><span>${esc(c)}</span></label>`
     ).join(''):`<p class="mm-field-hint">${esc(qjWord('noCols'))}</p>`}</div>`}
    <div class="qj-add-opts">
     <label class="mm-field"><span>${esc(qjWord('prefixLabel'))}</span>
      <input data-qj-field="prefix" type="text" value="${esc(x.prefix||'')}" maxlength="20" autocomplete="off" spellcheck="false" placeholder="例: 品質_">
      <small class="mm-field-hint">${WL.markup(qjWord('prefixHint'))}</small></label>
     <label class="mm-field"><span>${esc(qjWord('multiLabel'))}</span>
      <select data-qj-field="multi" data-qj-re>${qjOptions(
        Object.keys(QJ_MULTI_LABEL).map(v=>({value:v,label:QJ_MULTI_LABEL[v]})),x.multi||'first')}</select>
      <small class="mm-field-hint">${esc(qjWord('multiHint'))}</small></label>
    </div>`}
   </section>`;
 }
 function qjEditorHtml(x){
  const lc=qjSide(x,'left').c,rc=qjSide(x,'right').c;
  const kind=qjKind(x.kind)||{};
  const sugg=qjSuggestPairs(x,lc,rc);
  const suggHtml=sugg.length?`<div class="qj-sugg">
    <span class="qj-sugg-label">同じ名前の列:</span>
    ${sugg.slice(0,6).map(pp=>`<button type="button" class="qj-sugg-btn" data-qj-sugg="${esc(pp.left)}\t${esc(pp.right)}">${esc(pp.left)}${pp.left===pp.right?'':' ＝ '+esc(pp.right)}</button>`).join('')}
    ${sugg.length>1?`<button type="button" class="mm-btn-ghost sm" id="qjKeyAuto">${sugg.length}組すべて足す</button>`:''}
   </div>`:'';
  const kindCards=(qjState.kinds||[]).map(k=>`<label class="qj-kind${k.key===kind.key?' is-on':''}">
    <input type="radio" name="qjKind" value="${esc(k.key)}" data-qj-re${k.key===kind.key?' checked':''}>
    ${qjVennHtml(k,'card')}
    <b>${esc(k.label)}</b>
    <span class="qj-kind-short">${esc(k.short)}</span>
    <span class="qj-kind-rows">${esc(qjRowEffect(k))}</span>
   </label>`).join('');
  /* 用途(§9.365)。**いちばん上に置く**——ここで決めた使いみちによって
     下の節の意味が変わる（③が消え、④が「持ち帰る値」になる）ので、
     決める順のとおりに並べる。 */
  const purpose=qjPurpose(x.purpose)||{};
  const isFinish=purpose.key===QJ_PURPOSE_FINISH;
  const purposeCards=(qjState.purposes||[]).map(pp=>`<label class="qj-purpose${pp.key===purpose.key?' is-on':''}">
    <input type="radio" name="qjPurpose" value="${esc(pp.key)}"${pp.key===purpose.key?' checked':''}>
    <b>${esc(pp.label)}</b><span>${esc(pp.when||'')}</span>
   </label>`).join('');
  const sName=`<section class="qj-sec qj-sec-name">
    <h4 class="mm-fieldgroup">① これは何か</h4>
    ${purposeCards?`<div class="qj-purposes">${purposeCards}</div>`:''}
    <div class="qj-name-row">
     <label class="mm-field qj-f-name"><span>結合名</span>
      <input data-qj-field="name" type="text" value="${esc(x.name||'')}" required autocomplete="off" spellcheck="false">
      <small class="mm-field-hint">${esc(qjWord('nameHint'))}</small></label>
     <label class="mm-field qj-f-order"><span>表示順</span>
      <input data-qj-field="order" type="number" min="0" max="9999" value="${esc(String(x.order==null?0:x.order))}">
      <small class="mm-field-hint">小さいほど先に当たります。</small></label>
     <label class="mm-field qj-f-enabled"><span>使う / 使わない</span>
      <select data-qj-field="enabled" data-qj-re>${qjOptions(['有効','無効'],x.active===false?'無効':'有効')}</select>
      <small class="mm-field-hint">${esc(qjWord('enabledHint'))}</small></label>
    </div>
    ${isFinish?'':`<label class="qj-check">
     <input type="checkbox" data-qj-sched${x.useInSchedule===false?'':' checked'}>
     <span>作業スケジュール表でも使う<small>外すと、この結合の列は仕掛一覧にだけ出ます（予定を読むたびの往復も1本減ります）。</small></span>
    </label>`}
   </section>`;
  const sMerge=`<section class="qj-sec qj-sec-merge" data-qj-jump-to="keys">
    <h4 class="mm-fieldgroup">${isFinish?'③ 実績のデータと突合キー':'② つなぐ2つのデータと突合キー'}</h4>
    <div class="qj-merge">
     ${qjPaneHtml('left')}
     <div class="qj-merge-mid" aria-hidden="true"><span class="qj-merge-eq">＝</span></div>
     ${qjPaneHtml('right')}
    </div>
    <p class="qj-merge-status">${qjStatusHtml()}</p>
    <div class="qj-pairs">${qjPairsHtml(x)}</div>
    ${suggHtml}
    <p class="mm-field-hint">${WL.markup(qjWord('keysHint'))}
     選べるのは<b>データ接続に登録してあるデータ</b>だけです（一覧に出していないデータも選べます）。</p>
   </section>`;
  const sKind=isFinish?qjWhenHtml(x,rc):`
   <section class="qj-sec qj-sec-kind">
    <h4 class="mm-fieldgroup">③ 結合の仕方 — <span class="qj-kind-now">${esc(kind.label||'')}</span></h4>
    ${kindCards?`<div class="qj-kinds">${kindCards}</div>
    <div class="qj-kind-detail">
     <p class="qj-kind-summary">${WL.markup(kind.summary||'')}</p>
     <p class="mm-field-hint">${esc(kind.when||'')}</p>
     ${qjSampleHtml(kind)}
     ${kind.rightOnly?'<p class="mm-field-hint is-warn">「相手にしかない行」を出すため、<b>相手の表を全部読みます</b>。また、一致しているかどうかはこの一覧の全行と突き合わせます（表示中のページだけでは決めません）。</p>':''}
    </div>`:'<p class="mm-field-hint">結合の仕方の一覧を読めませんでした。左外部結合（この一覧は全部残す）として扱います。</p>'}
   </section>`;
  const sAdd=qjAddHtml(x,rc,kind,isFinish);
  /* 完了突合は**決める順の主の列＋いつも見える答えの列**（§9.596・7案→組合せ→3回目の M）。主の列は
     ① これは何か → ② いつ完了にするか → ③ 実績のデータと突合キー → ④ 何を持ち帰るか。右の列は「いまの設定」を
     文で言い（札を押すとその欄へ）、保存する前に**いまの予定で**当てた答えを出す。一覧の結合は今までどおり。 */
  if(isFinish)return `<div class="qj-edit is-finish"><div class="qj-fin">
    <div class="qj-fin-main">${sName}${sKind}${sMerge}${sAdd}</div>
    <aside class="qj-fin-side" aria-label="いまの設定と、いまの予定で試した答え">
     <div id="qjFinSummary">${qjFinSummaryHtml(x)}</div>
     <div id="qjProbeBox" class="ds-probe"></div>
    </aside></div></div>`;
  return `<div class="qj-edit">${sName}${sMerge}${sKind}${sAdd}
   <section class="qj-sec qj-sec-result">
    <h4 class="mm-fieldgroup">⑤ 結果（保存する前の下見） <span class="ds-probe-state" id="qjProbeState"></span></h4>
    <div id="qjProbeBox" class="ds-probe"></div>
   </section>
  </div>`;
 }
 /* 完了突合の欄の配線（§9.595・§9.605）: いつ完了にするか・予定へ残す値・欄に入ると図の同じ節が光る。 */
 function qjBindFinish(form){
  /* 節は欄の`data-qj-jump-to`と同じ鍵を名乗る。`onfocusin`の属性は Chromium に無いので受け手で付ける（器は同じなので1回だけ）。 */
  if(!form.dataset.qjLit){form.dataset.qjLit='1';form.addEventListener('focusin',qjLightNode)}
  form.querySelectorAll('[name="qjWhen"]').forEach(el=>el.onchange=()=>{
   if(!el.checked)return;
   qjEdit().finishWhen=el.value;
   renderQueryJoinEditor();qjProbeSoon(0);
  });
  /* 「時刻だけ」「すべて」は列の並びを持たない。描き直しで札が作り替わるので、焦点を選んだ札へ戻す（図の節が光ったまま）。 */
  form.querySelectorAll('[name="qjTake"]').forEach(el=>el.onchange=()=>{
   if(!el.checked)return;
   const x=qjEdit();x.take=el.value;
   if(el.value!=='some')x.columns=[];
   renderQueryJoinEditor();qjProbeSoon(0);
   const back=document.querySelector(`#maintEditorForm [name="qjTake"][value="${el.value}"]`);if(back)back.focus({preventScroll:true});
  });
 }
 function qjBindEditor(form){
  form.querySelectorAll('[data-qj-field]').forEach(el=>{
   const k=el.dataset.qjField;
   const commit=()=>{
    const x=qjEdit();
    if(k==='enabled')x.active=el.value!=='無効';
    else if(k==='order')x.order=parseInt(el.value||'0',10)||0;
    else x[k]=el.value;
    if(k==='left')x.leftTable='';
    if(k==='right'){x.rightTable='';x.columns=[]}
    /* **データを取り替えたら組は外す**(§9.197)。以前は片側だけを空にして
       組の行を残していたが、列の一覧そのものが入れ替わるので、残しても
       当たらない組が並ぶだけだった。選び直しは列を押すだけで済む。
       表(leftTable/rightTable)を変えただけのときは残す——同じ列名が
       あることが多く、無ければ組の側に「この表にありません」と出る。 */
    if(k==='left'||k==='right'){x.keys=[];qjState.pick=null}
    /* 表を変えると列の一覧が入れ替わる。**選びかけは捨てる**——残すと
       いま一覧に無い列を「選んでいます」と言い続ける。 */
    if(k==='leftTable'||k==='rightTable')qjState.pick=null;
   };
   /* **値の入力中に組み直さないこと**(§9.117)。文字を打つたびに入力欄が
      作り替わるとカーソルが飛ぶ。組み直すのは選択肢(data-qj-re)だけ。 */
   if(el.matches('[data-qj-re]'))el.onchange=()=>{commit();renderQueryJoinEditor();qjRefreshColumns()};
   else{el.oninput=()=>{commit();qjProbeSoon()};el.onchange=()=>commit()}
  });
  /* 「いまの設定」の札を押すと、その欄へ移って光らせる（§9.596・図と入力を結ぶ）。 */
  form.onclick=ev=>{
   const b=ev.target.closest('[data-qj-jump]');if(!b)return;
   const to=form.querySelector(`[data-qj-jump-to="${b.dataset.qjJump}"]`);if(!to)return;
   to.scrollIntoView({block:'center',behavior:'smooth'});
   to.classList.remove('is-flash');void to.offsetWidth;to.classList.add('is-flash');
   const f=to.querySelector('select,input:not([type=hidden]),button');if(f)f.focus({preventScroll:true});
  };
  qjBindFinish(form);
  form.querySelectorAll('[name="qjKind"]').forEach(el=>el.onchange=()=>{
   if(!el.checked)return;
   qjEdit().kind=el.value;
   renderQueryJoinEditor();qjProbeSoon(0);
  });
  /* 用途を切り替えると、下の節の意味が変わる（③が消え、④が「持ち帰る値」に
     なる）。**相手の既定も一緒に寄せる**(§9.365)——完了突合の相手はほぼ
     必ず役割「実績」なので、探させない。 */
  form.querySelectorAll('[name="qjPurpose"]').forEach(el=>el.onchange=()=>{
   if(!el.checked)return;
   const x=qjEdit();
   x.purpose=el.value;
   if(x.purpose===QJ_PURPOSE_FINISH){
    const work=(qjState.sources||[]).find(s=>s.purpose==='仕掛');
    const act=(qjState.sources||[]).find(s=>s.purpose==='実績');
    if(work&&x.left!==work.key){x.left=work.key;x.leftTable='';x.keys=[]}
    if(act&&!x.id&&x.right!==act.key){x.right=act.key;x.rightTable='';x.keys=[];x.columns=[]}
    if(!x.id)x.take='times';
   }
   qjState.pick=null;
   renderQueryJoinEditor();qjRefreshColumns();qjProbeSoon(0);
  });
  const sched=form.querySelector('[data-qj-sched]');
  if(sched)sched.onclick=()=>{qjEdit().useInSchedule=!!sched.checked};
  form.querySelectorAll('[data-qj-sugg]').forEach(el=>el.onclick=()=>{
   const [l,r]=String(el.dataset.qjSugg||'').split('\t');
   qjAddKey(l,r);
  });
  const auto=form.querySelector('#qjKeyAuto');
  if(auto)auto.onclick=()=>{
   const x=qjEdit();
   const lc=qjState.cols[x.left+'\t'+(x.leftTable||'')]||{};
   const rc=qjState.cols[x.right+'\t'+(x.rightTable||'')]||{};
   qjSuggestPairs(x,lc,rc).forEach(pp=>qjAddKey(pp.left,pp.right,true));
   renderQueryJoinEditor();qjProbeSoon(0);
  };
  /* 組を外す。**空の組は作らない**——押すたびに空行が増えると、そのぶん
     「外す」を押させることになる(§9.197で行そのものを廃止した)。 */
  form.querySelectorAll('[data-qj-keydel]').forEach(el=>el.onclick=()=>{
   const x=qjEdit();x.keys.splice(+el.dataset.qjKeydel,1);
   qjState.pick=null;
   renderQueryJoinEditor();qjProbeSoon(0);
  });
  /* 列名の絞り込み。**一覧だけを描き直す**(§9.117)——入力欄を作り替えると
     1文字ごとにカーソルが飛ぶ。 */
  form.querySelectorAll('[data-qj-search]').forEach(el=>{
   el.oninput=()=>{
    qjState.search=qjState.search||{};
    qjState.search[el.dataset.qjSearch]=el.value;
    qjRenderFieldList(el.dataset.qjSearch);
   };
   /* **Enterで保存させないこと。** この欄はフォームの中にあるので、
      既定では Enter が送信＝「追加登録」になる（絞り込むつもりで打った
      Enter で登録されてしまう）。 */
   el.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();ev.stopPropagation()}};
  });
  qjBindFields(form);
  const cancel=form.querySelector('#qjPickCancel');
  if(cancel)cancel.onclick=()=>{qjState.pick=null;qjRefreshMerge()};
  form.querySelectorAll('[name="qjPick"]').forEach(el=>el.onchange=()=>{
   const x=qjEdit();
   if(el.value==='all'&&el.checked)x.columns=[];
   else if(el.checked&&!x.columns.length){
    const rc=qjState.cols[x.right+'\t'+(x.rightTable||'')]||{};
    x.columns=(rc.columns||[]).filter(c=>!(x.keys||[]).some(k=>k.right===c)).slice(0,20);
   }
   renderQueryJoinEditor();qjProbeSoon(0);
  });
  form.querySelectorAll('[data-qj-col]').forEach(el=>el.onclick=()=>{
   /* チェックは`click`で受ける(§9.90)。`change`は`click`の後に飛ぶため、
      行のクリックで組み直す作りだと反映されない。 */
   const x=qjEdit(),c=el.dataset.qjCol;
   if(el.checked){if(!x.columns.includes(c))x.columns.push(c)}
   else x.columns=x.columns.filter(v=>v!==c);
   qjProbeSoon();
  });
  qjRenderProbe();
 }
 /* 1組足す。**同じ組は増やさない**——同じキーを2回押しても増えないので、
    押し間違いを外す手間が要らない。 */
 function qjAddKey(left,right,quiet){
  if(!left||!right)return;
  const x=qjEdit();
  x.keys=(x.keys||[]).filter(k=>k.left&&k.right);
  if(!x.keys.some(k=>k.left===left&&k.right===right))x.keys.push({left:left,right:right});
  if(!quiet){renderQueryJoinEditor();qjProbeSoon(0)}
 }
 /* ---------- 列を押す／ドラッグして結ぶ(§9.197) ----------
    **どちらの操作でも同じことが起きる**（片方だけ効くと、効かない側を
    「壊れている」と読まれる）。押した1つ目は`qjState.pick`に覚え、
    反対側を押した時点で組にする。同じ側をもう一度押したら選び直し。 */
 function qjBindFields(root){
  (root||document).querySelectorAll('[data-qj-fld]').forEach(el=>{
   const side=el.dataset.qjFld,col=el.dataset.col;
   el.onclick=ev=>{ev.preventDefault();qjPickField(side,col)};
   el.ondragstart=ev=>{
    qjState.pick={side,col};
    try{ev.dataTransfer.setData('text/plain',side+'\t'+col);ev.dataTransfer.effectAllowed='link'}catch(_){WL.quiet.note('掴んだ印を渡せない（押す道は残る）',_)}
    el.classList.add('is-pick');
   };
   el.ondragend=()=>{el.classList.remove('is-pick');
    (root||document).querySelectorAll('.qj-field.is-drop').forEach(x=>x.classList.remove('is-drop'))};
   el.ondragover=ev=>{
    const p=qjState.pick;
    if(!p||p.side===side)return;        // 同じ側へ落としても組にならない
    ev.preventDefault();el.classList.add('is-drop');
   };
   el.ondragleave=()=>el.classList.remove('is-drop');
   el.ondrop=ev=>{
    ev.preventDefault();el.classList.remove('is-drop');
    let from=null;
    try{const t=String(ev.dataTransfer.getData('text/plain')||'').split('\t');
        if(t.length===2)from={side:t[0],col:t[1]}}catch(_){WL.quiet.note('掴んだ印を渡せない（押す道は残る）',_)}
    if(!from)from=qjState.pick;
    if(!from||from.side===side)return;
    qjState.pick=null;
    qjAddKey(side==='left'?col:from.col,side==='left'?from.col:col);
   };
  });
 }
 function qjPickField(side,col){
  const p=qjState.pick;
  if(p&&p.side!==side){
   qjState.pick=null;
   qjAddKey(side==='left'?col:p.col,side==='left'?p.col:col);
   return;
  }
  qjState.pick=(p&&p.side===side&&p.col===col)?null:{side,col};
  qjRefreshMerge();
 }
 /* 列の一覧だけを差し替える（絞り込みの入力中に呼ぶので、**入力欄には
    触らない**）。 */
 function qjRenderFieldList(side){
  const box=document.querySelector(`[data-qj-list="${side}"]`);
  if(!box)return;
  box.innerHTML=qjFieldsHtml(side);
  qjBindFields(box);
 }
 /* 押した結果をその場に出す。**全部を組み直さない**——組み直すと絞り込みの
    文字とスクロールが巻き戻る。 */
 function qjRefreshMerge(){
  qjRenderFieldList('left');qjRenderFieldList('right');
  const st=document.querySelector('.qj-merge-status');
  if(st){
   st.innerHTML=qjStatusHtml();
   const c=st.querySelector('#qjPickCancel');
   if(c)c.onclick=()=>{qjState.pick=null;qjRefreshMerge()};
  }
 }
 async function qjRefreshColumns(){
  const x=qjEdit();
  const before=JSON.stringify([x.left,x.leftTable,x.right,x.rightTable]);
  await Promise.all([qjColumns(x.left,x.leftTable),qjColumns(x.right,x.rightTable)]);
  // 途中で選び直されていたら、そのときの結果で描き直す側に任せる。
  if(JSON.stringify([x.left,x.leftTable,x.right,x.rightTable])!==before)return;
  renderQueryJoinEditor();
  qjProbeSoon(0);
 }
 let qjProbeTimer=null;
 function qjProbeSoon(delay){
  clearTimeout(qjProbeTimer);
  qjProbeTimer=setTimeout(qjProbe,delay==null?450:delay);
 }
 async function qjProbe(){
  const x=qjEdit();
  const body={left:x.left,leftTable:x.leftTable,right:x.right,rightTable:x.rightTable,
              keys:(x.keys||[]).filter(k=>k.left&&k.right),columns:x.columns,
              prefix:x.prefix,multi:x.multi,kind:x.kind||qjState.kindDefault,
              purpose:x.purpose||'',finishColumn:x.finishColumn||'',
              startColumn:x.startColumn||'',finishWhen:x.finishWhen||'',take:qjTakeOf(x),
              name:x.name||'(下見)'};
  const sig=JSON.stringify(body);
  if(sig===qjState.probeSig)return;
  qjState.probeSig=sig;
  const seq=++qjState.probeSeq;
  qjState.probing=true;qjRenderProbe();
  try{
   const r=await api('/api/query-join-master/probe',{quiet:true,method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(seq!==qjState.probeSeq)return;
   qjState.probe=r.result||null;
   qjState.trial=r.trial||null;
  }catch(e){
   if(seq!==qjState.probeSeq)return;
   qjState.probe={ok:false,reason:e.message,sampled:0,matched:0,ambiguous:0,
                  addedColumns:0,addedColumnNames:[],table:'',examples:[]};
   qjState.trial=null;
  }finally{
   if(seq===qjState.probeSeq){qjState.probing=false;qjRenderProbe()}
  }
 }
 function qjRenderProbe(){
  if(qjIsFinish())return qjRenderFinishProbe();
  const box=$('#qjProbeBox'),state=$('#qjProbeState');if(!box)return;
  if(state)state.textContent=qjState.probing?'確かめています…':'';
  const p=qjState.probe;
  if(!p){box.innerHTML='<p class="mm-field-hint">突合キーを選ぶと、いまのデータで当ててみた結果がここに出ます。</p>';return}
  /* **色だけで伝えない**(§3)。当たった件数・足す列数・実例を文字で出す。 */
  const names=(p.addedColumnNames||[]);
  const cols=p.addedColumns?`<b>${p.addedColumns}</b> 列を追加します`:'列は足しません';
  const head=p.ok
   ?`<p class="qj-probe-ok"><b>${p.matched}</b> / ${p.sampled} 行に当たりました。${cols}（相手の表: ${esc(p.table||'—')}）。</p>`
   :`<p class="qj-probe-ng">当たりませんでした。${esc(p.reason||'')}</p>`;
  /* **行が増減することは必ず文字で言う**(§9.194)。結合の仕方によっては
     一覧から行が消える／相手の行が増えるので、黙って変えると「絞り込んで
     いないのに件数が合わない」としか見えない。 */
  const rowLine=(p.ok&&(p.droppedRows||p.addedRows))
   ?`<p class="qj-probe-rows">行数: ${p.sampled} → <b>${p.rowsAfter}</b>`
     +(p.droppedRows?`／一致しない ${p.droppedRows} 行は出しません`:'')
     +(p.addedRows?`／相手にしかない ${p.addedRows} 行が増えます`:'')+'</p>'
   :'';
  const noteLine=p.note?`<p class="mm-field-hint">${esc(p.note)}</p>`:'';
  const amb=p.ambiguous?`<p class="mm-field-hint">相手が2件以上あったキーが ${p.ambiguous} 件あります（いまの設定: ${esc(QJ_MULTI_LABEL[qjEdit().multi||'first'])}）。</p>`:'';
  const colLine=names.length?`<p class="mm-field-hint">足す列: ${esc(names.slice(0,12).join('・'))}${names.length>12?` ほか${names.length-12}列`:''}</p>`:'';
  /* 実例は3件(§9.105)。1件では「たまたま」と区別が付かない。 */
  const ex=(p.examples||[]).length?`<table class="qj-ex"><thead><tr>${
    Object.keys(p.examples[0]).map(k=>`<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${
    p.examples.map(r=>`<tr>${Object.values(r).map(v=>`<td>${esc(String(v))}</td>`).join('')}</tr>`).join('')
   }</tbody></table>`:'';
  /* 設備ごとのファイル(§9.595)は**どの設備のファイルを読んだか**を言う（型の打ち間違いはここでしか気づけない）。 */
  const files=(p.files||[]).length?`<p class="mm-field-hint">読んだファイル（設備ごと）: ${
    p.files.map(f=>esc(f.equipment)+(f.error?`（読めません: ${esc(f.error)}）`:` ${f.rows}行`)).join('・')}</p>`:'';
  box.innerHTML=head+rowLine+noteLine+amb+files+colLine+ex;
  const sm=$('#qjSpanSample');if(sm)sm.innerHTML=qjSpanSampleHtml(qjEdit());
 }
 /* 完了突合の下見（§9.596）: 右の列＝いまの予定で試した答え＋読んだファイル、②＝見本1件、④＝持ち帰る値の見本。
    **同じ数を2箇所に出さない**——実績のデータの行数（何行に鍵が揃っているか）は相手の表の話なので④の見本の頭だけ。 */
 function qjRenderFinishProbe(){
  const box=$('#qjProbeBox');if(!box)return;
  const p=qjState.probe||{};
  const files=(p.files||[]).length?`<p class="mm-field-hint">読んだファイル（設備ごと）: ${
    p.files.map(f=>esc(f.equipment)+(f.error?`（読めません: ${esc(f.error)}）`:` ${f.rows}行`)).join('・')}</p>`:'';
  const ng=(qjState.probe&&!p.ok&&p.reason)?`<p class="mm-field-hint is-warn">${esc(p.reason)}</p>`:'';
  const note=p.note?`<p class="mm-field-hint">${esc(p.note)}</p>`:'';
  box.innerHTML=qjTrialHtml()+ng+note+files;
  const sum=$('#qjFinSummary');if(sum)sum.innerHTML=qjFinSummaryHtml(qjEdit());
  const sm=$('#qjSpanSample');if(sm)sm.innerHTML=qjSpanSampleHtml(qjEdit());
  const pv=$('#qjAddPreview');if(!pv)return;
  const names=p.addedColumnNames||[];
  pv.innerHTML=(p.examples||[]).length?`<p class="mm-field-hint">残す値の見本（実績のデータの先頭の行・${names.length}列${
    p.ambiguous?`・同じキーの行が2件以上 ${p.ambiguous}件`:''}）</p><table class="qj-ex"><thead><tr>${
    Object.keys(p.examples[0]).map(k=>`<th>${qjRoleOf(k)}${esc(k)}</th>`).join('')}</tr></thead><tbody>${
    p.examples.map(r=>`<tr>${Object.values(r).map(v=>`<td>${esc(String(v))}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'';
 }
 /* 見本の列が作業時間のどちらか（§9.605）。札は格子の鍵の札と同じ色。接頭辞を付けた名前でも引く。 */
 function qjRoleOf(name){
  const x=qjEdit(),pre=x.prefix||'';
  const tag=w=>`<em class="qj-role">${w}</em>`;
  if(x.startColumn&&name===pre+x.startColumn)return tag('開始');
  if(x.finishColumn&&name===pre+x.finishColumn)return tag('終了');
  return '';
 }
 async function saveQueryJoinEditor(){
  const x=qjEdit();
  const uid=requireMaintUser();if(uid===null)return;
  const body={id:x.id,user_id:uid,name:x.name,left:x.left,leftTable:x.leftTable,
              right:x.right,rightTable:x.rightTable,
              keys:(x.keys||[]).filter(k=>k.left&&k.right),columns:x.columns,
              prefix:x.prefix,multi:x.multi,kind:x.kind||qjState.kindDefault,order:x.order,
              purpose:x.purpose||'',finishColumn:x.finishColumn||'',
              startColumn:x.startColumn||'',finishWhen:x.finishWhen||'',take:qjTakeOf(x),
              useInSchedule:x.useInSchedule!==false,
              enabled:x.active===false?'無効':'有効'};
  try{
   setMaintLoading(true,'保存しています…');
   const url=x.id?'/api/query-join-master/update':'/api/query-join-master';
   const r=await api(url,{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify(body)});
   closeMaintEditor();
   qjState.loaded=false;await loadQueryJoinMaint(true);
   /* **一覧の控えを捨てる。** 捨てないと、開き直しても結合前の写しが出て
      「保存したのに何も変わらない」に見える（一覧は問い合わせの結果を
      TTLで覚えている）。 */
   window.invalidateTableCache&&window.invalidateTableCache();
   showToast&&showToast('保存しました',r.message||'一覧を開き直すと反映されます',4000);
  }catch(e){showToast&&showToast('保存できません',e.message,6000)}
  finally{setMaintLoading(false)}
 }
 async function dsDelete(id){
  const x=dsState.items.find(i=>String(i.id)===String(id));if(!x)return;
  if(!await confirmModal({message:`「${x.label||x.key}」を無効にします。\n一覧から消えるのはサーバー再起動後です。よろしいですか？`,confirmLabel:'無効にする'}))return;
  const uid=requireMaintUser();if(uid===null)return;
  try{
   setMaintLoading(true,'無効にしています…');
   await api('/api/data-source-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:x.id,user_id:uid})});
   dsState.loaded=false;await loadDataSourceMaint(true);
   showToast&&showToast('無効にしました','一覧から消えるのはサーバー再起動後です',5000);
  }catch(e){showToast&&showToast('無効にできませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }

 /* ---- 編集ウィンドウ（スクロールさせない・大きく取る） --------------------
    視覚導線と作業導線を合わせる（①これは何か → ②どこから読むか →
    ③この設定でできること → ④いまの状態）。③は**保存する前に**実際に
    ファイルを開いて確かめた結果で、欄を触るたびに取り直す。 */
 function openDataSourceEditor(item){
  const modal=ensureMaintEditor();
  /* **スクロールさせない**（§9.168）。クエリ結合の窓を先に開いていると
     `is-tall`が残るので、ここで必ず外す。 */
  const dlg=modal.querySelector('.mm-editor-dialog');
  if(dlg){dlg.classList.add('is-wide');dlg.classList.remove('is-tall')}
  dsState.editing=item?Object.assign({},item):null;
  dsState.probe=item?(item.capability||null):null;
  dsState.probePath='';
  const x=dsState.editing||{};
  $('#maintEditorEyebrow').textContent='データ接続';
  $('#maintEditorTitle').textContent=item?`${x.label||x.key} を編集`:'データソースを追加';
  $('#maintEditorHint').textContent='読み込み先の変更はサーバー再起動後に反映されます。';
  $('#maintEditorSave').textContent=item?'更新を保存':'追加登録';
  const form=$('#maintEditorForm');
  form.innerHTML=dsEditorHtml(x,!item);
  form.onsubmit=ev=>{ev.preventDefault();saveDataSourceEditor()};
  /* 保存ボタンはウィンドウ共通（1つしか無い）ので、**開くたびに持ち主を
     決め直す**。汎用CRUDのsubmitMaintのままだと、この画面の入力を
     読まずに空で保存してしまう。 */
  $('#maintEditorSave').onclick=()=>saveDataSourceEditor();
  bindInputHelpers(form);
  form.querySelectorAll('[data-ds-mode]').forEach(r=>r.onchange=()=>{dsSyncMode();dsProbeSoon(0)});
  form.querySelectorAll('[data-field]').forEach(el=>{
   el.addEventListener('change',()=>dsProbeSoon());
   el.addEventListener('input',()=>dsProbeSoon());
  });
  dsSyncMode();dsRenderProbe();
  /* 無効にするは窓の ⋯ の先（§9.601・行ごとのボタンにしない）。有効な行だけ。 */
  editorMore(item&&item.active?[{label:'このデータソースを無効にする…',danger:true,note:'一覧から消えるのはサーバー再起動後です（確かめてから）',
   data:{dsAct:'disable'},onClick:()=>{closeMaintEditor();dsDelete(item.id)}}]:null);
  modal.hidden=false;
  requestAnimationFrame(()=>{const first=form.querySelector('[data-field="label"]');if(first)first.focus()});
  dsProbeSoon(0);
 }
 /* 役割の選択肢。**埋まっている役割にはその行の名前を添える**(§9.193)
    ——選んでから「既に付いています」と断られるのでは、開き直して確かめる
    手間が増えるだけ(§4「できないことは、できないと書く」)。自分が今
    持っている役割は素のまま出す(付け替えではないので断られない)。 */
 function dsPurposeOptions(x){
  const cur=x.purpose||'その他';
  const opt=(v,label,sel)=>`<option value="${esc(v)}"${v===sel?' selected':''}>${esc(label)}</option>`;
  const holders=dsState.purposeHolders||{};
  const list=['その他',...(dsState.purposes||[])];
  return list.map(v=>{
   if(v==='その他')return opt(v,'その他（一覧として見るだけ）',cur);
   const who=String(holders[v]||'');
   const taken=who&&who!==x.key;
   return opt(v,taken?`${v}（いまは ${who}）`:v,cur);
  }).join('');
 }
 /* 設備ごとのファイル(§9.595)。型を入れると上の欄は**フォルダ**の意味になる（名前で言い替える）。
    見つかった設備は下見（`capability.files`）の答えを札で並べるだけ。 */
 const DS_SHARE_FILE='共有パスの .sqlite3',DS_SHARE_FOLDER='共有フォルダ（ファイル名の型を使うとき）';
 function dsPatternHtml(x){
  return `<label class="mm-field ds-f-pattern"><span>ファイル名の型（設備ごとのファイル）</span>
    <input data-field="filePattern" type="text" value="${esc(x.filePattern||'')}" placeholder="例: 実績_{設備}.sqlite3" autocomplete="off" spellcheck="false">
    <span class="ds-pattern-found" id="dsPatternFound"></span>
    <small class="mm-field-hint">例: 実績_LS4.sqlite3 → 設備「LS4」（{設備} の所が設備名）。空欄なら上のファイル1つを読みます。</small></label>`;
 }
 function dsPatternFoundHtml(cap){
  if(!cap||!cap.pattern)return '';
  const files=cap.files||[];
  return files.length?files.map(n=>`<span class="ds-pattern-chip">${esc(n)}</span>`).join('')
   :`<span class="ds-pattern-none">${esc(cap.error||'型に合うファイルがありません。')}</span>`;
 }
 function dsEditorHtml(x,isNew){
  const mode=x.readMode||(x.overridePath?'direct':(x.mode||'share'));
  // 役割「仕掛」は一覧から隠せない（隠すと測定・予定投入の入口が消える）。
  // **選ばせてから断らない**——選べない理由を欄のところに書く（§4）。
  const lockListed=(x.purpose||'')==='仕掛';
  const f=(k,label,val,attrs,hint)=>`<label class="mm-field"><span>${esc(label)}</span>
    <input data-field="${k}" type="text" value="${esc(val==null?'':String(val))}" ${attrs||''} autocomplete="off" spellcheck="false">
    ${hint?`<small class="mm-field-hint">${esc(hint)}</small>`:''}</label>`;
  const pf=(k,label,val,pmode,hint)=>`<div class="mm-field mm-field-path"><span>${esc(label)}</span>
    <span class="mm-path" data-path-drop="${k}">
     <input data-field="${k}" type="text" value="${esc(val==null?'':String(val))}" autocomplete="off" spellcheck="false">
     <button type="button" class="mm-path-browse" data-path-browse="${k}" data-path-mode="${pmode||'file'}">参照…</button>
    </span>${hint?`<small class="mm-field-hint">${esc(hint)}</small>`:''}</div>`;
  const opt=(v,label,sel)=>`<option value="${esc(v)}"${v===sel?' selected':''}>${esc(label)}</option>`;
  /* **RNEが無い端末では、無いと書く**（§9.168、利用者の指摘「RNEがない場合も
     あるのでそのあたりの切り替えもできるように」）。選ばせないのではなく、
     選んだ結果どうなるかを先に言う。 */
  const rneNote=dsState.assets.confExists?''
    :`この端末には接続情報 symnavim.conf がありません（${dsState.assets.assetsDir||''}）。置くまで抽出は動きません。`;
  const modeBlock=m=>{
   if(m.v==='share')return pf('share',x.filePattern?DS_SHARE_FOLDER:DS_SHARE_FILE,x.share,'file',
     'ファイル名だけなら既定の共有フォルダ配下を探します。UNC（\\\\サーバー\\共有\\…）も入れられます。')
     +dsPatternHtml(x);
   if(m.v==='rne')return `${f('rne','RNE（抽出定義）ファイル',x.rne,'','ファイル名だけなら「RNE資材の置き場」の rne/ 配下です。')}
     ${f('table','抽出テーブル',x.table,'','RNEの中の表の名前。未入力なら「仕掛」です。')}
     ${pf('output','作った .sqlite3 の置き場',x.output,'file','ファイル名だけなら db/ 配下です。')}
     ${rneNote?`<p class="ds-warn">${esc(rneNote)}</p>`:''}`;
   return pf('overridePath','直接読むファイル',x.overridePath,'file',
     '検証や一時的な差し替えに使います。値がある間は上の設定より優先されます。');
  };
  return `<div class="ds-edit">
   <section class="ds-edit-zone">
    <h4 class="mm-fieldgroup">① これは何か</h4>
    ${f('label','表示名',x.label,'required','左メニュー「元データ」に出る名前です。')}
    ${f('key','キー',x.key,'required','半角英数と _。一覧を指す識別子で、変えると この一覧向けの登録フィルタ・表示列の設定が結び付かなくなります。')}
    <label class="mm-field"><span>どのデータとして使うか（役割）</span>
     <select data-field="purpose">${dsPurposeOptions(x)}</select>
     <small class="mm-field-hint">「仕掛」＝測定・予定投入の対象／「品質」＝仕掛の一覧へ結合／「スケジュール」＝作業予定の本体。<b>この3つは各1件だけ</b>で、「その他」は一覧として見るだけです。別のデータをつなげたいときは マスタ管理 &gt; クエリ結合 で結合を登録します（役割は要りません）。</small></label>
    <div class="ds-edit-pair">
     <label class="mm-field"><span>表示順</span>
      <input data-field="order" type="number" min="0" max="9999" value="${esc(String(x.order==null?0:x.order))}">
      <small class="mm-field-hint">小さいほど上に出ます。</small></label>
     <label class="mm-field"><span>使う / 使わない</span>
      <select data-field="enabled">${['有効','無効'].map(v=>opt(v,v,x.enabled||'有効')).join('')}</select>
      <small class="mm-field-hint">「無効」にすると読み込みも抽出も止まります（結合の相手にもなりません）。</small></label>
    </div>
    <label class="mm-field"><span>左メニューの一覧に出す</span>
     <select data-field="listed"${lockListed?' disabled':''}>${
       ['出す','出さない'].map(v=>opt(v,v,(x.listed===false&&!lockListed)?'出さない':'出す')).join('')}</select>
     <small class="mm-field-hint">${lockListed
       ?'役割「仕掛」は測定・予定投入の入口なので、一覧から隠せません。'
       :'「出さない」にしても<b>データは読みます</b>。クエリ結合の相手としてだけ使いたいデータ（品質・単価表など）を、左メニューに並べずに済ませるための設定です。'}</small></label>
   </section>
   <section class="ds-edit-zone">
    <h4 class="mm-fieldgroup">② どこから読むか</h4>
    <div class="ds-modes">${DS_MODES.map(m=>`
     <div class="ds-mode" data-ds-mode-box="${m.v}">
      <label class="ds-mode-pick"><input type="radio" name="dsMode" value="${m.v}" data-ds-mode${m.v===mode?' checked':''}>
       <span><b>${esc(m.label)}</b><i>${esc(m.hint)}</i></span></label>
      <div class="ds-mode-body">${modeBlock(m)}</div>
     </div>`).join('')}</div>
    ${f('preferred','既定テーブル',x.preferred,'','この一覧を開いた直後に選ぶ表の名前。未入力なら抽出テーブルと同じです。')}
   </section>
   <section class="ds-edit-zone ds-edit-result">
    <h4 class="mm-fieldgroup">③ この設定でできること <span class="ds-probe-state" id="dsProbeState"></span></h4>
    <div id="dsProbeBox" class="ds-probe"></div>
   </section>
   <section class="ds-edit-zone ds-edit-now">
    <h4 class="mm-fieldgroup">④ いまの状態</h4>
    <dl class="ds-now">
     <div><dt>いま読んでいる</dt><dd title="${esc(x.activePath||'')}">${esc(x.activePath||(isNew?'（未登録）':'（この端末ではまだ読んでいません）'))}</dd></div>
     <div><dt>保存すると</dt><dd id="dsPlannedPath">—</dd></div>
    </dl>
    <p class="mm-field-hint">読み込み先はサーバー起動時に1回だけ決まります。保存したあとアプリを再起動すると「保存すると」の場所を読みます。</p>
   </section>
  </div>`;
 }
 /* 選んだ読み方の欄だけを開く。**閉じた側も値は残す**ので、切り替えて戻せば
    元の値が入っている。 */
 function dsSyncMode(){
  const form=$('#maintEditorForm');if(!form)return;
  const picked=form.querySelector('[data-ds-mode]:checked');
  const v=picked?picked.value:'share';
  form.querySelectorAll('[data-ds-mode-box]').forEach(box=>{
   box.classList.toggle('is-on',box.dataset.dsModeBox===v);
  });
 }
 function dsDraft(){
  const form=$('#maintEditorForm');if(!form)return null;
  const val=k=>{const el=form.querySelector(`[data-field="${k}"]`);return el?el.value:''};
  const picked=form.querySelector('[data-ds-mode]:checked');
  const pick=picked?picked.value:'share';
  const d={id:dsState.editing?dsState.editing.id:null,
   key:String(val('key')||'').trim().toUpperCase(),label:val('label'),purpose:val('purpose'),
   order:val('order'),enabled:val('enabled'),listed:val('listed')!=='出さない',
   rne:val('rne'),table:val('table'),
   output:val('output'),share:val('share'),preferred:val('preferred'),
   filePattern:String(val('filePattern')||'').trim(),
   overridePath:String(val('overridePath')||'').trim()};
  /* 「直接読む」以外を選んでいるときは上書きを**空で送る＝解除する**。
     直接指定は保存値を持たず、パス設定マスタの上書きの有無そのものなので、
     選択と実体を必ず一致させる（2箇所に持つと必ず食い違う）。 */
  if(pick!=='direct')d.overridePath='';
  /* 「直接読む」を選んでいる間は、**下の設定（共有かRNEか）をそのまま残す**
     ——直接指定を外したときに、覚えのない読み方へ切り替わらないようにする。 */
  const stored=String((dsState.editing&&dsState.editing.mode)||'').trim();
  d.mode=(pick==='rne')?'rne':(pick==='share'?'share':(stored||'share'));
  return d;
 }
 let dsProbeTimer=null;
 function dsProbeSoon(delay){
  clearTimeout(dsProbeTimer);
  dsProbeTimer=setTimeout(dsProbeRun,delay==null?450:delay);
 }
 async function dsProbeRun(){
  const d=dsDraft();if(!d)return;
  const seq=++dsState.probeSeq;
  dsState.probing=true;dsRenderProbe();
  let r=null;
  try{r=await api('/api/data-source-master/probe',{quiet:true,method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(d)})}
  catch(e){r={error:e.message,capability:{features:{}}}}
  if(seq!==dsState.probeSeq)return;          /* 打っている最中の古い結果は捨てる */
  dsState.probing=false;
  dsState.probe=r.capability||{};dsState.probePath=r.path||'';
  if(r.error&&dsState.probe&&!dsState.probe.error)dsState.probe.error=r.error;
  dsRenderProbe();
 }
 function dsRenderProbe(){
  const box=$('#dsProbeBox'),state=$('#dsProbeState'),planned=$('#dsPlannedPath');
  if(!box)return;
  if(state)state.textContent=dsState.probing?'確かめています…':'いまの入力で確認';
  if(planned){
   planned.textContent=dsState.probePath||'—';
   planned.title=dsState.probePath||'';
  }
  const cap=dsState.probe||{},f=cap.features||{};
  const rows=CAPABILITY_ORDER.filter(k=>f[k]).map(k=>{
   const v=f[k];
   return `<div class="mm-cap-row${v.ok?' is-ok':' is-ng'}">
     <span class="mm-cap-mark">${v.ok?'できます':'できません'}</span>
     <span class="mm-cap-name">${esc(CAPABILITY_LABEL[k])}</span>
     <span class="mm-cap-note">${esc(v.note||'')}${v.detail?`<i>${esc(v.detail)}</i>`:''}</span>
    </div>`;
  }).join('');
  const found=$('#dsPatternFound');if(found)found.innerHTML=dsPatternFoundHtml(cap);
  /* 型を入れたら上の欄は「フォルダ」と名乗る（打ちながら言い替える）。 */
  const lab=document.querySelector('[data-path-drop="share"]')?.closest('.mm-field-path')?.querySelector(':scope>span');
  if(lab)lab.textContent=dsDraft()?.filePattern?DS_SHARE_FOLDER:DS_SHARE_FILE;
  box.innerHTML=`${cap.error?`<p class="mm-cap-error">${esc(cap.error)}</p>`:''}
   ${rows||'<p class="mm-cap-error">まだ確かめていません。</p>'}
   <p class="mm-cap-foot">${esc(cap.table?`読んだのは表「${cap.table}」の${cap.columnCount}列です。`:'')}
    保存する前に、いま入力している場所を実際に開いて確かめています。</p>`;
 }
 async function saveDataSourceEditor(){
  const d=dsDraft();if(!d)return;
  const uid=requireMaintUser();if(uid===null)return;
  if(!d.key){showToast&&showToast('キーを入れてください','一覧を指す識別子です（半角英数と _）',5000);return}
  const url=d.id?'/api/data-source-master/update':'/api/data-source-master';
  try{
   setMaintLoading(true,'保存しています…');
   const r=await api(url,{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({...d,user_id:uid})});
   closeMaintEditor();
   dsState.loaded=false;await loadDataSourceMaint(true);
   showToast&&showToast('保存しました',(r&&r.message)||'',5200);
  }catch(e){showToast&&showToast('保存できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }

 /* ---------- パス設定（参照データの読み込み先・共有パス・各種間隔。旧config/local.json） ----------
    複数の値を持つ一覧ではなく1組の設定値のため、列表示マスタと同じ「特別扱い」
    にする。sikalot_source/sikalotnow_path/sikalotdef_path/records_backup_export_path/
    schedule_share_pathはサーバー起動時に1回だけ接続先へ反映されるため、保存後も
    このプロセスでは反映されない(再起動が必要)。一覧欄には「保存値」と「現在
    有効な値(このプロセス)」を並べて表示し、反映済みかを確認できるようにする。 ---------- */
 /* 他の画面から「置き場で決める」で来たときの行き先（§9.267）。共通設定は
    非同期で組み上がるので、押した時点ではまだ段が無い。 */
 let pcPendingSection='';
 let pcPendingLook=false;
 /* 「表示」バッジの行き先（§9.436）。**この画面の作りを知っているのは
    ここだけ**なので、base.js の口（`WL.openLookSettings`）へ実体を入れる。
    「この端末」の段を開いたうえで、読み込みの見せ方の盤まで連れて行く
    ——「共通設定を開く」だけだと、どの段に在るかを自分で探すことになる
    （§CLAUDE 2「次にすることを1つだけ指す」）。 */
 WL.openLookSettings=()=>{
  pcPendingSection='terminal';pcPendingLook=true;
  if(typeof window.openMasterMaint==='function')window.openMasterMaint('pathConfig');
  else showToast('共通設定を開けません','マスタ管理を読み込めていません',5000);
 };
 /* **いま開けるか**を口そのものが答える（§9.445）。共通設定はスケジュール
    モードでは出ない（`maintDefVisible()`）ので、行き先を押せる形で出すと
    **身に覚えのないタブへ飛ぶ**（実測: 換算係数マスタが開いた）。
    ——「できないことは、できないと書く」（§CLAUDE 4）。 */
 WL.openLookSettings.available=()=>!!(WL.mm&&typeof WL.mm.maintTabOpenable==='function'
  &&WL.mm.maintTabOpenable('pathConfig')&&typeof window.openMasterMaint==='function');
 let pathConfigState={values:{},defaults:{},active:{},sources:[],storage:null,storageError:"",loaded:false};
 /* 再起動しないと反映されない項目。データソースぶんは登録内容から作るので
    ここには固定で書かない(§9.81)。以前は「仕掛(SIKALOTNOW)」等が直接
    書かれており、データソースを増やしても増えず、名前を変えても古い
    ままだった。 */
 const PATH_CONFIG_RESTART_BASE=[['sikalot_source','参照データの取得元']];
 const PATH_CONFIG_RESTART_TAIL=[
  ['records_share_dir','測定データの置き場（設備ごと）'],
  ['records_backup_export_path','測定データバックアップの複製先'],
  ['schedule_share_path','スケジュール共有パス(schedule.sqlite3)'],
 ];
 function pathConfigRestartFields(){
  return [...PATH_CONFIG_RESTART_BASE,
          ...(pathConfigState.sources||[]).map(src=>[src.valueKey,`${src.label}（${src.key}）の読み込み先`]),
          ...PATH_CONFIG_RESTART_TAIL];
 }
 async function loadPathConfigMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&pathConfigState.loaded){renderPathConfigForm();renderPathConfigList();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   /* 置き場は**別の口**が答える（§9.267）——`config/local.json`の側も
      含めた1枚の答えで、パス設定マスタの読み書きとは持ち主が違う。
      **読めなくても共通設定は開く**（置き場の節だけが空になる）。 */
   const [r,st]=await Promise.all([
    api('/api/path-config-master'),
    api('/api/storage-layout').catch(e=>({error:e.message})),
   ]);
   pathConfigState.values=r.values||{};pathConfigState.defaults=r.defaults||{};pathConfigState.active=r.active||{};pathConfigState.sources=r.sources||[];
   pathConfigState.storage=(st&&st.items)?st:null;
   pathConfigState.storageError=(st&&st.error)||'';
   pathConfigState.loaded=true;
   renderPathConfigForm();renderPathConfigList();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 /* ---------- 共通設定の作り（§9.583、利用者の指示でゼロから組み直した） ----------
    「タブがわかりにくい、ボタンがわかりにくいなどをはじめ文字がゴチャついて…サブ的な情報は
     コンパクトに圧縮しメインコンテンツの表示領域を大きく確保して見やすくわかりやすい設計に」

    直す前に測った値（評価関数・docs/decisions/9.583.md）: 主役の前に図＋札＋見出しが器の20〜28%、
    1画面の字が600〜1300字でほぼ全部12px、札は12pxで中身を名乗らず166〜205px散らばる、段の名前を
    中でもう一度見出しで言う、読み取り専用の値に入力欄風の枠、置き場は器の2〜2.8倍の長さ。
    7案を撮って2回採点し、決めた形は次の5つ:
     ① **札（タブ）が状態を言う**——絵・名前・要対応の数・いまの一言。上の図はやめた（同じことを札が言う）。
     ② **段の中は「1行＝名前｜欄｜状態」**。名前の列は固定幅（§CLAUDE 9）。説明は ⓘ へ畳む。
     ③ **置き場は群ごとに畳める表**。群の見出しに件数と状態、行の補足（出どころ・効く時・メモ）は ⋯ へ。
     ④ **共有と同期は1節1行の畳み**（同時に開くのは1つ）。見出しにいまの値。
     ⑤ 保存の帯は「保存｜変えた数｜再起動待ち」——押す前に何が変わるかを言う。
    保存の仕組み（`[data-pc-field]`／`[data-lc-field]`を集めて送る）は変えていない。 */
 /* `sub`＝左の一覧の副題（何の段か・決まった字・8字まで）。状態は札（`data-tab-state`）が言う（§9.598 1h）。 */
 const PC_TABS=[
  {key:'terminal',name:'この端末',icon:'fa-desktop',sub:'名前と見え方'},
  {key:'place',name:'置き場',icon:'fa-folder-tree',sub:'共有と手元'},
  {key:'sync',name:'共有と同期',icon:'fa-arrows-rotate',sub:'見張りと書き込み'},
  {key:'rne',name:'RNE抽出',icon:'fa-file-export',sub:'定期の抽出'},
  {key:'update',name:'アプリの更新',icon:'fa-cloud-arrow-down',sub:'配る版'},
 ];
 /* 選ばせる設定の顔ぶれは**ここ1箇所**（欄の選択肢・畳んだ見出しのいまの値・札の一言が同じ答えを読む）。
    `def`はサーバーの既定、`short`は札の一言に使う短い言い方。 */
 const PC_CHOICES={
  sikalot_source:{def:'network',opts:[['network','network: 共有フォルダを読む'],['local','local: この端末でRNEから作ったものを読む']]},
  db_mirror_update:{def:'auto',opts:[['auto','auto: 元が変われば直ちに写し直す'],['manual','manual: 一覧の「再読込」を押したときだけ']]},
  schedule_watch_enabled:{def:'auto',short:{auto:'見張る',on:'見張る',off:'見張らない'},
   opts:[['auto','auto: 見張る'],['on','on: 見張る'],['off','off: 見張らない（読むたびに共有から写す）']]},
  schedule_owner_enabled:{def:'on',short:{on:'1台が書く',off:'各PCが書く'},
   opts:[['on','on: 最初に入った1台が書き込み役になる'],['off','off: 各PCが自分で共有へ書く']]},
  schedule_session_block:{def:'off',opts:[['off','off: 止めない（主担当を表示するだけ）'],['on','on: 後から入った端末は読み取り専用']]},
  schedule_source_sync:{def:'auto',opts:[['auto','auto: 見つけたら更新する'],['confirm','confirm: 変わった中身（旧→新）を見せてから取り込む']]},
  rne_extract_enabled:{def:'auto',opts:[['auto','auto: 取得元が local のときだけ'],['on','on: 取得元に関わらず定期実行する'],['off','off: 定期実行しない（手動のみ）']]},
 };
 const pcSaved=key=>String((pathConfigState.values||{})[key]||'').trim();
 /* いま効いている選択の値（保存値 → このプロセスの値 → 既定）。 */
 function pcChoiceRaw(key){
  const c=PC_CHOICES[key];
  return pcSaved(key)||String((pathConfigState.active||{})[key]||'').trim()||(c&&c.def)||'';
 }
 /* 畳んだ見出しへ出す「いま効いている値」（§3・§9.125）。綴り（`auto:`）は外して言葉だけ。
    **保存値が空なら既定を名乗る**——空欄のままだと、畳んだ中に何が入っているのか読めない。 */
 function pcChoiceWord(key){
  const c=PC_CHOICES[key],raw=pcChoiceRaw(key);
  const hit=c&&c.opts.find(o=>o[0]===raw);
  const word=hit?hit[1].replace(/^[a-z]+:\s*/,''):raw;
  return pcSaved(key)?word:`${word}（既定）`;
 }
 const pcChoiceShort=key=>{const c=PC_CHOICES[key];return (c&&c.short&&c.short[pcChoiceRaw(key)])||pcChoiceWord(key)};
 /* 数の設定のいまの値（保存値が空なら既定）。 */
 const pcNum=(key,unit)=>{const v=pcSaved(key)||String((pathConfigState.defaults||{})[key]||'');return v?v+(unit||''):'—'};
 /* 再起動が要る設定の印（`renderPathConfigList()`が「再起動待ち」へ塗り替える）。 */
 const PC_WHEN_RESTART='<span class="pc-when">再起動で反映</span>';
 /* ---------- この端末の見え方への行き先（§9.433 → §9.583） ----------
    **設定そのものは「表示」バッジの1箇所のまま**（§9.421「この端末の見え方の入口は1つ。節を足す・
    入口は増やさない」）。ここに置くのは**いまの値と行き先**の1行だけ（§9.433 の作法）。 */
 /* 読み込みの見せ方は**ここで選ぶ**（§9.436、利用者の指示「読み込みの見せ方を
    マスタに持ってきて、広いエリアでわかりやすく選べるように」）。

    なぜ「表示」バッジから移したか（実測）
    ------------------------------------------------------------------
    種類が6→29になり、**あのポップオーバーには入らない**——1種46px＝29種で
    1334px、画面の高さ（実測1152px）を超える。狭い縦1列で29種を数えさせるのは
    「探させない」に反する。**広い場所で、形の族ごとに、見本を大きく**出す。

    ・見本は44px（バッジの15pxの約9倍の面積）。**選ぶ前に動きが見える**
      （§9.200「選ばせるものは選ぶ前に見える」）。
    ・族（輪・波紋・球…）で束ね、族ごとに一言を添える。29回の見比べを
      「族を1つ選ぶ＋その中の4〜5枚」に減らす。
    ・使用中は**枠の色＋「使用中」の字**の両方で言う（色だけで言わない・
      §CLAUDE 3）。札は絶対配置なので、選び直しても**1pxも動かない**
      （§9.227）。

    **設定の持ち主は`WL.loader`の1箇所のまま**。ここは面を1つ足しただけで、
    押すと`WL.loader.setStyle()`を呼び、`wl:look-change`で「表示」バッジ側の
    いまの値も塗り直る（§9.433）。 */
 const pcLdCard=l=>`<button type="button" class="pc-ld-card" data-loader-option="${esc(l.key)}">
    <span class="pc-ld-fig">${WL.loader.html(44,'',l.key)}</span>
    <b>${esc(l.label)}</b><small>${esc(l.hint)}</small>
    <em class="pc-ld-on">使用中</em></button>`;
 const pcLdGroupHtml=g=>{
  const cards=WL.loader.STYLES.filter(l=>l.group===g.key).map(pcLdCard).join('');
  if(!cards)return '';
  return `<section class="pc-ld-group">
    <h6>${esc(g.name)}<small>${esc(g.note)}</small></h6>
    <div class="pc-ld-grid">${cards}</div></section>`;
 };
 /* 見え方の1行（文字の大きさ・時間の書き方・読み込み）。決めるのはヘッダーの「表示」。 */
 function pcLookRowHtml(K){
  return K.row('look','見え方',`<span class="pc-look-now" id="pcLookNow"></span>
    <button type="button" class="mm-btn-ghost sm" id="pcLookOpen"><i class="fa-solid fa-sliders" aria-hidden="true"></i> 「表示」を開く</button>`,
   {id:'pcLook',tip:'この端末だけに効く設定です（サーバーへは送りません）。文字の大きさ・時間の書き方は、どの画面からも触れるようヘッダーの「表示」に畳んであります。'});
 }
 /* 読み込みの見せ方の盤。器は**共通設定の他の節と同じ畳み**（`.pc-acc`）——29種の盤を
    そのまま置くと段が1687pxになる。畳んだままでも見出しが**いまの見せ方そのもの**を動かして見せる。 */
 function pcLdHtml(){
  /* 畳みのままだが**見出しは他の行と同じ格子**（名前｜いまの値｜開く印・§9.598 1h）——箱の畳みが1つだけ別の形で浮いていた。 */
  return `<details class="pc-acc pc-ld is-row" id="pcLd">
    <summary><b class="pc-row-label">読み込みの見せ方${tipHtml(
      `データを待っているあいだに出る動くしるしです。loaders.css（MIT）から${WL.loader.STYLES.length-1}種を写して**同梱**しています（回線が無い端末でも動きます）。`
      +'仲間ごとに並べてあります——まず仲間を1つ選び、その中の4〜5枚を見比べてください。')}</b><span class="pc-row-ctl"><span class="ld-sample">${WL.loader.html(16)}</span>
     <span class="pc-acc-now pc-ld-now" id="pcLdNow"></span>
     <span class="mm-btn-ghost sm pc-ld-open" aria-hidden="true">一覧から選ぶ<i class="mm-hd-caret">▾</i></span></span></summary>
    <div class="pc-acc-body">${WL.loader.GROUPS.map(pcLdGroupHtml).join('')}</div>
   </details>`;
 }
 /* いまの値は**設定を持っている1箇所から引く**（字を書き写さない・§9.374）。 */
 function renderLook(){
  const el=$('#pcLookNow');if(!el)return;
  const nameOf=(list,key)=>((list||[]).find(x=>x.key===key)||{}).label||key||'';
  const parts=[];
  if(window.WL&&WL.uiSize)parts.push('文字 '+nameOf(WL.uiSize.SIZES,WL.uiSize.size()));
  if(window.WL&&WL.duration)parts.push('時間 '+nameOf(WL.duration.STYLES,WL.duration.style()));
  if(window.WL&&WL.loader)parts.push('読み込み '+nameOf(WL.loader.STYLES,WL.loader.style()));
  el.textContent=parts.join('・');
  const now=$('#pcLdNow');
  if(now&&window.WL&&WL.loader){
   now.textContent=`いま「${WL.loader.labelOf()}」・全${WL.loader.STYLES.length}種`;
   /* 描いた直後は札にまだ印が無い（印を付ける役は`WL.loader`の1箇所）。 */
   WL.loader.mark();
  }
 }
 /* ---------- デスクトップの起動アイコン（§9.410 → §9.445） ----------
    **盤はヘッダーの「表示」の節**（§9.445、利用者の指示「どのモードからも
    使えるように」）。以前はここ（共通設定＞この端末）が唯一の面だったが、
    **共通設定はスケジュールモードでは出ない**（`maintDefVisible()`は
    `/api/schedule/`のマスタだけを残す）ので、**現場の端末からは作れなかった**
    ——サーバーは3モードとも通していた（`access_mode._ENDPOINT_EXTRA_MODES`の
    `core.app_shortcut_create`）のに、画面の入口だけが無い状態。
    入口を増やさず（§9.421）、**どの画面からも開ける「表示」へ節を1つ足す**。
    ここ（共通設定）に残すのは**いまの状態と行き先だけ**（§9.433 の作法）。 */
 const shortcutState={loaded:false,loading:null,info:null,error:''};

 /* 状態の字は**1箇所**（作成済み／まだ／作れない理由）。面が2つあるので、
    どちらかにだけ書くと食い違う。色だけで言わない（§CLAUDE 3）。 */
 function shortcutFace(){
  if(shortcutState.error)return {cls:'is-bad',text:shortcutState.error};
  const info=shortcutState.info;
  if(!shortcutState.loaded||!info)return {cls:'',text:'確認しています…'};
  /* 作れない端末は**誤りではなく端末の事実**（灰の字・§9.598 1h）。赤は直すべきことだけ。 */
  if(!info.supported)return {cls:'is-na',text:info.why||'この端末では作れません',off:true};
  return info.exists?{cls:'is-done',text:`作成済み（${info.updatedAt||'日時不明'}）`}
                    :{cls:'is-todo',text:'まだ作っていません'};
 }
 /* 塗る役も1箇所（§9.436 の`WL.loader.mark()`と同じ作法）。器を名指しせず、
    **`[data-sc-state]`を名乗る物**を塗る——面が増えてもここは触らない。 */
 function paintShortcut(){
  const f=shortcutFace();
  document.querySelectorAll('[data-sc-state]').forEach(el=>{
   el.className='lnk-state'+(f.cls?' '+f.cls:'');
   el.textContent=f.text;
  });
  /* 作れない端末では行き先（「表示」で作る）を**出さない**（使えない機能はボタンごと消す・§CLAUDE 4・§9.598 1j）。字が理由を言う。 */
  const go=document.getElementById('pcScOpen');
  if(go)go.hidden=!!f.off;
  renderShortcutPanel();
 }
 /* 「表示」の節の中身。**値はサーバーの答えから入れる**（§9.163）——共通設定を
    一度も開いていない端末でも、残してある名前と絵が読める。

    並びは**することの順**（§CLAUDE 2・14）: いまどうか → 作る → どこへ出来るか。
    **名前と絵は畳む**（§CLAUDE 1 面積は「頻度 × 重要度」）——端末ごとに1回
    決めれば済むものに、常時3行を割かない。畳んだ札には**いまの値を書く**
    （§9.433「畳んだ入口の説明には節を全部書く」）ので、開かずに読める。 */
 function shortcutPanelHtml(){
  return `<div class="lnk" id="lnkPanel">
   <p class="lnk-state" data-sc-state>確認しています…</p>
   <div class="lnk-body" id="lnkBody" hidden>
    <!-- **押すと何が起きるかを先に言う**（§9.446・§CLAUDE 4・14）——作るのか、
         自分のを作り直すのか、別の物へ上書きするのか、前の名前を付け替えるのか。
         **ボタンより上**に置く（読む順と押す順を合わせる）。 -->
    <p class="lnk-plan" id="lnkPlan" hidden></p>
    <div class="lnk-act">
     <button type="button" class="mm-btn-primary" id="lnkMake">デスクトップに作る</button>
    </div>
    <!-- **作成先と行き先は押す前に読める**（§CLAUDE 6 出どころ）。 -->
    <p class="lnk-where" id="lnkWhere"></p>
    <details class="lnk-more" id="lnkMore">
     <summary>名前と絵を変える<small id="lnkNow"></small></summary>
     <div class="lnk-more-body">
      <label class="lnk-field"><span>アイコンの名前</span>
       <input id="lnkName" type="text" maxlength="40" autocomplete="off" spellcheck="false">
       <small>デスクトップに出る字です。空欄なら既定の名前（欄の薄い字）で作ります。</small></label>
      <div class="lnk-field"><span>絵</span>
       <div class="lnk-icon">
        <!-- **見本は実物と同じ絵**（§9.374）。.ico を描くのと同じ1箇所
             （app_icon.render）から取るので、色を書き写さない。 -->
        <label><input type="radio" name="lnkIcon" value="default" data-sc-icon checked>
         <img class="lnk-mark" src="/api/app/icon.png?size=64" alt="" width="20" height="20">
         <span>アプリのマーク</span></label>
        <label><input type="radio" name="lnkIcon" value="file" data-sc-icon>
         <span>ファイルを指定</span></label>
       </div>
       <span class="mm-path" data-path-drop="shortcut_icon" id="lnkIconPath" hidden>
        <input data-field="shortcut_icon" id="lnkIconFile" type="text"
          placeholder="例: D:\\icons\\wavelog.ico" autocomplete="off" spellcheck="false">
        <button type="button" class="mm-path-browse" data-path-browse="shortcut_icon" data-path-mode="file">参照…</button>
       </span>
       <small>.ico / .exe / .dll が使えます（.exe・.dll は中の1つ目の絵を使います）。</small></div>
     </div>
    </details>
   </div>
  </div>`;
 }
 /* 押すと何が起きるか（§9.446）。**答えはここ1箇所**——ボタンの字も、
    その下の1行も、同じ判断から出す（言い分けが2箇所にあると食い違う）。
      make    … 新しく作る
      remake  … 自分が作ったものを作り直す（上書き）
      replace … 同じ名前の**別の**ショートカットへ上書きする（確認を挟む）
    `renameFrom`＝名前を変えたので片付ける前の名前（無ければ空）。 */
 function shortcutPlan(){
  const info=shortcutState.info||{};
  const kind=!info.exists?'make':(info.mine?'remake':'replace');
  /* 付け替えは**残してある名前**と、いま作ろうとしている名前の違いで決まる
     （判定そのものはサーバーの`rename_from()`と同じ形）。 */
  const now=String(info.name||'').trim();
  const prev=String(info.savedName||'').trim();
  return {kind,renameFrom:(prev&&prev!==now)?prev:'',
          label:{make:'デスクトップに作る',remake:'作り直す',replace:'上書きして作る'}[kind]};
 }
 /* 畳んだ札に出す「いまの値」。**欄から読む**（打ち換えたその場で書き直る）。 */
 function shortcutNowText(root){
  const name=String((root.querySelector('#lnkName')||{}).value||'').trim();
  const info=shortcutState.info||{};
  const pick=root.querySelector('[data-sc-icon]:checked');
  const file=String((root.querySelector('#lnkIconFile')||{}).value||'').trim();
  const icon=(pick&&pick.value==='file')
   ?(file?file.split(/[\\/]/).pop():'ファイル未指定')
   :'アプリのマーク';
  return `いま: ${name||info.defaultName||''}／${icon}`;
 }

 /* 盤を描き直す。**打っている最中の欄は触らない**（§9.433）——状態の問い合わせは
    遅れて戻るので、後から書き戻すと入力中の字が消える。値を入れるのは
    「まだ一度も入れていないとき」と「作った直後」だけ。 */
 function renderShortcutPanel(){
  const panel=document.getElementById('lnkPanel');if(!panel)return;
  const body=panel.querySelector('#lnkBody'),where=panel.querySelector('#lnkWhere');
  const info=shortcutState.info;
  const ok=!!(shortcutState.loaded&&info&&info.supported&&!shortcutState.error);
  if(body)body.hidden=!ok;
  if(!ok)return;
  const name=panel.querySelector('#lnkName');
  if(name)name.placeholder=info.defaultName||'';
  if(panel.dataset.filled!=='1'){
   /* 欄に出すのは**残してある名前そのもの**（`savedName`）。`name`は「空なら
      既定へ倒した結果」なので、そちらを入れると**決めていない名前を決めた
      ように見える**（空欄なら既定が薄い字で出る）。 */
   if(name)name.value=String(info.savedName||'');
   const file=panel.querySelector('#lnkIconFile'),box=panel.querySelector('#lnkIconPath');
   if(file)file.value=String(info.icon||'');
   const pick=panel.querySelector(`[data-sc-icon][value="${info.icon?'file':'default'}"]`);
   if(pick)pick.checked=true;
   if(box)box.hidden=!info.icon;
   panel.dataset.filled='1';
  }
  if(where)where.innerHTML=`作成先 <code>${esc(info.link||'')}</code><br>`
   +`起動するもの <code>${esc(info.target||'')}</code>`;
  const now=panel.querySelector('#lnkNow');
  if(now)now.textContent=shortcutNowText(panel);
  /* **押す前に何が起きるかを字で言う**（§9.446・§CLAUDE 4・6）。
     色だけで言わない——分類名（上書き／作り直し／付け替え）を書く。 */
  const plan=shortcutPlan();
  const make=panel.querySelector('#lnkMake');
  if(make&&!make.disabled)make.textContent=plan.label;
  const line=panel.querySelector('#lnkPlan');
  if(line){
   const bits=[];
   if(plan.kind==='remake')bits.push('同じ名前でいま在るものを<b>上書き</b>します。');
   if(plan.kind==='replace')bits.push('同じ名前の<b>別のショートカット</b>があります（行き先 <code>'
     +esc(info.linkTarget||'不明')+'</code>）。押すと<b>上書き</b>します（確認します）。');
   if(plan.renameFrom)bits.push(`前の「${esc(plan.renameFrom)}」は<b>付け替え</b>ます（2つ残しません）。`);
   line.innerHTML=bits.join('<br>');
   line.hidden=!bits.length;
   line.className='lnk-plan'+(plan.kind==='replace'?' is-warn':'');
  }
 }
 /* 盤の配線。**器を渡されるだけ**（§9.444）——土台は中身を知らない。 */
 function bindShortcutPanel(root){
  const make=root.querySelector('#lnkMake');
  if(make)make.onclick=()=>makeShortcut(root);
  root.querySelectorAll('[data-sc-icon]').forEach(r=>{r.onchange=()=>{
   const box=root.querySelector('#lnkIconPath'),el=root.querySelector('#lnkIconFile');
   if(box)box.hidden=r.value!=='file'||!r.checked;
   /* **「アプリのマーク」を選んだら指定は空にする**（§9.433）——値を残したまま
      既定を選ぶと、見えない欄のほうが効いてしまう。 */
   if(box&&box.hidden&&el)el.value='';
   paintNow();
   if(box&&!box.hidden&&el)el.focus();
  }});
  /* 畳んだ札の「いまの値」は**打ったその場で書き直す**（§9.433）——畳んだ先の
     値が古いままだと、開くまで何が効いているのか分からない。 */
  function paintNow(){
   const now=root.querySelector('#lnkNow');
   if(now)now.textContent=shortcutNowText(root);
  }
  root.querySelectorAll('#lnkName,#lnkIconFile').forEach(el=>{
   el.addEventListener('input',paintNow);
   el.addEventListener('change',paintNow);
  });
  /* **打った名前で状態を取り直す**（§9.446）。作成先も「作り直しか・別の物へ
     の上書きか・付け替えか」も、**その名前で決まる**ので、打ったままの名前で
     聞き直さないと画面が嘘をつく（§CLAUDE「推測させない」）。
     打つたびには聞かない（落ち着いてから1回）。 */
  const nameEl=root.querySelector('#lnkName');
  if(nameEl)nameEl.addEventListener('input',()=>{
   clearTimeout(shortcutState.probeTimer);
   shortcutState.probeTimer=setTimeout(()=>probeShortcut(String(nameEl.value||'').trim()),350);
  });
  /* 「参照…」とドラッグ&ドロップは**マスタ画面の道具をそのまま使う**
     （§9.49。同じ役目の物を2つ作らない）。 */
  bindPathFields(root);
 }
 /* 状態は**1回だけ取りに行く**（開くたびに聞き直さない）。作った直後だけ
    `force`で取り直す。 */
 function loadShortcut(force){
  if(shortcutState.loading)return shortcutState.loading;
  if(shortcutState.loaded&&!force){paintShortcut();return Promise.resolve()}
  shortcutState.loading=(async()=>{
   try{
    shortcutState.info=await api('/api/app/shortcut');
    shortcutState.error='';
   }catch(e){
    shortcutState.info=null;
    shortcutState.error='ショートカットの状態を読めませんでした: '+(e&&e.message||e);
   }
   shortcutState.loaded=true;shortcutState.loading=null;
   paintShortcut();
  })();
  return shortcutState.loading;
 }
 /* その名前での状態を取り直す（§9.446）。**判定はサーバーの1箇所**
    （`status()`）が答えるので、画面は聞いて出すだけ。読めなければ**黙って
    前の答えのまま**——打っている最中に断りを出しても直しようがない
    （押したときは`create()`が改めて断る）。 */
 async function probeShortcut(name){
  if(!document.getElementById('lnkPanel'))return;
  try{
   const info=await api('/api/app/shortcut?name='+encodeURIComponent(name||''));
   if(!document.getElementById('lnkPanel'))return;
   shortcutState.info=info;shortcutState.error='';shortcutState.loaded=true;
   paintShortcut();
  }catch(e){WL.quiet.note('打った名前での状態を取り直せない（前の答えのまま出す）',e)}
 }
 /* 作る。**結果は同じ場所で言う**（トーストは消えるので、状態の字も直す）。
    名前と絵は**サーバーが作ったときに残す**（§9.445）——共通設定の保存に
    頼っていると、その画面が出ないモードでは名前が毎回既定へ戻る。 */
 async function makeShortcut(root){
  const btn=root.querySelector('#lnkMake');if(!btn)return;
  const picked=root.querySelector('[data-sc-icon]:checked');
  const useFile=picked&&picked.value==='file';
  const iconEl=root.querySelector('#lnkIconFile');
  const icon=useFile?String((iconEl&&iconEl.value)||'').trim():'';
  if(useFile&&!icon){
   showToast('アイコンのファイルを指定してください','「参照…」から .ico / .exe / .dll を選べます',5000);
   if(iconEl)iconEl.focus();
   return;
  }
  const name=String((root.querySelector('#lnkName')||{}).value||'').trim();
  const label=btn.textContent;
  btn.disabled=true;btn.textContent='作っています…';
  /* 投げるのは1箇所（`send`）。**上書きしてよいか**だけを変えて投げ直す
     ——同じ組み立てを2箇所に書かない。 */
  const send=overwrite=>api('/api/app/shortcut',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name,icon,overwrite:!!overwrite})});
  try{
   let r;
   try{r=await send(false)}
   catch(e){
    /* **他人の物の上書きは、確認してから**（§9.446・§CLAUDE 5）。
       確認すれば進めるものだけ聞き直す（それ以外はそのまま断る）。 */
    if(!(e&&e.needConfirm))throw e;
    /* 名前は**実際に作られる名前**で言う（空欄なら既定の名前）——
       「（既定の名前）」とだけ書くと、どのアイコンの話か分からない。 */
    const shown=name||String((shortcutState.info||{}).defaultName||'');
    const okGo=await confirmModal({title:'同じ名前のショートカットがあります',
      message:`デスクトップの「${shown}」は、このアプリが作ったものではありません。\n`
        +`いまの行き先: ${e.linkTarget||'不明'}\n\n`
        +'上書きすると、そのショートカットは測定伝送システムの起動用に書き換わります。よろしいですか？',
      confirmLabel:'上書きする',danger:true});
    if(!okGo){showToast('上書きをやめました','デスクトップのショートカットはそのままです',3600);return}
    r=await send(true);
   }
   shortcutState.info=r;shortcutState.error='';shortcutState.loaded=true;
   /* 作った内容で入れ直す（名前を空欄のまま作ると既定の名前が付く）。 */
   const panel=document.getElementById('lnkPanel');
   if(panel)panel.dataset.filled='';
   paintShortcut();
   /* **何をしたかを言う**（作った／書き換えた／付け替えた）。 */
   const head=r.renamedFrom?'デスクトップのショートカットを付け替えました':'デスクトップに作りました';
   const detail=(r.renamedFrom?`「${r.renamedFrom}」→ `:'')+(r.link||'');
   showToast(head,detail,4600);
  }catch(e){
   showToast('作れませんでした',String(e&&e.message||e),6000);
  }finally{
   btn.disabled=false;btn.textContent=label;
   /* 控えた字を戻したあとに描き直す（作ったあとは「作り直す」になる）。 */
   renderShortcutPanel();
  }
 }
 /* **ヘッダーの「表示」へ節を名乗る**（§9.444 の口・§9.445）。`when`を持たない
    ＝どの画面・どのモードでも出す——これがこの節の値打ちそのもの。
    作れない端末では盤を伏せ、**理由を字で書く**（§CLAUDE 4）。 */
 WL.lookSettings.register({
  key:'shortcut',
  title:'デスクトップの起動アイコン',
  render(host){
   host.innerHTML=shortcutPanelHtml();
   bindShortcutPanel(host);
   paintShortcut();
   loadShortcut();
  },
 });
 /* 起動したあと、デスクトップに起動アイコンが無ければ作るか聞く（§9.559、利用者の指示「アプリのショートカットが
    デスクトップになければ、許可を求めつくられる」）。聞くかどうかは**サーバーの1箇所**（`desktop_shortcut.offer()`）が
    答える——窓の中・作れる端末・アイコンが無い・この PC で断っていない。断ったら次からは聞かない（「表示」から作れる）。 */
 async function offerShortcut(){
  if(!WL.base.inDesktopShell())return;
  let info;
  try{info=await api('/api/app/shortcut',{quiet:true})}
  catch(e){WL.quiet.note('起動アイコンの状態を読めない（聞かずに続ける）',e);return}
  if(!info||!info.offer)return;
  const ok=await confirmModal({title:'デスクトップに起動アイコンを作りますか？',
   message:`次からは、デスクトップの起動アイコンから開けます（この PC へ写したアプリが開きます。共有の置き場を通しません）。\n`
     +`作る場所: ${info.createAt||info.link}\n\n作らない場合も、あとでヘッダーの「表示」から作れます。`,
   confirmLabel:'作る',cancelLabel:'作らない'});
  try{
   if(!ok){
    await api('/api/app/shortcut/decline',{method:'POST'});
    showToast('起動アイコンは作りませんでした','作るときはヘッダーの「表示」から作れます',5000);
    return;
   }
   const r=await api('/api/app/shortcut',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({name:'',icon:'',overwrite:false})});
   shortcutState.info=r;shortcutState.loaded=true;
   showToast('デスクトップに起動アイコンを作りました',r.link||'',5000);
  }catch(e){showToast('起動アイコンを作れませんでした',String(e&&e.message||e),6000)}
 }
 WL.onReady(offerShortcut);
 /* 共通設定（この端末）に残すのは**いまの状態と行き先だけ**（§9.445。作法は
    §9.433「読み込みの見せ方」と同じ——設定の持ち主は1箇所で、面が2つ）。1行に収める。 */
 function pcShortcutHtml(K){
  return K.row('shortcut','起動アイコン',`<span class="lnk-state" data-sc-state>確認しています…</span>
    <button type="button" class="mm-btn-ghost sm" id="pcScOpen"><i class="fa-solid fa-sliders" aria-hidden="true"></i> 「表示」で作る</button>`,
   {id:'pcShortcut',tip:'毎日の入口（**この PC の WaveLog.exe**）へのデスクトップのショートカットです。作る・名前と絵を決めるのはヘッダーの「表示」——**どのモードからも開けます**。'});
 }

 /* 共通設定の部品（§9.583）。どれも字を返すだけ（画面を読まない）。`v`は保存してある値。
    **1行＝名前｜欄｜状態**——名前の列は固定幅（§CLAUDE 9）、説明は名前の横の ⓘ（`tipHtml`）、
    状態の席（`data-pc-state`）は`renderPathConfigList()`が後から埋める。 */
 function pcKit(v){
  const row=(key,label,ctl,o)=>{
   const p=o||{};
   return `<div class="pc-row${p.cls?' '+p.cls:''}"${p.id?` id="${esc(p.id)}"`:''} data-pc-row="${esc(key)}">
    <span class="pc-row-label">${esc(label)}${tipHtml(p.tip)}</span>
    <div class="pc-row-ctl">${ctl}</div>
    <span class="pc-row-state" data-pc-state="${esc(key)}">${p.state||''}</span></div>`;
  };
  /* パス欄は「参照…」ダイアログとドラッグ&ドロップに対応させる（§9.49）。 */
  const path=(key,mode,ph)=>`<span class="mm-path" data-path-drop="${esc(key)}">
    <input data-pc-field="${esc(key)}" data-field="${esc(key)}" type="text" value="${esc(v[key]||'')}"
     placeholder="${esc(ph||'未設定（既定を使う）')}" autocomplete="off" spellcheck="false">
    <button type="button" class="mm-path-browse" data-path-browse="${esc(key)}" data-path-mode="${esc(mode||'file')}">参照…</button></span>`;
  /* 数の欄。**既定は欄の薄字で言う**（以前は欄ごとに「未入力なら既定値 900秒 を使用します」の1行があった）。 */
  const num=(key,label,unit,step,min)=>numFieldHtml({k:key,label,unit,step,min},v[key]||'',
   `data-pc-field="${esc(key)}" placeholder="${esc(String((pathConfigState.defaults||{})[key]||''))}"`);
  const pick=key=>{
   const c=PC_CHOICES[key],def=c.opts.find(o=>o[0]===c.def);
   return `<select data-pc-field="${esc(key)}">${[['',`（既定）${def?def[1]:c.def}`],...c.opts].map(([val,t])=>
    `<option value="${esc(val)}"${(v[key]||'')===val?' selected':''}>${esc(t)}</option>`).join('')}</select>`;
  };
  const text=(key,ph)=>`<input data-pc-field="${esc(key)}" type="text" value="${esc(v[key]||'')}"
    placeholder="${esc(ph||'')}" autocomplete="off" spellcheck="false">`;
  /* 共有と同期の1節（同じ名前の畳みは同時に1つだけ開く＝`<details name>`）。 */
  const fold=(id,icon,title,now,tip,body,tag)=>pageFoldHtml(title,now,`<div class="pc-rows">${body}</div>`,false,
   {icon,tip,tag,name:'pcSync',id:'pcSync-'+id,cls:'pc-sync'});
  return {row,path,num,pick,text,fold};
 }
 /* 段「この端末」: 名乗り（読むだけ）→ 名前の決め打ち → 見え方 → 起動アイコン → 読み込みの見せ方。 */
 /* PC名の出どころは**利用者の言葉**で（§9.598 1j）: 下の「名前を決め打ちする」で決めたか、OS から自動で取ったか。
    取った道具の名前（socket.gethostname() など・サーバーの`_pc_name_candidates()`の綴り）は title だけが持つ。 */
 function pcFromWord(from){
  if(!from)return '出どころ不明';
  return /^設定/.test(from)?'下の欄で決め打ち':'OS から自動で取得';
 }
 function pcTabTerminal(K){
  /* PC名は**サーバーが解決した結果**を出す（§9.208 ⑧）。画面が持つ`WL.terminal`は保存した直後は古い。 */
  const term=(window.WL&&WL.terminal)||null;
  const act=pathConfigState.active||{};
  const pcNow=act.pc_name||(term&&term.pcName())||'';
  const pcFrom=act.pc_name_source||(term&&term.pcNameSource())||'';
  /* 読み取り専用の値に入力欄風の枠を付けない（§CLAUDE 10）——名前と値を横に並べた1行。 */
  /* 名乗りは **PC名だけ**（§9.598 1h）。ログインIDとモードはヘッダーの札（👤・モード）が言う——同じ情報を2か所に出さない。 */
  return `<dl class="pc-who" id="pcWho">
    <div><dt>PC名</dt><dd><b>${esc(pcNow||'（取得できていません）')}</b><small title="${esc(pcFrom?`出どころ: ${pcFrom}`:'')}">${esc(pcFromWord(pcFrom))}</small></dd></div>
   </dl>
   <div class="pc-rows">
    ${K.row('pc_name','名前を決め打ちする',K.text('pc_name','空欄なら OS から自動で取ります'),
     {tip:'アクセス権限マスタとの照合・記録の「更新端末名」・編集中の持ち主表示は、**すべてこの名前**を見ます。自動で取れない端末だけ、ここで名乗ってください。'})}
    ${pcLookRowHtml(K)}
    ${pcShortcutHtml(K)}
    ${pcLdHtml()}
   </div>
   <div id="pcNotes"></div>`;
 }
 /* いまのモードの言葉（ヘッダーのバッジと同じ字）。 */
 function pcModeWord(){
  const b=document.getElementById('accessModeLabel');
  return (b&&b.textContent.trim())||((window.accessMode&&accessMode.mode)||'—');
 }
 /* 段「置き場」。中身は`/api/storage-layout`の答えから`paintShareLayout()`が描く（§9.267）。 */
 function pcTabPlace(){
  return `<div class="pc-place" id="pcShare">
    <p class="pc-place-root" id="pcShareRoot" hidden></p>
    <div id="pcShareRows"><p class="pc-empty">置き場を読んでいます…</p></div>
   </div>`;
 }
 /* 段「共有と同期」（§9.583で「どこから読むか」と「置き場」の後半を1段にまとめた）。
    **どこにあるか（置き場）**と**どう写し・どう書くか（ここ）**を分けた——以前は「置き場」の段に
    置き場の一覧と共有のふるまいの5節が積まれ、器の2〜2.8倍の長さだった。
    参照データ（読むだけ）と作業予定（みんなで書く）の2群。節は見出しにいまの値を出して畳む。 */
 function pcTabSync(K){
  const v=pathConfigState.values||{},d=pathConfigState.defaults||{};
  return `<h5 class="pc-sub"><i class="fa-solid fa-book-open" aria-hidden="true"></i>参照データ（仕掛・品質など・読むだけ）</h5>
   ${K.fold('mirror','fa-copy','元データの写し',`${pcChoiceWord('db_mirror_update')}・${pcNum('db_mirror_interval_sec','秒')}ごとに見る`,
    '仕掛・品質などの共有の元データは、**手元へ写してから**読みます（読むあいだ共有を掴まないため）。**起動したときは、写し直しが済むまで一覧を出しません**（前回の古い写しを見せないため）。',
    K.row('db_mirror_update','写しの更新',K.pick('db_mirror_update'),
     {tip:'**manual** は意図して更新を止めるときに使います。元に新しい版があれば、一覧の「元データ」に**新しい版あり**と出ます。'})
    +K.row('db_mirror_interval_sec','元が変わったかを見る間隔',K.num('db_mirror_interval_sec','元が変わったかを見る間隔','秒',10,10)))}
   ${K.fold('source','fa-database','既定の取得元',pcChoiceWord('sikalot_source'),
    '**読み方を決めていないデータソース**だけに効きます。データソースごとの読み込み先は「データ接続」で決めます（同じ設定を2画面に置くと、どちらが効くのか分からなくなるため）。',
    K.row('sikalot_source','読み方を決めていないデータソース',K.pick('sikalot_source'),{state:PC_WHEN_RESTART})
    +`<p class="pc-line">読み込み先そのものは「データ接続」で決めます。
      <button type="button" class="mm-btn-ghost sm" data-pc-goto="dataSource"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> データ接続を開く</button></p>`)}
   <h5 class="pc-sub"><i class="fa-solid fa-people-arrows" aria-hidden="true"></i>作業予定（共有スケジュール・みんなで書く）</h5>
   ${K.fold('watch','fa-eye','共有の変化を見張る',`${pcChoiceWord('schedule_watch_enabled')}・${pcNum('schedule_watch_interval_sec','秒')}ごと`,
    '共有（Box等）の schedule.sqlite3 は**他の端末も書きます**。読むときは手元へ写したものを読み、**改訂番号が変わったときだけ**写し直します（読むたびに写すと共有を掴み続け、他の端末の書込とぶつかります）。',
    K.row('schedule_watch_enabled','共有の変化を見張る',K.pick('schedule_watch_enabled'),
     {tip:'off にすると以前の動きに戻ります（共有が遅い環境では読み込みも遅くなります）。'})
    +K.row('schedule_watch_interval_sec','変化を見る間隔',K.num('schedule_watch_interval_sec','変化を見る間隔','秒',5,5))
    +K.row('schedule_watch_pause_sec','取り込んだあと休む時間',K.num('schedule_watch_pause_sec','取り込んだあと休む時間','秒',5,0)))}
   ${K.fold('owner','fa-pen-to-square','書き込み役を1台に絞る',pcChoiceWord('schedule_owner_enabled'),
    '共有へ**実際に書く役を1台に絞る**仕掛けです。他のPCは書き込みだけをその1台へ LAN 内で頼み、**読みは今までどおり手元の写しから**読みます。**持ち主が落ちていても止まりません**——頼めなかったPCは自分で共有へ書きます。切ってよいのは、社内規程などで**受け口のポートを開けられない**ときです。',
    K.row('schedule_owner_enabled','書き込み役',K.pick('schedule_owner_enabled'),
     {tip:'書き込み役になったPCだけが下のポートを**LANへ開きます**（合言葉つきの決められた書き込みしか受け付けません）。'})
    +K.row('schedule_owner_port','受け口のポート',K.num('schedule_owner_port','受け口のポート','',1,1025))
    +K.row('schedule_owner_ttl_sec','目印の有効期限',K.num('schedule_owner_ttl_sec','目印の有効期限','秒',10,30))
    +'<div id="scheduleOwnerStatus" class="pc-owner-status">状態を読み込んでいます…</div>')}
   ${K.fold('lock','fa-lock','同時に書いたときの取り合い',`ロック ${pcNum('schedule_lock_ttl_sec','秒')}・確認まで ${esc(String(v.schedule_lock_verify_delay_ms||d.schedule_lock_verify_delay_ms||'—'))}ミリ秒`,
    '2台が同じ瞬間に共有へ書かないよう、書く前に**錠（ロック）**を取ります。ふつうは触りません。',
    K.row('schedule_lock_ttl_sec','書込ロックの有効期限',K.num('schedule_lock_ttl_sec','書込ロックの有効期限','秒',5,1))
    +K.row('schedule_lock_verify_delay_ms','ロック確認までの待機',K.num('schedule_lock_verify_delay_ms','ロック確認までの待機','ミリ秒',100,0)))}
   ${K.fold('session','fa-user-group','同じ設備を2人で触るとき',pcChoiceWord('schedule_session_block'),
    '**編集セッション**は「この設備の主担当は誰か」を見せる仕掛けです。**既定では操作を止めません**——整合は書く役を1台に絞るのと、書き込みのたびの**ロック→取り直し→適用→改訂番号**で守られ、並べ替えは**顔ぶれが変わっていたら断り**、**先に並べ替えられていたら上書きせず読み直します**。',
    K.row('schedule_session_block','編集セッションで操作を止める',K.pick('schedule_session_block'),
     {tip:'**on** にすると、後から入った端末は読み取り専用になります（追加・削除・並べ替え・設備停止・申し送りができなくなります）。止めない場合でも、同じ顔ぶれのまま2人が同時に並べ替えたときは**後から保存したほうの並びが残ります**。'}))}
   ${K.fold('srcsync','fa-code-compare','元データが変わったとき',pcChoiceWord('schedule_source_sync'),
    '予定の行が持っているのは**入れたときの仕掛データの写し**です。出荷日のように**あとから決まる項目**は、写したあとに元データの側で変わります。スケジュールを開いたときに**画面に出している項目だけ**を突き合わせ、変わっていれば取り込みます（**書き換えるのは編集できる端末だけ**）。',
    K.row('schedule_source_sync','取り込み方',K.pick('schedule_source_sync'),
     {tip:'auto でも黙っては変えません——**何件を最新にしたか**を知らせ、中身も開けます。'}))}`;
 }
 /* 段「RNE抽出」: いまの状態（主役）→ 設定の4行。 */
 function pcTabRne(K){
  return `${rneStatusPanelHtml()}
   <div class="pc-rows">
    ${K.row('rne_extract_enabled','定期実行',K.pick('rne_extract_enabled'),
     {tip:'「今すぐ抽出」は、この設定に関わらず資材が配置されていれば実行できます。'})}
    ${K.row('rne_extract_interval_sec','間隔',K.num('rne_extract_interval_sec','間隔','秒',60,60))}
    ${K.row('rne_assets_dir','資材の置き場（フォルダ）',K.path('rne_assets_dir','dir','未設定（アプリの中の config/rne_extract）'),
     {tip:'RNEファイルと symnavim.conf をまとめて置くフォルダです。RNEファイルはこの下の `rne/` に置きます。共有フォルダを指定すれば、端末ごとにコピーせず1式を共用できます。'})}
    ${K.row('rne_conf_path','接続情報 symnavim.conf',K.path('rne_conf_path','file','未設定（資材の置き場の直下）'),
     {tip:'認証情報だけを別の場所に置きたいときに指定します。'})}
   </div>`;
 }
 /* ページの骨組み（札 → 段 → 保存の帯）。**札は動かさず段の中だけ送る**（`scroll:true`）。 */
 function pcPageHtml(bodies){
  /* 段は左の一覧（§9.598 1h・`rail`）。足元は右の詳細・勤務形態・設備停止と同じ並び——左に状態と記録者、右にキャンセルと保存
     （変更が無いうちは押せない・字は`WL.mm.paintFootState()`）。 */
  return `<div class="pc-page is-rail">${pageTabsHtml(PC_TABS.map(t=>({...t,body:bodies[t.key]})),{scroll:true,rail:true})}</div>
  <div class="pc-save" id="pcSave">
   <span class="mm-form-hint pc-dirty" id="pcDirty" aria-live="polite">変更なし</span>
   <span class="pc-chip is-warn pc-restart" id="pcRestartCount" hidden></span>
   <button type="button" class="mm-btn-ghost" id="pcCancel">キャンセル</button>
   <button type="submit" class="mm-btn-primary">保存</button>
  </div>`;
 }
 /* 保存の帯は**保存する欄がある段だけ**に出す（§9.556 B9）。欄の無い段で「保存」を
    押せると、何が保存されるのか推し量らせる（押しても何も変わらない）。 */
 function syncPcSaveBar(form,panel){
  const bar=form.querySelector('#pcSave');
  if(bar)bar.hidden=!(panel&&panel.querySelector('[data-pc-field],[data-lc-field]'));
 }
 function onPcTab(ev){syncPcSaveBar(ev.currentTarget,ev.detail&&ev.detail.panel)}
 function wirePcSaveBar(form){
  form.addEventListener('mm-tab',onPcTab);
  syncPcSaveBar(form,[...form.querySelectorAll('.mm-tabpanel')].find(p=>!p.hidden));
 }
 /* ---- 変えた数（§9.583 ⑤）。**押す前に何が変わるかを言う**——「保存」だけでは、
    どの段で何を触ったかを思い出すことになる（§CLAUDE「思い出させない」）。
    比べる相手は描いたときの値（`data-pc-init`）。後から描く置き場の行は描いたときに控える。 */
 const pcFieldsOf=root=>[...root.querySelectorAll('[data-pc-field],[data-lc-field]')];
 function pcMarkClean(root){pcFieldsOf(root).forEach(el=>{if(el.dataset.pcInit==null)el.dataset.pcInit=el.value})}
 function pcPaintDirty(form){
  const el=form.querySelector('#pcDirty');if(!el)return;
  const n=pcFieldsOf(form).filter(f=>f.dataset.pcInit!=null&&f.value!==f.dataset.pcInit).length;
  WL.mm.paintFootState(el,[form.querySelector('#pcCancel'),form.querySelector('#pcSave button[type=submit]')],false,!!n,n);
  el.classList.toggle('is-dirty',!!n);
 }
 /* キャンセル＝描いたときの値へ戻す（§9.598・右の詳細と同じ。段は閉じない）。戻した欄は`change`で知らせる（いまの値の札が追う）。 */
 function pcRevert(form){
  pcFieldsOf(form).forEach(f=>{
   if(f.dataset.pcInit==null||f.value===f.dataset.pcInit)return;
   f.value=f.dataset.pcInit;f.dispatchEvent(new Event('change',{bubbles:true}));
  });
  pcPaintDirty(form);
 }
 function onPcEdit(ev){
  if(ev.target&&ev.target.matches&&ev.target.matches('[data-pc-field],[data-lc-field]'))pcPaintDirty(ev.currentTarget);
 }
 /* 共通設定の配線（保存・段・行き先・⋯・ⓘ・「表示」の行き先・起動アイコン）。 */
 function wirePathConfigForm(form){
  form.onsubmit=ev=>{ev.preventDefault();savePathConfigMaint()};
  /* 段の切り替えは編集窓と同じ`bindMaintTabs`（キーボードの←→も見出しの一言もそのまま効く）。 */
  bindMaintTabs(form);wirePcSaveBar(form);
  /* **器は描き直しても同じ要素**なので、名前のある関数で付ける（同じ関数は2度付かない・§9.522 の追補）。
     **委譲で受ける**——置き場の行は後から描かれるので、1つずつ配線すると行の中の行き先だけ効かない。 */
  form.addEventListener('click',onPcJumpClick);
  form.addEventListener('click',onPcGotoClick);
  form.addEventListener('click',onPcMoreClick);
  form.addEventListener('input',onPcEdit);
  form.addEventListener('change',onPcEdit);
  bindInputHelpers(form);
  WL.popMenu.tips(form);
  /* 「表示」の設定へ連れて行く。**押すのはヘッダーのバッジそのもの**——同じポップオーバーを2つ書かない
     （§9.267 の「置き場で決める」と同じ作法）。行き先は2つ（見え方・起動アイコン）だが、**開け方は1箇所**（§9.445）。 */
  form.querySelectorAll('#pcLookOpen,#pcScOpen').forEach(b=>{b.onclick=()=>{
   const badge=document.getElementById('uiSizeBadge');
   if(badge){badge.click();return}
   showToast('「表示」の設定を開けません','ヘッダーの「表示」ボタンが見つかりませんでした',5000);
  }});
  /* 読み込みの見せ方の札（§9.436）。**押すのは`WL.loader.setStyle()`の1箇所**——印の付け替えも、
     いまの値の書き直しも、あちらが出す`wl:look-change`が受け持つ。器ごと作り直されるので委譲で受ける。 */
  const ld=$('#pcLd');
  if(ld)ld.onclick=ev=>{
   const b=ev.target.closest('[data-loader-option]');if(!b)return;
   WL.loader.setStyle(b.dataset.loaderOption);
  };
  renderLook();
  /* **変わったら書き直す**（§9.433）。渡すのは同じ関数なので`addEventListener`は積み上がらない。 */
  document.addEventListener('wl:look-change',renderLook);
  /* デスクトップの起動アイコン（§9.445）。**ここは行き先だけ**——いまの状態を取りに行って塗る。 */
  paintShortcut();loadShortcut();
  pcMarkClean(form);pcPaintDirty(form);
  const cancel=form.querySelector('#pcCancel');if(cancel)cancel.onclick=()=>pcRevert(form);
 }
 /* 段を名前（鍵）で開く。図・行・他の画面から連れて来るとき、**飛ぶ＝段を切り替えること**。 */
 function pcShowTab(form,key){
  const panel=form.querySelector(`.mm-tabpanel[data-tab-key="${CSS.escape(key)}"]`);
  if(!panel||typeof form.__mmShowTab!=='function')return null;
  const i=[...form.querySelectorAll('.mm-tabpanel')].indexOf(panel);
  if(i>=0)form.__mmShowTab(i);
  return panel;
 }
 function onPcJumpClick(ev){
  const form=ev.currentTarget;
  const btn=ev.target.closest('[data-pc-jump]');if(!btn||!form.contains(btn))return;
  ev.preventDefault();
  pcShowTab(form,btn.dataset.pcJump);
 }
 /* 「直す場所」からその画面へ飛ぶ。**行が持つ印で開く**ので、置き場が増えてもここは触らない。 */
 function onPcGotoClick(ev){
  const b=ev.target.closest('[data-pc-goto]');if(!b)return;
  document.querySelector(`#masterMaintNav [data-master="${b.dataset.pcGoto}"]`)?.click();
 }
 /* 行の ⋯（§9.583 ③）。補足（出どころ・効く時・メモ）は**行の中の控え**（`.pc-store-more`）にあり、
    押すとその写しを浮かせる。器は`.wl-menu`の1つ・置き方と閉じ方は`WL.popMenu`（§9.448）。 */
 let pcMoreEl=null;
 function onPcMoreClick(ev){
  const b=ev.target.closest('[data-pc-more]');if(!b)return;
  ev.preventDefault();
  const was=pcMoreEl&&pcMoreEl.__owner===b;
  if(pcMoreEl)WL.popMenu.close();
  if(was)return;
  const src=b.closest('.pc-store-row')&&b.closest('.pc-store-row').querySelector('.pc-store-more');
  if(!src)return;
  const el=document.createElement('div');
  el.className='wl-menu pc-more';el.setAttribute('role','dialog');
  el.innerHTML=src.innerHTML;el.__owner=b;
  document.body.append(el);pcMoreEl=el;
  bindStorageActions(el);
  WL.popMenu.open(el,{anchor:b,owner:b,onClose:()=>{el.remove();if(pcMoreEl===el)pcMoreEl=null}});
 }
 /* 他の画面から連れて来られたときに、その段（と盤）を開く。**一度きり**——次に開いたときまで
    覚えていると、身に覚えの無い段が開く。 */
 function openPcPending(form){
  if(pcPendingSection){
   const want=pcPendingSection;pcPendingSection='';
   pcShowTab(form,want);
  }
  /* 「表示」から来たときは盤まで見せる（§9.436）。**開いてから連れて行く**（畳んだままだと、来た先に何も無いように見える）。 */
  if(pcPendingLook){
   pcPendingLook=false;
   requestAnimationFrame(()=>{
    const el=$('#pcLd');if(!el)return;
    el.open=true;
    el.scrollIntoView({block:'start',behavior:'smooth'});
    el.classList.add('is-lit');
    setTimeout(()=>el.classList.remove('is-lit'),1600);
   });
  }
 }
 function renderPathConfigForm(){
  const form=$('#masterMaintForm');if(!form)return;
  const v=pathConfigState.values||{};
  const K=pcKit(v);
  form.className='mm-form mm-form-page';
  form.innerHTML=pcPageHtml({terminal:pcTabTerminal(K),place:pcTabPlace(),sync:pcTabSync(K),rne:pcTabRne(K),
   /* アプリの更新（§9.555）。中身と配線は`master-update.js`（WL.appUpdate）——この段は器を貸すだけ。 */
   update:WL.appUpdate.sectionHtml(v,K)});
  wirePathConfigForm(form);
  WL.appUpdate.wire(form);
  WL.appUpdate.refresh();
  openPcPending(form);
  refreshRneStatus();
  refreshOwnerStatus();
 }
 /* ---- 札の一言と要対応の数（§9.583 ①）。**段が自分で名乗る**（`data-tab-sum`／`data-tab-badge`）。
    数は「直す・確かめる必要があるもの」だけ（未設定は直す必要が無いこともあるので数えず、字で言う）。 */
 let rneLast=null;
 /* `state`＝左の一覧の状態の札（§9.598 1h）。要対応があればその数（`要対応 N`・橙／赤）、無ければ段の一言（OK・停止中・未設定 N…）。
    **正常は中立の色**（状態チップの決まり・§9.338——青緑は「選んでいる」の色なので使わない）。 */
 function pcTabSet(form,key,sum,badge,tone,title,state){
  const p=form.querySelector(`.mm-tabpanel[data-tab-key="${key}"]`);if(!p)return;
  p.dataset.tabSum=sum||'';
  if(badge){p.dataset.tabBadge=String(badge);p.dataset.tabTone=tone||'warn';p.dataset.tabBadgeTitle=title||''}
  else{delete p.dataset.tabBadge;delete p.dataset.tabTone;delete p.dataset.tabBadgeTitle}
  const n=Number(badge);
  p.dataset.tabState=badge?(Number.isFinite(n)&&n>0?`要対応 ${n}`:(state||'要対応')):(state||'正常');
  p.dataset.tabStateTone=badge?(tone||'warn'):'';
 }
 function paintPcTabs(){
  const form=$('#masterMaintForm');if(!form||!form.querySelector('.pc-page'))return;
  const term=(window.WL&&WL.terminal)||null,act=pathConfigState.active||{};
  const pcNow=act.pc_name||(term&&term.pcName())||'';
  pcTabSet(form,'terminal',[pcNow,(term&&term.loginId())||'',pcModeWord()].filter(Boolean).join('・'),
   pcNow?0:'!','warn','要対応 PC名を取得できていません',pcNow?'正常':'名前なし');
  const st=pathConfigState.storage,items=(st&&st.items)||[];
  if(items.length){
   const live=items.filter(x=>!x.retired);
   const miss=live.filter(x=>x.path&&x.exists===false).length,pend=items.filter(x=>x.pending).length;
   const unset=live.filter(x=>!x.path).length;
   /* 写せていない測定データ（一覧に入っていない・§9.619）。要対応に数えるのは人の手が要るものだけ（自動で写し直すものは数えない）
      ——帯の札（要対応／自動で写し直します）と同じ数え方。 */
   const wait=live.reduce((n,x)=>n+pcFilesWaiting(x).length,0);
   const need=live.reduce((n,x)=>n+pcFilesWaiting(x).filter(f=>!(f.why&&f.why.auto)).length,0);
   /* 未設定は直す必要が無いこともある（§9.583）ので要対応に数えず、札の字で言う。字は**何が起きているか**
      （みんなで使う置き場が空＝この端末の中だけ・§9.598 1i）。手元の置き場は既定の道があるので空にならない。 */
   const unsetWord=live.filter(x=>!x.path).every(x=>x.group==='share')?'共有なし':'未設定';
   pcTabSet(form,'place',`${live.length}か所`+(unset?`・${unsetWord}${unset}`:'')+(miss?`・まだ無い${miss}`:'')+(pend?`・再起動待ち${pend}`:'')+(wait?`・写せていない${wait}`:''),
    miss+pend+need,'warn',['要対応',miss?`まだ無い置き場 ${miss}`:'',pend?`再起動待ち ${pend}`:'',need?`写せていない測定データ ${need}`:''].filter(Boolean).join(' '),
    wait?`写せていない ${wait}`:unset?`${unsetWord} ${unset}`:'OK');
  }else pcTabSet(form,'place',pathConfigState.storageError?'置き場を読めません':'',pathConfigState.storageError?'!':'','bad','置き場の一覧を読めませんでした',
   pathConfigState.storageError?'読めません':'確かめ中');
  const syncPend=form.querySelectorAll('.mm-tabpanel[data-tab-key="sync"] .pc-pending').length;
  pcTabSet(form,'sync',`${pcChoiceShort('schedule_watch_enabled')}・${pcChoiceShort('schedule_owner_enabled')}`,syncPend,'warn','要対応 再起動待ち '+syncPend);
  if(rneLast){
   const s=rneLast,miss=((s.assets&&s.assets.rneMissing)||[]).length+((s.assets&&!s.assets.symnavimConf)?1:0);
   /* 資材が無いのを**要対応に数えるのは使うとき**（定期実行が回る・取得元が local）だけ。使わない端末では字で言う。 */
   const uses=!!s.enabled||s.source==='local';
   pcTabSet(form,'rne',(s.running?'抽出中':(s.enabled?`定期 ${s.intervalSec}秒ごと`:'定期 停止中'))+(miss?'・資材なし':''),
    uses?miss:0,'bad','要対応 足りない資材 '+miss,s.running?'抽出中':(s.enabled?'正常':'停止中'));
  }
  if(typeof form.__mmPaintTabs==='function')form.__mmPaintTabs();
 }
 /* ---------- 書き込み役の状態(§9.192) ----------
    「入れたのに効いているのか分からない」を作らない。誰が役をしていて、
    このPCから見えているか（届いているか）までを文字で出す。 */
 async function refreshOwnerStatus(){
  const box=$('#scheduleOwnerStatus');if(!box)return;
  let o;
  try{o=await api('/api/schedule/owner-status')}
  catch(e){box.innerHTML=`<span class="pc-owner-off">状態を取得できません: ${esc(e.message)}</span>`;return}
  if(!o.configured){box.innerHTML='<span class="pc-owner-off">スケジュールの共有データ置き場が未設定のため、この設定は効きません。</span>';return}
  if(!o.enabled){box.innerHTML='<span class="pc-owner-off">いまは <b>off</b>（各PCが自分で共有へ書いています）。</span>';return}
  const who=o.isOwner?'<b>このPCが書き込み役です。</b>'
           :(o.ownerPc?`書き込み役は <b>${esc(o.ownerPc)}</b>${o.ownerLogin?`（${esc(o.ownerLogin)}）`:''} です。`
                      :'書き込み役はまだ決まっていません（決まるまでは各PCが自分で書きます）。');
  const lines=[
   o.isOwner?`受け口: ${esc((o.myUrls||[]).join(' / '))}`:(o.ownerUrl?`話しかけ先: ${esc(o.ownerUrl)}`:''),
   o.ownerAliveSec!=null?`最後の生存確認: ${Math.round(o.ownerAliveSec)}秒前（期限 ${esc(String(o.ttlSec))}秒）`:'',
   o.relays?`頼んだ回数: ${o.relays}回${o.relayFail?` / 届かなかった: ${o.relayFail}回`:''}`:'',
   o.lastError?`最後のエラー: ${esc(o.lastError)}（届かないあいだは自分で書きます）`:''
  ].filter(Boolean);
  box.innerHTML=`<div class="pc-owner-who${o.isOwner?' is-me':''}">${who}</div>`+
   (lines.length?`<div class="pc-owner-lines">${lines.map(t=>`<span>${t}</span>`).join('')}</div>`:'');
 }


 /* ---------- RNE抽出の状態表示と手動実行(§9.50 → §9.583) ----------
    ローカル運用(sikalot_source=local)のとき、抽出は背景で定期実行される。
    以前は成否がアプリログにしか出ず、「動いているのか」「今すぐ取り直したい」
    に画面から答えられなかった(「実際に起動させる方法が分からない」という指摘)。
    §9.583: 段の**主役**（最初に読むもの）にした。足りない資材は1行ずつ、作ったファイルは名前と時刻の2列。 */
 let rneTimer=null;
 function rneStatusPanelHtml(){
  return `<section class="rne-panel" id="rnePanel" aria-live="polite">
    <div class="rne-head"><b>いまの状態</b>
     <span class="pc-chip rne-state" id="rneState">確かめています…</span>
     ${tipHtml('RNE（Navigator 問い合わせ定義）から `.sqlite3` を作り、それを一覧として読む仕組みです。取得元が **local** のデータソースだけが、ここで作ったファイルを読みます。')}
     <button type="button" class="mm-btn-ghost sm" id="rneRunBtn"><i class="fa-solid fa-play" aria-hidden="true"></i> 今すぐ抽出</button>
    </div>
    <div id="rneBody"><p class="rne-note">状態を読み込んでいます…</p></div>
   </section>`;
 }
 function fmtWhen(sec){
  if(!sec)return '—';
  const d=new Date(sec*1000),diff=Math.floor((Date.now()-d.getTime())/60000);
  return `${d.toLocaleString('ja-JP')}（${diff<1?'たった今':diff+'分前'}）`;
 }
 async function refreshRneStatus(){
  const panel=$('#rnePanel');if(!panel)return;
  clearTimeout(rneTimer);rneTimer=null;
  let s;
  try{s=await api('/api/rne-extract/status')}
  catch(e){const b=$('#rneBody');if(b)b.innerHTML=`<p class="rne-note is-bad">状態を取得できません: ${esc(e.message)}</p>`;return}
  const state=$('#rneState'),body=$('#rneBody'),btn=$('#rneRunBtn');
  if(!state||!body||!btn)return;
  rneLast=s;
  state.textContent=s.running?'抽出中…':(s.enabled?'定期実行 有効':'定期実行 停止中');
  state.className='pc-chip rne-state '+(s.running?'is-run':(s.enabled?'is-ok':'is-off'));
  // 手動実行は取得元に関わらず、資材が配置されていれば押せる
  btn.disabled=!!s.running||!s.canRun;
  btn.title=s.canRun?'取得元の設定に関わらず、今この場でRNEから抽出し直します。'
                    :'抽出に必要なファイル(RNE定義・symnavim.conf)が配置されていません。';
  const missing=(s.assets&&s.assets.rneMissing)||[];
  /* 足りない資材は**1つずつ・置く場所つき**（§4。「何が・どこへ」が無いと打つ手が無い）。 */
  const issues=[
   missing.length?`<li>抽出定義（RNE）がありません: <b>${esc(missing.join(', '))}</b> → <code>${esc(s.assetsDir||'')}${s.assetsDir?'/rne':''}</code> へ置きます（機密のためリポジトリには含めません。config/rne_extract/README.md）</li>`:'',
   (s.assets&&!s.assets.symnavimConf)?`<li>接続情報 symnavim.conf がありません → <code>${esc(s.assetsDir||'')}</code> へ置きます</li>`:'',
  ].filter(Boolean).join('');
  const outs=(s.outputs||[]).map(o=>`<dt>${esc(o.name)}</dt><dd>${o.exists?`最終更新 ${esc(fmtWhen(o.mtime))}`:'まだ作っていません'}</dd>`).join('');
  const jobs=(s.jobs||[]).map(j=>`<dt>${esc(j.name)}</dt><dd class="${j.ok?'':'is-bad'}">${
    j.ok?`成功 ${esc(String(j.rows??'-'))}行・${(j.elapsed||0).toFixed(1)}秒`:`失敗: ${esc(j.error||'')}`}</dd>`).join('');
  body.innerHTML=`
   ${s.enabled?'':`<p class="rne-note">定期実行は止まっています（設定 ${esc(s.scheduleMode||'auto')}${s.scheduleMode==='off'?'':`・取得元 ${esc(s.source||'')}`}）。
     回すには「定期実行」を <b>on</b> にするか、取得元を <b>local</b> にします（取得元の変更は再起動後に反映）。
     <b>「今すぐ抽出」はいつでも押せます。</b></p>`}
   ${issues?`<ul class="rne-issues">${issues}</ul>`:''}
   <dl class="rne-out">${outs}${jobs}</dl>
   <p class="rne-note">定期: ${s.enabled?`起動直後に1回、以降 ${esc(String(s.intervalSec))}秒ごと`:'止まっています'}・直近の実行: ${esc(fmtWhen(s.finishedAt||s.startedAt))}${s.trigger?`（${s.trigger==='manual'?'手動':'定期'}）`:''}</p>`;
  btn.onclick=async()=>{
   btn.disabled=true;
   try{
    const r=await api('/api/rne-extract/run',{quiet:true,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:String($('#masterUserId')?.value||'').trim()})});
    showToast('抽出を開始しました',r.message||'',4000);
   }catch(e){showToast('抽出を開始できません',e.message,7000);btn.disabled=false;return}
   refreshRneStatus();
  };
  paintPcTabs();
  // 実行中だけ短い間隔で追いかける(終わったら止める。無駄な問い合わせを残さない)
  if(s.running)rneTimer=setTimeout(refreshRneStatus,2000);
 }
 /* ---------- 置き場（§9.260 → §9.267 → §9.583） ----------
    **判定はサーバーが持つ**（§9.163）ので、ここは受け取った答えを並べて直す口を添えるだけ
    ——「UNCかどうか」「どの段で決まったか」を画面でも判定すると答えが2通りになる。
    §9.583: 群ごとに畳める表。**1行＝名前｜欄｜在るか・種類｜打つ手**、補足は ⋯ へ。
    以前は1件が4段（題・欄・いま/出どころ・説明）で、9件で器の2倍を超えていた。 */
 /* 置き場の種類は**必ず文字で**（§3。色だけで伝えない）。 */
 const PC_SHARE_KIND={network:'共有（ネットワーク）',cloud:'共有（クラウド同期）',
                      local:'この端末の中','':'未設定'};
 /* 群。**並びはよく直す順**（§CLAUDE 14）——みんなで使う置き場は運用を始めるときに必ず決め、
    この端末の中は端末ごとに稀、読むだけはここでは直さない（行き先だけ）。**3つより増やさない**。 */
 const PC_STORE_GROUPS=[
  {id:'share',name:'みんなで使う',icon:'fa-people-arrows',
   tip:'他の端末とやりとりするもの。ここを共有フォルダにすると、全員で同じものを見ます。'},
  {id:'terminal',name:'この端末の中',icon:'fa-desktop',
   tip:'この端末だけが使うもの。**置き場は config/local.json が決めます**（起動時に1回だけ読むので、変えたらアプリの再起動が要ります）。'
    +'**マスタDB自身の置き場を決める値**なので、マスタの中には置けません（読みに行く先が分からなくなるため）。直す前の内容は `local.json.bak` に控えます。'},
  {id:'read',name:'読むだけ',icon:'fa-book-open',
   tip:'別のシステムが書いたものを読むだけです。書き換えません。読み込み先は「データ接続」と「RNE抽出」で決めます。'},
 ];
 /* 「在るか」は3値（§CLAUDE「共有DBを開く前にstatを置かない」）。
    **null（確かめられなかった）を「無い」と同じに扱わない。** */
 function pcExistsText(x){
  if(!x.path)return {t:'未設定',c:'is-off'};
  /* ファイルを並べる行（測定データ（共有））は何が在るのかを言う——下の「写せていない」と食い違って見せない（§9.619）。 */
  if(x.exists===true)return {t:x.files&&x.files.length?'フォルダ あります':'あります',c:'is-ok'};
  if(x.exists===false)return {t:'まだありません',c:'is-warn'};
  return {t:'確かめられません',c:'is-off'};
 }
 const PC_JUMP_WORD={dataSource:'データ接続',rne:'RNE抽出'};
 /* 行の補足（⋯で浮かせる控え）。**行の中に置く**——浮いた面はその写しを出すだけなので、
    描き直しても補足と行が食い違わない。 */
 function pcStoreMoreHtml(label,facts,notes){
  const dl=facts.filter(([,v])=>v).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${v}</dd>`).join('');
  return `<div class="pc-store-more" hidden><b class="pc-more-title">${esc(label)}</b>
    ${dl?`<dl>${dl}</dl>`:''}${notes.filter(Boolean).map(n=>`<p class="pc-store-note">${n}</p>`).join('')}</div>`;
 }
 /* 置き場の1行。**直せるものには欄と「参照…」を、無いものには「作る」を**その場に置く（§9.207）。 */
 function pcStorageRowHtml(x,lcFields){
  /* `config/local.json`の行は、**その欄の説明も一緒に出す**（「フォルダなのかファイルなのか」が行だけからは読めなかった）。 */
  const lcDef=(lcFields||[]).find(f=>f.key===x.field)||null;
  const kind=x.path?(PC_SHARE_KIND[x.kind||'']||''):'';
  const ex=pcExistsText(x);
  const lc=x.store==='local-json';
  const field=lc?`data-lc-field="${esc(x.field)}"`:`data-pc-field="${esc(x.field)}"`;
  const canEdit=x.editable&&x.field;
  /* 欄は**保存値**（効いている値を入れると送り返すだけで焼き付く・§9.250 ⑩）。空のときは薄字で「いま」を言う。 */
  const saved=x.saved!=null?x.saved:x.path;
  const box=canEdit
   ? `<span class="mm-path" data-path-drop="${esc(x.field)}">
       <input ${field} data-field="${esc(x.field)}" type="text" value="${esc(saved)}"
        placeholder="${esc(x.path?`既定: ${x.path}`:'未設定（既定を使います）')}" autocomplete="off" spellcheck="false">
       <button type="button" class="mm-path-browse" data-path-browse="${esc(x.field)}" data-path-mode="${esc(x.mode||'dir')}">参照…</button>
      </span>`
   : `<code class="pc-store-path" title="${esc(x.path||'')}">${esc(x.path||'（未設定）')}</code>`;
  /* **作れるのは「無いと分かっている」ときだけ**——確かめられなかったものに「作る」を出すと、在るものを作りに行ったように見える。 */
  const canMake=x.creatable&&x.path&&x.exists===false;
  /* 種類は**群の名前と違うときだけ**言う（「この端末の中」の群に「この端末の中」と添えても何も増えない・§CLAUDE 8）。
     みんなで使う群の置き場が手元にある（＝まだ共有していない）は、知らないと壊れ方が分からないので必ず言う。 */
  const expected={share:['network','cloud'],terminal:['local']}[x.group]||[];
  const sub=[x.path&&!expected.includes(x.kind||'')?kind:'',x.retired?'役目を終えました':''].filter(Boolean);
  const more=pcStoreMoreHtml(x.label,[
   ['いま',x.path?`<code>${esc(x.path)}</code>`:''],
   ['出どころ',esc(x.from||'')],
   ['効く時',x.pending?'<b>再起動待ち</b>（アプリを開き直すと切り替わります）':esc(x.when==='live'?'保存するとすぐ':'アプリの再起動後')],
   ['種類',esc(kind)],
  ],[
   x.pending?`保存済みですが、まだ効いていません。いまは <code>${esc(x.active||'（未設定）')}</code> を使っています。置き場は先に作っておけます。`:'',
   esc(x.note||''),
   lcDef&&lcDef.hint?hintHtml(lcDef.hint)+(lcDef.expanded?` この端末では <code>${esc(lcDef.expanded)}</code> になります。`:''):'',
  ]);
  const jump=x.jump?`<button type="button" class="mm-btn-ghost sm" data-pc-goto="${esc(x.jump)}"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> ${esc(PC_JUMP_WORD[x.jump]||'直す場所')}</button>`
   :x.section?`<button type="button" class="mm-btn-ghost sm" data-pc-jump="${esc(x.section)}"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i> ${esc(PC_JUMP_WORD[x.section]||'直す場所')}</button>`:'';
  return `<tr class="pc-store-row${x.retired?' is-retired':''}${x.pending?' is-pending':''}" data-store-key="${esc(x.key)}">
   <th scope="row"><b class="pc-store-label">${esc(x.label)}</b><small>${esc(x.what||'')}</small></th>
   <td class="pc-store-box">${box}</td>
   <td class="pc-store-st"><span class="pc-chip pc-store-exists ${ex.c}">${esc(ex.t)}</span>${
     x.pending?'<span class="pc-chip is-warn pc-pending">再起動待ち</span>':''}${
     sub.length?`<small class="pc-store-kind">${esc(sub.join('・'))}</small>`:''}</td>
   <td class="pc-store-act">${pcFilesWaiting(x).length?`<button type="button" class="mm-btn-ghost sm" data-pc-recopy
      title="${esc('いま確かめて、写せるファイルを写し直します（'+pcCheckedText(x.files)+'）')}"><i class="fa-solid fa-rotate" aria-hidden="true"></i> ${pcFilesWaiting(x).length}本を写し直す</button>`:''}${canMake?`<button type="button" class="mm-btn-ghost sm pc-make" data-pc-make="${esc(x.key)}"
      data-pc-make-mode="${esc(x.mode||'dir')}"><i class="fa-solid fa-folder-plus" aria-hidden="true"></i> 作る…</button>`:''}${jump}
    <button type="button" class="pc-more-btn" data-pc-more title="${esc(x.label)}の補足（出どころ・効く時・メモ）" aria-label="補足">
     <i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button>${more}</td>
  </tr>`;
 }
 /* ---------- 測定データ（共有）のファイルごとの読み方（§9.619、利用者の指示「測定データの保存は削除、必要な設定は共通へ統合」） ----------
    ほかの PC が書くファイルは手元へ写してから読む（共有を直接読まない・docs/SHARED_READ.md R8）。**写せないファイルの記録は一覧に
    入らない**ので、どの設備がなぜかを置き場の行のすぐ下で言う。影響（何本が一覧に入っていないか）→ 設備ごとの次の一手（要対応が先・自動で
    写し直すが後）と人の言葉の理由（技術の字は ⓘ）→ 読めているファイルは1行、の順。押す物は行の操作の列の「N本を写し直す」の1つ
    （数は帯の頭とまとまりの見出しが言う。行の状態の列は「フォルダ あります」だけ＝同じ数を隣に2つ出さない）。
    答えはサーバー（`records_copy_report()`・理由の種類は`db_mirror.explain()`）——画面は判定を持たない。 */
 const pcFilesWaiting=x=>(x&&x.files||[]).filter(f=>f.state==='waiting');
 const PC_FILE_WORD={mine:'この端末が書く',copied:'写し'};
 /* サーバーが種類を言わなかった（前の版のサーバー）ときの言い方。理由の元の字をそのまま言う。 */
 const pcFileWhyOf=f=>({say:f.reason||'まだ写せていません',act:'要対応',auto:false,detail:f.reason||''});
 function pcCheckedText(files){
  const at=Math.max(0,...files.map(f=>Number(f.at)||0));
  if(!at)return '';
  const min=Math.round((Date.now()/1000-at)/60);
  return `最後に確かめた ${min<1?'たった今':`${min}分前`}`;
 }
 function pcRecordsFilesHtml(x){
  const files=(x&&x.files)||[];
  if(!files.length)return '';
  const bad=pcFilesWaiting(x),ok=files.filter(f=>f.state!=='waiting');
  const act=w=>`<span class="pc-file-act ${w.auto?'is-auto':'is-need'}"><i class="fa-solid ${w.auto?'fa-clock-rotate-left':'fa-lock'}" aria-hidden="true"></i>${esc(w.act)}</span>`;
  const box=bad.length?`<div class="pc-files-box" role="group" aria-label="一覧に入っていない測定データ">
    <div class="pc-files-head"><b class="pc-files-lead"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${bad.length}本の記録が一覧に入っていません</b>
     <span class="pc-files-when">${esc(pcCheckedText(files))}</span></div>
    <table class="pc-files"><tbody>${[...bad].sort((a,b)=>Number(!!(a.why&&a.why.auto))-Number(!!(b.why&&b.why.auto))).map(f=>{const w=f.why||pcFileWhyOf(f);
     return `<tr data-file-eq="${esc(f.equipment)}"><td class="pc-file-eq">${esc(f.equipment)}</td><td class="pc-file-st">${act(w)}</td>
      <td class="pc-file-say">${esc(w.say)}${tipHtml(w.detail+(f.path?`\n${f.path}`:''))}${w.hint?`<small>${esc(w.hint)}</small>`:''}</td></tr>`}).join('')}</tbody></table></div>`:'';
  const okLine=ok.length?`<p class="pc-files-ok">${bad.length?`読めている ${ok.length}本`:`設備ごとのファイル ${ok.length}本を読めています`}${bad.length?'':`<span class="pc-files-when">${esc(pcCheckedText(files))}</span>`}: ${
    ok.map(f=>`<b>${esc(f.equipment)}</b>（${PC_FILE_WORD[f.state]||''}）`).join('・')}</p>`:'';
  return `<tr class="pc-store-sub" data-store-sub="${esc(x.key)}"><td></td><td colspan="3">${box}${okLine}</td></tr>`;
 }
 /* 「写し直す」（§9.619）。押したら答えの行で描き直し、結果を字で返す（何本写せて、何本残ったか）。 */
 async function recopyRecords(btn){
  btn.disabled=true;
  try{
   const r=await api('/api/measurement/records/recopy',{method:'POST',quiet:true,headers:{'Content-Type':'application/json'},body:'{}'});
   const st=pathConfigState.storage,row=st&&(st.items||[]).find(x=>x.key==='recordsShare');
   if(row)row.files=r.files||[];
   const left=pcFilesWaiting(row).length;
   showToast&&showToast(left?`写しました ${r.updated||0}本・まだ ${left}本`:'すべて写しました',left?'残ったファイルは行の理由を見てください':'',left?6000:3200);
   renderPathConfigList();
  }catch(e){showToast&&showToast('写し直せませんでした',e.message,7000);btn.disabled=false}
 }
 /* `config/local.json` の残り2つ（まとめて決める / 書込サイクル）。**優先順位はサーバーが言う**。
    説明は**マスタと同じ書き方**を通す（`**強調**`が生で出ないように・§9.222 ⑧）。 */
 function pcLocalExtraRows(fields){
  return (fields||[]).filter(f=>f.key==='db_dir'||f.key==='master_share_mode').map(f=>{
   const box=f.mode==='choice'
    ? `<select data-lc-field="${esc(f.key)}">${(f.choices||[]).map(([v,t])=>
        `<option value="${esc(v)}"${(f.value||'')===v?' selected':''}>${esc(t)}</option>`).join('')}</select>`
    : `<span class="mm-path" data-path-drop="${esc(f.key)}">
        <input data-lc-field="${esc(f.key)}" data-field="${esc(f.key)}" type="text" value="${esc(f.value||'')}"
         placeholder="未設定（既定: ${esc(f.default||'')}）" autocomplete="off" spellcheck="false">
        <button type="button" class="mm-path-browse" data-path-browse="${esc(f.key)}" data-path-mode="${esc(f.mode||'dir')}">参照…</button>
       </span>`;
   const more=pcStoreMoreHtml(f.label,[['いま',`<b>${esc(f.effective||'')}</b>`],['効く時','アプリの再起動後']],
    [hintHtml(f.hint||'')+(f.expanded?` この端末では <code>${esc(f.expanded)}</code> になります。`:'')]);
   return `<tr class="pc-store-row is-extra" data-store-key="lc:${esc(f.key)}">
    <th scope="row"><b class="pc-store-label">${esc(f.label)}</b><small>${esc(f.what||'config/local.json')}</small></th>
    <td class="pc-store-box">${box}</td>
    <td class="pc-store-st"></td>
    <td class="pc-store-act"><button type="button" class="pc-more-btn" data-pc-more title="${esc(f.label)}の補足" aria-label="補足">
     <i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button>${more}</td></tr>`;
  }).join('');
 }
 /* **読めなかったことを群のいちばん上に出す**（§9.271）。ここに出る＝このファイルに書いた設定は1つも効いていない。 */
 function pcLocalErrorHtml(err){
  if(!err)return '';
  return `<p class="mm-warn-note" id="pcLocalConfigError"><b>この端末の設定ファイルを読めませんでした。</b>
   ${esc(err)}<br>そのため、<b>この群に書いた内容は効いていません</b>（アプリは既定の置き場を読んでいます）。
   このまま欄から保存し直すと、正しい形で書き直せます。</p>`;
 }
 /* 置き場を「無ければ作る」（§9.267、利用者の指示「設定さえ書いてあれば
    フォルダやファイルが存在しない場合には強制的に作成して、ユーザーの操作を
    妨げないようにしたい。但し作成する前にユーザーに確認する方式に」）。
    **下見 → 確認 → 作る**の3段（§9.193）——何ができるのかを先に出す。 */
 async function makeStoragePath(key,mode){
  const row=document.querySelector(`[data-store-key="${CSS.escape(key)}"]`);
  const input=row&&row.querySelector('[data-field]');
  /* **欄に打った値で作る**（保存していなくてよい）——「保存してから作る」に
     すると、打ち間違えた値をマスタへ入れてから確かめることになる。 */
  const path=input?String(input.value||'').trim():'';
  const label=row?(row.querySelector('.pc-store-label')||{}).textContent||'':'';
  try{
   setMaintLoading(true,'どうなるか調べています…');
   const pre=await api('/api/storage-layout/prepare',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({path,mode,apply:false})});
   setMaintLoading(false);
   const plan=(pre&&pre.plan)||{};
   if(plan.already){
    showToast&&showToast('もうあります',`${plan.path} は既にあります。`,4500);
    return;
   }
   const made=[...(plan.dirs||[]),...(plan.file?[plan.file]:[])];
   /* **何ができるのかを1つずつ出す**（§4・§6）。「作ります」だけでは、
      どこに何ができるのか確かめようがない。 */
   const body=`<p class="confirm-modal-message">これから <b>${made.length}件</b> 作ります。</p>
     <ul class="pc-make-list">${made.map(x=>`<li><code>${esc(x)}</code></li>`).join('')}</ul>
     <p class="confirm-modal-message">${plan.kind==='network'||plan.kind==='cloud'
       ?'共有の置き場です。<b>作るだけ</b>で、中のデータは触りません。'
       :'この端末の中に作ります。'}</p>`;
   const ok=await confirmModal({title:`${label||'置き場'}を作ります`,bodyHtml:body,confirmLabel:'作る'});
   if(!ok)return;
   setMaintLoading(true,'作っています…');
   const r=await api('/api/storage-layout/prepare',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({path,mode,apply:true})});
   const done=(r&&r.plan)||{};
   /* **作れても書けない共有がある**ので、書けるかまで見て言う（§4）。 */
   if(done.writable===false){
    showToast&&showToast('作りましたが書き込めません',
      `${done.path} を作りましたが、書き込みを試すと失敗しました。${done.writeError||''}`,9000);
   }else{
    showToast&&showToast('作りました',`${done.path} を用意しました。`,5000);
   }
   pathConfigState.loaded=false;await loadPathConfigMaint(true);
  }catch(e){
   setMaintLoading(false);
   showToast&&showToast('作れませんでした',e.message,7000);
  }finally{setMaintLoading(false)}
 }
 function bindStorageActions(root){
  root.querySelectorAll('[data-pc-recopy]').forEach(btn=>{btn.onclick=()=>recopyRecords(btn)});
  root.querySelectorAll('[data-pc-make]').forEach(btn=>{
   btn.onclick=()=>makeStoragePath(btn.dataset.pcMake,btn.dataset.pcMakeMode||'dir');
  });
 }
 /* 群の見出しの札（件数と状態）。**畳んだままでも「いまどうか」が読める**（§9.261・§9.433）。 */
 function pcGroupTag(list){
  const live=list.filter(x=>!x.retired);
  const miss=live.filter(x=>x.path&&x.exists===false).length,pend=list.filter(x=>x.pending).length;
  const unset=live.filter(x=>!x.path).length,unknown=live.filter(x=>x.path&&x.exists==null).length;
  const wait=live.reduce((n,x)=>n+pcFilesWaiting(x).length,0);
  const chips=[
   wait?`<span class="pc-chip is-warn">写せていない ${wait}</span>`:'',
   miss?`<span class="pc-chip is-warn">まだ無い ${miss}</span>`:'',
   pend?`<span class="pc-chip is-warn">再起動待ち ${pend}</span>`:'',
   unset?`<span class="pc-chip is-off">未設定 ${unset}</span>`:'',
   unknown?`<span class="pc-chip is-off">確かめられない ${unknown}</span>`:'',
  ].filter(Boolean);
  return chips.length?chips.join(''):'<span class="pc-chip is-ok">すべてあります</span>';
 }
 /* **最初から開く群**: 直す欄を持つ群と、要対応がある群。読むだけで全部そろっていれば畳む
    （ここでは直さない・行き先だけ。見出しが件数と状態を言う）。 */
 const pcGroupOpen=(g,list)=>g.id!=='read'||list.some(x=>!x.retired&&(x.pending||(x.path&&x.exists!==true)||!x.path));
 function paintShareLayout(sl,err){
  const rows=$('#pcShareRows'),root=$('#pcShareRoot');
  if(!rows)return;
  const items=(sl&&sl.items)||[];
  if(!items.length){
   rows.innerHTML=`<p class="pc-empty">置き場の一覧を読めませんでした${err?`: ${esc(err)}`:''}。他の段の設定はこのまま直せます。</p>`;
   return;
  }
  /* 開け閉めは描き直しても保つ（保存のあと開いていた群が畳まれると、直した行を探すことになる）。 */
  const was={};rows.querySelectorAll('[data-store-group]').forEach(d=>{was[d.dataset.storeGroup]=d.open});
  const byGroup={};items.forEach(x=>{(byGroup[x.group]=byGroup[x.group]||[]).push(x)});
  rows.innerHTML=PC_STORE_GROUPS.map(g=>{
   const list=byGroup[g.id]||[];
   if(!list.length)return '';
   const extra=g.id==='terminal'?pcLocalExtraRows(sl&&sl.localConfig):'';
   const table=`${g.id==='terminal'?pcLocalErrorHtml(sl&&sl.localConfigError):''}
    <table class="pc-store"><tbody>${list.map(r=>pcStorageRowHtml(r,sl&&sl.localConfig)+pcRecordsFilesHtml(r)).join('')}${extra}</tbody></table>`;
   const open=g.id in was?was[g.id]:pcGroupOpen(g,list);
   return pageFoldHtml(g.name,`${list.filter(x=>!x.retired).length}か所`,table,open,
    {icon:g.icon,tip:g.tip,tag:`<span class="pc-acc-tags">${pcGroupTag(list)}</span>`,cls:'pc-store-group',id:'pcStore-'+g.id,
     attrs:`data-store-group="${esc(g.id)}"`});
  }).join('');
  if(root){
   /* **揃っているときだけ言う**。揃っていない置き方が悪いわけではないので、「バラバラです」とは書かない。 */
   root.textContent=(sl&&sl.sameRoot)?`本体3つ（マスタ・作業予定・測定データ）とも同じ場所の下です: ${sl.sameRoot}`:'';
   root.hidden=!(sl&&sl.sameRoot);
  }
  bindPathFields(rows);
  bindStorageActions(rows);
  WL.popMenu.tips(rows);
  const form=rows.closest('form');
  if(form){pcMarkClean(rows);pcPaintDirty(form)}
 }

 /* ---------- 再起動待ちと札の数（§9.208 ⑨ → §9.583） ----------
    状態は欄の持ち物なので欄の行が持つ（§8 同じ情報を2箇所に出さない）。
    再起動が要る欄は「再起動で反映」と書き、保存値と効いている値が違えば「再起動待ち」へ塗り替える
    （中身の2つの値は札の`title`）。数は保存の帯と札が言う。 */
 function renderPathConfigList(){
  const form=$('#masterMaintForm');if(!form||!form.querySelector('.pc-page'))return;
  const v=pathConfigState.values||{},a=pathConfigState.active||{};
  /* 「いま効いている値」の言い方。空欄は**何が起きるか**まで書く。 */
  const activeText={sikalot_source:a.sikalot_source||'',
   schedule_share_path:a.schedule_share_path||'（未設定・スケジュール機能は無効）'};
  const savedText={sikalot_source:v.sikalot_source||'（既定）network',
   schedule_share_path:v.schedule_share_path||'（未設定・スケジュール機能は無効）'};
  /* まだ読んでいないデータソースは**「解決できていません」ではなく「再起動後に反映」**（§9.163）。 */
  const pendingKeys=new Set();
  (pathConfigState.sources||[]).forEach(src=>{
   if(src.loaded===false){pendingKeys.add(src.valueKey);activeText[src.valueKey]=`（未反映）再起動すると ${src.planned||'—'} を読みます`}
   else activeText[src.valueKey]=src.active||'（解決できていません）';
   savedText[src.valueKey]=v[src.valueKey]||'（既定値を使用）';
  });
  /* 「再起動待ち」の判定は**表示文字列ではなく生の値**で行う（中身が同じ行まで待ちに見えた）。保存値が空＝既定なので待ちにしない。 */
  const isPending=key=>{
   const savedRaw=String(v[key]||'').trim(),activeRaw=String(a[key]||'').trim();
   return pendingKeys.has(key)||(!!savedRaw&&savedRaw!==activeRaw);
  };
  paintShareLayout(pathConfigState.storage,pathConfigState.storageError);
  const restartKeys=new Set(pathConfigRestartFields().map(([k])=>k));
  let pending=0;
  form.querySelectorAll('[data-pc-state]').forEach(el=>{
   const key=el.dataset.pcState;
   if(!restartKeys.has(key))return;
   const p=isPending(key);
   if(p)pending++;
   el.innerHTML=p?'<span class="pc-chip is-warn pc-pending">再起動待ち</span>':PC_WHEN_RESTART;
   el.title=`いま効いている値: ${activeText[key]||'—'}\n保存値（次の起動から）: ${savedText[key]||'—'}`;
  });
  /* 置き場の行の再起動待ちはサーバーの答え（`pending`）。データソースは置き場の「読むだけ」の行が持つ。 */
  const items=(pathConfigState.storage&&pathConfigState.storage.items)||[];
  pending+=items.filter(x=>x.pending).length;
  (pathConfigState.sources||[]).forEach(src=>{
   if(isPending(src.valueKey)&&!items.some(x=>x.field===src.valueKey)&&!form.querySelector(`[data-pc-state="${src.valueKey}"]`))pending++;
  });
  const badge=$('#pcRestartCount');
  if(badge){
   badge.textContent=pending?`再起動待ち ${pending}件`:'';
   badge.hidden=!pending;
   badge.title=pending?'保存した値は、アプリを開き直すと効きます（'+WL.RESTART_HOW+'）':'';
  }
  /* **マスタDBが同期フォルダーの中にあるとき**の注意（§9.192）。設定ではないが、共有(BOX等)に置いた
     ファイル群を複数のPCから起動する現場では、**知らないと壊れ方が分からない**。
     作り直せるファイルの置き場（§9.109）は置き場の段の行が言うので、ここでは繰り返さない（§8）。 */
  const notes=$('#pcNotes');
  if(notes){
   notes.innerHTML=v.master_cloud?`<p class="mm-warn-note"><b>マスタDBが${esc(v.master_cloud)}の中にあります</b>（${esc(v.db_dir||'')}）。
     このフォルダーを<b>複数のPCから同時に起動すると、全員が同じマスタへ書き込みます</b>——
     同期の衝突で設定が失われることがあります。各PCの手元へ置く場合は
     <code>config/local.json</code> の <code>db_dir</code> を、そのPCのローカルフォルダーへ向けてください
     （共有したいのは作業予定だけです。「置き場」の段の「作業予定」で共有します）。</p>`:'';
  }
  paintPcTabs();
 }
 /* 保存の口は**2つある**（§9.267）——パス設定マスタ（`data-pc-field`）と
    `config/local.json`（`data-lc-field`）。**ボタンは1つ**にする（利用者の
    指示「一元管理したい」）が、片方だけ失敗しうるので**どちらがどうなったかは
    分けて言う**（§4。まとめて「保存しました」と言うと、効いていない側に
    気づけない）。 */
 function pcLocalConfigBody(){
  const body={};
  document.querySelectorAll('#masterMaintForm [data-lc-field]').forEach(el=>{
   body[el.dataset.lcField]=String(el.value||'').trim();
  });
  return body;
 }
 /* いま画面に出ている `local.json` の値と、保存済みの値が違うか。
    **違うときだけ送る**——`local.json`は起動を左右するファイルなので、
    触っていない保存で毎回書き換えない。 */
 function pcLocalConfigChanged(body){
  const saved={};
  ((pathConfigState.storage&&pathConfigState.storage.localConfig)||[])
   .forEach(f=>{saved[f.key]=String(f.value||'')});
  return Object.keys(body).some(k=>String(body[k]||'')!==String(saved[k]||''));
 }
 async function savePathConfigMaint(){
  const uid=requireMaintUser();if(uid===null)return;
  const body={user_id:uid};
  // 数値欄は表示用の3桁区切りが入るので、送る前に外す(§9.49)
  document.querySelectorAll('#masterMaintForm [data-pc-field]').forEach(el=>{
   body[el.dataset.pcField]=el.classList.contains('mm-num-input')?numRaw(el.value):el.value;
  });
  const lc=pcLocalConfigBody();
  const lcChanged=pcLocalConfigChanged(lc);
  try{
   setMaintLoading(true,'パス設定を保存しています…');
   const r=await api('/api/path-config-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   let extra=(r&&r.message)||'';
   if(lcChanged){
    setMaintLoading(true,'この端末の置き場を保存しています…');
    try{
     const lr=await api('/api/storage-layout/local-config',{method:'POST',
       headers:{'Content-Type':'application/json'},body:JSON.stringify(lc)});
     extra=(extra?extra+' ／ ':'')
       +`この端末の置き場（${(lr&&lr.path)||'config/local.json'}）も保存しました。`
       +'<b>サーバーを再起動すると反映されます。</b>';
    }catch(e){
     /* **片方だけ失敗したことを必ず言う**——まとめて「保存しました」と
        返すと、効いていない側に気づけない（§4・§9.190と同じ理由）。 */
     pathConfigState.loaded=false;await loadPathConfigMaint(true);
     showToast&&showToast('この端末の置き場だけ保存できませんでした',
       `他の設定は保存しました。config/local.json は書けませんでした: ${e.message}`,9000);
     return;
    }
   }
   pathConfigState.loaded=false;await loadPathConfigMaint(true);
   showToast&&showToast('パス設定を保存しました',extra,lcChanged?7000:5200);
  }catch(e){showToast&&showToast('保存できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }

 /* ---------- 勤務体系マスタ(親: 勤務体系 / 子: 勤務区分) ----------
    現場の言い方どおりの2階層で編集する。
      日勤              -> 日勤 8:15-17:05
      交替勤務(1,2,3直) -> 1直 7:00-15:00 / 2直 15:00-23:00 / 3直 23:00-翌7:00
    汎用のMASTER_DEFS(1行=1レコードの表)では親子を表現できないため専用画面にする。
    入力負荷を下げる工夫(直打ちを極力減らす):
      - 時刻はinput[type=time]。キーボードでもピッカーでも入れられ、
        "8:15"のような表記ゆれ・全角数字が原理的に入らない。
      - よくある勤務体系はテンプレートからワンクリックで投入できる。
      - 24時間バーで「どの時間帯が埋まっているか」を色で即座に確認できる
        (時刻の数字だけを見比べて抜け漏れを探さなくて済む)。 */
 const SHIFT_TEMPLATES=[
  {label:'日勤',segments:[{name:'日勤',start:'08:15',end:'17:05'}]},
  {label:'交替勤務(1,2,3直)',segments:[
    {name:'1直',start:'07:00',end:'15:00'},{name:'2直',start:'15:00',end:'23:00'},
    {name:'3直',start:'23:00',end:'07:00',dayOffset:-1}]},
  {label:'交替勤務(4,5直)',segments:[
    {name:'4直',start:'11:00',end:'19:10'},{name:'5直',start:'21:20',end:'05:45',dayOffset:-1}]},
 ];
 let shiftState={patterns:[],selectedId:null,draft:null,loading:false,base:'',baseDraft:null};
 /* 適用設備の複数選択(勤務体系マスタ)。**入で選ばれている設備名**を配列で返す。
    印はタグの入切(aria-pressed)で持つ——チェックボックスは`.mm-field input`の
    `min-width:200px`に当たり、器の幅を全部取って**設備名の文字が押し出されて
    見えなくなっていた**(実機で「設備名が消えている」と報告。§9.197)。 */
 function selectedShiftEquipment(){
  return [...document.querySelectorAll('#shiftEquipment [data-shift-eq][aria-pressed="true"]')]
   .map(x=>x.dataset.shiftEq);
 }
 function shiftDraftFrom(p){
  // equipmentは設備名の配列(複数可)。空配列=全設備共通。サーバーが古い形式
  // (単一文字列)を返しても配列へ寄せる。
  const eqList=v=>Array.isArray(v)?v.filter(Boolean).map(String):(String(v||'').trim()?[String(v).trim()]:[]);
  return p?{id:p.id,equipment:eqList(p.equipment),name:p.name||'',
            segments:(p.segments||[]).map(x=>({name:x.name,start:x.start,end:x.end,
              dayOffset:(x.dayOffset==null?null:Number(x.dayOffset))}))}
           :{id:null,equipment:[],name:'',segments:[]};
 }
 /* 開く体系を決める（§9.598）。`base`は開いたときの値（比べる形に揃えた字）——変更の有無はこれと比べる。
    テンプレートから作る新しい体系は「空の体系」を基準にする（作った時点で変更あり＝保存が押せる）。 */
 function shiftOpen(draft,base){
  shiftState.draft=draft;
  shiftState.baseDraft=JSON.parse(JSON.stringify(base||draft));
  shiftState.base=shiftNormJson(shiftState.baseDraft);
 }
 /* 比べる形: 日を跨がない区分の「日付の数え方」は意味を持たない（空）・跨ぐ区分の空は既定（−1）として数える
    （画面の欄が出す値と同じ）。設備は順を問わない。 */
 function shiftNormJson(d){
  d=d||{};
  return JSON.stringify({name:String(d.name||'').trim(),equipment:[...(d.equipment||[])].map(String).sort(),
   segments:(d.segments||[]).map(s=>({name:String(s.name||''),start:s.start||'',end:s.end||'',
    dayOffset:shiftCrossesMidnight(s)?shiftDayOffsetOf(s):null}))});
 }
 function shiftDirty(){
  const list=$('#masterMaintList');
  if(!shiftState.draft)return false;
  if(list&&list.querySelector('.shift-editor'))syncShiftDraft(list);
  return shiftNormJson(shiftState.draft)!==shiftState.base;
 }
 async function loadShiftPatternMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.classList.remove('mm-form-compact');
  if(typeof WL.records.loadEquipmentMaster==='function'){try{await WL.records.loadEquipmentMaster(force)}catch(e){WL.quiet.note('設備が読めなくても編集は続行',e)}}
  list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const r=await api('/api/schedule/shift-pattern-master?scope=all');
   shiftState.patterns=r.items||[];
   if(!shiftState.patterns.some(p=>p.id===shiftState.selectedId))shiftState.selectedId=shiftState.patterns[0]?.id??null;
   shiftOpen(shiftDraftFrom(shiftState.patterns.find(p=>p.id===shiftState.selectedId)));
   renderShiftPattern();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 // 24時間バー上の位置(%)。日跨ぎ(終了<=開始)は2本に分けて描く。
 function shiftBarPieces(seg){
  const toMin=v=>{const m=/^(\d{1,2}):(\d{2})$/.exec(String(v||''));return m?(+m[1])*60+(+m[2]):null};
  const s=toMin(seg.start),e=toMin(seg.end);
  if(s==null||e==null)return [];
  const pct=v=>(v/1440*100);
  return (e<=s)?[[pct(s),pct(1440)-pct(s)],[0,pct(e)]]:[[pct(s),pct(e)-pct(s)]];
 }
 /* 日を跨ぐ区分だけが持つ「日付の数え方」(§9.195の現場歴)。**跨がない区分
    には出さない**——効かない欄を置くと、設定したのに変わらないと読まれる。 */
 const SHIFT_DAYOFF_OPTIONS=[
  {v:-1,label:'前の日として数える（−1日）'},
  {v:0,label:'暦どおり（0日）'},
  {v:1,label:'翌日として数える（＋1日）'},
 ];
 /* **何が選ばれているかを文字で言う**(§3)。見出しに「n/N」（どれも選んでいなければ「全設備共通」）——名前は札が言うので
    並べ直さない（§9.598・同じことを2か所に出さない）。 */
 function shiftEqCountHtml(n,total){
  if(!total)return '';
  /* `<i>`にしない——欄の見出しの中の`<i>`は必須の印（赤）の規則を受ける。 */
  return n?`<span class="shift-eq-count">${n}/${total}</span>`
   :'<span class="shift-eq-count is-all" title="どれも選んでいないので、全設備の既定として使われます">全設備共通</span>';
 }
 /* チェックのたびに**画面を組み直さないこと**——設備が多いと選ぶ器が
    スクロールごと巻き戻り、続けて選べない（§9.117と同じ罠）。文字だけ
    差し替える。 */
 function refreshShiftEqSummary(){
  const box=$('#masterMaintList .shift-eq-head');
  const names=selectedShiftEquipment(),total=(WL.records.equipmentMasterState.items||[]).length;
  const cnt=box&&box.querySelector('.shift-eq-count');
  if(cnt)cnt.outerHTML=shiftEqCountHtml(names.length,total);
  const none=$('#shiftEqNone');if(none)none.disabled=!names.length;
  const all=$('#shiftEqAll');if(all){all.disabled=names.length>=total;all.title=all.disabled?'すべて選ばれています':'すべての設備を選びます'}
  paintShiftFoot();
 }
 function shiftCrossesMidnight(seg){
  const t=v=>{const m=/^(\d{1,2}):(\d{2})$/.exec(String(v||''));return m?(+m[1])*60+(+m[2]):null};
  const a=t(seg&&seg.start),b=t(seg&&seg.end);
  return a!==null&&b!==null&&b<=a;
 }
 function shiftDayOffsetOf(seg){
  if(!shiftCrossesMidnight(seg))return 0;
  return (seg&&seg.dayOffset!=null&&seg.dayOffset!=='')?Number(seg.dayOffset):-1;
 }
 /* 勤務区分の1行。**見出しと同じグリッド定義を共有する**（別々に組むと
    左端がずれる。§9.176と同じ土台）。 */
 const SHIFT_SEG_COLS=[
  {k:'dot',label:''},{k:'name',label:'区分の名称'},{k:'time',label:'時間帯'},
  {k:'next',label:'日跨ぎ'},{k:'dayoff',label:'日付の数え方'},{k:'act',label:''},
 ];
 /* 勤務体系の画面（§9.197）。組み立て（HTML）と配線を段ごとに分けた（§9.522 その7）。
    呼ぶ順は元のまま——頭を描いて配線 → 本体を描いて配線 → 時間帯の合計。 */
 function shiftEqChipsHtml(eqItems,eqSelected){
  /* 設備は**名前のタグの入切**で選ぶ(§9.197、利用者の指示「設備名のバッジを
     出して、配色のONOFF」)。名前そのものが押せる的なので、四角い枠と
     チェックの位置を目で往復しなくてよい。入は面の色で、**色だけで伝えない**
     ため上の要約が件数と名前を文字で言う。 */
  return eqItems.length
   ? eqItems.map(x=>{
      const on=eqSelected.has(x.name);
      return `<button type="button" class="shift-eq-tag${on?' is-on':''}" data-shift-eq="${esc(x.name)}"`
       +` aria-pressed="${on?'true':'false'}" title="${esc(x.name)}を${on?'外す':'この勤務体系の対象にする'}">`
       +`<i aria-hidden="true">${on?'✓':'＋'}</i>${esc(x.name)}</button>`;
     }).join('')
   : '<span class="mm-empty-inline">設備マスタが未登録です。先に「設備」タブで登録してください。</span>';
 }
 /* 頭の行（§9.598）: 主の操作は「＋ 勤務体系を追加 ▾」の1つ。空から・テンプレートから（新しい体系として作る）を選ぶ。
    詳細がいつも見えている画面なので縁取り（塗りの主ボタンは足元の保存の1つ）。 */
 function paintShiftHead(form){
  form.innerHTML='';form.hidden=true;form.onsubmit=ev=>ev.preventDefault();
  const make=(name,segs)=>()=>WL.mm.afterLeave(()=>{
   shiftState.selectedId=null;
   shiftOpen({...shiftDraftFrom(null),name,segments:segs.map(x=>({...x}))},shiftDraftFrom(null));
   renderShiftPattern();
  });
  WL.mm.setHeadActs({primary:{id:'shiftNew',label:'勤務体系を追加',title:'空から、またはテンプレートから作ります',
   menu:[{label:'空の勤務体系',note:'区分を1つずつ足します',data:{shiftTmpl:'blank'},onClick:make('',[])}]
    .concat(SHIFT_TEMPLATES.map((t,i)=>({label:t.label,note:t.segments.map(x=>`${x.name} ${x.start}〜${x.end}`).join('・'),
     data:{shiftTmpl:String(i)},onClick:make(t.label,t.segments)})))}});
 }
 /* 24時間の帯（§9.598）。区分の名前を帯に書き（色だけで言わない）、`data-seg`で入力中の行と結ぶ。`mini`は左の一覧の小さな帯。 */
 function shiftBarHtml(segs,mini){
  return (segs||[]).map((seg,i)=>shiftBarPieces(seg).map(([left,w])=>
    `<span class="shift-bar-piece" data-i="${i%6}" data-seg="${i}" style="left:${left}%;width:${w}%" title="${esc(seg.name)} ${esc(seg.start)}〜${esc(seg.end)}">${mini?'':`<b>${esc(seg.name)}</b>`}</span>`).join('')).join('');
 }
 /* 左の一覧の1件: 名前・小さな24時間の帯・「n設備・m区分」（何に効くかを開かずに読める）。 */
 function shiftListItemHtml(p,activeId){
  const n=(p.equipment&&p.equipment.length)||0,segs=p.segments||[];
  return `<button type="button" class="shift-list-item${p.id===activeId?' active':''}" data-shift-pattern="${p.id}">`
   +`<b>${esc(p.name)}</b><span class="shift-mini24" aria-hidden="true">${shiftBarHtml(segs,true)}</span>`
   +`<small title="${esc(p.equipmentText||'全設備共通')}">${n?`${n}設備`:'全設備共通'}・${segs.length}区分</small></button>`;
 }
 function shiftEditorHtml(d,eqItems,eqSelected){
  const eqChips=shiftEqChipsHtml(eqItems,eqSelected);
  const bars=shiftBarHtml(d.segments);
  const segHead=`<div class="shift-seg-head">${
    SHIFT_SEG_COLS.map(c=>`<span class="shift-seg-h shift-seg-c-${c.k}">${esc(c.label)}</span>`).join('')}</div>`;
  const segRow=(seg,i)=>{
   const cross=shiftCrossesMidnight(seg);
   const off=shiftDayOffsetOf(seg);
   return `<div class="shift-seg" data-i="${i}">
     <span class="shift-seg-dot" data-i="${i%6}"></span>
     <input class="shift-seg-name" type="text" value="${esc(seg.name)}" placeholder="例: 1直" autocomplete="off">
     <span class="shift-seg-time">
      <input class="shift-seg-start" type="time" value="${esc(seg.start)}">
      <span class="shift-seg-sep">〜</span>
      <input class="shift-seg-end" type="time" value="${esc(seg.end)}"></span>
     <span class="shift-seg-next${cross?'':' is-empty'}">${cross?'翌日':''}</span>
     ${cross
       ?`<select class="shift-seg-dayoff" title="日を跨いだ後の時間帯を、どの日として数えるか">${
          SHIFT_DAYOFF_OPTIONS.map(o=>`<option value="${o.v}"${o.v===off?' selected':''}>${esc(o.label)}</option>`).join('')}</select>`
       :'<span class="shift-seg-dayoff is-na" title="日を跨がない区分なので、日付の補正はありません">—</span>'}
     <span class="shift-seg-act">
      <button type="button" class="shift-seg-up" title="上へ"${i===0?' disabled':''}>▲</button>
      <button type="button" class="shift-seg-down" title="下へ"${i===d.segments.length-1?' disabled':''}>▼</button>
      <button type="button" class="shift-seg-more mm-btn-ghost mm-hd-more" aria-haspopup="menu" aria-expanded="false" aria-label="この区分の操作" title="この区分の操作（消すなど）"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button></span>
    </div>`;
  };
  return `<div class="shift-editor">
    <aside class="shift-list">
     <div class="shift-list-head">勤務体系 <i class="shift-list-n">${shiftState.patterns.length}件</i></div>
     ${shiftState.patterns.length?shiftState.patterns.map(p=>shiftListItemHtml(p,d.id)).join('')
       :'<div class="mm-empty-inline">まだありません。右上の「＋ 勤務体系を追加」からテンプレートで作れます。</div>'}
    </aside>
    <section class="shift-detail">
     <div class="mm-dhead"><div><small>勤務体系</small><h3>${esc(d.name||'新しい勤務体系')}</h3></div>
      ${d.id?'<button type="button" class="mm-btn-ghost mm-hd-more" id="shiftMore" aria-haspopup="menu" aria-expanded="false" aria-label="この勤務体系の操作" title="この勤務体系の操作（削除など）"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button>':''}</div>
     <div class="shift-fields">
      <label class="mm-field shift-f-name"><span>勤務体系の名称<i>*</i></span>
       <input id="shiftName" type="text" value="${esc(d.name)}" placeholder="例: 交替勤務(1,2,3直)" autocomplete="off"></label>
      <div class="mm-field shift-f-eq"><span class="shift-eq-head">適用設備 ${shiftEqCountHtml(eqSelected.size,eqItems.length)}</span>
       ${eqItems.length?`<span class="shift-eq-act">
          <button type="button" class="mm-btn-ghost sm" id="shiftEqAll"${eqSelected.size>=eqItems.length?' disabled title="すべて選ばれています"':' title="すべての設備を選びます"'}>すべて選ぶ</button>
          <button type="button" class="mm-btn-ghost sm" id="shiftEqNone"${eqSelected.size?'':' disabled'}>全設備共通に戻す</button>
         </span>`:''}
       <div class="shift-eq-picker" id="shiftEquipment">${eqChips}</div></div>
     </div>
     <div class="shift-bar-wrap">
      <div class="shift-bar" title="24時間のうち、どの時間帯がどの区分か">${bars}<span class="shift-bar-noon"></span></div>
      <div class="shift-bar-scale"><span>0時</span><span>6時</span><span>12時</span><span>18時</span><span>24時</span></div>
      <div class="shift-cov" id="shiftCoverage" role="status"></div>
     </div>
     <div class="shift-segs" id="shiftSegs">${
       d.segments.length?segHead+d.segments.map(segRow).join('')
       :'<div class="mm-empty-inline">区分がありません。「＋ 区分を追加」かテンプレートから追加してください。</div>'}
     </div>
     <div class="shift-actions">
      <button type="button" id="shiftAddSeg" class="mm-btn-ghost sm">＋ 区分を追加</button>
     </div>
     <!-- 足元は1つの部品（§9.598・右の詳細と同じ）: 左に状態と記録者・右にキャンセルと保存。変更が無いうちは押せない。 -->
     <div class="mm-dfoot">
      <span class="mm-form-hint" id="shiftDirty"></span>
      <button type="button" id="shiftCancel" class="mm-btn-ghost">キャンセル</button>
      <button type="button" id="shiftSave" class="mm-btn-primary">保存</button>
     </div>
    </section>
   </div>`;

 }
 /* 画面の欄から下書きへ写す（押した操作の前に呼ぶ）。 */
 function syncShiftDraft(list){
  const dd=shiftState.draft;
  dd.name=$('#shiftName').value;dd.equipment=selectedShiftEquipment();
  dd.segments=[...list.querySelectorAll('.shift-seg')].map(el=>{
   const off=el.querySelector('select.shift-seg-dayoff');
   return {name:el.querySelector('.shift-seg-name').value,
           start:el.querySelector('.shift-seg-start').value,
           end:el.querySelector('.shift-seg-end').value,
           dayOffset:off?Number(off.value):null};
  });
 }
 function wireShiftEquipment(list){
  /* タグの入切。**押した瞬間にその場で切り替える**——画面を組み直すと器が
     スクロールごと巻き戻り、続けて選べない(§9.117と同じ罠)。 */
  $('#shiftEquipment')?.querySelectorAll('[data-shift-eq]').forEach(tag=>{
   tag.onclick=ev=>{
    ev.preventDefault();
    const on=tag.getAttribute('aria-pressed')!=='true';
    tag.setAttribute('aria-pressed',on?'true':'false');
    tag.classList.toggle('is-on',on);
    const mark=tag.querySelector('i');if(mark)mark.textContent=on?'✓':'＋';
    tag.title=`${tag.dataset.shiftEq}を${on?'外す':'この勤務体系の対象にする'}`;
    shiftState.draft.equipment=selectedShiftEquipment();
    refreshShiftEqSummary();
   };
  });
  const eqAll=$('#shiftEqAll');
  if(eqAll)eqAll.onclick=()=>{syncShiftDraft(list);
   shiftState.draft.equipment=(WL.records.equipmentMasterState.items||[]).map(x=>x.name);renderShiftPattern()};
  const eqNone=$('#shiftEqNone');
  if(eqNone)eqNone.onclick=()=>{syncShiftDraft(list);shiftState.draft.equipment=[];renderShiftPattern()};
 }
 function wireShiftSegments(list){
  list.querySelectorAll('.shift-seg').forEach(el=>{
   const i=+el.dataset.i;
   // 時刻・名称の変更はその場でバーへ反映する(保存前に結果が見える)。
   el.querySelectorAll('input').forEach(inp=>inp.onchange=()=>{syncShiftDraft(list);renderShiftPattern()});
   const off=el.querySelector('select.shift-seg-dayoff');
   if(off)off.onchange=()=>{syncShiftDraft(list);renderShiftPattern()};
   /* 区分を消すのは ⋯ のメニュー（§9.598 1i・行の×は主の動線に置いた危ない操作だった）。保存するまでは取り消せる（キャンセル）。 */
   const more=el.querySelector('.shift-seg-more');
   more.onclick=()=>WL.mm.openActMenu(more,[{label:'この区分を消す',danger:true,data:{shiftSegAct:'delete'},
    note:'保存するまでは「キャンセル」で戻せます',onClick:()=>{syncShiftDraft(list);shiftState.draft.segments.splice(i,1);renderShiftPattern()}}],'この区分の操作');
   el.querySelector('.shift-seg-up').onclick=()=>{syncShiftDraft(list);if(i>0)shiftState.draft.segments.splice(i-1,0,shiftState.draft.segments.splice(i,1)[0]);renderShiftPattern()};
   el.querySelector('.shift-seg-down').onclick=()=>{syncShiftDraft(list);const a=shiftState.draft.segments;if(i<a.length-1)a.splice(i+1,0,a.splice(i,1)[0]);renderShiftPattern()};
  });
  $('#shiftAddSeg').onclick=()=>{
   syncShiftDraft(list);
   const segs=shiftState.draft.segments;
   const last=segs[segs.length-1];
   // 直前の区分の終了時刻を次の開始時刻の初期値にする(連続する直の入力が
   // ほぼクリックだけで済む)。
   segs.push({name:`${segs.length+1}直`,start:last?last.end:'08:00',end:last?last.end:'17:00',dayOffset:null});
   renderShiftPattern();
  };
 }
 function renderShiftPattern(){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  const d=shiftState.draft||shiftDraftFrom(null);
  const eqSelected=new Set((d.equipment||[]).map(String));
  const eqItems=(WL.records.equipmentMasterState.items||[]);
  paintShiftHead(form);
  /* 器の高さを中まで届ける（設備停止と同じ・足元を右の下端へ・§9.598 1i）。外すのは`loadMaintInner()`の1箇所。 */
  list.classList.add('is-fill');list.parentElement&&list.parentElement.classList.add('is-fill');
  list.innerHTML=shiftEditorHtml(d,eqItems,eqSelected);
  /* 別の体系へ移るときも、保存していない変更があれば聞く（`afterLeave`・黙って捨てない）。 */
  list.querySelectorAll('[data-shift-pattern]').forEach(b=>b.onclick=()=>WL.mm.afterLeave(()=>{
   shiftState.selectedId=+b.dataset.shiftPattern;
   shiftOpen(shiftDraftFrom(shiftState.patterns.find(p=>p.id===shiftState.selectedId)));
   renderShiftPattern();
  }));
  $('#shiftName').oninput=()=>{shiftState.draft.name=$('#shiftName').value;paintShiftFoot()};
  wireShiftEquipment(list);
  wireShiftSegments(list);
  const more=$('#shiftMore');
  if(more)more.onclick=()=>WL.mm.openActMenu(more,[{label:'この勤務体系を削除…',title:'確かめる窓が出ます',danger:true,
   data:{shiftAct:'delete'},onClick:()=>deleteShiftPattern(d)}],'この勤務体系の操作');
  $('#shiftSave').onclick=()=>{syncShiftDraft(list);saveShiftPattern()};
  $('#shiftCancel').onclick=()=>{shiftState.draft=JSON.parse(JSON.stringify(shiftState.baseDraft));renderShiftPattern()};
  const ed=list.querySelector('.shift-editor');
  ed.addEventListener('input',paintShiftFoot);ed.addEventListener('change',paintShiftFoot);
  ed.addEventListener('focusin',ev=>shiftHot(ev.target.closest('.shift-seg')));
  renderShiftCoverage(d);
  paintShiftFoot();
 }
 /* 入力中の区分の行と、帯の同じ区分を結ぶ（§9.598・図と入力）。 */
 function shiftHot(row){
  const list=$('#masterMaintList');if(!list)return;
  list.querySelectorAll('.shift-seg.is-focus,.shift-bar-piece.is-hot').forEach(e=>e.classList.remove('is-focus','is-hot'));
  if(!row)return;
  row.classList.add('is-focus');
  list.querySelectorAll(`.shift-bar .shift-bar-piece[data-seg="${CSS.escape(row.dataset.i)}"]`).forEach(p=>p.classList.add('is-hot'));
 }
 /* 足元: 状態と記録者。変更が無いうちは保存・キャンセルを押せない（新しい体系は名前と区分が入れば押せる）。 */
 function paintShiftFoot(){
  const st=$('#shiftDirty');if(!st)return;
  WL.mm.paintFootState(st,[$('#shiftSave'),$('#shiftCancel')],!(shiftState.draft&&shiftState.draft.id),shiftDirty());
 }
 /* 帯の真下に、24時間を埋めているかを字と印で言う（§9.598・帯が「何を言っているか」を読ませる）。 */
 function renderShiftCoverage(d){
  const el=$('#shiftCoverage');if(!el)return;
  const total=d.segments.reduce((a,seg)=>a+shiftBarPieces(seg).reduce((x,[,w])=>x+w,0),0);
  if(!d.segments.length){el.textContent='';el.className='shift-cov';return}
  const ok=total>=99.5;
  el.className='shift-cov '+(ok?'is-ok':'is-warn');
  el.innerHTML=`<i class="fa-solid ${ok?'fa-circle-check':'fa-triangle-exclamation'}" aria-hidden="true"></i>`
   +(ok?'24時間をすべてカバーしています':`24時間のうち約${Math.round(total)}%をカバーしています（すき間があります）`);
 }
 async function saveShiftPattern(){
  const uid=requireMaintUser();if(uid===null)return;
  const d=shiftState.draft;
  if(!String(d.name||'').trim()){showToast('入力を確認してください','勤務体系の名称を入力してください。',4000);return}
  try{
   setMaintLoading(true,'勤務体系を保存しています…');
   const r=await api('/api/schedule/shift-pattern-master',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:d.id,equipment:d.equipment||[],name:d.name,segments:d.segments,user_id:uid})});
   shiftState.selectedId=r.id;
   await loadShiftPatternMaint(true);
   showToast&&showToast('勤務体系を保存しました',`${d.name}(${d.segments.length}区分)`,3600);
  }catch(e){showToast&&showToast('保存できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }
 async function deleteShiftPattern(d){
  const uid=requireMaintUser();if(uid===null)return;
  if(!d.id)return;
  {
   const ok=await confirmModal({eyebrow:'勤務形態',title:'この勤務体系を削除しますか？',
    message:`「${d.name}」とその配下の区分(${d.segments.length}件)を無効化します。`,confirmLabel:'削除する',danger:true});
   if(!ok)return;
  }
  try{
   setMaintLoading(true,'勤務体系を削除しています…');
   await api('/api/schedule/shift-pattern-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:d.id,user_id:uid})});
   shiftState.selectedId=null;
   await loadShiftPatternMaint(true);
   showToast&&showToast('勤務体系を削除しました',d.name,3600);
  }catch(e){showToast&&showToast('削除できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }


 /* ================================================================
    不要ファイルの掃除（§9.249 ①、利用者の指示）
    ----------------------------------------------------------------
    「溜まってくると問題なので、不要なキャッシュファイルや不要なバックアップ
      ファイルを削除する機能を実装してください。いらないものや世代の古いものは
      定期的に削除するような機能も欲しいです。」

    **判定はサーバーの1箇所**（`backend/file_cleanup.py`）。画面は
    返ってきた種別をそのまま並べるだけで、「どのファイルが要る／要らない」の
    規則を持たない（§9.163。2つ持つと画面が「消える」と言ったものが残る）。

    画面の作り（§CLAUDE「画面を作るときの基準」）:
     ・**面積は頻度×重要度。** いちばん大きいのは「いま何MB片付くか」と
       押すボタン——ここへ来る人はそれを見に来ている。設定は下段。
     ・**次にすることを1つだけ指す。** 溜まっていなければ「いまは何もする
       必要がありません」と書き、ボタンを押せなくする（§4）。
     ・**色だけで伝えない。** 種別ごとに件数・容量・**何が消えて何が残るか**を
       文字で出す。残す理由も1件ずつ言う（推測させない）。
     ・**消す前に何が消えるかを出す**（§9.193の下見と同じ作法）。確認は
       まとめて1回だけ（種別ごとに聞くと読まずに押す癖が付く・§9.170）。
    ================================================================ */
 let cleanupState={data:null,loaded:false,picked:null,busy:false};
 function clSize(n){
  const v=Number(n)||0;
  /* **単位を落とさない**（§CLAUDE 6）。「0・1件」だと0が何の0なのか読めない。 */
  if(v<=0)return '0B';
  if(v<1024)return v+'B';
  if(v<1048576)return (v/1024).toFixed(0)+'KB';
  if(v<1073741824)return (v/1048576).toFixed(1)+'MB';
  return (v/1073741824).toFixed(2)+'GB';
 }
 function clWhen(sec){
  if(!sec)return '—';
  const t=Number(sec)*1000;
  if(!Number.isFinite(t))return '—';
  const d=Math.floor((Date.now()-t)/86400000);
  const stamp=new Date(t).toLocaleDateString('ja-JP',{month:'2-digit',day:'2-digit'});
  return d<1?`${stamp}（今日）`:`${stamp}（${d}日前）`;
 }
 function clEvery(sec){
  const n=Math.max(1,Math.round(Number(sec||0)/60));
  return n<60?`${n}分ごと`:(n%60?`${Math.floor(n/60)}時間${n%60}分ごと`:`${Math.floor(n/60)}時間ごと`);
 }
 /* 選んでいる種別。**既定は「消せるものがある種別」すべて**。
    以前は自動掃除の対象だけを選んでいたが、そうすると上の帯が
    「8.2MB片付けられます」と言っているのにボタンが押せない、という
    **画面が自分の言ったことを否定する**状態が作れた（§CLAUDE 2「次にする
    ことを1つだけ指す」・§4）。消す前には必ず**何が消えるかを1件ずつ並べた
    確認**が出る（§9.193）ので、選んだまま押しても不意打ちにはならない。
    自動掃除の対象外であることは、カードにも確認にも文字で出す（§CLAUDE 3）。 */
 function clPicked(){
  const cats=(cleanupState.data&&cleanupState.data.categories)||[];
  if(!cleanupState.picked){
   cleanupState.picked=new Set(cats.filter(c=>c.removable>0).map(c=>c.key));
  }
  return cleanupState.picked;
 }
 function clPickedStats(){
  const cats=((cleanupState.data&&cleanupState.data.categories)||[]).filter(c=>clPicked().has(c.key));
  return {n:cats.reduce((a,c)=>a+c.removable,0),bytes:cats.reduce((a,c)=>a+c.removableBytes,0),cats};
 }
 async function loadCleanupMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&cleanupState.loaded){renderCleanup();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">溜まっているファイルを調べています…</div>';
  try{
   const [d,cfg]=await Promise.all([api('/api/cleanup'),api('/api/path-config-master')]);
   cleanupState.data=d;cleanupState.cfg=cfg;cleanupState.loaded=true;cleanupState.picked=null;
   renderCleanup();
  }catch(e){list.innerHTML=`<div class="mm-empty error">調べられませんでした: ${esc(e.message)}</div>`}
 }
 /* 不要ファイル掃除（§9.249 → §9.601）: 頭の下に「何がどれだけ片付けられるか」の帯（種別ごとの色・残すもの）→ 左の段
    「片付ける」（表＋足元の「選んだものを掃除する」）／「定期掃除」（欄＋足元の保存）／「置き場」（どこを見ているか）。
    以前は本文の頭に説明の段落・量の箱・「次にすること」の帯が並び、22.4MB が4か所に出ていた（同じ数を2か所に出さない・§CLAUDE 8）。
    いま空の種別は表の札「いま空」に畳む（溜まっていないのがふつうの状態なので、そこへ画面を割かない・§CLAUDE 1）。 */
 const clView={tab:'hot'};   // 片付ける段の表の札（片付けられる／いま空）
 function renderCleanup(){
  const d=cleanupState.data||{},tot=d.total||{},pol=d.policy||{},st=d.state||{};
  const hot=(d.categories||[]).filter(c=>c.removable>0);
  setHeadActs({more:[{label:'調べ直す',note:'溜まっているファイルを数え直します',data:{clAct:'reload'},
   onClick:()=>{cleanupState.loaded=false;loadCleanupMaint(true)}}]});
  const form=mountSetPage({key:'cleanup',figure:clBarHtml(hot,tot),secs:[
   {key:'run',name:'片付ける',icon:'fa-broom',sub:'選んで掃除',body:'<div class="mm-list mm-set-list" id="clList"></div>',
    foot:setFootHtml('','<button type="button" id="clRun" class="mm-btn-primary">選んだものを掃除する</button>'),
    state:tot.removable?clSize(tot.removableBytes):'なし'},
   {key:'auto',name:'定期掃除',icon:'fa-clock',sub:'決めた間隔で',body:clAutoHtml(pol),foot:setFootHtml('変更なし',SET_SAVE_BTNS),
    state:pol.auto?`入・${clEvery(pol.intervalSec).replace(/ごと$/,'')}`:'切'},
   {key:'place',name:'置き場',icon:'fa-folder-open',sub:'どこを見ているか',body:clPlaceHtml(d),
    state:st.lastError?'前回は失敗':'正常',tone:st.lastError?'bad':''}]});
  if(!form)return;
  clFillList();
  $('#clRun').onclick=()=>cleanupRun();
  const iv=$('#clInterval'),every=$('#clEvery');
  if(iv&&every)iv.addEventListener('input',()=>{every.textContent=clEvery(numRaw(iv.value))});
  wireSetSave(setPanel(form,'auto'),body=>savePathSettings(body,'次の掃除から新しい決まりで片付けます',
   ()=>{cleanupState.loaded=false;loadCleanupMaint(true)}),'clSaveCfg');
 }
 /* 頭の下の帯: 片付けられる種別ごとの量（色は表の小さな帯と同じ）と残すもの。数は表の行が言う（凡例は名前だけ）。 */
 function clBarHtml(hot,tot){
  const parts=hot.map((c,i)=>({cls:'is-c'+(i%5),name:c.label,v:c.removableBytes,text:''}));
  parts.push({cls:'is-rest',name:'残すもの（作り直せない・新しい世代）',v:Math.max(0,(tot.bytes||0)-(tot.removableBytes||0))});
  return setBarHtml(parts,esc(`全体 ${clSize(tot.bytes||0)}・${tot.files||0}件`),'全体のうち片付けられる量（種別ごと）');
 }
 /* 片付ける段の表。**チェックは`click`で受ける**（§9.90）——ここは足元の字とボタンだけを塗り直す（表は描き直さない）。 */
 function clFillList(){
  const d=cleanupState.data||{},cats=d.categories||[],pick=clPicked();
  const hot=cats.filter(c=>c.removable>0),cold=cats.filter(c=>!c.removable);
  const max=Math.max(1,...hot.map(c=>c.removableBytes)),now=clView.tab==='cold'?'cold':'hot';
  const ex=c=>{const ns=(c.examples||[]).map(x=>x.name),more=Math.max(0,c.removable-Math.min(2,ns.length));
   return `${esc(ns.slice(0,2).join('・')||'—')}${more?` <small class="mm-set-more">ほか${more}件</small>`:''}`};
  /* 2行目は消し方（短い一言）、何のファイルかは ⓘ（行を3行に膨らませない）。 */
  const name=c=>`<b>${esc(c.label)}</b>${tipHtml(c.note)}<small class="mm-set-sub">${esc(String(c.why||'').replace(/\*\*/g,''))}</small>`;
  const o=now==='hot'?{
   cols:[{label:'',w:'32px'},{label:'種別',w:'minmax(280px,2fr)'},{label:'量',w:'minmax(170px,1fr)',num:true},
    {label:'いちばん古い',w:'120px'},{label:'自動掃除',w:'88px',tip:'定期掃除でも消えるか（対象外は押したときだけ消えます）'},{label:'消えるもの（例）',w:'minmax(160px,1.2fr)'}],
   rows:hot.map((c,i)=>({title:(c.examples||[]).map(x=>x.name).join('\n'),cells:[
    `<input type="checkbox" data-cl-pick="${esc(c.key)}"${pick.has(c.key)?' checked':''} aria-label="${esc(c.label)}を選ぶ">`,name(c),
    `<span class="mm-set-mini"><i class="is-c${i%5}" style="width:${Math.max(2,Math.round(c.removableBytes/max*100))}%"></i></span>${clSize(c.removableBytes)}・${c.removable}件`
     +(c.kept?`<small class="mm-set-sub">残す ${c.kept}件</small>`:''),
    clWhen(c.oldest),c.auto?'対象':'対象外',ex(c)]})),
   empty:{title:'片付けられるファイルはありません',text:'溜まってきたら、ここに種別ごとに出ます。'}}
   :{cols:[{label:'種別',w:'minmax(280px,2fr)'},{label:'自動掃除',w:'88px'},{label:'残すもの',w:'minmax(160px,1fr)'}],
    rows:cold.map(c=>({cells:[name(c),c.auto?'対象':'対象外',c.kept?`${c.kept}件は残します`:'—']})),
    empty:{title:'いま空の種別はありません'}};
  fillSetList($('#clList'),{key:'cleanup:'+now,label:'片付ける種別',now,onTab:k=>{clView.tab=k;clFillList()},
   tabs:[{key:'hot',label:'片付けられる',n:`${hot.length}種`},{key:'cold',label:'いま空',n:`${cold.length}種`}],...o});
  $('#clList').querySelectorAll('[data-cl-pick]').forEach(b=>b.onclick=()=>{
   if(b.checked)pick.add(b.dataset.clPick);else pick.delete(b.dataset.clPick);
   paintClRun();
  });
  paintClRun();
 }
 /* 足元: 何種別を選んでいるか・掃除するボタン（消える量を字で）。選んでいないときは押せない理由を左の字が言う。 */
 function paintClRun(){
  const sel=clPickedStats(),b=$('#clRun');if(!b)return;
  const st=b.closest('.mm-set-foot').querySelector('.pc-dirty');
  b.disabled=!sel.n;b.title=sel.n?'選んだ種別のファイルを消します（消す前に何が消えるかを確かめます）':'種別を選ぶと押せます';
  b.textContent=`選んだものを掃除する${sel.n?`（${clSize(sel.bytes)}）`:''}`;
  st.textContent=sel.n?`選んでいるのは ${sel.cats.length}種別（消すのは押したあとの確かめの先）`:'種別を選ぶと掃除できます（表の左端の印）';
 }
 /* 段「定期掃除」。**送るのはこの4つだけ**（パス設定は送った鍵だけ書く・§9.192）。保存は足元の1つ。 */
 function clAutoHtml(pol){
  const v=(cleanupState.cfg&&cleanupState.cfg.values)||{};
  const on=pol.auto,iv=String(v.cleanup_interval_sec||pol.intervalSec||21600);
  const num=(k,label,unit,step,min,max,val,id)=>numFieldHtml({k,label,unit,step,min,max},val,`id="${id}" data-set-field="${k}"`);
  return setRowsHtml([
   setRow('定期掃除',`<select id="clAuto" data-set-field="cleanup_auto_enabled"><option value="on"${on?' selected':''}>入（決めた間隔で片付ける）</option>`
     +`<option value="off"${on?'':' selected'}>切（押したときだけ片付ける）</option></select>`,
    {tip:'アプリが動いているあいだ、**自動掃除の対象**の種別だけを決めた間隔で片付けます。**バイトコードと古い作業フォルダは自動では消しません**（消すと次の起動が一度だけ遅くなる／中身を確かめてから消したいため）。切にしても「片付ける」から手で掃除できます。'}),
   setRow('掃除の間隔',num('cleanup_interval_sec','掃除の間隔','秒',300,300,null,iv,'clInterval'),
    {tip:'300秒（5分）以上。既定は21600秒＝6時間です。保存後すぐ反映されます（再起動は要りません）。',state:`<span class="mm-set-why" id="clEvery">${esc(clEvery(iv))}</span>`}),
   setRow('残す世代',num('cleanup_keep_generations','残す世代','世代',1,1,50,String(v.cleanup_keep_generations||pol.keepGenerations||3),'clGens'),
    {tip:'ログ・バックアップで**新しいほうから残す本数**です。'}),
   setRow('残す日数',num('cleanup_keep_days','残す日数','日',1,1,3650,String(v.cleanup_keep_days||pol.keepDays||14),'clDays'),
    {tip:'この日数以内のものは、世代の数に関わらず残します。'})]);
 }
 /* 段「置き場」（読むだけの値・枠を付けない）。 */
 function clPlaceHtml(d){
  const st=d.state||{},places=d.places||{};
  const path=p=>`<code class="mm-set-path" title="${esc(p||'')}">${esc(p||'—')}</code>`;
  return setRowsHtml([
   setRow('最後の掃除',esc(st.lastRunAt?`${clWhen(st.lastRunAt)}・${st.lastRemoved||0}件 ${clSize(st.lastFreed||0)}`:'まだ走っていません')),
   st.lastError?setRow('前回の言い分',`<span class="mm-set-warn">${esc(st.lastError)}</span>`):'',
   setRow('写しの置き場',path(places.cache)),setRow('ログの置き場',path(places.logs)),setRow('控えの置き場',path(places.backup))]);
 }
 /* 消す。**確認はまとめて1回**（§9.170）。何が消えるかは種別ごとの件数と
    容量で出す——「本当によろしいですか？」だけでは読まずに押す癖が付く。 */
 async function cleanupRun(){
  if(cleanupState.busy)return;
  const sel=clPickedStats();
  if(!sel.n)return;
  const body=`<p class="confirm-modal-message">次のファイルを消します。<b>取り消せません。</b></p>
   <ul class="cl-confirm">${sel.cats.filter(c=>c.removable).map(c=>
     `<li><b>${esc(c.label)}</b>${c.auto?'':'<i>自動掃除の対象外</i>'}<em>${clSize(c.removableBytes)}・${c.removable}件</em></li>`).join('')}</ul>
   <p class="confirm-modal-message">合計 <b>${clSize(sel.bytes)}（${sel.n}件）</b>。
    どれも<b>作り直せるファイル</b>で、測定データ・マスタ・共有スケジュールには触れません。</p>`;
  const ok=await confirmModal({title:'不要ファイルを消します',bodyHtml:body,
                              confirmLabel:'掃除する',danger:true});
  if(!ok)return;
  cleanupState.busy=true;
  try{
   setMaintLoading(true,'掃除しています…');
   const r=await api('/api/cleanup/run',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({categories:[...clPicked()]})});
   /* **消せなかったものは失敗にしない**（§9.108）——待てば消せるので次の
      掃除で消える。黙らずに件数と理由を言う（§CLAUDE 4）。 */
   showToast&&showToast(`${r.removed||0}件・${clSize(r.bytes||0)}を片付けました`,
     r.failed?`${r.failed}件は使用中のため残りました（次の掃除で消えます）`:'',
     r.failed?7000:3600);
  }catch(e){showToast&&showToast('掃除できませんでした',e.message,7000)}
  finally{cleanupState.busy=false;setMaintLoading(false);cleanupState.loaded=false;loadCleanupMaint(true)}
 }


 /* ================================================================
    専用タブを持たないマスタを、階層の中で編集する（§9.249 ②、利用者の指示）
    ----------------------------------------------------------------
    「テーブル生データ内で閲覧可能なマスタかつ、テーブル生データマスタの配置
      された階層にないものは、この階層に配置し、編集可能な形に実装してください。」

    これまで`master.sqlite3`の表のうちタブを持たないものは、「テーブル生データ」
    から**眺めることしかできなかった**。直したいときは、その表を書いている
    画面（列の設定パネル・登録フィルタ・行の色…）を思い出して探しに行く必要が
    あり、**どこからも直せない表**（移行済みの旧マスタ）も混ざっていた。

    作り（**新しい画面を作らない**のが要点・§9.120）:
     ・**表の一覧と扱いはサーバーが答える**（`/api/master-table/catalog`）。
       画面には表の名前を1つも書かない（§9.163）。
     ・答えを**`def`の形へ翻訳するだけ**で、一覧・編集モーダル・削除・検索は
       既存の汎用CRUDがそのまま動く（`endpoint`＋`/update`＋`/delete`の
       4本セット・§CLAUDE「マスタ管理の汎用CRUDは4本セット」）。
     ・**入力欄は表の作り（PRAGMA）から組み立てる**——列を足しても書き足さない。
     ・**ふだんの直し方があるものは、それを画面に書く**（§CLAUDE 6）。
       ここで直せることと、専用の画面があることは両立する。
     ・**移行済みの表は別の群にして「もう読みません」と書く**（§4）。
       直せると書いておいて画面が変わらないのは、押せないボタンより悪い。
    ================================================================ */
 let mtState={loaded:false,loading:null,tables:[],err:''};
 /* 列の作りから入力欄を組み立てる。**監査列と主キーは出さない**
    （サーバーが埋める・付け替えられない）。 */
 function mtFieldOf(col,longNames){
  const name=String(col.name||'');
  const decl=String(col.decl||'').toUpperCase();
  const f={k:name,label:name};
  if(/INT|REAL|NUM|FLOA|DOUB/.test(decl))f.type='number';
  else if(longNames.some(x=>name.indexOf(x)>=0))Object.assign(f,{type:'textarea',rows:4,size:'full'});
  /* **必須は「空を受け付けない列」だけ**。既定値のある列は空でも通る。 */
  if(col.notnull&&col.default===null&&!/INT|REAL|NUM/.test(decl))f.required=true;
  return f;
 }
 function mtDefOf(t){
  const longNames=t.long||[];
  /* **「触らせない列」の判定はサーバーの1つの印を見る**（§9.163）。
     監査列と、rowidの別名になる`INTEGER PRIMARY KEY`だけが`auto`。
     利用者が決める鍵（`TEXT PRIMARY KEY`）は編集できる。 */
  const cols=(t.schema||[]).filter(c=>!(c.auto!==undefined?c.auto:(c.audit||c.pk)));
  const fields=cols.map(c=>mtFieldOf(c,longNames));
  /* 列の見せ方はサーバーの語彙（§9.599・`COLUMN_VIEWS`）。区分で読む列が変わる2列は1列「いつ」にまとめ、値→字を当てる。
     「有効」は -1/1/0 の内部の値でなく字で。編集の欄（`fields`）は列そのままで変えない。 */
  const views=t.views||{},when=views.when||null,words=views.words||{};
  const listCols=cols.filter(c=>!(when&&(c.name===when.week||c.name===when.date)));
  const colOf=(c,i)=>{
   const o={k:c.name,label:c.name,grow:i===0?2:1};
   if(when&&c.name===when.kind)return Object.assign(o,{label:when.label,format:'weekWhen',when});
   if(Object.hasOwn(words,c.name))return Object.assign(o,{format:'words',words:words[c.name]});
   if(c.name==='有効')Object.assign(o,{format:'enabledFlag',fold:true});   // 全行が有効なら「全行で同じ」の1行へ
   return o;
  };
  /* 一覧の列は**先頭から6本まで**。全部並べると1列あたりが潰れて読めない
     （残りは編集モーダルで見る。§CLAUDE 11「入れ物は中身の長さから決める」）。 */
  const shown=listCols.slice(0,6);
  const retired=t.kind==='retired';
  const where=t.where?`ふだんは**${t.where}**から書き換えています。`:'';
  return {group:retired?'retired':'internal',key:'mt:'+t.table,
          label:t.label||t.table,
          endpoint:'/api/master-table/'+encodeURIComponent(t.table),
          hasDelete:!retired,editorModal:!retired,readOnly:retired,
          rawTable:t.table,rawKind:t.kind,
          titleText:t.table+(t.note?' — '+t.note:''),
          /* **消すのは本当に行を消すこと**。汎用の言い回し（無効化）は
             有効フラグを持つマスタのためのもので、ここでは嘘になる。 */
          deleteWord:'削除',
          fields:retired?[]:fields,
          cols:shown.length?shown.map(colOf):[{k:'id',label:'行'}],
          /* 用途の1行（§9.599）: 何の表か＋ふだんどこで直すか。「行をそのまま直せます」はどの表にも言えて何も言っていなかった。 */
          lead:retired?undefined:([t.note,t.where?`ふだんは${t.where}で直します`:''].filter(Boolean).join('。')||'アプリの内部の表を行のまま足す・直す・消す画面です')+'。',
          usualWhere:!!t.where,
          /* **説明は`**強調**`で書く**（§9.222 ⑧）——`hintHtml()`は
             エスケープしてから印を`<b>`へ変えるので、生のHTMLを書くと
             タグがそのまま画面に出る。 */
          hint:(retired
            ? '**この表はアプリがもう読みません。**'+(t.where?t.where+'。':'')
              +'ここに残してあるのは、移行前の中身を見返せるようにするためです。'
              +'**書き換えても画面は変わりません**——だからこの表は読み取り専用にしてあります。'
            : (t.note?t.note+'。':'')+where
              +'列の意味はアプリの内部の決まりに沿っているので、'
              +'**値の形（書き方）を変えると、その設定は読めなくなることがあります**。'
              +'迷ったときは、ふだんの画面から設定し直してください。')};
 }
 /* 移行済みの表を丸ごと消す（§9.250 ③）。**取り消せないので、消す前に
    「何を・何件」を名乗る**（§9.193の下見と同じ作法）。消したあとは
    タブごと消えるので、**次にどこへ行くのかも先に決めておく**（§CLAUDE 2）。 */
 async function dropRetiredTable(def){
  const rows=(maintState.items||[]).length;
  const body=`<p class="confirm-modal-message"><b>${esc(def.rawTable)}</b> をマスタDBから
    <b>丸ごと消します</b>。取り消せません。</p>
   <ul class="cl-confirm"><li><b>${esc(def.rawTable)}</b><em>${rows}件</em></li></ul>
   <p class="confirm-modal-message">この表は<b>アプリがもう読みません</b>
    （中身は移行先へ移っています）。消しても画面の動きは変わりません。</p>`;
  const ok=await confirmModal({title:'移行済みの表を削除します',bodyHtml:body,
                              confirmLabel:'削除する',danger:true});
  if(!ok)return;
  try{
   setMaintLoading(true,'削除しています…');
   const r=await api('/api/master-table/'+encodeURIComponent(def.rawTable)+'/drop',
     {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({user_id:String($('#masterUserId')?.value||'').trim()})});
   /* **消えたタブに留まらない**——写しを捨てて一覧を取り直し、
      いま居るタブが無くなっていたら見えているものの先頭へ移す。 */
   mtState.loaded=false;
   await loadMasterTableCatalog(true);
   if(!allDefs().some(d=>d.key===maintState.defKey))maintState.defKey=firstVisibleDefKey();
   syncNav();await loadMaint(true);
   showToast&&showToast('削除しました',(r&&r.message)||def.rawTable,3600);
  }catch(e){showToast&&showToast('削除できませんでした',e.message,7000)}
  finally{setMaintLoading(false)}
 }
 async function loadMasterTableCatalog(force){
  if(!force&&mtState.loaded)return mtState.tables;
  if(mtState.loading)return mtState.loading;
  mtState.loading=(async()=>{
   try{
    const r=await api('/api/master-table/catalog');
    mtState.tables=(r&&r.tables)||[];mtState.err=(r&&r.error)||'';
   }catch(e){mtState.tables=[];mtState.err=e.message}
   mtState.loaded=true;mtState.loading=null;
   /* 「ここで編集」→「ふだんは別画面」の順（作業導線と視覚導線を揃える）。 */
   const rank={here:0,elsewhere:1,retired:2};
   WL.mm.setRawDefs(mtState.tables.filter(t=>t.kind!=='covered')
    .sort((a,b)=>(rank[a.kind]??9)-(rank[b.kind]??9)||String(a.table).localeCompare(b.table,'ja'))
    .map(mtDefOf));
   renderMaintNav();syncNav();
   return mtState.tables;
  })();
  return mtState.loading;
 }
 /* ---------- テーブル生データ(旧「マスタ一覧」、ARCHITECTURE.md「マスタ管理の画面形態」で統合) ----------
    master.sqlite3のテーブルをそのまま読み取り専用で表示する。上のタブが
    面倒を見ていないテーブル(表示マスタ・スケジュール列表示マスタ・
    パス設定マスタの実体など)も確認できる、最後の手段としての生データ閲覧。
    編集は各専用タブから行う前提のため、ここでは書込導線を一切出さない。 */
 let rawTableState={tables:[],table:'',columns:[],rows:[],loaded:false};

 /* ==================================================================
    接続状況（§9.272、利用者の指示「誰がアクセス中か見える化し、接続中の
    ユーザーを視覚化し、強制的に接続切断したりする機能」）
    ------------------------------------------------------------------
    **できること（区分）の判定はサーバーが答える**（`can`／行ごとの
    `canDisconnect`）。画面で書き写すと「ボタンは出るのに断られる」が作れる。
    **押せない理由はその場に書く**（§4）。
    ================================================================== */
 const presenceState={data:null,err:'',timer:0,busy:''};

 function pzAgo(sec){
  const n=Math.max(0,Math.round(Number(sec)||0));
  if(n<60)return `${n}秒前`;
  if(n<3600)return `${Math.floor(n/60)}分前`;
  return `${Math.floor(n/3600)}時間前`;
 }
 function pzModeLabel(m){
  return {edit:'編集可能',view:'閲覧',schedule:'スケジュール'}[String(m||'')]||'—';
 }
 /* 画面の呼び名。**知らない鍵はそのまま出す**（黙って空欄にすると、
    新しい画面が増えたときに「何もしていない」ように見える・§9.204）。 */
 const PZ_VIEWS={list:'一覧',records:'測定データ一覧',schedule:'作業スケジュール',
  master:'マスタ管理',report:'測定帳票',dashboard:'ダッシュボード',
  calendar:'測定実績カレンダー',actuals:'測定実績',logs:'ログ'};
 function pzViewLabel(v){const k=String(v||'');return k?(PZ_VIEWS[k]||k):'—'}
 function pzStopTimer(){if(presenceState.timer){clearInterval(presenceState.timer);presenceState.timer=0}}

 async function loadPresenceMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.innerHTML='';
  if(force||!presenceState.data)list.innerHTML='<div class="mm-empty">接続状況を調べています…</div>';
  await pzFetch();
  pzStopTimer();
  /* **10秒ごとに読み直す**。人が入れ替わる画面なので、押して更新させると
     古い一覧を見たまま切断することになる。**画面を離れたら止める**
     （器が消えたことで気づく——専用の後始末を各所へ足さない）。 */
  presenceState.timer=setInterval(()=>{
   const el=document.getElementById('pzList');
   if(!el||!document.body.contains(el)){pzStopTimer();return}
   pzFetch();
  },10000);
 }

 async function pzFetch(){
  try{presenceState.data=await api('/api/presence');presenceState.err=''}
  catch(e){presenceState.err=e.message||String(e)}
  renderPresence();
 }

 /* ---------- 接続の記録と版（§9.513、利用者の指示） ----------
    「接続ユーザー、接続PC、接続時刻、接続時間、接続したアプリのVER情報、ユーザー別
      累計接続回数などわかるように…誰に新しいバージョンファイルを配布すればよいか
      判断する…データの2次利用も考えたうえで」

    **答えはサーバー**（`fleet`＝`presence.fleet_summary()`）。運用中の最新版・
    古い版の端末・利用者ごとの合計を画面で数え直さない。画面は並べて、写せる形に
    するだけ（表をコピー＝表計算・メールへ貼れる／CSVで保存）。 */
 const pzView={by:'terminals',onlyOld:false};
 /* 所要時間の書き方は**`WL.duration`の1箇所**（§9.341・「表示」の「時間の書き方」に従う）。秒で届くので分へ直すだけ。 */
 function pzDur(sec){
  if(sec==null||sec==='')return '—';
  return WL.duration.text(Math.floor(Math.max(0,Number(sec)||0)/60));
 }
 /* 時刻は「月-日 時:分」（年と秒は`title`）。同じ幅で縦にそろう。 */
 function pzAt(iso){const t=String(iso||'');return t?t.replace('T',' ').slice(5,16):'—'}
 function pzVer(v,since){return v?`VER${v}`:`VER${since}より前`}
 /* 版の状態は**語で**言う（色だけにしない・§CLAUDE 3）。語は3つで、答えは`pzState()`の1箇所
    （表・記録・コピーが同じ語を使う）。**数えない区分**（開発者・§9.516）は要更新でも最新でもない
    ——判定の外なので「対象外」と言い、なぜかは`title`が言う。 */
 function pzState(x,f){
  if(x.counted===false){
   const roles=(f.excludedRoles||[]).join('・')||'開発者';
   return {word:'対象外',cls:'is-out',why:`${roles}の端末は、運用中の最新版の判定に数えません（まだ配っていない版を動かすため）`};
  }
  /* 窓（exe）だけ古い端末も要更新（§9.552）。版は同じなので、**なぜかを`title`が言う**。 */
  if(x.outdated&&x.shellOutdated&&!pzVerOld(x,f))
   return {word:'要更新',cls:'is-old',why:`アプリの窓（exe）が配ってある版と違います（この端末 ${x.shell} ／ 配ってある窓 ${f.placedShell}）。開き直すと新しい窓になります`};
  return x.outdated?{word:'要更新',cls:'is-old',why:''}:{word:'最新',cls:'is-ok',why:''};
 }
 /* 中身の版が運用中の最新版より古いか（窓だけ古い端末と言い分けるため）。比べ方はサーバーと同じ「数の並び」。 */
 function pzVerOld(x,f){
  const k=v=>String(v||'').match(/\d+/g)?.map(Number)||[];
  const a=k(x.version),b=k(f.latestVersion);
  for(let i=0;i<Math.max(a.length,b.length);i++){if((a[i]||0)!==(b[i]||0))return (a[i]||0)<(b[i]||0)}
  return false;
 }
 /* 窓（exe）の版の字（§9.552）。窓の外（開発・網）は空、名乗らない古い窓は「?」。 */
 function pzShell(x){return x.shell?`窓 ${x.shell}`:''}
 function pzStateHtml(x,f){
  const st=pzState(x,f);
  return `<b class="pz-vst ${st.cls}"${st.why?` title="${esc(st.why)}"`:''}>${st.word}</b>`;
 }
 function pzVerHtml(x,f){
  return `${pzStateHtml(x,f)}<span class="pz-ver" title="${esc(Object.keys(x.versions||{}).map(v=>'VER'+v).join(' → ')||'')}">${esc(pzVer(x.version,f.recordingSince))}</span>`
   +(x.shell?`<small class="pz-shell${x.shellOutdated?' is-old':''}" title="アプリの窓（exe）を作ったコミット">${esc(pzShell(x))}</small>`:'');
 }
 /* 表の中身（見えている並び・絞り込みそのまま）。コピーとCSVはこれを使う
    ——**見えている表と写した表を違えない**。 */
 function pzRows(f){
  const old=pzView.onlyOld;
  if(pzView.by==='users'){
   const head=['版の状態','ログインID','使った端末','使っている版','最後に使った','累計接続回数','累計接続時間'];
   const rows=(f.users||[]).filter(u=>!old||u.outdated).map(u=>({x:u,cells:[
    pzState(u,f).word,u.login||'（不明）',`${u.terminals}台（${u.pcs.join('・')}）`,
    u.versions.map(v=>pzVer(v,f.recordingSince)).join('・'),pzAt(u.lastAt),`${u.sessions}回`,pzDur(u.totalSec)]}));
   return {head,rows};
  }
  const head=['版の状態','ログインID','PC名','版','最後に使った','累計接続回数','累計接続時間','初めて使った'];
  const rows=(f.terminals||[]).filter(t=>!old||t.outdated).map(t=>({x:t,cells:[
   pzState(t,f).word,t.login||'（不明）',t.pc||'（不明）',[pzVer(t.version,f.recordingSince),pzShell(t)].filter(Boolean).join('・'),
   t.online?'接続中':pzAt(t.lastAt),t.sessions?`${t.sessions}回`:'—',t.sessions?pzDur(t.totalSec):'—',pzAt(t.firstAt)]}));
  return {head,rows};
 }
 function pzExport(kind){
  const f=(presenceState.data||{}).fleet;if(!f)return;
  const {head,rows}=pzRows(f);
  if(!rows.length){showToast('写すものがありません','「最新でない版だけ」で絞っていて、該当が0件です。');return}
  const lines=[head,...rows.map(r=>r.cells)];
  const stamp=new Date().toISOString().slice(0,10).replace(/-/g,'');
  const name=`接続の記録-${pzView.by==='users'?'利用者ごと':'端末ごと'}-${stamp}`;
  if(kind==='csv'){
   const q=v=>`"${String(v).replace(/"/g,'""')}"`;
   /* BOMつき（表計算ソフトで開いたとき字化けしない） */
   const blob=new Blob(['﻿'+lines.map(r=>r.map(q).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
   WL.base.saveBlob(blob,name+'.csv');
   return;
  }
  const text=lines.map(r=>r.join('\t')).join('\n');
  const done=()=>showToast('表をコピーしました',`${rows.length}行。表計算ソフトやメールへそのまま貼れます。`);
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(done).catch(e=>{
   WL.quiet.note('クリップボードへ写せない（CSVで保存を案内する）',e);
   showToast('コピーできませんでした','「CSVで保存」を使ってください。',5200)});
  else showToast('コピーできませんでした','「CSVで保存」を使ってください。',5200);
 }

 /* 接続状況（§9.272・§9.513 → §9.601）: 頭の下に「これまでに接続した端末の版」の帯（最新版／最新でない版／対象外を台数つきで）→
    左の段「いま接続中」（表・10秒ごとに読み直す）／「接続の履歴」（端末ごと／利用者ごと・新しい版を配る相手を決める）。
    **切断・記録を消すは行ごとのボタンにしない**——行を押した先のメニュー（危ない操作は主の動線に置かない・§CLAUDE 5）。
    押せない行は押す形にせず、理由を行の`title`が言う。表のコピー・CSVは頭の ⋯。 */
 function renderPresence(){
  const d=presenceState.data;
  setHeadActs({more:[{label:'表をコピー',note:'いま見えている履歴の表を、表計算ソフトやメールへ貼れる形で',data:{pzAct:'copy'},onClick:()=>pzExport('tsv')},
   {label:'CSVで保存',note:'いま見えている履歴の表をファイルへ',data:{pzAct:'csv'},onClick:()=>pzExport('csv')}]});
  if(!d){
   mountSetPage({key:'presence',secs:[{key:'live',name:'',body:`<div class="mm-empty error" id="pzList">接続状況を読めませんでした: ${esc(presenceState.err||'原因不明')}</div>`}]});
   return;
  }
  const f=d.fleet||{terminals:[],users:[],counts:{},latestVersion:'',myVersion:'',recordingSince:''},items=d.items||[];
  const cut=items.filter(x=>x.revoked).length,old=(f.counts||{}).outdated||0;
  const form=mountSetPage({key:'presence',figure:pzFigureHtml(d,f),secs:[
   {key:'live',name:'いま接続中',icon:'fa-plug',sub:'10秒ごとに読み直す',state:cut?`切断中 ${cut}`:'正常',tone:cut?'warn':'',
    body:`${pzRevokedHtml(d.revoked)}<div class="mm-list mm-set-list" id="pzList"></div>`},
   /* 札は字だけ（台数は帯の凡例とタブが言う・同じ数を2か所に出さない）。 */
   {key:'hist',name:'接続の履歴',icon:'fa-clock-rotate-left',sub:'配る相手を決める',state:old?'要更新':'正常',tone:old?'warn':'',
    stateTitle:old?'最新でない版の端末があります（帯の凡例が台数を言います）':'',body:'<div class="mm-list mm-set-list" id="pzTerms"></div>'}]});
  if(!form)return;
  pzFillLive(d,f);pzFillHist(d,f);
 }
 /* 頭の下の帯: これまでに接続した端末の版（数えない区分は「対象外」・§9.516）。右に運用中の最新版。この端末の区分は帯の下の1行。 */
 function pzFigureHtml(d,f){
  const ts=f.terminals||[],c=f.counts||{},me=d.me||{},can=d.can||{};
  /* 最新でない端末の数はサーバーの答え（`fleet_summary()`の`counts.outdated`・§9.513）。画面で数え直さない。 */
  const nOut=ts.filter(t=>t.counted===false).length,nOld=c.outdated||0,nOk=Math.max(0,ts.length-nOut-nOld);
  const excluded=(f.excludedRoles||[]).join('・');
  const same=f.myVersion&&f.myVersion===f.latestVersion;
  const note=!f.latestVersion&&excluded?`（${excluded}の端末を除くと記録なし）`
   :`${excluded?`${excluded}の端末を除く・`:''}${same?'この端末もこの版です':`この端末は VER${f.myVersion||'?'}`}`;
  const roleNote=can.canDisconnect?(can.canDisconnectDeveloper?'すべての端末を切断できます':'開発者以外の端末を切断できます'):'切断はできません（見るだけです）';
  /* この端末の区分・できること・見ている置き場は ⓘ（区分は「いま接続中」の表の「この端末」の行が字で言う・押せない行は理由を title で）。
     帯の下に1行で常に並べると読む量が増えるだけだった（入れた後の採点・§9.601）。
     ただし置き場が共有でなければ、**見えていないことを字で言う**——「1件だけ」を「他に誰も居ない」と読まれないため。 */
  const where=d.shared?`共有の置き場を見ています（${d.source==='master'?'マスタの隣':'作業予定の隣'}）`:'この端末しか出ません（マスタか作業予定を共有に置くと、他の PC も並びます）';
  const me1=`この端末は${me.role||''}（${roleNote}）・${where}${d.dir?`。置き場: ${d.dir}`:''}`;
  const right=`運用中の最新版 <b id="pzLatest">${esc(f.latestVersion?'VER'+f.latestVersion:'—')}</b> <small id="pzLatestNote">${esc(note)}</small>`
   +`<span class="pz-me-tip">${tipHtml(me1)}</span>`;
  return setBarHtml([{cls:'is-ok',name:'最新版',v:nOk,text:`${nOk}台`},
    {cls:'is-old',name:'最新でない版',v:nOld,text:`${nOld}台`+(c.outdatedOnline?`（うち接続中 ${c.outdatedOnline}台）`:''),id:'pzOldCount'},
    {cls:'is-rest',name:`対象外（${excluded||'開発者'}）`,v:nOut,text:`${nOut}台`}],right,'これまでに接続した端末の版')
   +(d.shared?'':`<p class="pz-me mm-set-warn" title="${esc(d.dir||'')}">${esc(where)}</p>`);
 }
 /* この端末が切断されているとき（状態の知らせ・説明の帯ではない）。 */
 function pzRevokedHtml(mine){
  return mine?`<div class="mm-warn-note" id="pzRevoked"><b>この端末は接続を解除されています。</b>
    ${esc(mine.by||'不明')}／${esc(mine.byPc||'不明')} により解除されました${mine.reason?`（理由: ${esc(mine.reason)}）`:''}。
    <b>書き込みだけが止まっています</b>——開いている画面と入力中の内容はそのままです。
    あと約${Math.max(1,Math.ceil((mine.remainingSec||0)/60))}分で自動的に戻ります。</div>`:'';
 }
 /* いま接続中の表。行を押すとその端末の操作（切断する／切断を取り消す）。押せない行は理由を`title`で言う。 */
 function pzFillLive(d,f){
  const can=d.can||{},items=d.items||[];
  const st=x=>x.isMe?'<span class="mm-set-tag is-teal pz-badge is-me">この端末</span>'
   :x.revoked?'<span class="mm-set-tag is-warn pz-badge is-cut">切断中</span>':'<span class="mm-set-tag pz-badge is-on">接続中</span>';
  const why=x=>x.isMe?'自分自身は切断できません':x.revoked?(can.canDisconnect?'':`あと約${Math.max(1,Math.ceil((x.revoked.remainingSec||0)/60))}分で戻ります`)
   :x.canDisconnect?'':(can.canDisconnect?`「${x.role}」は切断できません`:'切断の権限がありません');
  fillSetList($('#pzList'),{key:'presence:live',label:'いま接続中',tabs:[{key:'live',label:'いま接続している',n:`${items.length}台`}],
   note:presenceState.err?`読み直しに失敗しました: ${presenceState.err}`:'',
   /* 10列が 1536×864（フルHD・125%）の右の器（約1100px）に入る幅（§9.601 で測った・はみ出すと最後の応答が切れる）。 */
   cols:[{label:'状態',w:'88px'},{label:'ログインID',w:'minmax(70px,1fr)'},{label:'PC名',w:'minmax(70px,1fr)'},{label:'版',w:'minmax(140px,1.3fr)'},
    {label:'接続した時刻',w:'100px'},{label:'接続時間',w:'72px',num:true,tip:'この接続を始めてからの長さ'},{label:'権限区分',w:'88px'},
    {label:'モード',w:'80px'},{label:'開いている画面',w:'minmax(80px,1fr)'},{label:'最後の応答',w:'80px',num:true}],
   rows:items.map(x=>({cls:'pz-row'+(x.isMe?' is-me':'')+(x.outdated?' is-old':''),
    attrs:why(x)?` title="${esc(why(x))}"`:setRowAttrs(x.key,x.revoked?'押すと切断を取り消せます':'押すとこの端末を切断できます（確かめてから）'),
    cells:[st(x),`<span class="pz-c-login">${esc(x.login||'（不明）')}</span>`,`<span class="pz-c-pc">${esc(x.pc||'（不明）')}</span>`,
     `<span class="pz-c-ver">${pzVerHtml(x,f)}</span>`,`<span class="pz-c-since" title="${esc(x.since||'')}">${esc(pzAt(x.since))}</span>`,
     `<span class="pz-c-dur">${esc(pzDur(x.durationSec))}</span>`,esc(x.role||''),esc(pzModeLabel(x.mode)),esc(pzViewLabel(x.view)),
     `<span class="pz-c-seen">${esc(pzAgo(x.idleSec))}</span>`]})),
   empty:{title:d.readable?'接続している端末がありません':'在席の置き場を読めませんでした',
    text:d.readable?'この端末の在席は次のハートビートで出ます。':'共有フォルダへの接続を確認してください。'},
   onRow:(key,row)=>{
    const x=items.find(i=>i.key===key);if(!x)return;
    openActMenu(row,x.revoked?[{label:'切断を取り消す',data:{pzAct:'allow'},onClick:()=>pzAllow(key)}]
     :[{label:`${x.login||'（不明）'}／${x.pc||'（不明）'} を切断する…`,danger:true,title:'理由を書く窓が出ます',data:{pzAct:'cut'},onClick:()=>pzCut(key)}],'この端末の操作');
   }});
 }
 /* 接続の履歴（版の配布の判断に）。端末ごと／利用者ごとは札、「最新でない版だけ」は札の行の右。記録を消すは行を押した先。 */
 function pzFillHist(d,f){
  const can=d.can||{},byUsers=pzView.by==='users',{head,rows}=pzRows(f);
  const nT=(f.terminals||[]).filter(t=>!pzView.onlyOld||t.outdated).length,nU=(f.users||[]).filter(u=>!pzView.onlyOld||u.outdated).length;
  const el=$('#pzTerms');
  fillSetList(el,{key:'presence:hist',label:'接続の履歴',now:pzView.by,
   tabs:[{key:'terminals',label:'端末ごと',n:`${nT}台`},{key:'users',label:'利用者ごと',n:`${nU}人`}],
   onTab:k=>{pzView.by=k;pzFillHist(d,f)},
   extra:`<label class="mm-set-check"><input type="checkbox" id="pzOnlyOld"${pzView.onlyOld?' checked':''}>最新でない版だけ</label>`,
   cols:head.map((h,i)=>({label:h,w:i===0?'96px':'minmax(90px,1fr)',num:/累計/.test(h)})),
   rows:rows.map(({x,cells})=>{
    const forget=!byUsers&&can.canForget&&!x.online;
    return {cls:x.outdated?'is-old':'',attrs:forget?setRowAttrs(x.key,'押すとこの端末の記録を消せます（確かめてから）'):'',
     cells:cells.map((v,i)=>i===0?pzStateHtml(x,f):`<span${!byUsers&&i===4&&x.online?' class="is-online"':''} title="${esc(String(v))}">${esc(String(v))}</span>`)};
   }),
   empty:{title:pzView.onlyOld?'最新でない版の端末はありません':'まだ記録がありません',text:pzView.onlyOld?'':'この版から記録を始めます。'},
   onRow:(key,row)=>openActMenu(row,[{label:'この端末の記録を消す…',danger:true,note:'使わなくなった端末を「最新でない端末」の数から外します',
    data:{pzAct:'forget'},onClick:()=>pzForget(key)}],'この端末の記録')});
  const only=el.querySelector('#pzOnlyOld');
  if(only)only.addEventListener('change',()=>{pzView.onlyOld=only.checked;pzFillHist(d,f)});
 }

 async function pzForget(key){
  const t=((presenceState.data||{}).fleet?.terminals||[]).find(x=>x.key===key);if(!t)return;
  if(!await confirmModal({confirmLabel:'削除する',facts:[{text:'戻せません',danger:true}],message:`${t.login||'（不明）'}／${t.pc||'（不明）'} の接続の記録を消します。`
     +'使わなくなった端末を「最新でない端末」の数から外すためのものです。',danger:true}))return;
  try{await api('/api/presence/forget',{method:'POST',body:JSON.stringify({key})});
      showToast('記録を消しました',`${t.login||''}／${t.pc||''}`)}
  catch(e){showToast('記録を消せませんでした',e.message||String(e),6000)}
  pzFetch();
 }

 async function pzCut(key){
  const x=(presenceState.data?.items||[]).find(r=>r.key===key);if(!x)return;
  /* **危ない操作なので相手を名指しで1回だけ確認する**（§5・§9.211 ②）。 */
  const reason=await promptModal({title:'接続を解除します',danger:true,confirmLabel:'解除する',
   message:`${x.login||'（不明）'}／${x.pc||'（不明）'} の書き込みが止まります（開いている画面は残ります）。`,
   label:'理由（空のままでも解除できます）',hint:'書いた理由は相手の画面に出ます。'});
  if(reason===null)return;
  try{
   const r=await api('/api/presence/disconnect',{method:'POST',body:JSON.stringify({key,reason})});
   showToast('切断しました',`${x.login||''}／${x.pc||''} の書き込みを止めました（約${Math.round((r.cooldownSec||300)/60)}分）。`);
  }catch(e){showToast('切断できませんでした',e.message||String(e),6000)}
  pzFetch();
 }

 async function pzAllow(key){
  try{await api('/api/presence/allow',{method:'POST',body:JSON.stringify({key})});
      showToast('切断を取り消しました','その端末はすぐに書き込めるようになります。')}
  catch(e){showToast('取り消せませんでした',e.message||String(e),6000)}
  pzFetch();
 }

 async function loadRawTableMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.classList.remove('mm-form-compact');
  if(force||!rawTableState.loaded){
   form.innerHTML='<div class="mm-form-head"><span class="mm-mode-chip new">読み込み中</span></div>';
   list.innerHTML='<div class="mm-empty">テーブル一覧を取得しています…</div>';
   try{
    const r=await api('/api/tables?db=MASTER');
    rawTableState.tables=r.tables||[];rawTableState.loaded=true;
    if(!rawTableState.tables.includes(rawTableState.table))rawTableState.table=rawTableState.tables[0]||'';
   }catch(e){
    form.innerHTML='';
    list.innerHTML=`<div class="mm-empty error">テーブル一覧を取得できませんでした: ${esc(e.message)}</div>`;
    return;
   }
  }
  try{await loadMasterTableCatalog()}catch(e){WL.quiet.note('読めなくても一覧は出す',e)}
  renderRawTableForm();
  await loadRawTableRows();
 }
 /* §9.599: 表を選ぶ欄は**頭の右**（主の操作の場所）、「ふだんどこで直すか」は一覧の札の行の右。説明の帯（主役の前の3段の箱）は
    ⓘ と用途の1行（定義の`hint`／`lead`）へ畳んだ。表は汎用の一覧と同じ型（`.mm-raw-table`の線と高さ・札の行・探す欄）。 */
 function renderRawTableForm(){
  const form=$('#masterMaintForm');if(!form)return;
  form.innerHTML='';form.hidden=true;
  if(!rawTableState.tables.length){WL.mm.setHeadActs({links:'<span class="mm-mode-chip new">テーブルがありません</span>'});return}
  const opts=rawTableState.tables.map(t=>`<option value="${esc(t)}"${t===rawTableState.table?' selected':''}>${esc(t)}</option>`).join('');
  WL.mm.setHeadActs({links:`<label class="mm-raw-pick"><span>テーブル</span><select id="rawTableSelect">${opts}</select></label>`
   +'<button type="button" id="rawTableReload" class="mm-btn-ghost">再読込</button>'});
  const sel=$('#rawTableSelect');if(sel)sel.onchange=()=>{rawTableState.table=sel.value;renderRawTableForm();loadRawTableRows()};
  const rb=$('#rawTableReload');if(rb)rb.onclick=()=>loadRawTableRows();
 }
 /* その表をどこから直すか（**行き止まりにしない**・§9.249 ②）。判定はサーバーの答え（`/api/master-table/catalog`）で、
    画面には表と画面の対応を書き写さない（§9.163）。 */
 function rawTableGoto(){
  const info=(mtState.tables||[]).find(t=>t.table===rawTableState.table);
  if(!info)return {html:'',key:''};
  if(info.kind==='retired')return {html:`<span class="mm-raw-go is-retired">アプリはもう読みません${info.where?`（${esc(info.where)}）`:''}</span>`,key:''};
  const key=info.kind==='covered'?info.tab:'mt:'+info.table,label=(allDefs().find(d=>d.key===key)||{}).label||'';
  if(!label)return {html:'',key:''};
  return {key,html:`<span class="mm-raw-go">ふだんは<b>${esc(label)}</b>で直します<button type="button" id="rawTableGo" class="mm-btn-ghost sm">${esc(label)}を開く →</button></span>`};
 }
 async function loadRawTableRows(){
  const list=$('#masterMaintList');if(!list)return;
  if(!rawTableState.table){list.innerHTML='<div class="mm-empty">テーブルを選択してください。</div>';return}
  list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const q=new URLSearchParams({db:'MASTER',table:rawTableState.table,page:1,page_size:200});
   const d=await api('/api/table?'+q);
   rawTableState.columns=d.columns||[];rawTableState.rows=d.rows||[];rawTableState.count=d.count;
   renderRawTableList();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 /* 生の値の見せ方（§9.599）: 日時は「2026-10-12 21:03」（HTTP の日付の字のまま並べない）、有効は字、色コードは色見本。
    **値そのものは変えない**——title に生の字を残す（読むだけの画面なので、何が入っているかを確かめられることが先）。 */
 const RAW_HTTP_DATE=/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;
 function rawCellHtml(col,v){
  const t=String(v??'').trim();if(!t)return '<em class="mm-blank">—</em>';
  if(col==='有効'){const c={format:'enabledFlag'};return WL.mm.cellHtml(c,WL.mm.cellText(c,t))}
  if(RAW_HTTP_DATE.test(t)){const d=new Date(t);if(!isNaN(d)){const p2=x=>String(x).padStart(2,'0');
   return `<span class="mm-val-dt">${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}</span>`}}
  return WL.mm.cellHtml({},t);
 }
 function renderRawTableList(){
  const list=$('#masterMaintList');if(!list)return;
  const cols=rawTableState.columns,all=rawTableState.rows,count=rawTableState.count;
  if(!cols.length){list.innerHTML='<div class="mm-empty">列がありません。</div>';return}
  if(!WL.mm.barKept(list,'raw:'+rawTableState.table))rawTableState.query='';   // 表を替えた回は絞る前に言葉を外す（汎用の一覧と同じ）
  const q=String(rawTableState.query||'').normalize('NFKC').toLowerCase().trim();
  const rows=q?all.filter(r=>cols.some(c=>String(r[c]??'').normalize('NFKC').toLowerCase().includes(q))):all;
  const total=(count!=null&&count>all.length)?`先頭${all.length} / 全${count}件`:`${all.length}件`;
  const go=rawTableGoto();
  WL.mm.listBar(list,{key:'raw:'+rawTableState.table,label:rawTableState.table,findOn:all.length>0,extraHtml:go.html,
   tabsHtml:`<span class="mm-ltab is-on is-only">中身<i class="mm-ltab-b">${esc(q?`${rows.length} / ${total}`:total)}</i></span>`,
   query:rawTableState.query||'',onQuery:v=>{rawTableState.query=v;renderRawTableList()}});
  /* 数の列は右寄せ（8割以上が数）。 */
  const isNum=c=>{const tx=all.map(r=>String(r[c]??'').trim()).filter(Boolean);return c!=='有効'&&tx.length&&tx.filter(t=>/^-?[\d,]+(\.\d+)?$/.test(t)).length>=tx.length*0.8};
  const num=new Set(cols.filter(isNum));
  const head=cols.map(c=>`<th${num.has(c)?' class="is-num"':''}>${esc(c)}</th>`).join('');
  const body=rows.map(r=>`<tr>${cols.map(c=>`<td${num.has(c)?' class="is-num"':''} title="${esc(r[c]??'')}">${rawCellHtml(c,r[c])}</td>`).join('')}</tr>`).join('');
  list.insertAdjacentHTML('beforeend',`<div class="mm-raw-scroll"><table class="mm-raw-table"><thead><tr>${head}</tr></thead>`
   +`<tbody>${body||`<tr><td colspan="${cols.length}" class="mm-raw-none">${q?'当たる行はありません。':'データがありません。'}</td></tr>`}</tbody></table></div>`);
  const gb=$('#rawTableGo');
  if(gb)gb.onclick=()=>{maintState.defKey=go.key;maintState.editing=null;syncNav();loadMaint(true)};
  /* 右に隠れた列は「横にあと N列 →」と縁のぼかしで言う（切れて見えるのではなく、続きがあると読める）。 */
  const sc=list.querySelector('.mm-raw-scroll'),bar=list.querySelector('.mm-lbar-note');
  const paintMore=()=>{
   if(!sc||!bar)return;
   const r=sc.getBoundingClientRect().right,hid=[...sc.querySelectorAll('thead th')].filter(th=>th.getBoundingClientRect().right>r+1).length;
   const more=sc.scrollWidth>sc.clientWidth+2&&sc.scrollLeft+sc.clientWidth<sc.scrollWidth-2;
   sc.classList.toggle('is-more-r',more);
   bar.textContent=more&&hid?`横にあと${hid}列 →`:'';
  };
  if(sc){sc.onscroll=paintMore;paintMore()}
  if(q)WL.mm.markHits(list,rawTableState.query);
 }

 /* ============================================================
    設備停止マスタ — 分類 → 停止内容 → 内訳（§9.389 → §9.397で1枚へ統合）
    ------------------------------------------------------------
    利用者の指示（§9.397）:
    「設備停止分類と内訳と設備停止名の登録をシームレスにマスタ連携できて
      いないので、使いやすくなるように改めて『設備停止マスタ』として
      マスタ統合してほしいです」

    §9.389／§9.390 では**3つのタブ**（設備停止分類／設備停止／設備停止の内訳）
    に分かれていた。同じ1つの階層を3枚に割っていたので、
     ・分類を追加 → タブを移る → 停止内容を追加 → またタブを移る → 内訳を追加
       という**タブ往復が2回**要り、
     ・いま作っている分類がどの停止内容で使われているのか、
       その停止内容がどんな内訳を持つのかが**1画面のどこにも出ていなかった**。
    「シームレスに連携できていない」はこの構造そのものを指している。

    **1枚の3ペインにする。** 左＝分類／中＝その分類の停止内容／右＝その
    停止内容の内訳。視覚導線（左→右）が作業導線（大きい区分→小さい区分）と
    同じ向きに並ぶ（§CLAUDE 14）。どの段でもその場で足せるので、
    タブを移る手が1度も要らない。

    **触ったら保存**（§9.113）。内訳は「名前・分・既定」の3つしか無いので、
    行を編集モードへ切り替える手間のほうが大きい。欄を離れた（または Enter）
    時点で保存し、結果は内訳の段の足元（`#ssbState`）で言う（§9.212）。
    停止内容の5つの欄（対象設備・分類・名称・標準所要分・連携機能）は
    **「基本」の段でその場で直す**（§9.598 1g・`WL.mm.inlineFields`）。前は汎用の編集窓を中央に開いていた——
    欄の組み立て・値の集め方・保存は窓と同じ1本なので、作法は増えていない（§CLAUDE 8）。
    ============================================================ */
 /* `addUnder`＝下の欄で足す先（§9.390）。0＝停止内容の直下、>0＝その内訳の下。
    **どこへ足すのかは字で出す**——同じ「追加」ボタンが2つの意味を持つので、
    押す前に読めないと取り違える（§CLAUDE 2「推測させない」）。
    `cat`＝左で選んでいる分類（`null`＝すべて）。`ruleVocab`＝挿入の条件の語彙（列の群・入れ方・上限・§9.588）。 */
 /* `creating`＝新しい停止内容を「基本」で作っている間の最初の値（分類を連れて行く・§9.598 1g）。`basic`＝基本の段のその場の欄
    （`WL.mm.inlineFields`の答え・変更の有無と保存）。 */
 const ssbState={stops:[],subs:[],defaults:{},cats:[],picked:0,q:'',minutes:[],addUnder:0,ruleVocab:null,fold:new Set(),tab:'subs',
  creating:null,basic:null};
 /* 結果は字で返す（§9.212）: 内訳の段の足元（`#ssbState`）があればそこ、無ければ知らせ（基本・挿入の条件の段は自分の足元を持つ）。
    空にすると足元の状態の字（変更なし／変更 N件・記録者）へ戻る。 */
 function ssbSay(text,bad){
  const el=$('#ssbState');
  if(!el){if(text&&typeof showToast==='function')showToast(bad?'できませんでした':'設備停止',text,bad?6500:3600);return}
  if(!text){ssbPaintSubs();return}
  el.textContent=text;el.classList.toggle('is-bad',!!bad);
 }
 /* 分の棒の目盛り（§9.598 1g）: 木・基本・内訳の棒は**同じ目盛り**（いちばん長い分・60分より短くしない）——棒どうしを比べて読める。 */
 function ssbMinScale(){
  const ms=[...(ssbState.stops||[]),...(ssbState.subs||[])].map(x=>Number(x.standardMinutes)).filter(n=>Number.isFinite(n)&&n>0);
  return Math.max(60,...ms);
 }
 function ssbBarTitle(n,inherit){
  return `${WL.duration.text(n)}${inherit?'（空欄なので1つ上の時間）':''}（目盛りは最長の${WL.duration.text(ssbMinScale())}）`;
 }
 /* 分の棒（`inherit`＝空欄なので1つ上の時間を淡く）。時間が無ければ空の棒（字は隣の欄・札が言う）。 */
 function ssbBarHtml(min,inherit){
  const n=Number(min),ok=String(min??'').trim()!==''&&Number.isFinite(n)&&n>0;
  return `<span class="mm-val-bar${inherit?' is-inherit':''}${ok?'':' is-none'}" aria-hidden="true" title="${esc(ok?ssbBarTitle(n,inherit):'時間がまだありません')}">`
   +`<i style="width:${ok?Math.min(100,n/ssbMinScale()*100).toFixed(1):0}%"></i></span>`;
 }
 function ssbPaintBar(bar,min,inherit){
  if(!bar)return;
  const n=Number(min),ok=String(min??'').trim()!==''&&Number.isFinite(n)&&n>0;
  bar.classList.toggle('is-none',!ok);bar.classList.toggle('is-inherit',!!inherit);
  bar.title=ok?ssbBarTitle(n,inherit):'時間がまだありません';
  const i=bar.querySelector('i');if(i)i.style.width=ok?`${Math.min(100,n/ssbMinScale()*100).toFixed(1)}%`:'0%';
 }
 function ssbSubsOf(id){
  return (ssbState.subs||[]).filter(s=>Number(s.stopReasonId)===Number(id));
 }
 /* 最初から選ばれる内訳（§9.397）。**答えるのはサーバー**（§9.163）——
    「1つしかないから既定」も「印が付いているから既定」もここでは数えない。
    予定の登録画面（`schedule-view.js`）とこの画面が同じ答えを読むので、
    「既定」と出ている内訳と実際に選ばれる内訳が食い違わない。 */
 function ssbDefaultOf(reasonId,parentSubId){
  const v=(ssbState.defaults||{})[`${Number(reasonId)||0}:${Number(parentSubId)||0}`];
  return v===undefined||v===null?0:Number(v);
 }
 /* 分類ごとの停止内容。**分類なしは空文字の群**でまとめる（§CLAUDE 3）。 */
 function ssbStopsOfCat(){
  return ssbState.stops||[];
 }
 function ssbPickedId(){
  const ids=ssbStopsOfCat().filter(ssbStopMatches).map(s=>Number(s.id));
  if(ssbState.picked&&ids.includes(Number(ssbState.picked)))return Number(ssbState.picked);
  return ids[0]||0;
 }
 function ssbStop(id){
  return (ssbState.stops||[]).find(s=>Number(s.id)===Number(id))||null;
 }
 function ssbStopMatches(s){
  const q=String(ssbState.q||'').trim().normalize('NFKC').toLowerCase();
  if(!q)return true;
  return `${s.name||''} ${s.category||''} ${s.equipmentLabel||''} `
   .concat(ssbSubsOf(s.id).map(x=>x.name).join(' '))
   .normalize('NFKC').toLowerCase().includes(q);
 }
 async function loadStopSubMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.classList.remove('mm-form-compact');
  if(!list.querySelector('.ssb-edit'))list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   /* **3つを1度に取る**——別々に待つと、左が出てから右が出るまでのあいだ
      「内訳が0件」に見える（§9.331 と同じ「いつの分か」の取り違え）。 */
   const [rs,ss,cs]=await Promise.all([
    api('/api/schedule/stop-reason-master'),
    api('/api/schedule/stop-sub-master'),
    api('/api/schedule/stop-category-master'),
   ]);
   ssbState.stops=(rs.items||[]).map(x=>({...x}));
   ssbState.ruleVocab=rs.insertRuleVocab||null;
   /* 語彙（連携機能の札など）は汎用の一覧と同じ置き場へ控える（§9.163）——「基本」のその場の欄（`inlineFields`）が読む。 */
   maintState.meta=rs||{};
   ssbState.subs=(ss.items||[]).map(x=>({...x}));
   ssbState.defaults=ss.defaults||{};
   ssbState.cats=(cs.items||[]).map(x=>({...x}));
   renderStopSub();
  }catch(e){
   list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message||String(e))}</div>`;
  }
  if(force===true)ssbSay('');
 }
 function renderStopSub(){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  const picked=ssbState.creating?0:ssbPickedId();
  ssbState.picked=picked;
  list.classList.add('is-fill');
  list.parentElement&&list.parentElement.classList.add('is-fill');
  ssbPaintHead(form);
  /* 7案→組合せ7案から H1（§9.590）: 左＝分類 → 停止内容の木、右＝選んだ停止内容の段（基本・内訳・挿入の条件）。
     段の札がいまの値（30分・内訳2件・条件2）を言うので、開かずに3つの子の状態が読める。 */
  list.innerHTML=`<div class="ssb-edit is-tree">${ssbTreeHtml(picked)}${ssbDetailHtml(picked)}</div>`;
  bindStopSub();
  ssbMountTab();
 }
 /* 頭の行（§9.598 1b・1g）: 主の操作は「＋ 停止内容を追加」の1つ（詳細がいつも見えている画面なので縁取り）。読み方の説明は
    頭の ⓘ（定義の`hint`）——一覧の上の説明の帯はやめた。 */
 function ssbPaintHead(form){
  form.innerHTML='';form.hidden=true;form.onsubmit=ev=>ev.preventDefault();
  WL.mm.setHeadActs({primary:{id:'ssbAddStop',label:'停止内容を追加',
   title:'右の「基本」で新しい停止内容を作ります（いま選んでいる分類を連れて行きます）',
   onClick:()=>{const cur=ssbStop(ssbState.picked);ssbOpenNewStop(cur?String(cur.category||'').trim():'')}}});
 }
 /* 開いている段の中身を組む: 挿入の条件は`WL.stopRuleBoard`、基本はその場の欄（`WL.mm.inlineFields`）。 */
 function ssbMountTab(){
  ssbState.basic=null;
  if(ssbState.tab==='rules'&&!ssbState.creating){ssbMountRules();return}
  const host=$('#ssbBasicForm');if(!host||!WL.mm.inlineFields)return;
  ssbState.basic=WL.mm.inlineFields(host,{item:ssbState.creating?null:ssbStop(ssbState.picked),seed:ssbState.creating,onChange:ssbPaintBasic});
  ssbDecorateMinutes(host);
  ssbPaintBasic();
 }
 /* 標準所要分の欄の横に分の棒（木・内訳と同じ目盛り）。打つ・±を押すとその場で伸び縮みする（図と入力を結ぶ）。 */
 function ssbDecorateMinutes(host){
  const inp=host.querySelector('[data-field="standardMinutes"]'),wrap=inp&&inp.closest('.mm-num');if(!wrap)return;
  wrap.insertAdjacentHTML('beforeend','<span class="mm-val-bar is-live" aria-hidden="true"><i></i></span>');
  const paint=()=>ssbPaintBar(wrap.querySelector('.mm-val-bar'),numRaw(inp.value));
  inp.addEventListener('input',paint);inp.addEventListener('change',paint);
  wrap.addEventListener('click',()=>requestAnimationFrame(paint));
  paint();
 }
 /* 基本の段の足元（§9.598・右の詳細・勤務形態と同じ答え`WL.mm.paintFootState`）。 */
 function ssbPaintBasic(){
  const b=ssbState.basic;if(!b)return;
  WL.mm.paintFootState($('#ssbBasicState'),[$('#ssbBasicCancel'),$('#ssbBasicSave')],b.isNew,b.dirty());
 }
 /* 「変更あり」を名乗る（`registerSpecial(key,{dirty})`・§9.598）: 基本の欄と挿入の条件の盤。離れる道（木の別の行・段・左の一覧・
    「戻る」・アプリの×）は右の詳細と同じ`WL.mm.afterLeave()`を通る（黙って捨てない）。 */
 function ssbDirty(){
  if(!$('#masterMaintList .ssb-edit'))return false;
  return !!(ssbState.basic&&ssbState.basic.dirty())
   ||!!(ssbState.tab==='subs'&&ssbSubEdits().length)
   ||!!(ssbState.tab==='rules'&&WL.stopRuleBoard&&WL.stopRuleBoard.dirty());
 }
 /* 内訳の段で打ったまま保存していない行（欄の値が描いたときの値と違う行）。打った値は足元の「保存」で書く（§9.598 1j・基本の段・
    右の詳細と同じ。前は欄を離れると保存していて、同じ画面の中で保存のしかたが2つあった）。 */
 function ssbSubEdits(){
  return [...document.querySelectorAll('#masterMaintList .ssb-row[data-ssb-id]')]
   .filter(r=>[...r.querySelectorAll('.ssb-f')].some(i=>i.value!==i.defaultValue));
 }
 function ssbPaintSubs(){
  const el=$('#ssbState');if(!el)return;
  const n=ssbSubEdits().length;
  el.classList.remove('is-bad');
  WL.mm.paintFootState(el,[$('#ssbSubCancel'),$('#ssbSubSave')],false,n>0,n);
 }
 /* 捨てて移ると決めたあと（盤の「保存していない」の印を降ろす）。 */
 function ssbForget(){if(WL.stopRuleBoard)WL.stopRuleBoard.forget()}
 /* 選んでいる停止内容の挿入の条件（`WL.stopRuleBoard`）。保存したら一覧ごと読み直す（「条件 N行」の札も変わる）。 */
 function ssbMountRules(){
  const host=$('#ssbRules');if(!host||!WL.stopRuleBoard)return;
  WL.stopRuleBoard.mount(host,ssbStop(ssbState.picked),ssbState.ruleVocab,()=>loadStopSubMaint(true));
 }
 /* 左＝分類 → 停止内容の木（3階層の1段目と2段目・§9.590）。**件数はその分類の停止内容の数**で、内訳までは数えない
    （同じ言葉が2箇所で違う数を言わない・§CLAUDE 8）。分類の行は押すと畳む・開く。 */
 function ssbCatNames(){
  const all=ssbState.stops||[];
  const names=[];
  (ssbState.cats||[]).forEach(c=>{const n=String(c.name||'').trim();if(n&&!names.includes(n))names.push(n)});
  /* **どこにも属さない分類を消さない**——マスタに無いのに使われている分類も出す（§9.390 3）。 */
  all.forEach(s=>{const n=String(s.category||'').trim();if(n&&!names.includes(n))names.push(n)});
  return names;
 }
 function ssbStopRowHtml(s,picked){
  /* 数えるのは**1段目だけ**（§9.390）。その下の件数は`title`で言う。 */
  const subs=ssbSubsOf(s.id);
  const n=subs.filter(x=>!Number(x.parentSubId||0)).length;
  const deep=subs.length-n;
  const m=s.standardMinutes;
  const blank=(m===null||m===undefined||m==='');
  const rule=WL.stopRuleBoard&&WL.stopRuleBoard.chipText(s);
  return `<button type="button" class="ssb-stop${Number(s.id)===Number(picked)?' is-on':''}" data-ssb-pick="${s.id}"
     title="${esc(s.name||'')}／${esc(s.equipmentLabel||'')}／内訳${n}件${deep?`（その下にさらに${deep}件）`:''}">
    <b>${esc(s.name||'')}</b><span class="ssb-stop-min">${blank?'—':esc(WL.duration.text(Number(m)))}</span>
    <span class="ssb-stop-sub"><span class="ssb-stop-n${n?'':' is-blank'}">${n?`内訳${n}件`:'内訳なし'}</span>${
     rule?`<span class="ssb-stop-rule">${esc(rule)}</span>`:''}<span class="ssb-stop-eq">${esc(s.equipmentLabel||'')}</span></span>${
     ssbBarHtml(blank?'':m)}</button>`;
 }
 function ssbTreeHtml(picked){
  const all=(ssbState.stops||[]).filter(ssbStopMatches);
  const reg=new Set((ssbState.cats||[]).map(c=>String(c.name||'').trim()));
  const group=(key,label,rows,canDel)=>{
   const open=!ssbState.fold.has(key)||!!ssbState.q;
   return `<div class="ssb-group" data-ssb-group="${esc(key)}">
     <div class="ssb-cat-head"><button type="button" class="ssb-cat-row${open?' is-open':''}" data-ssb-cat="${esc(key)}" aria-expanded="${open}"
       title="${esc(label)}｜停止内容 ${rows.length}件（押すと${open?'畳みます':'開きます'}）"><i class="ssb-caret" aria-hidden="true">${open?'▾':'▸'}</i><b>${esc(label)}</b><span class="ssb-cat-n">${rows.length}</span></button>
      ${/* 消すは ⋯ の中（危ない操作を主の動線に置かない・§CLAUDE 5）。⋯ は乗せる・焦点で濃くなる（場所は動かさない）。
         ＋ は右端にそろえる（⋯ の無い分類は同じ幅の空き）。 */
       canDel?`<button type="button" class="ssb-ic ssb-cat-more" data-ssb-cat-more="${esc(key)}" aria-haspopup="menu" aria-expanded="false"
        aria-label="分類「${esc(label)}」の操作" title="分類「${esc(label)}」の操作（消すなど）"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button>`
       :'<span class="ssb-ic is-void" aria-hidden="true"></span>'}
      <button type="button" class="ssb-ic" data-ssb-add-in="${esc(key)}" title="「${esc(label)}」に停止内容を追加します">＋</button></div>
     ${/* 空の分類は件数（0）が言う——「まだありません」の字を分類ごとに並べない。 */
       open?(rows.map(s=>ssbStopRowHtml(s,picked)).join('')
       ||(ssbState.q?'<p class="mm-empty ssb-empty">絞り込みに当たる停止内容がありません。</p>':'')):''}
    </div>`;
  };
  const names=ssbCatNames();
  const blank=all.filter(s=>!String(s.category||'').trim());
  const groups=names.map(n=>group(n,n,all.filter(s=>String(s.category||'').trim()===n),reg.has(n))).join('')
   +(blank.length?group('','分類なし',blank,false):'');
  return `<div class="ssb-cats ssb-tree" aria-label="分類と停止内容">
    <div class="ssb-pane-head"><b>設備停止</b><span class="ssb-count">${(ssbState.stops||[]).length}件</span>
     <input type="search" id="ssbSearch" value="${esc(ssbState.q||'')}" placeholder="名称・設備・内訳で絞る" autocomplete="off"></div>
    <div class="ssb-stop-list ssb-stops">${groups||'<p class="mm-empty">設備停止マスタがまだ空です。右上の「＋ 停止内容を追加」から作れます。</p>'}</div>
    <div class="ssb-add ssb-add-cat">
     <span class="ssb-add-row"><input type="text" id="ssbNewCat" placeholder="新しい分類（例: 保全）" autocomplete="off" maxlength="40" aria-label="新しい分類の名前">
      <button type="button" id="ssbAddCat" class="mm-btn-ghost sm" title="分類は全設備で共通です。停止内容の「分類」欄の選択肢になります">＋ 分類を追加</button></span>
    </div>
   </div>`;
 }
 /* 右＝選んだ停止内容の段（§9.590）。頭が名前と出どころ、段の札がいまの値を言う。 */
 const SSB_TABS=[['basic','基本'],['subs','内訳'],['rules','挿入の条件']];
 function ssbTabNow(stop,key){
  if(key==='basic'){const m=stop.standardMinutes;return [(m===null||m===undefined||m==='')?'標準所要分なし':WL.duration.text(Number(m)),stop.linkKey?stop.linkLabel:''].filter(Boolean).join('・')}
  if(key==='subs'){const n=ssbSubsOf(stop.id).filter(x=>!Number(x.parentSubId||0)).length;return n?`${n}件`:'なし'}
  return (WL.stopRuleBoard&&WL.stopRuleBoard.chipText(stop))||'なし';
 }
 function ssbDetailHtml(id){
  const creating=!!ssbState.creating,stop=creating?null:ssbStop(id);
  if(!stop&&!creating)return '<div class="ssb-detail"><p class="mm-empty">左の一覧で<b>停止内容</b>を選ぶと、その基本・内訳・挿入の条件がここに出ます。</p></div>';
  const tab=creating?'basic':(SSB_TABS.some(t=>t[0]===ssbState.tab)?ssbState.tab:'subs');
  const body=tab==='basic'?'<div class="ssb-basic" id="ssbBasicForm"></div>':tab==='subs'?ssbSubPaneHtml(id)
   :'<section class="ssb-rules" id="ssbRules" aria-label="挿入の条件"></section>';
  /* 頭は「種類の小さな字＋名前／⋯」（勤務形態・右の詳細と同じ部品`.mm-dhead`）。分類・設備は名前の横——基本の段では欄が
     同じ値を持つので出さない。分は基本の札の1か所（同じ情報を2か所に出さない）。 */
  const meta=stop&&tab!=='basic'?[stop.category||'分類なし',stop.equipmentLabel||''].filter(Boolean).join('・'):'';
  return `<div class="ssb-detail">
    <div class="mm-dhead"><div><small>停止内容</small><div class="mm-dhead-line"><h3 class="ssb-title">${esc(stop?stop.name||'':'新しい停止内容')}</h3>${
     meta?`<span class="mm-dhead-meta">${esc(meta)}</span>`:''}</div></div>${
     stop?`<button type="button" class="mm-btn-ghost mm-hd-more" id="ssbStopMore" aria-haspopup="menu" aria-expanded="false"
       aria-label="この停止内容の操作" title="この停止内容の操作（消すなど）"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button>`:''}</div>
    ${/* 段の札は一覧の札と同じ部品（`.mm-ltab`・値は小札`.mm-ltab-b`・§9.598 の仕上げ）——同じ役目の物を2つの形にしない。 */''}
    <div class="mm-ltabs ssb-tabs" role="tablist" aria-label="停止内容の段">${SSB_TABS.map(([k,l])=>{
     /* 開いている段の札は値を言わない（下の中身が同じ値を持つ）。新しい停止内容は、保存するまで基本しか決められない。 */
     const off=creating&&k!=='basic';
     return `<button type="button" role="tab" class="mm-ltab ssb-tab${k===tab?' is-on':''}" data-ssb-tab="${k}" aria-selected="${k===tab}"${
      off?' disabled title="保存すると決められます"':''}>${l}${k===tab||creating?'':`<i class="mm-ltab-b ssb-tab-now">${esc(ssbTabNow(stop,k))}</i>`}</button>`}).join('')}</div>
    <div class="ssb-tab-body" data-ssb-body="${tab}">${body}</div>
    ${ssbFootHtml(tab,creating)}
   </div>`;
 }
 /* 足元は1つの部品`.mm-dfoot`（§9.598・勤務形態・右の詳細と同じ）。基本＝状態と記録者＋キャンセル＋保存（変更が無いうちは押せない）。
    内訳も同じ並び（打った値は保存で書く・§9.598 1j）。追加・既定・消すはボタンの1押しで書く。挿入の条件は盤が自分の足元を持つ。 */
 function ssbFootHtml(tab,creating){
  if(tab==='basic')return `<div class="mm-dfoot"><span class="mm-form-hint" id="ssbBasicState"></span>
    <button type="button" id="ssbBasicCancel" class="mm-btn-ghost">キャンセル</button>
    <button type="button" id="ssbBasicSave" class="mm-btn-primary">${creating?'追加':'保存'}</button></div>`;
  if(tab!=='subs')return '';
  return `<div class="mm-dfoot"><span class="mm-form-hint" id="ssbState" aria-live="polite"></span>
    <button type="button" id="ssbSubCancel" class="mm-btn-ghost">キャンセル</button>
    <button type="button" id="ssbSubSave" class="mm-btn-primary">保存</button></div>`;
 }
 /* 右＝その停止の内訳。**親の標準所要分をここに出す**（§CLAUDE 6「出どころを
    画面に出す」）——内訳の分を空欄にしたとき何分になるのかが、見なくても
    分かる形にしておく。 */
 function ssbSubPaneHtml(id){
  const stop=ssbStop(id);
  if(!stop)return `<div class="ssb-subs"><p class="mm-empty">左の一覧で<b>停止内容</b>を選ぶと、その内訳がここに出ます。</p></div>`;
  const rows=ssbSubsOf(id);
  const base=stop.standardMinutes;
  const blank=(base===null||base===undefined||base==='');
  const baseText=blank?'未設定':WL.duration.text(Number(base));
  /* 欄の中は**数だけ**（器が狭いので「1時間30分」は入らない）。読み下した形は欄の title と分の棒が言う。 */
  const baseNum=blank?'':String(base);
  /* 足す先（§9.390）。選んだ停止内容が変わったら直下へ戻す——別の停止内容の
     内訳の下へ足そうとしていた状態を持ち越さない。 */
  const under=ssbState.addUnder?rows.find(r=>Number(r.id)===Number(ssbState.addUnder)):null;
  if(!under)ssbState.addUnder=0;
  const um=under&&under.standardMinutes;
  const underSet=!!under&&!(um===null||um===undefined||um==='');
  /* 足す行の分を空欄にしたときの時間（足す先の内訳 → 停止内容の順・§9.390）。前は表の下に1行の文で言っていた——
     いまは欄の薄い字（数）と title（出どころ）と淡い棒が言う（標準所要分は基本の札の1か所）。 */
  const addNum=underSet?String(um):baseNum,addText=underSet?WL.duration.text(Number(um)):baseText;
  const addFrom=under?`「${under.name}」`:'この停止内容';
  return `<div class="ssb-subs">
    <div class="ssb-table" role="table" aria-label="内訳">
     <div class="ssb-row is-head" role="row"><span>内訳名</span><span>標準所要分</span><span>既定</span><span></span><span></span></div>
     <div class="ssb-table-scroll">${rows.map(r=>{
       /* **空欄にしたとき何分になるか**は行ごとに違う（§9.390 の4段）。
          2段目は「1つ上の内訳 → 停止内容」の順で、1段目は停止内容。
          **全部に停止内容の分を出さないこと**——「増し締め」の空欄は
          ゴムリングの30分になるのに60分と書いてあった（実測）。 */
       const up=Number(r.parentSubId||0)?rows.find(x=>Number(x.id)===Number(r.parentSubId)):null;
       const um2=up&&up.standardMinutes;
       const blankUp=(um2===null||um2===undefined||um2==='');
       const bText=blankUp?baseText:WL.duration.text(Number(um2));
       const bNum=blankUp?baseNum:String(um2);
       return ssbRowHtml(r,bText,bNum);
      }).join('')
       ||'<p class="mm-empty ssb-none">内訳はまだありません。</p>'}</div>
     ${ssbAddWhereHtml(stop,under)}
     <div class="ssb-row is-add" role="row">
      <input type="text" id="ssbNewName" class="ssb-f" placeholder="${esc(under?'内訳名（例: 交換）':'内訳名（例: ゴムリング）')}" autocomplete="off" maxlength="60" aria-label="新しい内訳の名前">
      <span class="ssb-mcell"><input type="text" id="ssbNewMin" class="ssb-f" placeholder="${esc(addNum)}" autocomplete="off" inputmode="decimal"
        aria-label="新しい内訳の標準所要分（分）" title="この内訳だけ時間が違うときに入れます。空欄なら${esc(addFrom)}の標準所要分（${esc(addText)}）です。">${
        ssbBarHtml(addNum,true)}</span>
      <button type="button" id="ssbAdd" class="mm-btn-ghost sm">${esc(under?'＋ この下へ追加':'＋ 内訳を追加')}</button>
     </div>
    </div>
   </div>`;
 }
 /* 1行＝1内訳。**2段目は字下げして「└」を付ける**（§9.390）——同じ幅の行が
    並ぶだけだと、どれがどれの下なのかが読み取れない（§CLAUDE 14）。
    1段目には「＋ 下へ」を置く。**押すと下の欄の足す先が変わるだけ**で、
    その場に欄は生えない（欄が2箇所に増えると、どちらで打つのか迷う）。
    「既定」は**兄弟のうち1つだけ**（§9.397）。1件しか無い群では、印を
    付けなくても既定に当たるので**押せなくして理由を書く**（§CLAUDE 4）。 */
 function ssbRowHtml(r,baseText,baseNum){
  const m=(r.standardMinutes===null||r.standardMinutes===undefined||r.standardMinutes==='')
    ?'':String(r.standardMinutes);
  const deep=Number(r.parentSubId||0)>0;
  const on=!deep&&Number(ssbState.addUnder)===Number(r.id);
  const parent=Number(r.parentSubId||0);
  const sibs=ssbSubsOf(r.stopReasonId).filter(x=>Number(x.parentSubId||0)===parent);
  const only=sibs.length<=1;
  const isDef=Number(ssbDefaultOf(r.stopReasonId,parent))===Number(r.id);
  return `<div class="ssb-row${deep?' is-deep':''}" role="row" data-ssb-id="${r.id}" data-ssb-depth="${deep?2:1}">
    <span class="ssb-name">${deep?'<i class="ssb-tee" aria-hidden="true">└</i>':''}
     <input type="text" class="ssb-f" data-ssb-k="name" value="${esc(r.name||'')}" maxlength="60" autocomplete="off"></span>
    <span class="ssb-mcell"><input type="text" class="ssb-f" data-ssb-k="min" value="${esc(m)}" placeholder="${esc(baseNum)}"
      title="空欄なら1つ上の標準所要分（${esc(baseText)}）です。" autocomplete="off" inputmode="decimal">${ssbBarHtml(m||baseNum,!m)}</span>
    <button type="button" class="ssb-def${isDef?' is-on':''}" data-ssb-def="${r.id}"${only?' disabled':''}
      title="${only?'この段の内訳は1つだけなので、印を付けなくても最初から選ばれます'
        :(isDef?'予定へ入れるとき、最初からこれが選ばれます（押すと外します）'
              :'予定へ入れるとき、最初からこれが選ばれるようにします')}">${
      isDef?'既定':(only?'—':'既定にする')}</button>
    ${deep?'<span></span>'
     :`<button type="button" class="ssb-under${on?' is-on':''}" data-ssb-under="${r.id}"
        title="「${esc(r.name||'')}」の下へ内訳をもう1段足します">${on?'足す先 ✓':'＋ 下へ'}</button>`}
    <button type="button" class="mm-btn-ghost mm-hd-more ssb-row-more" data-ssb-del="${r.id}" aria-haspopup="menu" aria-expanded="false"
      aria-label="この内訳の操作" title="この内訳の操作（消すなど）"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button>
   </div>`;
 }
 /* 足す先を**字で言う**（§CLAUDE 2）。直下のときは何も言わない——それが既定。 */
 function ssbAddWhereHtml(stop,under){
  if(!under)return '';
  return `<span class="ssb-add-where">「<b>${esc(under.name||'')}</b>」の下へ`
   +`<button type="button" id="ssbUnderClear" title="「${esc(stop.name||'')}」の直下へ戻します">直下へ戻す</button></span>`;
 }
 /* 入力した分の読み方。**空欄は「親に任せる」**で、0ではない（§9.231）。
    読めない字は`undefined`を返し、呼ぶ側が断る。 */
 function ssbMinutes(raw){
  const v=String(raw==null?'':raw).trim();
  if(!v)return null;
  const n=Number(v);
  return (Number.isFinite(n)&&n>0)?n:undefined;
 }
 async function ssbSave(body,okText){
  const uid=requireMaintUser();if(uid===null)return false;
  try{
   await api('/api/schedule/stop-sub-master'+(body.id?'/update':''),
     {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({parentSubId:0,...body,user_id:uid})});
   await loadStopSubMaint(true);
   ssbSay(okText||'保存しました');
   return true;
  }catch(e){
   ssbSay(`保存できませんでした: ${e.message||String(e)}`,true);
   return false;
  }
 }
 function bindStopSub(){
  const list=$('#masterMaintList');if(!list)return;
  ssbWireSearch(list);
  ssbWireCats(list);
  ssbWireStops(list);
  ssbWireSubRows(list);
  ssbWireSubActions(list);
 }
 /* 設備停止マスタの3ペインの配線（§9.522 で`bindStopSub()`から切り出した）: 停止内容の絞り込み。 */
 function ssbWireSearch(list){
  const search=$('#ssbSearch');
  if(search){
   search.oninput=()=>{ssbState.q=search.value;
    const pane=list.querySelector('.ssb-tree');
    if(!pane)return;
    pane.outerHTML=ssbTreeHtml(ssbPickedId());
    bindStopSub();
    const s2=$('#ssbSearch');
    if(s2){try{s2.focus({preventScroll:true})}catch(err){WL.quiet.note('絞り込み欄へ戻せない（打ち直せる）',err);s2.focus()}
     s2.setSelectionRange(s2.value.length,s2.value.length)}
   };
  }
 }
 /* 左＝分類（畳む・開く・消す・足す・その分類に停止内容を追加）。 */
 function ssbWireCats(list){
  /* 分類の行は**畳む／開く**（§9.590）。選んでいる停止内容と右の段はそのまま。 */
  list.querySelectorAll('[data-ssb-cat]').forEach(btn=>{
   btn.onclick=()=>{
    const k=btn.dataset.ssbCat;
    if(ssbState.fold.has(k))ssbState.fold.delete(k);else ssbState.fold.add(k);
    const pane=list.querySelector('.ssb-tree');
    if(pane){const top=(pane.querySelector('.ssb-stop-list')||{}).scrollTop||0;pane.outerHTML=ssbTreeHtml(ssbPickedId());bindStopSub();
     const l2=list.querySelector('.ssb-tree .ssb-stop-list');if(l2)l2.scrollTop=top}
   };
  });
  list.querySelectorAll('[data-ssb-add-in]').forEach(btn=>{
   btn.onclick=()=>ssbOpenNewStop(btn.dataset.ssbAddIn);
  });
  /* 分類の ⋯（§9.598 1g）: 消すはメニューの赤の字（行の×はやめた・確かめる窓は今までどおり）。 */
  list.querySelectorAll('[data-ssb-cat-more]').forEach(el=>{
   el.onclick=ev=>{
    ev.stopPropagation();
    const name=el.dataset.ssbCatMore;
    const used=(ssbState.stops||[]).filter(s=>String(s.category||'').trim()===name).length;
    WL.mm.openActMenu(el,[{label:`分類「${name}」をマスタから消す…`,danger:true,data:{ssbCatAct:'delete'},
     note:used?`この分類の停止内容 ${used}件は残ります（分類の選択肢から消えます）`:'停止内容そのものは消えません',
     onClick:()=>ssbDeleteCat(name,used)}],`分類「${name}」の操作`);
   };
  });
  const addCat=$('#ssbAddCat');
  if(addCat){
   addCat.onclick=async()=>{
    const el=$('#ssbNewCat');
    const name=String(el&&el.value||'').trim();
    if(!name){ssbSay('分類名を入れてください。',true);el&&el.focus();return}
    const uid=requireMaintUser();if(uid===null)return;
    try{
     await api('/api/schedule/stop-category-master',
       {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name,user_id:uid})});
     ssbState.fold.delete(name);
     await loadStopSubMaint(true);
     ssbSay(`分類「${name}」を追加しました（右の「＋」でこの分類に停止内容を追加できます）`);
     const again=$('#ssbNewCat');
     if(again){again.value='';try{again.focus({preventScroll:true})}catch(err){WL.quiet.note('入力欄へ戻せない（押し直せる）',err)}}
    }catch(e){ssbSay(`足せませんでした: ${e.message||String(e)}`,true)}
   };
  }
  const nc=$('#ssbNewCat');
  if(nc)nc.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();addCat&&addCat.click()}};
 }
 async function ssbDeleteCat(name,used){
  const row=(ssbState.cats||[]).find(c=>String(c.name||'').trim()===name);
  if(!row){ssbSay(`「${name}」は分類マスタに登録されていません（停止内容の側で使われているだけです）。`,true);return}
  if(!(await confirmModal({message:`分類「${name}」をマスタから消しますか？\n`
    +(used?`この分類を使っている停止内容が ${used}件 あります。停止内容そのものは消えませんが、分類の選択肢からは消えます。\n`:'')
    +'これまでに入れた予定の記録は、その予定の中に残ります。',confirmLabel:'削除する',danger:true})))return;
  const uid=requireMaintUser();if(uid===null)return;
  try{
   await api('/api/schedule/stop-category-master/delete',
     {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:row.id,user_id:uid})});
   ssbState.fold.delete(name);
   await loadStopSubMaint(true);
   ssbSay(`分類「${name}」を消しました`);
  }catch(e){ssbSay(`消せませんでした: ${e.message||String(e)}`,true)}
 }
 /* 新しい停止内容は右の「基本」の段で作る（§9.598 1g・汎用の表のマスタの「追加」と同じく右に開く・窓で覆わない）。
    **分類を連れて行く**（§CLAUDE 2「思い出させない」）。最初の焦点は名称（候補が開く設備の欄を選ばない・§9.221 ④）。 */
 function ssbOpenNewStop(cat){
  WL.mm.afterLeave(()=>{
   ssbForget();
   ssbState.creating=cat?{category:cat}:{};ssbState.tab='basic';ssbState.addUnder=0;
   renderStopSub();
   requestAnimationFrame(()=>{const f=document.querySelector('#ssbBasicForm [data-field="name"]');if(f)f.focus()});
  });
 }
 async function ssbDeleteStop(row){
  const subs=ssbSubsOf(row.id);
  if(!(await confirmModal({message:`停止内容「${row.name}」を消しますか？\n`
    +(subs.length?`その内訳 ${subs.length}件（${subs.map(x=>x.name).join('、')}）も一緒に消えます。\n`:'')
    +'これまでに入れた予定の記録は、その予定の中に残ります。',confirmLabel:'削除する',danger:true})))return;
  const uid=requireMaintUser();if(uid===null)return;
  try{
   await api('/api/schedule/stop-reason-master/delete',
     {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:row.id,user_id:uid})});
   ssbState.picked=0;
   await loadStopSubMaint(true);
   ssbSay(`「${row.name}」を消しました`);
  }catch(e){ssbSay(`消せませんでした: ${e.message||String(e)}`,true)}
 }
 /* 右の段だけ差し替える（左の木の`scrollTop`を保つ・§9.226 ①）。 */
 function ssbPaintDetail(list){
  const pane=list.querySelector('.ssb-detail');
  if(!pane){renderStopSub();return}
  pane.outerHTML=ssbDetailHtml(ssbState.picked);
  bindStopSub();
  ssbMountTab();
 }
 /* 木の停止内容（選ぶ）・右の段（切り替える・⋯ で消す・基本を保存する／元へ戻す）。移る前は`afterLeave()`で聞く。 */
 function ssbWireStops(list){
  list.querySelectorAll('[data-ssb-pick]').forEach(btn=>{
   btn.onclick=()=>{
    const id=Number(btn.dataset.ssbPick);
    if(Number(ssbState.picked)===id&&!ssbState.creating)return;
    WL.mm.afterLeave(()=>{
     ssbForget();
     ssbState.creating=null;ssbState.picked=id;ssbState.addUnder=0;
     list.querySelectorAll('[data-ssb-pick]').forEach(b=>
       b.classList.toggle('is-on',Number(b.dataset.ssbPick)===id));
     ssbPaintDetail(list);
    });
   };
  });
  list.querySelectorAll('[data-ssb-tab]').forEach(btn=>{
   btn.onclick=()=>{
    if(btn.disabled||ssbState.tab===btn.dataset.ssbTab)return;
    WL.mm.afterLeave(()=>{ssbForget();ssbState.tab=btn.dataset.ssbTab;ssbPaintDetail(list)});
   };
  });
  const more=$('#ssbStopMore');
  if(more)more.onclick=()=>{
   const row=ssbStop(ssbState.picked);if(!row)return;
   const n=ssbSubsOf(row.id).length;
   WL.mm.openActMenu(more,[{label:`停止内容「${row.name}」を消す…`,danger:true,data:{ssbStopAct:'delete'},
    note:n?`内訳 ${n}件・挿入の条件も一緒に消えます`:'挿入の条件も一緒に消えます',onClick:()=>ssbDeleteStop(row)}],'この停止内容の操作');
  };
  const save=$('#ssbBasicSave');
  if(save)save.onclick=async()=>{
   const b=ssbState.basic;if(!b||save.disabled)return;
   const r=await b.save();
   /* 保存した行を選び直す（新しい停止内容は、ここで初めて内訳・挿入の条件の段が開く）。 */
   if(r&&r.id){ssbState.creating=null;ssbState.picked=Number(r.id);renderStopSub()}
  };
  const cancel=$('#ssbBasicCancel');
  if(cancel)cancel.onclick=()=>ssbMountTab();   // 開いたときの値へ戻す（閉じない・右の詳細と同じ）
 }
 /* 右＝内訳の行（名前・分をその場で直す／既定の印）。 */
 function ssbWireSubRows(list){
  /* 打った値は足元の「保存」で書く（§9.598 1j）。Enter は保存を押すのと同じ。キャンセルは描いたときの値へ戻す。 */
  list.querySelectorAll('.ssb-row[data-ssb-id] .ssb-f').forEach(inp=>{
   inp.addEventListener('input',ssbPaintSubs);
   inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const b=$('#ssbSubSave');if(b&&!b.disabled)b.click()}};
  });
  const save=$('#ssbSubSave'),cancel=$('#ssbSubCancel');
  if(save)save.onclick=ssbSaveSubEdits;
  if(cancel)cancel.onclick=()=>{
   ssbSubEdits().forEach(r=>r.querySelectorAll('.ssb-f').forEach(i=>{i.value=i.defaultValue;i.dispatchEvent(new Event('input'))}));
   ssbPaintSubs();
  };
  ssbPaintSubs();
  /* 既定の印（§9.397）。**立てるのも降ろすのも同じボタン**——2つ置くと、
     どちらが今の状態なのかを押して確かめることになる。 */
  list.querySelectorAll('[data-ssb-def]').forEach(btn=>{
   btn.onclick=()=>WL.mm.afterLeave(async()=>{
    const id=Number(btn.dataset.ssbDef);
    const cur=(ssbState.subs||[]).find(s=>Number(s.id)===id);
    if(!cur)return;
    const parent=Number(cur.parentSubId||0);
    const nowDef=Number(ssbDefaultOf(cur.stopReasonId,parent))===id;
    await ssbSave({id,stopReasonId:cur.stopReasonId,name:cur.name,
                   standardMinutes:cur.standardMinutes,parentSubId:parent,
                   isDefault:!nowDef},
                  nowDef?`「${cur.name}」の既定を外しました`
                        :`「${cur.name}」を既定にしました（予定へ入れるとき最初から選ばれます）`);
   });
  });
 }
 /* 右＝内訳を足す（「＋ 下へ」とその解除）・消す。 */
 function ssbWireSubActions(list){
  /* 分の棒はその場で（打った値。空欄なら1つ上の時間を淡く）。描き直しで何度も配線するので`oninput`へ入れる。 */
  list.querySelectorAll('.ssb-mcell').forEach(cell=>{
   const inp=cell.querySelector('input'),bar=cell.querySelector('.mm-val-bar');if(!inp||!bar)return;
   inp.oninput=()=>{const own=String(inp.value).trim();ssbPaintBar(bar,own||inp.placeholder,!own)};
  });
  /* 追加・下へ・消す・既定はボタンの1押しで書く（描き直す）。打ったまま保存していない行があれば、先に聞く（黙って捨てない）。 */
  const add=$('#ssbAdd');
  if(add){
   add.onclick=()=>WL.mm.afterLeave(async()=>{
    const nameEl=$('#ssbNewName'),minEl=$('#ssbNewMin');
    const name=String(nameEl&&nameEl.value||'').trim();
    if(!name){ssbSay('内訳名を入れてください。',true);nameEl&&nameEl.focus();return}
    const min=ssbMinutes(minEl&&minEl.value);
    if(min===undefined){ssbSay('分は0より大きい数で入れてください。',true);minEl&&minEl.focus();return}
    const under=Number(ssbState.addUnder||0);
    if(await ssbSave({stopReasonId:ssbPickedId(),name,standardMinutes:min,parentSubId:under},
                     `「${name}」を追加しました`)){
     const again=$('#ssbNewName');
     if(again){again.value='';try{again.focus({preventScroll:true})}catch(err){WL.quiet.note('入力欄へ戻せない（押し直せる）',err)}}
     const m2=$('#ssbNewMin');if(m2)m2.value='';
    }
   });
  }
  list.querySelectorAll('[data-ssb-under]').forEach(btn=>{
   btn.onclick=()=>WL.mm.afterLeave(()=>{
    const id=Number(btn.dataset.ssbUnder);
    ssbState.addUnder=(Number(ssbState.addUnder)===id)?0:id;
    renderStopSub();
    const el=$('#ssbNewName');
    if(el){try{el.focus({preventScroll:true})}catch(err){WL.quiet.note('入力欄へ移せない（押して打てる）',err)}}
   });
  });
  const clr=$('#ssbUnderClear');
  if(clr)clr.onclick=()=>WL.mm.afterLeave(()=>{ssbState.addUnder=0;renderStopSub()});
  /* 消すのは行の ⋯ のメニュー（§9.598 1j・勤務形態の区分と同じ。行の × は主の動線に置いた危ない操作だった）。 */
  list.querySelectorAll('[data-ssb-del]').forEach(btn=>{
   btn.onclick=()=>{
    const id=Number(btn.dataset.ssbDel);
    const cur=(ssbState.subs||[]).find(s=>Number(s.id)===id);if(!cur)return;
    const deep=Number(cur.parentSubId||0)>0;
    WL.mm.openActMenu(btn,[{label:deep?'この内訳を消す…':'この内訳を消す（下の内訳も）…',danger:true,data:{ssbSubAct:'delete'},
     note:'確かめる窓が出ます',onClick:()=>WL.mm.afterLeave(()=>ssbDeleteSub(id))}],'この内訳の操作');
   };
  });
 }
 /* 内訳を1つ消す（下の内訳もまとめて）。 */
 async function ssbDeleteSub(id){
  const cur=(ssbState.subs||[]).find(s=>Number(s.id)===id);
  if(!cur)return;
  const kids=ssbSubsOf(ssbPickedId()).filter(x=>Number(x.parentSubId||0)===Number(id));
  if(!(await confirmModal({message:`「${cur.name}」を内訳から消しますか？\n`
    +(kids.length?`この下の内訳 ${kids.length}件（${kids.map(k=>k.name).join('、')}）も一緒に消えます。\n`:'')
    +'これまでに入れた予定の内訳の記録は、その予定の中に残ります。',confirmLabel:'削除する',danger:true})))return;
  const uid=requireMaintUser();if(uid===null)return;
  try{
   await api('/api/schedule/stop-sub-master/delete',
     {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id,user_id:uid})});
   await loadStopSubMaint(true);
   ssbSay(`「${cur.name}」を消しました`);
  }catch(e){ssbSay(`消せませんでした: ${e.message||String(e)}`,true)}
 }
 /* 内訳の段の「保存」: 打った行をまとめて書く（読めない字は行の欄へ戻して言う・1行も書かない）。**親と既定の印は送らない**
    （§9.212 ②・§9.397——名前や分を直しただけで段や既定が変わらない）。途中で断られたら読み直さない（打った値を捨てない）。 */
 async function ssbSaveSubEdits(){
  const rows=ssbSubEdits();if(!rows.length)return;
  const bodies=[];
  for(const r of rows){
   const id=Number(r.dataset.ssbId),cur=(ssbState.subs||[]).find(x=>Number(x.id)===id);if(!cur)continue;
   const nameEl=r.querySelector('[data-ssb-k="name"]'),minEl=r.querySelector('[data-ssb-k="min"]');
   const name=String(nameEl.value).trim(),min=ssbMinutes(minEl.value);
   if(!name){ssbSay('内訳名を空にはできません。',true);nameEl.focus();return}
   if(min===undefined){ssbSay('分は0より大きい数で入れてください。',true);minEl.focus();return}
   bodies.push({id,stopReasonId:cur.stopReasonId,name,standardMinutes:min,parentSubId:Number(cur.parentSubId||0)});
  }
  const uid=requireMaintUser();if(uid===null)return;
  try{
   for(const b of bodies)await api('/api/schedule/stop-sub-master/update',
     {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...b,user_id:uid})});
  }catch(e){ssbSay(`保存できませんでした: ${e.message||String(e)}`,true);return}
  await loadStopSubMaint(true);
  ssbSay(bodies.length===1?`「${bodies[0].name}」を保存しました`:`内訳 ${bodies.length}件を保存しました`);
 }

 /* ============================================================
    設備停止の時間 — 予定へ入れるときに選ばせる分（§9.389）
    ------------------------------------------------------------
    利用者の指示「時間のマスタは全体で共通、時間の選択マスタとしては
    機能させる。数値として扱うものなので**あくまで選択肢を作るマスタ**。
    登録時には、**選択肢＋スライダー**で時間を変更して登録もできる」。

    持つのは「分」だけなので、**表にしない**——1列の表は見出しのぶんだけ
    場所を取って、何も語らない。札（チップ）を並べて、**そのまま予定の
    登録画面に出る形**を見せる（§CLAUDE 「選ばせるものは選ぶ前に見える」）。
    スライダーの両端は**この一覧の最小〜最大**なので、下に同じ目盛りを
    出して「ここまで動かせる」を先に見せる（§9.163: 答えるのはサーバー）。
    ============================================================ */
 const smnState={items:[],slider:null};
 /* 結果は頭の知らせ（§9.602。前は帯の中の`#smnState`）。 */
 function smnSay(text,bad){WL.mm.headSay(text,bad)}
 async function loadStopMinutesMaint(){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.classList.remove('mm-form-compact');
  if(!list.querySelector('.smn-wrap'))list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const r=await api('/api/schedule/stop-minutes-master');
   smnState.items=(r.items||[]).map(x=>({...x}));
   smnState.slider=r.slider||null;
   renderStopMinutes();
  }catch(e){
   list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message||String(e))}</div>`;
  }
 }
 /* 盤の型（§9.602）: 選択肢の札の並びとスライダーの見本（2枚の面）をやめ、**1本の目盛り**で両方を言う——点＝選べる時間、
    帯＝スライダーで細かく直せる範囲（両端は選択肢そのもの）。字は点の上、近すぎる点（目盛りの3%未満）の字は線の下へ。
    消すのは点の字に乗せると出る ×、足すのは目盛りの下の欄。 */
 function smnRulerHtml(items,sl){
  const mins=items.map(r=>Number(r.minutes)).filter(n=>Number.isFinite(n)&&n>0).sort((a,b)=>a-b);
  if(!mins.length)return '<p class="mm-empty">選択肢がまだありません。下の欄から追加できます。</p>';
  const max=Math.max(...mins,sl?sl.max:0)||1;
  const pos=v=>`${(v/max*100).toFixed(2)}%`;
  let lastUp=-Infinity;
  const ticks=items.slice().sort((a,b)=>Number(a.minutes)-Number(b.minutes)).map(r=>{
   const v=Number(r.minutes),up=(v-lastUp)/max>=0.03;if(up)lastUp=v;
   const label=WL.duration.text(v);
   return `<span class="smn-tick${up?'':' is-low'}" style="left:${pos(v)}" data-smn-min="${v}"><i aria-hidden="true"></i>`
    +`<b>${esc(label)}<button type="button" data-smn-del="${r.id}" title="「${esc(label)}」を選択肢から消します" aria-label="「${esc(label)}」を消す">×</button></b></span>`;
  }).join('');
  return `<div class="smn-ruler" role="img" aria-label="選べる時間（点）とスライダーの範囲（帯）">`
   +(sl?`<span class="smn-band" style="left:${pos(sl.min)};width:calc(${pos(sl.max)} - ${pos(sl.min)})"></span>`:'')
   +ticks+`<span class="smn-axis">0</span></div>`;
 }
 function renderStopMinutes(){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  list.classList.remove('is-fill');
  list.parentElement&&list.parentElement.classList.remove('is-fill');
  const items=smnState.items||[];
  const sl=smnState.slider;
  /* 帯（`.op-bar`）は持たない（§9.602）: 用途は頭の1行、説明は ⓘ。 */
  form.innerHTML='';form.hidden=true;
  const key=sl?`点＝選べる時間　帯＝スライダーで細かく直せる範囲 ${WL.duration.text(sl.min)}〜${WL.duration.text(sl.max)}（${sl.step}分刻み）`
   :'点＝選べる時間（選択肢が1件以下のあいだは、スライダーは出しません——動かせる幅がありません）';
  list.innerHTML=`<div class="smn-wrap">
    <p class="smn-ruler-k">${esc(key)}<span class="smn-count">${items.length}件</span></p>
    ${smnRulerHtml(items,sl)}
    <div class="smn-add">
     <input type="text" id="smnNew" placeholder="分（例: 45）" autocomplete="off" inputmode="decimal" aria-label="追加する時間（分）">
     <button type="button" id="smnAdd" class="mm-btn-ghost">＋ 時間を追加</button>
    </div>
   </div>`;
  bindStopMinutes();
 }
 function bindStopMinutes(){
  const list=$('#masterMaintList');if(!list)return;
  const add=$('#smnAdd');
  if(add){
   add.onclick=async()=>{
    const el=$('#smnNew');
    const n=Number(String(el&&el.value||'').trim());
    if(!(Number.isFinite(n)&&n>0)){smnSay('分は0より大きい数で入れてください。',true);el&&el.focus();return}
    const uid=requireMaintUser();if(uid===null)return;
    try{
     await api('/api/schedule/stop-minutes-master',
       {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({minutes:n,user_id:uid})});
     await loadStopMinutesMaint();
     smnSay(`${WL.duration.text(n)}を追加しました`);
     const again=$('#smnNew');
     if(again){again.value='';try{again.focus({preventScroll:true})}catch(err){WL.quiet.note('入力欄へ戻せない（押し直せる）',err)}}
    }catch(e){smnSay(`足せませんでした: ${e.message||String(e)}`,true)}
   };
  }
  const el=$('#smnNew');
  if(el)el.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();add&&add.click()}};
  list.querySelectorAll('[data-smn-del]').forEach(btn=>{
   btn.onclick=async()=>{
    const id=Number(btn.dataset.smnDel);
    const cur=(smnState.items||[]).find(x=>Number(x.id)===id);
    if(!cur)return;
    const label=WL.duration.text(Number(cur.minutes));
    if(!(await confirmModal({message:`「${label}」を選択肢から消しますか？\n`
      +'これまでに入れた予定の時間は変わりません（消えるのは選択肢だけです）。',confirmLabel:'削除する',danger:true})))return;
    const uid=requireMaintUser();if(uid===null)return;
    try{
     await api('/api/schedule/stop-minutes-master/delete',
       {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id,user_id:uid})});
     await loadStopMinutesMaint();
     smnSay(`${label}を消しました`);
    }catch(e){smnSay(`消せませんでした: ${e.message||String(e)}`,true)}
   };
  });
 }


 /* 盤の登録簿へ名乗る（§9.324 R3）。 */
 WL.mm.registerSpecial('import-backup',{load:loadImportBackupMaint});
 WL.mm.registerSpecial('data-source',{load:loadDataSourceMaint,onEditorClose:()=>{dsState.editing=null;renderDataSource()}});
 WL.mm.registerSpecial('query-join',{load:loadQueryJoinMaint,onEditorClose:()=>{qjState.editing=null;renderQueryJoin()}});
 WL.mm.registerSpecial('path-config',{load:loadPathConfigMaint});
 WL.mm.registerSpecial('shift-pattern',{load:loadShiftPatternMaint,dirty:shiftDirty});   // 保存していない変更は離れる前に聞く（§9.598）
 WL.mm.registerSpecial('cleanup',{load:loadCleanupMaint,dirty:setDirty});
 WL.mm.registerSpecial('raw-table',{load:loadRawTableMaint});
 WL.mm.registerSpecial('presence',{load:loadPresenceMaint});
 /* 統合した設備停止マスタ（§9.397）。名乗りは `stop-master` の1つ——
    分類・停止内容・内訳を1枚で受け持つ。停止内容そのものの編集は汎用の
    編集窓を開いて使い回すので、窓を閉じたら描き直す（`onEditorClose`）。 */
 WL.mm.registerSpecial('stop-master',{load:loadStopSubMaint,dirty:ssbDirty});
 WL.mm.registerSpecial('stop-minutes',{load:loadStopMinutesMaint});
 Object.assign(WL.mm,{dropRetiredTable,loadMasterTableCatalog,mtState});
})();
