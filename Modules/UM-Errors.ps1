# -------------------------[ Unified Error Catalog ]------------------------- #

$Global:UM_ErrorCatalog = @{

    # ---- Input validation ---- #

    LibraryRootNotFound = @{
        Code     = 1001
        Severity = "Error"
        Message  = 'ERROR: The path for "Library Root" was not found.'
    }

    RepairedPathNotFound = @{
        Code     = 1002
        Severity = "Error"
        Message  = 'ERROR: The path for "Repaired Output" was not found.'
    }

    EmptyLibrary = @{
        Code     = 1003
        Severity = "Warning"
        Message  = 'No video files found in the selected library root.'
    }

    InvalidMode = @{
        Code     = 1004
        Severity = "Error"
        Message  = 'ERROR: Invalid pipeline mode specified.'
    }

    CompressionOutputMissing = @{
        Code     = 1005
        Severity = "Error"
        Message  = 'ERROR: A Compressed Output path is required before compressing.'
    }

    # ---- Pipeline ---- #

    PipelineInitFailure = @{
        Code     = 2001
        Severity = "Error"
        Message  = 'ERROR: Pipeline job did not initialize correctly.'
    }

    PipelineAlreadyRunning = @{
        Code     = 2002
        Severity = "Warning"
        Message  = 'A pipeline job is already running. Cancel it before starting a new one.'
    }

    PipelineCancelFailed = @{
        Code     = 2003
        Severity = "Error"
        Message  = 'ERROR: Failed to cancel the running pipeline cleanly.'
    }

    # ---- Worker / ffmpeg ---- #

    FfmpegNotFound = @{
        Code     = 3001
        Severity = "Error"
        Message  = 'ERROR: ffmpeg was not found. Ensure ffmpeg is installed and on the PATH.'
    }

    FfprobeNotFound = @{
        Code     = 3002
        Severity = "Error"
        Message  = 'ERROR: ffprobe was not found. Ensure ffprobe is installed and on the PATH.'
    }

    WorkerCrashed = @{
        Code     = 3003
        Severity = "Error"
        Message  = 'ERROR: A worker process crashed unexpectedly. Check the log for details.'
    }

    GpuEncoderInitFailed = @{
        Code     = 3004
        Severity = "Error"
        Message  = 'ERROR: The GPU encoder could not start.'
    }

    # ---- Log / disk ---- #

    LogWriteFailed = @{
        Code     = 4001
        Severity = "Error"
        Message  = 'ERROR: Failed to write to the machine log. Check disk space and permissions.'
    }

    LogReadFailed = @{
        Code     = 4002
        Severity = "Error"
        Message  = 'ERROR: Failed to read the machine log. The file may be corrupt or locked.'
    }

    DiskSpaceLow = @{
        Code     = 4003
        Severity = "Warning"
        Message  = 'WARNING: Available disk space is below the estimated requirement.'
    }

    # ---- Compression ---- #

    CompressionQueueEmpty = @{
        Code     = 5001
        Severity = "Warning"
        Message  = 'No files are queued for compression. Run a Smart Compression probe first.'
    }

    CompressionFailed = @{
        Code     = 5002
        Severity = "Error"
        Message  = 'ERROR: One or more files failed to compress. See the log for details.'
    }
}

# -------------------------[ Error Factory ]-------------------------------- #

function UM-ThrowError {
    param(
        [Parameter(Mandatory)]
        [string]$Code,

        # Optional extra context appended to the message
        [string]$Detail = ""
    )

    if (-not $Global:UM_ErrorCatalog.ContainsKey($Code)) {
        return [pscustomobject]@{
            Type    = "Console"
            Message = "Unknown error code: $Code"
        }
    }

    $err     = $Global:UM_ErrorCatalog[$Code]
    $message = if ($Detail) { "$($err.Message) $Detail" } else { $err.Message }

    return [pscustomobject]@{
        Type     = "Console"
        Code     = $err.Code
        Severity = $err.Severity
        Message  = $message
    }
}

# -------------------------[ GPU Failure Explainer ]------------------------ #
function UM-ExplainGpuError {
    param(
        [Parameter(Mandatory)][string]$Encoder,
        [string]$ErrorText = ""
    )

    # Keep only the line(s) that mention the driver -- that is the one telling
    # the user exactly what they need.
    $driverLines = @()
    if ($ErrorText) {
        $driverLines = ($ErrorText -split "`r?`n") | Where-Object { $_ -match '(?i)driver' }
    }

    # If ffmpeg didn't mention "driver", fall back to its last few lines so the
    # user still sees the actual reason rather than nothing.
    if (-not $driverLines -and $ErrorText) {
        $driverLines = ($ErrorText -split "`r?`n" | Where-Object { $_.Trim() }) | Select-Object -Last 3
    }

    $shown  = ($driverLines | ForEach-Object { $_.Trim() }) -join "`n"
    $detail = if ($shown) { "ffmpeg reported:`n$shown`n" } else { "" }
    $detail += "Either update your graphics driver as shown above, or turn off the GPU toggle to run on CPU."

    return UM-ThrowError -Code "GpuEncoderInitFailed" -Detail $detail
}