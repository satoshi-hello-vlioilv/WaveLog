//! 窓を閉じる前の確かめ（§9.556、利用者の指示「アプリ終了ボタンは必要なく、削除希望です。×ボタンから普通に閉じて
//! 終了したいです」）。
//!
//! ×で閉じると窓口の入力が閉じ、中身（Python）は片付け（書込役・編集セッション・在席）を通って終わる（§9.544）。
//! 閉じる前に聞くのは**失うものがあるときだけ**（保存していない測定・版を置いている最中）——何を失うかは画面が
//! 知っている（`WL.closeGuard`）ので、窓は画面へ聞き、答えを待つ。
//!
//! 決まり（このファイルの`Gate`の1箇所）:
//!   - 画面が「聞いてよい」と名乗るまで（`armed`）は聞かずに閉じる（起動画面・読み込みの途中）
//!   - 聞いたら、画面が `asking`（確認を出した）・`close`・`stay` のどれかを返す
//!   - **`ANSWER_WAIT` のあいだ何も返らなければ閉じる**（画面が固まっていても閉じられなくしない）
//!   - 確認を出している間の2回目の×は聞き直さない（同じ確認を2枚出さない）

use std::sync::Mutex;
use std::time::Duration;

/// 画面が「確認を出した」と返すまで待つ長さ。返らなければ閉じる。
pub const ANSWER_WAIT: Duration = Duration::from_secs(2);
/// 画面に聞く式（`WL.closeGuard.ask()`。無い画面では何も起きず、待ち切って閉じる）。
pub const ASK_JS: &str = "window.WL&&WL.closeGuard&&WL.closeGuard.ask()";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Unarmed,
    Armed,
    Asked(u64),
    Asking,
    Closing,
}

/// 窓がすること。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// そのまま閉じる（閉じる要求なら止めない・答えなら閉じに行く）
    Close,
    /// 閉じるのを止めて画面に聞く（`seq` は待ち切りの見張りが自分の番かを確かめる印）
    Ask(u64),
    /// 閉じるのを止めて何もしない（確認を出している最中）
    Hold,
    /// 何もしない
    Nothing,
}

pub struct Gate {
    state: Mutex<(State, u64)>,
}

impl Default for Gate {
    fn default() -> Self {
        Gate { state: Mutex::new((State::Unarmed, 0)) }
    }
}

impl Gate {
    fn with<R>(&self, f: impl FnOnce(&mut State, &mut u64) -> R) -> R {
        let mut g = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let (s, n) = &mut *g;
        f(s, n)
    }

    /// ×が押された。
    pub fn request(&self) -> Decision {
        self.with(|s, n| match *s {
            State::Unarmed | State::Closing => Decision::Close,
            State::Armed => {
                *n += 1;
                *s = State::Asked(*n);
                Decision::Ask(*n)
            }
            State::Asked(_) | State::Asking => Decision::Hold,
        })
    }

    /// 画面からの返事（`armed`／`asking`／`close`／`stay`）。
    pub fn answer(&self, word: &str) -> Decision {
        self.with(|s, _| match (word, *s) {
            (_, State::Closing) => Decision::Nothing,
            ("armed", State::Unarmed | State::Armed) => {
                *s = State::Armed;
                Decision::Nothing
            }
            ("asking", State::Asked(_)) => {
                *s = State::Asking;
                Decision::Nothing
            }
            ("close", State::Asked(_) | State::Asking) => {
                *s = State::Closing;
                Decision::Close
            }
            ("stay", State::Asked(_) | State::Asking) => {
                *s = State::Armed;
                Decision::Nothing
            }
            _ => Decision::Nothing,
        })
    }

    /// 待ち切った（`seq` の問いに画面が `asking` すら返さなかった）。
    pub fn timeout(&self, seq: u64) -> Decision {
        self.with(|s, _| {
            if *s == State::Asked(seq) {
                *s = State::Closing;
                Decision::Close
            } else {
                Decision::Nothing
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closes_at_once_until_the_page_says_it_can_answer() {
        let g = Gate::default();
        assert_eq!(g.request(), Decision::Close, "起動画面・読み込みの途中は聞かずに閉じる");
    }

    #[test]
    fn asks_the_page_and_follows_its_answer() {
        let g = Gate::default();
        g.answer("armed");
        let Decision::Ask(seq) = g.request() else { panic!("名乗った画面には聞く") };
        assert_eq!(g.answer("asking"), Decision::Nothing);
        assert_eq!(g.request(), Decision::Hold, "確認を出している間の2回目の×は聞き直さない");
        assert_eq!(g.timeout(seq), Decision::Nothing, "確認を出したなら待ち切りで閉じない（人が読んでいる）");
        assert_eq!(g.answer("stay"), Decision::Nothing);
        let Decision::Ask(_) = g.request() else { panic!("やめたあとの×はもう一度聞く") };
        assert_eq!(g.answer("close"), Decision::Close);
        assert_eq!(g.request(), Decision::Close, "閉じに行ったあとは止めない");
    }

    #[test]
    fn closes_when_the_page_does_not_answer() {
        let g = Gate::default();
        g.answer("armed");
        let Decision::Ask(seq) = g.request() else { panic!() };
        assert_eq!(g.timeout(seq), Decision::Close, "画面が固まっていても閉じられる");
        assert_eq!(g.answer("close"), Decision::Nothing, "遅れて来た返事で2度閉じに行かない");
    }

    #[test]
    fn an_old_timer_does_not_close_a_new_question() {
        let g = Gate::default();
        g.answer("armed");
        let Decision::Ask(first) = g.request() else { panic!() };
        g.answer("asking");
        g.answer("stay");
        let Decision::Ask(second) = g.request() else { panic!() };
        assert_ne!(first, second);
        assert_eq!(g.timeout(first), Decision::Nothing, "前の問いの見張りは今の問いを閉じない");
        assert_eq!(g.timeout(second), Decision::Close);
    }
}
