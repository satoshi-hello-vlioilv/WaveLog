# -*- coding: utf-8 -*-
"""equip_groups.py: 設備グループ（§9.628。LotScope の services/equip_groups.py。現場のマスタ）: いくつかの設備を 1 つのまとまり（グループ）にして、ダッシュボードのパネルで合算して出す。

1 行＝1 つのグループ {名称, まとめ方, 設備, ルール, 表示順, 備考}。
    まとめ方 … グループの組の名前（例: 「ライン別」に「CR ライン」「L ライン」、「工場別」に「第 1 工場」…）。
               パネルは、まとめ方を 1 つ選ぶと、その中のグループで設備を合算する（groups_for）。同じまとめ方の中で名称は 1 つずつ
    設備   … 設備名のカンマ区切り（equipment_list）
    ルール … 名前の決まりで入れる設備（版 3.40.0。JSON {"rules": [{op, value}], "except": [設備名]}）。op は pivot.RULE_OPS
             （で始まる・で終わる・を含む・と同じ・正規表現）。どれか 1 つに当たる設備が入る（設備に書いた設備もいつも入る・except は入らない）。
             名前で決まるので、あとから増えた設備（例: L- で始まる L-4）も、マスタを直さずに入る
パネルの側の決め方（このパネルだけのグループ・選んだ設備を合算）は layout.py の egroup。数え方は pivot.py の EquipGroups。
置き場は repositories/dashboard_repo.py の EQUIP_GROUP（master.sqlite3 の設備グループマスタ）。
"""
from __future__ import annotations

import json
import re

from ..textnorm import normalize_equipment_name as normalize_part
from .pivot import RULE_OPS, compile_rules

_EQ_SPLIT = re.compile(r"[,、，\n]+")


def equipment_list(v):
    """設備（カンマ区切りの字・並び）→ 設備名の並び（前後の空白を除き、同じ名前は 1 つ）。"""
    items = v if isinstance(v, list) else _EQ_SPLIT.split(str(v or ""))
    out = []
    for x in items:
        s = str(x or "").strip()
        if s and all(normalize_part(s) != normalize_part(y) for y in out):
            out.append(s)
    return out


FIELDS = ["名称", "まとめ方", "設備", "ルール", "表示順", "備考"]
NAME_MAX = 40
MAX_RULES = 12
SET_DEFAULT = "グループ"


class GroupError(ValueError):
    pass


def clean_row(data, partial=False):
    """画面から来た値（name・set・equipment・order・note）→ マスタの行。partial は直すとき（来た物だけ）。"""
    out = {}
    if not partial or "name" in data:
        name = str(data.get("name") or "").strip()
        if not name:
            raise GroupError("グループの名称を入れてください。")
        out["名称"] = name[:NAME_MAX]
    if not partial or "set" in data:
        out["まとめ方"] = (str(data.get("set") or "").strip() or SET_DEFAULT)[:NAME_MAX]
    if not partial or any(k in data for k in ("equipment", "rules", "rulesText")):
        eq = equipment_list(data.get("equipment"))
        if any(x == "*" for x in eq):
            raise GroupError("グループに「すべての設備」は入れられません。入れる設備を選ぶか、名前の決まりを書いてください。")
        rules = clean_rules(parse_rules_text(data["rulesText"]) if "rulesText" in data else data.get("rules"))
        if not eq and not rules:
            raise GroupError("グループに入れる設備を 1 つ以上選ぶか、設備の名前の決まり（ルール）を 1 つ以上入れてください。")
        out["設備"] = ",".join(eq)
        ex = equipment_list(data.get("except")) if rules else []
        out["ルール"] = json.dumps({"rules": rules, **({"except": ex} if ex else {})}, ensure_ascii=False) if rules else ""
    if "order" in data:
        try:
            out["表示順"] = str(int(data.get("order")))
        except (TypeError, ValueError):
            out["表示順"] = ""
    if not partial or "note" in data:
        out["備考"] = str(data.get("note") or "").strip()[:200]
    return out


def clean_rules(v):
    """画面から来た決まり → [{op, value}]（知らない op・空の値は外す。正規表現は読めなければ断る）"""
    out = []
    for r in (v if isinstance(v, list) else [])[:MAX_RULES]:
        if not isinstance(r, dict) or r.get("op") not in RULE_OPS:
            continue
        val = str(r.get("value") or "").strip()[:80]
        if not val:
            continue
        if r["op"] == "regex":
            try:
                re.compile(val)
            except re.error as e:
                raise GroupError(f"正規表現「{val}」が読めません（{e}）。") from None
        x = {"op": r["op"], "value": val}
        if x not in out:
            out.append(x)
    return out


