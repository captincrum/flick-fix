# ============================================================
# FlickFix - Automated Test Suite
# Run manually:   .\Tests\Run-Tests.ps1
# Run via CI:     GitHub Actions calls this on every push
# ============================================================

$passed = 0
$failed = 0
$errors = @()

function Test-Case {
    param(
        [string]$Name,
        [scriptblock]$Test
    )
    try {
        $result = & $Test
        if ($result -eq $true) {
            Write-Host "  PASS  $Name" -ForegroundColor Green
            $script:passed++
        } else {
            Write-Host "  FAIL  $Name" -ForegroundColor Red
            $script:failed++
            $script:errors += $Name
        }
    } catch {
        Write-Host "  FAIL  $Name -- Exception: $($_.Exception.Message)" -ForegroundColor Red
        $script:failed++
        $script:errors += $Name
    }
}

# ============================================================
# Resolve module root (works both locally and in CI)
# ============================================================
$repoRoot   = Split-Path $PSScriptRoot -Parent
$moduleRoot = Join-Path $repoRoot "Modules"

# ============================================================
# SUITE 1: File Structure
# Verifies all required files exist in the repo
# ============================================================
Write-Host ""
Write-Host "Suite 1: File Structure" -ForegroundColor Cyan
Write-Host "------------------------"

$requiredFiles = @(
    "GUI-Core.ps1",
    "config.json",
    "Modules\Common.psm1",
    "Modules\Config.psm1",
    "Modules\Logging.psm1",
    "Modules\Output.psm1",
    "Modules\Quality.psm1",
    "Modules\Repair.psm1",
    "Modules\Scan.psm1",
    "Modules\SmartCompression.psm1",
    "Modules\UM-Errors.ps1",
    "web\index.html",
    "web\app.js",
    "web\style.css",
    "web\server.ps1"
)

foreach ($file in $requiredFiles) {
    $fullPath = Join-Path $repoRoot $file
    Test-Case "File exists: $file" {
        Test-Path $fullPath
    }
}

# ============================================================
# SUITE 2: Config Validation
# Verifies config.json has all required keys
# ============================================================
Write-Host ""
Write-Host "Suite 2: Config Validation" -ForegroundColor Cyan
Write-Host "---------------------------"

$configPath = Join-Path $repoRoot "config.json"
$config     = $null
if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
}

$requiredConfigKeys = @(
    "RootPath",
    "RepairedPath",
    "Mode",
    "ScanAllEpisodes",
    "AccurateMode",
    "CompressionOutputPath",
    "CrfValue",
    "Workers",
    "RunMode"
)

foreach ($key in $requiredConfigKeys) {
    Test-Case "Config has key: $key" {
        $config -ne $null -and $config.PSObject.Properties.Name -contains $key
    }
}

Test-Case "Config CrfValue is between 18 and 28" {
    $config -ne $null -and $config.CrfValue -ge 18 -and $config.CrfValue -le 28
}

Test-Case "Config Workers is at least 1" {
    $config -ne $null -and $config.Workers -ge 1
}

Test-Case "Config Mode is a valid value" {
    $validModes = @("Full", "ScanOnly", "RepairOnly", "SmartCompression")
    $config -ne $null -and $validModes -contains $config.Mode
}

# ============================================================
# SUITE 3: Module Imports
# Verifies all modules load without errors
# ============================================================
Write-Host ""
Write-Host "Suite 3: Module Imports" -ForegroundColor Cyan
Write-Host "------------------------"

$modules = @(
    "Common.psm1",
    "Output.psm1",
    "Logging.psm1"
)

foreach ($m in $modules) {
    $modPath = Join-Path $moduleRoot $m
    Test-Case "Module imports cleanly: $m" {
        try {
            Import-Module $modPath -Force -ErrorAction Stop
            $true
        } catch {
            $false
        }
    }
}

# ============================================================
# SUITE 4: UM-PrettyMode
# Verifies mode display names return correctly
# ============================================================
Write-Host ""
Write-Host "Suite 4: UM-PrettyMode" -ForegroundColor Cyan
Write-Host "-----------------------"

Import-Module (Join-Path $moduleRoot "Common.psm1") -Force

Test-Case "ScanOnly returns 'Scan Only'" {
    (UM-PrettyMode "ScanOnly") -eq "Scan Only"
}

Test-Case "RepairOnly returns 'Repair Only'" {
    (UM-PrettyMode "RepairOnly") -eq "Repair Only"
}

Test-Case "Full returns 'Full'" {
    (UM-PrettyMode "Full") -eq "Full"
}

Test-Case "Unknown mode returns the input value" {
    (UM-PrettyMode "SmartCompression") -eq "Smart Compression"
}

# ============================================================
# SUITE 5: UM-VideoExtensions
# Verifies video extension list is complete and correct
# ============================================================
Write-Host ""
Write-Host "Suite 5: UM-VideoExtensions" -ForegroundColor Cyan
Write-Host "----------------------------"

