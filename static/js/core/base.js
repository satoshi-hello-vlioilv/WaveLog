/* **このファイルは閉じている**（§9.359・REVIEW 3-17）——外へ出す面は末尾の
   2つだけ。①みんなが使う土台（`$`・`esc`・`S`・`api`…）は**素のグローバル
   のまま明示的に公開**する（`WL.base.$()` と書き換えると2,000箇所以上が
   読みにくくなるだけで、得るものが無い）。②それ以外は `WL.base` に載せる。
   ここに載せていない名前は、このファイルの中だけのもの。 */
(function(){
"use strict";
/* base.js: 共有基盤 — グローバル状態(S)・API呼び出し・共通ユーティリティ・
   フィールド別名(aliases)・端末設定(使用設備/ユーザーID)。
   読込順の先頭に置き、画面固有の処理はここへ置かない。 */
const LENGTH_SLOTS=12;const $=s=>document.querySelector(s);
/* グローバル状態 S。**鍵はここだけが決める**（§9.327、REVIEW 3-8）——
   `Object.seal` で後付けを断っているので、別のファイルで宣言に無い鍵へ書くと
   （strict の関数の中では）その場で TypeError になる。綴りを間違えても
   静かに新しい鍵ができない。鍵を足すときはここへ1行足し、誰が書くかを添える。
   見張りは tests/test_globallint.py（使っている鍵が全部ここに載っているか）。 */
const S={
  db:null,table:null,             /* いま開いている一覧（list-view.js が書く） */
  catalog:[],tables:[],           /* /api/catalog の答え（list-view.js） */
  columns:[],rows:[],page:1,count:0,  /* いま出している表（list-view.js。テストも書く） */
  joinQuality:null,               /* 品質データ結合の内訳（list-view.js。列の設定パネルが読む） */
  selectedRow:null,               /* 一覧で選んでいる1行（list-view.js） */
  selectedRows:new Set(),         /* まとめて選んだ行（予定投入・§9.5） */
  t:null,                         /* 検索欄の debounce タイマー（list-view.js） */
  current:null,                   /* 測定を開いている元の行（records-store.js） */
  measure:null,                   /* 測定レコードそのもの（records-store.js。測定系が読む） */
  measureContextError:'',         /* 参照データが読めなかった理由（§9.317。records-store.js） */
  genericFilters:[],              /* いま効いている絞り込み条件（filters.js） */
  filterPresets:[],               /* 登録フィルタ（filters.js） */
  filterPresetSource:'local',     /* 登録フィルタの出どころ master/local（filters.js） */
  filterCondUsage:{},             /* 条件の利用回数（filters.js） */
};
Object.seal(S);
/* ---------- 黙らない（§9.328、REVIEW 3-4） ----------
   中身の無い catch と、何もしない捨て手を渡した catch は**何が起きても誰にも
   見えない**。§9.190で「捨て手が403を握り潰し、鍵が外れる不具合に誰も気づけ
   なかった」が既に起きている。捨てること自体は正しい場面が多いので禁じないが、
   **なぜ捨ててよいのかを書く**のを構造として要求する。

     try{ ... }catch(e){ WL.quiet.note('端末の覚えが読めない（既定で続ける）',e) }
     fetch(...).catch(WL.quiet('取れなくても画面は出る'))

   出すのは`console.debug`（ふだんのコンソールを埋めない）。直近200件は
   `WL.quiet.log()`で読めるので、実機で「何かが静かに落ちている」ときの
   手掛かりになる。見張りは`tests/test_quietlint.py`。 */
window.WL=window.WL||{};
WL.quiet=(function(){
 const LOG=[];let n=0;
 const note=(why,err)=>{
  n++;
  const rec={why:String(why||''),err:err?(err.message||String(err)):'',at:Date.now()};
  LOG.push(rec);if(LOG.length>200)LOG.shift();
  /* ここを try で包まない——包むとこの関数自身が「黙る場所」になる。
     `console.debug`はどのブラウザにも在る。 */
  if(typeof console!=='undefined'&&console.debug)console.debug('見送り:',rec.why,err||'');
  return undefined;
 };
 /* `WL.quiet('理由')` は捨て手（`.catch()`へそのまま渡せる関数）を返す。 */
 const f=why=>(err=>note(why,err));
 f.note=note;
 f.count=()=>n;
 f.last=()=>LOG.length?LOG[LOG.length-1]:null;
 f.log=()=>LOG.slice();
 return f;
})();
/* エラー時、応答JSONの残りのフィールド(code等)をErrorオブジェクトへ
   そのまま乗せる(呼び出し側がe.messageだけでなくe.codeでも分岐できるように
   するため)。既存の呼び出し元はe.messageしか見ていないため、これを追加
   しても挙動は変わらない。 */
/* ---------- 応答がJSONでないときの言い直し(§9.200) ----------
   サーバーが返すHTML(Flaskの404/500ページ)をそのまま`Error.message`へ
   入れていたため、**トーストに`<!doctype html> ... 404 Not Found`が
   丸ごと出ていた**（実機で報告）。読む側に要るのは「何が起きたか」と
   「次に何をすればよいか」なので、状態コードから言い直す。
   生の本文は`err.body`へ残す（診断に要るのは開発時だけ）。 */
/* 開き直し方は**この1箇所**（§9.548: 起動はデスクトップ版だけ・stop.bat は無い）。 */
WL.RESTART_HOW='アプリを終了してから（窓を閉じる）、起動アイコン（Start.vbs）で開き直してください。';
const HTTP_HINT={
 404:'サーバーにこの機能がありません。アプリを更新したあと開き直していない可能性があります（'+WL.RESTART_HOW+'）',
 405:'この操作をサーバーが受け付けませんでした（この画面のモードでは使えない操作かもしれません）。',
 401:'権限がありません。',403:'権限がありません（このモードでは変更できません）。',
 409:'ほかの端末が同時に変更しました。もう一度お試しください。',
 423:'ほかの端末が編集中です。しばらくしてからお試しください。',
 500:'サーバー側でエラーが起きました。ログ（ログビュワー）に理由が出ています。',
 502:'サーバーへ届きませんでした。',503:'サーバーが応答できませんでした。しばらくしてからお試しください。',
};
const apiErrorMessage=(status,text,url)=>{
 const hint=HTTP_HINT[status]||`サーバーがエラーを返しました（HTTP ${status}）。`;
 return `${hint}（${String(url||'').split('?')[0]}）`;
};
/* 遅い書き込みには「保存しています…」を出す（§9.273、利用者の指示
   「共有へ保存しているときに、少しタイムラグがあるので保存していますという
   メッセージが欲しいです。保存しましたというメッセージが出るまで6秒くらい
   待たされます」）。共有のマスタへ保存するときは書込サイクル（ロック→
   取り直し→押し出し・§9.263）を通るので、実機で数秒かかる。そのあいだ画面が
   無反応だと「効いていない」と読まれ、もう一度押されることになる。

   **500ms待ってから出す**——手元に置いている端末の保存は一瞬で終わるので、
   出すと光って消えるだけになる。
   **読むだけのPOSTには出さない**（`quiet:true`）。どのPOSTが読みだけかは
   サーバーの`_READ_ONLY_POST_ENDPOINTS`が正で、**呼ぶ側がその印を付ける**
   （知っているのは呼ぶ側）。付け忘れは`tests/test_savechip.py`が数える。 */
const SAVE_CHIP_DELAY_MS=500;
const api=async(u,o)=>{
 const opt={...(o||{})};
 const quiet=opt.quiet===true;delete opt.quiet;
 const watching=String(opt.method||'GET').toUpperCase()!=='GET'&&!quiet;
 let armed=false;
 /* `saveState`はこの下で宣言されるので**名前空間経由で触る**（宣言前に
    素の名前を読むと ReferenceError になる）。 */
 const chip=()=>(window.WL&&window.WL.saveState)||null;
 const timer=watching?setTimeout(()=>{const c=chip();armed=!!(c&&c.autoBegin())},SAVE_CHIP_DELAY_MS):0;
 const settle=ok=>{clearTimeout(timer);if(armed){const c=chip();if(c)c.autoEnd(ok)}};
 let r;
 try{r=await fetch(u,{cache:'no-store',...opt})}
 catch(error){settle(false);throw Error('アプリの中身（Python）と話せません。終了している可能性があります（'+WL.RESTART_HOW+'）詳細: '+(error?.message||String(error)))}
 const text=await r.text();let j={},parsed=false;
 try{if(text){j=JSON.parse(text);parsed=true}}catch(_){j={}}
 if(!r.ok){
  settle(false);
  const err=Error((parsed&&j.error)||apiErrorMessage(r.status,text,u));
  if(parsed)Object.assign(err,j);err.status=r.status;err.body=String(text||'').slice(0,500);throw err}
 settle(true);
 return j},
/* ---------- HTMLへ埋める前の逃がし（§9.276 ⑤、利用者の報告） ----------
   「帳票ブロックのカスタムで表で組み替えて保存したらその瞬間はきれいに
    保存されますが、再度読み込むと『表に組む』というボタンが押せなく
    なっていたり」

   以前は`textContent`→`innerHTML`に任せていたが、**ブラウザのその直列化は
   `&` `<` `>`しか逃がさない**（引用符は文字節点では意味を持たないため）。
   ところがこの関数の使い道の大半は`value="${esc(v)}"`／`title="${esc(v)}"`
   ——**属性**なので、値に`"`が1つでもあるとそこで属性が閉じ、**残りが黙って
   消える**。帳票ブロックのセル（§9.274）は`[{"label":...`というJSONなので、
   保存値が`[{`まで切り詰められ、開き直すと中身が丸ごと失われていた
   （そのまま保存すると**マスタの中身まで壊れる**）。
   属性にも中身にも使える1つの関数にする——`&quot;`／`&#39;`は文字として
   出るので、中身に使ったときの見え方は1文字も変わらない。 */
esc=v=>String(v??'').replace(/[&<>"']/g,c=>(
  {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* ---------- 説明文の印は1箇所で解く（§9.286 ⑦、利用者の報告） ----------
   「更新履歴の<b>みたいなタグが出ているので修正をお願いします」

   `esc()`を通した文字列に**印だけ**を戻す。**必ずエスケープしてから**印を
   置き換えること（§9.222 ⑧）——順番が逆だと、マスタや更新履歴へ書いた
   文字列の中のHTMLがそのまま効く。
   印は2つだけ: `**強調**`→`<b>` と バッククォート囲み→`<code>`。
   **生のHTMLタグを説明文へ書かないこと**（§9.276 ④）——`esc()`で字のまま
   画面に出る。更新履歴は186個の`<b>`が字のまま並んでいた（実機で報告）。
   見張りは`tests/test_hintlint.py`（マスタの説明文）と
   `tests/test_changelog.py`（更新履歴）。 */
window.WL=window.WL||{};
WL.markup=t=>esc(t)
  .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')
  .replace(/`([^`]+)`/g,'<code>$1</code>');
const aliases={lotNo:['ロット番号','ﾛｯﾄ番号','LTNO'],inspectionNo:['検査番号','KNNO'],orderNo:['オーダー番号','JUON','JUNO'],castingNo:['鋳造番号','CYNO'],allocationNo:['引当番号','HKNO'],orderMaterial:['オーダー材質','JUA'],orderTemper:['オーダー調質','JUB'],orderThickness:['オーダー板厚','JUX'],orderWidth:['オーダー板幅','JUY'],orderLength:['オーダー板丈','JUZ'],mfgMaterial:['製造材質','LTA'],mfgTemper:['製造調質','LTB'],mfgThickness:['製造板厚','LTX'],mfgWidth:['製造板幅','LTY'],mfgLength:['製造板丈','LTZ'],purposeCode:['用途コード','用途ｺｰﾄﾞ','YOTOC'],purposeName:['用途名','YOTON'],customer:['取引先','TOKUNA'],delivery:['納入先','NONNA'],designCourse:['設計_設備ｺｰｽ','設計_設備コース'],course:['実績_設備ｺｰｽ','実績_設備コース','実績コース'],residualCourse:['残仕掛設備ｺｰｽ','残仕掛設備コース','ZANMC'],equipment:['BOX設計_設備名','設備'],originalWidth:['BOX実績_板幅'],boxHorizontalCount:['BOX設計_横割数'],boxVerticalCount:['BOX設計_縦割数']};
function pick(row,key){for(const n of aliases[key]||[])if(row[n]!==undefined&&row[n]!==null)return String(row[n]);return ''}
function lotKey(r){return [pick(r,'equipment'),pick(r,'lotNo'),pick(r,'inspectionNo'),pick(r,'castingNo')].join('|')}
/* 基本情報タブの寸法表示整形。板厚=小数2桁 / 板幅・板丈=小数1桁。数値でない・空欄はそのまま。 */
function fmtDim(value,digits){const raw=String(value??'').trim();if(raw==='')return '';const n=Number(raw);return Number.isFinite(n)?n.toFixed(digits):raw}
/* ロット№クリックでLotDsp検索サイトをロット番号指定で開く。
   linkkeyは「7文字固定幅のロット番号 + 半角スペース3つ + 7文字固定幅の
   鋳造番号」という構成(実機のURLから確認)。
   別オリジンのためフォームへの直接書き込みはできないが、この形式で
   URLを開けば相手側アプリがlinkkeyを読み取って検索まで行う。念のため
   ロット番号はクリップボードにもコピーしておく(自動遷移が効かない
   場合の手動貼り付け用フォールバック)。 */
const LOT_DSP_BASE='http://nlmfangyweb1a/LotDspWeb/#/lotdsp';
function lotDspField(v){return String(v||'').slice(0,7).padEnd(7,' ')}
function lotDspLinkKey(lotNo,castingNo){return lotDspField(lotNo)+'   '+lotDspField(castingNo)}
function buildLotDspUrl(lotNo,castingNo,tab){return `${LOT_DSP_BASE}?linkkey=${encodeURIComponent(lotDspLinkKey(lotNo,castingNo))}&tab=${encodeURIComponent(tab)}`}
function copyText(text){
 if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(text).catch(()=>copyTextFallback(text));
 copyTextFallback(text);return Promise.resolve();
}
function copyTextFallback(text){
 const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.focus();ta.select();
 try{document.execCommand('copy')}catch(_){WL.quiet.note('この環境ではコピーできない（手で選んで写せる）',_)}
 document.body.removeChild(ta);
}
function openLotDsp(lotNo,castingNo,tab){
 if(!lotNo){showToast('ロット番号が未設定です','LotDspへは移動できません');return}
 window.open(buildLotDspUrl(lotNo,castingNo,tab),'_blank','noopener');
 copyText(lotNo);
}
/* ロット問い合わせの入口（ロットを指定しない）。使用設備の設定③が「ブラウザで開いて確かめる」に使う（§9.550）。
   窓の中で開いた外のページは、窓（desktop/src/main.rs の open_outside）が PC の既定のブラウザへ渡す。 */
function openLotDspHome(){window.open(LOT_DSP_BASE,'_blank','noopener')}
/* デスクトップ版の窓（WebView2）の中か。**答えるのはここだけ**（§9.550）。窓は画面を
   http://wavelog.localhost/（Windows 以外は wavelog://localhost/）に置く——desktop/src/main.rs の app_base と同じ。
   開発と網の HTTP の入口（127.0.0.1）は窓ではない。窓の中では Edge の拡張（LotData-Link）が動かない。 */
function inDesktopShell(){return location.hostname==='wavelog.localhost'||location.protocol==='wavelog:'}
/* 行の中に置くLotDspの的（§9.460）が名乗る属性。**的が自分のロットを名乗る**
   （`data-lot-dsp`／`data-cast`）ので、押したときの道は下の1本で済む——行ごとに配線しない。
   的の形（字そのもの／横の小さな的）は置く画面が決める。 */
function lotDspAttrs(lotNo,castingNo){
 return ` data-lot-dsp="${esc(lotNo)}" data-cast="${esc(castingNo||'')}"`
  +` title="${esc(lotNo)} ／ クリックでロット問い合わせ（LotDsp）をこのロット番号で開きます"`;
}
document.addEventListener('click',e=>{
 const link=e.target.closest('.lot-dsp-link,[data-lot-dsp]');if(!link)return;
 /* 名乗っている的はそのロット、名乗らないボタン（測定画面の見出し）は測定中のロット。 */
 if(link.dataset.lotDsp!==undefined){openLotDsp(link.dataset.lotDsp,link.dataset.cast,WL.lotDspTab.get());return}
 openLotDsp(S.measure?.basic?.lotNo,S.measure?.basic?.castingNo,WL.lotDspTab.get());
});
/* 段階的開示(.disclosure)の共通トグル。品質データ分析(qa-acc)で確立した
   見た目を条割パネル・母材パネル等でも同じ言語で使うための汎用部品
   (app.cssの.disclosure系クラス参照)。動的に再描画される領域(条割の
   履歴セクション等)にも効くよう、常時デリゲートで拾う。 */
document.addEventListener('click',e=>{
 const head=e.target.closest('.disclosure-head');if(!head)return;
 head.closest('.disclosure')?.classList.toggle('open');
});
/* タブ番号は測定画面には出さず、使用設備の設定モーダルの中で切り替える。
   ロット№欄の見た目・サイズは常に元のまま。既定値はTab1(実機URLの例に合わせる)。

   **ここで`getElementById`しないこと**（§9.257 ②）。以前は読み込み時に
   1度だけ`#lotDspTabSetting`を探すIIFEだったが、モーダルの中身は
   `records-store.js`が**あとから**組み立てる（同じ作りを2つ持たないため・
   §9.163）ので、その時点では欄がまだ無い＝**選んでも保存されない**。
   欄を作った側から`WL.lotDspTab.bind()`を呼ぶ。 */
window.WL=window.WL||{};
WL.lotDspTab={
 KEY:'LotDspLastTabV1',
 /* タブの顔ぶれ（§9.511、利用者の指示「Tab0：ICAS情報みたいな感じで補助として」）。
    番号だけだと**どの画面が開くか思い出させる**ことになる——LotDsp の画面に
    並んでいる名前をそのまま添える。番号（`n`）はURLへ渡す値なので変えない。
    顔ぶれはこの1箇所（選択肢も字もここから作る）。 */
 TABS:[[0,'ICAS情報'],[1,'進度情報'],[2,'製造情報'],[3,'試験情報'],
       [4,'品質情報'],[5,'クラッド情報'],[6,'焼鈍情報'],[7,'引当情報']],
 label(n){const t=WL.lotDspTab.TABS.find(x=>String(x[0])===String(n));return `Tab ${n}`+(t?`：${t[1]}`:'')},
 optionsHtml(){return WL.lotDspTab.TABS.map(([n])=>`<option value="${n}">${WL.lotDspTab.label(n)}</option>`).join('')},
 get(){return localStorage.getItem(WL.lotDspTab.KEY)||'1'},
 /* **選んだらすぐ効く**（保存ボタンを待たない）。窓の中でそう名乗っている。 */
 bind(sel){
  if(!sel){console.error('LotDspのタブ: 欄が見つかりません');return}
  sel.value=WL.lotDspTab.get();
  sel.onchange=()=>localStorage.setItem(WL.lotDspTab.KEY,sel.value);
 }
};
function setState(x){$('#localState').textContent=x}
/* 保存されていない変更があるかどうかを追跡する。×ボタン/背景クリックで
   閉じようとした際、破棄してよいか確認するために使う。WL.measureView.renderMeasurement()
   でデータを新規に読み込んだ時と、保存が成功した時にリセットする。 */
let measureDirty=false;
/* **触った回数**（§9.320-G の追補、§9.312と同じ数え方）。旗（`measureDirty`）
   だけだと、**裏の保存が往復しているあいだに打った1文字**と、保存の始まりに
   立っていた旗とが同じものになる——往復から戻った側が旗を下ろし、
   バッジが「DBへ保存済み」と言ってしまう（**画面が嘘をつく**・§CLAUDE 6）。
   **控えた回数と違っていたら、旗を下ろさない・保存済みとも言わない**。

   **値そのものは落ちない**（実測で確かめた。推測で書かない）——`WL.measureView.collect()`が
   返す写しは測定値の配列を**実体で共有**しており、`WL.records.backupAndTrackSync()`が
   `finally`でもう一度`WL.records.reliablePut(m)`するので、往復中の1文字もその書き込みに
   乗る。ここで直しているのは**バッジの文言**（未保存のものを保存済みと
   言わない）で、`WL.measureView.collect()`を深い写しへ変えるならこの前提も変わる。 */
let measureEditSeq=0;
/* **どこに在るのかまで書く**(§9.202、利用者の報告「入力しただけでは
   完了に反映されない」)。「未保存」だけだと、打った値がもう端末に
   入っていると読める。実際は保存を押すまで画面の中にしか無い。 */
/* **変わったら裏でDBへ書く**（§9.320-G、利用者の指示）。ここは値を書く
   合図を出すだけで、実処理は`records-store.js`が持つ（`WL.measureView.collect()`も
   `WL.records.reliablePut()`もあちらのもの）。**「あれば呼ぶ」で黙らせない**
   ——公開漏れは静かに機能だけを失うので、無ければ理由を出す（§CLAUDE）。 */
function markDirty(){
 measureDirty=true;measureEditSeq++;setState('未保存（画面の中だけ）');
 if(window.WL&&WL.autoSave)WL.autoSave.schedule();
 else console.error('WL.autoSave が見つかりません（DBへの自動保存が動きません）');
 WL.measureHooks.run('afterDirty');
}
/* ---------- 登録表（§9.348・§9.352・REVIEW 3-16） ----------
   「描いたあとに足す」「前で断る」「丸ごと持つ」を、`const base=fn; fn=function(){…base()…}`
   の被せで書かない。被せは読み込み順が答えの順になり、引数を1つ落とすと根まで届かない
   （実際に起きた・§9.125）。ここは土台（core）に置く——測定画面のファイルより先に読まれ、
   `markDirty` のように土台の関数からも呼べる。
     on(name,fn)             … あとに足す。登録順に走り、1つが転んでも残りは走る（fail-open）
     gate(name,fn,{priority})… 前で断る／引数を差し替える。false を返すと呼び出しは何もしない、
                               配列を返すとそれが次の引数、undefined なら次へ。priority の大きい順
     own(name,fn)            … 丸ごと持つ（1つだけ）。核は owner が居ればそれを呼び、居なければ自分の体
   名前は呼ぶ側（核）が決め、呼ぶ側の 1 箇所にだけ書く。 */
const HOOKS={},OWNERS={};
function hookList(name){return HOOKS[name]||(HOOKS[name]=[])}
WL.measureHooks={
 on(name,fn){if(typeof fn==='function')hookList(name).push({fn,priority:0})},
 afterRender(fn){WL.measureHooks.on('afterRender',fn)},
 afterHeading(fn){WL.measureHooks.on('afterHeading',fn)},
 gate(name,fn,opt){if(typeof fn!=='function')return;const l=hookList(name);l.push({fn,priority:Number(opt&&opt.priority)||0});l.sort((a,b)=>b.priority-a.priority)},
 /* `null` を渡すと返上する。**返上できない登録表は後始末ができない**——
    差し替えたまま次へ漏れる（§9.121）。 */
 own(name,fn){if(typeof fn==='function')OWNERS[name]=fn;else if(fn===null)delete OWNERS[name]},
 owner(name){return OWNERS[name]||null},
 run(name,...args){hookList(name).forEach(h=>{try{h.fn(...args)}catch(e){console.error('フック '+name+' で例外',e)}})},
 async runAsync(name,...args){for(const h of hookList(name)){try{await h.fn(...args)}catch(e){console.error('フック '+name+' で例外',e)}}},
 /* 関門。例外は呼び出し元へそのまま伝える（被せのときと同じ）。 */
 async through(name,...args){for(const h of hookList(name)){const r=await h.fn(...args);if(r===false)return false;if(r!==undefined)args=Array.isArray(r)?r:[r]}return args},
 count(){const o={};Object.keys(HOOKS).forEach(k=>{o[k]=HOOKS[k].length});Object.keys(OWNERS).forEach(k=>{o['own:'+k]=1});return o},
};
/* サイドバーの選択状態。トップレベルの行き先(データ一覧・仕掛・品質データ・
   マスタ一覧・ダッシュボード・実績カレンダー)は排他で、常にどれか1つだけが
   選択中になる。以前は行き先ごとに自分の.activeを付け外ししていたため、
   データ一覧だけ選択状態にならず「今どこにいるか」が分からなかった。
   keyはボタンのid、またはDB一覧ボタンのdata-db-key。 */
function setActiveNav(key){
 document.querySelectorAll('aside .nav-item').forEach(b=>
  b.classList.toggle('active',!!key&&(b.id===key||b.dataset.dbKey===key)));
}
function bindTabs(group,panel){document.querySelectorAll(`[data-${group}tab]`).forEach(btn=>btn.onclick=()=>{document.querySelectorAll(`[data-${group}tab]`).forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll(`[data-${group}panel]`).forEach(x=>x.hidden=x.dataset[group+'panel']!==btn.dataset[group+'tab'])})}
/* ---------- よく使う選択肢を上へ(§9.133) ----------
   準備の入力欄(オペレータ・検査員・測定器)は選択肢がマスタ由来で増え続ける
   ——実データのオペレータは171人。五十音順のままだと「いつもの人」を毎回
   探すことになるので、**設備ごとの使用回数の多い順**に並べ替える。
   回数は`/api/measurement/context`が一緒に返す(選択肢と同時に要るので、
   別のAPIにすると「選択肢は出たが並びは前のまま」の瞬間ができる)。
   **同数のときはマスタの並び順を保つ**(五十音順が崩れて見えないように)。
   使ったことのないものは下だが、消えはしない。 */
window.WL=window.WL||{};   /* この位置でも使えるように(定義は後方にもある) */
WL.choiceUsage={
 counts:{},
 set(map){this.counts=(map&&typeof map==='object')?map:{}},
 order(field,items){
  const c=this.counts[field];
  const list=[...(items||[])];
  if(!c)return list;
  return list.map((v,i)=>({v,i,n:Number(c[v])||0}))
             .sort((a,b)=>(b.n-a.n)||(a.i-b.i)).map(x=>x.v);
 },
 /* 選ばれた瞬間に数える。**画面は結果を待たない**(数が1つ増えないだけ)。 */
 bump(equipment,field,value){
  if(!equipment||!field||!value||value==='-')return;
  const c=this.counts[field]||(this.counts[field]={});
  c[value]=(Number(c[value])||0)+1;
  try{
   fetch('/api/measurement/choice-usage',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({equipment,picks:{[field]:value},user_id:(window.currentUserId||'')})}).catch(WL.quiet('選択肢の使用回数を送れない（並び順の材料が増えないだけ）'));
  }catch(e){WL.quiet.note('選択肢の使用回数を送れない（並び順の材料が増えないだけ）',e)}
 },
};
/* ---------- 「選ばない」は札であって値ではない（§9.286 ⑤、利用者の指示） ----------
   「初期値を`-`でハードコーディングしているものが残っており…初期値も含めて
    汎用化対応しているので、ハードコーディング部分を除去してきれいに
    汎用部品のみで対応できるようにしてください」

   以前は先頭に`<option>-</option>`を置き、**値としても`-`**を持たせていた。
   そのため記録に`operator:'-'`が入り、`applyInitials()`（マスタの`[初期値]`を
   入れる仕組み）が見る「まだ何も選ばれていない」の判定を**画面の側が
   先に埋めてしまって**いた——マスタで初期値を決めても効かない。
   いまは**値は空文字**で、`-`は札の字だけ。**古い記録の`-`は空として読む**
   （`OPTION_BLANK_VALUES`）ので、開き直しても選択が消えない。
   札を出すかどうかは`[空欄なし]`が決める（§9.246 ①。`applyBlankPolicy`）。 */
/* 「選ばない」の札の**字**（§9.287-I、利用者の報告「オペレータは初期値
   未入力のとき『-』が出っぱなし。オペレータ2は正しく初期値を持っている」）。
   §9.286 ⑤で**値**としての`-`は外したが、**字**は組み込みの欄（`optionFill()`）
   が`-`、汎用の欄（`measure-opdata.js`）が空、器の浮き窓が`（選ばない）`と
   **3通りに分かれたまま**だった。同じ「選んでいない」がその欄の作られ方で
   別の顔になる（§CLAUDE 8）。**綴りはここ1箇所**——写さずにここを引く。 */
const OPTION_BLANK_LABEL='（選ばない）';
const OPTION_BLANK_VALUES=['','-'];
function optionBlank(v){return OPTION_BLANK_VALUES.includes(String(v??'').trim())}
window.WL=window.WL||{};WL.optionBlank=optionBlank;   /* 新しい公開は名前空間へ */
WL.optionBlankLabel=OPTION_BLANK_LABEL;
/* 選択肢を入れたあとに足す（選んだ札の見え方）は `afterOptionFill`（§9.352）。 */
function optionFill(id,items,current=''){optionFillCore(id,items,current);WL.measureHooks.run('afterOptionFill',id)}
function optionFillCore(id,items,current=''){
 const el=$('#'+id);if(!el)return;
 const vals=WL.choiceUsage.order(id,[...new Set(items||[])]).filter(v=>!optionBlank(v));
 el.innerHTML=`<option value="">${esc(OPTION_BLANK_LABEL)}</option>`
   +vals.map(v=>`<option>${esc(v)}</option>`).join('');
 el.value=optionBlank(current)?'':(vals.includes(current)?current:'');
}
/* optionFillの「先頭に'-'(未選択)を足す」をしない版。バリ揃え・コイル止めの
   ように「指定なし」という選択肢そのものがマスタ側にある項目で使う
   ('-'と「指定なし」が並ぶと、どちらを選べばよいのか分からなくなる)。
   選択中の値が候補に無い場合(マスタから消された等)は、値を失わないよう
   先頭へ残す。 */
function optionList(id,items,current=''){
 const el=$('#'+id);if(!el)return;
 const vals=[...new Set(items||[])].filter(v=>String(v).trim()!=='');
 const cur=String(current??'').trim();
 if(cur&&!vals.includes(cur))vals.unshift(cur);
 el.innerHTML=vals.map(v=>`<option>${esc(v)}</option>`).join('');
 if(vals.includes(cur))el.value=cur;
}
function qualityText(items){if(!items?.length)return '異常情報なし';return items.slice(0,4).map((q,i)=>`(${i+1}) ${q['発生設備']||''} ${q['登録日時']||''} ${q['異常内容']||''}\nコメント：${q['コメント']||''}\n最終処置：${q['最終処置']||''}\n保留設定日：${q['保留設定日']||''}　保留解除日：${q['保留解除']||''}`).join('\n\n')}
function widthSequence(max,order,dir){let a=Array.from({length:max},(_,i)=>i);if(order==='奇数条優先')a=[...a.filter(i=>i%2===0),...a.filter(i=>i%2===1)];if(order==='偶数条優先')a=[...a.filter(i=>i%2===1),...a.filter(i=>i%2===0)];if(dir==='降順')a=a.reverse();return a}
function lengthIndex(){const el=$('#lengthPos');if(!el)return 0;const opts=[...el.options],idx=opts.findIndex(o=>o.value===el.value);return Math.max(0,Math.min(LENGTH_SLOTS-1,idx>=0?idx:0))}
/* 自動転送中に、日本語IME等の影響で数字・記号が全角へ変換され、Tabまでの
   間に解析不能な文字列になる不具合への対策。全角英数記号(U+FF01-FF5E)と
   全角スペースを半角へ強制変換する。自動転送(auto)時のみ適用し、
   手動入力(manual)時は自由に入力できるよう変換しない。 */
function toHalfWidth(str){return String(str??'').replace(/[！-～]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0xFEE0)).replace(/　/g,' ')}
/* ---------- 手で打つ数値欄（§9.208 ③、利用者の指示） ----------
   測定の手入力で実機から挙がった3つを1箇所で引き受ける。

   ① **マイナスは受け付けない。** 板厚・板幅・長さ・肉厚・ピッチ・オフセットは
      どれも寸法（大きさ）で、負の値は現実に存在しない。打てるのに保存だけ
      できないより、**打てないほうが早く分かる**（§4）。
   ② **「.5」の省略打ちを「0.5」として受ける。** `input[type=number]`の
      「妥当な浮動小数点数」には**小数点の前の桁が要る**ので、`.5`と打つと
      `el.value`は**空文字になり、打った値が黙って消える**。しかも
      `value='0.'`を代入しても同じ規則で空へ落ちるため、type=numberのままでは
      途中の状態すら作れない。**`type="text"`＋`inputmode="decimal"`**にして
      自前で見張るのが唯一の直し方（スピナーは失うが、測定値に上下ボタンは
      要らない）。
   ③ **全角で打っても通す。** 現場の端末はIMEが載っていることがある。

   `type`を変えるので、幅の見積り（`measure-steps.js`の`needWidth`）が
   「8文字ぶんの日本語」へ倒れないよう`numeric-input`を目印に残す。 */
const NUMERIC_INPUT_ATTR='data-numeric-bound';
function normalizeDecimalText(raw,{allowTrailingDot=true}={}){
 let v=toHalfWidth(String(raw??'')).replace(/[^0-9.]/g,'');
 const at=v.indexOf('.');
 if(at>=0)v=v.slice(0,at+1)+v.slice(at+1).replace(/\./g,'');
 if(!allowTrailingDot){
  if(v==='.')return '';
  if(v.startsWith('.'))v='0'+v;
  if(v.endsWith('.'))v=v.slice(0,-1);
 }
 return v;
}
function attachNumericInput(el){
 if(!el||el.getAttribute(NUMERIC_INPUT_ATTR))return;
 el.setAttribute(NUMERIC_INPUT_ATTR,'1');
 if(el.type==='number'){el.type='text';el.removeAttribute('step')}
 el.inputMode='decimal';
 el.autocomplete='off';
 el.classList.add('numeric-input');
 /* 打っている最中は末尾の小数点を残す（`0.`を消すと次の桁が打てない）。
    整えるのは**離れたとき**——`.5`→`0.5`、`5.`→`5`。 */
 el.addEventListener('input',()=>{
  const v=normalizeDecimalText(el.value);
  if(v!==el.value){
   const back=el.value.length-el.selectionEnd;
   el.value=v;
   try{const at=Math.max(0,v.length-back);el.setSelectionRange(at,at)}catch(e){WL.quiet.note('カーソル位置を戻せない（値は入っている）',e)}
  }
 });
 el.addEventListener('blur',()=>{
  const v=normalizeDecimalText(el.value,{allowTrailingDot:false});
  if(v===el.value)return;
  el.value=v;
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
 });
}
window.WL=window.WL||{};
WL.numericInput={attach:attachNumericInput,normalize:normalizeDecimalText};
function normalizedLot(value){return String(value||'').normalize('NFKC').replace(/[\s　_-]/g,'').toUpperCase()}
/* 画面右下に一時通知(トースト)を表示する。 */
/* `action`＝{label,run} を渡すと、知らせの中に**その場で押せる1手**が付く
   （§9.373）。失敗を知らせるだけでは、利用者は「で、どうすれば」に答えを
   持たない——**次にすることを1つだけ指す**（§CLAUDE 画面基準2）。
   押したら知らせは閉じる（押したのに残ると、効いたのか分からない）。 */
function showToast(title, detail='', duration=3400, action=null){
 const area=$('#toastArea'); if(!area)return;
 const item=document.createElement('div'); item.className='toast';
 item.innerHTML=`<b>${esc(title)}</b>${detail?`<small>${esc(detail)}</small>`:''}`
  +(action&&action.label?`<button type="button" class="toast-act">${esc(action.label)}</button>`:'');
 const close=()=>{item.classList.add('out');setTimeout(()=>item.remove(),220)};
 if(action&&action.label){
  const btn=item.querySelector('.toast-act');
  if(btn)btn.onclick=()=>{close();try{action.run&&action.run()}
    catch(e){WL.quiet.note('知らせの中の操作が失敗した（知らせ自体は閉じる）',e)}};
 }
 area.append(item); setTimeout(close,duration);
}
/* ---------- モーダルの閉じ方は1つの規則(§9.221 ①) ----------
   利用者の指示「選択肢の値マスタのモーダル外クリックした瞬間にモーダルが
   閉じないようにしてください。編集中の内容が瞬時に消えてしまうことが
   問題です。類似の事象がないかモーダル関係はすべてチェックしてください」。

   **背景クリックではどのモーダルも閉じない。** 「入力欄を持つものだけ
   閉じない」にすると、どれが閉じてどれが閉じないかを利用者が覚えることに
   なる（探させず・思い出させず・推測させず、に反する）。閉じる場所は
   ×／キャンセル／Esc の3つで、位置はどのモーダルでも同じ。

   代わりに**押したことは必ず返す**——黙って何も起きないのは「固まった」と
   区別が付かない。器を一度だけ弾ませ、×に「ここで閉じます」を出す。

   **Escは「変換中」を除く**（`isComposing`）。日本語入力では変換を取り消す
   のにEscを打つので、変換中のEscでモーダルごと閉じると、背景クリックと
   まったく同じ壊れ方が**キーボードだけで**起きる。 */
function modalDialogOf(modal){
 return modal.querySelector('[role="dialog"]')||modal.firstElementChild;
}
function nudgeModal(modal){
 const dlg=modalDialogOf(modal);if(!dlg)return;
 dlg.classList.remove('wl-modal-nudge');
 void dlg.offsetWidth;                       /* 連打でも毎回動かすため巻き戻す */
 dlg.classList.add('wl-modal-nudge');
 clearTimeout(dlg._wlNudgeTimer);
 dlg._wlNudgeTimer=setTimeout(()=>dlg.classList.remove('wl-modal-nudge'),460);
 /* **必ず文字で返す**（§CLAUDE 3。状態を色や動きだけで伝えない）。
    閉じるボタンの目印は器ごとにまちまちなので、名前・題・見た目の順に
    落として探す——1つも当たらないと**揺れるだけで何も書かれない**
    モーダルができ、「押しても何も起きない」と区別が付かなくなる
    （`#filterPresetModal`が実際にそうだった）。 */
 const btn=dlg.querySelector('[aria-label="\u9589\u3058\u308b"],[title^="\u9589\u3058\u308b"]')
   ||dlg.querySelector('.mm-close,.rec-modal-close,.wl-close,[data-close]')
   ||[...dlg.querySelectorAll('button')].find(b=>/^[×✕✖x]$/i.test((b.textContent||'').trim()));
 if(btn){
  btn.classList.add('wl-close-hint');
  clearTimeout(btn._wlHintTimer);
  btn._wlHintTimer=setTimeout(()=>btn.classList.remove('wl-close-hint'),1900);
 }
}
/* 背景を押しても閉じない。**mousedownでpreventDefaultして入力欄の
   フォーカスを保つ**——外すと、打ちかけの欄からカーソルが抜けて
   日本語入力の変換も途切れる（閉じないだけでは足りない）。
   掴んで運ぶ部品には当てないこと（Chromeでは`mousedown`の
   preventDefaultがHTML5のドラッグ開始を止める）。ここは覆いの地の上
   だけなので当たらない。 */
function keepModalOpen(modal){
 if(!modal||modal._wlKeepOpen)return modal;
 modal._wlKeepOpen=true;
 modal.addEventListener('mousedown',e=>{if(e.target===modal)e.preventDefault()});
 modal.addEventListener('click',e=>{if(e.target===modal)nudgeModal(modal)});
 return modal;
}
function escClosesModal(e){return e.key==='Escape'&&!e.isComposing&&e.keyCode!==229}
WL.modal={keepOpen:keepModalOpen,nudge:nudgeModal,escCloses:escClosesModal};
/* ---------- 画面の骨組みは HTML に置く（§9.522・REVIEW 3-7） ----------
   動かない部分は`templates/index.html`の`<template id="tpl-名前">`に置き、画面のJSは
   `WL.template(名前)`で複製して使う（`<template>`は不活性なので、置いても描画の手間は増えない）。
   **無ければ名前を言って止まる**——黙って空の画面を出さない。呼ぶ側と置き場の対応は
   `tests/test_loadorder.py`が見張る（呼んでいるのに無い／置いてあるのに誰も呼ばない）。 */
/* **差し込み口**（`<i data-tpl-slot="名前"></i>`）は、状態から組む部分を JS が名前で渡して埋める
   （`WL.template(名前,{口:HTML})`）。渡し忘れ・綴り違い（使われない口）は名前を言って止まる。
   `<select>`の中には口を置けない（HTML の決まりで器が捨てられる）ので、選択肢は複製のあとで埋める。 */
function cloneTemplate(name,slots){
 const t=document.getElementById('tpl-'+name);
 if(!t||!t.content)throw new Error(`画面の骨組み（<template id="tpl-${name}">）が index.html にありません`);
 const frag=t.content.cloneNode(true);
 const given=Object.assign({},slots||{});
 frag.querySelectorAll('[data-tpl-slot]').forEach(el=>{
  const key=el.dataset.tplSlot;
  if(!Object.hasOwn(given,key))throw new Error(`画面の骨組み「${name}」の差し込み口「${key}」へ渡すものがありません`);
  const part=document.createElement('template');
  part.innerHTML=String(given[key]??'');
  el.replaceWith(part.content);
  delete given[key];
 });
 const extra=Object.keys(given);
 if(extra.length)throw new Error(`画面の骨組み「${name}」に差し込み口「${extra.join('」「')}」がありません`);
 return frag;
}
WL.template=cloneTemplate;
/* 共通の確認モーダル。ブラウザ標準のconfirm()はアプリの見た目に合わせられず
   タブ全体をブロックするため、破棄確認・削除確認等はこちらへ統一する
   (以前はlot-split.js/filters.js/records-store.jsが個別にconfirm()を
   呼んでいた。records-store.jsの削除確認だけは専用モーダルを持っていたが、
   それも含めてこの共通モーダルへ一本化する)。
   opts.message: 通常のテキスト確認(改行はそのまま表示)。
   opts.bodyHtml: 任意のHTML本文(ロット情報の要約表示等)。指定時はmessageより優先。
   opts.danger: trueで確定ボタンを危険色にする。文字列を渡した場合はmessage扱い。
   opts.hideCancel: 「やめる」を出さない(お知らせ。`alertModal`が使う)。
   opts.focus: 開いたときに焦点を置く要素のセレクタ(既定は「やめる」)。 */
function ensureConfirmModal(){
 let modal=$('#appConfirmModal');if(modal)return modal;
 modal=document.createElement('div');modal.className='record-modal';modal.id='appConfirmModal';modal.hidden=true;
 modal.innerHTML=`<div class="settings-dialog confirm-modal-dialog" role="dialog" aria-modal="true"><header><div><small id="appConfirmEyebrow">CONFIRMATION</small><h2 id="appConfirmTitle">確認</h2></div><button id="closeAppConfirm" type="button" aria-label="閉じる">×</button></header><div class="settings-body"><div id="appConfirmBody"></div><div class="settings-actions"><button id="appConfirmCancel" type="button">キャンセル</button><button id="appConfirmOk" type="button">OK</button></div></div></div>`;
 document.body.append(modal);
 return modal;
}
function confirmModal(opts){
 const o=typeof opts==='string'?{message:opts}:(opts||{});
 return new Promise(resolve=>{
  const modal=ensureConfirmModal();
  $('#appConfirmEyebrow').textContent=o.eyebrow||'CONFIRMATION';
  $('#appConfirmTitle').textContent=o.title||'確認';
  $('#appConfirmBody').innerHTML=o.bodyHtml!==undefined?o.bodyHtml:`<p class="confirm-modal-message">${esc(o.message||'')}</p>`;
  const cancel=$('#appConfirmCancel'),ok=$('#appConfirmOk'),close=$('#closeAppConfirm');
  cancel.textContent=o.cancelLabel||'キャンセル';ok.textContent=o.confirmLabel||'OK';ok.className=o.danger?'danger':'';
  /* お知らせは「やめる」を出さない。**毎回入れ直す**——前の呼び出しで
     伏せたままにすると、次の確認から選択肢が片方消える。 */
  cancel.hidden=!!o.hideCancel;
  modal.hidden=false;
  const finish=result=>{modal.hidden=true;resolve(result)};
  cancel.onclick=()=>finish(false);ok.onclick=()=>finish(true);close.onclick=()=>finish(false);
  /* 入力欄でEnterを押したら決定（素の`prompt()`はそうだった。作法を落とさない）。
     本文は呼び出しごとに`innerHTML`ごと入れ替わるので、配線は溜まらない。 */
  $('#appConfirmBody').querySelectorAll('input,select').forEach(el=>{
   el.addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();ok.click()}});
  });
  WL.modal.keepOpen(modal);
  const first=(o.focus&&modal.querySelector(o.focus))||cancel;
  requestAnimationFrame(()=>{first.focus();if(first.select)first.select()});
 });
}
/* ---------- お知らせ・1行入力（§9.342） ----------
   ブラウザ標準の`alert()`/`prompt()`は、`confirm()`と同じ理由でやめる:
   アプリの見た目に合わせられず、**タブ全体を止め**、Escの効き方もIMEの
   挙動も浮きウィンドウとの重なり順も違う。

   **器は確認モーダルと同じ1つ。** 以前は「`prompt()`をやめる」と書いた
   自前の小窓が**3つ**（`list-rules.js`の`askName`・`filters.js`の
   `askGroupName`・`master-opdata.js`の`promptModal`）あり、それぞれ枠の
   クラスも入力欄の幅も決定ボタンの字も違った。**やめる先が3つあると、
   やめていない`prompt()`が残っていても誰も気づかない**——実際
   `master-opdata.js`は自前の`promptModal`を持ちながら、同じファイルの
   5箇所で素の`prompt()`を呼んでいた。 */
