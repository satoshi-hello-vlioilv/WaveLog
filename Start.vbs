Option Explicit
' Kept for the transition (section 9.554): the desktop exe is the entry now.
' This file only starts the exe. It starts the entry on this PC
' (%LOCALAPPDATA%\WaveLog\desktop\WaveLog.exe) when it is there, otherwise
' program\WaveLog.exe (that one copies itself to this PC and places the entry).
' Comparing versions and copying is the exe's job (desktop/src/launch.rs).
' The program folder is passed as --program, the same as the desktop shortcut.
Dim sh, fso, root, prog, entry, exe
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
prog = root & "\program"
entry = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\WaveLog\desktop\WaveLog.exe"
If fso.FileExists(entry) Then exe = entry Else exe = prog & "\WaveLog.exe"
If Not fso.FileExists(exe) Then
  MsgBox "アプリ本体（program\WaveLog.exe）が見つかりません。" & vbCrLf & _
    "最新の ZIP でアプリのフォルダを上書きしてから、もう一度起動してください。" & vbCrLf & exe, 16, "測定伝送システム"
  WScript.Quit 1
End If
On Error Resume Next
sh.Run """" & exe & """ --program """ & prog & """", 1, False
If Err.Number <> 0 Then
  MsgBox "アプリ本体を起動できませんでした（" & Err.Description & "）。" & vbCrLf & _
    "program\WaveLog.exe をダブルクリックして起動してください。" & vbCrLf & exe, 16, "測定伝送システム"
End If
