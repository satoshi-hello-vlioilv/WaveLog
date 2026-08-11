"use strict";
/* list-columns.js: 列の設定パネル(§9.88 段2-3)
   ============================================================
   1つの列の設定は1箇所に集める。名前・幅・並び・表示・書式を別々の画面へ
   散らすと、利用者は毎回「これはどこで設定するんだったか」を思い出す
   ことになる——認知コストの最大の発生源はそこ。

   画面は3面:
     左  この一覧の全列(D&Dで並べ替え・チェックで表示/非表示)
     右  選んだ1列の設定だけ(一度に見せる情報を絞る)
     下  実データのプレビュー ← **この画面の主役**

   下のプレビューが主役なのは、書式や読み替えが「仕様を読んで想像する
   もの」ではなく「結果を見て決めるもの」だから。右ペインにも
   「例: 生の値 → 見え方」を常に出し、打つそばから結果が見えるようにする。
   段4(読み替え)はここへ項目が増えるだけで済む。

   計算列・ボタン列(#・分割・測定・予定)も同じ一覧に並べる。利用者から
   見れば同じ「列」で、別扱いする理由が無い。ただし値を持たないので、
   右ペインは幅と表示名だけになる。
   ============================================================ */
(function(){
 const PANEL_ID='listColumnPanel';
 let target='',draft=null,picked='';

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
   <div class="sc-float-header"><div><h2>列の設定</h2></div>
    <button type="button" id="lcClose" title="閉じる">×</button></div>
   <div class="sc-float-body lc-body">
    <div class="lc-side">
     <input type="search" id="lcFilter" class="lc-filter" placeholder="列名で絞り込み" autocomplete="off">
     <div class="lc-list" id="lcList"></div>
    </div>
    <div class="lc-detail" id="lcDetail"></div>
   </div>
   <div class="lc-preview" id="lcPreview"></div>
   <div class="sc-float-foot">
    <span class="lc-count" id="lcCount"></span>
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
     中身の実データの列数だけ横に伸びる)ので、無ければ気づけるようにする。 */
  if(typeof WL.makeFloatingWindow==='function')
   WL.makeFloatingWindow(el,{storageKey:'listColumnPanelRectV2',defaultWidth:880,defaultHeight:620,
                             defaultTop:70,minWidth:560,minHeight:400});
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
  };
  if(!picked||!draft.order.includes(picked))picked=draft.order.find(k=>!isVirtual(k))||draft.order[0]||'';
 }

 function renderList(){
  const box=document.getElementById('lcList');if(!box)return;
  const q=String(document.getElementById('lcFilter')?.value||'').trim().toLowerCase();
  const rows=draft.order.filter(k=>!q||labelOf(k).toLowerCase().includes(q)||k.toLowerCase().includes(q));
  box.innerHTML=rows.map(k=>`
   <div class="lc-item${k===picked?' is-picked':''}" data-key="${esc(k)}" draggable="true">
    <input type="checkbox" ${draft.hidden.has(k)?'':'checked'} title="一覧に出すかどうか">
    <span class="lc-grip" title="ドラッグで並べ替え">⠿</span>
    <span class="lc-name" title="${esc(k)}">${esc(labelOf(k))}</span>
    ${draft.names[k]?'<i class="lc-renamed" title="表示名を変えています">名</i>':''}
    ${draft.formats[k]?`<i class="lc-renamed" title="${esc(fmtNote(draft.formats[k]))}">書</i>`:''}
   </div>`).join('')||'<div class="sc-empty-note">該当する列がありません</div>';
  box.querySelectorAll('.lc-item').forEach(el=>{
   const k=el.dataset.key;
   el.querySelector('input').onchange=e=>{
    e.stopPropagation();
    if(e.target.checked)draft.hidden.delete(k);else draft.hidden.add(k);
    renderCount();renderPreview();
   };
   el.onclick=()=>{picked=k;renderList();renderDetail();};
   el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',k);el.classList.add('lc-dragging')});
   el.addEventListener('dragend',()=>el.classList.remove('lc-dragging'));
   el.addEventListener('dragover',e=>e.preventDefault());
   el.addEventListener('drop',e=>{
    e.preventDefault();
    const from=e.dataTransfer.getData('text/plain');if(!from||from===k)return;
    const o=draft.order,i=o.indexOf(from);if(i<0)return;
    o.splice(i,1);o.splice(o.indexOf(k),0,from);
    renderList();renderPreview();
   });
  });
  renderCount();
 }

 function renderCount(){
  const el=document.getElementById('lcCount');if(!el)return;
  const shown=draft.order.filter(k=>!draft.hidden.has(k)).length;
  el.textContent=`${shown} / ${draft.order.length} 列を表示`;
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
  el.innerHTML=sample===''?'この列に値のある行がまだありません'
   :`例: <b>${esc(String(sample))}</b> → <b>${esc(WL.cellFormat.value(fmtOf(picked),sample))}</b>`;
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
  const shown=virt?'':WL.cellFormat.value(f,sample);
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
   <div class="lc-sample" id="lcSample">${sample===''?'この列に値のある行がまだありません'
     :`例: <b>${esc(String(sample))}</b> → <b>${esc(shown)}</b>`}</div>
   <p class="lc-hint">読み替え（00→なし 等）は次の段でここへ増えます。整形できない値は元のまま表示します。</p>`}`;
  box.querySelector('#lcName').addEventListener('input',e=>{
   const v=e.target.value.trim();
   if(v)draft.names[picked]=v;else delete draft.names[picked];
   renderList();renderPreview();
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
 }

 /* 実データのプレビュー。**設定を変えるたびに更新する。** */
 function renderPreview(){
  const box=document.getElementById('lcPreview');if(!box)return;
  const shown=draft.order.filter(k=>!draft.hidden.has(k));
  const rows=(S.rows||[]).slice(0,3);
  const cell=(r,k)=>isVirtual(k)?'—':esc(WL.cellFormat.value(draft.formats[k]||null,r[k]));
  // 一覧と同じ見え方にする(右づめも含めて)。ここで確かめたとおりに出ないと
  // プレビューの意味が無い。
  const cls=k=>draft.formats[k]?.kind==='number'?' class="col-num"':'';
  box.innerHTML=`<div class="lc-preview-label">プレビュー（実データの先頭${rows.length}件）</div>
   <div class="lc-preview-scroll"><table><thead><tr>${
    shown.map(k=>`<th${cls(k)}${draft.widths[k]?` style="width:${draft.widths[k]}px"`:''}>${esc(labelOf(k))}</th>`).join('')
   }</tr></thead><tbody>${
    rows.map(r=>`<tr>${shown.map(k=>`<td${cls(k)}>${cell(r,k)}</td>`).join('')}</tr>`).join('')
    ||'<tr><td>データがありません</td></tr>'
   }</tbody></table></div>`;
 }

 async function save(){
  try{
   await WL.columnLayout.save(target,{order:draft.order,widths:draft.widths,
                                      hidden:[...draft.hidden],names:draft.names,
                                      formats:draft.formats});
   showToast&&showToast('列の設定を保存しました','この一覧を次に開いたときも同じ形で出ます',2600);
   if(typeof renderGrid==='function')renderGrid();
  }catch(e){showToast&&showToast('保存に失敗しました',e.message,5000)}
 }
 async function reset(){
  draft={order:allKeys(),hidden:new Set(),widths:{},names:{},formats:{}};
  renderList();renderDetail();renderPreview();
 }

 function open(){
  target=typeof listLayoutTarget==='function'?listLayoutTarget():'';
  if(!target){showToast&&showToast('一覧を先に開いてください','列の設定はその一覧ごとに保存します',3200);return}
  ensurePanel();loadDraft();
  renderList();renderDetail();renderPreview();
  document.getElementById(PANEL_ID).hidden=false;
 }
 function close(){const el=document.getElementById(PANEL_ID);if(el)el.hidden=true}
 function toggle(){
  const el=document.getElementById(PANEL_ID);
  if(el&&!el.hidden)close();else open();
 }

 window.WL=window.WL||{};
 WL.listColumns={open,close,toggle};
})();