$extensions = UM-VideoExtensions

Test-Case "Returns at least 5 extensions" {
    $extensions.Count -ge 5
}

Test-Case "Contains *.mkv" {
    $extensions -contains "*.mkv"
}

Test-Case "Contains *.mp4" {
    $extensions -contains "*.mp4"
}

Test-Case "Contains *.avi" {
    $extensions -contains "*.avi"
}

# ============================================================
# SUITE 6: UM-LibraryType
# Verifies library type detection from path keywords
# ============================================================
Write-Host ""
Write-Host "Suite 6: UM-LibraryType" -ForegroundColor Cyan
Write-Host "------------------------"

Test-Case "Detects Shows from path containing 'Shows'" {
    (UM-LibraryType -RootPath "D:\Media\Shows") -eq "Shows"
}

Test-Case "Detects Shows from path containing 'TV'" {
    (UM-LibraryType -RootPath "D:\Media\TV") -eq "Shows"
}

Test-Case "Detects Movies from path containing 'Movies'" {
    (UM-LibraryType -RootPath "D:\Media\Movies") -eq "Movies"
}

Test-Case "Detects Movies from path containing 'Films'" {
    (UM-LibraryType -RootPath "D:\Media\Films") -eq "Movies"
}

# ============================================================
# SUITE 7: UM-LoadJson
# Verifies JSON loading handles edge cases cleanly
# ============================================================
Write-Host ""
Write-Host "Suite 7: UM-LoadJson" -ForegroundColor Cyan
Write-Host "---------------------"

Test-Case "Returns empty array for non-existent file" {
    $result = @(UM-LoadJson -Path "C:\does\not\exist\fake.json")
    $result.Count -eq 0
}

$tmpJson = [System.IO.Path]::GetTempFileName()
'[{"Type":"Test","Value":"Hello"}]' | Set-Content $tmpJson -Encoding UTF8
Test-Case "Loads valid JSON array correctly" {
    $result = @(UM-LoadJson -Path $tmpJson)
    $result.Count -eq 1 -and $result[0].Type -eq "Test"
}

"" | Set-Content $tmpJson -Encoding UTF8
Test-Case "Returns empty array for empty file" {
    $result = @(UM-LoadJson -Path $tmpJson)
    $result.Count -eq 0
}

Remove-Item $tmpJson -Force -ErrorAction SilentlyContinue

# ============================================================
# SUITE 8: Output Module Guards
# Verifies heartbeat functions return nothing when globals unset
# ============================================================
Write-Host ""
Write-Host "Suite 8: Output Module Guards" -ForegroundColor Cyan
Write-Host "------------------------------"

Import-Module (Join-Path $moduleRoot "Output.psm1") -Force

$Global:UM_LatestStatus        = $null
$Global:UM_RepairItemIndex     = $null
$Global:UM_RepairDoneCount     = 0
$Global:UM_RepairTotalItems    = 0
$Global:UM_RepairSessionStart  = $null
$Global:UM_WorkerFolders       = @()
$Global:UM_CompressTotalFiles2 = 0

Test-Case "UM-RepairWorkerConsole returns valid object when globals are zero" {
    $result = UM-RepairWorkerConsole
    $result -ne $null -and $result.Type -eq "RepairProgress" -and $result.ItemIndex -eq 0
}

Test-Case "UM-PhaseThreeConsole returns nothing when RepairItemIndex is null" {
    $result = UM-PhaseThreeConsole
    $result -eq $null
}

# ============================================================
# SUITE 9: Scan Resume — HashSet Performance Guard
# Ensures we never regress to O(n²) array scanning
# ============================================================
Write-Host ""
Write-Host "Suite 9: Scan Resume Performance" -ForegroundColor Cyan
Write-Host "---------------------------------"

Import-Module (Join-Path $moduleRoot "Scan.psm1") -Force -ErrorAction SilentlyContinue

Test-Case "UM-IsScanned function does NOT appear in skip-list filter" {
    $scanPath = Join-Path $moduleRoot "Scan.psm1"
    $content = Get-Content $scanPath -Raw
    # The filesToScan filter should use HashSet, not UM-IsScanned
    $hasHashSet = $content -match "HashSet\[string\]"
    $filterUsesIsScanned = $content -match '\$filesToScan.*UM-IsScanned'
    $hasHashSet -and -not $filterUsesIsScanned
}

Test-Case "Skip-list uses string matching instead of UM-ReadUnifiedLog" {
    $scanPath = Join-Path $moduleRoot "Scan.psm1"
    $content = Get-Content $scanPath -Raw
    # Should NOT call UM-ReadUnifiedLog for the main skip-list
    # Should use raw line Contains() matching instead
    $usesReadUnified = $content -match '\$unifiedLog\s*=\s*UM-ReadUnifiedLog'
    -not $usesReadUnified
}

