$Global:UM_ScanStart = Get-Date

function UM-IsScanned {
    param(
        [string]$Path,
        [array]$ScanLog
    )
    return $ScanLog | Where-Object { $_.Path -eq $Path }
}

function Invoke-UMScanFile {
    param([string]$FilePath)

    $probe = & ffprobe -v error -select_streams v -show_entries stream=codec_type -of csv=p=0 $FilePath
    if ($probe -ne "video") {
        return @("No video stream detected")
    }

    $raw = & ffmpeg -v error -i $FilePath -hide_banner 2>&1 | Out-String
    $lines = $raw -split "`n"

    $patterns = @(
        "sps_id .* out of range",
        "Invalid NAL unit size .*",
        "missing picture in access unit .*"
    )

    $errors = @()
    foreach ($line in $lines) {
        if ($line -match "missing picture in access unit with size (\d+)" -and [int]$matches[1] -lt 100) {
            continue
        }
        foreach ($p in $patterns) {
            if ($line -match $p) {
                $errors += $line.Trim()
            }
        }
    }

    return $errors
}

function Get-UMFilesToScan {
    param(
        [string]$RootPath,
        [string]$LibraryType,
        [ref]$ScanAllEpisodesRef
    )

    $videoExtensions = UM-VideoExtensions

    if ($LibraryType -eq "Movies") {
        $ScanAllEpisodesRef.Value = $true
        return Get-ChildItem -Path $RootPath -Recurse -File -Include $videoExtensions
    }

    if ($Global:Context -and
        $Global:Context.PSObject.Properties.Name -contains 'ScanAllEpisodes') {
        $ScanAllEpisodesRef.Value = [bool]$Global:Context.ScanAllEpisodes
    }
    else {
        $ScanAllEpisodesRef.Value = $false
    }

    if ($ScanAllEpisodesRef.Value) {
        return Get-ChildItem -Path $RootPath -Recurse -File -Include $videoExtensions
    }

    $allFiles = @()
    $showDirs = Get-ChildItem -Path $RootPath -Directory

    if ($showDirs.Count -eq 0) {
        $showDirs = @(Get-Item $RootPath)
    }

    foreach ($showDir in $showDirs) {

        $episodeFiles = Get-ChildItem -Path $showDir.FullName -Recurse -File -Include $videoExtensions
        $seasonGroups = @{ }

        foreach ($file in $episodeFiles) {
            if ($file.Name -match "S(\d{2,4})E(\d{2})") {
                $seasonNumber = [int]$matches[1]
                if (-not $seasonGroups.ContainsKey($seasonNumber)) {
                    $seasonGroups[$seasonNumber] = @()
                }
                $seasonGroups[$seasonNumber] += $file
            }
        }

        foreach ($seasonNumber in ($seasonGroups.Keys | Sort-Object)) {
            $seasonFiles = $seasonGroups[$seasonNumber] | Sort-Object Name
            if ($seasonFiles.Count -gt 0) {
                $allFiles += $seasonFiles[0]
            }
        }
    }

    return $allFiles
}

