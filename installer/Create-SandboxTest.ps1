param(
  [string]$InstallerPath = (Join-Path $PSScriptRoot '..\dist\EMILIA-1.3.4-Setup-x64.exe'),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\work\sandbox-test')
)
$ErrorActionPreference = 'Stop'
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$output = [IO.Path]::GetFullPath($OutputDirectory)
$mapped = Join-Path $output 'release'
New-Item -ItemType Directory -Path $mapped -Force | Out-Null
Copy-Item -LiteralPath $installer -Destination (Join-Path $mapped 'EmiliaSetup.exe') -Force
$command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Copy-Item -LiteralPath ''C:\EmiliaRelease\EmiliaSetup.exe'' -Destination (Join-Path $env:USERPROFILE ''Desktop\EmiliaSetup.exe''); Start-Process (Join-Path $env:USERPROFILE ''Desktop\EmiliaSetup.exe'')"'
$folderXml = [Security.SecurityElement]::Escape($mapped)
$commandXml = [Security.SecurityElement]::Escape($command)
$xml = @"
<Configuration>
  <Networking>Enable</Networking>
  <VGpu>Disable</VGpu>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <MappedFolders><MappedFolder><HostFolder>$folderXml</HostFolder><SandboxFolder>C:\EmiliaRelease</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder></MappedFolders>
  <LogonCommand><Command>$commandXml</Command></LogonCommand>
</Configuration>
"@
$file = Join-Path $output 'Emilia-Clean-Windows.wsb'
[IO.File]::WriteAllText($file, $xml, [Text.UTF8Encoding]::new($false))
Write-Output $file
if (!(Test-Path -LiteralPath (Join-Path $env:WINDIR 'System32\WindowsSandbox.exe'))) {
  Write-Output 'Windows Sandbox is not enabled. Enable it through Windows Features and restart before opening this file.'
}