/* お知らせ。ボタンは1つ（「閉じる」）。返り値は使わない。 */
function alertModal(opts){
 const o=typeof opts==='string'?{message:opts}:(opts||{});
 return confirmModal({...o,eyebrow:o.eyebrow||'NOTICE',title:o.title||'お知らせ',
   confirmLabel:o.confirmLabel||'閉じる',hideCancel:true}).then(()=>undefined);
}
/* 1行だけ書かせる窓。返すのは前後の空白を落とした文字列で、
   **やめたときは`null`**（素の`prompt()`と同じ）。

   「空で決定した」と「やめた」を分けられることに意味がある——名前を聞く
   場面は`if(!v)return`でどちらも弾けるが、**理由のように空でも通す欄**
   （在席の切断理由）は、分かれていないと「やめた」が「理由なしで実行」に
   化ける。`prompt()`と同じ形にしてあるので、置き換えは1行で済む。 */
function promptModal(opts){
 const o=typeof opts==='string'?{label:opts}:(opts||{});
 return confirmModal({
   eyebrow:o.eyebrow||'INPUT',title:o.title||'入力',danger:o.danger,
   confirmLabel:o.confirmLabel||'決定',cancelLabel:o.cancelLabel||'やめる',
   bodyHtml:(o.message?`<p class="confirm-modal-message">${esc(o.message)}</p>`:'')
     +`<label class="confirm-modal-field"><span>${esc(o.label||'名前')}</span>`
     +`<input type="text" id="appPromptInput" value="${esc(o.value||'')}"`
     +` maxlength="${Number(o.maxLength)||120}" placeholder="${esc(o.placeholder||'')}"`
     +' autocomplete="off" spellcheck="false"></label>'
     +(o.hint?`<small class="confirm-modal-hint">${esc(o.hint)}</small>`:''),
   focus:'#appPromptInput',
 }).then(ok=>{
  const el=document.getElementById('appPromptInput');
  const v=String((el&&el.value)||'').trim();
  return ok?v:null;
 });
}

document.addEventListener('keydown',event=>{if(WL.modal.escCloses(event)&&!$('#appConfirmModal')?.hidden){$('#appConfirmCancel')?.click()}},true);
function sourceValue(names){const r=S.measure?.source||S.measure?.snapshot?.source||{};for(const n of names){if(r[n]!==undefined&&r[n]!==null&&String(r[n]).trim()!=='')return String(r[n])}return ''}
// Database field normalization supports half-width/full-width variants such as ﾌﾟﾗｽ / プラス.
function normalizedFieldName(name){return String(name||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase()}
/* 複数の候補ソース(S.current/S.measure.source/スナップショット等)を横断して
   フィールド値を探す。全角半角ゆれはnormalizedFieldNameで吸収する。 */
/* 探す本体。**引く規則は1箇所**——`S.*`を見る`sourceField()`と、まだ
   `S.measure`が無い時点で1行だけを見たい場合(§9.204の内径プリセット)の
   両方がここを通る。空白だけの値は「無い」として次の候補へ落とす。 */
function fieldFromRows(rows,names){
 for(const wanted of names){const wn=normalizedFieldName(wanted);for(const source of rows){for(const [key,value] of Object.entries(source)){if(normalizedFieldName(key)===wn&&value!==undefined&&value!==null&&String(value).trim()!=='')return String(value)}}}
 return '';
}
function sourceField(names){
 const sources=[S.current,S.measure?.source,S.measure?.snapshot?.source,S.measure?.snapshot?.basic,S.measure?.basic].filter(x=>x&&typeof x==='object');
 return fieldFromRows(sources,names);
}
// Waiting feedback on the initial navigation. Yield one frame so acknowledgement appears immediately.
function nextPaint(){return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))}
/* ---------- データソースの役割(§9.87) ----------
   「どれが作業対象の一覧(仕掛)で、どれが品質データか」は
   **データソースマスタの[役割]が決める**。以前は 'SIKALOTNOW' という
   キーの文字列を各画面で直接比較しており、マスタでキーを変えると
   左メニューに古いキーのボタンが残って「データベース指定が不正です」に
   なり、測定・予定・品質結合・条割の再検索が黙って消えた(実機で発生)。
   キーは利用者が自由に付けてよい**ただの識別子**に戻し、判定はここへ集約する。
   /api/catalog の結果で list-view.js の init() が満たす。 */
