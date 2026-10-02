/* ============================================================
   ring-board.js: ゴムリングマスタの盤（§9.528 → §9.529 で2ペインへ）

   「ゴムリングの管理は、色ごとに外径内径は共通にして、幅毎に本数を管理できるように…
     色はコードではわかりにくいのでカラーピッカーなど直感的に色が判断できるもの、
     今まで登録した色と被らないようにしたいのでそれらの登録状況がわかるもの、
     色ごとにゴムリングをまとめて表示できるようにしてください。」（§9.528）
   「①色の被り判定の中に潤滑リングが入っていません。②新規の色を追加する際に色名を付けられません。
     ③マスタが使いにくい。」（§9.529・②の状況は「色名の欄が見つからない」）
   利用者の選択（§9.529）: 刃と同じ形——「一覧＋詳細の2ペイン」（`board-kit.js`）。

   ・左＝登録済みの色を**外径の順に全部**（見本・色名・外径／内径・幅と本数）。押すとその色。
     「＋ 色を足す」は空いている標準の色（無ければ登録済みの色からいちばん離れた色）で開く。
   ・右＝選んだ色: **色名がいちばん上**（新しい色では焦点もここ）→ 色（ピッカー）・外径・内径は
     **1回だけ**（その色の幅ぜんぶに効く）→ 幅ごとの本数は表の中で直す（欄を離れると保存）。
   ・被り: 色・色名・外径を触るたびにサーバーへ聞く（`ring_color_conflicts()`の1箇所・潤滑リングも
     見えている紫で比べる）。断る被りは保存を止めて理由を字で、近い色は注意として一覧の見本にも印。
   ============================================================ */
