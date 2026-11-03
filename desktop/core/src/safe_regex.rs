//! 利用者が書いた正規表現のうち、照合が止まらなくなる形を断る（`backend/safe_regex.py` の写し・§9.634）。
//!
//! 見分け方は「中に繰り返しを持つかっこを、さらに繰り返す」形（`(a+)+`・`(a*)*`・`(.*a){12}`）。
//! 画面の `WL.formula.regexRisk()` と Python の `risk()` と**同じ決まり**（字の位置は Python と同じく1字ずつ数える）。

use crate::pyish::{is_digit, py_int};

pub const NESTED: &str = "入れ子の繰り返し（例: (a+)+）は、照合が止まらなくなることがあるので使えません";

/// p[i] から始まる繰り返しの長さと、2回以上くり返せるか。繰り返しでなければ (0, false)。
fn quant(p: &[char], i: usize) -> (usize, bool) {
    let Some(&ch) = p.get(i) else { return (0, false) };
    let lazy_or_possessive = |j: usize| matches!(p.get(j), Some('?') | Some('+'));
    match ch {
        '+' | '*' => (if lazy_or_possessive(i + 1) { 2 } else { 1 }, true),
        '?' => (if lazy_or_possessive(i + 1) { 2 } else { 1 }, false),
        '{' => {
            // `\{(\d*)(,?)(\d*)\}`
            let mut j = i + 1;
            let lo_start = j;
            while p.get(j).is_some_and(|c| is_digit(*c)) {
                j += 1;
            }
            let lo: String = p[lo_start..j].iter().collect();
            let comma = p.get(j) == Some(&',');
            if comma {
                j += 1;
            }
            let hi_start = j;
            while p.get(j).is_some_and(|c| is_digit(*c)) {
                j += 1;
            }
            let hi: String = p[hi_start..j].iter().collect();
            if p.get(j) != Some(&'}') {
                return (0, false);
            }
            let mut n = j + 1 - i;
            let bound = if !hi.is_empty() {
                py_int(&hi)
            } else if !lo.is_empty() {
                py_int(&lo)
            } else {
                Some(0)
            };
            let many = (comma && hi.is_empty()) || bound.unwrap_or(i64::MAX) >= 2;
            if lazy_or_possessive(i + n) {
                n += 1;
            }
            (n, many)
        }
        _ => (0, false),
    }
}

/// `(?` の後ろの頭の長さ（`(?:…)`・`(?=…)`・`(?P<名>…)`・`(?<=…)`）。`\?(?:P?<[^>]*>|[:=!]|<[=!])` に当たらなければ 1。
fn group_head(p: &[char], i: usize) -> usize {
    // 1つ目: P?<[^>]*>（「P」は無くてもよい。P の後ろに < が無ければ P 無しで試す＝ここでは当たらない）
    let mut j = i + 1;
    if p.get(j) == Some(&'P') && p.get(j + 1) == Some(&'<') {
        j += 1;
    }
    if p.get(j) == Some(&'<') {
        if let Some(k) = p[j + 1..].iter().position(|c| *c == '>') {
            return j + 1 + k + 1 - i;
        }
    }
    match (p.get(i + 1), p.get(i + 2)) {
        (Some(':' | '=' | '!'), _) => 2,
        (Some('<'), Some('=' | '!')) => 3,
        _ => 1,
    }
}

/// 照合が止まらなくなる形なら理由の字、安全なら ''。書けない正規表現かどうかは見ない。
pub fn risk(pattern: &str) -> &'static str {
    let p: Vec<char> = pattern.chars().collect();
    let mut stack = vec![false]; // かっこごとに「中に繰り返しがあるか」
    let mut i = 0;
    while i < p.len() {
        match p[i] {
            '\\' => i += 2,
            '[' => {
                let mut j = i + 1;
                if p.get(j) == Some(&'^') {
                    j += 1;
                }
                if p.get(j) == Some(&']') {
                    j += 1;
                }
                while j < p.len() && p[j] != ']' {
                    j += if p[j] == '\\' { 2 } else { 1 };
                }
                i = j + 1;
            }
            '(' => {
                stack.push(false);
                i += 1;
                if p.get(i) == Some(&'?') {
                    i += group_head(&p, i);
                }
                continue;
            }
            ')' => {
                let inner = if stack.len() > 1 { stack.pop().unwrap_or(false) } else { false };
                let (n, many) = quant(&p, i + 1);
                if inner && many {
                    return NESTED;
                }
                if inner || many {
                    *stack.last_mut().expect("底は残る") = true;
                }
                i += 1 + n;
                continue;
            }
            _ => i += 1,
        }
        let (n, many) = quant(&p, i);
        if many {
            *stack.last_mut().expect("底は残る") = true;
        }
        i += n;
    }
    ""
}