const dataSource=(()=>{
 let list=[],workKey=null,qualityKey=null,pending=[];
 function setCatalog(d){
  list=(d&&d.databases)||[];
  // サーバーが決めた役割を正とする(1件だけに絞る判定もサーバー側にある)。
  workKey=(d&&d.workKey)||null;qualityKey=(d&&d.qualityKey)||null;
  /* 保存済みだが再起動まで効かない変更(§9.183)。**名称も接続先と同じく
     起動時に1回だけ決まる**ので、直したのに左のボタンが古い名前のままに
     なる。サーバーが突き合わせた結果をそのまま持つ(画面で推測しない)。 */
  pending=(d&&d.restartPending)||[];
 }
 const of=key=>list.find(x=>x.key===key)||null;
 return {
  setCatalog,
  all:()=>list.slice(),
  /* 一覧として左メニューへ出すもの(マスタは別入口)。 */
  views:()=>list.filter(x=>x.role!=='master'),
  has:key=>!!of(key),
  get:of,
  workKey:()=>workKey,
  qualityKey:()=>qualityKey,
  /* 測定・予定投入の対象になる一覧か。 */
  isWork:key=>!!workKey&&key===workKey,
  isQuality:key=>!!qualityKey&&key===qualityKey,
  /* ロット問い合わせ(LotDsp)が使えるのは、ロットを持つ業務データ全般。 */
  hasLot:key=>{const x=of(key);return !!x&&x.role!=='master'},
  label:key=>{const x=of(key);return (x&&x.label)||''},
  /* 再起動待ちの変更。[{key,label,kind:'label'|'path'|'new'|'gone',now,next}] */
  restartPending:()=>pending.slice(),
 };
})();
// 名前空間の宣言はこのファイルの下の方にあるが、ここで先に要るので用意する。
window.WL=window.WL||{};
window.WL.dataSource=dataSource;

/* ---------- 列の並び・幅・表示(§9.88) ----------
   一覧やタイムラインの「どの順で、どの幅で、出すか出さないか」を覚える。
   対象(target)は画面ごとのスコープ文字列(list:<DB>:<表> / timeline:<設備>)。
   **どの列が存在するかはデータ側が決める**ので、ここは覚えている並びを
   実際の列へ当てはめるだけ。記録に無い列は末尾へ回し、記録にあってデータ側
   に無い列は黙って捨てる(列が増減しても設定が壊れない)。 */
/* ---------- 保存の状態を画面に出す(§9.212 ④、利用者の指示) ----------
   利用者の言葉は「**修正した内容が戻されたりしない**ために、より良い方法が
   あれば提案していただきたい」。設定の保存はこれまで**黙って投げていた**ので、
   失敗しても画面には何も出ず、**次に読み直したときに元の値が出てくるだけ**
   だった——本人からは「勝手に戻った」としか見えない。

   置き場は**画面名の右（タイトル帯）の1箇所**。どの画面のどの設定を保存
   していても同じ場所に出るので、探さなくてよい（§CLAUDE 2）。
   **状態は色だけで伝えない**（§3）ので必ず文字を出し、
   **失敗は消さずに残して「再試行」を同じ場所に置く**（§4。打つ手が無いまま
   赤いだけ、にしない）。成功は2秒で引っ込める（読み終えたあとも残す情報
   ではない）。 */
const saveState=(()=>{
 let busy=0,hideTimer=0,retry=null;
 const box=()=>document.getElementById('saveState');
 function paint(kind,text,tip,withRetry){
  const el=box();if(!el)return;
  el.hidden=false;el.className='save-chip save-chip-'+kind;
  el.innerHTML='<b class="save-chip-state"></b>'
   +((kind==='ng'&&withRetry!==false)?'<button type="button" class="save-chip-retry" id="saveStateRetry">再試行</button>':'');
  el.querySelector('.save-chip-state').textContent=text;
  el.title=tip||'';
  const r=el.querySelector('#saveStateRetry');
  if(r)r.onclick=()=>{const f=retry;retry=null;if(f)run(f.target,f.fn)};
 }
 function clearLater(ms){
  clearTimeout(hideTimer);
  hideTimer=setTimeout(()=>{const el=box();if(el&&busy<=0&&!retry){el.hidden=true;el.innerHTML=''}},ms);
 }
 /* 保存を1つ包む。**失敗は投げ直す**——呼んだ側が知らないまま
    「保存できた」ことにしない。 */
 async function run(target,fn){
  busy++;clearTimeout(hideTimer);retry=null;
  paint('busy','保存中…','設定をこの端末のマスタへ書いています');
  try{
   const r=await fn();
   busy--;
   if(busy<=0){paint('ok','保存しました','次に開いたときも同じ形で出ます');clearLater(2000)}
   return r;
  }catch(e){
   busy--;retry={target,fn};
   paint('ng','保存できませんでした',
     (e&&e.message?e.message+'\n':'')
     +'この設定はまだ画面の中だけです。読み直すと元へ戻ります。');
   throw e;
  }
 }
 /* ---- `api()`が自動で出す「保存しています…」（§9.273）----
    `run()`で包まれている保存は**そちらが出している**ので手を出さない
    （同じ場所に2つ書くと後から書いたほうが勝ち、文言が入れ替わる）。
    **やり直しのボタンは出さない**——同じPOSTをもう一度投げると二重に
    書きうる（`run()`は`fn`を持っているので出せる）。理由は呼んだ側の
    トーストが言うので、ここは状態だけを持つ（§8）。 */
 let auto=0;
 function autoBegin(){
  if(busy>0||retry)return false;
  auto++;clearTimeout(hideTimer);
  paint('busy','保存しています…','共有へ保存しているときは数秒かかることがあります');
  return true;
 }
 function autoEnd(ok){
  auto=Math.max(0,auto-1);
  if(busy>0||retry||auto>0)return;
  if(ok){paint('ok','保存しました','',false);clearLater(2000)}
  else{paint('ng','保存できませんでした','くわしい理由は画面のお知らせに出ています。',false);clearLater(6000)}
 }
 return {run,autoBegin,autoEnd,pending:()=>busy>0||auto>0,failed:()=>!!retry};
})();
window.WL=window.WL||{};
window.WL.saveState=saveState;

/* ---------- 3枚の重ね(§9.212 ③、利用者の指示) ----------
   **保存済み(saved) / 下書き(draft) / 操作中(live)** を別々に持つ。
   画面に出るのは `live || draft || saved` で、**保存へ行くのは saved だけ**。

   以前は1枚しか無く、`stage()`が保存済みと同じ入れ物を書き換えていた。
   そのため列の設定パネルを開いたまま見出しの取っ手で幅を引くと、
   **パネルの未保存の下書きごとマスタへ書き込まれた**（逆にパネルを保存
   せずに閉じると画面だけ戻り、マスタは戻らない）。利用者の言う
   「修正した内容が戻される」はここから起きる。

   ・saved … サーバーにある形。読み込みと保存だけが書き換える。
   ・draft … 列の設定パネルの未保存の編集。`stage()`で置き、
             `discard()`で捨てる（＝保存せずに閉じたら開いた時点へ戻る）。
   ・live  … 掴んでいる最中の見え方。`hold()`で置き、`release()`で捨てる。
             **保存には行かない**——離した時点の値だけを`patch()`が送る。 */
const columnLayout=(()=>{
 const saved=new Map();                 // target -> 保存済み
 /* その一覧の列を「みんなと同じ(common)／自分だけ(personal)」のどちらで
    見ているか(§9.259)。**サーバーが答える**——所有者の解決は
    column_layout_owner の1箇所が持つので、画面は受け取って出すだけ。 */
 const scopes=new Map();                // target -> 'common' | 'personal'
 /* **どの利用者IDで読んだか**を覚える(§9.184と同じ罠)。IDは`/api/whoami`から
    後から届くので、空のIDで読んだ結果を「読んだ」ことにすると、その人の
    個人設定は**永久に載って来ない**。IDが変わったら読み直す。 */
 const loadedFor=new Map();             // target -> そのとき使った利用者ID
 let canPersonalize=false;              // 利用者IDが分かっているか(サーバーの答え)
 const draft=new Map();                 // target -> 設定パネルの下書き(無ければ持たない)
 const live=new Map();                  // target -> 掴んでいる最中の見え方
 /* locks=幅を固定した列(§9.119)。**幅の「自動/手動/固定」は3つの状態**で、
    自動と手動はwidthsの有無で分かるが、固定はもう1つの状態なので別に持つ。 */
 /* sorts=列ごとの並べ替えの決まり(§9.187)。`{列名:{buckets,on,natural}}`。 */
 /* aligns=値と見出しの揃え(§9.239 ④)。`{列名:{data,head}}`。 */
 const empty=()=>({order:[],widths:{},hidden:[],names:{},formats:{},rules:{},formulas:{},
                   locks:[],sorts:{},aligns:{}});
 const KEYS=['order','widths','hidden','names','formats','rules','formulas','locks','sorts','aligns'];
 const norm=l=>({order:(l&&l.order)||[],widths:(l&&l.widths)||{},hidden:(l&&l.hidden)||[],
                 names:(l&&l.names)||{},formats:(l&&l.formats)||{},rules:(l&&l.rules)||{},
                 formulas:(l&&l.formulas)||{},locks:(l&&l.locks)||[],sorts:(l&&l.sorts)||{},
                 aligns:(l&&l.aligns)||{}});
 /* 重ねを畳んだ結果。**毎回作り直すと重い**(1列ごとに引く場面がある)ので
    覚え、どれかの重ねが変わったときだけ捨てる。 */
 const eff=new Map();
 const bump=t=>{if(t)eff.delete(t);else eff.clear()};
 async function load(target){
  if(!target)return empty();
  const uid=ensureUserId();
  /* IDが後から届いたときは読み直す。**同じIDで読み済みならそのまま。** */
  if(saved.has(target)&&loadedFor.get(target)===uid)return get(target);
  let v=empty();
  try{
   const r=await api('/api/column-layout-master?target='+encodeURIComponent(target)
                     +'&user='+encodeURIComponent(uid));
   v=norm(r);
   scopes.set(target,r&&r.scope==='personal'?'personal':'common');
   canPersonalize=!!(r&&r.canPersonalize);
   keepRights(target,r);
  }catch(e){WL.quiet.note('読めなくても既定の並びで一覧は出す(fail-open)',e)}
  saved.set(target,v);loadedFor.set(target,uid);bump(target);return get(target);
 }
 /* ---------- 表示列の編集（§9.512、利用者の指示） ----------
    この対象で**何を保存してよいか**はサーバーが答える（`column_edit_for_target`・
    アクセス権限マスタの「表示列の編集」）。画面は受け取って、保存の行き先を決めるだけ:
      変更不可     … サーバーへ送らない（この画面のあいだだけ効く）。1回だけ字で言う
      自分の分だけ … みんなと同じを見ているなら、**自分だけへ切り替えてから**保存する
                     （断って終わりにしない——変えたい人を行き止まりにしない）
    読む前（答えが無い）は`/api/access-mode`の答え、それも無ければ今までどおり（§9.132）。 */
 const rights=new Map();                // target -> {own,common,level}
 function keepRights(target,r){
  if(r&&typeof r.canEditOwnColumns==='boolean')
   rights.set(target,{own:r.canEditOwnColumns,common:!!r.canEditCommonColumns,level:r.columnEdit||''});
 }
 function rightsOf(target){
  const hit=target&&rights.get(target);if(hit)return hit;
  const am=window.accessMode||{};
  return {own:am.canEditOwnColumns!==false,common:am.canEditCommonColumns!==false,level:am.columnEdit||'編集可'};
 }
 const told=new Set();
 function tellLocal(target,why){
  if(told.has(target))return;
  told.add(target);
  window.showToast&&showToast('表示列の変更は保存されません',why,7000);
 }
 /* 行き先が**待たずに決まる**ときの答え（`'send'`／`'local'`）。切り替えや読み込みが要るときは null。
    **いつもの保存を1手も遅らせない**——`await`を1つ挟むだけで、保存中の札が出る前・保存済みへ
    当てる前に描き直しが走り、掴んで離した列幅が一瞬もとへ戻る（test_sctimecols・test_lcpanel で実測）。 */
 function routeNow(target){
  if(!scopes.has(target))return null;
  const r=rightsOf(target);
  if(r.own&&(r.common||scopeOf(target)==='personal'))return 'send';
  return null;
 }
 async function route(target){
  if(!scopes.has(target))await load(target);
  const r=rightsOf(target);
  if(!r.own){
   tellLocal(target,`この端末の「表示列の編集」は「${r.level||'変更不可'}」です。この画面のあいだだけ効き、次に開くと元に戻ります。`
                    +'変える必要があれば、アクセス権限マスタで「表示列の編集」を上げてもらってください。');
   return 'local';
  }
  if(!r.common&&scopeOf(target)!=='personal'){
   if(!canPersonalize){
    tellLocal(target,'この端末の「表示列の編集」は「自分の分だけ」ですが、利用者IDが分からないため自分だけの設定を持てません。');
    return 'local';
   }
   await setScope(target,true);
   window.showToast&&showToast('自分だけの表示列に切り替えました',
    'この端末の「表示列の編集」は「自分の分だけ」なので、みんなと同じ表示列は変えずに、あなたの分として保存します（他の人の見え方は変わりません）。',7000);
  }
  return 'send';
 }
 /* いまどちらで見ているか。**読む前は分からないので'common'とは言い切らない** */
 function scopeOf(target){return scopes.get(target)||''}
 function personalizable(){return canPersonalize}
 /* みんなと同じ⇄自分だけ を切り替える(§9.259)。サーバーが写しを作ってから
    切り替え、切り替えた後の設定をそのまま返すので、**当て直しは1往復で済む**。 */
 async function setScope(target,personal){
  if(!target)return null;
  const r=await api('/api/column-layout-master/scope',
   {method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({target,scope:personal?'personal':'common'}))});
  saved.set(target,norm(r));loadedFor.set(target,ensureUserId());
  scopes.set(target,r&&r.scope==='personal'?'personal':'common');
  canPersonalize=!!(r&&r.canPersonalize);
  keepRights(target,r);
  draft.delete(target);live.delete(target);bump(target);
  return r;
 }
 /* 画面に出す値。**上の重ねが勝つ。ただし持っている項目だけ。**
    重ねを「まるごとの写し」にしないこと（§9.212 ③）——掴んでいる最中の
    重ね(live)が`widths`しか触っていないのに`hidden`まで抱えてしまうと、
    **その裏で保存された`hidden`が見えなくなる**。実際に、列を1つ動かした
    直後の描き直しで「畳んでいたはずの5列」が出てしまい、見出しのセル数と
    `--sc-cols`のトラック数が食い違って表が1列ずつずれた。 */
 function get(target){
  if(!target)return empty();
  const hit=eff.get(target);
  if(hit)return hit;
  const v={...(saved.get(target)||empty()),
           ...(draft.get(target)||{}),
           ...(live.get(target)||{})};
  eff.set(target,v);return v;
 }
 /* サーバーにある形だけを見る。**保存を組み立てるときは必ずこちら**
    ——`get()`から作ると未保存の下書きまで保存してしまう。 */
 function savedOf(target){return saved.get(target)||empty()}
 async function save(target,layout){
  if(!target)return;
  /* 全部を送る＝全部が保存済みになる（設定パネルの「保存」）。 */
  const v=norm(layout);
  const way=routeNow(target)||await route(target);   // 行き先を先に決める（切り替えは保存済みを入れ替える）
  saved.set(target,v);draft.delete(target);live.delete(target);bump(target);
  if(way==='local')return;
  await saveState.run(target,()=>api('/api/column-layout-master',
   {method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({target,...v}))}));
 }
 /* **触った項目だけ**を保存する(§9.212 ②)。サーバーは送られてきたキーだけを
    書き換えるので、渡していない設定は消えない——列幅を引いただけで計算式や
    並べ替えが消える事故(§9.113/§9.211 ①)が構造的に起きなくなる。
    下書きが開いていればそちらへも当てる（画面と保存済みが食い違わない）。 */
 async function patch(target,body){
  if(!target||!body||typeof body!=='object')return;
  const keys=Object.keys(body).filter(k=>KEYS.includes(k));
  if(!keys.length)return;
  const pick={};keys.forEach(k=>{pick[k]=body[k]});
  const way=routeNow(target)||await route(target);
  saved.set(target,{...savedOf(target),...pick});
  if(draft.has(target))draft.set(target,{...draft.get(target),...pick});
  bump(target);
  if(way==='local')return;
  await saveState.run(target,()=>api('/api/column-layout-master',
   {method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({target,...pick}))}));
 }
 function forget(target){
  if(target){saved.delete(target);draft.delete(target);live.delete(target);
             loadedFor.delete(target);scopes.delete(target);rights.delete(target)}
  else{saved.clear();draft.clear();live.clear();loadedFor.clear();scopes.clear();rights.clear()}
  bump(target);
 }
 /* **保存せずに今の画面へ当てる**(§9.90)。列の設定パネルは、触った結果が
    そのまま一覧に出るのが分かりやすい——設定画面の中の小さな見本で
    想像させるより、本物の一覧が変わるほうが確実に伝わる。
    保存は別操作なので、閉じるときは discard(target) で捨てる。 */
 function stage(target,layout){
  if(!target)return;
  draft.set(target,norm(layout));bump(target);
 }
 function discard(target){if(target){draft.delete(target);bump(target)}}
 /* 掴んでいる最中の見え方(§9.212 ③)。**保存には行かない。**
    **触っている項目だけ**を持つこと（`{...get()}`で丸ごと写さない）。 */
 function hold(target,body){
  if(!target||!body)return;
  live.set(target,{...(live.get(target)||{}),...body});bump(target);
 }
 function release(target){if(target){live.delete(target);bump(target)}}
 /* 覚えている並びを、実際にある列へ当てはめる。 */
 function apply(target,columns){
  const {order,hidden}=get(target);
  const have=new Set(columns),hide=new Set(hidden);
  const known=order.filter(c=>have.has(c));
  const rest=columns.filter(c=>!order.includes(c));   // 新しく増えた列は末尾
  return [...known,...rest].filter(c=>!hide.has(c));
 }
 /* 番号・ボタンの列(`#`/`__split__`/`__measure__`/`__plan__`)も
    「出す/出さない」を持つ(§9.105)。以前は列の設定画面でチェックを外せる
    のに一覧は必ず出しており、**外しても何も起きない**という状態だった
    (押した通りに動かないUIは、動かない機能より質が悪い)。
    データ列の並べ替え(`apply`)とは別に、キー1つの可否だけを答える。 */
 const shows=(target,col)=>!(get(target).hidden||[]).includes(col);
 /* 幅を固定した列か(§9.119)。固定した列は取っ手を出さず、
    「幅を内容に合わせる」でも触らない。 */
 const locked=(target,col)=>(get(target).locks||[]).includes(col);
 return {load,get,save,patch,forget,apply,stage,discard,hold,release,
         saved:savedOf,shows,locked,
         /* 列の見せ方の持ち主(§9.259)。'common'=みんなと同じ／'personal'=自分だけ。 */
         scope:scopeOf,setScope,personalizable,
         /* この対象で何を保存してよいか（§9.512）。{own,common,level} */
         rights:rightsOf,
         width:(target,col)=>get(target).widths[col]||null,
         /* 幅の状態を1語で。'auto'=内容に合わせる / 'manual'=手で決めた /
            'locked'=固定(手で決めた幅から動かさない)。 */
         widthMode:(target,col)=>locked(target,col)?'locked'
                                 :(get(target).widths[col]?'manual':'auto'),
         /* 画面に出す名前。未設定なら元の項目名のまま(§9.88)。 */
         label:(target,col)=>get(target).names[col]||col,
         /* **名前から列を引く答えはここ1箇所**（§9.464、利用者の報告「表示列の名前を変更
            しても、元の名前の列で条件を作ったり使えるように」）。式の`[名前]`・条件の
            「他の列」が書いた名前を、並んでいる列（`keys`）のどれかへ当てる。順は
            元の列名 → いまの表示名 → 別名（`aliases`：生カラム名とalias名の相互）。
            表示名は**見出しだけ**を変えるもの（§9.88）なので、元の名前でも新しい名前でも
            同じ列を指す。当たらなければ''。 */
         keyByName:(target,keys,name)=>{
          const want=String(name==null?'':name).trim();
          if(!want)return '';
          const ks=keys||[];
          if(ks.includes(want))return want;
          const names=get(target).names||{};
          const byLabel=ks.find(k=>names[k]===want);
          if(byLabel)return byLabel;
          const al=aliases||{};
          /* 別名: 名前がalias名なら生カラム名の並びから、生カラム名ならそのalias名から。 */
          const cands=[...(al[want]||[]),
           ...Object.keys(al).flatMap(a=>(al[a]||[]).includes(want)?[a,...al[a]]:[])];
          return ks.find(k=>cands.includes(k))||'';
         },
         /* この列の書式指定。未設定ならnull(=そのまま表示)。 */
         format:(target,col)=>get(target).formats[col]||null,
         /* この列に効く読み替えルールの名前。未設定なら''(=読み替えなし)。 */
         rule:(target,col)=>get(target).rules[col]||'',
         /* 計算で作る列の式(§9.111 ⑦)。未設定なら''(=データ側の列)。 */
         formula:(target,col)=>get(target).formulas[col]||'',
         formulas:target=>({...get(target).formulas}),
         /* この列の並べ替えの決まり(§9.187)。未設定ならnull(=今までどおり
            SQLの素の並び)。 */
         sort:(target,col)=>(get(target).sorts||{})[col]||null,
         /* この列の揃え(§9.239 ④)。未設定なら`{data:'',head:''}`(=既定)。 */
         align:(target,col)=>{
          const a=(get(target).aligns||{})[col];
          return {data:(a&&a.data)||'',head:(a&&a.head)||''};
         }};
})();
window.WL.columnLayout=columnLayout;

/* ---------- 列の揃え(§9.239 ④、利用者の指示) ----------
   「数値は右詰め、文字列は左詰めなど自動で書式に合わせた設定になりますが、
    手動での任意変更もできるようにしてください。また、カラムの文字列は
    データとは別で中央位置をデフォルトにして、データの位置に追従するか、
    別で設定するか選べるようにしてください」

   **答えるのはここ1箇所**（§9.163）。仕掛一覧・データ一覧・スケジュール表の
   3つが同じ関数を通す——別々に持つと「一覧では右なのに帳票では左」が作れる。

   値の揃え:
     ''(自動) … 書式が数値なら右、それ以外は左（＝これまでの見え方そのまま）
     left / center / right … 手で決めたとおり
   見出しの揃え:
     ''(既定) … **中央**（利用者の指示。値とは別の既定）
     follow  … 値の揃えに追従する
     left / center / right … 手で決めたとおり

   **書式の種別を渡してもらう**のは、`WL.columnLayout.format()`を毎セル
   引くと重いから（描く側は列ごとに1度だけ引いて使い回している）。
   渡されなければここで引く。 */
const columnAlign=(()=>{
 const DIRS=['left','center','right'];
 const CLS={left:'al-l',center:'al-c',right:'al-r'};
 const kindOf=(target,col,kind)=>
   kind!==undefined?kind:((columnLayout.format(target,col)||{}).kind||'');
 /* 値の揃え。**自動のときだけ書式を見る**——手で決めてあれば書式を変えても
    動かない（「任意変更」の意味）。 */
 function dataOf(target,col,kind){
  const v=columnLayout.align(target,col).data;
  if(DIRS.includes(v))return v;
  return kindOf(target,col,kind)==='number'?'right':'left';
 }
 /* 見出しの揃え。**既定は中央**で、値とは別に持つ。 */
 function headOf(target,col,kind){
  const h=columnLayout.align(target,col).head;
  if(h==='follow')return dataOf(target,col,kind);
  if(DIRS.includes(h))return h;
  return 'center';
 }
 return {DIRS,LABEL:{left:'左詰め',center:'中央',right:'右詰め'},
         HEAD_LABEL:{'':'中央（既定）',follow:'データに追従',
                     left:'左詰め',center:'中央',right:'右詰め'},
         DATA_LABEL:{'':'自動（書式に合わせる）',
                     left:'左詰め',center:'中央',right:'右詰め'},
         dataOf,headOf,
         cellClass:(target,col,kind)=>CLS[dataOf(target,col,kind)],
         headClass:(target,col,kind)=>CLS[headOf(target,col,kind)],
         classOf:dir=>CLS[dir]||'',
         /* 文字列を組み立てて流し込む画面（スケジュール表）向け。
            **描き終えてから1度だけ**当てる（セルごとにDOMを触らない）。 */
         applyCells(root,target,opt){
          if(!root||!target)return;
          const o=opt||{};
          const sel=o.selector||':scope>[data-col]';
          const head=!!o.head;
          root.querySelectorAll(sel).forEach(el=>{
           const c=el.dataset.col;if(!c)return;
           el.classList.remove('al-l','al-c','al-r');
           el.classList.add(head?headClassOf(target,c):cellClassOf(target,c));
          });
         }};
 function cellClassOf(t,c){return CLS[dataOf(t,c)]}
 function headClassOf(t,c){return CLS[headOf(t,c)]}
})();
window.WL.columnAlign=columnAlign;

