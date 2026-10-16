/* ============================================================
   lot-hide.js: 予定に入れたロットを仕掛一覧から伏せる決まり（§9.612、利用者の指示）

   利用者の言葉「仕掛一覧から作業スケジュールを組み込む際に、ロットを消し込む処理の条件も見えないので、こちらも設定が
   できるように汎用化して組み込んでください…ロット番号、鋳造番号、製造材質、BOX番号といった組み合わせかつ複数回同一工程を
   通るものでも正しくスケジューリングで区別できるようにしたい」→ 答え「区別の列も設定で選ぶ」。

   ・作業スケジュールの中の仕掛一覧で、2段目（状態）に札「予定と同じロットを伏せる N件」を出す（**いつも見える**）。
   ・押すと面: どう見分けているか（鍵の列＋区別の列）→ いま伏せているロット → 変える欄（変えられる端末だけ・できなければ理由）。
   ・決まりと鍵を作るのはサーバー（`lot_identity`・`/api/schedule/lot-identity`）。この画面は**比べた結果を数えて見せるだけ**
     （伏せる行は`WL.scheduleView.hiddenLotSet()`の1箇所が答える）。
   ============================================================ */
(function(){
 'use strict';
 const WL=(window.WL=window.WL||{});
 const PATH='/api/schedule/lot-identity';
 let info=null,loading=null,draft=null;
 async function fetchInfo(force){
  if(info&&!force)return info;
  if(!loading)loading=api(PATH).then(d=>{info=d;return d}).finally(()=>{loading=null});
  return loading;
 }
 const inScope=()=>document.body.classList.contains('sc-mode')&&!!(S.db&&WL.dataSource?.isWork?.(S.db));
 /* いま伏せている行（この一覧の読み込んだ行のうち、予定と同じ鍵の行）。 */
 function hiddenRows(){
  const set=WL.scheduleView?.hiddenLotSet?.();
  if(!set||!set.size)return [];
  return (S.rows||[]).filter(r=>r.__lotKey&&set.has(r.__lotKey));
 }
 const rule=x=>x?[...(x.keys||[])].join('＋')+((x.pass||[]).length?`／何回目か: ${x.pass.join('＋')}`:''):'';
 function chip(){
  const box=document.getElementById('listToolSums');if(!box)return null;
  let b=box.querySelector('#lotHideChip');
  if(!b){b=document.createElement('button');b.type='button';b.id='lotHideChip';b.className='lt-tool-btn lh-chip';
   b.setAttribute('aria-haspopup','dialog');b.setAttribute('aria-expanded','false');
   b.onclick=()=>openPanel(b);box.appendChild(b)}
  return b;
 }
 function paint(){
  const b=document.getElementById('lotHideChip');
  if(!inScope()){if(b)b.hidden=true;return}
  const c=chip();if(!c)return;
  c.hidden=false;
  const n=hiddenRows().length;
  c.classList.toggle('is-active',n>0);
  c.innerHTML=`<i class="fa-solid fa-eye-slash" aria-hidden="true"></i><span class="lt-tool-t">予定と同じロットを伏せる</span><b class="lt-n">${n}</b><i class="hd-caret" aria-hidden="true">▾</i>`;
  c.title=`予定に入れたロット（同じロットの見分け方: ${rule(info&&info.identity)||'読み込み中'}）をこの一覧に出していません: ${n}件。押すと見分け方と伏せたロットが見えます。`;
  if(!info)fetchInfo().then(paint).catch(WL.quiet('ロットの見分け方を読めない（札の説明は後で）'));
 }
 const colsNow=()=>(S.columns||[]).filter(c=>!/^__/.test(c));
 function pickHtml(kind,list,label,hint){
  const other=kind==='keys'?draft.pass:draft.keys;
  const left=colsNow().filter(c=>!list.includes(c)&&!other.includes(c));
  return `<div class="lh-row"><span class="lh-k">${esc(label)}<small>${esc(hint)}</small></span><span class="lh-v">${
   list.map((c,i)=>`<span class="lh-tag">${esc(c)}${info.canSet?`<button type="button" class="lh-x" data-lh-drop="${kind}:${i}" aria-label="${esc(c)}を外す">×</button>`:''}</span>`).join('')||'<em class="lh-none">なし</em>'}${
   info.canSet?`<select class="lh-add" data-lh-add="${kind}" aria-label="${esc(label)}に列を足す"><option value="">＋ 列を足す</option>${left.map(c=>`<option>${esc(c)}</option>`).join('')}</select>`:''}</span></div>`;
 }
 function panelHtml(){
  const rows=hiddenRows();
  const lots=rows.slice(0,8).map(r=>esc(pick(r,'lotNo')||'?')).join('・');
  const changed=JSON.stringify([draft.keys,draft.pass])!==JSON.stringify([info.identity.keys,info.identity.pass]);
  return `<div class="lh-head"><b>予定に入れたロットは、この一覧に出しません</b>
    <small>二重に入れないためです。終わったロットは、予定の表に見えているあいだだけ伏せます（もう一度来たら出ます）。</small></div>
   <section class="lh-sec"><h4>同じロットの見分け方</h4>
    ${pickHtml('keys',draft.keys,'同じロットとみなす列','すべてが同じなら同じロット')}
    ${pickHtml('pass',draft.pass,'何回目かを見分ける列','値が違えば別の回（例: 前工程の終了日）')}
    <p class="lh-note">${info.identity.note?esc(info.identity.note)+' ':''}字の全角・半角・大小・前後の空白の違いは同じと読みます。決まりは全端末に効きます。</p></section>
   <section class="lh-sec"><h4>いま伏せているロット <b>${rows.length}件</b></h4>
    <p class="lh-lots">${rows.length?lots+(rows.length>8?` ほか${rows.length-8}件`:''):'ありません'}</p></section>
   <div class="lh-foot">${info.canSet
    ?`<button type="button" class="mm-btn-ghost sm" data-lh-reset${changed?'':' disabled'}>元に戻す</button><button type="button" class="mm-btn-primary sm" data-lh-save${changed&&draft.keys.length?'':' disabled'}>この見分け方にする</button>`
    :`<p class="lh-deny">${esc(info.deniedReason||'この端末では変えられません。')}</p>`}</div>`;
 }
 async function openPanel(btn){
  let m=document.getElementById('lotHidePanel');
  if(m&&!m.hidden){WL.popMenu.close();return}
  try{await fetchInfo(true)}catch(e){showToast&&showToast('ロットの見分け方を読めませんでした',e.message||String(e),5000);return}
  if(!m){m=document.createElement('div');m.id='lotHidePanel';m.className='wl-menu lh-panel';m.setAttribute('role','dialog');m.setAttribute('aria-label','予定と同じロットを伏せる');m.hidden=true;document.body.appendChild(m)}
  draft={keys:[...info.identity.keys],pass:[...info.identity.pass]};
  const paintPanel=()=>{m.innerHTML=panelHtml();wire(m,paintPanel)};
  paintPanel();m.hidden=false;btn.setAttribute('aria-expanded','true');
  WL.popMenu.open(m,{anchor:btn,owner:btn,onClose:()=>{m.hidden=true;btn.setAttribute('aria-expanded','false')}});
 }
 function wire(m,again){
  m.querySelectorAll('[data-lh-drop]').forEach(b=>{b.onclick=()=>{const [k,i]=b.dataset.lhDrop.split(':');draft[k].splice(+i,1);again()}});
  m.querySelectorAll('[data-lh-add]').forEach(s=>{s.onchange=()=>{if(s.value)draft[s.dataset.lhAdd].push(s.value);again()}});
  const reset=m.querySelector('[data-lh-reset]');if(reset)reset.onclick=()=>{draft={keys:[...info.identity.keys],pass:[...info.identity.pass]};again()};
  const save=m.querySelector('[data-lh-save]');
  if(save)save.onclick=async()=>{
   save.disabled=true;
   try{
    const r=await api(PATH,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withUserId({keys:draft.keys,pass:draft.pass}))});
    info=Object.assign({},info,{identity:r.identity});
    showToast&&showToast('ロットの見分け方を変えました',rule(r.identity),3600);
    WL.popMenu.close();
    /* 鍵はサーバーが作り直す——予定と一覧の両方を取り直す（どちらかだけだと古い鍵どうしを比べる）。 */
    if(typeof window.invalidateTableCache==='function')window.invalidateTableCache();
    Promise.resolve(WL.scheduleView?.reloadPlan?.()).catch(WL.quiet('予定を取り直せない（次の読み込みで直る）'));
    S.page=1;WL.list.load();
   }catch(e){showToast&&showToast('変えられませんでした',e.message||String(e),6000);again()}
  };
 }
 WL.listHooks.onAfter(paint);
 WL.listHooks.onGrid(paint);
 WL.lotHide={paint,hiddenRows,fetchInfo};
})();
