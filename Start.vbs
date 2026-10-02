Option Explicit
' Daily launcher (section 9.548): starts the desktop version only.
' program\WaveLog.exe (placed on main by CI) is copied to
' %LOCALAPPDATA%\WaveLog\desktop\<size-time>\ and started from there: a running
' exe holds its file, so starting it straight from the shared (Box) folder
' would block that PC's update. The program folder is passed to the exe.
' There is no browser version any more: when the exe cannot start, the reason
' and the next step are shown (no silent fallback).
Dim sh, fso, root, why
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
why = StartDesktop()
If why <> "" Then MsgBox why, 16, "測定伝送システム"

' Copy program\WaveLog.exe to this PC (one folder per build) and start it.
' Returns "" when started, otherwise the reason and what to do next.
Function StartDesktop()
  Dim src, f, d, stamp, dir, dst, tmp
  src = root & "\program\WaveLog.exe"
  If Not fso.FileExists(src) Then
    StartDesktop = "アプリ本体（program\WaveLog.exe）が見つかりません。" & vbCrLf & _
      "最新の ZIP でアプリのフォルダを上書きしてから、もう一度起動してください。" & vbCrLf & src
    Exit Function
  End If
  Set f = fso.GetFile(src)
  d = f.DateLastModified
  stamp = f.Size & "-" & Year(d) & Right("0" & Month(d), 2) & Right("0" & Day(d), 2) & _
          Right("0" & Hour(d), 2) & Right("0" & Minute(d), 2) & Right("0" & Second(d), 2)
  dir = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\WaveLog\desktop\" & stamp
  dst = dir & "\WaveLog.exe"
  On Error Resume Next
  If Not fso.FileExists(dst) Then
    MakeDirs dir
    tmp = dst & ".tmp"
    fso.CopyFile src, tmp, True
    fso.MoveFile tmp, dst
  End If
  If Err.Number <> 0 Or Not fso.FileExists(dst) Then
    StartDesktop = "アプリ本体をこの PC へ写せませんでした（" & Err.Description & "）。" & vbCrLf & _
      "空き容量と、次の場所へ書き込めるかを確かめてください。" & vbCrLf & dir
    Err.Clear
    Exit Function
  End If
  sh.Environment("PROCESS")("WAVELOG_PROGRAM_DIR") = root & "\program"
  sh.Run """" & dst & """", 1, False
  If Err.Number <> 0 Then
    StartDesktop = "アプリ本体を起動できませんでした（" & Err.Description & "）。" & vbCrLf & dst
    Err.Clear
    Exit Function
  End If
  StartDesktop = ""
End Function

Sub MakeDirs(p)
  If p = "" Then Exit Sub
  If fso.FolderExists(p) Then Exit Sub
  MakeDirs fso.GetParentFolderName(p)
  fso.CreateFolder p
End Sub