/* ---------- 列に一時的な色を付ける(§9.239 ⑤-3、利用者の指示) ----------
   「カラムに色を一時的に付けられる機能を実装してください。列移動させる際
    などに目印にしたいです。右クリックのメニューに実装し、解除もセットで」

   決めごと:
    ・**マスタへ保存しない。** 「一時的」と言われているものを共有マスタへ
      入れると、他のPCの画面にも色が付き、誰かが消すまで残る。置き場は
      このタブの`sessionStorage`——画面を行き来しても・表を描き直しても
      残り、アプリを閉じれば消える（＝「一時的」の意味そのまま）。
    ・**色は7色から選ばせ、16進を選ばせない**（§9.198）。行表示マスタと
      **同じ色・同じ呼び名**にする——2つの色の言葉を覚えさせない。
      色そのものは`:root`のトークンから取る（リテラルを足さない）。
    ・**色だけで伝えない**（§3）。見出しには色名を`title`へ添え、
      メニューには「色: 青（この端末だけ・一時的）」と文字で出す。
      **解除は必ず同じ場所に置く**（付けた本人が次に探すのはそこ）。
    ・**表を描き直さない。** 色を変えるたびに一覧を組み直すと、200行×214列
      では数百msかかり（§9.94）、横スクロールの位置も失われる——色を付ける
      目的が「動かす前に見失わないこと」なのに本末転倒になる。
      塗るのは**1枚の`<style>`を書き換えるだけ**にしてあり、
      仕掛一覧・データ一覧・スケジュール表の3つに同じ規則が効く
      （どのセルも`data-col`を持っているのが土台。§9.104）。 */
const columnTint=(()=>{
 const STORE='WaveLogColumnTintV1';
 const STYLE_ID='wlColumnTintStyle';
 /* 鍵→トークンの表は**ここ1つだけ**。CSSへ書くと画面ごとに増える。
    §9.286 ⑥（利用者の指示「選択肢やこの背景色の選択で使う色のパレットの
    種類をさらに増やしてほしいです」）で7色→14色。**意味を割り当ててから
    足すこと**——名前だけの色が増えると、選ぶ側は「どれを使うか」を毎回
    決め直すことになる（§CLAUDE 画面基準 3。色だけで伝えないので、
    呼び名と意味は必ず文字で出す）。 */
 const PALETTE={
  gray  :{label:'灰',   note:'目立たせない', bg:'var(--surface-2)',    ink:'var(--ink-3)',      line:'var(--line-mid)'},
  slate :{label:'石',   note:'締め・基準',   bg:'var(--rs-slate-bg)',  ink:'var(--rs-slate)',   line:'var(--rs-slate-border)'},
  teal  :{label:'青緑', note:'基準・進行',   bg:'var(--pale)',         ink:'var(--teal-dark)',  line:'var(--teal)'},
  cyan  :{label:'水',   note:'確認・検査',   bg:'var(--rs-cyan-bg)',   ink:'var(--rs-cyan)',    line:'var(--rs-cyan-border)'},
  blue  :{label:'青',   note:'情報・待ち',   bg:'var(--rs-blue-bg)',   ink:'var(--rs-blue)',    line:'var(--rs-blue-border)'},
  indigo:{label:'藍',   note:'分類・区分',   bg:'var(--rs-indigo-bg)', ink:'var(--rs-indigo)',  line:'var(--rs-indigo-border)'},
  green :{label:'緑',   note:'完了・良',     bg:'var(--success-bg)',   ink:'var(--success)',    line:'var(--success-border)'},
  lime  :{label:'黄緑', note:'進行中',       bg:'var(--rs-lime-bg)',   ink:'var(--rs-lime)',    line:'var(--rs-lime-border)'},
  yellow:{label:'黄',   note:'確認待ち',     bg:'var(--rs-yellow-bg)', ink:'var(--rs-yellow)',  line:'var(--rs-yellow-border)'},
  amber :{label:'橙',   note:'注意・段取り', bg:'var(--warn-bg)',      ink:'var(--warn-fg)',    line:'var(--warn-border)'},
  brown :{label:'茶',   note:'資材・素材',   bg:'var(--rs-brown-bg)',  ink:'var(--rs-brown)',   line:'var(--rs-brown-border)'},
  red   :{label:'赤',   note:'停止・異常',   bg:'var(--danger-bg)',    ink:'var(--danger)',     line:'var(--danger-border)'},
  pink  :{label:'桃',   note:'目印・個人',   bg:'var(--rs-pink-bg)',   ink:'var(--rs-pink)',    line:'var(--rs-pink-border)'},
  purple:{label:'紫',   note:'臨時・特別',   bg:'var(--rs-purple-bg)', ink:'var(--rs-purple)',  line:'var(--rs-purple-border)'},
 };
 const KEYS=Object.keys(PALETTE);
 let all=(()=>{try{const m=JSON.parse(sessionStorage.getItem(STORE)||'{}');
   return (m&&typeof m==='object')?m:{}}catch(_){return {}}})();
 const write=()=>{try{sessionStorage.setItem(STORE,JSON.stringify(all))}catch(_){WL.quiet.note('このタブの覚えを書けない（既定で続ける）',_)}};
 const bucket=t=>{const k=String(t||'');return (k&&all[k]&&typeof all[k]==='object')?all[k]:null};
 /* 属性セレクタの値は**引用符つきの文字列**なので、エスケープするのは
    `\` と `"` の2つだけ（`CSS.escape`は識別子用なのでここでは使えない）。 */
 const q=v=>String(v).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
 /* 塗る場所。**対象(target)ごとに器を絞る**——`data-col`は列名なので、
    絞らないと**別の一覧の同じ名前の列**まで塗られる（仕掛一覧はDB×表ごとに
    別の対象なので、切り替えただけで身に覚えのない色が付く）。
    器は`#grid`が`data-lt`（いまの対象）、スケジュール表は`#scTimeline`の
    `data-equipment`で見分ける。データ一覧は対象が1つしかない。
    見出しは面ごと・セルは淡く——面を濃くすると行が多い一覧では騒がしい
    （§9.88 段4の「面ではなく文字へ色を置く」と同じ考え方で、ここは
    「どの列か」を探すための印なので面は使うが、本文側は薄くする）。 */
 function scopeOf(target){
  const t=String(target||'');
  if(t==='records:list')
   return {head:'#recordList .record-list-head>',cell:'#recordList .record-list-row>'};
  if(t.startsWith('timeline:')){
   const eq=`#scTimeline[data-equipment="${q(t.slice('timeline:'.length))}"] `;
   return {head:eq+'.sc-row-head>',cell:eq+':is(.sc-row-line,.sc-child-line)>'};
  }
  const g=`#grid[data-lt="${q(t)}"] `;
  return {head:g+'thead th',cell:g+'tbody td'};
 }
 function css(){
  const out=[];
  Object.keys(all).forEach(target=>{
   const cols=all[target];if(!cols||typeof cols!=='object')return;
   const sc=scopeOf(target);
   Object.keys(cols).forEach(col=>{
    const p=PALETTE[cols[col]];if(!p)return;
    const at=`[data-col="${q(col)}"]`;
    out.push(`${sc.head}${at}{background:${p.bg};color:${p.ink};`
             +`box-shadow:inset 0 -3px 0 ${p.line}}`);
    out.push(`${sc.cell}${at}{background:color-mix(in srgb, ${p.bg} 55%, var(--surface))}`);
   });
  });
  return out.join('\n');
 }
 function paint(){
  let el=document.getElementById(STYLE_ID);
  const text=css();
  if(!el){
   if(!text)return;
   el=document.createElement('style');el.id=STYLE_ID;
   document.head.appendChild(el);
  }
  if(el.textContent!==text)el.textContent=text;   // 同じなら触らない(§9.131)
 }
 function set(target,col,key){
  const t=String(target||''),c=String(col||'');
  if(!t||!c)return;
  if(!KEYS.includes(key)){                        // 解除
   if(all[t]){delete all[t][c];if(!Object.keys(all[t]).length)delete all[t]}
  }else{
   if(!all[t]||typeof all[t]!=='object')all[t]={};
   all[t][c]=key;
  }
  write();paint();
 }
 function clearAll(target){
  const t=String(target||'');
  if(t)delete all[t];else all={};
  write();paint();
 }
 return {
  PALETTE,keys:()=>KEYS.slice(),
  label:k=>(PALETTE[k]||{}).label||'',
  note:k=>(PALETTE[k]||{}).note||'',
  get:(target,col)=>{const b=bucket(target);return (b&&b[String(col||'')])||''},
  count:target=>{const b=bucket(target);return b?Object.keys(b).length:0},
  cols:target=>{const b=bucket(target);return b?Object.keys(b):[]},
  set,clearAll,paint};
})();
window.WL.columnTint=columnTint;
/* 覚えているぶんを最初に塗る。`sessionStorage`は読み直しでは残るので、
   ここで塗らないと「リロードしたら目印だけ消えた」ことになる。 */
columnTint.paint();

/* ---------- 列ごとの並べ替えの決まり(§9.187) ----------
   実データの同じ項目には '' / '3' / '10' / '2026/08/01' / 'A2' が混ざる。
   どの順で並べたいかは列によって違うので、**空欄・数値・日付・文字列を
   塊として扱い、塊の順番を利用者が決められる**ようにした。

   **並べるのはサーバー**(`backend/sort_order.py`)。ページを切り出すのは
   SQL側なので、画面で並べ替えると1ページの中だけが並ぶことになる。
   ここが持つのは「この列の実データはどの塊か」を数えて**設定パネルに
   文字で出す**ためだけの判定と、設定の正規化。判定が2つあるのは役目が
   違うからで、食い違わないように`tests/fixtures/sort_cases.json`の同じ例で
   両方を突き合わせている(`tests/test_colsort.js`と`tests/test_sortpipe.py`)。 */
const sortSpec=(()=>{
 const KINDS=['empty','num','date','text'];
 const LABEL={empty:'空欄',num:'数値',date:'日付',text:'文字列'};
 const NUM=/^[-+]?(\d+\.?\d*|\.\d+)$/;
 const DATE=/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/;
 const PACKED=/^(\d{4})(\d{2})(\d{2})(?:[ T]?(\d{2})(\d{2})(\d{2})?)?$/;
 const numOf=v=>{
  if(typeof v==='number')return Number.isFinite(v)?v:null;
  const t=String(v==null?'':v).trim().replace(/,/g,'');
  if(!t||!NUM.test(t))return null;
  const n=Number(t);return Number.isFinite(n)?n:null;
 };
 /* **8桁の数字は日付として読まない**——製造番号が日付に化けると、
    数値の列が黙って日付の塊へ移る。時刻が続く形だけを日付として扱う。 */
 const dateKey=v=>{
  const t=String(v==null?'':v).trim();
  if(!t)return null;
  let m=DATE.exec(t);
  if(!m){const p=PACKED.exec(t);if(!p||!p[4])return null;m=p}
  const M=+m[2],d=+m[3],H=+(m[4]||0),mi=+(m[5]||0),s=+(m[6]||0);
  if(!(M>=1&&M<=12&&d>=1&&d<=31)||H>23||mi>59||s>59)return null;
  const p2=n=>String(n).padStart(2,'0');
  return `${String(+m[1]).padStart(4,'0')}${p2(M)}${p2(d)}${p2(H)}${p2(mi)}${p2(s)}`;
 };
 const classify=v=>{
  const t=String(v==null?'':v).trim();
  if(!t)return 'empty';
  if(numOf(t)!==null)return 'num';
  if(dateKey(t)!==null)return 'date';
  return 'text';
 };
 /* 保存する形へ正す。**何も指定が無ければnull**＝今までどおりの並び。 */
 function normalize(x){
  if(!x||typeof x!=='object')return null;
  const buckets=[];
  (x.buckets||[]).forEach(k=>{k=String(k||'');if(KINDS.includes(k)&&!buckets.includes(k))buckets.push(k)});
  if(buckets.length)KINDS.forEach(k=>{if(!buckets.includes(k))buckets.push(k)});
  const on=x.on==='display'?'display':'raw';
  const natural=!!x.natural;
  if(!buckets.length&&on==='raw'&&!natural)return null;
  return {buckets,on,natural};
 }
 /* 実データの内訳。「この設定が効く列かどうか」を設定パネルで言うために使う
    ——1種類しか無い列に塊の順を決めても意味が無い。 */
 function census(values){
  const out={empty:0,num:0,date:0,text:0};
  (values||[]).forEach(v=>{out[classify(v)]++});
  return out;
 }
 function censusText(values){
  const c=census(values);
  const parts=KINDS.filter(k=>c[k]).map(k=>`${LABEL[k]} ${c[k]}件`);
  if(!parts.length)return 'この列の値がまだ読めていません';
  const kinds=KINDS.filter(k=>c[k]&&k!=='empty').length;
  return parts.join(' / ')+(kinds>1?'（種類が混ざっています）':'');
 }
 function describe(spec){
  const v=normalize(spec);
  if(!v)return '既定（種類で分けない）';
  const out=[];
  if(v.buckets.length)out.push(v.buckets.map(k=>LABEL[k]).join(' → '));
  if(v.natural)out.push('数字混じりは人の読む順');
  out.push(v.on==='display'?'変換後の文字で並べる':'生の値で並べる');
  return out.join('／');
 }
 return {KINDS,LABEL,numOf,dateKey,classify,normalize,census,censusText,describe,
         /* 既定の塊の順。パネルで「決める」を選んだときの出発点。 */
         defaultBuckets:()=>KINDS.slice()};
})();
window.WL.sortSpec=sortSpec;

/* ---------- 値の読み替え(§9.88 段4) ----------
   「00」を「なし」と見せる類の置き換え。ルール名でまとめて登録し、
   複数の列から使い回す(列に紐づけると「00→なし」を列の数だけ書かせる
   ことになる)。1ルールは行の配列で、**上から見て最初に当たったものを採用**
   する。行の中の条件はAND、行同士がOR。
   **判定は画面側だけ**で行う(サーバーは生の値を返し、並べ替え・絞り込みは
   生の値のまま効かせる。書式と同じ方針)。 */
const displayRules=(()=>{
 let cache=null,inflight=null,usageMap=null,optMap={};
 /* 数の読み方は式の`cmp()`が持つ（§9.477・ここに写しを置かない）。 */
 /* 条件の片側を実際の値へ。self=この列 / column=他の列 / value=固定値 / calc=式。
    **他の列を見られる**ので「区分が3のときだけ○○と出す」が書ける。
    **式**（§9.464、利用者の指示「文字列からの抽出や変換処理もできるように」）は
    式の列と同じ`WL.formula`で、**抜き出してから比べる**が書ける
    （例: `extract([この列],'[0-9]+')` が 100 より大きい）。`[この列]`はこの列の値。 */
 const calcCache=new Map();
 function calcOf(src){
  const k=String(src||'');
  if(calcCache.has(k))return calcCache.get(k);
  let c=null;
  try{c=WL.formula?WL.formula.compile(k):null}
  catch(e){WL.quiet.note('条件の式を読めない（その条件は当たらない）',e);c=null}
  if(calcCache.size>200)calcCache.clear();
  calcCache.set(k,c);
  return c;
 }
 const SELF_KEY='この列';
 /* 表示の値で見る行（§9.474・`cellFormat.ruleRow()`が作る）は**写さない**——写すと全部の列の
    表示の値を作ってしまう（見ている列だけを引くための Proxy）。`[この列]`もその行が答える。 */
 const VIEW_ROW=Symbol('viewRow');
 function calcRow(row,selfCol){
  if(row&&row[VIEW_ROW])return row;
  const r=Object.assign({},row||{});
  if(!(SELF_KEY in r))r[SELF_KEY]=row?row[selfCol]:'';
  return r;
 }
 function runCalc(src,row,selfCol){
  const c=calcOf(src);
  if(!c)return null;
  const v=c.run(calcRow(row,selfCol));
  return v===null||v===undefined?'':v;
 }
 function operand(side,row,selfCol){
  if(!side)return '';
  if(side.kind==='self')return row?row[selfCol]:'';
  if(side.kind==='column')return row?row[side.column]:'';
  if(side.kind==='calc'){const v=runCalc(side.expr,row,selfCol);return v===null?'':v}
  return side.value;
 }
 /* 両辺が数値として読めるときだけ数値で比べ、そうでなければ文字列で比べる
    (実データは同じ項目でも '5' と '05' と '5.0' が混ざる)。**答えは式の`cmp()`の1本**（§9.477）——
    ルールを式へ変換したとき同じ比べ方になるよう、ここでは書き写さない。 */
 const compare=(a,b)=>WL.formula.cmp(a,b);
 function test(cond,row,selfCol){
  const L=operand(cond.left,row,selfCol);
  const ls=String(L==null?'':L);
  if(cond.op==='empty')return ls.trim()==='';
  if(cond.op==='notEmpty')return ls.trim()!=='';
  /* 式そのものが真なら（§9.474）。真偽の読み方は式の`if`／`and`と同じ`WL.formula.truthy`。 */
  if(cond.op==='formula'){
   if(!cond.left||cond.left.kind!=='calc'||!calcOf(cond.left.expr))return false;
   return WL.formula.truthy(L);
  }
  const R=operand(cond.right,row,selfCol);
  const rs=String(R==null?'':R);
  switch(cond.op){
   case 'eq':return ls===rs||compare(L,R)===0;
   case 'ne':return !(ls===rs||compare(L,R)===0);
   case 'contains':return rs!==''&&ls.includes(rs);
   case 'startsWith':return rs!==''&&ls.startsWith(rs);
   case 'endsWith':return rs!==''&&ls.endsWith(rs);
   case 'gt':return compare(L,R)>0;
   case 'ge':return compare(L,R)>=0;
   case 'lt':return compare(L,R)<0;
   case 'le':return compare(L,R)<=0;
   case 'between':{
    const R2=operand(cond.right2,row,selfCol);
    return compare(L,R)>=0&&compare(L,R2)<=0;
   }
   case 'regex':
    // 書き間違いで一覧が壊れないように、不正な正規表現は「当たらない」。
    try{return new RegExp(rs).test(ls)}catch(e){return false}
   default:return false;
  }
 }
 /* ---------- ルールを式へ（§9.474、利用者の指示「条件設定のUIを使って作ったルールを、『この列の作り方』の
    条件式の入力欄に直接入れられるように式変換できる機能」） ----------
    評価（上の`test()`）と**同じ意味の式**を作る。行＝`if`の入れ子（上から順・最初に当たったもの）、
    行の中＝`and`、既定の行＝最後の「偽のとき」。**式にできないもの**（色・引用符を両方含む字）は
    `notes`で言う（黙って落とさない）。`self`＝「この列」を式の中で何と書くか（既定は`[列名]`。
    式の列へ入れるときは、その列のいまの式を括弧で包んで渡す＝自分自身を見ない）。 */
 const NUM_LIT=/^-?(0|[1-9]\d*)(\.\d+)?$/;
 function lit(v,notes,asText){
  const t=String(v==null?'':v);
  if(!asText&&NUM_LIT.test(t))return t;
  if(!t.includes("'"))return `'${t}'`;
  if(!t.includes('"'))return `"${t}"`;
  notes.add(`「${t}」は ' と " を両方含むので式にできません（' を外しました）`);
  return `'${t.replace(/'/g,'')}'`;
 }
 function toFormula(rows,opt){
  const o=opt||{},notes=new Set();
  const selfCol=String(o.column||'');
  const self=o.self||`[${selfCol}]`;
  const fixExpr=e=>`(${String(e||'').split('[この列]').join(self)})`;
  /* `asText`＝文字の関数（contains 等）へ渡す値。数に見えても字のまま（'04' を 4 にしない）。 */
  const side=(sd,asText)=>{
   if(!sd)return "''";
   if(sd.kind==='self')return self;
   if(sd.kind==='column')return `[${sd.column}]`;
   if(sd.kind==='calc')return fixExpr(sd.expr);
   return lit(sd.value,notes,asText);
  };
  const cond=c=>{
   const L=side(c.left);
   switch(c.op){
    case 'formula':return L;
    case 'empty':return `trim(${L}) = ''`;
    case 'notEmpty':return `trim(${L}) <> ''`;
    /* 大小・等しいは**ルールと同じ比べ方**の`cmp()`で書く（§9.477。式の`=`は数を厳しく読むので、
       '04' と 4 でルールと答えが割れた）。値は字のまま渡す（数に読めるかは`cmp`が決める）。 */
    case 'eq':return `cmp(${L}, ${side(c.right,true)}) = 0`;
    case 'ne':return `cmp(${L}, ${side(c.right,true)}) <> 0`;
    case 'gt':return `cmp(${L}, ${side(c.right,true)}) > 0`;
    case 'ge':return `cmp(${L}, ${side(c.right,true)}) >= 0`;
    case 'lt':return `cmp(${L}, ${side(c.right,true)}) < 0`;
    case 'le':return `cmp(${L}, ${side(c.right,true)}) <= 0`;
    case 'between':return `(cmp(${L}, ${side(c.right,true)}) >= 0 and cmp(${L}, ${side(c.right2,true)}) <= 0)`;
    /* 含む・始まる・終わるは、ルールでは**右辺が空なら当たらない**（式の関数は空で真）。正規表現は空でも当たる
       （空の正規表現はどの字にも合う＝ルールも式も同じ）。 */
    case 'contains':case 'startsWith':case 'endsWith':case 'regex':{
     const fn={contains:'contains',startsWith:'startswith',endsWith:'endswith',regex:'match'}[c.op];
     const r=c.right||{};
     if(r.kind==='value'){
      const v=String(r.value==null?'':r.value);
      if(v===''&&c.op!=='regex')return '0';
      /* 壊れた正規表現はルールでは「当たらない」。式に書くと式ぜんたいが読めなくなるので、偽にする。 */
      if(c.op==='regex'){try{new RegExp(v)}catch(e){notes.add(`正規表現「${v}」は読めないので、この条件は「当たらない」にしました`);return '0'}}
      return `${fn}(${L}, ${side(r,true)})`;
     }
     const R=side(r,true);
     if(c.op==='regex')notes.add('正規表現を他の列・式から取る条件は、その値が正規表現として読めない行で式ぜんたいが空になります（ルールでは「当たらない」）');
     return c.op==='regex'?`${fn}(${L}, ${R})`:`(len(${R}) > 0 and ${fn}(${L}, ${R}))`;
    }
    default:notes.add(`知らない比べ方（${c.op}）は式にできません`);return '0';
   }
  };
  const out=r=>{
   const t=r&&r.text;
   if(typeof t==='string'&&t.startsWith('='))return fixExpr(t.slice(1));
   if(t===''||t==null)return self;
   return lit(t,notes);
  };
  /* 「かつ」で組をつなぎ、「または」で組と組をつなぐ。かっこの組はそのまま括弧になる。空の組は当たらない。 */
  const condsExpr=cs=>{
   const gs=groupsOf(cs).map(g=>g.map(c=>isGroup(c)?`(${condsExpr(c.conditions)})`:cond(c)).join(' and '));
   return !gs.length?'0':gs.length>1?gs.map(x=>`(${x})`).join(' or '):gs[0];
  };
  let tail=self,body=[];
  for(const r of (rows||[])){
   if(r.color)notes.add('色（●良い・悪い…）は式にできません。色が要るなら、式の列にも同じルールを付けてください');
   const cs=r.conditions||[];
   if(!cs.length){tail=out(r);break}        /* 既定の行。これより下へは来ない */
   body.push([condsExpr(cs),out(r)]);
  }
  let expr=tail;
  for(let i=body.length-1;i>=0;i--)expr=`if(${body[i][0]}, ${body[i][1]}, ${expr})`;
  if(o.mode==='shown')notes.add('「表示の値」で見ているルールです。式は元のデータで比べます（作り方の式は元のデータから作るため）');
  return {expr,notes:[...notes]};
 }
 /* 当たった行を返す(色も使うので行ごと返す)。当たらなければnull。 */
 function match(name,row,selfCol){
  const rows=(cache&&cache[name])||null;
  if(!rows||!rows.length)return null;
  for(const r of rows){
   const conds=r.conditions||[];
   // **条件が空の行＝どれにも当てはまらなかったとき**の既定。
   if(!conds.length)return r;
   if(condsTrue(conds,row,selfCol))return r;
  }
  return null;
 }
 /* かっこ（利用者の指示「かっこも入れられるようにしたい」）。条件の代わりに**組**
    `{kind:'group',conditions:[…]}`を置ける。組の中も同じ決まり（かつ／または）で、組の中に組も置ける。
    判定・式への変換・見る列は、どれもこの3つを通して組の中まで降りる。 */
 const isGroup=c=>!!c&&c.kind==='group';
 function condsTrue(conds,row,selfCol){
  return groupsOf(conds).some(g=>g.every(c=>isGroup(c)?condsTrue(c.conditions,row,selfCol):test(c,row,selfCol)));
 }
 /* 組の中まで降りて、条件（葉）だけを並べる。 */
 function leavesOf(conds){
  return (conds||[]).flatMap(c=>isGroup(c)?leavesOf(c.conditions):[c]);
 }
 /* 行の中の条件を「または」で区切った群へ（利用者の指示「OR条件も追加で組み込めるように」）。
    条件は`join:'or'`で**そこから新しい群**を始める（無ければ「かつ」）。行が当たるのは
    **どれか1つの群の条件がすべて**当たるとき——「かつ」を先にまとめる（式の and/or と同じ強さ）。
    区切り方の答えは**ここ1箇所**（判定・式への変換・編集窓の見た目が同じ群を見る）。
    サーバーの並べ替えは`sort_order.rule_groups()`が同じ区切り方をする。 */
 function groupsOf(conds){
  const out=[];
  (conds||[]).forEach((c,i)=>{if(!i||(c&&c.join==='or'))out.push([]);out[out.length-1].push(c)});
  return out;
 }
 async function load(force){
  if(cache&&!force)return cache;
  if(inflight&&!force)return inflight;
  inflight=(async()=>{
   try{
    const r=await api('/api/display-rule-master');
    cache=r.rules||{};usageMap=r.usage||{};optMap=r.options||{};
    usedMemo=null;rev++;   /* 中身が変わったので「どの列を見ているか」の控えを捨てる */
   }catch(e){cache=cache||{}}   // 読めなくても読み替えなしで一覧は出す
   inflight=null;return cache;
  })();
  return inflight;
 }
 /* そのルールが**他のどの列を見ているか**（§9.234 ⑥）。
    スケジュール表は行ごとに全列ぶんの値を作ると重い（§9.224で踏んだ罠）ので、
    **要る列だけ**を作るために使う。`kind==='self'`はこの列自身なので数えない。
    ルールの中身が変わるまで結果は同じなので覚える。 */
 let usedMemo=null;
 function columnsUsed(name){
  if(!cache)return [];
  usedMemo=usedMemo||new Map();
  if(usedMemo.has(name))return usedMemo.get(name).slice();
  const out=new Set();
  for(const r of (cache[name]||[])){
   for(const c of leavesOf(r.conditions)){
    for(const side of [c.left,c.right,c.right2]){
     if(side&&side.kind==='column'&&side.column)out.add(String(side.column));
     /* 式が見ている列も要る列（§9.464）。`[この列]`は列ではない。 */
     if(side&&side.kind==='calc'){const cc=calcOf(side.expr);
      if(cc)cc.columns.forEach(k=>{if(k!==SELF_KEY)out.add(String(k))})}
    }
   }
   /* 出す字を式で作る行（`=`で始まる）の列も要る。 */
   if(typeof r.text==='string'&&r.text.startsWith('=')){const cc=calcOf(r.text.slice(1));
    if(cc)cc.columns.forEach(k=>{if(k!==SELF_KEY)out.add(String(k))})}
  }
  const arr=[...out];
  usedMemo.set(name,arr);
  return arr.slice();
 }
 /* ルールの版。**控えの署名に混ぜる**ためのもの（読み直すたびに増える）。 */
 let rev=0;
 /* 当たった行が出す字。**`=`で始まれば式**（§9.464）——抜き出した値そのものを出せる
    （例: `=extract([この列],'[0-9]+')`）。式が空・読めなければ元の値のまま。 */
 function textOf(hit,row,selfCol){
  const t=hit&&hit.text;
  if(typeof t!=='string'||!t.startsWith('='))return t;
  const v=runCalc(t.slice(1),row,selfCol);
  return v===null?'':String(v);
 }
 return {load,match,test,groupsOf,isGroup,leavesOf,columnsUsed,textOf,toFormula,rev:()=>rev,
         all:()=>cache||{},
         names:()=>Object.keys(cache||{}).sort(),
         get:name=>(cache&&cache[name])||[],
         /* そのルールを参照している列(対象・列名)。**分からないときは
            nullを返す**——空配列と同じに扱うと「どこにも使われていない」と
            言い切ってしまう(読めなかっただけかもしれない)。 */
         usage:name=>usageMap?((usageMap[name]||[]).slice()):null,
         /* 条件が見る列の値（§9.474）: 'raw'＝元のデータ／'shown'＝表示の値。ルールごと。 */
         selfMode:name=>((optMap[name]||{}).self==='shown'?'shown':'raw'),
         VIEW_ROW,SELF_KEY,
         /* 編集画面が保存した直後に、一覧へすぐ反映させるための差し替え。 */
         put:(name,rows,opt)=>{cache=cache||{};if(rows&&rows.length)cache[name]=rows;else delete cache[name];
           if(opt)optMap[name]=opt;else if(!rows)delete optMap[name];
           usedMemo=null;rev++},
         forget:()=>{cache=null;optMap={};usedMemo=null;rev++}};
})();
window.WL.displayRules=displayRules;

