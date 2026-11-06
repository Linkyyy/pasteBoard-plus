$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
  $source = [IO.File]::ReadAllText($env:PASTEBOARD_FOCUS_SOURCE)
  $references = @([System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.ControlType].Assembly.Location, [System.Windows.Rect].Assembly.Location)
  Add-Type -TypeDefinition $source -ReferencedAssemblies $references
  [Console]::WriteLine('{"ready":true}')
  while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    try {
      $request = $line | ConvertFrom-Json
      if ($request.command -eq 'capture') { $value = [PasteBoardNative.FocusBridge]::Capture([string]$request.ownWindow) }
      elseif ($request.command -eq 'paste') { $value = [PasteBoardNative.FocusBridge]::Paste([string]$request.window, [string]$request.control, [uint32]$request.process, [string]$request.elementKey) }
      elseif ($request.command -eq 'quit') { break }
      else { throw 'Unknown command' }
      [Console]::WriteLine((@{ id = $request.id; ok = $true; value = $value } | ConvertTo-Json -Compress -Depth 5))
    } catch {
      [Console]::WriteLine((@{ id = $request.id; ok = $false; error = 'Windows 输入辅助服务请求失败，请重新唤出后重试。' } | ConvertTo-Json -Compress))
    }
  }
} catch {
  [Console]::WriteLine('{"ready":false,"error":"Windows 输入辅助服务无法启动，自动粘贴暂不可用。"}')
  exit 1
}
