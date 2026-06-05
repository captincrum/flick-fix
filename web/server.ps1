# -------------------------[ Server Initialization ]------------------------- #
# Launches the FlickFix UI in an Edge app window when this script is run
# directly, so the operator gets a window instead of a bare console.

#Add-Type -Name Win32 -Namespace Console -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);' ; [Console.Win32]::ShowWindow((Get-Process -Id $PID).MainWindowHandle, 0)

# Only open a window when run directly; skip when this file is dot-sourced.
if ($MyInvocation.InvocationName -ne '.') {
    Start-Sleep -Milliseconds 250

    # Look for an Edge window already showing FlickFix.
    $edgeRunning = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object {
        $_.MainWindowTitle -eq "FlickFix"
    }

    # Launch a fresh Edge app window pointed at the local server.
    if (-not $edgeRunning) {
        Start-Process "msedge.exe" "--app=http://localhost:17863/"
    }
}

# -------------------------[ Path + Module Setup ]--------------------------- #
# Resolves the app/project paths and loads the shared modules.

$port        = 17863
$root        = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path $root -Parent
$modulesPath = Join-Path $projectRoot "Modules"

# GUI-Core defines Start-UMPipeline-Core and $Global:UM_CurrentJob; UM-Errors
# defines the error/heartbeat helpers used below.
. (Join-Path $projectRoot "GUI-Core.ps1") $projectRoot
. (Join-Path $modulesPath "UM-Errors.ps1")

# -------------------------[ HTTP Listener Setup ]--------------------------- #
# Starts the local HTTP listener that the web UI talks to.

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
$gpuDetectCache = $null

# -------------------------[ Response Helpers ]------------------------------ #
# Small helpers for writing responses back to the browser.

# Serialize an object to JSON and write it to the response.
function Send-Json {
    param($response, $obj)

    $json  = ($obj | ConvertTo-Json -Depth 6)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

    $response.ContentType = "application/json"
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
}

# Write an already-formed JSON string straight to the response.
function Send-RawJson {
    param($response, [string]$json)

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response.ContentType = "application/json"
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
}

# Serve a file from disk, or return 404 if it is missing.
function Send-File {
    param($response, $path, $contentType)

    if (-not (Test-Path $path)) {
        $response.StatusCode = 404

        # "404 Not Found" is 13 bytes.
        $response.OutputStream.Write(
            [System.Text.Encoding]::UTF8.GetBytes("404 Not Found"), 0, 13
        )
        return
    }

    $bytes = [System.IO.File]::ReadAllBytes($path)
    $response.ContentType = $contentType
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
}

# -------------------------[ Log Cache ]------------------------------------- #
# Keeps an in-memory copy of the machine log so each request reads only the
# newly appended bytes instead of the whole file.

