"""quiet.py: 例外を捨てるときは、理由を1行残す（§9.328、REVIEW 3-4）。

`except Exception: pass`は**何が起きても誰にも見えない**。§9.190で
「`.catch(()=>{})`が403を握り潰し、鍵が外れる不具合に誰も気づけなかった」が
既に起きている。捨てること自体は正しい場面が多いので禁じないが、
**なぜ捨ててよいのかを書く**のを構造として要求する。

    except Exception as _e:
        quiet('共有が読めない（写しで続ける）',_e)

戻り値をそのまま返せるので、値を返す場所でも1行で書ける。

    except Exception as _e:
        return quiet('設定が読めない（既定で続ける）',_e,{})

**ロガーは`logging.getLogger('app')`を直に引く**——`logging_setup`をimport
すると`paths`から使えなくなる（あちらは`paths`を読む側）。名前は
`logging_setup.app_logger()`と同じなので、出る先は`app.log`の1本のまま。

**出すのはDEBUG**。ふだんのログを埋めずに、必要なときだけ拾えるようにする
（`log.exception`にすると、正常な経路の見送りがトレースバック付きで並ぶ）。

見張りは`tests/test_quietlint.py`——「広いexceptの本体が何も呼ばず、例外も
見ていない」＝黙っている、を機械で数える（目で数えない・§9.96）。
"""
import logging

_LOGGER=None


def _log():
    global _LOGGER
    if _LOGGER is None:
        _LOGGER=logging.getLogger('app')
    return _LOGGER


def quiet(why,err=None,value=None):
    """例外を捨てる。`why`は必須（なぜ捨ててよいのか）。`value`をそのまま返す。"""
    text=str(why or '').strip()
    if err is None:
        _log().debug('見送り: %s',text or '(理由なし)')
    else:
        _log().debug('見送り: %s（%s: %s）',text or '(理由なし)',type(err).__name__,err)
    return value