# =====================================================================
# MAIN SCAN FUNCTION
# =====================================================================
function Invoke-UMScan {

    $Context = $Global:Context

    if (-not $Context.RootPath) {
        UM-Output "Scan requires a valid root path. Exiting."
        return
    }

    UM-ResetTimers
    UM-StartTimer

    $Global:UM_CurrentScanFile    = ""
    $Global:UM_CurrentScanElapsed = [timespan]::Zero
    $Global:UM_CurrentFileElapsed = [timespan]::Zero
    $Global:UM_ScannedFiles       = 0
    $Global:UM_TotalFiles         = 0

    # Initialize worker status globals
    $Global:UM_WorkerFolders = @("", "", "", "")

    UM-PhaseOneConsole -Context $Context

    # Build skip-list from raw log lines (avoids parsing every entry as JSON)
    $scanLog = @()
    if (Test-Path $Global:UnifiedMachineLogPath) {
        $rootEscaped = $Context.RootPath.Replace("\", "\\")
        $lines = [System.IO.File]::ReadAllLines($Global:UnifiedMachineLogPath)
        foreach ($line in $lines) {
            if ($line.Contains('"Type":"Scan"') -and $line.Contains($rootEscaped)) {
                try { $scanLog += $line.Trim() | ConvertFrom-Json } catch {}
            }
        }
    }

    $Global:UM_AlreadyScanned = ($scanLog.Count -gt 0)

    # Build a HashSet for O(1) path lookups instead of O(n) array scans
    $scannedPaths = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $scanLog) {
        $null = $scannedPaths.Add($entry.Path)
    }

    $scanAllRef = [ref]$false
    $allFiles   = Get-UMFilesToScan `
                    -RootPath           $Context.RootPath `
                    -LibraryType        $Context.LibraryType `
                    -ScanAllEpisodesRef $scanAllRef

    $Context | Add-Member -NotePropertyName ScanAllEpisodes -NotePropertyValue $scanAllRef.Value -Force

    # Filter out already-scanned files
    $filesToScan = $allFiles | Where-Object {
        -not $scannedPaths.Contains($_.FullName)
    }

    $totalFiles     = $allFiles.Count
    $Global:UM_TotalFiles = $totalFiles

    $scannedFiles   = $scannedPaths.Count


    # -------------------------[ Worker pool scan ]------------------------ #

    $Global:UM_ScanLog        = $scanLog
    $Global:UM_ScanCount      = $scannedFiles
    $Global:UM_ScanTotal2     = $totalFiles
    $Global:UM_EscalatedShows = @{}
	$Global:UM_RootIsSingleShow = UM-RootIsSingleShow -RootPath $Context.RootPath
    $Global:UM_ScanTempDir    = Join-Path (Split-Path $Global:UnifiedMachineLogPath -Parent) "ScanTemp"

    $scanWorkScript = {
        param($filePath, $extra, $statusFile, $workerID)
        $errors = Invoke-UMScanFile -FilePath $filePath
        return [PSCustomObject]@{
            Path        = $filePath
            Library     = $extra.Library
            Errors      = $errors
            ScannedAt   = (Get-Date).ToString("s")
            NeedsRepair = ($errors.Count -gt 0)
        }
    }

    $onResult = {
        param($result)

        $Global:UM_ScanLog   += $result
        $Global:UM_ScanCount++

        UM-LogScan `
            -Path    $result.Path `
            -Library $result.Library `
            -Errors  $result.Errors

        if ($result.NeedsRepair) {
            UM-LogToRepair `
                -Path         $result.Path `
                -Library      $result.Library `
                -Errors       $result.Errors `
                -RepairStatus "Pending" `
                -AddedAt      (Get-Date).ToString("s")

            if ($Global:Context.LibraryType -eq "Shows" -and -not $Global:Context.ScanAllEpisodes) {
                $showRoot = UM-GetShowRoot -FilePath $result.Path -RootPath $Global:Context.RootPath -RootIsSingleShow $Global:UM_RootIsSingleShow
                $Global:UM_EscalatedShows[$showRoot] = $true
            }
        }

        $Global:UM_ScannedCount = $Global:UM_ScanCount
        $Global:UM_ScanTotal    = $Global:UM_ScanTotal2
        $Global:UM_Mode         = $Global:Context.Mode
    }

    $onProgress = {
        UM-PhaseTwoConsole
    }

    Invoke-UMWorkerPool `
        -Files      $filesToScan `
        -Workers    $Context.Workers `
        -TempDir    $Global:UM_ScanTempDir `
        -ModuleRoot $moduleRoot `
        -Modules    @("Common.psm1", "Logging.psm1", "Scan.psm1") `
        -WorkScript $scanWorkScript `
        -Extra      @{ Library = $Context.LibraryType } `
        -OnResult   $onResult `
        -OnProgress $onProgress

    # -------------------[ Escalation pass: full scan of flagged shows ]------- #
    # Any show whose sampled (first) episode reported an error gets every
    # remaining episode scanned here, after the first pass has fully drained.
    # This avoids the race where a worker exits before the live queue is topped
    # up, and it covers the whole show regardless of season-folder nesting.
    if ($Global:UM_EscalatedShows.Count -gt 0) {

        $videoExtensions = UM-VideoExtensions

        $scannedNow = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($e in $Global:UM_ScanLog) { $null = $scannedNow.Add($e.Path) }

        $escalationFiles = foreach ($showRoot in $Global:UM_EscalatedShows.Keys) {
            Get-ChildItem -Path $showRoot -Recurse -File -Include $videoExtensions |
                Where-Object { -not $scannedNow.Contains($_.FullName) }
        }
        $escalationFiles = @($escalationFiles | Sort-Object FullName)

        if ($escalationFiles.Count -gt 0) {

            $Global:UM_ScanTotal2 += $escalationFiles.Count
            $Global:UM_TotalFiles  = $Global:UM_ScanTotal2

            # Same logging/repair-queue handling as pass 1, but NO further
            # escalation -- we are already scanning the whole show.
            $onResultEscalation = {
                param($result)

                $Global:UM_ScanLog += $result
                $Global:UM_ScanCount++

                UM-LogScan -Path $result.Path -Library $result.Library -Errors $result.Errors

                if ($result.NeedsRepair) {
                    UM-LogToRepair `
                        -Path         $result.Path `
                        -Library      $result.Library `
                        -Errors       $result.Errors `
                        -RepairStatus "Pending" `
                        -AddedAt      (Get-Date).ToString("s")
                }

                $Global:UM_ScannedCount = $Global:UM_ScanCount
                $Global:UM_ScanTotal    = $Global:UM_ScanTotal2
                $Global:UM_Mode         = $Global:Context.Mode
            }

            Invoke-UMWorkerPool `
                -Files      $escalationFiles `
                -Workers    $Context.Workers `
                -TempDir    $Global:UM_ScanTempDir `
                -ModuleRoot $moduleRoot `
                -Modules    @("Common.psm1", "Logging.psm1", "Scan.psm1") `
                -WorkScript $scanWorkScript `
                -Extra      @{ Library = $Context.LibraryType } `
                -OnResult   $onResultEscalation `
                -OnProgress $onProgress
        }
    }

    # ---- Final progress emit ---- #
    $Global:UM_ScannedCount  = $Global:UM_ScanTotal2
    $Global:UM_ScanTotal     = $Global:UM_ScanTotal2
    $Global:UM_Mode          = $Context.Mode

    UM-PhaseTwoConsole
    Start-Sleep -Milliseconds 500

    return $null
}