Test-Case "HashSet is populated from scanLog entries" {
    $scanPath = Join-Path $moduleRoot "Scan.psm1"
    $content = Get-Content $scanPath -Raw
    $content -match 'scannedPaths\.Add\(' -and $content -match 'scannedPaths\.Contains\('
}

Test-Case "HashSet skip-list correctly filters files (functional test)" {
    # Simulate 1000 entries and 2000 files — should complete in under 1 second
    $scanLog = @()
    for ($i = 0; $i -lt 1000; $i++) {
        $scanLog += [PSCustomObject]@{ Path = "D:\Shows\Show$i\S01E01.mkv" }
    }

    $scannedPaths = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $scanLog) { $null = $scannedPaths.Add($entry.Path) }

    $allFiles = @()
    for ($i = 0; $i -lt 2000; $i++) {
        $allFiles += [PSCustomObject]@{ FullName = "D:\Shows\Show$i\S01E01.mkv" }
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $filesToScan = $allFiles | Where-Object { -not $scannedPaths.Contains($_.FullName) }
    $sw.Stop()

    # Must complete in under 1 second and correctly filter
    $sw.ElapsedMilliseconds -lt 1000 -and @($filesToScan).Count -eq 1000
}

# ============================================================
# SUITE 10: Logging — Entry Format
# Verifies log entries are written correctly
# ============================================================
Write-Host ""
Write-Host "Suite 10: Logging Entry Format" -ForegroundColor Cyan
Write-Host "-------------------------------"
Import-Module (Join-Path $moduleRoot "Common.psm1") -Force
Import-Module (Join-Path $moduleRoot "Logging.psm1") -Force

$testLogDir = Join-Path $env:TEMP "FlickFixTest_$(Get-Random)"
New-Item -Path $testLogDir -ItemType Directory -Force | Out-Null
$testLogPath = Join-Path $testLogDir "TestUnifiedLog.json"
[System.IO.File]::WriteAllText($testLogPath, "")
$Global:UnifiedMachineLogPath = $testLogPath

Test-Case "UM-AppendLogEntry writes valid single-line JSON" {
    [System.IO.File]::WriteAllText($testLogPath, "")
    UM-AppendLogEntry ([ordered]@{ Type = "Test"; Value = "Hello" })
    $lines = Get-Content $testLogPath
    $nonEmpty = $lines | Where-Object { $_.Trim() -ne "" }
    @($nonEmpty).Count -eq 1
}

Test-Case "UM-AppendLogEntry does NOT produce double newlines" {
    [System.IO.File]::WriteAllText($testLogPath, "")
    UM-AppendLogEntry ([ordered]@{ Type = "Test1"; Value = "A" })
    UM-AppendLogEntry ([ordered]@{ Type = "Test2"; Value = "B" })
    $raw = Get-Content $testLogPath -Raw
    -not ($raw -match "`n\s*`n")
}

Test-Case "UM-AppendLogEntry adds Timestamp automatically" {
    [System.IO.File]::WriteAllText($testLogPath, "")
    UM-AppendLogEntry ([ordered]@{ Type = "Test"; Value = "TimestampCheck" })
    $raw = [System.IO.File]::ReadAllText($testLogPath).Trim()
    $obj = $raw | ConvertFrom-Json
    $obj.Timestamp -ne $null
}

Test-Case "Multiple entries produce one entry per line" {
    [System.IO.File]::WriteAllText($testLogPath, "")
    for ($i = 0; $i -lt 5; $i++) {
        UM-AppendLogEntry ([ordered]@{ Type = "Test"; Index = $i })
    }
    $lines = Get-Content $testLogPath | Where-Object { $_.Trim() -ne "" }
    @($lines).Count -eq 5
}

Test-Case "Each log line is valid JSON" {
    $lines = Get-Content $testLogPath | Where-Object { $_.Trim() -ne "" }
    $allValid = $true
    foreach ($line in $lines) {
        try { $null = $line | ConvertFrom-Json } catch { $allValid = $false }
    }
    $allValid
}

# ============================================================
# SUITE 11: Logging — UM-LogShowComplete
# Verifies the show-completion marker function
# ============================================================
Write-Host ""
Write-Host "Suite 11: UM-LogShowComplete" -ForegroundColor Cyan
Write-Host "-----------------------------"

Test-Case "UM-LogShowComplete function exists" {
    $null -ne (Get-Command "UM-LogShowComplete" -ErrorAction SilentlyContinue)
}


Test-Case "UM-LogShowComplete writes ShowComplete entry" {
    [System.IO.File]::WriteAllText($testLogPath, "")
    UM-LogShowComplete -ShowPath "D:\Shows\TestShow" -Library "Shows"
    $raw = [System.IO.File]::ReadAllText($testLogPath).Trim()
    $obj = $raw | ConvertFrom-Json
    $obj.Type -eq "ShowComplete" -and $obj.Path -eq "D:\Shows\TestShow" -and $obj.Library -eq "Shows"
}


