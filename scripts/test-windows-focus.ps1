# Run on Windows with: powershell.exe -NoProfile -STA -File scripts/test-windows-focus.ps1
# Uses an isolated test window; never reads text from other applications.
param([string]$ApplicationPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, UIAutomationClient, UIAutomationTypes, WindowsBase
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../assets/windows/FocusBridge.cs'))
$references = @([System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.ControlType].Assembly.Location, [System.Windows.Rect].Assembly.Location)
Add-Type -TypeDefinition $source -ReferencedAssemblies $references
$form = New-Object System.Windows.Forms.Form
$form.Text = 'PasteBoard isolated focus test'
$form.Width = 600; $form.Height = 300
$field = New-Object System.Windows.Forms.TextBox
$field.Multiline = $true; $field.Dock = 'Fill'
$form.Controls.Add($field)
$previousClipboard = [System.Windows.Forms.Clipboard]::GetDataObject()
$testProfile = Join-Path ([IO.Path]::GetTempPath()) ('pasteboard-typing-' + [guid]::NewGuid())
$desktop = $null
$testText = 'PasteBoard focus test ' + [char]0x4F60 + [char]0x597D + ' ' + [char]0x30D1 + [char]0x30F3
try {
  if ($ApplicationPath) {
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = (Resolve-Path -LiteralPath $ApplicationPath).Path
    $start.UseShellExecute = $false
    $start.EnvironmentVariables['PASTEBOARD_USER_DATA'] = $testProfile
    $desktop = [System.Diagnostics.Process]::Start($start)
    # The compact window is shown after the app registers shortcuts and captures its first focus target.
    $appWindow = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $desktop.Id)
    $readyDeadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
      $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $appWindow)
      $visible = @($windows | Where-Object { -not $_.Current.IsOffscreen }).Count -gt 0
      if ($visible) { break }
      if ($desktop.HasExited) { throw 'The packaged application exited during startup.' }
      Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $readyDeadline)
    if (-not $visible) { throw 'The initial clipboard window did not open.' }
    Write-Output 'Packaged clipboard window is visible.'
  }
  $form.Show(); $form.Activate(); $field.Focus() | Out-Null
  [System.Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 150
  $context = [PasteBoardNative.FocusBridge]::Capture('0')
  if (-not $context.editable) { throw 'Failed to capture the editable test control.' }
  if (-not $context.caretLocated) { throw 'Failed to locate the test caret.' }
  [System.Windows.Forms.Clipboard]::SetText($testText)
  $result = [PasteBoardNative.FocusBridge]::Paste($context.window, $context.control, $context.process, $context.elementKey)
  if (-not $result.pasted) { throw $result.message }
  $deadline = [DateTime]::UtcNow.AddSeconds(3)
  while ([DateTime]::UtcNow -lt $deadline -and $field.Text -ne $testText) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }
  if ($field.Text -ne $testText) { throw 'SendInput did not paste into the original test field.' }
  if (-not $field.Focused) { throw 'The input field lost focus.' }
  $field.Clear(); $field.ShortcutsEnabled = $false; $field.AcceptsReturn = $true
  [System.Windows.Forms.Clipboard]::SetText('clipboard sentinel')
  $blockedPaste = [PasteBoardNative.FocusBridge]::Paste($context.window, $context.control, $context.process, $context.elementKey)
  if (-not $blockedPaste.pasted) { throw $blockedPaste.message }
  Start-Sleep -Milliseconds 120; [System.Windows.Forms.Application]::DoEvents()
  if ($field.Text -ne '') { throw 'The test field must block ordinary paste.' }
  $firstLine = $testText + [char]::ConvertFromUtf32(0x1F642)
  $typed = $firstLine + "`r" + 'line two'
  $problem = [PasteBoardNative.FocusBridge]::TypeText($context.window, $context.control, $context.process, $context.elementKey, $typed, 0)
  if ($problem) { throw $problem }
  $deadline = [DateTime]::UtcNow.AddSeconds(3)
  $expected = $firstLine + "`n" + 'line two'
  while ([DateTime]::UtcNow -lt $deadline -and ($field.Text -replace "`r`n?", "`n") -ne $expected) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }
  if (($field.Text -replace "`r`n?", "`n") -ne $expected) { throw 'Unicode typing failed in the paste-disabled field.' }
  if ([System.Windows.Forms.Clipboard]::GetText() -ne 'clipboard sentinel') { throw 'Unicode typing changed the clipboard.' }
  if ($desktop) {
    $field.Clear(); [System.Windows.Forms.Application]::DoEvents()
    $clipboardText = $firstLine + "`r`n" + 'line two'
    $data = New-Object System.Windows.Forms.DataObject
    $data.SetText($clipboardText, [System.Windows.Forms.TextDataFormat]::UnicodeText)
    $data.SetData('PasteBoardTypingTest', 'unchanged')
    [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
    $form.Activate(); $field.Focus() | Out-Null; [System.Windows.Forms.Application]::DoEvents()
    $atShortcut = [PasteBoardNative.FocusBridge]::Capture('0')
    if ($atShortcut.process -ne $PID -or $atShortcut.control -ne $context.control) { throw 'The test field lost keyboard focus before the shortcut.' }
    [System.Windows.Forms.SendKeys]::SendWait('^%v')
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while ([DateTime]::UtcNow -lt $deadline -and ($field.Text -replace "`r`n?", "`n") -ne $expected) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }
    if (($field.Text -replace "`r`n?", "`n") -ne $expected) { throw "Packaged typing yielded $($field.Text.Length) UTF-16 units. Expected $($clipboardText.Length). Field focused: $($field.Focused). App exited: $($desktop.HasExited)." }
    if (-not [System.Windows.Forms.Clipboard]::ContainsData('PasteBoardTypingTest')) { throw 'The global shortcut rewrote the clipboard.' }
    Write-Output 'PASS packaged Ctrl+Alt+V, paste-disabled field, multiple lines, and clipboard formats.'
  }
  $other = New-Object System.Windows.Forms.TextBox
  $form.Controls.Add($other); $other.BringToFront(); $other.Focus() | Out-Null
  [System.Windows.Forms.Application]::DoEvents()
  $rejected = [PasteBoardNative.FocusBridge]::Paste($context.window, $context.control, $context.process, $context.elementKey)
  if ($rejected.pasted) { throw 'A stale input target was not rejected.' }
  $typingRejection = [PasteBoardNative.FocusBridge]::TypeText($context.window, $context.control, $context.process, $context.elementKey, 'stale', 0)
  [System.Windows.Forms.Application]::DoEvents()
  if (-not $typingRejection -or $other.Text) { throw 'Typing continued in a different input field.' }
  Write-Output 'PASS Windows caret capture, ordinary paste, Unicode typing in a paste-disabled field, unchanged clipboard, and stale-target rejection.'
} finally {
  $form.Close(); $form.Dispose()
  try {
    if ($desktop -and -not $desktop.HasExited) { $desktop.Kill(); $desktop.WaitForExit() }
  } finally {
    if ($null -ne $previousClipboard) { [System.Windows.Forms.Clipboard]::SetDataObject($previousClipboard, $true) }
    else { [System.Windows.Forms.Clipboard]::Clear() }
    if (Test-Path -LiteralPath $testProfile) { Remove-Item -LiteralPath $testProfile -Recurse -Force }
  }
}
