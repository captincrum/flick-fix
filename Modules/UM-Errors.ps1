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