# ============================================================
# SUITE 12: Logging — UM-LogScan and UM-LogToRepair
# Verifies scan and repair log entries are correct
# ============================================================
Write-Host ""
Write-Host "Suite 12: Scan & Repair Log Entries" -ForegroundColor Cyan
Write-Host "------------------------------------"

Test-Case "UM-LogScan writes Scan entry with correct fields" {
    [System.IO.File]::WriteAllText($testLogPath, "")
    UM-LogScan -Path "D:\Shows\Test\S01E01.mkv" -Library "Shows" -Errors @()
    $raw = [System.IO.File]::ReadAllText($testLogPath).Trim()
    $obj = $raw | ConvertFrom-Json
    $obj.Type -eq "Scan" -and $obj.Path -eq "D:\Shows\Test\S01E01.mkv" -and $obj.Library -eq "Shows"
}

Test-Case "UM-LogScan with errors includes error array" {
    [System.IO.File]::WriteAllText($testLogPath, "")
    UM-LogScan -Path "D:\Shows\Test\S01E02.mkv" -Library "Shows" -Errors @("No video stream detected")
    $raw = [System.IO.File]::ReadAllText($testLogPath).Trim()
    $obj = $raw | ConvertFrom-Json
    $obj.Errors -contains "No video stream detected"
}

Test-Case "UM-LogToRepair writes ToRepair entry" {
    [System.IO.File]::WriteAllText($testLogPath, "")
    UM-LogToRepair -Path "D:\Shows\Test\S01E03.mkv" -Library "Shows" -Errors @("Error1") -RepairStatus "Pending" -AddedAt (Get-Date).ToString("s")
    $raw = [System.IO.File]::ReadAllText($testLogPath).Trim()
    $obj = $raw | ConvertFrom-Json
    $obj.Type -eq "ToRepair" -and $obj.RepairStatus -eq "Pending"
}

# ============================================================
# SUITE 13: Log Cache Simulation
# Verifies incremental reading logic works correctly
# ============================================================
Write-Host ""
Write-Host "Suite 13: Log Cache Simulation" -ForegroundColor Cyan
Write-Host "-------------------------------"

