# =====================================================================
# Repair.psm1 - Parallel repair using Invoke-UMWorkerPool
# =====================================================================

function UM-GetRepairQueue {
    $log = UM-ReadUnifiedLog
    if (-not $log) { return @() }

    $pending = $log |
        Where-Object { $_.Type -eq "ToRepair" -and $_.RepairStatus -eq "Pending" }

    $results = $log | Where-Object { $_.Type -eq "RepairResult" }

    $queue = foreach ($p in $pending) {
        $lastResult = $results |
            Where-Object { $_.Path -eq $p.Path } |
            Sort-Object Timestamp -Descending |
            Select-Object -First 1

        if (-not $lastResult) { $p }
    }

    return @($queue)
}

# =====================================================================
# HELPER: Scan file for errors (module-level so workers can access)
# =====================================================================

function Invoke-RepairScanFile {
    param([string]$FilePath)

    $probe = & ffprobe -v error -select_streams v -show_entries stream=codec_type -of csv=p=0 $FilePath
    if ($probe -ne "video") {
        return @("No video stream detected")
    }

    $raw   = & ffmpeg -v error -i $FilePath -hide_banner 2>&1 | Out-String
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

# =====================================================================
# HELPER: Quality check (module-level so workers can access)
# =====================================================================

function Invoke-RepairQualityCheck {
    param(
        [string]$Original,
        [string]$Repaired,
        [string]$StageName,
        [int]   $CRF
    )

    $targetSSIM = 0.96

    $ssimRaw   = & ffmpeg -hide_banner -i $Original -i $Repaired -lavfi "ssim" -f null - 2>&1
    $ssimMatch = $ssimRaw | Select-String -Pattern "All:(\d+\.\d+)"
    $ssim      = if ($ssimMatch) { [double]$ssimMatch.Matches[0].Groups[1].Value } else { 0 }

    $psnrRaw   = & ffmpeg -hide_banner -i $Original -i $Repaired -lavfi "psnr" -f null - 2>&1
    $psnrMatch = $psnrRaw | Select-String -Pattern "average:(\d+\.\d+)"
    $psnr      = if ($psnrMatch) { [double]$psnrMatch.Matches[0].Groups[1].Value } else { 0 }

    $percent = if ($targetSSIM -gt 0) { ($ssim / $targetSSIM) * 100 } else { 0 }
    if ($percent -gt 100) { $percent = 100 }

    $distance = 100 - $percent
    $status   = if ($ssim -ge $targetSSIM) { "Pass" } else { "Loss" }

    UM-LogQuality `
        -Original        $Original `
        -Comparison      $Repaired `
        -SSIM            $ssim `
        -PSNR            $psnr `
        -PercentAchieved ([math]::Round($percent,2)) `
        -Distance        ([math]::Round($distance,2)) `
        -QualityStatus   $status `
        -CheckedAt       (Get-Date).ToString("s")

    if ($status -eq "Pass") {
        return @{ Result = "Pass"; QualityStatus = $status }
    }

    $crfDrop = switch ($distance) {
        {$_ -le 1}  {1}
        {$_ -le 3}  {2}
        {$_ -le 7}  {3}
        {$_ -le 12} {4}
        default     {5}
    }

    $nextCRF = $CRF - $crfDrop
    if ($nextCRF -lt 1) { $nextCRF = 1 }

    return @{
        Result        = "RetrySameStage"
        NextCRF       = $nextCRF
        QualityStatus = $status
    }
}

# =====================================================================
# HELPER: Run a single repair stage (module-level so workers can access)
# =====================================================================

function Invoke-RepairStage {
    param(
        [string]   $StageName,
        [string]   $StageFriendly,
        [string]   $SourcePath,
        [string]   $OutputPath,
        [string]   $VideoMode,
        [string]   $AudioMode,
        [int]      $CRF,
        [string[]] $ExtraArgs
    )

    $argList = @("-y", "-i", $SourcePath)

    if ($VideoMode) {
        $argList += @("-c:v", $VideoMode)
        if ($CRF -gt 0) {
            $argList += UM-ResolveEncoderArgs -Encoder $VideoMode -CRF $CRF
        }
    } else {
        $argList += @("-c", "copy")
    }

    if ($AudioMode) {
        $argList += @("-c:a", $AudioMode)
    }

    if ($ExtraArgs) {
        $argList += $ExtraArgs
    }

    $argList += @($OutputPath, "-loglevel", "quiet")

    & ffmpeg @argList
    $exitCode = $LASTEXITCODE

    $originalSize = (Get-Item $SourcePath).Length
    $repairedSize = if (Test-Path $OutputPath) { (Get-Item $OutputPath).Length } else { 0 }

    $attempt = [PSCustomObject]@{
        Path           = $SourcePath
        Stage          = $StageName
        OutputPath     = $OutputPath
        CRF            = $CRF
        OriginalSizeMB = [math]::Round($originalSize / 1MB, 2)
        RepairedSizeMB = [math]::Round($repairedSize / 1MB, 2)
        SizeRatio      = if ($originalSize -gt 0) { [math]::Round($repairedSize / $originalSize, 2) } else { 0 }
        ErrorsAfter    = @()
        AttemptedAt    = (Get-Date).ToString("s")
    }

    if (-not (Test-Path $OutputPath)) {
        $attempt.ErrorsAfter = @("Output file not created")
    } else {
        $probe = & ffprobe -v error -select_streams v -show_entries stream=codec_type -of csv=p=0 $OutputPath
        if ($probe -ne "video") {
            $attempt.ErrorsAfter = @("No video stream in output file")
        } else {
            $attempt.ErrorsAfter = Invoke-RepairScanFile -FilePath $OutputPath
        }
    }

    UM-LogRepairAttempt `
        -Path           $attempt.Path `
        -StageFriendly  $StageFriendly `
        -OutputPath     $attempt.OutputPath `
        -CRF            $attempt.CRF `
        -OriginalSizeMB $attempt.OriginalSizeMB `
        -RepairedSizeMB $attempt.RepairedSizeMB `
        -SizeRatio      $attempt.SizeRatio `
        -ErrorsAfter    $attempt.ErrorsAfter

    if ($repairedSize -gt ($originalSize * 1.5)) { return $false }
    if ($exitCode -ne 0) { return $false }

    return ($attempt.ErrorsAfter.Count -eq 0)
}

# =====================================================================
# MAIN REPAIR FUNCTION (parallel via Invoke-UMWorkerPool)
# =====================================================================

function Invoke-UMRepair {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        $Context
    )

    $queue = @(UM-GetRepairQueue)
    if (-not $queue -or $queue.Count -eq 0) {
        return "No items in UnifiedLog.json to repair. Try scanning a new library."
    }

    # Session variables
    $totalItems    = $queue.Count
    $sessionStart  = Get-Date
    $Global:UM_RepairSessionStart = $sessionStart

    # Initialize worker status globals
    $workers = $Context.Workers
    if (-not $workers -or $workers -lt 1) { $workers = 4 }
    $Global:UM_WorkerFolders = @(1..$workers | ForEach-Object { "" })
    $Global:UM_RepairDoneCount = 0
    $Global:UM_RepairTotalItems = $totalItems

    $repairTempDir = Join-Path (Split-Path $Global:UnifiedMachineLogPath -Parent) "RepairTemp"

    # Build file list from queue (paths)
    $filesToRepair = $queue | ForEach-Object { $_.Path }

    # ---- WorkScript: runs the full per-file repair pipeline inside a worker ---- #
    $repairWorkScript = {
        param($filePath, $extra, $statusFile, $workerID)

        $contextObj    = $extra.Context
        $libraryType   = $extra.Library
        $logPath       = $extra.LogPath
        $useGPU        = [bool]$extra.UseGPU

        # Set the log path so logging functions work inside the worker
        $Global:UnifiedMachineLogPath = $logPath

        # Resolve the video encoder once for this worker (GPU or CPU)
        $videoEncoder = UM-ResolveEncoder -BaseCodec "libx264" -UseGPU $useGPU

        $friendlyNames = @{
            "Remux"                   = "Fast Repair"
            "ReencodeVideo_CopyAudio" = "Standard Repair"
            "ReencodeVideo_AAC"       = "Enhanced Repair"
            "FullReencode"            = "Deep Repair"
            "LastResortMp4"           = "Emergency Conversion"
        }

        $repairStages = @(
            @{ Name="Remux";                   Video=$null;          Audio=$null;  Extra=@();                   ForceExt=$null  },
            @{ Name="ReencodeVideo_CopyAudio"; Video=$videoEncoder;  Audio="copy"; Extra=@();                   ForceExt=$null  },
            @{ Name="ReencodeVideo_AAC";       Video=$videoEncoder;  Audio="aac";  Extra=@();                   ForceExt=$null  },
            @{ Name="FullReencode";            Video=$videoEncoder;  Audio="aac";  Extra=@("-preset","medium"); ForceExt=$null  },
            @{ Name="LastResortMp4";           Video=$videoEncoder;  Audio="aac";  Extra=@("-preset","medium"); ForceExt=".mp4" }
        )

        $sourcePath = $filePath

        # ---- Update status: starting file ---- #
        $fileStart  = Get-Date
        $folderName = Split-Path (Split-Path $sourcePath -Parent) -Leaf
        $fileName   = Split-Path $sourcePath -Leaf

        @{
            WorkerID     = $workerID
            Folder       = $folderName
            Episode      = $fileName
            Repair       = "Starting..."
            Attempt      = 0
            FileStart    = $fileStart.ToString("o")
            AttemptStart = $fileStart.ToString("o")
            IsRepair     = $true
        } | ConvertTo-Json -Compress | Set-Content -Path $statusFile -Encoding UTF8

        # ---- Missing file check ---- #
        if (-not (Test-Path $sourcePath)) {
            UM-LogRepairResult `
                -Path          $sourcePath `
                -Library       $libraryType `
                -RepairStatus  "Missing" `
                -QualityStatus "Unknown" `
                -RepairedAt    (Get-Date).ToString("s")

            return [PSCustomObject]@{
                Path          = $sourcePath
                RepairStatus  = "Missing"
                QualityStatus = "Unknown"
            }
        }

        # ---- Resolve output paths ---- #
        $paths = UM-GetRepairedOutputPath -Context $contextObj -SourcePath $sourcePath
        $targetFullDir     = $paths.Directory
        $baseName          = $paths.BaseName
        $targetPathSameExt = $paths.SameExtPath

        # ---- Resume context ---- #
        $log = UM-ReadUnifiedLog

        $attempts = $log | Where-Object {
            $_.Type -eq "RepairAttempt" -and $_.Path -eq $sourcePath
        }

        $qualities = $log | Where-Object {
            $_.Type -eq "Quality" -and $_.Original -eq $sourcePath
        }

        $attemptCount = ($attempts | Measure-Object).Count

        $lastAttempt = $attempts |
            Sort-Object Timestamp -Descending |
            Select-Object -First 1

        $lastQualityAfterAttempt = $null
        if ($lastAttempt) {
            $lastQualityAfterAttempt = $qualities |
                Where-Object { $_.Timestamp -gt $lastAttempt.Timestamp } |
                Sort-Object Timestamp |
                Select-Object -First 1
        }

        $resumeStageName = $null
        $resumeCRF       = $null
        $startStageIndex = 0
        $interrupted     = $false

        if ($lastAttempt) {
            $resumeStageName = ($friendlyNames.GetEnumerator() |
                Where-Object { $_.Value -eq $lastAttempt.StageFriendly } |
                Select-Object -First 1).Key

            if ($resumeStageName) {
                for ($i = 0; $i -lt $repairStages.Count; $i++) {
                    if ($repairStages[$i].Name -eq $resumeStageName) {
                        $startStageIndex = $i
                        break
                    }
                }
            }

            $hasQuality     = [bool]$lastQualityAfterAttempt
            $hasHardFailure = ($lastAttempt.ErrorsAfter.Count -gt 0) -or ($lastAttempt.SizeRatio -gt 1.5)

            if (-not $hasQuality -and -not $hasHardFailure) {
                $interrupted = $true
                $resumeCRF   = [int]$lastAttempt.CRF
            }
            else {
                if ($startStageIndex -lt ($repairStages.Count - 1)) {
                    $startStageIndex++
                }
            }
        }

        # ---- MAIN STAGE LOOP ---- #
        $success            = $false
        $successfulStage    = $null
        $finalQualityStatus = "Unknown"

        for ($stageIndex = $startStageIndex; $stageIndex -lt $repairStages.Count; $stageIndex++) {

            if ($success) { break }

            $stage = $repairStages[$stageIndex]

            $currentCRF = if ($interrupted -and $stage.Name -eq $resumeStageName) {
                $resumeCRF
            } else {
                18
            }

            $stageDone = $false

            while (-not $stageDone) {

                $attemptStart = Get-Date

                $outputPath = if ($stage.ForceExt) {
                    Join-Path $targetFullDir ($baseName + $stage.ForceExt)
                } else {
                    $targetPathSameExt
                }

                # ---- Update status: current attempt ---- #
                @{
                    WorkerID     = $workerID
                    Folder       = $folderName
                    Episode      = $fileName
                    Repair       = $friendlyNames[$stage.Name]
                    Attempt      = $attemptCount + 1
                    FileStart    = $fileStart.ToString("o")
                    AttemptStart = $attemptStart.ToString("o")
                    IsRepair     = $true
                } | ConvertTo-Json -Compress | Set-Content -Path $statusFile -Encoding UTF8

                # ---- Run the stage ---- #
                $stageSuccess = Invoke-RepairStage `
                    -StageName      $stage.Name `
                    -StageFriendly  $friendlyNames[$stage.Name] `
                    -SourcePath     $sourcePath `
                    -OutputPath     $outputPath `
                    -VideoMode      $stage.Video `
                    -AudioMode      $stage.Audio `
                    -CRF            $currentCRF `
                    -ExtraArgs      $stage.Extra

                $attemptCount++

                if (-not $stageSuccess) {
                    $stageDone = $true
                    break
                }

                # ---- Quality check ---- #
                $qualityResult = Invoke-RepairQualityCheck `
                    -Original  $sourcePath `
                    -Repaired  $outputPath `
                    -StageName $stage.Name `
                    -CRF       $currentCRF

                $finalQualityStatus = $qualityResult.QualityStatus

                if ($stage.Name -eq "LastResortMp4") {
                    $success         = $true
                    $stageDone       = $true
                    $successfulStage = $stage.Name
                }
                elseif ($qualityResult.Result -eq "Pass") {
                    $success         = $true
                    $stageDone       = $true
                    $successfulStage = $stage.Name
                }
                elseif ($qualityResult.Result -eq "RetrySameStage") {
                    $nextCRF = [int]$qualityResult.NextCRF
                    if ($nextCRF -ge $currentCRF -or $nextCRF -lt 1) {
                        $stageDone = $true
                    } else {
                        $currentCRF = $nextCRF
                    }
                }
                else {
                    $stageDone = $true
                }
            }
        }

        # ---- Final result logging ---- #
        if ($success) {
            if ($successfulStage -eq "LastResortMp4") {
                UM-CleanupPreviousRepairs `
                    -Directory     $targetFullDir `
                    -BaseName      $baseName `
                    -KeepExtension ".mp4"
            }

            UM-LogRepairResult `
                -Path          $sourcePath `
                -Library       $libraryType `
                -RepairStatus  "Repaired" `
                -QualityStatus $finalQualityStatus `
                -RepairedAt    (Get-Date).ToString("s")
        } else {
            UM-LogRepairResult `
                -Path          $sourcePath `
                -Library       $libraryType `
                -RepairStatus  "Failed" `
                -QualityStatus $finalQualityStatus `
                -RepairedAt    (Get-Date).ToString("s")
        }

        return [PSCustomObject]@{
            Path          = $sourcePath
            RepairStatus  = if ($success) { "Repaired" } else { "Failed" }
            QualityStatus = $finalQualityStatus
        }
    }

    # ---- OnResult: increment done counter and emit progress ---- #
    $onResult = {
        param($result)
        $Global:UM_RepairDoneCount++
    }

    # ---- OnProgress: emit RepairProgress with worker folders ---- #
    $onProgress = {
        UM-RepairWorkerConsole
    }

    # ---- Run the worker pool ---- #
    Invoke-UMWorkerPool `
        -Files      $filesToRepair `
        -Workers    $workers `
        -TempDir    $repairTempDir `
        -ModuleRoot $moduleRoot `
        -Modules    @("Common.psm1", "Logging.psm1", "Repair.psm1") `
        -WorkScript $repairWorkScript `
        -Extra      @{
            Context = $Context
            Library = $Context.LibraryType
            LogPath = $Global:UnifiedMachineLogPath
            UseGPU  = [bool]$Context.UseGPU
        } `
        -OnResult   $onResult `
        -OnProgress $onProgress

    # ---- Final progress emit ---- #
    $Global:UM_RepairDoneCount = $totalItems
    UM-RepairWorkerConsole
    Start-Sleep -Milliseconds 500

    return "Phase 3 complete. All repair attempts have been logged."
}

Export-ModuleMember -Function Invoke-UMRepair, UM-GetRepairQueue, Invoke-RepairScanFile, Invoke-RepairQualityCheck, Invoke-RepairStage