/* ============================================================
   board-kit.js: 刃組のマスタの盤が共有する作り（§9.529 → §9.603、利用者の指示）

   「マスタのデザインがイマイチなので、すっきり統一感が欲しいです。」（§9.529）
   「もったりしたデザインのような印象があり…統一感や一貫性…きれいに作り替えたい」（§9.603）

   §9.603 で、刃組の7画面（刃組基準値・刃・スペーサー・ゴムリング・フィンガー・刃選択・保持方式）を
   ほかのマスタと同じ型へ載せた。前は盤ごとに**頭と主役のあいだの帯**（設備の選ぶ欄・状態の字・操作・
   説明の段落）を持ち、保存は「欄を離れたらすぐ」「表ごとのボタン」「色の属性だけのボタン」の3通りが
   混ざっていた（実測: 帯 385px・説明 1681字・保存の道が足元以外 4）。いまは:

     頭（`WL.mm`の頭）… 画面名・用途の1行・ⓘ（定義の`hint`）・状態の札・主の操作1つ・⋯（副の操作）
     本文（`#masterMaintList`）… 対象の札の行（設備・`WL.mm.scopeBarHtml`）
                               → 本文（`.bk-body`・ここだけが送る）
                               → 足元（`.bk-foot`・保存の1つ。器の下端に止まり、行を隠さない）

   **保存は足元の1つ**: 欄は打っても書かない。変えた値は控え（`st.edits`＝鍵→値）へ積み、描き直しても・
   左の一覧で行き来しても残る（DOM に持たない）。足元が「変更 N件」と言い、「保存」で盤がまとめて書く。
   行を足す・消す・名前を変えるは**構造の操作**なのでその場で書く（確かめる窓のあと）。
   ============================================================ */
