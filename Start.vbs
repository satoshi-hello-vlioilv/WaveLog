Option Explicit
' Normal launcher for daily use. Runs start_app.py with no console window.
' start_app.py opens the waiting screen (loading.html) by itself, so the
' user still sees the startup status even though this window is hidden.
' Use start_app.bat instead when you need to see startup errors.
Dim sh, fso, root, target
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
target = """" & root & "\start_app.py"""

On Error Resume Next
sh.Run "pythonw.exe " & target, 0, False
If Err.Number <> 0 Then
  Err.Clear
  sh.Run "python.exe " & target, 0, False
  If Err.Number <> 0 Then
    MsgBox "Python が見つかりません。Python を導入してから、もう一度お試しください。", 16, "測定伝送システム"
  End If
End If