/* ---------- セルの見せ方(§9.88 段3) ----------
   生の値を「表示する文字列」へ整える。**整形できなかったら生の値を返す**
   ——空欄になるより、見慣れない形でも値が見えるほうがよい(現場で「データが
   消えた」と判断されるのが最悪)。並べ替え・絞り込みは生の値のまま効かせたい
   ので、整形はサーバーへ持ち込まず画面側だけで行う。
   段4(読み替え)はこのパイプラインの**手前**に入る。 */
const cellFormat=(()=>{
 const WEEK=['日','月','火','水','木','金','土'];
 const isBlank=v=>v===null||v===undefined||String(v).trim()==='';
 const pad=(n,w)=>String(Math.abs(n)).padStart(w,'0');

 /* 日付時刻の解釈。取れなかった部分はnullにして、書式側で「その部分を
    求められたら失敗」とする(時刻だけの値に yyyy を要求されたら生の値へ倒す)。
    実データは '2026-08-11 09:30:00' / '2026/08/11' / '20260811' と揺れる。 */
 function parts(v){
  if(v instanceof Date)return isNaN(v)?null:
   {y:v.getFullYear(),M:v.getMonth()+1,d:v.getDate(),H:v.getHours(),mi:v.getMinutes(),s:v.getSeconds()};
  const t=String(v==null?'':v).trim();
  if(!t)return null;
  // 日付を持たない値(時刻だけ)もあるので、**null は「無い」であって不正ではない**。
  const ok=p=>((p.M==null||(p.M>=1&&p.M<=12))&&(p.d==null||(p.d>=1&&p.d<=31))
               &&p.H<=23&&p.mi<=59&&p.s<=59)?p:null;
  let m=/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(t);
  if(m)return ok({y:+m[1],M:+m[2],d:+m[3],H:+(m[4]||0),mi:+(m[5]||0),s:+(m[6]||0)});
  m=/^(\d{4})(\d{2})(\d{2})(?:[ T]?(\d{2})(\d{2})(\d{2})?)?$/.exec(t);
  if(m)return ok({y:+m[1],M:+m[2],d:+m[3],H:+(m[4]||0),mi:+(m[5]||0),s:+(m[6]||0)});
  m=/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(t);
  if(m)return ok({y:null,M:null,d:null,H:+m[1],mi:+m[2],s:+(m[3]||0)});
  return null;
 }
 /* Excel/.NET風のパターン。日=d 月=M 時=H 分=m と大文字小文字で区別する
    (Excelの「文脈で月か分か決まる」は説明できないので採らない)。
    'リテラル' で囲むとその文字はそのまま出る。 */
 const TOKEN=/yyyy|yy|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|tt|'[^']*'/g;
 function stamp(p,pattern){
  const need=k=>{if(p[k]==null)throw 0;return p[k]};
  const h12=()=>{const h=need('H')%12;return h===0?12:h};
  return String(pattern).replace(TOKEN,tok=>{
   switch(tok){
    case 'yyyy':return pad(need('y'),4);
    case 'yy':return pad(need('y')%100,2);
    case 'MM':return pad(need('M'),2);
    case 'M':return String(need('M'));
    case 'dddd':case 'ddd':{
     const w=WEEK[new Date(need('y'),need('M')-1,need('d')).getDay()];
     return tok==='dddd'?w+'曜日':w;
    }
    case 'dd':return pad(need('d'),2);
    case 'd':return String(need('d'));
    case 'HH':return pad(need('H'),2);
    case 'H':return String(need('H'));
    case 'hh':return pad(h12(),2);
    case 'h':return String(h12());
    case 'mm':return pad(need('mi'),2);
    case 'm':return String(need('mi'));
    case 'ss':return pad(need('s'),2);
    case 's':return String(need('s'));
    case 'tt':return need('H')<12?'午前':'午後';
    default:return tok.slice(1,-1);       // 'リテラル'
   }
  });
 }
 function groupThousands(s){
  const m=/^(-?)(\d+)(\.\d+)?$/.exec(s);
  if(!m)return s;
  return m[1]+m[2].replace(/\B(?=(\d{3})+(?!\d))/g,',')+(m[3]||'');
 }
 function asNumber(v){
  const t=String(v==null?'':v).trim().replace(/,/g,'');
  if(!t||!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t))return null;
  const n=Number(t);
  return Number.isFinite(n)?n:null;
 }
 /* 指定1つを値へ当てる。整形できなければnullを返し、呼び出し側が生の値を出す。 */
 function run(spec,raw){
  if(!spec)return null;
  const kind=spec.kind||'';
  if(kind==='number'){
   const n=asNumber(raw);
   if(n===null)return null;
   let s=spec.decimals==null||spec.decimals===''?String(n):n.toFixed(spec.decimals);
   if(spec.thousands)s=groupThousands(s);
   return (spec.prefix||'')+s+(spec.suffix||'');
  }
  if(kind==='datetime'){
   const p=parts(raw);
   if(!p)return null;
   try{return stamp(p,spec.pattern||'yyyy/MM/dd')}catch(e){return null}
  }
  if(kind==='text')return (spec.prefix||'')+String(raw).trim()+(spec.suffix||'');
  return null;                            // 種別なし=そのまま
 }
 /* 表示用の文字列。**空欄は空欄のまま**(単位だけが並ぶ列にしない)。 */
 function value(spec,raw){
  if(isBlank(raw))return '';
  const out=run(spec,raw);
  return out===null?String(raw):out;
 }
 /* 1つのセルが表示されるまで(設計の順序をそのままここに置く)。
      生の値 → 読み替えが当たれば**その言葉で確定**(整形しない)
             → 当たらなければ書式で整形
             → 整形できなければ生の値
    読み替えが先なのは、読み替えが生の値を見て判断するものだから
    ('00'を'0'へ整形してから読み替えると当たらない)。
    戻り値は {text, color}。colorは読み替えが指定したときだけ入る。 */
 /* **読み替えが見る行**（§9.474、利用者の指示「データをもとのまま使うか、設定範囲内で変換された
    データを使うか選べるように」「他の列だったとしても…元データのみを対象にしている」）。
      raw   … 元のデータ。ただし**この列**が式の列なら式の結果（元のデータを持たないため）
      shown … 表示の値。この列は「作り方の式→値の整え方」の結果、他の列は**その列の表示**
              （作り方の式→読み替え→値の整え方）。画面が`opt.view`で「列がどう見えるか」を渡す
    **見ている列だけを引く**（Proxy・行ごとに全列を作らない・§9.224）。巡る参照（A の読み替えが B を、
    B の読み替えが A を見る）は、巡った列の読み替えを外して止める。 */
 const hasOwn=(o,k)=>!!o&&Object.prototype.hasOwnProperty.call(o,k)&&o[k]!==undefined;
 function ruleRow(rule,opt,stack){
  const row=opt.row||{},col=opt.column;
  const shown=displayRules.selfMode(rule)==='shown';
  const own=shown?value(opt.format,opt.raw):(hasOwn(row,col)?row[col]:opt.raw);
  const view=opt.view||{};
  if(!shown){
   /* 元のデータ。**式の列は元のデータを持たない**ので、他の列でも式の結果を返す（この列と同じ扱い）。 */
   if(!view.calc&&!view.raw){
    if(hasOwn(row,col)&&row[col]===own)return row;
    return Object.assign({},row,{[col]:own});
   }
   const memoR=new Map([[col,own],[displayRules.SELF_KEY,own]]);
   return new Proxy(row,{
    get(t,k){
     if(k===displayRules.VIEW_ROW)return true;
     if(typeof k!=='string')return t[k];
     if(memoR.has(k))return memoR.get(k);
     let v;
     if(hasOwn(t,k))v=t[k];
     else{
      const key=view.key?view.key(k):k;
      const calc=view.calc?view.calc(key):null;
      v=view.raw?view.raw(key):calc?calc.run(t):t[key];
     }
     memoR.set(k,v);return v;
    },
    has(t,k){return typeof k==='string'||k in t}
   });
  }
  const memo=new Map([[col,own],[displayRules.SELF_KEY,own]]);
  const seen=stack||new Set();
  seen.add(col);
  /* `n`は式・条件に書いた名前（表示名のこともある）。どの列かは画面が答える（`view.key`・§9.464）。 */
  const shownOf=n=>{
   const k=view.key?view.key(n):n;
   const calc=view.calc?view.calc(k):null;
   const rawK=view.raw?view.raw(k):calc?calc.run(row):(hasOwn(row,k)?row[k]:row[n]);
   const fmt=view.format?view.format(k):null;
   const r=view.rule?view.rule(k):'';
   if(!r||seen.has(k))return value(fmt,rawK);
   return inner({raw:rawK,format:fmt,rule:r,row,column:k,view},seen).text;
  };
  return new Proxy(row,{
   get(t,k){
    if(k===displayRules.VIEW_ROW)return true;
    if(typeof k!=='string')return t[k];
    if(!memo.has(k))memo.set(k,shownOf(k));
    return memo.get(k);
   },
   has(t,k){return typeof k==='string'||k in t}
  });
 }
 function inner(opt,stack){
  const raw=opt&&opt.raw;
  const rule=opt&&opt.rule;
  if(rule){
   const row=ruleRow(rule,opt,stack?new Set(stack):null);
   const hit=displayRules.match(rule,row,opt.column);
   // 表示値が空の行は「元の値のまま出す」(当たったことは色で示せる)。
   if(hit){
    const t=displayRules.textOf(hit,row,opt.column);
    return {text:t!==''&&t!=null?String(t):value(opt.format,raw),color:hit.color||''};
   }
  }
  return {text:value(opt.format,raw),color:''};
 }
 const cell=opt=>inner(opt,null);
 /* **列レイアウトの対象から「列の見え方」を作る**（§9.479、利用者の指示「1から4まで順番に」の3）。
    表示の値（§9.474）が効くには画面が`view`を渡す必要があり、一覧・スケジュール表・列の設定の下書きの
    3つしか渡していなかった。行に全列の値が載っている画面（測定データ一覧・実績データ・操業データの紙）は
    **この1本**で足りる: 書式・読み替え・作り方の式はその対象の列レイアウト、名前→列は`keyByName`。
    `keys`＝行の列名（名前で引くため）、`format`＝列レイアウトに書式が無いときの既定（画面が持つ列の既定）。 */
 const fxOf=new Map();
 /* 式を解くのは1回（控えつき）。空の式は`null`＝式なし。壊れた式は空を返す器（列は残す）。 */
 function fx(src){
  if(!src)return null;
  if(!fxOf.has(src)){let c;try{c=WL.formula.compile(src)}catch(e){c={run:()=>'',columns:[]}}
   if(fxOf.size>200)fxOf.clear();fxOf.set(src,c)}
  return fxOf.get(src);
 }
 function viewOf(target,opt){
  const o=opt||{},keys=o.keys||null;
  return {
   key:n=>(keys&&columnLayout.keyByName(target,typeof keys==='function'?keys():keys,n))||n,
   calc:k=>fx(columnLayout.formula(target,k)),
   format:k=>columnLayout.format(target,k)||(o.format?o.format(k):null),
   rule:k=>columnLayout.rule(target,k)
  };
 }
 /* **行のその列の値**（§9.489、利用者の指示「元データのところでも『この列の作り方』の計算式を…」）。
    作り方の式があれば式の結果、無ければ行の値——**計算列も元データの列も同じ1本**。式は元の行を読むので、
    元データの列の式は`[自分の名前]`で元の値を読める（式の結果を読み直さない＝巡らない）。
    行に全列が載る画面（測定実績・操業データの紙）はこれを通す。 */
 function rawOf(target,row,k){
  const c=fx(columnLayout.formula(target,k));
  return c?c.run(row||{}):(row?row[k]:undefined);
 }
 return {value,parts,cell,rawOf,
         text:(target,col,raw)=>value(columnLayout.format(target,col),raw),
         /* 読み替えが見る行そのもの（編集画面の「試してみる」が同じ答えを使う・§9.474）。 */
         ruleRow:(rule,opt)=>ruleRow(rule,opt||{},null),
         viewOf};
})();
window.WL.cellFormat=cellFormat;
function databaseLabel(key){
 if(key==='MASTER')return 'マスタ';
 return WL.dataSource.label(key)||'データ';
}
// Application equipment setting and design-course guard.
const APP_EQUIPMENT_KEY='AccessMeasurementConfiguredEquipment';
function currentConfiguredEquipment(){return String(localStorage.getItem(APP_EQUIPMENT_KEY)||'').trim()}
/* ---------- 使用設備は「1箇所で書き、変わったら知らせる」（§9.285 ①） ----------
   利用者の報告「フィルタの変数『使用設備』が、使用設備を切り替えてもその
   切り替えた瞬間に反映されない」。

   `{使用設備}`は**送信直前に展開する**（§9.74）ので、次に問い合わせれば
   新しい設備で絞られる。ところが**次の問い合わせを起こす人が居なかった**
   ——設定窓は`localStorage`へ書くだけで、いま出ている一覧も絞り込みバーの
   「（=◯◯）」も古い設備のまま残っていた（値は正しいのに画面が嘘をつく）。

   **書き込みは`set()`の1箇所**にして、そこから知らせる。散らばった場所で
   「設備を変えたら◯◯も直す」を気を付けるのではなく、**気にする側が
   名乗り出る**（`onChange`）。読み方は今までどおり
   `currentConfiguredEquipment()`——70箇所の呼び出しは1つも変えない。

   **同じ値なら知らせない**——押し直しただけで一覧が読み直されると、
   触っていないのに画面がちらつく（§9.131「同じ値なら触らない」）。 */
(()=>{
 const subs=[];
 window.WL=window.WL||{};
 WL.equipment={
  get:currentConfiguredEquipment,
  set(name){
   const prev=currentConfiguredEquipment(),next=String(name||'').trim();
   localStorage.setItem(APP_EQUIPMENT_KEY,next);
   if(next===prev)return next;
   /* **1人が落ちても残りへ届ける**——知らせは片道なので、途中で止まると
      「設備によって直る画面と直らない画面がある」が作れる。 */
   subs.forEach(fn=>{try{fn(next,prev)}catch(e){console.error('equipment onChange failed',e)}});
   return next;
  },
  onChange(fn){if(typeof fn==='function')subs.push(fn);return fn}
 };
})();
/* 更新対象者（ユーザーID）の管理。マスタ更新時にサーバーへ送信し記録する。 */
const USER_ID_KEY='AccessMeasurementUserId';
function currentUserId(){return String(localStorage.getItem(USER_ID_KEY)||'').trim()}
function setUserId(id){id=String(id||'').trim().slice(0,50);if(id)localStorage.setItem(USER_ID_KEY,id);return id}
/* ユーザーIDはこの端末を動かしているWindowsのログインIDを自動取得して
   使う(入力を求めない)。起動直後に一度だけ/api/whoamiへ問い合わせて
   キャッシュする。取得できるまでの短い間にマスタ更新が走った場合は、
   記録が空欄のまま残る(手入力プロンプトへは戻さない)。 */
async function fetchWhoami(){try{const r=await api('/api/whoami');return String(r.username||'').trim()}catch(_){return ''}}
queueMicrotask(async()=>{if(!currentUserId()){const name=await fetchWhoami();if(name)setUserId(name)}});
function ensureUserId(){return currentUserId()}
function withUserId(body){return Object.assign({},body||{},{user_id:ensureUserId()})}
function designCourseValue(){return sourceField(['設計_設備ｺｰｽ','設計_設備コース'])}
function actualCourseValue(){return sourceField(['実績_設備ｺｰｽ','実績_設備コース'])}
function residualCourseValue(){return sourceField(['残仕掛設備ｺｰｽ','残仕掛設備コース'])}
function normalizeCourseText(v){return String(v||'').normalize('NFKC').toUpperCase().replace(/[\s　]+/g,'')}
function equipmentIsInDesignCourse(equipment,course){const e=normalizeCourseText(equipment),c=normalizeCourseText(course);return !!e&&!!c&&c.includes(e)}
document.title='測定伝送システム';
/* ---------- ヘッダーの「今どこを見ているか」(§9.60) ----------
   以前はlist-view.jsのapplyTableData()だけが#fileNameへDBのファイル名を
   書いており、他の画面(データ一覧・スケジュール・ダッシュボード・カレンダー・
   マスタ管理)へ移っても消さなかった。そのため「データ一覧を見ているのに
   ヘッダーはSIKALOTNOW.sqlite3」という、直前に見たDBの名残がずっと残る
   状態になっていた。

   画面の名前(何を見ているか)を主、データの出どころ(どのファイル/どの範囲か)
   を副として出す。副が無い画面もあるので、その場合は主だけを出す。
   **画面を開く関数は必ずこれを呼ぶこと**(呼ばないと前の画面の名残が残る)。 */
function setHeaderContext(title,source){
 const t=document.querySelector('#fileName');if(t)t.textContent=title||'測定伝送システム';
 const s=document.querySelector('#headerContextSource');
 if(s){s.textContent=source||'';s.hidden=!source}
 /* 操作を1行目へ相乗りさせる画面では説明を畳む（§9.266）。**消さずに
    `title`へ残す**——1回読めば足りる文だが、読めなくしてよい訳ではない。 */
 if(t)t.title=source?(title?title+'：'+source:source):'';
 // 画面が変わったら鮮度表示(一覧専用)は持ち越さない
 if(typeof window.updateListFreshness==='function'&&!source)window.updateListFreshness(null);
}
window.setHeaderContext=setHeaderContext;
/* ---------- 画面(ビュー)の登録簿 ----------
   トップレベルの画面(データ一覧・仕掛/品質・スケジュール・ダッシュボード・
   実績カレンダー・マスタ管理・帳票)は排他で、常にどれか1つだけが開いている。

   以前は各openXxxが「他の画面を全部閉じる」コードを自前で持っていた
   (6画面 × 約10行)。画面を1つ足すたびに既存の全ファイルへ退出処理を足す
   掛け算構造で、**§9.60(ヘッダー表示の取り残し)はこの構造の取りこぼし**。
   実際、統一する直前の時点で次の不揃いが残っていた:
     - #measureModal を閉じるのは6画面中3画面だけ
     - ナビの選択解除が #nav だけで #analysisNav / #planNav を取りこぼす画面が4つ
     - #qualityAnalysisPanel を隠すのは実績カレンダーだけ
   各画面は「自分の閉じ方と見出し」だけを登録し、切替の手順はenterView()に
   一本化する。これで退出処理の抜けが構造的に起きなくなる。 */
/* このセッションで新設した共通機能の公開先。CLAUDE.mdの規約どおり、
   新しく公開するものは素の window.X ではなく名前空間へ入れる
   (素の window.X を増やすとファイル間の暗黙の契約が増え、読み込み順への
   依存が見えなくなる)。既存の約70件は動いている契約なので触らない。
   呼び出し側も WL.enterView(...) のように書き、どのファイルの機能に
   依存しているかが呼び出し箇所で分かるようにする。 */
window.WL=window.WL||{};

/* DOMが組み上がってから動かす(§9.86)。
   **`DOMContentLoaded` を直接待たないこと。** アプリのJSは起動オーバーレイを
   先に描かせるため、index.htmlの起動ローダーが後から読み込む。その時点では
   DOMContentLoadedは既に終わっているので、直接待ち受けても二度と呼ばれない
   (実際に「再読込ボタンが効かない」形で踏んだ)。この関数は済んでいれば
   すぐ呼ぶので、どちらの読まれ方でも1回だけ実行される。 */
function onReady(fn){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fn,{once:true});
 else queueMicrotask(fn);
}
window.WL.onReady=onReady;

