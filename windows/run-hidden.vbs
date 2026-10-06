Option Explicit

Dim shell, powershellPath, scriptPath, command, index, argument
Set shell = CreateObject("WScript.Shell")

If WScript.Arguments.Count = 0 Then WScript.Quit 2

powershellPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
scriptPath = WScript.Arguments(0)
command = Quote(powershellPath) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Quote(scriptPath)

For index = 1 To WScript.Arguments.Count - 1
  argument = WScript.Arguments(index)
  command = command & " " & Quote(argument)
Next

shell.Run command, 0, False

Function Quote(value)
  Quote = """" & Replace(value, """", """""") & """"
End Function
