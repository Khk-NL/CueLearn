# 启动现有桌面前端；明确选择项目支持的Node版本，不修改系统PATH或用户数据。
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

try {
    if (-not (Test-Path -LiteralPath 'node_modules/@electron-forge/cli')) {
        throw 'Dependencies are missing. Install Node.js 22 and Yarn 1, then run yarn install --frozen-lockfile.'
    }

    $nodeCandidates = @()
    $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($systemNode) { $nodeCandidates += $systemNode.Source }
    $nodeCandidates += @(Get-ChildItem -Path '.local/node22/node-*/node.exe' -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
    $selectedNode = $null
    foreach ($candidate in $nodeCandidates) {
        $version = & $candidate --version
        if ($LASTEXITCODE -eq 0 -and $version -match '^v22\.') {
            $selectedNode = $candidate
            break
        }
    }
    if (-not $selectedNode) { throw 'Node.js 22 is required. Activate Node 22 and run this script again.' }
    $env:PATH = "$(Split-Path $selectedNode -Parent);$env:PATH"
    Write-Host "[CueLearn] Node: $selectedNode"

    $yarnCommand = Get-Command yarn.cmd -ErrorAction Stop
    $yarnDirectory = Split-Path $yarnCommand.Source -Parent
    $yarnEntry = @('node_modules/yarn/bin/yarn.js', 'node_modules/corepack/dist/yarn.js') |
        ForEach-Object { Join-Path $yarnDirectory $_ } |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $yarnEntry) { throw 'Cannot locate the Yarn JavaScript entry next to yarn.cmd.' }
    if ($yarnEntry -like '*corepack*') {
        $corepackHome = if ($env:COREPACK_HOME) { $env:COREPACK_HOME } else { Join-Path $env:LOCALAPPDATA 'node/corepack' }
        $classicEntry = Join-Path $corepackHome 'v1/yarn/1.22.22/bin/yarn.js'
        if (-not (Test-Path -LiteralPath $classicEntry)) {
            throw 'Prepare the locked Yarn first: corepack prepare yarn@1.22.22 --activate'
        }
        $yarnEntry = $classicEntry
    }
    # 某些Corepack的yarn.cmd固定调用相邻Node，直接调用JS入口才能确保使用Node22。
    Write-Host "[CueLearn] Yarn entry: $yarnEntry"
    $yarnVersion = & $selectedNode $yarnEntry --version
    $yarnExit = $LASTEXITCODE
    Write-Host "[CueLearn] Yarn: $yarnVersion (exit $yarnExit)"
    if ($yarnExit -ne 0 -or ($yarnVersion -join '').Trim() -notmatch '^1\.') { throw 'Yarn Classic 1.x is required.' }

    # 本机显式配置的SDK修复文件只作用于当前进程，不修改Visual Studio或注册表。
    $sdkConfiguration = Join-Path $PWD '.local/windows-sdk.props'
    if (Test-Path -LiteralPath $sdkConfiguration) {
        Write-Host "[CueLearn] Local MSBuild SDK configuration: $sdkConfiguration"
        $env:ForceImportAfterCppProps = $sdkConfiguration
    }

    if (-not (Test-Path -LiteralPath 'node_modules/electron/dist/electron.exe')) {
        Write-Host '[CueLearn] Installing the locked Electron runtime...'
        & $selectedNode node_modules/electron/install.js
        if ($LASTEXITCODE -ne 0) { throw 'Electron runtime installation failed.' }
    }

    & $selectedNode $yarnEntry start
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