def rules_text(rules):
    """決まり [{op, value}] → 1 行に 1 つの字（「L- で始まる」）。マスタ管理の画面の欄が読み書きする形"""
    return "\n".join(f"{r['value']} {RULE_OPS[r['op']]}" for r in rules or [] if r.get("op") in RULE_OPS)


def parse_rules_text(text):
    """rules_text の字 → [{op, value}]。行の終わりが比べ方の言葉（RULE_OPS の字）でない行は、どう比べるか分からないので断る"""
    words = sorted(RULE_OPS.items(), key=lambda kv: -len(kv[1]))
    out = []
    for line in (x.strip() for x in str(text or "").splitlines()):
        if not line:
            continue
        hit = next(((op, line[: -len(w)].strip()) for op, w in words if line.endswith(w)), None)
        if not hit or not hit[1]:
            raise GroupError(f"決まり「{line}」の比べ方が読めません。行の終わりに「{'」「'.join(RULE_OPS.values())}」のどれかを書いてください（例: L- で始まる）。")
        out.append({"op": hit[0], "value": hit[1]})
    return out


def rules_of(row):
    """マスタの行 → ({rules, except})（無い・壊れていれば空）"""
    try:
        d = json.loads(row.get("ルール") or "{}")
    except (TypeError, ValueError):
        d = {}
    d = d if isinstance(d, dict) else {}
    try:
        rules = clean_rules(d.get("rules"))
    except GroupError:
        rules = []
    return {"rules": rules, "except": equipment_list(d.get("except")) if rules else []}


def members_in(group, names):
    """グループ（view の形）に入る設備（names の中で。書いた設備＋決まりに当たる設備〈除く設備は外す〉）"""
    test, ex = compile_rules(group.get("rules")), {normalize_part(x) for x in group.get("except") or []}
    mine = {normalize_part(x) for x in group.get("equipment") or []}
    return [n for n in names if normalize_part(n) in mine or (normalize_part(n) not in ex and test(normalize_part(n)))]


def check_unique(rows, data, self_id=None):
    """同じまとめ方の中で同じ名称を 2 つ持たない → 重なれば理由の字（無ければ ""）"""
    key = (normalize_part(data.get("まとめ方")), normalize_part(data.get("名称")))
    for r in rows:
        if r.get("id") != self_id and (normalize_part(r.get("まとめ方") or SET_DEFAULT), normalize_part(r.get("名称"))) == key:
            return f"まとめ方「{data.get('まとめ方')}」には、グループ「{data.get('名称')}」がもうあります。"
    return ""


def _order(row):
    try:
        return int(row.get("表示順") or 0)
    except (TypeError, ValueError):
        return 0


def ordered(rows):
    return sorted(rows, key=lambda r: (_order(r), int(r.get("id") or 0)))


def view(row):
    """画面へ出す形"""
    return {"id": row.get("id"), "name": row.get("名称") or "", "set": row.get("まとめ方") or SET_DEFAULT,
            "equipment": equipment_list(row.get("設備")), **_rules_view(row), "order": _order(row), "note": row.get("備考") or "", "rev": row.get("rev", 1),
            "updated_at": row.get("updated_at", ""), "updated_by": row.get("updated_by") or {}}


def _rules_view(row):
    d = rules_of(row)
    return {**d, "rulesText": rules_text(d["rules"])}


def sets(rows):
    """まとめ方の並び（表示順の最初のグループの順）→ [{name, groups: [view]}]"""
    out = {}
    for r in ordered(rows):
        v = view(r)
        out.setdefault(v["set"], []).append(v)
    return [{"name": k, "groups": v} for k, v in out.items()]


def groups_for(rows, set_name):
    """まとめ方 set_name のグループ → [{name, members, rules, except}]（pivot.EquipGroups の形）。無ければ空"""
    key = normalize_part(set_name)
    return [{"name": v["name"], "members": v["equipment"], **({"rules": v["rules"], "except": v["except"]} if v["rules"] else {})}
            for v in map(view, ordered(rows)) if normalize_part(v["set"]) == key]
