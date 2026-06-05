# ============================================================
# FlickFix - Compression Smoke Test (real ffmpeg, CPU only)
# Generates a throwaway clip, runs a real x265 encode through the
# actual Invoke-UMCompressFile, and verifies the output exists and
# is smaller. No GPU, no GUI, no real library, nothing committed.
#
# Run locally:  .\Tests\Run-CompressionSmoke.ps1
# Run in CI:    as its own step, after installing ffmpeg
# ============================================================

$passed = 0; $failed = 0; $errors = @()

function Test-Case {
    param([string]$Name, [scriptblock]$Test)
    try {
        if (& $Test) { Write-Host "  PASS  $Name" -ForegroundColor Green; $script:passed++ }
        else         { Write-Host "  FAIL  $Name" -ForegroundColor Red;   $script:failed++; $script:errors += $Name }
    } catch {
        Write-Host "  FAIL  $Name -- $($_.Exception.Message)" -ForegroundColor Red
        $script:failed++; $script:errors += $Name
    }
}

$repoRoot   = Split-Path $PSScriptRoot -Parent
$moduleRoot = Join-Path $repoRoot "Modules"
Import-Module (Join-Path $moduleRoot "Common.psm1")           -Force
Import-Module (Join-Path $moduleRoot "SmartCompression.psm1") -Force

Write-Host ""; Write-Host "Compression Smoke Test" -ForegroundColor Cyan; Write-Host "----------------------"

# Pre-req: ffmpeg must be on PATH (in CI this fails loudly if the install step is missing)
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
Test-Case "ffmpeg is available on PATH" { [bool]$ffmpeg }
if (-not $ffmpeg) {
    Write-Host "ffmpeg not found - install it (CI: apt-get / choco install ffmpeg) and re-run." -ForegroundColor Red
    exit 1
}

# A CI runner has no GPU, so the encode must resolve to the CPU encoder.
Test-Case "Encoder resolves to CPU libx265 when GPU is off" {
    (UM-ResolveEncoder -BaseCodec "libx265" -UseGPU $false) -eq "libx265"
}

$work   = Join-Path ([System.IO.Path]::GetTempPath()) ("FlickFixSmoke_" + [System.Guid]::NewGuid().ToString("N"))
$srcDir = Join-Path $work "src"
$outDir = Join-Path $work "out"
New-Item -ItemType Directory -Path $srcDir -Force | Out-Null
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

try {
    # Lossless source -> guarantees x265 CRF 22 produces a clearly smaller file.
    $source = Join-Path $srcDir "smoke_sample.mkv"
    & ffmpeg -y -f lavfi -i "testsrc=size=320x240:rate=30:duration=2" `
             -c:v libx264 -preset ultrafast -qp 0 -loglevel error $source 2>&1 | Out-Null

    Test-Case "Lossless source clip was generated" {
        (Test-Path $source) -and ((Get-Item $source).Length -gt 0)
    }

    $statusFile = Join-Path $work "status.json"
    $extra = @{ OutputRoot = $outDir; SourceRoot = $srcDir; CRF = 22; ProbeResultsMap = @{}; UseGPU = $false }

    $result = Invoke-UMCompressFile $source $extra $statusFile 1

    Test-Case "Compress exited cleanly (exit code 0)"          { $result.ExitCode -eq 0 }
    Test-Case "Compressed output file was created"             { (Test-Path $result.OutputPath) -and ((Get-Item $result.OutputPath).Length -gt 0) }
    Test-Case "Compressed output is smaller than the source"   { ($result.CompressedMB -gt 0) -and ($result.CompressedMB -lt $result.OriginalMB) }
    Test-Case "Reported savings are positive"                  { ($result.SavedMB -gt 0) -and ($result.SavedPct -gt 0) }

    Write-Host ""
    Write-Host ("  {0} MB -> {1} MB  (saved {2} MB / {3}%)" -f $result.OriginalMB, $result.CompressedMB, $result.SavedMB, $result.SavedPct) -ForegroundColor DarkGray
}
finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue   # always clean up
}

Write-Host ""; Write-Host "=========================" -ForegroundColor White
Write-Host "  Results: $passed passed, $failed failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================="; Write-Host ""
if ($errors.Count -gt 0) { Write-Host "Failed:" -ForegroundColor Red; $errors | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red } }
if ($failed -gt 0) { exit 1 } else { exit 0 }