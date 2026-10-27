param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\dist'), [string]$BuildDirectory = (Join-Path $PSScriptRoot '..\work\installer-build'))
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$build = [IO.Path]::GetFullPath($BuildDirectory)
$output = [IO.Path]::GetFullPath($OutputDirectory)
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.x C# compiler is required to build the Windows installer.' }
New-Item -ItemType Directory -Path $build, $output -Force | Out-Null
$native = Join-Path $PSScriptRoot 'native'
$icon = Join-Path $project 'public\assets\branding\emilia.ico'
if (!(Test-Path -LiteralPath $icon -PathType Leaf)) { throw 'The EMILIA application icon is missing.' }
$references = @('/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll', '/r:System.Web.Extensions.dll')
$launcher = Join-Path $build 'Emilia.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ "/win32manifest:$native\app.manifest" "/win32icon:$icon" @references "/out:$launcher" (Join-Path $native 'Common.cs') (Join-Path $native 'Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$payload = Join-Path $build ('app-' + [Guid]::NewGuid().ToString('N') + '.zip')
$archive = [IO.Compression.ZipFile]::Open($payload, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in Get-ChildItem -LiteralPath $project -File -Recurse -Force) {
    $relative = $file.FullName.Substring($project.Length + 1).Replace('\', '/')
    if ($relative -match '^(runtime|work|dist|node_modules|\.venv|\.git|user-data)/' -or
        $relative -match '(^|/)(private|__pycache__|\.cache)/' -or
        $relative -match '^public/assets/voice/' -or
        ($relative -match '(^|/)\.env($|\.)' -and $relative -ne '.env.example') -or
        $relative -match '^\.emilia-(install|installing|user-data)\.json$' -or
        $relative -eq 'MANIFEST.sha256' -or
        $relative -match '\.(log|py[cod]|exe|zip|blob|part|wav|mp3|flac|ogg|m4a|webm|onnx|safetensors|pt|pth|bin|npz|key|pem|pfx|p12)$' -or
        $relative -match '\.(sqlite[^/]*|db(?:\d+)?(?:[-.].*)?)$') { continue }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $launcher, 'Emilia.exe', [IO.Compression.CompressionLevel]::Optimal) | Out-Null
} finally { $archive.Dispose() }
$licenses = Join-Path $build 'licenses.txt'
[IO.File]::WriteAllText($licenses, ([IO.File]::ReadAllText((Join-Path $project 'LICENSE')) + "`r`n`r`n" + [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'THIRD_PARTY_RUNTIME_NOTICES.md'))), [Text.UTF8Encoding]::new($false))
$setup = Join-Path $output 'EMILIA-1.3.4-Setup-x64.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ "/win32manifest:$native\app.manifest" "/win32icon:$icon" @references "/resource:$payload,app.zip" "/resource:$PSScriptRoot\artifacts.json,artifacts.json" "/resource:$licenses,licenses.txt" "/out:$setup" (Join-Path $native 'Common.cs') (Join-Path $native 'Setup.cs')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
Remove-Item -LiteralPath $payload
Get-FileHash -LiteralPath $setup -Algorithm SHA256