(function(){
 const {requireMaintUser,setMaintLoading}=WL.mm;
 const listBox=()=>document.getElementById('masterMaintList');

 /* いま選べる設備（設備マスタの行）。 */
 const equipments=()=>((WL.records&&WL.records.equipmentMasterState&&WL.records.equipmentMasterState.items)||[]).map(e=>e.name);

 /* 盤を開くときの前置き: 設備マスタを読み、設備が未選択なら先頭を選ぶ。設備が無ければ本文に
    「先に設備を」と言って空文字を返す（盤ごとに書き写していた8行）。 */
 async function prologue(st,force){
  if(typeof WL.records.loadEquipmentMaster==='function'){
   try{await WL.records.loadEquipmentMaster(force)}
   catch(e){WL.quiet.note('設備マスタが読めなくても盤は開く',e)}
  }
  const eqs=equipments();
  if(!st.equipment||!eqs.includes(st.equipment))st.equipment=eqs[0]||'';
  if(!st.equipment){
   const box=listBox();
   if(box)box.innerHTML='<div class="mm-empty">設備マスタが未登録です。先に「設備」タブで登録してください。</div>';
  }
  return st.equipment;
 }

 /* ---------- 控え（§9.603）: 打った値は書かずに積む ---------- */
 const edits=st=>st.edits||(st.edits={});
 const has=(st,key)=>Object.prototype.hasOwnProperty.call(edits(st),key);
 /* 打った値を控える。書いてある値（`was`）と同じに戻したら控えから外す（「変更なし」へ戻る）。 */
 function edit(st,key,v,was){
  const e=edits(st);
  if(String(v??'')===String(was??''))delete e[key];else e[key]=v;
  paintFoot();
 }
 /* 描くときの値（控えがあれば控え・無ければ書いてある値）。 */
 const editOf=(st,key,cur)=>(has(st,key)?edits(st)[key]:cur);
 const editCount=st=>Object.keys(edits(st)).length;
 /* 欄の印（打って変えた欄は地で言う・足元の「変更 N件」と同じ物を指す）。 */
 const editCls=(st,key)=>(has(st,key)?' is-edited':'');
 /* 欄を控えへ結ぶ: `data-edit`（鍵）・`data-was`（書いてある値・チェックは 1／0）。`after(el)`は欄を離れたとき
    （計算の列・見通しを描き直す盤だけ渡す）。 */
 function bindEdits(root,st,after){
  root.querySelectorAll('[data-edit]').forEach(el=>{
   const read=()=>(el.type==='checkbox'?(el.checked?'1':'0'):el.value);
   const on=()=>{edit(st,el.dataset.edit,read(),el.dataset.was);el.classList.toggle('is-edited',has(st,el.dataset.edit))};
   el.addEventListener('input',on);
   el.addEventListener('change',()=>{on();if(after)later(()=>after(el))});
  });
  enterDown(root);
 }
 /* 欄を離れたあとの描き直しは**焦点と押した物が落ち着いてから**: Tab の`change`は焦点が次の欄へ移る前に起き、
    押して離れたときはボタンを押している最中に起きる。その場で描き直すと、移る先の欄や押したボタンが作り直されて
    焦点が迷子になり、押した物の`click`が届かなかった。押している間は離すまで待つ。 */
 let held=false;const pend=[];
 const flush=()=>{held=false;pend.splice(0).forEach(f=>f())};
 document.addEventListener('pointerdown',()=>{held=true},true);
 ['pointerup','pointercancel'].forEach(t=>document.addEventListener(t,()=>setTimeout(flush,0),true));
 const later=fn=>{if(held)pend.push(fn);else setTimeout(fn,0)};
 /* 表の中の Enter は**次の行の同じ欄へ**（本数を上から順に直す手を止めない）。日本語の変換中は取らない。 */
 function enterDown(root){
  root.querySelectorAll('tbody tr [data-edit][data-f]').forEach(el=>{
   if(el.type==='checkbox')return;
   el.addEventListener('keydown',ev=>{
    if(ev.key!=='Enter'||ev.isComposing)return;
    const f=el.dataset.f;let tr=el.closest('tr').nextElementSibling,to=null;
    while(tr&&!(to=tr.querySelector(`[data-edit][data-f="${CSS.escape(f)}"]`)))tr=tr.nextElementSibling;
    if(!to)return;
    ev.preventDefault();to.focus();try{to.select&&to.select()}catch(_e){WL.quiet.note('選べない欄（日付）は焦点だけ移す',_e)}
   });
  });
 }

 /* ---------- 頭（§9.603）: 状態の札・主の操作1つ・⋯ はほかのマスタと同じ頭へ名乗る ---------- */
 function head(o){
  const form=document.getElementById('masterMaintForm');
  if(form){form.innerHTML='';form.hidden=true;form.onsubmit=ev=>ev.preventDefault()}
  WL.mm.setHeadActs({primary:o.primary||null,more:o.more||[]});
  WL.mm.setHeadState(o.state||null);
  paintFoot();   // 変更があるあいだは頭の主の操作を縁取りに（塗りは足元の保存の1つ）
 }

 /* ---------- 骨組み（§9.603）: 対象の札の行 → 本文（送る）→ 足元（保存1つ） ----------
    `o`: {key（盤の名前）, note（札の行の右の一言）, tools（札の行の右の切り替え）, top（札の行と本文のあいだの1行）,
          body（本文の HTML）, onEquipment(設備), count()（変更の数）, what()（変更のある所の名前）, isNew()（新しい物を作っている）,
          blocked()（保存できない理由）, dirty()（控えのほかに保存していない物）, save(), cancel(), label（確かめる窓の名前）}
    同じ盤の描き直しは**本文の中身だけ**替える（送った位置を保つ・足元は作り直さない）。 */
 function frame(st,o){
  const box=listBox();if(!box)return null;
  box.classList.add('is-fill');box.parentElement&&box.parentElement.classList.add('is-fill');
  if(box.dataset.bkFrame!==o.key||!box.querySelector(':scope>.bk-body')){
   box.innerHTML=`<div class="bk-bar"></div><div class="bk-top" hidden></div><div class="bk-body"></div>
    <footer class="pc-save bk-foot"><span class="mm-form-hint pc-dirty" aria-live="polite"></span><span class="mm-set-fill"></span>
     <button type="button" class="mm-btn-ghost" data-bk-cancel>キャンセル</button><button type="button" class="mm-btn-primary" data-bk-save>保存</button></footer>`;
   box.dataset.bkFrame=o.key;
   const body=box.querySelector('.bk-body');
   body.addEventListener('scroll',()=>cue(body),{passive:true});
   if(typeof ResizeObserver==='function')new ResizeObserver(()=>cue(body)).observe(body);
   box.querySelector('[data-bk-cancel]').onclick=()=>{const f=box.__bk;if(f&&f.cancel)f.cancel()};
   box.querySelector('[data-bk-save]').onclick=()=>{const f=box.__bk;if(f&&f.save)f.save()};
  }
  box.__bk=Object.assign({st},o);
  box.querySelector('.bk-bar').innerHTML=WL.mm.scopeBarHtml({label:'設備',cur:st.equipment,
   items:equipments().map(n=>({v:n,label:n})),note:o.note||'',tools:o.tools||''});
  WL.mm.wireScopeBar(box,async v=>{
   if(!await mayLeave(st,o))return;
   st.edits={};st.equipment=v;o.onEquipment&&o.onEquipment(v);
  });
  const top=box.querySelector('.bk-top');top.innerHTML=o.top||'';top.hidden=!o.top;
  const body=box.querySelector('.bk-body');body.innerHTML=o.body||'';
  WL.popMenu.tips(box);
  paintFoot();requestAnimationFrame(()=>cue(body));
  return body;
 }
 /* 送る本文の下にまだ行があるときの合図（下端を薄く消す）。行が線で切れるだけだと「ここまで」と読まれる。 */
 function cue(body){
  if(!body.isConnected)return;
  body.classList.toggle('is-more',body.scrollTop+body.clientHeight<body.scrollHeight-2);
 }
 /* 足元の状態（共通設定・右の詳細と同じ`paintFootState`）。変更があれば「変更 N件（どこ）」を濃い字で。 */
 function paintFoot(){
  const box=listBox(),f=box&&box.__bk;if(!f)return;
  const foot=box.querySelector(':scope>.bk-foot');if(!foot)return;
  const st=foot.querySelector('.pc-dirty'),ok=foot.querySelector('[data-bk-save]'),no=foot.querySelector('[data-bk-cancel]');
  const isNew=!!(f.isNew&&f.isNew()),n=f.count?f.count():editCount(f.st)+(f.dirty&&f.dirty()?1:0),dirty=isNew||n>0;
  WL.mm.paintFootState(st,[no,ok],isNew,dirty,isNew?0:n);
  const what=dirty&&!isNew&&f.what?f.what():'';
  if(what)st.textContent=st.textContent.replace(/^(変更[^・]*)/,`$1（${what}）`);
  const why=f.blocked?f.blocked():'';
  if(why){ok.disabled=true;ok.title=why}
  if(f.st&&f.st.busy){ok.disabled=true;no.disabled=true}
  st.classList.toggle('is-dirty',dirty);
 }
 /* 保存していない変更を捨てて離れてよいか（変更が無ければ聞かない）。 */
 function mayLeave(st,o){
  const dirty=editCount(st)>0||!!(o.dirty&&o.dirty())||!!(o.isNew&&o.isNew()&&o.touched&&o.touched());
  return leave(dirty,o.label||'');
 }

 /* 2ペイン。左＝一覧（`items`の項目を全部。まとまりで分けて描く盤は組み上がった`listHtml`）、右＝詳細。
    `cls`は盤ごとの寸法の名乗り（`--bk-list-w`を宣言し直す）。足すのは頭の主の操作（一覧の下に「足す」を置かない）。 */
 function pane(o){
  const list=o.listHtml!=null?o.listHtml:(o.items||[]).map(itemHtml).join('');
  return `<div class="bk-pane${o.cls?' '+o.cls:''}">
   <nav class="bk-list" aria-label="${esc(o.label||'一覧')}">
    <div class="bk-items" role="listbox">${list||`<p class="bk-none">${esc(o.empty||'まだありません')}</p>`}</div>
   </nav>
   <section class="bk-detail">${o.detail||''}</section></div>`;
 }
 /* 一覧の1項目。`mark`（左の見本・字の札）・`title`・`sub`（2行目）・`tags`（右の札: {text,tone}）。 */
 function itemHtml(it){
  return `<button type="button" role="option" class="bk-item${it.on?' is-on':''}${it.tone?' is-'+it.tone:''}"`
   +` aria-selected="${!!it.on}" data-bk-key="${esc(it.key)}"${it.title2?` title="${esc(it.title2)}"`:''}>`
   +`<span class="bk-mark">${it.mark||''}</span>`
   +`<span class="bk-tx"><b>${esc(it.title)}</b>${it.sub?`<small>${esc(it.sub)}</small>`:''}</span>`
   +`<span class="bk-tags">${(it.tags||[]).map(t=>`<i class="bk-tag${t.tone?' is-'+t.tone:''}">${esc(t.text)}</i>`).join('')}</span></button>`;
 }
 /* 一覧の選ぶを配線する。 */
 function wirePane(box,o){
  box.querySelectorAll('[data-bk-key]').forEach(b=>{b.onclick=()=>o.onPick&&o.onPick(b.dataset.bkKey)});
 }
 /* 詳細の頭の ⋯（そのセット・その色を消す…）。危ない操作は主の動線（足元の保存）に置かない。 */
 const moreBtn=title=>`<button type="button" class="mm-btn-ghost mm-hd-more bk-more" data-bk-more aria-haspopup="menu" aria-expanded="false" aria-label="この項目の操作" title="${esc(title)}"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button>`;
 function wireMore(root,items){
  const b=root.querySelector('[data-bk-more]');
  if(b)b.onclick=()=>WL.mm.openActMenu(b,items,'この項目の操作');
 }

 /* 1つだけ選ぶ2〜4択（`.mm-seg`・§9.602 と同じ部品）。選んだ札は塗り。選んだ札をもう一度押しても何もしない。 */
 function seg(o){
  return `<span class="mm-seg bk-seg" role="radiogroup" aria-label="${esc(o.label)}">${
   o.list.map(v=>`<button type="button" role="radio" aria-checked="${v===o.cur}" class="${v===o.cur?'is-on':''}${o.edited&&v===o.cur?' is-edited':''}"`
    +` data-seg="${esc(o.key)}" data-v="${esc(v)}"${o.busy?' disabled':''}>${esc(v)}</button>`).join('')
  }</span>`;
 }

 const post=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 /* 書く操作の段取り: 更新者IDを確かめ→忙しい印→失敗は窓で理由を言う。成功で真を返す。 */
 async function guarded(st,fn,fail,paint){
  const uid=requireMaintUser();if(uid===null)return false;
  st.busy=true;paint&&paint();paintFoot();
  try{await fn(uid);return true}
  catch(e){await alertModal(fail+'：'+(e&&e.message?e.message:e));return false}
  finally{st.busy=false;paint&&paint();paintFoot()}
 }
 /* 足元の保存の段取り: 控えを書き、書けたら控えを空にして読み直す。結果は頭の知らせ（`headSay`）。 */
 async function saveEdits(st,fn,o){
  const ok=await guarded(st,fn,o.fail||'保存できませんでした');
  if(ok){st.edits={};WL.mm.headSay(o.done||'保存しました')}
  await o.reload();
  return ok;
 }
 /* 保存していない変更を捨てて離れてよいか（変更が無ければ聞かない）。 */
 function leave(dirty,what){
  if(!dirty)return Promise.resolve(true);
  return confirmModal({title:'保存していない変更を捨てる',eyebrow:what,
   bodyHtml:'<p class="confirm-modal-message">保存していない変更があります。捨てて切り替えますか？</p>',
   confirmLabel:'捨てて切り替える',cancelLabel:'やめる'});
 }
 /* 読み込みの器（本文に「読み込んでいます…」・頭の印）。 */
 async function loading(fn){
  const box=listBox();
  setMaintLoading&&setMaintLoading(true);
  try{return await fn()}
  catch(e){if(box)box.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e&&e.message?e.message:e)}</div>`;return null}
  finally{setMaintLoading&&setMaintLoading(false)}
 }

 /* 描き直しても**焦点を同じ欄へ戻す**（欄を離れて計算の列を描き直すと、Tab・Enter で移った先の欄が消えるため）。
    欄は「行の`data-id`＋欄の`data-f`」で見分ける。 */
 function keepFocus(paint){
  const a=document.activeElement,box=listBox();
  const tr=a&&box&&box.contains(a)&&a.closest('tr[data-id]');
  const key=tr&&a.dataset.f?[tr.dataset.id,a.dataset.f]:null;
  paint();
  if(!key)return;
  const el=box.querySelector(`tr[data-id="${CSS.escape(key[0])}"] [data-f="${CSS.escape(key[1])}"]`);
  if(el){el.focus();try{el.select&&el.select()}catch(_e){WL.quiet.note('選べない欄（日付）は焦点だけ戻す',_e)}}
 }

 /* ---------- 判定表の盤（刃選択・保持方式）が共有する部品（§9.603） ---------- */
 /* 決める順の流れ（押せない形・この画面の表を青緑）。刃組ガイダンスはこの順に表を見る。 */
 const FLOW=['保持方式','刃のカテゴリ','刃厚'];
 function flowHtml(mine,tail){
  return `<div class="bk-flow" aria-label="判定の流れ"><span class="bk-flow-steps">${FLOW.map((t,i)=>`${i?'<span class="bk-flow-arr" aria-hidden="true">→</span>':''}`
   +`<span class="bk-flow-step${mine.includes(i)?' is-mine':''}"><i>${i+1}</i>${esc(t)}</span>`).join('')}</span>${tail||''}</div>`;
 }
 /* 頭の主の操作「＋ 決まりの行 ▾」（どの表へ足すか）と ⋯（表を未登録に戻す）。 */
 function ruleActs(tables){
  const add=t=>{
   if(t.cols.length)return t.addRow();
   const b=t.o.host()&&t.o.host().querySelector('[data-rt="addcol"]');if(b){b.scrollIntoView({block:'nearest'});t.openColMenu(b)}
  };
  return {primary:{id:'rtAddRow',label:'決まりの行',title:'表の既定の行の上に決まりを1行足します（列がまだ無い表は、条件にするデータを選ぶところから）',
    menu:tables.map(t=>({label:`${t.label}の表に足す`,note:t.cols.length?'既定の行の上に入ります':'先に条件にするデータを選びます',data:{rtAdd:t.key},onClick:()=>add(t)}))},
   more:tables.filter(t=>t.stored).map(t=>({label:`${t.label}を未登録に戻す…`,note:`以後は${t.o.seedNote}`,danger:true,data:{rtReset:t.key},onClick:()=>t.reset()}))};
 }
 /* 判定表の足元: 変更のある表を順に保存（1つでも断られたらそこで止める）。 */
 const ruleFoot=(tables,reload)=>({count:()=>tables.filter(t=>t.dirty).length,dirty:()=>tables.some(t=>t.dirty),what:()=>tables.filter(t=>t.dirty).map(t=>t.label).join('・'),
  save:async()=>{for(const t of tables.filter(x=>x.dirty))if(!await t.save())return;WL.mm.headSay('保存しました')},
  cancel:()=>reload()});

 WL.bsKit={flowHtml,ruleActs,ruleFoot,keepFocus,equipments,prologue,head,frame,paintFoot,edit,editOf,editCount,editCls,bindEdits,
  pane,itemHtml,wirePane,moreBtn,wireMore,seg,post,guarded,saveEdits,leave,mayLeave,loading};
})();