/* 「この読み込みは遅いか」の答えは1箇所（§9.340、§9.163）。
   **速いときに毎回ミリ秒を並べても読まれない**ので、読み込みの秒数を画面へ
   出すのは遅かったときだけ——という約束（§9.198）を、作業スケジュールと
   一覧の**両方**がここを見て守る。以前はスケジュール1200ms・一覧1500msと
   数が2つあり、しかも一覧は数を持っているだけで**常に出していた**。 */
window.WL.slowLoadMs=1200;

const VIEW_REGISTRY=new Map();
function registerView(def){VIEW_REGISTRY.set(def.key,def);return def}
/* 新しい画面へ入る。key以外の登録済み画面を全て閉じ、ナビの選択状態・
   ヘッダー表示・bodyクラスを新しい画面のものへ揃える。
   **画面を開く関数は、自分の描画を始める前にこれを1回呼ぶこと。**
   opts.header で見出しを差し替えられる(同じ画面で見出しが変わる場合)。 */
/* いま開いている画面。ハートビートが在席と一緒に伝える（§9.272）。 */
WL.currentView='';
const PRINT_HINT_DEFAULT='いま表示している画面をそのまま印刷します。帳票を印刷する場合は測定画面の「帳票」から開いてください';
/* ヘッダーの「画面を印刷」が呼ぶ1本（§9.525）。画面が`print`を名乗っていればそれ、無ければブラウザの印刷。 */
WL.printCurrentView=opt=>{
 const def=VIEW_REGISTRY.get(WL.currentView);
 if(def&&typeof def.print==='function')return def.print(opt);
 window.print();
};
WL.printHintDefault=PRINT_HINT_DEFAULT;
function enterView(key,opts){
 WL.currentView=String(key||'');
 VIEW_REGISTRY.forEach((v,k)=>{
  if(k===key)return;
  // 1つの画面の終了処理が例外を投げても、残りの画面は必ず閉じる
  // (閉じ残しは画面の重なりとして必ず表に出るため、握り潰さず警告は出す)。
  try{v.exit?.()}catch(e){console.warn('画面の終了処理で例外',k,e)}
 });
 // 画面をまたいで残ると重なるオーバーレイ。閉じるのは全画面共通。
 // ただし**未保存の変更があるときは閉じない**。ここでhidden属性を立てるのは
 // WL.records.closeMeasureModal()の破棄確認(「保存されていない変更があります。破棄して
 // 閉じますか？」)を迂回する経路で、そのまま閉じると入力中の測定値を無言で
 // 捨てることになる。現状は.modal{inset:0}が全面を覆うので測定中にサイドバーを
 // 押せず到達しないが、モーダルを全画面でなくしたり測定中に押せる導線を足すと
 // 静かなデータ損失に化ける。閉じない場合は理由を知らせる。
 const measureModal=document.getElementById('measureModal');
 if(measureModal&&!measureModal.hidden){
  if(measureDirty)showToast('測定画面はそのままにしました',
   '保存されていない変更があります。測定画面の「閉じる」から破棄を確認してください。',5200);
  else measureModal.setAttribute('hidden','');
 }
 // ナビの選択は排他。どのナビ群に置かれたボタンでも一度全部外す。
 document.querySelectorAll('aside .nav-item,#nav button.db,#analysisNav button.db,#planNav button.db')
  .forEach(b=>b.classList.remove('active'));
 const def=VIEW_REGISTRY.get(key);
 if(!def)return null;
 if(def.bodyClass)document.body.classList.add(def.bodyClass);
 /* **「印刷」は画面ごとに1つだけ**（§9.300 ①、利用者の指示「一番上の表示も
    含めて冗長な重複した表示内容…見直し」）。ヘッダーの「画面を印刷」
    （`#printCurrentView`。品質データ分析が作って`.global-actions`へ置いたまま
    残る汎用の操作）は、専用の印刷を持つ画面では重複する——実機の作業
    スケジュールでは上の行に「画面を印刷」・操作列に「印刷」が並んでいた。
    **判定は画面が名乗る**（`ownPrint`）——以前はCSS側で
    `body.rp-mode,body.qa-mode`と**画面の名前を並べて**おり、あとから
    専用の印刷を持った画面（作業スケジュール）だけが静かに二重になった
    （§9.233 ③と同じ形）。名乗る形なら、画面を足す人が自分の登録で完結する。 */
 document.body.classList.toggle('view-own-print',!!def.ownPrint);
 /* 「画面を印刷」の中身も画面が名乗れる（`print`・§9.525）。名乗らない画面は今までどおり
    ブラウザの印刷。何が刷られるか（用紙・向き）は`printHint`がボタンの説明で言う。 */
 const pb=document.getElementById('printCurrentView');
 if(pb)pb.title=def.printHint||PRINT_HINT_DEFAULT;
 if(def.nav)document.getElementById(def.nav)?.classList.add('active');
 const h=opts?.header||def.header;
 if(h)setHeaderContext(h[0],h[1]);
 mountViewToolbar(def);
 return def;
}
/* ---------- 画面ごとの操作列をヘッダーへ相乗りさせる ----------
   各画面は自前の見出しバー(画面名+操作ボタン)を持っていた。画面名は
   ヘッダーの`#fileName`と同じ文字が二重に出るうえ、バー1本ぶん(40〜50px)
   本文の高さを食う。**画面名はヘッダーだけが持ち、操作ボタンは
   ヘッダーの`#headerViewBar`へ移す**。

   DOMを「移動」させる(コピーではない)ので、既に張られているイベント
   ハンドラ・id参照はそのまま生きる。退出時は元の親へ戻すため、画面側の
   組み立てコード(ensurePanel等)は自分の構造を知っていればよい。
   registerView({toolbar:'#scHeadRight'}) のようにセレクタで指定する。 */
const toolbarHome=new WeakMap();
function mountViewToolbar(def){
 const slot=document.getElementById('headerViewBar');
 if(!slot)return;
 // 直前の画面のものを元の場所へ戻す(戻し先を覚えていないものは捨てない)。
 [...slot.children].forEach(el=>{
  const home=toolbarHome.get(el);
  if(home&&home.parent)home.parent.insertBefore(el,home.next&&home.next.parentNode===home.parent?home.next:null);
  else el.remove();
 });
 const sel=def&&def.toolbar;
 if(!sel)return;
 const el=document.querySelector(sel);
 if(!el||el.parentNode===slot)return;
 if(!toolbarHome.has(el))toolbarHome.set(el,{parent:el.parentNode,next:el.nextSibling});
 slot.appendChild(el);
 /* **操作が少ない画面は1行目へ相乗りさせる**（§9.266、利用者の指示
    「上部のメニューがごちゃついている…1行に収める」）。操作列は既定では
    ヘッダーの2行目（どの画面でも同じ位置に出るため）だが、マスタ管理は
    操作が3つしかなく、2行目を1本まるごと使うのは面積の配り方として
    合っていない（面積は頻度×重要度・§CLAUDE 1）。
    **入りきらない画面は今までどおり2行目**——`compactToolbar`と名乗った
    画面だけが相乗りする（勝手に詰め込むと、操作の多い画面が切れる）。 */
 slot.dataset.compact=def&&def.compactToolbar?'1':'';
 fitViewToolbar();
}
/* ---------- 相乗りは**入るときだけ**（§9.509） ----------
   1行目の幅は画面名・状態の札・全体操作の合計で決まり、札の幅は**モード・使用設備・表示サイズ・窓の幅**で
   動く。§9.508 で札が「名前 値」の1行になって約200px広がると、1366pxのマスタ管理で**画面名が札の下へ
   潰れた**（6通り中5・実測）。`compactToolbar`は「載せたい」という名乗りで、載せるかどうかは**測って**
   決める——まず1行目へ載せてみて、画面名の器が中身より狭ければ（題が溢れていれば）既定の2行目へ戻す。
   載せる／戻すは同じフレームの中で済むので、ちらつかない。 */
function fitViewToolbar(){
 const slot=document.getElementById('headerViewBar');
 if(!slot)return;
 slot.classList.toggle('is-inline',slot.dataset.compact==='1');
 if(!slot.classList.contains('is-inline'))return;
 const ctx=document.querySelector('main>header>.hd-context');
 const over=e=>!!e&&e.scrollWidth>e.clientWidth+1;
 if(over(ctx)||over(slot))slot.classList.remove('is-inline');
}
/* 測り直すのは**1行目の幅を動かすもの**が変わったとき——ヘッダーの幅（窓の幅・左メニューの幅）と
   状態の札の幅（モード・使用設備・表示サイズ）。見張りは`ResizeObserver`の1つで両方を見る
   （`resize`と`wl:look-change`を別に聞くと、札の見張りと同じ役を二重に持つ）。相乗りを切り替えると
   ヘッダーの**高さ**が変わってもう1回呼ばれるが、幅が同じなら答えも同じなので、そこで止まる。 */
(()=>{const hd=document.querySelector('main>header'),st=hd&&hd.querySelector('.hd-status');
 if(!st||typeof ResizeObserver!=='function')return;
 const ro=new ResizeObserver(fitViewToolbar);ro.observe(hd);ro.observe(st)})();
/* 画面のパネルは enterView の**後**に組み立てられることが多い(ensurePanel等)。
   その場合、enterView の時点では操作列のDOMがまだ無く移せない。パネルを
   組み立て終えた画面はこれを呼んで載せ直す(何度呼んでも安全)。 */
function syncViewToolbar(key){mountViewToolbar(VIEW_REGISTRY.get(key))}
/* 画面の切替としての`selectDb()`と、ある画面が自分の中身を組み立てるために
   一覧を読み直すだけの`selectDb()`を区別する。後者(スケジュールの分割表示)で
   画面の切替を起こすと、組み立て中のスケジュール画面自身が畳まれてしまう。
   「scheduleモードかつ設備選択済みなら閉じない」という**状態**による代用は
   避けること——それだと利用者がサイドバーの「仕掛(現在)」を押して一覧へ
   移ったつもりでも、スケジュールパネルと幅調整の分割バーが残る
   (実際に報告された不具合。schedule-view.jsのコメント参照)。判定は
   あくまで「呼び出し元が内部かどうか」で行う。 */
let internalDbSwitchDepth=0;
async function withInternalDbSwitch(fn){
 internalDbSwitchDepth++;
 try{return await fn()}finally{internalDbSwitchDepth--}
}
function isInternalDbSwitch(){return internalDbSwitchDepth>0}
/* ---------- TTL付きキャッシュ(新しく作るキャッシュはこれを使う) ----------
   同種のキャッシュが微妙に違う実装で6箇所以上あり(tableCache/tablesCache/
   scPlanCache/scWorkable/dbCache/sikaTablePromise)、書くたびに
   「期限切れの判定」「取得中の重複呼び出し」を作り直していた。
   ここで2つの決まりごとを1箇所にまとめる:

     1. 期限切れは**読むときに捨てる**(書くときに掃除しない)。
        件数の上限も設け、条件を変えるたびに際限なく増えるのを防ぐ。
     2. **取得中のPromiseを持つ**。同じキーへ同時に問い合わせが来ても
        呼び出しは1回にする。ただし失敗したPromiseは必ず捨てる——
        残すと以後ずっと同じ失敗を返し続け、再試行できなくなる
        (lot-split.jsのresolveSikaTableが`.catch`で消しているのと同じ理由)。

   **既存のキャッシュは置き換えないこと**。それぞれ無効化の条件が業務仕様と
   絡んでおり(例: §9.67の作業可否は「一度可になったら再取得しない」)、
   一括置換はその仕様を落とす。新規のみこのヘルパを使う。 */
function ttlCache(ttlMs,maxEntries=40){
 const store=new Map(),inflight=new Map();
 const alive=e=>e&&(Date.now()-e.at)<=ttlMs;
 return {
  get(key){
   const e=store.get(key);
   if(!alive(e)){if(e)store.delete(key);return null}
   return e.value;
  },
  set(key,value){
   store.set(key,{value,at:Date.now()});
   if(store.size>maxEntries)store.delete(store.keys().next().value);
   return value;
  },
  /* キャッシュにあればそれを返し、無ければloader()で取る。取得中に同じキーが
     来たら同じPromiseを返す(呼び出しは1回)。失敗したら取得中の記録を消す。 */
  async fetch(key,loader){
   const hit=this.get(key);
   if(hit!==null)return hit;
   if(inflight.has(key))return inflight.get(key);
   const p=Promise.resolve().then(loader)
    .then(v=>{inflight.delete(key);return this.set(key,v)})
    .catch(e=>{inflight.delete(key);throw e});
   inflight.set(key,p);
   return p;
  },
  invalidate(key){
   if(key===undefined){store.clear();inflight.clear();return}
   store.delete(key);inflight.delete(key);
  },
  get size(){return store.size},
 };
}
/* レコードのstatus文字列からバッジ用のCSSクラス/表示ラベルを求める共通関数。
   以前はcalendar-view.js/report-dashboard.jsに同一内容が重複定義され、
   records-store.jsは一覧行のレンダリングで同じ判定をインラインで
   再実装していた(コア5ファイル内での同名関数の再定義を避ける方針のため一本化)。 */
function statusClass(s){return s==='完了'?'done':s==='測定値NG'?'ng':''}
function statusLabel(s){return s||'編集中'}
/* 一覧グリッドのように表示幅が狭い場所向けの短縮ラベル(NG登録のみ「NG」と省略)。 */
function statusShortLabel(s){return s==='測定値NG'?'NG':statusLabel(s)}
function durationMs(record){const a=record?.workTime?.startAt,b=record?.workTime?.endAt;if(!a||!b)return null;const ms=new Date(b)-new Date(a);return Number.isFinite(ms)&&ms>=0?ms:null}
/* 実働時間は**分まで**（§9.242 ①、利用者の指示「秒数は不要です」）。
   開始・終了の欄が分刻み（`step="60"`）になったので、秒の位は必ず0になる
   ——出しても嘘の精度が増えるだけ。**1時間未満は「N分」だけ**にする
   （`0時間 8分`は0を読ませるぶん遅い）。
   丸めは四捨五入——古い記録には秒が入っており、切り捨てると59秒が0分になる。
   **書き方そのものは`WL.duration`が持つ**（§9.341）。ここはミリ秒を分へ
   直す入口だけを受け持つ（以前はここだけ`2時間 30分`と空白を挟んでおり、
   同じ作業時間が画面によって`2時間30分`にも`150分`にもなっていた）。 */
function formatDuration(ms){if(ms===null||ms===undefined)return '-';return WL.duration.text(Math.round(ms/60000))}
/* Measurement precision and zero-order-tolerance correction. */
/* ---------- 桁は「測定器が保証できるところまで」（§9.320-C、利用者の指示） ----------
   「自動登録で使うものについては、測定機器によって保証できる測定精度が
    違うため、最終的な測定値は自動転送で判断される測定機器の情報で見極め
    データの桁数を変更するようにしてください。……明示的にロジックとして
    マイクロメータ＝小数点以下3桁を適用してください。板幅については、
    ノギスは小数点2桁、コンベックスルールの場合は小数点1桁までの保証」

   §9.242 ②の「板幅は測定器によらず小数2桁」は**撤回した**。あれは
   「入口が両方1桁へ丸めていたのでノギスの2桁目が必ず0だった」という
   **不具合**を直した副作用で、器ごとの精度をそろえる根拠は無い
   ——コンベックスルールで測った値に2桁目を書くと、**測っていない桁を
   測ったことにする**（画面が嘘をつく・§CLAUDE 6）。

   **桁を決めるのはここ1箇所**（§9.163）。転送・手入力・欄を離れたとき・
   読み直しが同じ答えを見る。**器が分からなければ項目の桁**（手入力と
   古い記録はここへ落ちる。黙って1桁にすると既にある値が痩せる）。 */
const MEASURE_DEVICE_DIGITS={micrometer:3,caliper:2,tape:1};
/* 呼び名も1箇所（画面へ綴りを書き写さない）。`depth`はデプスゲージで、
   桁を持たない項目（テレスコープ）にしか来ないので表には載せるが数は無い。 */
const MEASURE_DEVICE_LABELS={micrometer:'マイクロメータ',caliper:'ノギス',
  tape:'コンベックスルール',depth:'デプスゲージ',manual:'手入力'};
function measureDeviceLabel(device){return MEASURE_DEVICE_LABELS[String(device||'')]||''}
/* いまの記録が「その項目を最後にどの器で受けたか」。**記録の中に持つ**
   ——画面の変数だと、続きを別のPCで開いたときに桁が変わる（§9.91）。 */
function measureDeviceOf(key){
 const d=S.measure&&S.measure.settings&&S.measure.settings.deviceOf;
 return (d&&d[key])||'';
}
function noteMeasureDevice(key,device){
 const m=S.measure;if(!m||!key||!device)return;
 if(!MEASURE_DEVICE_DIGITS[device])return;      /* 桁を持つ器だけ覚える */
 m.settings=m.settings||{};
 m.settings.deviceOf=Object.assign({},m.settings.deviceOf,{[key]:device});
}
function measurementDigits(key,device){
 const base=key==='thickness'?3:key==='width'?2:null;
 if(base===null)return null;
 const d=MEASURE_DEVICE_DIGITS[String(device===undefined?measureDeviceOf(key):(device||''))];
 return d===undefined?base:d;
}
function fixedMeasurementValue(key,value,device){const raw=String(value??'').trim(),digits=measurementDigits(key,device);if(raw===''||digits===null)return raw;const n=Number(raw);return Number.isFinite(n)?n.toFixed(digits):raw}
/* ---------- 入力値の丸め（§9.305 ①／§9.307、利用者の指示） ----------
   「0.5単位切り上げなど、入力値の切り上げ機能を実装してください。
    導入したい項目は ①ラテラルボー ②テレスコープ ③巻ズレ ④揃いの値」

   **専用のマスタは作らない**（§9.307、利用者の指摘「『入力値の丸め』マスタが
   『操業データ項目』マスタと被っており…今のままなら特に必要ないです」）。
   汎用の設定は**操業データ項目マスタの「刻み」**が既に持っているので、
   そこへ丸め方を1つ足せば済む（`measure-opdata.js`）。

   **ここが持つのは4つだけ**——測定表（ラテラルボー・テレスコープ・巻ずれ）と
   丈別データ（揃いの値）は**操業データ項目ではない**ので「刻み」では届かない
   （測定表は条×丈の2次元、丈別データは行の欄で、どちらもコード側の欄）。

   **ラテラルボーの0.5刻み切り上げはもともとコードに在った**——ただし
   `type==='ラテラルボー'`のときだけ、しかも**転送の経路でしか効いていなかった**
   （手入力では効かない）。表にして1箇所へ移したので、手入力にも効く。
   見え方は転送・手入力とも0.5刻みでそろう（§9.132）。 */
const MEASURE_ROUND={
 lateral:{unit:.5,mode:'切り上げ'},
 telescope:{unit:.5,mode:'切り上げ'},
 offset:{unit:.5,mode:'切り上げ'},
 alignValue:{unit:.5,mode:'切り上げ'},
};
/* 刻みの小数桁。`0.5`→1、`0.05`→2、`1`→0。**指数表記も読む**
   （`1e-2`を`String()`すると小数点が無く、素朴に数えると0桁になる）。 */
function roundUnitDecimals(unit){
 const t=String(unit);
 if(/e-/i.test(t)){const n=Number(t.split(/e-/i)[1])||0;const f=(t.split(/e-/i)[0].split('.')[1]||'').length;return n+f}
 const d=t.split('.')[1];
 return d?d.length:0;
}
/* 丸めそのもの。**段数を出すときに誤差を吸う**——`1.5/0.5`は
   `3.0000000000000004`なので、素の`Math.ceil`だと**ちょうどの値が1段上がる**
   （1.5 → 2.0）。段数×刻みも誤差を持つので、刻みの桁で丸め直して返す。 */
function roundToUnit(n,unit,mode){
 if(!Number.isFinite(n)||!(unit>0))return n;
 const q=n/unit,eps=1e-9;
 const k=mode==='切り捨て'?Math.floor(q+eps)
        :mode==='四捨五入'?Math.round(q)
        :Math.ceil(q-eps);
 return Number((k*unit).toFixed(Math.min(10,roundUnitDecimals(unit)+2)));
}
/* 刻みと向きを渡して文字列で返す（操業データ項目もここを通る）。
   **空欄と数でないものはそのまま**（打ち間違いを黙って0にしない・§9.114）。
   **刻みの桁でそろえる**——0.5刻みなら`2`ではなく`2.0`。丸めたことが値の形
   からも読めるし、転送側（`.toFixed(1)`）と食い違わない。 */
function roundValueBy(value,unit,mode){
 const raw=String(value??'').trim();
 if(raw===''||!(unit>0))return raw;
 const n=Number(raw);
 if(!Number.isFinite(n))return raw;
 return roundToUnit(n,unit,mode).toFixed(roundUnitDecimals(unit));
}
/* 測定表・丈別データの4つ。**表に無い鍵はそのまま返す**（丸めない）。 */
function roundMeasureValue(key,value){
 const rule=MEASURE_ROUND[key];
 return rule?roundValueBy(value,rule.unit,rule.mode):String(value??'').trim();
}
/* 「丸めてから桁をそろえる」1本。**入力の確定はここを通す**——2つに
   分けると、丸めが効く欄と効かない欄ができる（§9.233 ③）。 */
function settleMeasurementValue(key,value,device){
 return fixedMeasurementValue(key,roundMeasureValue(key,value),device);
}
window.WL=window.WL||{};
window.WL.measureRound={rules:()=>({...MEASURE_ROUND}),apply:roundMeasureValue,
 settle:settleMeasurementValue,toUnit:roundToUnit,by:roundValueBy};
/* 測定器のことを答える1箇所（§9.320-C）。画面は綴りも桁も書き写さない。 */
window.WL.measureDevice={label:measureDeviceLabel,of:measureDeviceOf,note:noteMeasureDevice,
 digits:measurementDigits,known:()=>({...MEASURE_DEVICE_DIGITS})};
/* 公差・基準の表示桁は**測定値と同じ**（§9.242 ②）。値だけ2桁にして範囲を
   1桁のままにすると、`1234.55`が`1233.5 ～ 1234.5`の中に見えてしまう
   （実際の判定は生の範囲で行うので、**画面だけが嘘をつく**）。 */
function fixedToleranceValue(kind,value){const n=Number(value);if(!Number.isFinite(n))return '-';const d=measurementDigits(kind);return n.toFixed(d==null?1:d)}
/* Final title guard for delayed initialization and browser history restoration. */
function enforceApplicationTitle(){if(document.title!=='測定伝送システム')document.title='測定伝送システム'}
enforceApplicationTitle();window.addEventListener('pageshow',enforceApplicationTitle);document.addEventListener('visibilitychange',()=>{if(!document.hidden)enforceApplicationTitle()});
/* ハートビート（15秒ごと）。**在席と版の知らせ**のために送る（§9.272・§9.515）。
   以前はブラウザ版の「タブが0件で終わる」見張りのためにタブごとのIDを名乗っていたが、
   §9.548 でブラウザ版の起動の道を外したので名乗らない（終わり方は窓を閉じる・終了ボタン）。 */
/* ハートビートは「こちらが生きている」ことを伝えるだけでなく、その応答から
   「サーバーが生きているか」も分かる。応答が続けて途絶えたら画面最上部へ
   明示する。サーバーが終了していても画面は普通に見えてしまい、操作して
   初めてエラーになる状態を避けるため(仕様書2.9)。
   1回の失敗では出さない(サーバー再起動中の一時断や瞬断で出さないため)。 */
/* ---------- 古い版の端末への知らせ（§9.515、利用者の指示「控えめな感じで
   邪魔にならないように入れてください」） ----------
   運用中の最新版はサーバーが裏で数え（`presence.version_notice()`の1箇所）、
   **ハートビートの応答に相乗りして全区分の端末へ**届く（接続状況の口は区分で
   断るので、設備作業者の端末には届かない）。
   出すのは**版のバッジの隣の小さな字1つ**——帯・窓・トーストは出さない、
   場所も動かさない（バッジの行の空きに入る）。押すとバッジと同じ行き先
   （更新履歴の窓）が「最新版・この端末の版・すること」を言う。
   **まだ数えていない（`null`）は「最新」と読まない**——前の答えのまま置く。
   `#restartNeeded`が出ている間は伏せる（打つ手＝開き直すは同じで、あちらが
   先に言っている・画面基準8）。
   **置くのは左メニューのバッジだけ**（`HOST`）。測定画面のレール（160px）では
   バッジの行に入らず、測っている最中にレールの中身を1行ぶん押し下げる。 */