# Append any new log lines to the cache, rebuilding from scratch only if the
# file shrank (i.e. the log was cleared).
function Update-LogCache {
    # Debounce: re-read the file at most once per second.
    $now = [datetime]::UtcNow
    if (($now - $Global:UM_LogCacheLastRead).TotalMilliseconds -lt 1000) {
        return
    }
    $Global:UM_LogCacheLastRead = $now

    $path = $Global:UnifiedMachineLogPath
    if (-not $path -or -not (Test-Path $path)) {
        return
    }

    try {
        $fileSize = (Get-Item $path).Length
    } catch {
        # File is locked by another process — skip this cycle.
        return
    }

    if ($fileSize -eq $Global:UM_LogCacheSize) {
        return
    }

    # File got smaller (log was cleared) — drop the cache and start over.
    if ($fileSize -lt $Global:UM_LogCacheSize) {
        $Global:UM_LogCache.Clear()
        $Global:UM_LogCacheSize = 0
    }

    # Read only the bytes appended since the last cache update.
    $stream = $null
    try {
        $stream = [System.IO.FileStream]::new($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $stream.Seek($Global:UM_LogCacheSize, [System.IO.SeekOrigin]::Begin) | Out-Null
        $newBytes = New-Object byte[] ($fileSize - $Global:UM_LogCacheSize)
        $stream.Read($newBytes, 0, $newBytes.Length) | Out-Null
    }
    catch {
        # File is locked — try again next cycle.
        return
    }
    finally {
        if ($stream) { $stream.Close() }
    }

    # Split the new chunk into lines and add the non-empty ones.
    $newText  = [System.Text.Encoding]::UTF8.GetString($newBytes)
    $newLines = $newText -split "`n"

    foreach ($line in $newLines) {
        $trim = $line.Trim()
        if ($trim -ne "" -and $trim -ne "[]") {
            $Global:UM_LogCache.Add($trim)
        }
    }

    $Global:UM_LogCacheSize = $fileSize
}

# -------------------------[ Global State ]---------------------------------- #
# Shared runtime state used across requests and the main loop.

# Pipeline status and the running job.
$Global:UM_Status       = "idle"
$Global:UM_LatestStatus = $null
$Global:UM_Job          = $null

# Log cache — avoids re-reading the entire file on every request.
$Global:UM_LogCache         = [System.Collections.Generic.List[string]]::new()
$Global:UM_LogCacheSize     = 0
$Global:UM_LogCacheLastRead = [datetime]::MinValue

# Validation messages — defined once, reused at every call site.
$Global:UM_MsgPathNotFound = "Directory not found. Check the path and try again.`nInvalid directory path: "
$Global:UM_MsgNoSpace      = "Not enough available space at the given location."

# Format a megabyte value as MB, GB, or TB.
function Format-MB {
    param([double]$mb)
    if (-not $mb)        { return "0 MB" }
    if ($mb -ge 1048576) { return ("{0:0.00} TB" -f ($mb / 1048576)) }
    if ($mb -ge 1024)    { return ("{0:0.00} GB" -f ($mb / 1024)) }
    return ("{0:0.0} MB" -f $mb)
}

# -------------------------[ Start Pipeline ]-------------------------------- #
# Kicks off the processing pipeline as a background job.

# Start a run, capturing the job handle. Records an error status if the job
# fails to initialize; ignores the request if one is already running.
function Start-Pipeline {
    param($settings)

    # Don't start a second run while one is already going.
    if ($Global:UM_Job -and $Global:UM_Job.State -eq "Running") { return }

    $Global:UM_Status       = "running"
    $Global:UM_LatestStatus = $null
    $Global:UM_Mode         = $settings.Mode

    try {
        Start-UMPipeline-Core -Settings $settings
        $Global:UM_Job = $Global:UM_CurrentJob

        if (-not $Global:UM_Job) {
            throw "Pipeline job did not initialize correctly."
        }
    }
    catch {
        $Global:UM_Status = "error"
        $Global:UM_LatestStatus = [pscustomobject]@{
            Type    = "Console"
            Message = "ERROR starting pipeline: $($_.Exception.Message)"
        }
    }
}

# -------------------------[ Stop Pipeline ]--------------------------------- #
# Cancels any running job and resets state back to idle.

# Kill ffmpeg, stop and clean up both job handles, then mark the run idle.
function Stop-Pipeline {
    # Kill any ffmpeg processes the pipeline spawned.
    Get-Process -Name "ffmpeg" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    # Stop and remove the tracked job.
    if ($Global:UM_Job) {
        try {
            if ($Global:UM_Job.State -eq "Running") {
                Stop-Job $Global:UM_Job -ErrorAction SilentlyContinue
            }
            Receive-Job $Global:UM_Job -ErrorAction SilentlyContinue | Out-Null
            Remove-Job  $Global:UM_Job -ErrorAction SilentlyContinue
        } catch { }
        $Global:UM_Job = $null
    }

    # Stop and remove the core job handle too.
    if ($Global:UM_CurrentJob) {
        try {
            if ($Global:UM_CurrentJob.State -eq "Running") {
                Stop-Job $Global:UM_CurrentJob -ErrorAction SilentlyContinue
            }
            Receive-Job $Global:UM_CurrentJob -ErrorAction SilentlyContinue | Out-Null
            Remove-Job  $Global:UM_CurrentJob -ErrorAction SilentlyContinue
        } catch { }
        $Global:UM_CurrentJob = $null
    }

    $Global:UM_Status       = "idle"
    $Global:UM_LatestStatus = $null
}

# -------------------------[ Main Loop ]------------------------------------- #
# Drains job output and refreshes status, then serves one HTTP request per
# pass. Runs until the process is killed.

while ($true) {
    # If a job is running, drain whatever output it has emitted.
    if ($Global:UM_Job) {
        $output = $null
        try {
            $output = Receive-Job $Global:UM_Job -ErrorAction SilentlyContinue
        } catch { }

        # Apply each status object the job produced.
        if ($output) {
            foreach ($o in $output) {
                if ($o -is [pscustomobject]) {
                    if ($o.SessionStart) { $Global:UM_RepairSessionStart = $o.SessionStart }
                    if ($o.FileStart)    { $Global:UM_RepairFileStart    = $o.FileStart }
                    if ($o.AttemptStart) { $Global:UM_RepairAttemptStart = $o.AttemptStart }

                    if ($o.Type -eq "CompressProgress") { $Global:UM_HeartbeatPhase = "Phase3" }
                    $Global:UM_LatestStatus = $o

                    if ($o.Type -eq "CompressProgress") {
                        $Global:UM_HeartbeatPhase = "Phase3"
                    }
                    $Global:UM_LatestStatus = $o
                }
                elseif ($o -is [string]) {
                    continue
                }
            }
        }

        # Mark the run complete once the job stops.
        if ($Global:UM_Job.State -ne "Running" -and $Global:UM_Status -eq "running") {
            $Global:UM_Status = "completed"
        }
    }

    # Render the live progress heartbeat during phases 2 and 3.
    if ($Global:UM_HeartbeatPhase -in @("Phase2","Phase3")) {
        UM-RenderHeartbeat
    }

    # -------------------------[ HTTP Request Handling ]------------------------- #
    # Reads the incoming request and routes it by URL path.

    $context  = $listener.GetContext()
    $request  = $context.Request
    $response = $context.Response
    $path     = $request.Url.AbsolutePath.ToLower()

    switch ($path) {
        # Serve the static UI files.
        "/"            { Send-File $response "$root\index.html" "text/html" }
        "/index.html"  { Send-File $response "$root\index.html" "text/html" }
        "/style.css"   { Send-File $response "$root\style.css" "text/css" }
        "/app.js"      { Send-File $response "$root\app.js" "application/javascript" }
        "/favicon.ico" { Send-File $response "$root\favicon.ico" "image/x-icon" }

        # -------------------------[ API: Buttons ]---------------------------------- #
        # Endpoints driven by the main UI buttons.

        # Validate the inputs, then launch a scan/repair run.
        "/start" {
            $settings = @{
                RootPath        = $request.QueryString["root"]
                RepairedPath    = $request.QueryString["repaired"]
                Mode            = $request.QueryString["mode"]
                ScanAllEpisodes = ($request.QueryString["scanAll"] -eq "true")
                Workers         = if ($request.QueryString["workers"]) { [int]$request.QueryString["workers"] } else { $config.Workers }
                UseGPU          = ($request.QueryString["useGPU"] -eq "true")
            }

            # -------------------------[ VALIDATION: Library Root ]---------------------- #
            # The library root must exist.

            if (-not $settings.RootPath -or -not (Test-Path $settings.RootPath)) {
                Send-Json $response @{ ok = $false; error = "$Global:UM_MsgPathNotFound$($settings.RootPath)" }
                continue
            }

            # -------------------------[ VALIDATION: Repaired Output ]------------------- #
            # The repaired-output folder must exist (skipped for scan-only and
            # smart-compression modes, which don't write there).

            $skipRepairedCheck = $settings.Mode -in @("ScanOnly", "SmartCompression")
            if (-not $skipRepairedCheck -and -not (Test-Path $settings.RepairedPath)) {
                Send-Json $response @{ ok = $false; error = "$Global:UM_MsgPathNotFound$($settings.RepairedPath)" }
                continue
            }

            # -------------------------[ VALIDATION: Repaired Output Space ]------------- #
            # Worst case a kept repaired file is MaxSizeRatio x its source, so
            # 1.5x the total source media size is a safe free-space estimate.

            if (-not $skipRepairedCheck) {
                try {
                    $sourceBytes = (Get-ChildItem -Path $settings.RootPath -Recurse -File -Include (UM-VideoExtensions) -ErrorAction SilentlyContinue |
                                    Measure-Object -Property Length -Sum).Sum
                    if (-not $sourceBytes) { $sourceBytes = 0 }
                    $neededMB = [math]::Round(($sourceBytes * (UM-MaxSizeRatio)) / 1MB, 2)

                    $drive  = Split-Path -Qualifier $settings.RepairedPath
                    $disk   = Get-PSDrive -Name $drive.TrimEnd(':') -ErrorAction Stop
                    $freeMB = [math]::Round($disk.Free / 1MB, 2)

                    if ($freeMB -lt $neededMB) {
                        $addMB = [math]::Round($neededMB - $freeMB, 2)
                        $msg   = "$Global:UM_MsgNoSpace`nNeeded: $(Format-MB $neededMB)`nAvailable: $(Format-MB $freeMB)`nAdditional: $(Format-MB $addMB)"
                        Send-Json $response @{ ok = $false; error = $msg }
                        continue
                    }
                }
                catch {
                    # Couldn't read free space (e.g. a UNC path) — fail open
                    # rather than block the run on a check we can't perform.
                }
            }

            # -------------------------[ START PIPELINE ]-------------------------------- #

            Start-Pipeline $settings
            $Global:UM_Job = $Global:UM_CurrentJob
            Send-Json $response @{ ok = $true }
        }

        # Stop the current run.
        "/cancel" {
            Stop-Pipeline
            Send-Json $response @{ ok = $true }
        }

        # Report the high-level run state.
        "/status" {
            Send-Json $response @{ status = $Global:UM_Status }
        }

        # Return the latest console status line.
        "/status-console" {
            $payload = $Global:UM_LatestStatus

            if ($payload) {
                $payload | Add-Member -NotePropertyName Mode -NotePropertyValue (UM-PrettyMode $Global:UM_Mode) -Force
            }

            Send-Json $response @{ status = $payload }
        }

        # Return latest status, run state, and log line count in one call.
        "/status-all" {
            Update-LogCache
            $payload = $Global:UM_LatestStatus
            if ($payload) {
                $payload | Add-Member -NotePropertyName Mode -NotePropertyValue (UM-PrettyMode $Global:UM_Mode) -Force
            }
            Send-Json $response @{
                status   = $payload
                runState = $Global:UM_Status
                logTotal = $Global:UM_LogCache.Count
            }
        }

        # Show a native folder picker and return the chosen path.
        "/browse-folder" {
            Add-Type -AssemblyName System.Windows.Forms

            # Hidden top-most owner form so the dialog appears in front.
            $owner = New-Object System.Windows.Forms.Form
            $owner.TopMost       = $true
            $owner.ShowInTaskbar = $false
            $owner.StartPosition = "CenterScreen"
            $owner.Size          = New-Object System.Drawing.Size(1,1)
            $owner.Location      = New-Object System.Drawing.Point(-2000,-2000)
            $owner.Add_Shown({ $owner.Hide() })
            $owner.Show()

            $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
            $dialog.Description         = "Select a folder"
            $dialog.ShowNewFolderButton = $true

            $result = $dialog.ShowDialog($owner)

            if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
                Send-Json $response @{ ok = $true; path = $dialog.SelectedPath }
            }
            else {
                Send-Json $response @{ ok = $false; path = "" }
            }

            $owner.Dispose()
        }

        # Return the human-readable log entries.
        "/logs/human" {
            try {
                $entries = UM-ReadUnifiedLog
                Send-Json $response @{ ok = $true; entries = $entries }
            }
            catch {
                Send-Json $response @{ ok = $false; error = $_.Exception.Message }
            }
        }

        # Return the machine log entries.
        "/logs/machine" {
            try {
                $entries = UM-ReadUnifiedLog
                Send-Json $response @{ ok = $true; entries = $entries }
            }
            catch {
                Send-Json $response @{ ok = $false; error = $_.Exception.Message }
            }
        }

        # Return the current log line count.
        "/logs/total" {
            try {
                Update-LogCache
                Send-Json $response @{ ok = $true; total = $Global:UM_LogCache.Count }
            }
            catch {
                Send-Json $response @{ ok = $false; total = 0 }
            }
        }

        # Return a window of log lines by index range.
        "/logs/slice" {
            try {
                $start = [int]$request.QueryString["start"]
                $end   = [int]$request.QueryString["end"]

                Update-LogCache
                $total = $Global:UM_LogCache.Count

                if ($total -eq 0) {
                    Send-RawJson $response '{"ok":true,"entries":[],"total":0}'
                    continue
                }

                # Clamp the requested range to the available lines.
                if ($start -lt 0) { $start = 0 }
                if ($start -ge $total) { $start = [Math]::Max(0, $total - 1) }
                $end = [Math]::Min($end, $total)
                $count = $end - $start
                if ($count -lt 0) { $count = 0 }

                # Cache lines are already valid single-line JSON — just join
                # them into an array, no ConvertFrom-Json / ConvertTo-Json.
                $rawLines = $Global:UM_LogCache.GetRange($start, $count)
                $entriesJson = "[" + ($rawLines -join ",") + "]"

                Send-RawJson $response ('{"ok":true,"entries":' + $entriesJson + ',"total":' + $total + '}')
            }
            catch {
                Send-Json $response @{ ok = $false; error = $_.Exception.Message }
            }
        }

        # Return log lines matching a query. Caps the returned rows at max but still reports the true number of matches.
        "/logs/search" {
            try {
                $query = $request.QueryString["q"]
                $max   = if ($request.QueryString["max"]) { [int]$request.QueryString["max"] } else { 500 }

                if (-not $query) {
                    Send-RawJson $response '{"ok":true,"entries":[],"total":0,"matched":0}'
                    continue
                }

                Update-LogCache
                $total = $Global:UM_LogCache.Count
                $lowerQuery = $query.ToLower()

                # Count every match, but only keep up to $max lines for rendering.
                $matchCount = 0
                $matched = [System.Collections.Generic.List[string]]::new()
                foreach ($line in $Global:UM_LogCache) {
                    $lower = $line.ToLower().Replace("\\", "\")
                    if ($lower.Contains($lowerQuery) -or $line.ToLower().Contains($lowerQuery)) {
                        $matchCount++
                        if ($matched.Count -lt $max) { $matched.Add($line) }
                    }
                }

                # $matched holds at most $max rows; $matchCount is the true total.
                $entriesJson = "[" + ($matched -join ",") + "]"
                Send-RawJson $response ('{"ok":true,"entries":' + $entriesJson + ',"total":' + $total + ',"matched":' + $matchCount + '}')
            }
            catch {
                Send-Json $response @{ ok = $false; error = $_.Exception.Message }
            }
        }

        # Clear the log file and saved compression selections.
        "/logs/clear" {
            try {
                if (Test-Path $Global:UnifiedMachineLogPath) {
                    "" | Set-Content -Path $Global:UnifiedMachineLogPath -Encoding UTF8
                }
                $selectionsPath = Join-Path $logsRoot "CompressionSelections.json"
                if (Test-Path $selectionsPath) {
                    Remove-Item -Path $selectionsPath -Force
                }
                $Global:UM_LogCache.Clear()
                $Global:UM_LogCacheSize = 0
                Send-Json $response @{ ok = $true }
            }
            catch {
                Send-Json $response @{ ok = $false; error = $_.Exception.Message }
            }
        }

        # Return the saved configuration (with sensible fallbacks).
        "/config" {
            Send-Json $response @{
                ok = $true
                config = @{
                    RootPath              = $config.RootPath
                    RepairedPath          = $config.RepairedPath
                    Mode                  = $config.Mode
                    ScanAllEpisodes       = $config.ScanAllEpisodes
                    AccurateMode          = $config.AccurateMode
                    CompressionOutputPath = $config.CompressionOutputPath
                    CrfValue              = if ($config.CrfValue) { $config.CrfValue } else { 22 }
                    Workers               = if ($config.Workers -gt 0) { $config.Workers } else { 4 }
                    UseGPU                = if ($null -ne $config.UseGPU) { [bool]$config.UseGPU } else { $false }
                }
            }
        }

        # Save configuration from the query-string values.
        "/config/save" {
            $config.RootPath        = $request.QueryString["root"]
            $config.RepairedPath    = $request.QueryString["repaired"]
            $config.Mode            = $request.QueryString["mode"]
            $config.ScanAllEpisodes = ($request.QueryString["scanAll"] -eq "true")
            $config.AccurateMode    = ($request.QueryString["accurateMode"] -eq "true")
            $config.CrfValue        = if ($request.QueryString["crfValue"]) { [int]$request.QueryString["crfValue"] } else { 22 }
            $config.Workers         = if ($request.QueryString["workers"]) { [int]$request.QueryString["workers"] } else { 2 }
            $config.UseGPU          = ($request.QueryString["useGPU"] -eq "true")
            Save-Config $config
            Send-Json $response @{ ok = $true }
        }

        # Detect a usable hardware HEVC encoder (cached after the first probe).
        "/gpu-detect" {
            if ($null -eq $gpuDetectCache) {
                try {
                    $encodersRaw = & ffmpeg -hide_banner -encoders 2>&1 | Out-String
                    if ($encodersRaw -match "hevc_nvenc") {
                        $gpuDetectCache = @{ ok = $true; available = $true; encoder = "nvenc"; name = "NVIDIA NVENC" }
                    }
                    elseif ($encodersRaw -match "hevc_amf") {
                        $gpuDetectCache = @{ ok = $true; available = $true; encoder = "amf"; name = "AMD AMF" }
                    }
                    elseif ($encodersRaw -match "hevc_qsv") {
                        $gpuDetectCache = @{ ok = $true; available = $true; encoder = "qsv"; name = "Intel QSV" }
                    }
                    else {
                        $gpuDetectCache = @{ ok = $true; available = $false; encoder = ""; name = "None" }
                    }
                }
                catch {
                    $gpuDetectCache = @{ ok = $true; available = $false; encoder = ""; name = "None" }
                }
            }
            Send-Json $response $gpuDetectCache
        }

        # Report free space on the drive for a given path.
        "/disk-space" {
            try {
                $drivePath = $request.QueryString["path"]
                $drive = Split-Path -Qualifier $drivePath
                $disk  = Get-PSDrive -Name $drive.TrimEnd(':') -ErrorAction Stop
                $freeMB = [math]::Round($disk.Free / 1MB, 2)
                Send-Json $response @{ ok = $true; freeMB = $freeMB }
            } catch {
                Send-Json $response @{ ok = $false; freeMB = 0 }
            }
        }

        # Validate the payload, persist the queue/selections, and launch a compression run.
        "/compress/start" {
            try {
                $body = New-Object System.IO.StreamReader($request.InputStream)
                $json = $body.ReadToEnd()

                if (-not $json -or $json.Trim() -eq "") {
                    Send-Json $response @{ ok = $false; error = "Empty request body" }
                    continue
                }

                $payload = $json | ConvertFrom-Json

                if (-not $payload.paths -or $payload.paths.Count -eq 0) {
                    Send-Json $response @{ ok = $false; error = "No paths in payload" }
                    continue
                }

                if (-not (Test-Path $payload.outputPath)) {
                    Send-Json $response @{ ok = $false; error = "$Global:UM_MsgPathNotFound$($payload.outputPath)" }
                    continue
                }

                $config.CompressionOutputPath = $payload.outputPath
                Save-Config $config

                # Persist the incoming queue so the pipeline can pick it up.
                $queuePath = Join-Path $logsRoot "CompressionQueue.json"
                $json | Set-Content -Path $queuePath -Encoding UTF8

                $config.CompressionOutputPath = $payload.outputPath
                $config.CrfValue              = if ($payload.crf) { [int]$payload.crf } else { 22 }
                Save-Config $config

                $settings = @{
                    RootPath        = $config.RootPath
                    RepairedPath    = $payload.outputPath
                    Mode            = "Compress"
                    ScanAllEpisodes = $config.ScanAllEpisodes
                    AccurateMode    = $config.AccurateMode
                    CrfValue        = $config.CrfValue
                    Workers         = if ($payload.workers -gt 0) { [int]$payload.workers } else { if ($config.Workers -gt 0) { $config.Workers } else { 2 } }
                    UseGPU          = if ($null -ne $payload.useGPU) { [bool]$payload.useGPU } else { [bool]$config.UseGPU }
                }

                Start-Pipeline $settings
                $Global:UM_Job = $Global:UM_CurrentJob

                Send-Json $response @{ ok = $true }
            } catch {
                Send-Json $response @{ ok = $false; error = $_.Exception.Message }
            }
        }

        # Return the saved compression selections.
        "/compression/selections" {
            try {
                $path = Join-Path $logsRoot "CompressionSelections.json"
                if (Test-Path $path) {
                    $content = Get-Content $path -Raw -Encoding UTF8
                    $response.ContentType = "application/json"
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($content)
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                } else {
                    Send-Json $response @{}
                }
            } catch {
                Send-Json $response @{}
            }
        }

        # Save the compression selections.
        "/compression/selections/save" {
            try {
                $body = New-Object System.IO.StreamReader($request.InputStream)
                $json = $body.ReadToEnd()
                $path = Join-Path $logsRoot "CompressionSelections.json"
                $json | Set-Content -Path $path -Encoding UTF8
                Send-Json $response @{ ok = $true }
            } catch {
                Send-Json $response @{ ok = $false; error = $_.Exception.Message }
            }
        }

        # Unknown path — return 404.
        default {
            $response.StatusCode = 404
            $response.OutputStream.Write(
                [System.Text.Encoding]::UTF8.GetBytes("404 Not Found"), 0, 13
            )
        }
    }

    $response.Close()
}