Option Explicit
' Normal launcher for daily use. Runs start_app.py with no console window.
' start_app.py opens the waiting screen (loading.html) by itself, so the
' user still sees the startup status even though this window is hidden.
' Use start_app.bat instead when you need to see startup errors.
'
' Argument "desktop" (section 9.544): start the desktop version (WaveLog.exe,
' no port) instead of the browser version. The exe is copied to
' %LOCALAPPDATA%\WaveLog\desktop\<size-time>\ and started from there: a running
' exe holds its file, so starting it straight from the shared (Box) folder
' would block that PC's update. The program folder is passed to the exe.
' If the exe is missing or cannot be copied, the browser version starts.
'
' Without an argument (section 9.547) the PC's own choice is used: the newer of
' %LOCALAPPDATA%\WaveLog\runtime\launch_mode.txt and
' %USERPROFILE%\.wavelog\runtime\launch_mode.txt ("browser" or "desktop"),
' written by the app (backend/launch_mode.py). With no file, DEFAULT_MODE.
' The argument "browser" always starts the browser version.
Const DEFAULT_MODE = "browser"
Dim sh, fso, root, target, mode
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
mode = ""
If WScript.Arguments.Count > 0 Then mode = LCase(WScript.Arguments(0))
If mode = "" Then mode = SavedMode()
If mode = "desktop" Then
  If StartDesktop() Then WScript.Quit 0
End If
target = """" & root & "\program\start_app.py"""

On Error Resume Next
sh.Run "pythonw.exe " & target, 0, False
If Err.Number <> 0 Then
  Err.Clear
  sh.Run "python.exe " & target, 0, False
  If Err.Number <> 0 Then
    MsgBox "Python が見つかりません。Python を導入してから、もう一度お試しください。", 16, "測定伝送システム"
  End If
End If

' The PC's own choice (section 9.547): the newer of the two files, else DEFAULT_MODE.
Function SavedMode()
  Dim cands, p, best, bestTime, f, ts, word
  SavedMode = DEFAULT_MODE
  cands = Array(sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\WaveLog\runtime\launch_mode.txt", _
                sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.wavelog\runtime\launch_mode.txt")
  best = ""
  On Error Resume Next
  For Each p In cands
    If fso.FileExists(p) Then
      Set f = fso.GetFile(p)
      If best = "" Then
        best = p : bestTime = f.DateLastModified
      ElseIf f.DateLastModified > bestTime Then
        best = p : bestTime = f.DateLastModified
      End If
    End If
  Next
  If best = "" Then Exit Function
  Set ts = fso.OpenTextFile(best, 1)
  word = LCase(Trim(Replace(ts.ReadLine, vbCr, "")))
  ts.Close
  If Err.Number <> 0 Then
    Err.Clear
    Exit Function
  End If
  If word = "browser" Or word = "desktop" Then SavedMode = word
End Function

' Copy WaveLog.exe to this PC (one folder per build) and start it. True when started.
Function StartDesktop()
  Dim src, f, d, stamp, dir, dst, tmp
  StartDesktop = False
  src = root & "\program\WaveLog.exe"
  If Not fso.FileExists(src) Then
    MsgBox "デスクトップ版（WaveLog.exe）が見つかりません。ブラウザ版で起動します。", 48, "測定伝送システム"
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
    Err.Clear
    MsgBox "デスクトップ版をこの PC へ写せませんでした。ブラウザ版で起動します。", 48, "測定伝送システム"
    Exit Function
  End If
  sh.Environment("PROCESS")("WAVELOG_PROGRAM_DIR") = root & "\program"
  sh.Run """" & dst & """", 1, False
  If Err.Number <> 0 Then
    Err.Clear
    Exit Function
  End If
  StartDesktop = True
End Function

Sub MakeDirs(p)
  If p = "" Then Exit Sub
  If fso.FolderExists(p) Then Exit Sub
  MakeDirs fso.GetParentFolderName(p)
  fso.CreateFolder p
End Sub