WL.versionNotice=(()=>{
 const HOST='.layout>aside .brand .build-badge';
 let state=null;
 const behind=()=>!!(state&&state.outdated)&&document.getElementById('restartNeeded')?.hidden!==false;
 function paint(){
  const on=behind();
  document.querySelectorAll(HOST).forEach(badge=>{
   let mark=badge.nextElementSibling;
   if(!mark||!mark.classList.contains('ver-behind')){
    if(!on)return;
    mark=document.createElement('button');
    mark.type='button';mark.className='ver-behind';mark.textContent='新しい版あり';
    mark.onclick=()=>badge.click();
    badge.after(mark);
   }
   mark.hidden=!on;
   mark.title=on?`運用中の最新版は VER${state.latestVersion} です（この端末は VER${state.myVersion}）。押すと更新のしかたを出します。`:'';
  });
 }
 function apply(v){
  if(!v||!v.latestVersion)return;
  const next={latestVersion:String(v.latestVersion),myVersion:String(v.myVersion||''),outdated:!!v.outdated};
  if(state&&state.latestVersion===next.latestVersion&&state.myVersion===next.myVersion&&state.outdated===next.outdated)return;
  state=next;paint();
 }
 return {apply,paint,state:()=>state,behind};
})();
const HEARTBEAT_INTERVAL_MS=15000, HEARTBEAT_FAIL_LIMIT=2;
let heartbeatFailures=0;
function setConnectionLost(lost){
 const bar=document.getElementById('connectionLost');
 if(bar)bar.hidden=!lost;
 document.body.classList.toggle('connection-lost',lost);
}
async function sendHeartbeat(){
 try{
  /* いま開いている画面も一緒に伝える（§9.272）。接続状況の一覧が「誰が
     何をしているか」まで出せる。**専用の周期は足さない**——間隔・失敗時の
     扱い・タブを閉じたときの後始末を2つ持つことになる。 */
  const res=await fetch(`/api/heartbeat?view=${encodeURIComponent(WL.currentView||'')}`,
   {method:'POST',cache:'no-store',keepalive:true});
  if(!res.ok)throw Error('HTTP '+res.status);
  heartbeatFailures=0;setConnectionLost(false);
  const body=await res.json().catch(WL.quiet('応答を読めなくても生きている（版の知らせは前のまま）'));
  WL.versionNotice.apply(body&&body.version);
 }catch(e){
  /* **自分で終了したときは「接続が切れました」を出さない**（§9.301 ②）
     ——事故のように見せない（§3）。終了した画面は`#appQuitDone`が言う。 */
  if(WL.quitting)return;
  heartbeatFailures++;
  if(heartbeatFailures>=HEARTBEAT_FAIL_LIMIT)setConnectionLost(true);
 }
}
sendHeartbeat();setInterval(sendHeartbeat,HEARTBEAT_INTERVAL_MS);
WL.onReady(()=>{
 const btn=document.getElementById('connectionLostReload');
 if(btn)btn.onclick=()=>location.reload();
});
/* ---------- 安全な終了（§9.301 ②、利用者の指示「そういう意味で安全な
   アプリの終了ボタンも欲しいです」） ----------
   「安全」の中身は**片付け**で、
   共有の目印を残したまま落ちると他の端末が期限（既定90秒）まで待たされる:
    ・書込役の目印……その間、書き込みのたびに届かない相手を待つ（§9.301 ①）
    ・編集セッション……その設備が読み取り専用のまま（§9.211 ②）
    ・在席……接続状況に幽霊が残る（§9.272）
   **片付けそのものはサーバーの`watchdog.teardown()`の1箇所**（§9.163）——
   窓を閉じたときも（窓口の入力が閉じる）ここを通るので、手順を2つ持たない。
   画面がするのは「押す前に何が起きるかを見せる」ことと「押したあとに
   終わったと言う」ことだけ。

   **未保存の測定は画面しか知らない**（端末のブラウザの中にある・§9.202）
   ので、確認の文はこちらが添える。 */
WL.quitting=false;
WL.quitApp=async function(){
 if(WL.quitting)return;
 let facts={isOwner:false,sessions:[]};
 try{facts=await api('/api/app/quit-check')}catch(e){WL.quiet.note('分からなくても閉じられる',e)}
 const lines=[];
 if(typeof measureDirty!=='undefined'&&measureDirty)
  lines.push('<p class="confirm-modal-message"><b>保存されていない測定があります。</b>'
   +'閉じるとこの画面の変更は失われます（保存済みのデータは残ります）。</p>');
 const what=[];
 if(facts.isOwner)what.push('このPCは<b>共有への書込役</b>です。役を降りてから閉じるので、他のPCはすぐ次の書込役を立てられます');
 if((facts.sessions||[]).length)what.push('編集中の設備（'+esc(facts.sessions.join('、'))+'）を手放します');
 what.push('接続状況からこのPCを消します');
 lines.push('<ul class="confirm-modal-list">'+what.map(x=>'<li>'+x+'</li>').join('')+'</ul>');
 const ok=await confirmModal({title:'このPCのWaveLogを終了しますか？',
   eyebrow:'QUIT',confirmLabel:'終了する',cancelLabel:'やめる',danger:true,
   bodyHtml:lines.join('')});
 if(!ok)return;
 WL.quitting=true;
 setConnectionLost(false);
 const box=document.getElementById('appQuitDone');
 const note=document.getElementById('appQuitWhat');
 try{
  await api('/api/app/quit',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 }catch(e){
  /* **失敗したら終了したと言わない**（§3）。押しても何も起きない状態を
     残さないよう、理由と次の手立て（窓を閉じても同じ片付けを通る）を出す。 */
  WL.quitting=false;
  showToast&&showToast('終了できませんでした',String(e&&e.message||e)+' / 窓を閉じても、同じ片付けをしてから終わります',6000);
  return;
 }
 if(note)note.innerHTML='<ul class="confirm-modal-list">'+what.map(x=>'<li>'+x+'</li>').join('')+'</ul>';
 /* 窓は中身（Python）が終わるのを待って閉じる（デスクトップ版の窓・§9.546）。閉じるまでの
    あいだと、窓を持たない開発・網の入口では**終わったことと次の一手**を出す。 */
 if(box)box.hidden=false;
};
WL.onReady(()=>{
 const q=document.getElementById('appQuit');
 if(q)q.onclick=()=>WL.quitApp();
 else console.error('終了ボタン(#appQuit)が見つかりません');
});

/* 左ナビ(aside)の幅をドラッグでリサイズできるようにする。#navResizeHandle
   を<aside>の直後(<main>の前)へ挿入するだけで、.layoutのgrid-template-
   columnsが3列(--nav-w 4px 1fr)構成のため、既存のDOM構造(aside/main)を
   壊さずに挟み込める。幅はlocalStorageへ保存し次回も再現する。 */
(function(){
 const aside=document.querySelector('.layout>aside');
 if(!aside||!aside.parentNode)return;
 let navWidth=(()=>{try{const v=+localStorage.getItem('navWidthV1');return v>0?v:242}catch(e){return 242}})();
 function apply(){document.documentElement.style.setProperty('--nav-w',navWidth+'px')}
 apply();
 /* 畳む/開く(§9.58)。畳んだときは**アイコンだけの細い帯**にする。
    完全に隠すと戻す手段を別に置く必要があり、どこへ戻るかも分からなく
    なるため、行き先(アイコン)は常に見えている形を選ぶ。
    幅は畳んだ状態と開いた状態で別々に覚える(開き直したとき、利用者が
    自分で決めた幅へ戻る)。 */
 const NAV_COLLAPSED_KEY='navCollapsedV1';
 const NAV_RAIL_W=54;
 let collapsed=(()=>{try{return localStorage.getItem(NAV_COLLAPSED_KEY)==='1'}catch(e){return false}})();
 function applyCollapsed(){
  document.body.classList.toggle('nav-collapsed',collapsed);
  document.documentElement.style.setProperty('--nav-w',(collapsed?NAV_RAIL_W:navWidth)+'px');
  if(toggle){
   toggle.setAttribute('aria-expanded',String(!collapsed));
   toggle.title=collapsed?'メニューを開く':'メニューを畳む';
  }
  /* 畳んでいる間はラベルが出ないので、行き先を**浮き出し**で示す（§9.265、
     利用者の指示「折りたたんだときはわかりにくいので、ポップオーバーでの
     説明はきれいにわかりやすく」）。素の`title`は出るまで1秒近くかかり、
     見た目も揃わず、**触る画面では読めない**（§4）。
     `title`は**外す**——残すと浮き出しと二重に出る（同じことを2箇所・§8）。
     退避済みかの判定は`undefined`で見ること。**元のtitleが空の項目は
     `!b.dataset.navTitle`が真になり**、2回目以降(下のMutationObserver等)で
     退避値を「適用済みのラベル」で上書きしてしまい、開いても戻らなくなる。 */
  document.querySelectorAll('aside .nav-item').forEach(b=>{
   const label=(b.querySelector('span')||{}).textContent.trim()||'';
   if(collapsed){
    if(b.dataset.navTitle===undefined)b.dataset.navTitle=b.title||'';
    b.dataset.navLabel=label;
    b.removeAttribute('title');
    if(label&&!b.getAttribute('aria-label'))b.setAttribute('aria-label',label);
   }else{
    if(b.dataset.navTitle!==undefined)b.title=b.dataset.navTitle;
    delete b.dataset.navLabel;
   }
  });
  if(!collapsed)hideNavTip();
 }
 /* ---- 畳んだメニューの浮き出し（§9.265） ----
    **器はbody直下に1つだけ**（`aside`は幅54pxで`overflow`を持つので、
    中に置くと切り落とされる・§9.201）。中身は**行き先の名前が主、説明は従**
    ——アイコンだけでは何の画面か分からないのが畳んだときの問題なので、
    まず名前をはっきり出す。 */
 let navTip=null,navTipFor=null;
 function ensureNavTip(){
  if(navTip)return navTip;
  navTip=document.createElement('div');
  navTip.className='nav-tip';navTip.id='navTip';navTip.hidden=true;
  navTip.setAttribute('role','tooltip');
  document.body.appendChild(navTip);
  return navTip;
 }
 function hideNavTip(){if(navTip){navTip.hidden=true;navTipFor=null}}
 function showNavTip(btn){
  if(!collapsed||!btn)return;
  const label=btn.dataset.navLabel||'';
  const desc=btn.dataset.navTitle||'';
  if(!label&&!desc)return;
  const el=ensureNavTip();
  /* 件数のバッジ（データ一覧の「0」）は名前に混ぜない——行き先の名前として
     読めなくなる。名前の後ろに小さく添える。 */
  const badge=(btn.querySelector('.nav-badge,.db-count')||{}).textContent||'';
  el.innerHTML='<b>'+esc(label)+'</b>'
   +(badge.trim()?'<span class="nav-tip-badge">'+esc(badge.trim())+'</span>':'')
   +(desc?'<small>'+esc(desc)+'</small>':'');
  el.hidden=false;navTipFor=btn;
  /* **画面の外へ出さない**。上端・下端で押し戻す。 */
  const r=btn.getBoundingClientRect(),t=el.getBoundingClientRect();
  const gap=8;
  let top=r.top+r.height/2-t.height/2;
  top=Math.max(gap,Math.min(top,window.innerHeight-t.height-gap));
  el.style.top=Math.round(top)+'px';
  el.style.left=Math.round(r.right+gap)+'px';
 }
 /* 委譲で受ける。**行き先は後から足される**（カレンダー・ダッシュボード等）
    ので、1つずつ配線すると足された項目だけ浮き出しが出ない。 */
 aside.addEventListener('mouseover',e=>{
  const b=e.target.closest&&e.target.closest('.nav-item');
  if(b&&b!==navTipFor)showNavTip(b);
 });
 aside.addEventListener('mouseleave',hideNavTip);
 aside.addEventListener('focusin',e=>{
  const b=e.target.closest&&e.target.closest('.nav-item');
  if(b)showNavTip(b);
 });
 aside.addEventListener('focusout',hideNavTip);
 /* 押したら消す（行き先が変わるので、前の画面の名前が残らない）。 */
 aside.addEventListener('click',hideNavTip);
 /* **関係のない器のスクロールで消さないこと**（§9.286 ②）。
    消す目的は「持ち主のボタンが動いたら位置が嘘になる」なので、
    消すのは**持ち主を含む器がスクロールしたとき**だけ。
    以前は素通しで、一覧のツールバーのような`overflow-x:auto`の器が
    組み直された拍子に飛ぶ`scroll`でも消えていた——出したばかりの
    浮き出しが一瞬で消え、`test_nav`が「浮き出しが出ない」で落ちた。 */
 window.addEventListener('scroll',e=>{
  if(!navTipFor)return;
  const t=e.target;
  if(t===document||t===document.documentElement||t===document.body
     ||(t&&t.contains&&t.contains(navTipFor)))hideNavTip();
 },true);
 const toggle=document.createElement('button');
 toggle.type='button';toggle.id='navCollapseToggle';toggle.className='nav-collapse-toggle';
 toggle.innerHTML='<span aria-hidden="true"></span>';
 const brand=aside.querySelector('.brand');
 if(brand)brand.appendChild(toggle);else aside.prepend(toggle);
 toggle.addEventListener('click',()=>{
  collapsed=!collapsed;
  try{localStorage.setItem(NAV_COLLAPSED_KEY,collapsed?'1':'0')}catch(e){WL.quiet.note('保存できなくても切替は効く',e)}
  applyCollapsed();
 });
 applyCollapsed();
 /* カレンダー・ダッシュボード・DB一覧のナビ項目は、base.jsより後に読まれる
    ファイルが動的に足す。畳んだ状態で足されるとツールチップが付かないため、
    追加を監視して付け直す。監視するのはchildListだけなので、applyCollapsed
    自身のtitle書き換え(属性変更)では再帰しない。 */
 new MutationObserver(ms=>{
  if(ms.some(m=>[...m.addedNodes].some(n=>n.nodeType===1&&
     (n.classList?.contains('nav-item')||n.querySelector?.('.nav-item')))))applyCollapsed();
 }).observe(aside,{childList:true,subtree:true});

 const handle=document.createElement('div');
 handle.id='navResizeHandle';handle.title='ドラッグでメニュー幅を変更';
 aside.insertAdjacentElement('afterend',handle);
 handle.addEventListener('mousedown',e=>{
  if(collapsed)return;          // 畳んでいる間は幅を変えない(開いてから変える)
  e.preventDefault();
  const startX=e.clientX,startW=navWidth;
  handle.classList.add('dragging');
  function onMove(ev){
   navWidth=Math.min(Math.max(180,startW+(ev.clientX-startX)),480);
   applyCollapsed();
  }
  function onUp(){
   document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);
   handle.classList.remove('dragging');
   try{localStorage.setItem('navWidthV1',String(navWidth))}catch(err){WL.quiet.note('保存できなくても表示自体は継続する',err)}
  }
  document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
 });
})();

/* ---------- 時間の書き方(アプリ全体・§9.341) ----------
   「150分」なのか「2時間30分」なのか。**答えるのはここだけ**(§9.163)。

   実測すると、同じ「所要時間」を書く関数が5つ・表記が4種類あった:
     fmtMin(15箇所) 150分 ／ fmtMinutes(13箇所) 2時間30分 ／
     fmtCompact(4箇所) 2:30 ／ fmtHour(1箇所) 2.5時間 ／
     fmtRelative 2時間30分後
   稼働状況は「150分」、作業スケジュールは「2時間30分」、その実績列だけ
   「2:30」——**同じ数字が画面をまたぐと別の顔になる**ので、読む側は毎回
   どの単位で読むのかを確かめ直すことになる(画面基準6「単位を画面に出す」)。

   **既定は「分」**(利用者の指示)。作業時間は分まで見る(§9.242)現場の
   数え方に合わせる。「時間と分」で読みたい人のために書き方を選べるように
   し、選んだ書き方はこの端末に覚える。

   **単位を落とした裸の数字は作らない。** 以前の`fmtCompact`は密な列で
   `2:30`と書いていたが、見出しは「実績」としか言っておらず、時分なのか
   分秒なのかは値の側にしか手掛かりが無い。「分」の書き方では密な列でも
   `150分`と書く(4文字で、`2:30`と同じ幅に収まる)。 */
const DURATION_KEY='WaveLogDurationStyleV1';
const DURATION_STYLES=[
 {key:'min',label:'分',hint:'150分'},
 {key:'hm',label:'時間と分',hint:'2時間30分'},
];
let durationStyle='min';
function currentDurationStyle(){
 try{
  const v=localStorage.getItem(DURATION_KEY);
  if(DURATION_STYLES.some(s=>s.key===v))return v;
 }catch(e){WL.quiet.note('端末の覚えが読めない（既定の「分」で続ける）',e)}
 return 'min';
}
/* `compact`は密な列用。「分」の書き方では通常と同じ(単位を落とさない)、
   「時間と分」でだけ`2:30`まで詰める。 */
function durationText(minutes,compact){
 const n=Number(minutes);
 if(minutes===null||minutes===undefined||minutes===''||!Number.isFinite(n))return '-';
 const v=Math.round(n),sign=v<0?'-':'',a=Math.abs(v);
 if(durationStyle!=='hm'||a<60)return `${sign}${a}分`;
 const h=Math.floor(a/60),m=a%60;
 return compact?`${sign}${h}:${String(m).padStart(2,'0')}`
               :`${sign}${h}時間${m?m+'分':''}`;
}
function applyDurationStyle(key){
 durationStyle=DURATION_STYLES.some(s=>s.key===key)?key:'min';
 try{localStorage.setItem(DURATION_KEY,durationStyle)}catch(e){WL.quiet.note('保存できなくても表示自体は継続する',e)}
 document.querySelectorAll('#uiSizeMenu [data-duration-style]').forEach(b=>{
  b.classList.toggle('is-current',b.dataset.durationStyle===durationStyle);
 });
 /* 書き方を変えたら、**いま画面に出ている数字も書き直す**。「次に描くとき
    から効く」にすると、直らない画面が必ず残る(選んだのに変わらない、は
    設定が壊れているのと見分けが付かない)。 */
 document.dispatchEvent(new CustomEvent('wl:duration-style',{detail:{style:durationStyle}}));
 notifyLookChange();
}
durationStyle=currentDurationStyle();
window.WL.duration={
 text:m=>durationText(m,false),
 compact:m=>durationText(m,true),
 style:()=>durationStyle,
 setStyle:applyDurationStyle,
 STYLES:DURATION_STYLES,
};

/* ---------- 表示サイズ(3段階、アプリ全体) ----------
   文字サイズ・コントロールの高さ・一覧の行の高さは、すべてapp.cssの
   :rootトークンが--ui-scaleを掛けた値で決まる(docs/ARCHITECTURE.md
   「コントロールサイズの統一」)。ここではその倍率を選ぶ段階を
   html[data-ui-size]へ流し込むだけで、個別の画面には一切手を入れない。
   以前は作業スケジュール画面だけに「高密度」トグルがあり、他の画面の
   文字サイズは調整できなかった(画面ごとにサイズ感がばらつく原因)。
   base.jsは読み込み順の先頭(=他のJSが画面を組み立てる前)に走るため、
   ここでhtmlへ属性を付けておけば、後から描かれる画面も最初から正しい
   サイズで組み上がる。

   **段は3つ。以前の5段(極小.84〜特大1.22)から両端を落とした**(§9.132)。
   倍率の幅が広いほど「ある段でだけ溢れる」箇所が増え、直す側は全段で
   確かめ直すことになる。実際に手当てしてきた溢れも特大でのものが大半
   だった。段を減らすと、器を1つ触ったときに見る組み合わせが5→3になる。 */
const UI_SIZE_KEY='MeasurementUiSizeV1';
const UI_SIZES=[
 {key:'sm',label:'小',hint:'一度に見える情報量を優先'},
 {key:'md',label:'中',hint:'標準'},
 {key:'lg',label:'大',hint:'読みやすさを優先'},
];
/* 廃止した段を選んでいた端末の保存値の行き先。単に無効として既定(中)へ
   落とすと、**わざわざ選んでいた人ほど設定が黙って戻る**ので、残った段の
   いちばん近いものへ寄せる。 */
const UI_SIZE_ALIASES={xs:'sm',xl:'lg'};
function currentUiSize(){
 try{
  const v=localStorage.getItem(UI_SIZE_KEY);
  if(UI_SIZES.some(s=>s.key===v))return v;
  if(UI_SIZE_ALIASES[v])return UI_SIZE_ALIASES[v];
 }catch(e){WL.quiet.note('端末の覚えが読めない（既定で続ける）',e)}
 return 'md';
}
function applyUiSize(key){
 const size=UI_SIZES.some(s=>s.key===key)?key:(UI_SIZE_ALIASES[key]||'md');
 document.documentElement.dataset.uiSize=size;
 try{localStorage.setItem(UI_SIZE_KEY,size)}catch(e){WL.quiet.note('保存できなくても表示自体は継続する',e)}
 /* バッジの字は「表示」で固定(§9.341)。以前はここへ`小/中/大`を書いて
    いたが、いまは節が2つあるので**片方の値だけをバッジに出すと、もう
    片方が無いように見える**。いまどれかは開いた先の`is-current`が言う。 */
 document.querySelectorAll('#uiSizeMenu [data-ui-size-option]').forEach(b=>{
  b.classList.toggle('is-current',b.dataset.uiSizeOption===size);
 });
 notifyLookChange();
}
applyUiSize(currentUiSize());
window.applyUiSize=applyUiSize;
/* 表示サイズも**名前空間から読めるようにする**（§ui-core「`window.*`への新規
   公開は名前空間経由」）。`WL.duration`／`WL.loader`と同じ形にそろえる——
   「この端末の見え方」の3つは、どれも同じ形で「いまの値」と「顔ぶれ」を
   答えられないと、まとめて出す側（共通設定の行き先・§9.433）が3通りの
   読み方を書き分けることになる。 */
window.WL.uiSize={
 size:currentUiSize,
 setSize:applyUiSize,
 SIZES:UI_SIZES,
};

/* ---------- 読み込み中の見せ方（ローダー）§9.421 ----------
   利用者の指示「https://connoratherton.com/loaders のloaderを使えるように。
   設定で切り替えて選べるようにしてほしい」。

   **入口は「表示」バッジの3つめの節**。文字の大きさ・時間の書き方と同じ
   「この端末の見え方」なので、入口を増やさない（§9.207・§9.341）。
   選んだ値は`html[data-loader]`へ流すだけ——見た目は`89-loaders.css`が
   持ち、**DOMは作り直さない**（どの種類でも並びは同じ`<i>`5つ）。

   **並びを作るのはここ1箇所**（`WL.loader.html()`）。呼ぶ側が自分で
   `<span class="mini-spinner">`を書いていると、種類を足すたびに全部の
   呼び出しを探すことになる。 */
/* 「この端末の見え方」が変わったことを1つの合図で知らせる（§9.433）。
   設定そのものは「表示」バッジの1箇所が持つ（§9.421）が、**いまの値を
   出している画面**（共通設定の「この端末の見え方」）は別の場所にあるので、
   変わったことを知る手立てが要る——**知らせる役はここ1箇所**にして、
   聞く側は`document`で受ける（§9.285「変わったら知らせる」と同じ作法）。 */
function notifyLookChange(){
 try{document.dispatchEvent(new CustomEvent('wl:look-change'))}
 catch(e){WL.quiet.note('見え方が変わったことを知らせられない（画面は次に開いたときに直る）',e)}
}
WL.notifyLookChange=notifyLookChange;

const LOADER_KEY='MeasurementLoaderV1';
/* **顔ぶれは群で持つ**（§9.436、利用者の指示「広いエリアでわかりやすく
   選べるように」）。29種を平らに並べると、選ぶ側は29回見比べることになる
   ——「輪」「波紋」「球」…という**形の族**で束ねると、まず族を1つ選んで
   その中の数枚だけを見比べればよい（見比べる回数 29 → 7＋4程度）。
   族の名前は**画面に出る見出しそのもの**。順は「静か → にぎやか」で、
   業務画面に置いても落ち着いて見える族を先に出す。
   `label`は**何が見えるか**（形＋数＋動き）、`hint`は**元の綴り**
   （loaders.css のどれを写したかを画面から辿れるようにする・§CLAUDE 6）。 */
