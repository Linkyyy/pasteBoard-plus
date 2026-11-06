# Run on Windows with: powershell.exe -NoProfile -STA -File scripts/test-windows-focus.ps1
# Uses an isolated test window; never reads text from other applications.
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
$testText = 'PasteBoard focus test ' + [char]0x4F60 + [char]0x597D + ' ' + [char]0x30D1 + [char]0x30F3
try {
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
  $other = New-Object System.Windows.Forms.TextBox
  $form.Controls.Add($other); $other.BringToFront(); $other.Focus() | Out-Null
  [System.Windows.Forms.Application]::DoEvents()
  $rejected = [PasteBoardNative.FocusBridge]::Paste($context.window, $context.control, $context.process, $context.elementKey)
  if ($rejected.pasted) { throw 'A stale input target was not rejected.' }
  Write-Output 'PASS Windows caret capture, Unicode paste, unchanged focus, and stale-target rejection.'
} finally {
  $form.Close(); $form.Dispose()
  if ($null -ne $previousClipboard) { [System.Windows.Forms.Clipboard]::SetDataObject($previousClipboard, $true) }
  else { [System.Windows.Forms.Clipboard]::Clear() }
}