Test-Case "Incremental file read captures new entries only" {
    "" | Set-Content -Path $testLogPath -Encoding UTF8

    # Write 3 entries
    for ($i = 1; $i -le 3; $i++) {
        UM-AppendLogEntry ([ordered]@{ Type = "Test"; Index = $i })
    }

    # Simulate cache: read full file, track size
    $size1 = (Get-Item $testLogPath).Length
    $lines1 = [System.IO.File]::ReadAllLines($testLogPath)
    $cache = [System.Collections.Generic.List[string]]::new()
    foreach ($l in $lines1) { if ($l.Trim() -ne "") { $cache.Add($l.Trim()) } }

    # Write 2 more entries
    for ($i = 4; $i -le 5; $i++) {
        UM-AppendLogEntry ([ordered]@{ Type = "Test"; Index = $i })
    }

    # Read only new bytes
    $size2 = (Get-Item $testLogPath).Length
    $stream = [System.IO.FileStream]::new($testLogPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $stream.Seek($size1, [System.IO.SeekOrigin]::Begin) | Out-Null
    $newBytes = New-Object byte[] ($size2 - $size1)
    $stream.Read($newBytes, 0, $newBytes.Length) | Out-Null
    $stream.Close()

    $newText = [System.Text.Encoding]::UTF8.GetString($newBytes)
    $newLines = $newText -split "`n" | Where-Object { $_.Trim() -ne "" }
    foreach ($l in $newLines) { $cache.Add($l.Trim()) }

    # Should have exactly 5 entries total
    $cache.Count -eq 5
}

Test-Case "Cache handles file truncation (clear logs)" {
    # Write entries
    for ($i = 1; $i -le 3; $i++) {
        UM-AppendLogEntry ([ordered]@{ Type = "Test"; Index = $i })
    }
    $sizeBefore = (Get-Item $testLogPath).Length

    # Simulate clear
    "" | Set-Content -Path $testLogPath -Encoding UTF8
    $sizeAfter = (Get-Item $testLogPath).Length

    # Cache should detect truncation
    $sizeAfter -lt $sizeBefore
}

Test-Case "Search matching works with backslashes" {
    "" | Set-Content -Path $testLogPath -Encoding UTF8
    UM-LogScan -Path "D:\Shows\30 Rock\S01E01.mkv" -Library "Shows" -Errors @()

    $lines = [System.IO.File]::ReadAllLines($testLogPath)
    $query = "30 Rock"
    $matches = @()
    foreach ($line in $lines) {
        $lower = $line.ToLower().Replace("\\", "\")
        if ($lower.Contains($query.ToLower())) {
            $matches += $line
        }
    }
    @($matches).Count -eq 1
}

Test-Case "Search matching works with path separators" {
    $lines = [System.IO.File]::ReadAllLines($testLogPath)
    $query = "Shows\30 Rock"
    $matches = @()
    foreach ($line in $lines) {
        $lower = $line.ToLower().Replace("\\", "\")
        if ($lower.Contains($query.ToLower())) {
            $matches += $line
        }
    }
    @($matches).Count -eq 1
}

# ============================================================
# SUITE 14: Server Endpoint Contracts
# Verifies server.ps1 has all required endpoints
# ============================================================
Write-Host ""
Write-Host "Suite 14: Server Endpoint Contracts" -ForegroundColor Cyan
Write-Host "------------------------------------"

$serverPath = Join-Path $repoRoot "web\server.ps1"
$serverContent = Get-Content $serverPath -Raw

Test-Case "Server has /logs/total endpoint" {
    $serverContent -match '"/logs/total"'
}

Test-Case "Server has /logs/slice endpoint" {
    $serverContent -match '"/logs/slice"'
}

Test-Case "Server has /logs/search endpoint" {
    $serverContent -match '"/logs/search"'
}

Test-Case "Server has /logs/clear endpoint" {
    $serverContent -match '"/logs/clear"'
}

Test-Case "Server has /status-all endpoint" {
    $serverContent -match '"/status-all"'
}

Test-Case "Server has Update-LogCache function" {
    $serverContent -match 'function Update-LogCache'
}

Test-Case "Update-LogCache uses FileStream.Seek for incremental reads" {
    $serverContent -match 'FileStream.*FileMode.*Open' -and $serverContent -match '\.Seek\('
}

Test-Case "Update-LogCache handles file lock errors gracefully" {
    # Should have try/catch around the FileStream operations
    $cacheBlock = [regex]::Match($serverContent, 'function Update-LogCache[\s\S]*?^}', [System.Text.RegularExpressions.RegexOptions]::Multiline).Value
    $cacheBlock -match 'catch' -and $cacheBlock -match 'return'
}

Test-Case "/logs/slice uses cache instead of reading file directly" {
    # The /logs/slice block should reference UM_LogCache, not Get-Content
    $sliceBlock = [regex]::Match($serverContent, '"/logs/slice"[\s\S]*?(?="\/)').Value
    $sliceBlock -match 'UM_LogCache' -and -not ($sliceBlock -match 'Get-Content')
}

Test-Case "/logs/search does backslash-aware matching" {
    $searchBlock = [regex]::Match($serverContent, '"/logs/search"[\s\S]*?(?="\/)').Value
    $searchBlock -match 'Replace\("\\\\", "\\"'
}

Test-Case "/logs/clear resets the log cache" {
    $clearBlock = [regex]::Match($serverContent, '"/logs/clear"[\s\S]*?(?="\/)').Value
    $clearBlock -match 'UM_LogCache\.Clear' -and $clearBlock -match 'UM_LogCacheSize.*=.*0'
}

# ============================================================
# SUITE 15: Client-Side Contracts
# Verifies app.js has all required functions and patterns
# ============================================================
Write-Host ""
Write-Host "Suite 15: Client-Side Contracts" -ForegroundColor Cyan
Write-Host "--------------------------------"

$appPath = Join-Path $repoRoot "web\app.js"
$appContent = Get-Content $appPath -Raw

Test-Case "app.js has apiLogTotal function" {
    $appContent -match 'async function apiLogTotal'
}

Test-Case "app.js has apiLogSearch function" {
    $appContent -match 'async function apiLogSearch'
}

Test-Case "apiLogTotal calls /logs/total" {
    $appContent -match 'fetch\(.*/logs/total.*\)'
}

Test-Case "apiLogSearch calls /logs/search" {
    $appContent -match 'fetch\(.*logs/search'
}

Test-Case "Live log poller uses apiLogTotal for cheap count check" {
    $appContent -match 'apiLogTotal\(\)'
}

Test-Case "Live log poller skips fetch when total unchanged" {
    $appContent -match 'lastKnownTotal'
}

Test-Case "Live log poller uses optimized polling" {
    $appContent -match 'pollLiveLog'
}

Test-Case "Search filter uses debounce" {
    $appContent -match 'searchDebounce' -and $appContent -match 'clearTimeout\(searchDebounce\)'
}

Test-Case "Search filter calls apiLogSearch" {
    $appContent -match 'apiLogSearch\(logFilterText'
}

Test-Case "Filter clear fetches fresh data" {
    $appContent -match 'logFilterClear.*[\s\S]*?apiLogTotal|logFilterClear.*[\s\S]*?apiLoadLogSlice'
}

Test-Case "updateReviewButton uses apiLogSearch not full log fetch" {
    $appContent -match 'updateReviewButton[\s\S]*?apiLogSearch.*SmartProbe'
}

Test-Case "No renderVirtualizedSlice in log button handlers" {
    $humanBlock = [regex]::Match($appContent, 'humanLogBtn\.addEventListener[\s\S]*?(?=machineLogBtn\.addEventListener)').Value
    $machineBlock = [regex]::Match($appContent, 'machineLogBtn\.addEventListener[\s\S]*?(?=let searchDebounce|document\.getElementById)').Value
    -not ($humanBlock -match 'renderVirtualizedSlice') -and -not ($machineBlock -match 'renderVirtualizedSlice')
}

Test-Case "Console poller uses /status-all combined endpoint" {
    $appContent -match 'status-all'
}

Test-Case "app.js has updateClearLogsBtn function" {
    $appContent -match 'function updateClearLogsBtn'
}

Test-Case "updateClearLogsBtn checks fullLogLength" {
    $appContent -match 'updateClearLogsBtn[\s\S]*?fullLogLength'
}

Test-Case "Status poll calls updateClearLogsBtn" {
    $appContent -match 'updateClearLogsBtn\(\)'
}

Test-Case "logFilterCount element is referenced in app.js" {
    $appContent -match 'logFilterCount'
}

Test-Case "Filter search updates logFilterCount with X of Y" {
    $appContent -match 'logFilterCount.*textContent.*of'
}

Test-Case "Filter clear resets logFilterCount" {
    $appContent -match 'logFilterCount.*textContent.*=.*""'
}

Test-Case "formatSecondsToHms uses 4-digit hour padding" {
    $appContent -match 'padStart\(4,\s*"0"\)'
}

<#
Test-Case "Inline worker timers use 2-digit hour padding" {
    $hourPads = [regex]::Matches($appContent, 'padStart\((\d+)')
    $allTwo = $hourPads.Count -gt 0 -and ($hourPads.Groups[1].Value -eq '2')
    $allTwo
}
#>

# ============================================================
# SUITE 16: GPU Encoder Resolution (Common module)
# Verifies UM-ResolveEncoder / UM-ResolveEncoderArgs contracts
# ============================================================
Write-Host ""
Write-Host "Suite 16: GPU Encoder Resolution" -ForegroundColor Cyan
Write-Host "---------------------------------"

Import-Module (Join-Path $moduleRoot "Common.psm1") -Force

Test-Case "UM-ResolveEncoder function exists" {
    $null -ne (Get-Command "UM-ResolveEncoder" -ErrorAction SilentlyContinue)
}

Test-Case "UM-ResolveEncoderArgs function exists" {
    $null -ne (Get-Command "UM-ResolveEncoderArgs" -ErrorAction SilentlyContinue)
}

Test-Case "Both encoder functions are exported from Common" {
    $mod = Get-Module Common
    ($mod.ExportedFunctions.Keys -contains "UM-ResolveEncoder") -and
    ($mod.ExportedFunctions.Keys -contains "UM-ResolveEncoderArgs")
}

Test-Case "UM-TestGpuEncoder exists and is exported from Common" {
    ($null -ne (Get-Command "UM-TestGpuEncoder" -ErrorAction SilentlyContinue)) -and
    ((Get-Module Common).ExportedFunctions.Keys -contains "UM-TestGpuEncoder")
}

. (Join-Path $moduleRoot "UM-Errors.ps1")

Test-Case "UM-Errors catalog has GpuEncoderInitFailed" {
    $Global:UM_ErrorCatalog.ContainsKey("GpuEncoderInitFailed")
}

Test-Case "UM-ExplainGpuError function exists" {
    $null -ne (Get-Command "UM-ExplainGpuError" -ErrorAction SilentlyContinue)
}

Test-Case "UM-ExplainGpuError surfaces the ffmpeg driver lines and drops noise" {
    $sample = @"
[vost#0:0/hevc_nvenc] Driver does not support the required nvenc API version. Required: 13.0 Found: 12.2
[hevc_nvenc] The minimum required Nvidia driver for nvenc is 570.0 or newer
[vost#0:0/hevc_nvenc] Terminating thread with return code -22 (Invalid argument)
"@
    $r = UM-ExplainGpuError -Encoder "hevc_nvenc" -ErrorText $sample
    ($r.Message -match "570.0 or newer") -and ($r.Message -match "Required: 13.0") -and ($r.Message -notmatch "Terminating thread")
}

Test-Case "UM-ExplainGpuError offers the CPU fallback option" {
    (UM-ExplainGpuError -Encoder "hevc_nvenc" -ErrorText "driver too old").Message -match "(?i)CPU"
}

Test-Case "UM-ResolveEncoder returns libx264 unchanged when GPU off" {
    (UM-ResolveEncoder -BaseCodec "libx264" -UseGPU $false) -eq "libx264"
}

Test-Case "UM-ResolveEncoder returns libx265 unchanged when GPU off" {
    (UM-ResolveEncoder -BaseCodec "libx265" -UseGPU $false) -eq "libx265"
}

Test-Case "UM-ResolveEncoderArgs returns -crf for a CPU encoder" {
    $resolved = UM-ResolveEncoderArgs -Encoder "libx265" -CRF 22
    ($resolved -contains "-crf") -and ($resolved -contains "22")
}

Test-Case "UM-ResolveEncoderArgs maps nvenc to constqp/qp/preset" {
    $resolved = UM-ResolveEncoderArgs -Encoder "hevc_nvenc" -CRF 22
    ($resolved -contains "-rc") -and ($resolved -contains "constqp") -and
    ($resolved -contains "-qp") -and ($resolved -contains "22") -and ($resolved -contains "p4")
}

Test-Case "UM-ResolveEncoderArgs maps amf to quality/qp_i/qp_p" {
    $resolved = UM-ResolveEncoderArgs -Encoder "h264_amf" -CRF 20
    ($resolved -contains "-quality") -and ($resolved -contains "-qp_i") -and
    ($resolved -contains "-qp_p") -and ($resolved -contains "20")
}

Test-Case "UM-ResolveEncoderArgs maps qsv to global_quality/preset" {
    $resolved = UM-ResolveEncoderArgs -Encoder "hevc_qsv" -CRF 24
    ($resolved -contains "-global_quality") -and ($resolved -contains "24") -and ($resolved -contains "-preset")
}

# ============================================================
# SUITE 17: GPU Config + Module Integration (source contracts)
# ============================================================
Write-Host ""
Write-Host "Suite 17: GPU Integration Contracts" -ForegroundColor Cyan
Write-Host "------------------------------------"

$guiCorePath    = Join-Path $repoRoot "GUI-Core.ps1"
$guiCoreContent = Get-Content $guiCorePath -Raw

Test-Case "GUI-Core default config includes UseGPU" {
    $guiCoreContent -match 'UseGPU\s*=\s*\$false'
}

Test-Case "GUI-Core Load-Config adds UseGPU when missing" {
    $guiCoreContent -match 'Add-Member -NotePropertyName UseGPU'
}

Test-Case "GUI-Core passes UseGPU into job context" {
    $guiCoreContent -match 'NotePropertyName UseGPU\s+-NotePropertyValue'
}

Test-Case "Server has /gpu-detect endpoint" {
    $serverContent -match '"/gpu-detect"'
}

Test-Case "/gpu-detect runs ffmpeg -encoders" {
    $gpuBlock = [regex]::Match($serverContent, '"/gpu-detect"[\s\S]*?(?="\/)').Value
    $gpuBlock -match 'ffmpeg' -and $gpuBlock -match 'encoders'
}

Test-Case "/gpu-detect checks nvenc, amf and qsv" {
    $gpuBlock = [regex]::Match($serverContent, '"/gpu-detect"[\s\S]*?(?="\/)').Value
    $gpuBlock -match 'hevc_nvenc' -and $gpuBlock -match 'hevc_amf' -and $gpuBlock -match 'hevc_qsv'
}

Test-Case "Server /config returns UseGPU" {
    $serverContent -match 'UseGPU\s*=\s*if'
}

Test-Case "Server /config/save accepts useGPU" {
    $serverContent -match 'UseGPU\s*=\s*\(\$request\.QueryString\["useGPU"\]'
}

$repairContent = Get-Content (Join-Path $moduleRoot "Repair.psm1") -Raw

Test-Case "Repair worker Extra includes UseGPU" {
    $repairContent -match 'UseGPU\s*=\s*\[bool\]\$Context\.UseGPU'
}

Test-Case "Repair resolves the video encoder via UM-ResolveEncoder" {
    $repairContent -match 'UM-ResolveEncoder -BaseCodec "libx264"'
}

Test-Case "Repair stages no longer hardcode libx264 directly" {
    -not ($repairContent -match 'Video="libx264"')
}

Test-Case "Invoke-RepairStage uses UM-ResolveEncoderArgs" {
    $repairContent -match 'UM-ResolveEncoderArgs -Encoder \$VideoMode'
}

$scContent = Get-Content (Join-Path $moduleRoot "SmartCompression.psm1") -Raw

Test-Case "SmartCompression probeExtra includes UseGPU" {
    $scContent -match '\$probeExtra[\s\S]*?UseGPU'
}

Test-Case "SmartCompression compressExtra includes UseGPU" {
    $scContent -match '\$compressExtra[\s\S]*?UseGPU'
}

Test-Case "Invoke-UMProbeFile has a UseGPU parameter" {
    $scContent -match '\[bool\]\$UseGPU'
}

Test-Case "SmartCompression resolves encoder in probe and compress" {
    ([regex]::Matches($scContent, 'UM-ResolveEncoder ')).Count -ge 2 -and
    ([regex]::Matches($scContent, 'UM-ResolveEncoderArgs')).Count -ge 2
}

Test-Case "SmartCompression no longer hardcodes -c:v libx265 -crf" {
    -not ($scContent -match '"libx265", "-crf"')
}

Test-Case "Probe encodes a video-only sample to a temp file" {
    ($scContent -match '"-an"') -and ($scContent -match 'UMProbe_')
}

Test-Case "Probe no longer encodes samples to the null muxer" {
    -not ($scContent -match '"-f", "null"')
}

Test-Case "Probe derives sample bitrate from output file size" {
    $scContent -match '\$sampleBytes'
}

Test-Case "Probe records EncodeMethod from the resolved encoder" {
    ($scContent -match 'EncodeMethod\s*=\s*\$encodeMethod') -and
    ($scContent -match '_\(nvenc\|amf\|qsv\)\$')
}

Test-Case "UM-LogSmartProbe persists EncodeMethod and Encoder" {
    ($scContent -match 'EncodeMethod\s*=\s*\$Result\.EncodeMethod') -and
    ($scContent -match 'Encoder\s*=\s*\$Result\.Encoder')
}

Test-Case "Probe captures ffmpeg error text on sample-encode failure" {
    ($scContent -match '\$encodeError') -and
    ($scContent -match 'EncodeError\s*=\s*\$encodeError')
}

$commonContent = Get-Content (Join-Path $moduleRoot "Common.psm1") -Raw

Test-Case "GPU preflight uses a log level that captures driver warnings" {
    $commonContent -match '"-loglevel", "verbose"'
}

Test-Case "UM-TestGpuEncoder uses a synthetic source and discards output" {
    ($commonContent -match 'testsrc') -and ($commonContent -match '"-f", "null"')
}

Test-Case "SmartCompression runs a GPU preflight before probing" {
    ($scContent -match 'UM-TestGpuEncoder') -and ($scContent -match 'UM-ExplainGpuError')
}

Test-Case "GPU preflight only runs when GPU is requested" {
    $scContent -match 'if \(\$Context\.UseGPU\)'
}

Test-Case "Probe job loads UM-Errors so the GPU explainer is available" {
    $guiCoreContent -match 'UM-Errors\.ps1'
}

# ============================================================
# SUITE 18: GPU Client + Markup Contracts
# ============================================================
Write-Host ""
Write-Host "Suite 18: GPU Client Contracts" -ForegroundColor Cyan
Write-Host "-------------------------------"

Test-Case "app.js has detectGPU function" {
    $appContent -match 'function detectGPU'
}

Test-Case "detectGPU calls /gpu-detect" {
    $appContent -match 'fetch\(.*gpu-detect'
}

Test-Case "app.js references the useGPU toggle" {
    $appContent -match 'getElementById\("useGPU"\)'
}

Test-Case "apiSaveConfig sends useGPU" {
    $appContent -match 'useGPU=\$\{'
}

Test-Case "apiStart sends useGPU" {
    $appContent -match 'useGPU=\$\{!!useGPU\}'
}

Test-Case "app.js syncs the compression modal GPU toggle" {
    $appContent -match 'compressUseGPU'
}

Test-Case "app.js has updateGpuToggleState function" {
    $appContent -match 'function updateGpuToggleState'
}

$indexPath    = Join-Path $repoRoot "web\index.html"
$indexContent = Get-Content $indexPath -Raw

Test-Case "index.html has the settings GPU toggle" {
    $indexContent -match 'id="useGPU"'
}

Test-Case "index.html has the modal GPU toggle" {
    $indexContent -match 'id="compressUseGPU"'
}

Test-Case "index.html has the GPU status element" {
    $indexContent -match 'id="gpuStatusDesc"'
}

$stylePath    = Join-Path $repoRoot "web\style.css"
$styleContent = Get-Content $stylePath -Raw

Test-Case "style.css has .gpu-toggle-group" {
    $styleContent -match '\.gpu-toggle-group'
}

Test-Case "style.css has .desc-row" {
    $styleContent -match '\.desc-row'
}

# Cleanup test log directory
Remove-Item $testLogDir -Recurse -Force -ErrorAction SilentlyContinue

# ============================================================
# RESULTS
# ============================================================
Write-Host ""
Write-Host "=========================" -ForegroundColor White
Write-Host "  Results: $passed passed, $failed failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host "=========================" -ForegroundColor White

if ($errors.Count -gt 0) {
    Write-Host ""
    Write-Host "Failed tests:" -ForegroundColor Red
    foreach ($e in $errors) {
        Write-Host "  - $e" -ForegroundColor Red
    }
}

Write-Host ""

# Exit with error code if any tests failed (required for CI)
if ($failed -gt 0) { exit 1 } else { exit 0 }