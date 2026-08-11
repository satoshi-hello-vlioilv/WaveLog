"use strict";
/* list-columns.js: 列の設定パネル(§9.88 段2-3 / §9.90で作り直し)
   ============================================================
   1つの列の設定は1箇所に集める。名前・幅・並び・表示・書式を別々の画面へ
   散らすと、利用者は毎回「これはどこで設定するんだったか」を思い出す
   ことになる——認知コストの最大の発生源はそこ。

   画面は2面:
     左  **列のリスト**(縦に並ぶ。1行=1列)。チェックで表示/非表示、
         つまみで並べ替え、右端に**その列の実データ1件がどう見えるか**
     右  選んだ1列の設定だけ(一度に見せる情報を絞る)

   §9.90で下段の横長プレビュー表をやめ、**例をリストの中へ入れた**。
   横長の表は「1行ぶんの見え方」を確かめるには向くが、37列あると端が
   見えず、並べ替えの操作(縦のリスト)と結果(横の表)が別の場所に出るため
   視線が往復する。1行=1列で「名前・出す/出さない・見え方」が同じ行に
   並んでいれば、その行だけを見て判断できる。**例は1件でよい**——
   書式や読み替えが効いているかは1件見れば分かる。

   触った結果は**そのまま後ろの一覧へ即反映**する(WL.columnLayout.stage)。
   設定画面の中の見本で想像させるより、本物の一覧が変わるほうが速く確実。
   保存は別操作で、閉じるときに保存していなければ元へ戻す。

   計算列・ボタン列(#・分割・測定・予定)も同じ一覧に並べる。利用者から
   見れば同じ「列」で、別扱いする理由が無い。ただし値を持たないので、
   右ペインは幅と表示名だけになる。
   ============================================================ */