const LOADER_GROUPS=[
 {key:'ring',   name:'輪・弧',   note:'回り続ける。いちばん静か'},
 {key:'ripple', name:'波紋',     note:'中心から広がって消える'},
 {key:'ball',   name:'球が並ぶ', note:'横1列で上下・伸び縮み'},
 {key:'swarm',  name:'球が集まる',note:'格子や円周に散る'},
 {key:'line',   name:'棒が並ぶ', note:'等幅の棒が伸び縮み'},
 {key:'path',   name:'道を描く', note:'決まった道筋をまわる'},
 {key:'shape',  name:'形が変わる',note:'面そのものが裏返る'},
];
const LOADERS=[
 /* ---- 輪・弧 ---- */
 {key:'ring',group:'ring',label:'輪と点',hint:'WaveLog 既定（これまでの見せ方）'},
 {key:'ball-clip-rotate',group:'ring',label:'切れた輪',hint:'ball-clip-rotate'},
 {key:'ball-clip-rotate-pulse',group:'ring',label:'切れた輪と脈打つ球',hint:'ball-clip-rotate-pulse'},
 {key:'ball-clip-rotate-multiple',group:'ring',label:'2つの弧が逆に回る',hint:'ball-clip-rotate-multiple'},
 {key:'semi-circle-spin',group:'ring',label:'半月が回る',hint:'semi-circle-spin'},
 /* ---- 波紋（利用者の指示「水の波紋のようなものも使いたい」） ---- */
 {key:'ball-scale-ripple-multiple',group:'ripple',label:'波紋が次々に広がる',hint:'ball-scale-ripple-multiple'},
 {key:'ball-scale-ripple',group:'ripple',label:'波紋が1つ広がる',hint:'ball-scale-ripple'},
 {key:'ball-scale-multiple',group:'ripple',label:'円が次々に広がる（塗り）',hint:'ball-scale-multiple'},
 {key:'ball-scale',group:'ripple',label:'円が1つ広がる（塗り）',hint:'ball-scale'},
 /* ---- 球が並ぶ ---- */
 {key:'ball-pulse',group:'ball',label:'球が3つ（順に縮む）',hint:'ball-pulse'},
 {key:'ball-beat',group:'ball',label:'球が3つ（交互に薄く）',hint:'ball-beat'},
 {key:'ball-pulse-sync',group:'ball',label:'球が3つ（波のように上下）',hint:'ball-pulse-sync'},
 {key:'ball-pulse-rise',group:'ball',label:'球が5つ（すれ違って上下）',hint:'ball-pulse-rise'},
 /* ---- 球が集まる ---- */
 {key:'ball-grid-pulse',group:'swarm',label:'球が9つ（格子・伸び縮み）',hint:'ball-grid-pulse'},
 {key:'ball-grid-beat',group:'swarm',label:'球が9つ（格子・明滅）',hint:'ball-grid-beat'},
 {key:'ball-spin-fade-loader',group:'swarm',label:'球が8つ（円周で順に薄く）',hint:'ball-spin-fade-loader'},
 {key:'ball-rotate',group:'swarm',label:'球が3つ（1本の軸で回る）',hint:'ball-rotate'},
 /* ---- 棒が並ぶ ---- */
 {key:'line-scale',group:'line',label:'棒が5本（順に）',hint:'line-scale'},
 {key:'line-scale-pulse-out',group:'line',label:'棒が5本（中から外へ）',hint:'line-scale-pulse-out'},
 {key:'line-scale-pulse-out-rapid',group:'line',label:'棒が5本（中から外へ・速い）',hint:'line-scale-pulse-out-rapid'},
 {key:'line-scale-party',group:'line',label:'棒が4本（ばらばらに）',hint:'line-scale-party'},
 {key:'line-spin-fade-loader',group:'line',label:'棒が8本（円周で順に薄く）',hint:'line-spin-fade-loader'},
 /* ---- 道を描く ---- */
 {key:'ball-zig-zag',group:'path',label:'球が2つ（すれ違う）',hint:'ball-zig-zag'},
 {key:'ball-zig-zag-deflect',group:'path',label:'球が2つ（跳ね返る）',hint:'ball-zig-zag-deflect'},
 {key:'ball-triangle-path',group:'path',label:'輪が3つ（三角をまわる）',hint:'ball-triangle-path'},
 {key:'pacman',group:'path',label:'口を開けて食べる',hint:'pacman'},
 /* ---- 形が変わる ---- */
 {key:'square-spin',group:'shape',label:'四角が裏返る',hint:'square-spin'},
 {key:'triangle-skew-spin',group:'shape',label:'三角が裏返る',hint:'triangle-skew-spin'},
 {key:'cube-transition',group:'shape',label:'四角が2つ（角をまわる）',hint:'cube-transition'},
];
/* **`<i>`の数**。9は格子（3×3）が要る数で、いちばん多い種類に合わせる。
   ここが答えの1箇所——盤も保存オーバーレイも、この数だけ`<i>`を置く。 */
const LOADER_SLOTS=9;
const LOADER_DOTS='<i></i>'.repeat(LOADER_SLOTS);
function currentLoader(){
 try{
  const v=localStorage.getItem(LOADER_KEY);
  if(LOADERS.some(l=>l.key===v))return v;
 }catch(e){WL.quiet.note('端末の覚えが読めない（既定で続ける）',e)}
 return 'ring';
}
/* 種類を当てる先は**器そのもの**（`.wl-ld[data-ld]`・§9.436）。
   以前は`html[data-loader]`の子孫として当てていたが、**見本を並べる盤では
   取り違える**——祖先の種類と札の種類の規則が同じ詳細度で当たり、後に
   書いたほうが勝つ。器へ直に書けば、1つの器に当たる種類は必ず1つになる。
   `data-ld-fixed`を名乗る器（盤の見本）は、いまの設定に引きずられない。 */
function paintLoaders(k){
 document.querySelectorAll('.wl-ld:not([data-ld-fixed])').forEach(el=>{el.dataset.ld=k});
}
/* 「いまこれを使っている」の印。**選ぶ面が2つある**（「表示」バッジの
   行き先と、共通設定の盤）ので、**印を付ける役も1箇所**にまとめる
   ——描いた直後に呼べば、どちらの面でも同じ見え方になる。 */
function markLoaderOptions(k){
 document.querySelectorAll('[data-loader-option]').forEach(b=>{
  const on=b.dataset.loaderOption===(k||currentLoader());
  b.classList.toggle('is-current',on);
  if(b.tagName==='BUTTON')b.setAttribute('aria-pressed',String(on));
 });
}
function applyLoader(key){
 const k=LOADERS.some(l=>l.key===key)?key:'ring';
 document.documentElement.dataset.loader=k;
 try{localStorage.setItem(LOADER_KEY,k)}catch(e){WL.quiet.note('保存できなくても表示自体は継続する',e)}
 paintLoaders(k);
 markLoaderOptions(k);
 notifyLookChange();
}
/* **中の`<i>`は常に9つ**。使わないぶんはCSSが伏せるので、種類を変えても
   並びはそのまま（作り直さないから、動いている最中に切り替えても飛ばない）。 */
WL.loader={
 STYLES:LOADERS,
 GROUPS:LOADER_GROUPS,
 SLOTS:LOADER_SLOTS,
 style:currentLoader,
 setStyle:applyLoader,
 mark:markLoaderOptions,
 /* いまの種類の名前（盤・行き先の「いまどうなっているか」が読む）。 */
 labelOf(key){const l=LOADERS.find(x=>x.key===(key||currentLoader()));return l?l.label:''},
 /* `size`＝器の大きさ（px）。渡さなければ器のCSSが決める。
    `fixed`＝この器は設定に追従しない（盤の見本）。 */
 html(size,cls,fixed){
  const st=size?` style="--wl-ld:${(+size||16)}px"`:'';
  const kind=(typeof fixed==='string'&&fixed)?fixed:currentLoader();
  return `<span class="wl-ld${cls?' '+cls:''}" data-ld="${kind}"`
   +`${fixed?' data-ld-fixed':''}${st} aria-hidden="true">${LOADER_DOTS}</span>`;
 },
};
applyLoader(currentLoader());
/* 「読み込みの見せ方を決める場所」への行き先（§9.436）。**base.js は
   マスタ画面の作りを知らない**ので、口だけ置き、実体はマスタ画面が
   `WL.openLookSettings` を名乗って入れる（§9.373「土台に画面の知識を
   書かない」と同じ作法）。名乗り手が居ない場面では静かに何もしない。 */
WL.openLookSettings=null;

/* 「この端末の見え方」へ**画面が節を足す口**（§9.444、利用者の指示「表示という
   ボタンがそもそも2つあるのでわかりにくい」→「入口を1つに寄せる」）。
   **土台は画面の作りを知らない**（§9.373 と同じ作法）——画面が名乗りに来る。
     key    … 節の鍵（同じ鍵で登録し直すと差し替わる。描き直しで増えない）
     title  … 節の見出し
     when() … いまこの節を出すか（画面を開いているときだけ、等）
     render(host) … 中身を`host`へ描く（`host`は**文書に付いた器**・§9.486）
   **入口は増やさない**（§9.421）。増やすのは節だけ。 */
const LOOK_SECTIONS=[];
WL.lookSettings={
 register(sec){
  if(!sec||!sec.key)return;
  const i=LOOK_SECTIONS.findIndex(x=>x.key===sec.key);
  if(i>=0)LOOK_SECTIONS[i]=sec;else LOOK_SECTIONS.push(sec);
 },
 sections(){return LOOK_SECTIONS.filter(x=>!x.when||x.when())},
};

/* 「表示」のポップオーバー。モードバッジ(.access-mode-menu)と同じ
   「小さなボタン→選択肢を並べたポップオーバー」の言語で揃える
   (アプリ内で同じ役割のUIは同じ見た目・同じ操作にする)。

   **1つのバッジに2つの節**(§9.341)。文字の大きさも時間の書き方も
   「この端末の見え方」という同じ性格の設定なので、**入口を2つに増やさない**
   (§9.207「入口を2つにしない」)。ヘッダーの一等地は有限で、常設の物を
   1つ増やすたびに、本来主役であるはずの一覧が狭くなる。
   バッジの字は入っている物の名前(「表示」)にする——`A 中`のままだと
   時間の書き方はここにあると誰も思わない(画面基準:探させない)。

   `.global-actions`の中でも**このバッジは伏せない**(一覧だけの操作——検索・件数・再読込——は
   一覧の帯へ移した・§9.286／§9.505)。作業スケジュールこそ
   時間の書き方がいちばん効く画面なので、そこで開けないと意味が無い。 */
(function(){
 function closeMenu(){
  document.getElementById('uiSizeMenu')?.remove();
  document.removeEventListener('click',onOutside,true);
 }
 /* **節が開いた窓（`.record-modal`）の中は「外」と数えない**（§9.486）。
    「参照…」の場所選び・上書きの確認は、このメニューの上に重ねて開く。
    その窓を押しただけで下のメニューを閉じると、**窓が返した値の行き先が
    消える**（選んだアイコンのファイルが盤へ戻らなかった）。 */
 function onOutside(e){
  const menu=document.getElementById('uiSizeMenu');
  if(menu&&!menu.contains(e.target)&&!e.target.closest('#uiSizeBadge,.record-modal'))closeMenu();
 }
 function openMenu(anchor){
  closeMenu();
  const menu=document.createElement('div');
  menu.className='wl-menu access-mode-menu ui-size-menu';menu.id='uiSizeMenu';
  const head=t=>{const h=document.createElement('h6');h.className='ui-size-menu-head';h.textContent=t;menu.appendChild(h)};
  head('文字の大きさ');
  const cur=(typeof currentUiSize==='function')?currentUiSize():'md';
  UI_SIZES.forEach(s=>{
   const btn=document.createElement('button');
   btn.type='button';btn.dataset.uiSizeOption=s.key;
   if(s.key===cur)btn.classList.add('is-current');
   btn.innerHTML=`<span><i class="ui-size-swatch" data-swatch="${s.key}" aria-hidden="true">Ａ</i>${s.label}</span><small>${s.hint}</small>`;
   btn.addEventListener('click',()=>{applyUiSize(s.key);closeMenu()});
   menu.appendChild(btn);
  });
  /* 時間の書き方(§9.341)。**見本をそのまま札に出す**——「分」「時間と分」
     という名前だけでは、150分がどう出るのかは選ぶ前には分からない
     (§9.200「選ばせるものは選ぶ前に見える」)。 */
  head('時間の書き方');
  const curDur=WL.duration.style();
  WL.duration.STYLES.forEach(d=>{
   const btn=document.createElement('button');
   btn.type='button';btn.dataset.durationStyle=d.key;
   if(d.key===curDur)btn.classList.add('is-current');
   btn.innerHTML=`<span>${d.label}</span><small>${d.hint}</small>`;
   btn.addEventListener('click',()=>{WL.duration.setStyle(d.key);closeMenu()});
   menu.appendChild(btn);
  });
  /* 読み込み中の見せ方（§9.421 → §9.436）。**ここは行き先だけ**にした。
     種類が6→29に増え、このポップオーバーには入らない（実測: 1種46px＝
     29種で1334px、画面の高さ1152pxを超える）。狭い器へ押し込むと、29種を
     スクロールで数えることになり「探させない」に反する。
     **選ぶのは共通設定＞この端末の盤**（広い場所で見本を大きく並べる）。
     ここには**いまどれか**と**どこで決めるか**だけを置く（§9.433 と同じ作法
     ——設定の持ち主は`WL.loader`の1箇所のまま、面が2つあるだけ）。 */
  head('読み込みの見せ方');
  {
   /* **行き先が開けないときは押す形にしない**（§9.445、§CLAUDE 4）。共通設定は
      スケジュールモードでは出ないので、以前はここを押すと**身に覚えの無い
      タブ（換算係数マスタ）が開いて**いた。開けるかを答えるのは名乗り手
      （`WL.openLookSettings.available()`）——土台は画面の作りを知らない。 */
   const live=!!(WL.openLookSettings&&(!WL.openLookSettings.available||WL.openLookSettings.available()));
   const el=document.createElement(live?'button':'div');
   if(live)el.type='button';
   el.className=live?'':'ui-size-flat';
   el.id='uiSizeLoaderLink';
   el.innerHTML=`<span><span class="ld-sample">${WL.loader.html(15)}</span>`
    +`<b class="ui-size-now"></b></span><small>${live?'共通設定 &gt; この端末 で選ぶ'
      :'選ぶのは共通設定 &gt; この端末（このモードでは開けません）'}`
    +`（全${WL.loader.STYLES.length}種）</small>`;
   el.querySelector('.ui-size-now').textContent=WL.loader.labelOf();
   if(live)el.addEventListener('click',()=>{closeMenu();WL.openLookSettings()});
   menu.appendChild(el);
  }
  /* 画面が名乗った節（§9.444）。**土台は中身を知らない**——器だけ用意して
     `render()`に渡す。出すのは`when()`が真のものだけ（押しても何も起きない
     節を残さない・§CLAUDE 4）。 */
  /* **器は文書に付けてから渡す**（§9.486）。節は自分の器を`document`から
     探して塗る（面が2つある節は`[data-sc-state]`を全部塗る）ので、付ける前に
     `render()`を呼ぶと**答えが手元にあるときほど塗り損ねる**——2回目以降に
     開くと「確認しています…」のまま止まり、作るボタンも出なかった。 */
  document.body.appendChild(menu);
  WL.lookSettings.sections().forEach(sec=>{
   head(sec.title||'');
   const box=document.createElement('div');
   box.className='ui-size-sec';
   box.dataset.lookSection=sec.key;
   menu.appendChild(box);
   try{sec.render(box,closeMenu)}
   catch(e){WL.quiet.note('この節を描けない（ほかの節は出す）',e);box.remove()}
  });
  const rect=anchor.getBoundingClientRect();
  menu.style.top=`${rect.bottom+6}px`;
  menu.style.left=`${Math.max(8,rect.right-menu.offsetWidth)}px`;
  requestAnimationFrame(()=>document.addEventListener('click',onOutside,true));
 }
 document.addEventListener('click',e=>{
  const t=e.target.closest('#uiSizeBadge');if(!t)return;
  if(document.getElementById('uiSizeMenu')){closeMenu();return}
  openMenu(t);
 });
 // ラベルの初期表示(applyUiSizeはDOM構築前に走るため、ここで一度描き直す)。
 if(typeof applyUiSize==='function'&&typeof currentUiSize==='function')applyUiSize(currentUiSize());
 /* 読み込みの見せ方も同じ理由でもう一度当てる——`applyLoader`はDOMが
    組み上がる前に走るので、`index.html`が持つ**静的な器**
    （`#saveOverlay`の`.wl-ld`）にはまだ種類が書かれていない（§9.436）。 */
 if(typeof applyLoader==='function'&&typeof currentLoader==='function')applyLoader(currentLoader());
})();

/* ---------- 起動オーバーレイ(#appBoot)の進行と解除 ----------
   起動待機画面(loading.html)から表示を引き継ぎ、**画面が組み上がるまで
   本体を見せない**。実測すると、最初の描画(+85ms)から落ち着く(+451ms)まで
   の間に「案内バーが出て消える」「ナビ項目が5→7に増える」「バージョン
   バッジの文字が変わる」「モードバッジが現れてヘッダーが組み替わる」
   「一覧の中身が入る」の5回、目に見える組み替えが起きていた。
   これが「起動直後だけ一瞬崩れて見える」の正体。

   進捗はサーバー側6段階＋ここの4段階＝10段階で1本。段階の定義は
   backend/boot_status.py の STEPS / BROWSER_STEPS が持ち、
   loading.html・templates/index.html の一覧と対応する
   (tests/test_boot.py が3箇所の一致を固定している)。

   **解除は必ず起きること**が最優先。どれかの段階が終わらなくても
   BOOT_TIMEOUT_MS で必ず外す(画面が出ないまま固まるのが最悪の結果)。
   index.htmlにも、base.js自体が読めなかった場合の保険を置いてある。
   時間切れは8秒。通常は0.5秒ほどで済む(実測)ので、これを超えるのは
   共有の応答が悪い等の異常時。そのときは覆いを外し、一覧側の読み込み
   表示に任せる——待たせ続けるより、操作できる画面を出すほうがよい。 */
const BOOT_SERVER_STEPS=6, BOOT_TOTAL_STEPS=10, BOOT_TIMEOUT_MS=8000;
const bootGate=(()=>{
 const root=document.documentElement;
 const overlay=document.getElementById('appBoot');
 const done=new Set();
 let finished=false;
 const startedAt=Date.now();
 /* 段階ごとの一言。「何を待っているのか」が分かると、遅いときでも
    止まっているのか進んでいるのかを判断できる。 */
 const HINT={assets:'画面部品を読み込んでいます',permission:'この端末のモードを確認しています',
             list:'仕掛一覧を取得しています',layout:'画面の寸法を確定しています'};
 const el=id=>overlay&&overlay.querySelector('#'+id);
 /* 帯はいまの段を**中央へ寄せる**(§9.411)。器の幅とマスの位置は描かれて
    からでないと測れないので、次の描画の合図で測る(先に測ると0が返る)。
    ずらす量はカスタムプロパティで渡す——見た目の指定はCSS側に残す。 */
 function centerBand(li){
  const band=el('bootBand'),strip=el('bootSteps');
  if(!band||!strip||!li)return;
  requestAnimationFrame(()=>{
   const x=li.offsetLeft+li.offsetWidth/2-band.clientWidth/2;
   strip.style.setProperty('--boot-shift',(-x)+'px');
  });
 }
 function paint(){
  if(!overlay)return;
  let current='',currentLi=null;
  overlay.querySelectorAll('[data-boot-step]').forEach(li=>{
   const key=li.dataset.bootStep,isDone=done.has(key);
   li.classList.toggle('is-done',isDone);
   const isCurrent=!isDone&&!current;
   li.classList.toggle('is-current',isCurrent);
   if(isCurrent){current=key;currentLi=li}
  });
  centerBand(currentLi);
  const pct=Math.min(100,Math.round((BOOT_SERVER_STEPS+done.size)/BOOT_TOTAL_STEPS*100));
  const bar=el('bootBar'),fill=el('bootFill'),
        pctEl=el('bootPct'),detail=el('bootDetail');
  /* 幅はカスタムプロパティで渡す(見た目の指定はCSS側に残す)。 */
  if(fill)fill.style.setProperty('--boot-pct',pct+'%');
  if(bar)bar.setAttribute('aria-valuenow',String(pct));
  if(pctEl)pctEl.textContent=pct+'%';
  /* いまの段の**名前は帯が出している**ので、ここは一言だけ
     (同じ字を2箇所に出さない・§CLAUDE 8)。 */
  if(detail)detail.textContent=current?(HINT[current]||''):'起動しました';
 }
 function tick(){
  const sec=Math.floor((Date.now()-startedAt)/1000);
  const e=el('bootElapsed');if(e)e.textContent='経過 '+sec+' 秒';
 }
 const timer=setInterval(()=>{if(finished)clearInterval(timer);else tick()},250);
 function finish(){
  if(finished)return;
  finished=true;clearInterval(timer);
  /* 本体を見せるのと、覆いが消えていくのを同時に始める。切り替わりが
     継ぎ目に見えないのが狙い(§9.76)。 */
  root.classList.remove('app-booting');
  if(overlay){
   overlay.classList.add('is-hiding');
   setTimeout(()=>overlay.remove(),400);
  }
 }
 setTimeout(()=>{
  if(!finished){
   const rest=['assets','permission','list','layout'].filter(k=>!done.has(k));
   console.warn('起動オーバーレイを時間切れで解除しました(未完了:',rest.join(','),')');
   /* **崩れた画面をそのまま見せない**(§9.92)。時間切れは「一覧がまだ
      来ていない」ことがほとんどで、そのまま覆いを外すと**中身の無い枠**が
      数秒見えて「崩れてから組み上がる」と受け取られる。枠の中に読み込み
      中だと分かる置き換えを入れてから外す——待たせ続けるより操作できる
      画面を出す、という原則(§9.86)は変えない。 */
   if(rest.includes('list')){
    const grid=document.getElementById('grid');
    if(grid&&!grid.textContent.trim())
     grid.innerHTML='<div class="setup-first"><b>一覧を読み込んでいます…</b>'
      +'<span>共有フォルダの応答が遅いようです。読み込みが終わると自動で表示されます。</span></div>';
   }
  }
  finish();
 },BOOT_TIMEOUT_MS);
 function step(key){
  if(finished||done.has(key))return;
  done.add(key);paint();
  /* **assetsも揃ってから**外す(§9.92)。以前は permission と list だけを
     見ていたため、読み込みの遅い端末では最後のJSが走る前に本体が見え、
     そのぶんの組み替えが利用者の目に入っていた。 */
  if(done.has('assets')&&done.has('permission')&&done.has('list')&&!done.has('layout')){
   /* 残るは寸法の確定だけ。2フレーム待てば、この時点までのDOM変更が
      すべて反映済みのレイアウトになる(1フレームでは足りないことがある)。 */
   requestAnimationFrame(()=>requestAnimationFrame(()=>{step('layout');finish()}));
  }
 }
 paint();tick();
 /* すべてのJSが読み終わった時点で1段階目が済む。通常は index.html の
    起動ローダーが最後の1本を読み終えたところで WL.boot.step('assets') を
    呼ぶ(その時点でDOMContentLoadedは既に終わっている)。ここの待ち受けは、
    ローダーを通さずに読み込まれた場合の保険。**二重に呼ばれても
    step() は1回しか効かない。** */
 document.addEventListener('DOMContentLoaded',()=>step('assets'));
 return {step,isBooting:()=>!finished,finish};
})();

/* ---------- WL名前空間への公開(定義は上記) ---------- */
Object.assign(window.WL,{registerView,enterView,withInternalDbSwitch,isInternalDbSwitch,ttlCache,optionList,mountViewToolbar,syncViewToolbar,boot:bootGate});

/* ============================================================
   外へ出す面（§9.359・REVIEW 3-17）
   ① 土台。**今までどおりの短い名前で**、ここから明示的に公開する。呼ぶ側は
      今までどおり `$('#id')`／`esc(v)` と書ける（実測 `$`1,031・`esc`1,464
      箇所。名前空間にすると読みにくくなるだけで、衝突は起きようがない
      ——**このファイルだけが名乗っている**）。
   ② それ以外は `WL.base`。使う場所が少ない＝土台ではない、の線引き。
   ここに載せていない名前（131のうち約80）は、このファイルの中だけのもの。
   ============================================================ */
window.$=$;window.esc=esc;window.S=S;window.api=api;window.showToast=showToast;window.markDirty=markDirty;window.confirmModal=confirmModal;window.alertModal=alertModal;window.promptModal=promptModal;window.pick=pick;window.setState=setState;window.withUserId=withUserId;window.currentConfiguredEquipment=currentConfiguredEquipment;window.fmtDim=fmtDim;window.lengthIndex=lengthIndex;window.fixedToleranceValue=fixedToleranceValue;window.currentUserId=currentUserId;window.normalizedFieldName=normalizedFieldName;
WL.base={normalizedLot,durationMs,copyText,statusLabel,statusClass,statusShortLabel,aliases,databaseLabel,designCourseValue,actualCourseValue,residualCourseValue,equipmentIsInDesignCourse,escClosesModal,fetchWhoami,fieldFromRows,fixedMeasurementValue,formatDuration,lotKey,measurementDigits,nextPaint,normalizeCourseText,noteMeasureDevice,openLotDsp,openLotDspHome,inDesktopShell,lotDspAttrs,optionFill,qualityText,setActiveNav,setHeaderContext,setUserId,sourceField,sourceValue,toHalfWidth,ttlCache,widthSequence,bindTabs,
 LENGTH_SLOTS,
 /* `let` の入れ物は **getter** で載せる（値で載せると古い物が固定される）。
    `measureDirty` は外からも倒す（`records-store` が保存し終えて false に
    する）ので setter も置く。 */
 get measureDirty(){return measureDirty},
 set measureDirty(v){measureDirty=v},
 get measureEditSeq(){return measureEditSeq},
};
})();
