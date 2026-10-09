param([string]$SourceAgentDir = (Join-Path $env:LOCALAPPDATA 'MyBangumiAssistant-Pi/pi'))
$ErrorActionPreference = 'Stop'
$taskStage = 'validate_source'
try {
  $taskSource = (Resolve-Path -LiteralPath $SourceAgentDir).Path
  $taskModelsPath = Join-Path $taskSource 'models.json'
  $taskAuthPath = Join-Path $taskSource 'auth.json'
  if (!(Test-Path -LiteralPath $taskModelsPath -PathType Leaf) -or !(Test-Path -LiteralPath $taskAuthPath -PathType Leaf)) { throw 'missing_private_config' }
  $taskModels = Get-Content -LiteralPath $taskModelsPath -Raw | ConvertFrom-Json -AsHashtable
  $taskProvider = $taskModels.providers.deepseek
  if ($null -eq $taskProvider -or $taskProvider.models.Count -eq 0) { throw 'missing_deepseek' }
  $taskSelected = @($taskProvider.models | Where-Object { $_.id -eq 'deepseek-flash' })
  if ($taskSelected.Count -ne 1) { throw 'missing_selected_model' }
  $taskEndpoint = if ($taskSelected[0].baseUrl) { $taskSelected[0].baseUrl } else { $taskProvider.baseUrl }
  $taskHost = ([uri]$taskEndpoint).Host
  if ($taskHost -ne 'api.deepseek.com') { throw 'unexpected_selected_host' }
  $taskBase = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'MyBangumiAssistant-Pi/benchmark-configs'))
  $taskDir = [IO.Path]::GetFullPath((Join-Path $taskBase ('responses-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))))
  if (!$taskDir.StartsWith($taskBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'invalid_private_destination' }
  $taskStage = 'restrict_private_directory'
  New-Item -ItemType Directory -Path $taskDir -Force | Out-Null
  $taskAcl = Get-Acl -LiteralPath $taskDir
  $taskAcl.SetAccessRuleProtection($true, $false)
  $taskSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  foreach ($taskPrincipal in @($taskSid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $taskRule = [Security.AccessControl.FileSystemAccessRule]::new($taskPrincipal, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $taskAcl.AddAccessRule($taskRule)
  }
  Set-Acl -LiteralPath $taskDir -AclObject $taskAcl
  $taskStage = 'write_private_models'
  $taskProvider.api = 'openai-responses'
  foreach ($taskModel in $taskProvider.models) { $taskModel.api = 'openai-responses' }
  $taskModels | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath (Join-Path $taskDir 'models.json') -Encoding utf8NoBOM
  $taskSettings = Join-Path $taskSource 'settings.json'
  if (Test-Path -LiteralPath $taskSettings -PathType Leaf) { Copy-Item -LiteralPath $taskSettings -Destination (Join-Path $taskDir 'settings.json') }
  $taskStage = 'reuse_private_auth'
  $taskAuthLink = Join-Path $taskDir 'auth.json'
  try { New-Item -ItemType SymbolicLink -Path $taskAuthLink -Target $taskAuthPath -ErrorAction Stop | Out-Null }
  catch { New-Item -ItemType HardLink -Path $taskAuthLink -Target $taskAuthPath -ErrorAction Stop | Out-Null }
  [ordered]@{ agentDir = $taskDir; changedProvider = 'deepseek'; api = 'openai-responses'; selectedHost = $taskHost } | ConvertTo-Json -Compress
} catch {
  # JSON解析、文件或权限错误可能含配置片段，因此仅报告固定阶段，绝不回显异常正文。
  [Console]::Error.WriteLine('Private Responses benchmark configuration failed at stage: ' + $taskStage)
  exit 1
}