(function(){
 const PANEL_ID='listColumnPanel';
 let target='',draft=null,picked='',original=null,saved=false;

 /* 値を持たない列(行番号・ボタン)。並びと幅と名前は変えられるが、
    書式や読み替えは持たない。 */
 const VIRTUAL={
  '#':{label:'#（行番号）',note:'行の番号'},
  '__split__':{label:'分割',note:'分割の有無'},
  '__measure__':{label:'測定',note:'測定画面を開くボタン'},
  '__plan__':{label:'予定',note:'スケジュールへ追加するボタン'},
 };
 const isVirtual=k=>Object.prototype.hasOwnProperty.call(VIRTUAL,k);
 const labelOf=k=>isVirtual(k)?VIRTUAL[k].label:(draft.names[k]||k);
 /* 読み替えルールの編集を開く。閉じたら、作った(or 消した)結果を
    この列の選択へ反映する——「作ったのに選ばれていない」を無くすため。 */
 function editRule(name){
  if(typeof WL.listRules?.open!=='function'){
   console.error('列の設定パネル: WL.listRules が見つかりません');return;
  }
  WL.listRules.open({name,column:picked,onDone:saved=>{
   if(saved)draft.rules[picked]=saved;else delete draft.rules[picked];
   renderDetail();renderList();renderPreview();
  }});
 }
 /* 一覧の「書」バッジの説明。何の書式が効いているかを一言で。 */
 function fmtNote(f){
  if(!f)return '';
  if(f.kind==='number')return '数値'+(f.decimals!=null?`（小数${f.decimals}桁）`:'')
   +(f.thousands?'・3桁区切り':'')+(f.prefix||f.suffix?`・単位${f.prefix||''}〜${f.suffix||''}`:'');
  if(f.kind==='datetime')return '日付・時刻（'+(f.pattern||'yyyy/MM/dd')+'）';
  if(f.kind==='text')return '文字（前後の空白を落とす）';
  return '書式を設定しています';
 }

 function ensurePanel(){
  let el=document.getElementById(PANEL_ID);
  if(el)return el;
  el=document.createElement('div');
  el.className='sc-float-win';el.id=PANEL_ID;el.hidden=true;
  el.innerHTML=`
   <div class="sc-float-header"><div><h2>列の設定</h2>
     <small class="lc-sub">変えたものはすぐ後ろの一覧に出ます。残すときは保存を押します。</small></div>
    <button type="button" id="lcClose" title="閉じる">×</button></div>
   <div class="sc-float-body lc-body">
    <div class="lc-side">
     <div class="lc-side-head">
      <input type="search" id="lcFilter" class="lc-filter" placeholder="列名で絞り込み" autocomplete="off">
     </div>
     <div class="lc-list-head"><span>出す</span><span>列（上下にドラッグで並べ替え）</span>
      <span>この列の見え方（実データ1件）</span></div>
     <div class="lc-list" id="lcList"></div>
    </div>
    <div class="lc-detail" id="lcDetail"></div>
   </div>
   <div class="sc-float-foot">
    <span class="lc-count" id="lcCount"></span>
    <span class="lc-foot-note" id="lcFootNote"></span>
    <div class="sc-content-foot-actions">
     <button type="button" id="lcReset">既定に戻す</button>
     <button type="button" id="lcSave" class="sc-column-save">保存</button>
    </div>
   </div>
   <div class="sc-float-resize" title="ドラッグで大きさを変えられます"></div>`;
  document.body.appendChild(el);
  el.querySelector('#lcClose').onclick=close;
  el.querySelector('#lcSave').onclick=save;
  el.querySelector('#lcReset').onclick=reset;
  el.querySelector('#lcFilter').addEventListener('input',renderList);
  /* 位置と大きさは共通のフローティングウィンドウに任せる(§9.16)。
     **これが効かないとパネルは画面外へ開く**(幅も高さも与えられず、
     中身の実データの列数だけ横に伸びる)ので、無ければ気づけるようにする。
     §9.90で既定を広げた(880×620→1180×760)。列が37本ある一覧で
     11本しか見えず、下段のプレビュー表が場所を取っていたため。
     保存キーも変える——既に小さい値を覚えている端末があるので、
     同じキーのままだと新しい既定が誰にも見えない。 */
  if(typeof WL.makeFloatingWindow==='function')
   WL.makeFloatingWindow(el,{storageKey:'listColumnPanelRectV3',defaultWidth:1180,defaultHeight:760,
                             defaultTop:60,minWidth:720,minHeight:460});
  else console.error('列の設定パネル: WL.makeFloatingWindow が見つかりません');
  return el;
 }

 /* 今の一覧の全列(仮想列を含む)。表示中かどうかに関わらず並べる。 */
 function allKeys(){
  const out=[];
  const isWork=WL.dataSource.isWork(S.db);
  const canPlan=isWork&&window.accessMode?.mode==='schedule';
  if(canPlan)out.push('__plan__');
  out.push('#');
  if(isWork)out.push('__split__');
  out.push(...(S.columns||[]));
  if(isWork)out.push('__measure__');
  return out;
 }

 function loadDraft(){
  const l=WL.columnLayout.get(target);
  const keys=allKeys();
  const known=(l.order||[]).filter(k=>keys.includes(k));
  draft={
   order:[...known,...keys.filter(k=>!known.includes(k))],
   hidden:new Set((l.hidden||[]).filter(k=>keys.includes(k))),
   widths:{...(l.widths||{})},
   names:{...(l.names||{})},
   formats:JSON.parse(JSON.stringify(l.formats||{})),
   rules:{...(l.rules||{})},
  };
  if(!picked||!draft.order.includes(picked))picked=draft.order.find(k=>!isVirtual(k))||draft.order[0]||'';
 }

 /* この列の実データ1件が、今の設定でどう見えるか。書式・読み替えを
    通した結果をそのまま出す(一覧のセルと同じ関数)。 */
 function sampleCell(k){
  if(isVirtual(k))return {text:'（ボタン）',color:'',raw:''};
  const raw=sampleValue(k);
  if(raw==='')return {text:'',color:'',raw:''};
  const row=(S.rows||[]).find(r=>String(r[k]??'')===String(raw));
  const out=WL.cellFormat.cell({raw,format:draft.formats[k]||null,rule:draft.rules[k]||'',row,column:k});
  return {text:out.text,color:out.color,raw:String(raw)};
 }

 function renderList(){
  const box=document.getElementById('lcList');if(!box)return;
  const q=String(document.getElementById('lcFilter')?.value||'').trim().toLowerCase();
  const rows=draft.order.filter(k=>!q||labelOf(k).toLowerCase().includes(q)||k.toLowerCase().includes(q));
  box.innerHTML=rows.map(k=>{
   const s=sampleCell(k);
   const changed=s.raw&&s.raw!==s.text;
   return `
   <div class="lc-item${k===picked?' is-picked':''}${draft.hidden.has(k)?' is-off':''}" data-key="${esc(k)}">
    <label class="lc-vis" title="一覧に出すかどうか">
     <input type="checkbox" ${draft.hidden.has(k)?'':'checked'}></label>
    <span class="lc-grip" title="上下にドラッグして並べ替え">⠿</span>
    <span class="lc-name" title="${esc(k)}">${esc(labelOf(k))}</span>
    <span class="lc-marks">${draft.names[k]?'<i class="lc-mark" title="表示名を変えています">名</i>':''}${
      draft.formats[k]?`<i class="lc-mark" title="${esc(fmtNote(draft.formats[k]))}">書</i>`:''}${
      draft.rules[k]?`<i class="lc-mark" title="読み替え: ${esc(draft.rules[k])}">替</i>`:''}</span>
    <span class="lc-eg">${changed?`<s>${esc(s.raw)}</s>`:''}<b class="${s.color?'cell-'+s.color:''}">${
      esc(s.text)||'<i class="lc-eg-none">（値のある行がありません）</i>'}</b></span>
   </div>`}).join('')||'<div class="sc-empty-note">該当する列がありません</div>';
  box.querySelectorAll('.lc-item').forEach(el=>{
   const k=el.dataset.key;
   /* **チェックは click で受ける。** change は click の後(=行の
      クリックで作り直した後)に飛ぶため、以前は反映されなかった
      ——外しても一覧に残る、という不具合として出ていた(実測で確認)。
      ここで止めておけば行のクリック(=列を選ぶ)とも衝突しない。 */
   el.querySelector('.lc-vis').addEventListener('click',e=>{
    e.stopPropagation();
    const on=el.querySelector('input').checked;   // clickの時点で反転済み
    if(on)draft.hidden.delete(k);else draft.hidden.add(k);
    el.classList.toggle('is-off',!on);
    renderCount();applyLive();
   });
   /* **選ぶのは click。** mouseup で選ぶ作りにすると、`el.click()` のような
      素のクリック(キーボード操作・自動化・支援技術)で選べなくなる。 */
   el.addEventListener('click',e=>{
    if(e.target.closest('.lc-vis'))return;
    picked=k;renderList();renderDetail();
   });
   /* **行のどこを掴んでも並べ替えられる**。つまみは目印で、そこしか
      掴めない作りにすると「掴めない＝並べ替えられない」と受け取られる。
      動かさなければ何もしない(上の click が選ぶ)、**4px以上動かしたら
      並べ替え**、としきい値で分けるので、選ぶ操作とは衝突しない。 */
   el.addEventListener('mousedown',e=>{
    if(e.button!==0||e.target.closest('.lc-vis'))return;
    const sx=e.clientX,sy=e.clientY;let started=false;
    const move=ev=>{
     if(started)return;
     if(Math.abs(ev.clientX-sx)+Math.abs(ev.clientY-sy)<4)return;
     started=true;cleanup();startReorder(ev,el,k);
    };
    const up=()=>cleanup();
    function cleanup(){document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up)}
    document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
    e.preventDefault();   // 掴んでいる間に文字が選択されるのを防ぐ(clickは残る)
   });
  });
  renderCount();
 }

 /* 並べ替えは**ポインタで掴んで動かす**(§9.90)。HTML5のD&Dは行の
    クリック(列を選ぶ)と紛れやすく、掴んだ手応えも出ない。掴んでいる間は
    入る位置に線を出し、離した時点で確定してそのまま一覧へ反映する。 */
 function startReorder(ev,el,key){
  ev.preventDefault();ev.stopPropagation();
  const box=el.parentElement;
  el.classList.add('lc-dragging');
  const mark=document.createElement('div');mark.className='lc-drop-mark';
  const place=y=>{
   const items=[...box.querySelectorAll('.lc-item:not(.lc-dragging)')];
   let before=null;
   for(const it of items){
    const r=it.getBoundingClientRect();
    if(y<r.top+r.height/2){before=it;break}
   }
   box.insertBefore(mark,before);
   return before?before.dataset.key:null;
  };
  let beforeKey=place(ev.clientY);
  const onMove=e=>{beforeKey=place(e.clientY)};
  const onUp=()=>{
   document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);
   mark.remove();el.classList.remove('lc-dragging');
   const o=draft.order,i=o.indexOf(key);
   if(i>=0){
    o.splice(i,1);
    const at=beforeKey?o.indexOf(beforeKey):o.length;
    o.splice(at<0?o.length:at,0,key);
   }
   renderList();applyLive();
  };
  document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
 }

 /* 触った結果を**保存せずに**後ろの一覧へ当てる(§9.90)。 */
 function applyLive(){
  WL.columnLayout.stage(target,{order:draft.order,widths:draft.widths,hidden:[...draft.hidden],
                                names:draft.names,formats:draft.formats,rules:draft.rules});
  if(typeof renderGrid==='function')renderGrid();
  const note=document.getElementById('lcFootNote');
  if(note)note.textContent='一覧に反映しています（保存すると次に開いたときも同じ形で出ます）';
 }

 function renderCount(){
  const el=document.getElementById('lcCount');if(!el)return;
  const shown=draft.order.filter(k=>!draft.hidden.has(k)).length;
  el.textContent=`${shown} / ${draft.order.length} 列`;
 }

 /* 日付時刻のよく使う形。**書き方を覚えなくても選べる**ようにするのが目的で、
    パターンの直接入力はその下に置く(細かく詰めたい人だけが触ればよい)。 */
 const DATE_PRESETS=[
  ['yyyy/MM/dd','2026/08/11'],
  ['yyyy/MM/dd HH:mm','2026/08/11 09:30'],
  ['yyyy/MM/dd HH:mm:ss','2026/08/11 09:30:15'],
  ['yy/MM/dd HH:mm','26/08/11 09:30'],
  ['MM/dd','08/11'],
  ['M月d日','8月11日'],
  ['yyyy年M月d日(ddd)','2026年8月11日(火)'],
  ['HH:mm','09:30'],
 ];
 const fmtOf=k=>draft.formats[k]||null;
 /* 書式の変更。**入力中の欄を作り直さない**ように、右ペイン全体を描き直すのは
    種別を変えたとき(=出る項目が変わるとき)だけにする。文字を打つたびに
    描き直すと、1文字ごとにカーソルが飛ぶ。 */
 function setFmt(patch,rerender){
  const cur=fmtOf(picked)||{kind:'',pattern:'',decimals:null,thousands:false,prefix:'',suffix:''};
  const next={...cur,...patch};
  const bare=!next.kind&&!next.pattern&&next.decimals==null&&!next.thousands&&!next.prefix&&!next.suffix;
  if(bare)delete draft.formats[picked];else draft.formats[picked]=next;
  if(rerender)renderDetail();else renderSample();
  renderPreview();
 }
 /* 「例: 生の値 → 見え方」。書式は読んで想像するものではなく、結果を見て
    決めるもの(設計方針2)なので、打つそばから更新する。 */
 function renderSample(){
  const el=document.getElementById('lcSample');if(!el||isVirtual(picked))return;
  const sample=sampleValue(picked);
  const out=WL.cellFormat.cell({raw:sample,format:fmtOf(picked),rule:draft.rules[picked]||'',
                               row:(S.rows||[]).find(r=>String(r[picked]??'')===String(sample)),
                               column:picked});
  el.innerHTML=sample===''?'この列に値のある行がまだありません'
   :`例: <b>${esc(String(sample))}</b> → <b class="${out.color?'cell-'+out.color:''}">${esc(out.text)}</b>`;
 }
 /* この列の実データの先頭(空でないもの)。書式の「例」に使う。 */
 function sampleValue(k){
  for(const r of (S.rows||[])){
   const v=r[k];
   if(v!==null&&v!==undefined&&String(v).trim()!=='')return v;
  }
  return '';
 }

 function formatFields(f){
  const kind=f?.kind||'';
  if(kind==='number')return `
   <div class="lc-sub">
    <label class="lc-field"><span>小数桁</span>
     <select id="lcDecimals">${['','0','1','2','3','4','5','6'].map(v=>
      `<option value="${v}"${String(f?.decimals??'')===v?' selected':''}>${v===''?'そのまま':v+'桁'}</option>`).join('')}</select></label>
    <label class="lc-check"><input type="checkbox" id="lcThousands"${f?.thousands?' checked':''}>
     <span>3桁ごとに区切る（1,234）</span></label>
    <label class="lc-field"><span>単位</span>
     <span class="lc-units">前<input type="text" id="lcPrefix" maxlength="8" value="${esc(f?.prefix||'')}"
      placeholder="¥"> 後<input type="text" id="lcSuffix" maxlength="8" value="${esc(f?.suffix||'')}"
      placeholder="mm"></span></label>
   </div>`;
  if(kind==='datetime')return `
   <div class="lc-sub">
    <label class="lc-field"><span>形</span>
     <select id="lcPreset">${DATE_PRESETS.map(([p,e])=>
      `<option value="${esc(p)}"${(f?.pattern||'')===p?' selected':''}>${esc(e)}</option>`).join('')}
      <option value=""${DATE_PRESETS.some(([p])=>p===(f?.pattern||''))?'':' selected'}>自分で指定</option></select></label>
    <label class="lc-field"><span>パターン</span>
     <input type="text" id="lcPattern" maxlength="60" value="${esc(f?.pattern||'')}"
      placeholder="yyyy/MM/dd HH:mm" autocomplete="off"></label>
    <p class="lc-hint lc-hint-tokens">y=年 M=月 d=日 H=時 m=分 s=秒 ddd=曜日（2つ重ねると0埋め）</p>
   </div>`;
  return '';
 }

 function renderDetail(){
  const box=document.getElementById('lcDetail');if(!box)return;
  if(!picked){box.innerHTML='<div class="sc-empty-note">左の一覧から列を選んでください。</div>';return}
  const virt=isVirtual(picked);
  const f=fmtOf(picked);
  const sample=virt?'':sampleValue(picked);
  const shown=virt?'':WL.cellFormat.cell({raw:sample,format:f,rule:draft.rules[picked]||'',
                                          row:(S.rows||[]).find(r=>String(r[picked]??'')===String(sample)),
                                          column:picked}).text;
  box.innerHTML=`
   <div class="lc-detail-head">${esc(labelOf(picked))}
    <small>${virt?esc(VIRTUAL[picked].note):'元の項目名: '+esc(picked)}</small></div>
   <label class="lc-field"><span>表示名</span>
    <input type="text" id="lcName" value="${esc(draft.names[picked]||'')}"
     placeholder="${esc(virt?VIRTUAL[picked].label:picked)}" autocomplete="off"></label>
   <label class="lc-field"><span>幅</span>
    <span class="lc-width"><input type="number" id="lcWidth" min="40" max="900" step="10"
     value="${draft.widths[picked]||''}" placeholder="内容に合わせる"> px</span></label>
   ${virt?'<p class="lc-hint">この列は値を持たないため、書式や読み替えはありません。</p>':`
   <div class="lc-field lc-field-kind"><span>書式</span>
    <div class="lc-kinds" id="lcKinds">${[['','そのまま'],['number','数値'],['datetime','日付・時刻'],['text','文字']]
     .map(([v,t])=>`<label class="lc-kind"><input type="radio" name="lcKind" value="${v}"${(f?.kind||'')===v?' checked':''}><span>${t}</span></label>`).join('')}</div></div>
   ${formatFields(f)}
   <label class="lc-field"><span>読み替え</span>
    <span class="lc-rulepick">
     <select id="lcRule">${[['','しない'],...WL.displayRules.names().map(n=>[n,n])]
      .map(([v,t])=>`<option value="${esc(v)}"${(draft.rules[picked]||'')===v?' selected':''}>${esc(t)}</option>`).join('')}
      <option value="__new__">＋ 新しいルールを作る…</option></select>
     <button type="button" id="lcRuleEdit" ${draft.rules[picked]?'':'disabled'}>ルールを編集</button>
    </span></label>
   <div class="lc-sample" id="lcSample">${sample===''?'この列に値のある行がまだありません'
     :`例: <b>${esc(String(sample))}</b> → <b>${esc(shown)}</b>`}</div>
   <p class="lc-hint">読み替えが当たった行はその言葉で確定し、当たらなければ書式で整形します。どちらもできない値は元のまま表示します。</p>`}`;
  box.querySelector('#lcName').addEventListener('input',e=>{
   const v=e.target.value.trim();
   if(v)draft.names[picked]=v;else delete draft.names[picked];
   renderPreview();
  });
  box.querySelector('#lcWidth').addEventListener('input',e=>{
   const n=Number(e.target.value);
   if(n>=40)draft.widths[picked]=Math.min(900,n);else delete draft.widths[picked];
   renderPreview();
  });
  if(virt)return;
  box.querySelectorAll('input[name="lcKind"]').forEach(el=>{
   el.onchange=()=>{
    /* 種別を変えたら、その種別で意味のない指定は落とす(数値の桁数が
       日付の設定として残っていると、戻したときに驚く)。 */
    const kind=el.value;
    if(kind==='datetime')setFmt({kind,decimals:null,thousands:false,prefix:'',suffix:'',
                                 pattern:fmtOf(picked)?.pattern||DATE_PRESETS[0][0]},true);
    else if(kind==='number')setFmt({kind,pattern:''},true);
    else if(kind==='text')setFmt({kind,pattern:'',decimals:null,thousands:false},true);
    else setFmt({kind:'',pattern:'',decimals:null,thousands:false,prefix:'',suffix:''},true);
   };
  });
  const on=(id,ev,fn)=>{const el=box.querySelector(id);if(el)el.addEventListener(ev,fn)};
  on('#lcDecimals','change',e=>setFmt({decimals:e.target.value===''?null:Number(e.target.value)}));
  on('#lcThousands','change',e=>setFmt({thousands:e.target.checked}));
  on('#lcPrefix','input',e=>setFmt({prefix:e.target.value.slice(0,8)}));
  on('#lcSuffix','input',e=>setFmt({suffix:e.target.value.slice(0,8)}));
  on('#lcPreset','change',e=>{
   if(!e.target.value)return;                       // 「自分で指定」は下の欄で
   setFmt({pattern:e.target.value},true);
  });
  on('#lcPattern','input',e=>{
   setFmt({pattern:e.target.value.slice(0,60)});
   // 「形」の選択も追随させる(パターンを直接打った結果が既定形と同じになる
   //  ことがあるため。ここだけは作り直さずに値を差し替える)
   const sel=box.querySelector('#lcPreset');
   if(sel)sel.value=DATE_PRESETS.some(([p])=>p===e.target.value)?e.target.value:'';
  });
  /* 読み替え(段4)。ルールは列に属さないので、ここでは**名前を選ぶだけ**。
     中身の編集は専用の画面へ渡す(同じルールを複数の列から使うため)。 */
  on('#lcRule','change',e=>{
   if(e.target.value==='__new__'){
    e.target.value=draft.rules[picked]||'';
    editRule('');return;
   }
   if(e.target.value)draft.rules[picked]=e.target.value;else delete draft.rules[picked];
   renderDetail();renderList();renderPreview();
  });
  on('#lcRuleEdit','click',()=>editRule(draft.rules[picked]||''));
 }

 /* 一覧そのものが見本なので、パネルの中に別の表は持たない(§9.90)。
    設定を変えたら**リストの「見え方」と後ろの一覧の両方**を描き直す。
    **リストを忘れないこと**——書式や読み替えを変えても行の例が古いままだと、
    「効いていない」と受け取られる(実際にそう見える状態を作ってしまった)。 */
 function renderPreview(){renderList();applyLive()}

 async function save(){
  try{
   await WL.columnLayout.save(target,{order:draft.order,widths:draft.widths,
                                      hidden:[...draft.hidden],names:draft.names,
                                      formats:draft.formats,rules:draft.rules});
   saved=true;
   original={order:[...draft.order],hidden:[...draft.hidden],widths:{...draft.widths},
             names:{...draft.names},formats:JSON.parse(JSON.stringify(draft.formats)),
             rules:{...draft.rules}};
   showToast&&showToast('列の設定を保存しました','この一覧を次に開いたときも同じ形で出ます',2600);
   const note=document.getElementById('lcFootNote');
   if(note)note.textContent='保存しました';
   if(typeof renderGrid==='function')renderGrid();
  }catch(e){showToast&&showToast('保存に失敗しました',e.message,5000)}
 }
 async function reset(){
  draft={order:allKeys(),hidden:new Set(),widths:{},names:{},formats:{},rules:{}};
  renderList();renderDetail();applyLive();
 }

 function open(){
  target=typeof listLayoutTarget==='function'?listLayoutTarget():'';
  if(!target){showToast&&showToast('一覧を先に開いてください','列の設定はその一覧ごとに保存します',3200);return}
  ensurePanel();
  /* 閉じたときに戻せるよう、開いた時点の値を控える。 */
  const cur=WL.columnLayout.get(target);
  original={order:[...(cur.order||[])],hidden:[...(cur.hidden||[])],widths:{...(cur.widths||{})},
            names:{...(cur.names||{})},formats:JSON.parse(JSON.stringify(cur.formats||{})),
            rules:{...(cur.rules||{})}};
  saved=false;
  loadDraft();
  renderList();renderDetail();
  document.getElementById(PANEL_ID).hidden=false;
 }
 /* 保存せずに閉じたら、後ろの一覧を開いたときの形へ戻す。**触った結果が
    そのまま残ると「保存」の意味が無くなる**(何が保存済みか分からなくなる)。 */
 function close(){
  const el=document.getElementById(PANEL_ID);if(el)el.hidden=true;
  if(!saved&&original&&target){
   WL.columnLayout.stage(target,original);
   if(typeof renderGrid==='function')renderGrid();
  }
 }
 function toggle(){
  const el=document.getElementById(PANEL_ID);
  if(el&&!el.hidden)close();else open();
 }

 window.WL=window.WL||{};
 WL.listColumns={open,close,toggle};
})();
