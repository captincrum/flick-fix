# -------------------------[ Unified Error Catalog ]------------------------- #

$Global:UM_ErrorCatalog = @{

    # ---- Pipeline ---- #

    PipelineInitFailure = @{
        Code     = 2001
        Severity = "Error"
        Message  = 'ERROR: Pipeline job did not initialize correctly.'
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
            Type     = "Console"
            Code     = 9999
            Severity = "Error"
            Message  = "Unknown error code: $Code"
        }
    }

    $err = $Global:UM_ErrorCatalog[$Code]

    # Guard against a catalog entry missing a required key, so a typo while
    # hand-editing the catalog surfaces loudly instead of returning blank fields.
    foreach ($key in @("Code", "Severity", "Message")) {
        if (-not $err.ContainsKey($key)) {
            return [pscustomobject]@{
                Type     = "Console"
                Code     = 9998
                Severity = "Error"
                Message  = "Malformed error catalog entry '$Code': missing '$key'."
            }
        }
    }

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