(function(){
 const K=()=>WL.bsKit;
 const NEW='__new';
 const WIDTH_SEED=[50,30,20,15,10];
 const rs={equipment:'',colors:[],cycle:[],kinds:[],suggest:null,nearDe:20,sel:'',draft:null,
           check:{hard:[],near:[],text:''},busy:false,loaded:false};
 let checkTimer=0,checkSeq=0;

 const colorOf=name=>rs.colors.find(g=>g.color===name)||null;
 const num=v=>(String(v??'').trim()===''?null:Number(v));
 const fmt=v=>(v==null||v===''?'—':String(+(+v).toFixed(2)));
 const swatch=(hex,lube)=>`<i class="rb-sw${lube?' is-lube':''}"${hex?` style="--sw:${esc(hex)}"`:''} aria-hidden="true"></i>`;
 const post=(path,body)=>K().post(path,body);

 /* ---------- 下書き（カードの中身） ---------- */
 function draftOf(g){
  if(g)return {current:g.color,color:g.color,hex:g.hex||g.tone||'',od:g.od,bore:g.bore,lube:!!g.lube,integ:!!g.integ};
  const s=rs.suggest||{};
  const ws=[...new Set(rs.colors.filter(x=>!x.lube).flatMap(x=>x.widths.map(w=>w.width)))].sort((a,b)=>b-a);
  /* 色は**サーバーの候補**（空いている標準の色、無ければ登録済みの色からいちばん離れた色・§9.529）。 */
  return {current:'',color:s.color||'',hex:s.hex||'#808080',od:s.od??'',bore:s.bore??'',lube:false,integ:false,
          widths:(ws.length?ws:WIDTH_SEED).map(w=>({width:w,qty:''}))};
 }
 const isDirty=()=>{const d=rs.draft,g=colorOf(d&&d.current);
  return !!d&&(!g||d.color!==g.color||(d.hex||'')!==(g.hex||'')||num(d.od)!==g.od||num(d.bore)!==g.bore)};

 /* ---------- 頭と一覧（登録済みの色） ---------- */
 function renderForm(){
  const rubber=rs.colors.filter(g=>!g.lube&&!g.integ).length,lube=rs.colors.filter(g=>g.lube).length,integ=rs.colors.filter(g=>g.integ).length;
  K().renderHead(rs,{id:'rbEq',
   state:rs.loaded?`登録済みの色 <b>${rubber}色</b>${integ?`＋スペーサー一体型 ${integ}`:''}${lube?`＋潤滑リング ${lube}`:''}`:'',
   hint:'1本は<b>色×幅</b>。<b>外径・内径は色ごとに1つ</b>（その色の幅すべてに効く）、本数は幅ごとに表の中で直します（欄を離れるとすぐ保存）。<b>同じ色名・同じ色・同じ外径</b>はほかの色（潤滑リングを含む）と被らせません。',
   leaveOk,onEquipment:()=>{rs.sel='';load(true)}});
 }
 const swOf=g=>swatch(g.tone||g.hex,g.lube);
 function itemOf(g){
  return {key:g.color,on:g.color===rs.sel,mark:swOf(g),title:g.color,
   sub:`外径 ${fmt(g.od)}・${g.total}本`,title2:`${g.color}　外径 ${fmt(g.od)}／内径 ${fmt(g.bore)}　幅 ${g.widths.length}種・${g.total}本`,
   tags:g.lube?[{text:'潤滑',tone:'violet'}]:g.integ?[{text:'一体型',tone:'teal'}]:[]};
 }
 /* 被りの印は一覧の見本へ（断る＝赤の枠・近い＝橙の枠）。字は title と詳細の中が持つ。 */
 function paintMarks(){
  const hard=new Set(rs.check.hard.map(x=>x.color)),near=new Set(rs.check.near.map(x=>x.color));
  document.querySelectorAll('#masterMaintList .bk-item[data-bk-key]').forEach(b=>{
   const k=b.dataset.bkKey;
   b.classList.toggle('is-hard',hard.has(k));
   b.classList.toggle('is-near',!hard.has(k)&&near.has(k));
  });
 }

 /* ---------- カード（選んだ色） ---------- */
 function select(name){
  rs.sel=name;rs.draft=draftOf(name===NEW?null:colorOf(name));rs.check={hard:[],near:[],text:''};
  renderCard();runCheck();
  /* 新しい色は**色名の欄に焦点**（§9.529 ②「色名の欄が見つからない」——名前を付けるところから始める）。 */
  if(name===NEW){const el=document.querySelector('#masterMaintList [data-k="color"]');if(el){el.focus();el.select()}}
 }
 function renderCard(){
  renderForm();
  const box=document.getElementById('masterMaintList');if(!box||!rs.loaded)return;
  const items=rs.colors.map(itemOf);
  if(rs.sel===NEW)items.push({key:NEW,on:true,mark:swatch(rs.draft.hex,rs.draft.lube),title:rs.draft.color||'新しい色',sub:'まだ登録していません'});
  box.innerHTML=K().pane({label:'ゴムリングの色',items,empty:'まだ1色もありません。下の「＋ 色を足す」から登録してください。',
   add:'＋ 色を足す',detail:cardHtml()});
  K().wirePane(box,{onPick:async k=>{if(k!==rs.sel&&await leaveOk())select(k)},onAdd:async()=>{if(await leaveOk())select(NEW)}});
  wireCard(box);paintCheck();paintMarks();
 }
 function cardHtml(){
  const d=rs.draft;
  if(!d)return `<div class="mm-empty">${rs.colors.length?'左の一覧から色を選ぶと、その色の幅と本数が出ます。':'「＋ 色を足す」から最初の色を登録してください。'}</div>`;
  const g=colorOf(d.current),isNew=!g;
  return `<article class="bk-card rb-card${d.lube?' is-lube':''}">
   <header class="bk-card-h">${swatch(d.hex,d.lube)}<div class="bk-card-t">
    <label class="rb-name"><s>色名${isNew?'（必須）':''}</s><input type="text" data-k="color" value="${esc(d.color)}" placeholder="例: 紫" autocomplete="off"></label>
    <small>${isNew?'名前・色・外径を決めて、幅ごとの本数を入れます':`外径・内径は幅 ${g.widths.length}種 すべてで共通`}${d.integ
     ?'。<b>スペーサー一体型</b>——幅が軸の寸法になり、外周のゴムが板を押さえます（保持方式の表で「ゴムリング（スペーサー一体型）」に当たったとき使う）':''}</small></div></header>
   <div class="bk-fields">${attrsHtml(d,isNew)}</div>
   <div class="rb-check" aria-live="polite"></div>
   ${isNew?newWidthsHtml(d):widthTableHtml(g)}
   <footer class="bk-card-f">${isNew
    ?'<button type="button" class="mm-btn-primary sm" data-act="create">この色を登録する</button><button type="button" class="mm-btn-ghost sm" data-act="cancel">やめる</button>'
    :`<button type="button" class="mm-btn-primary sm" data-act="save" disabled>色名・色・外径・内径を保存（${g.widths.length}行）</button>`
     +`<span class="bk-gap"></span><button type="button" class="mm-btn-ghost sm bk-danger" data-act="delcolor">この色を消す（${g.widths.length}行）</button>`}</footer>
  </article>`;
 }
 function attrsHtml(d,isNew){
  /* 種類の顔ぶれはサーバーの`RING_KINDS`（ゴムリング／潤滑リング／スペーサー一体型・§9.531）。作るときに決める。 */
  const cur=d.lube?rs.kinds[1]:d.integ?rs.kinds[2]:rs.kinds[0];
  const kind=isNew?`<label class="bk-field"><s>種類</s><select data-k="kind">${rs.kinds.map(k=>`<option${k===cur?' selected':''}>${esc(k)}</option>`).join('')}</select></label>`:'';
  const th=num(d.od)!=null&&num(d.bore)!=null?((num(d.od)-num(d.bore))/2).toFixed(2):'—';
  return `${kind}<label class="bk-field rb-pick"><s>色</s><span><input type="color" data-k="hex" value="${esc(d.hex||'#808080')}"><code>${esc(d.hex||'（未設定）')}</code></span></label>
   <label class="bk-field"><s>外径</s><span><input type="number" data-k="od" step="0.1" min="0" value="${esc(d.od??'')}"><u>mm</u></span></label>
   <label class="bk-field"><s>内径</s><span><input type="number" data-k="bore" step="1" min="0" value="${esc(d.bore??'')}"><u>mm</u></span></label>
   <span class="bk-field is-ro"><s>肉厚（計算）</s><span><b data-k="th">${th}</b><u>mm</u></span></span>${isNew?unusedHtml():''}`;
 }
 /* まだ使っていない標準の色（外径1mmごとの周期）。押すと色・色名・外径が入る。 */
 function unusedHtml(){
  const names=new Set(rs.colors.map(g=>g.color)),ods=new Set(rs.colors.filter(g=>!g.lube).map(g=>g.od));
  const free=rs.cycle.filter(x=>!names.has(x.color)&&!ods.has(x.od));
  return free.length?`<div class="rb-free"><s>空いている標準の色</s>${free.map(x=>`<button type="button" class="rb-chip is-sm" data-free="${esc(x.color)}">${swatch(x.hex)}<b>${esc(x.color)}</b><small>${fmt(x.od)}</small></button>`).join('')}</div>`:'';
 }
 function widthTableHtml(g){
  const rows=g.widths.map(w=>`<tr data-id="${w.id}"><th>${fmt(w.width)}<u>mm</u></th>
   <td><input type="number" class="rb-q" data-f="qty" min="0" step="1" value="${esc(w.qty??'')}" aria-label="幅${fmt(w.width)}の保有本数"><u>本</u></td>
   <td><button type="button" class="bk-x" data-act="delwidth" data-id="${w.id}" title="この幅を消す" aria-label="幅${fmt(w.width)}を消す">×</button></td></tr>`).join('');
  return `<table class="bk-table"><thead><tr><th>幅</th><th>保有本数</th><th></th></tr></thead>
   <tbody>${rows}</tbody><tfoot><tr><th><input type="number" id="rbNewW" min="0" step="any" placeholder="幅"></th>
   <td><input type="number" id="rbNewQ" min="0" step="1" placeholder="本数"></td>
   <td><button type="button" class="mm-btn-ghost sm" data-act="addwidth">＋ 幅を足す</button></td></tr>
   <tr class="bk-sum"><th>合計</th><td><b>${g.total}本</b></td><td></td></tr></tfoot></table>`;
 }
 function newWidthsHtml(d){
  return `<table class="bk-table"><thead><tr><th>幅</th><th>保有本数</th><th></th></tr></thead><tbody>${
   d.widths.map((w,i)=>`<tr><th><input type="number" data-nw="${i}" data-f="width" min="0" step="any" value="${esc(w.width)}"><u>mm</u></th>
    <td><input type="number" data-nw="${i}" data-f="qty" min="0" step="1" value="${esc(w.qty)}" placeholder="0"></td>
    <td><button type="button" class="bk-x" data-act="dropnew" data-i="${i}" aria-label="この幅を外す">×</button></td></tr>`).join('')}</tbody>
   <tfoot><tr><td colspan="3"><button type="button" class="mm-btn-ghost sm" data-act="addnew">＋ 幅の行を足す</button></td></tr></tfoot></table>`;
 }

 /* ---------- 被り（サーバーへ聞く） ---------- */
 function runCheck(){
  clearTimeout(checkTimer);
  const d=rs.draft;if(!d)return;
  checkTimer=setTimeout(async()=>{
   const seq=++checkSeq;
   try{
    const r=await post('/api/bladeset/ring-colors/check',{equipment:rs.equipment,color:d.color,hex:d.hex,od:d.od,
      lube:d.lube,current:d.current});
    if(seq!==checkSeq)return;   // 古い問い合わせの答えは捨てる（打ち続けている間に届いた分）
    rs.check={hard:r.hard||[],near:r.near||[],text:r.text||''};
   }catch(e){WL.quiet.note('被りの確認に失敗（保存のときにサーバーがもう一度見る）',e)}
   paintCheck();paintMarks();
  },180);
 }
 function paintCheck(){
  const box=document.querySelector('#masterMaintList .rb-check');if(!box)return;
  const c=rs.check;
  box.innerHTML=(c.hard.length?`<p class="rb-hard">${esc(c.text)}</p>`:'')
   +(c.near.length?`<p class="rb-near">見分けにくいほど近い色があります: ${c.near.map(x=>`${swatch(x.hex)}<b>${esc(x.color)}</b>（色差 ${x.de}）`).join('・')}。現場で取り違えないか確かめてください（保存はできます）。</p>`:'')
   +(!c.hard.length&&!c.near.length&&rs.draft?'<p class="rb-ok">登録済みの色と被っていません。</p>':'');
  const save=document.querySelector('#masterMaintList [data-act="save"]');
  if(save)save.disabled=!!c.hard.length||!isDirty()||rs.busy;
  const make=document.querySelector('#masterMaintList [data-act="create"]');
  if(make)make.disabled=!!c.hard.length||rs.busy;
 }

 /* ---------- 触る ---------- */
 function wireCard(box){
  box.querySelectorAll('[data-k]').forEach(el=>{
   const k=el.dataset.k;if(k==='th')return;
   el.oninput=el.onchange=()=>{
    const d=rs.draft;
    if(k==='kind')Object.assign(d,{lube:el.value===rs.kinds[1],integ:el.value===rs.kinds[2]});
    else d[k]=el.value;
    d.touched=true;
    if(k==='hex'){const code=el.parentElement.querySelector('code');if(code)code.textContent=el.value;
     box.querySelectorAll('.bk-card-h .rb-sw,.bk-item[data-bk-key="__new"] .rb-sw').forEach(s=>{s.style.setProperty('--sw',el.value)})}
    /* 新しい色の名前は一覧の仮の項目にもその場で映す（描き直さない＝打っている欄の焦点を奪わない）。 */
    if(k==='color'){const t=box.querySelector('.bk-item[data-bk-key="__new"] b');if(t)t.textContent=el.value||'新しい色'}
    const th=box.querySelector('[data-k="th"]');
    if(th)th.textContent=num(d.od)!=null&&num(d.bore)!=null?((num(d.od)-num(d.bore))/2).toFixed(2):'—';
    paintCheck();runCheck();
   };
  });
  box.querySelectorAll('[data-free]').forEach(b=>{b.onclick=()=>{
   const x=rs.cycle.find(c=>c.color===b.dataset.free);if(!x)return;
   Object.assign(rs.draft,{color:x.color,hex:x.hex,od:x.od});renderCard();runCheck();
  }});
  box.querySelectorAll('.rb-q').forEach(el=>{el.onchange=()=>setCount(+el.closest('tr').dataset.id,el.dataset.f,el.value)});
  box.querySelectorAll('[data-nw]').forEach(el=>{el.oninput=()=>{rs.draft.widths[+el.dataset.nw][el.dataset.f]=el.value;rs.draft.touched=true}});
  box.querySelectorAll('[data-act]').forEach(b=>{b.onclick=()=>act(b.dataset.act,b)});
 }
 async function act(a,b){
  if(a==='cancel'){select((rs.colors[0]||{}).color||'');return}
  if(a==='addnew'){rs.draft.widths.push({width:'',qty:''});renderCard();return}
  if(a==='dropnew'){rs.draft.widths.splice(+b.dataset.i,1);renderCard();return}
  if(a==='save'||a==='create')return void saveColor(a==='create');
  if(a==='addwidth')return void addWidth();
  if(a==='delwidth')return void delWidth(+b.dataset.id);
  if(a==='delcolor')return void delColor();
 }
 const guarded=(fn,fail)=>K().guarded(rs,fn,fail,paintCheck);
 async function saveColor(isNew){
  const d=rs.draft;
  const ok=await guarded(async uid=>{
   const r=await post('/api/bladeset/ring-colors',{equipment:rs.equipment,color:d.color,hex:d.hex,od:d.od,bore:d.bore,
     lube:d.lube,integ:d.integ,current:isNew?'':d.current,user_id:uid,
     widths:isNew?d.widths.filter(w=>String(w.width).trim()!==''):undefined});
   showToast&&showToast(r.message||'保存しました',rs.equipment,2600);
  },isNew?'この色を登録できませんでした':'保存できませんでした');
  if(ok){rs.sel=d.color;await load(true)}
 }
 async function setCount(id,field,value){
  const ok=await guarded(async uid=>{
   await post('/api/bladeset-ring-master/update',{id,[field]:value===''?0:value,user_id:uid});
  },'本数を保存できませんでした');
  if(!ok)return void load(true);
  const g=colorOf(rs.sel),w=g&&g.widths.find(x=>x.id===id);
  if(w){w[field]=value===''?0:+value;g.total=g.widths.reduce((s,x)=>s+(+x.qty||0),0)}
  /* 描き直しても焦点は同じ欄へ（Tabで次の欄へ移った人の手を止めない）。 */
  K().keepFocus(renderCard);
 }
 async function addWidth(){
  const w=document.getElementById('rbNewW').value,q=document.getElementById('rbNewQ').value;
  if(String(w).trim()==='')return void alertModal('足す幅（mm）を入れてください。');
  const ok=await guarded(async uid=>{
   await post('/api/bladeset-ring-master',{equipment:rs.equipment,color:rs.sel,width:w,qty:q===''?0:q,user_id:uid});
  },'幅を足せませんでした');
  if(ok)await load(true);
 }
 async function delWidth(id){
  const g=colorOf(rs.sel),w=g&&g.widths.find(x=>x.id===id);if(!w)return;
  if(!await confirmModal({title:'この幅を消す',eyebrow:'ゴムリング',
    bodyHtml:`<p class="confirm-modal-message">「${esc(g.color)}」の幅 ${fmt(w.width)}mm（${w.qty||0}本）を消します。</p>`,
    confirmLabel:'消す',cancelLabel:'やめる'}))return;
  if(await guarded(async()=>{await post('/api/bladeset-ring-master/delete',{id})},'消せませんでした'))await load(true);
 }
 async function delColor(){
  const g=colorOf(rs.sel);if(!g)return;
  if(!await confirmModal({title:'この色を消す',eyebrow:'ゴムリング',
    bodyHtml:`<p class="confirm-modal-message">「${esc(g.color)}」の幅 ${g.widths.length}種（合計 ${g.total}本）をすべて消します。元に戻せません。</p>`,
    confirmLabel:'消す',cancelLabel:'やめる'}))return;
  if(await guarded(async uid=>{await post('/api/bladeset/ring-colors',{equipment:rs.equipment,current:g.color,delete:true,user_id:uid})},'消せませんでした')){
   rs.sel='';await load(true);
  }
 }
 /* 直しかけの色を捨てて離れてよいか（保存していない変更があるときだけ聞く）。 */
 const leaveOk=()=>{const d=rs.draft;return K().leave(!!d&&(d.current?isDirty():!!d.touched),'ゴムリング')};

 /* ---------- 読む ---------- */
 async function load(force){
  const box=document.getElementById('masterMaintList');if(!box)return;
  rs.loaded=false;renderForm();
  if(!await K().prologue(rs,force))return;
  await K().loading(async()=>{
   const r=await api('/api/bladeset/ring-colors?equipment='+encodeURIComponent(rs.equipment));
   Object.assign(rs,{colors:r.colors||[],cycle:r.cycle||[],kinds:r.kinds||['ゴムリング','潤滑リング','スペーサー一体型'],
                     suggest:r.suggest||null,nearDe:r.nearDe||20,loaded:true});
   if(rs.sel!==NEW&&!colorOf(rs.sel))rs.sel=(rs.colors[0]||{}).color||'';
   rs.draft=rs.sel===NEW?draftOf(null):(rs.sel?draftOf(colorOf(rs.sel)):null);
   rs.check={hard:[],near:[],text:''};
   renderCard();runCheck();
  });
 }
 WL.mm.registerSpecial('ring-board',{load});
 WL.ringBoard={state:rs,load,select};
})();
