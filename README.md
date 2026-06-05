# FlickFix

Automated scanning, repairing, quality-checking, and smart compression for movie and TV libraries.

FlickFix is a media-maintenance system built on PowerShell with a local web-based GUI. It scans video libraries for corruption, repairs damaged files through a staged FFmpeg pipeline, verifies the result against quality thresholds, and intelligently re-encodes your library to x265/HEVC to reclaim space — all from a dark, browser-based interface that requires no command-line knowledge.

---

## Architecture at a glance

FlickFix has three layers:

1. **Web server (`web/server.ps1`)** — a local `HttpListener` on port `17863` that serves the static UI and exposes a JSON API. On launch it opens the UI in an Edge app window. It owns the background-job lifecycle, an in-memory log cache for fast incremental reads, disk-space and path validation, and the live status/heartbeat feed the UI polls.
2. **Pipeline core (`GUI-Core.ps1`)** — loads config, imports the modules, and runs the selected operation inside a PowerShell background `Start-Job`. It routes each `RunMode` to the right entry point (scan, repair, probe, or compress) and emits progress as structured objects the server relays to the UI.
3. **Modules (`Modules/*.psm1`, `Modules/UM-Errors.ps1`)** — the actual work: scanning, repair, quality checks, smart compression, logging, config, shared helpers (including the parallel worker pool and GPU encoder resolution), and a central error catalog.

Generated state lives in `Logs/` — primarily `UnifiedLog.json`, an append-only NDJSON event log that is the single source of truth and what makes every phase restart-safe.

### Repository layout

```
FlickFix/
├── GUI-Core.ps1              # Pipeline orchestrator (runs as a background job)
├── config.json              # Persisted settings
├── README.md
├── Modules/
│   ├── Common.psm1          # Helpers: JSON I/O, paths, GPU resolution, worker pool
│   ├── Config.psm1          # Builds the run context, resolves log/output roots
│   ├── Logging.psm1         # NDJSON log reader/writer + typed log entries
│   ├── Output.psm1          # Console/heartbeat status objects for the UI
│   ├── Quality.psm1         # Standalone SSIM/PSNR quality check
│   ├── Scan.psm1            # Corruption scan + season escalation
│   ├── Repair.psm1          # Staged repair pipeline
│   ├── SmartCompression.psm1# Probe (sample encodes) + compress
│   └── UM-Errors.ps1        # Error catalog + GPU failure explainer
├── web/
│   ├── server.ps1           # HTTP listener + JSON API
│   ├── index.html           # UI markup
│   ├── app.js               # UI logic, polling, compression review tree
│   ├── style.css            # Dark theme
│   └── favicon.ico
├── Tests/
│   └── Run-Tests.ps1        # PowerShell test suite (CI entry point)
└── ui_spec.js               # Playwright end-to-end UI tests
```

---

## Operation modes

Selected in the UI and carried into the job as `RunMode`:

| Mode | RunMode value | What it does |
|---|---|---|
| Scan & Repair | `Full` | Scan the library, then repair everything flagged |
| Scan | `ScanOnly` | Detect issues only; no files are written |
| Repair | `RepairOnly` | Repair items already queued in the log from a prior scan |
| Smart Compression | `SmartCompression` | Probe the library to estimate x265 savings |
| (internal) Compress | `Compress` | Re-encode the files you selected in the review screen |

`Compress` is not a UI radio button — it is launched by the **Compress** button in the Smart Compression Review modal after a probe, via the `/compress/start` endpoint.

---

## How it works

### Scanning (`Scan.psm1`)

Scanning runs `ffprobe` to confirm a video stream exists, then parses `ffmpeg` stderr for known corruption signatures (`sps_id ... out of range`, `Invalid NAL unit size`, `missing picture in access unit`). A `missing picture` smaller than 100 bytes is ignored as benign.

- **Library-type detection** is automatic (`UM-LibraryType`): keyword match on the path first (`shows`, `tv`, `series`, `movies`, `films`…), then a density check of video files per subfolder, defaulting to `Movies`.
- **Movies** are always scanned in full.
- **Shows** in Quick mode scan only the first episode of each season (matched via `S##E##`); Full mode scans every episode.
- **Season escalation** — if a sampled first episode reports an error in Quick mode, the whole show is queued for a full scan in a second pass after the first pass drains. This avoids worker-exit races and covers the show regardless of season-folder nesting.
- **Restart-safe** — already-scanned paths are loaded into an `O(1)` HashSet from the existing log and skipped.

Flagged files are written to the log as `ToRepair` entries with status `Pending`.

### Repair pipeline (`Repair.psm1`)

The repair queue is everything `ToRepair`/`Pending` that has no later `RepairResult`. Each file runs through up to five stages, stopping at the first that produces a clean, quality-passing output:

| Stage (internal) | Friendly name | Strategy |
|---|---|---|
| `Remux` | Fast Repair | Container rebuild, stream copy |
| `ReencodeVideo_CopyAudio` | Standard Repair | Re-encode video, copy audio |
| `ReencodeVideo_AAC` | Enhanced Repair | Re-encode video, AAC audio |
| `FullReencode` | Deep Repair | Full re-encode, `medium` preset |
| `LastResortMp4` | Emergency Conversion | Full re-encode forced to `.mp4` |

- **Quality gate** — after each successful stage, `Invoke-RepairQualityCheck` measures SSIM (and PSNR) against the original. SSIM ≥ `0.96` passes. On a near miss, CRF is dropped by a variable amount (1–5 based on how far off it is) and the same stage retries at higher quality; if it can't improve, it advances to the next stage. `LastResortMp4` is accepted unconditionally as a final fallback.
- **Size gate** — a repaired file larger than `1.5×` the original (`UM-MaxSizeRatio`) is rejected, preventing runaway re-encodes.
- **Resume** — repair reconstructs its position from the log's prior `RepairAttempt`/`Quality` entries, so an interrupted run continues mid-stage rather than starting over.
- Successful `LastResortMp4` repairs clean up intermediate files, keeping only the `.mp4`.

Output is written to a `Repaired` subfolder under the Repaired Root (or the project root if none is set).

### Quality check (`Quality.psm1`)

A standalone SSIM + PSNR comparison (`Get-UMQualityMetrics` / `Invoke-UMQualityCheck`) with targets SSIM `0.96` and PSNR `40`. Results are logged as `Quality` entries. (The repair pipeline uses its own embedded SSIM check so workers can run it in isolated runspaces.)

### Smart Compression (`SmartCompression.psm1`)

A two-step flow: **probe** to estimate, then **compress** what you approve.

**Probe (`Invoke-UMSmartProbe` → `Invoke-UMProbeFile`)**

- **GPU preflight** — when GPU is enabled, the hardware encoder is initialization-tested once up front so a too-old driver surfaces one clear, actionable message instead of failing every file.
- **Hard filters skip** files that are already `hevc`/`av1`/`vp9`, shorter than 3 minutes, or under 500 kbps video bitrate.
- **Sample encodes** — Fast mode encodes one 30-second sample at the 50% mark; Accurate mode encodes three (25%, 50%, 75%). Bitrate is derived from the *output file size*, which works identically for CPU and GPU encoders. Upgrading a file from Fast to Accurate reuses the existing 50% sample.
- **Skip rule** — if any sample's bitrate exceeds the source, the file is skipped (it wouldn't shrink).
- **Estimate** — average sample bitrate + audio bitrate, projected over the full duration, gives the estimated compressed size, savings in MB, and savings %.
- **Confidence** — derived from the spread between samples: ≤15% = High, ≤40% = Medium, otherwise Low (single-sample Fast probes report High).
- **Verdict** — `Compress` if estimated savings ≥ 10%, otherwise `Skip` (reason `SavingsBelowThreshold`; these stay re-probeable later).

Each result is written as a `SmartProbe` log entry and shown in the review tree.

**Compress (`Invoke-UMCompress` → `Invoke-UMCompressFile`)**

- Reads the queue you submitted from the review screen, mirrors the source folder structure under a `Compressed` output folder, and re-encodes video to x265/HEVC (CPU or GPU) at the chosen CRF, copying audio.
- **Restart-safe** — files with a prior successful `Compress` entry whose output still exists are skipped.

### GPU encoding (`Common.psm1`, `UM-Errors.ps1`)

`UM-ResolveEncoder` maps a base CPU codec (`libx264`/`libx265`) to a hardware encoder when GPU is on and available, in priority order NVIDIA `nvenc` → AMD `amf` → Intel `qsv`, falling back to the CPU codec if none is found. Because hardware encoders don't accept `-crf`, `UM-ResolveEncoderArgs` maps the quality value to each family's equivalent (`constqp`/`-qp` for nvenc, `-qp_i`/`-qp_p` for amf, `-global_quality` for qsv). `UM-TestGpuEncoder` runs a tiny synthetic encode to verify the encoder actually initializes, and `UM-ExplainGpuError` pulls the driver-related lines out of FFmpeg's output into a readable message.

### Parallel worker pool (`Common.psm1`)

`Invoke-UMWorkerPool` is the shared engine behind scan, probe, repair, and compress. It spins up one runspace per worker, hands out files from a mutex-guarded JSON queue, and has each worker write results to a temp file and live status (folder, file, sample/attempt counters, timers) to a per-worker status file. The main loop polls those files, deduplicates results by path, invokes the caller's `OnResult`/`OnProgress` callbacks, and cleans everything up on completion. Worker count is configurable (1–8).

---

## Logging (`Logging.psm1`)

All events append to `Logs/UnifiedLog.json` as newline-delimited JSON (one object per line), each stamped with a sortable timestamp. Writes are serialized with a global mutex so parallel workers don't corrupt the file. Entry types include:

`Scan`, `ToRepair`, `RepairAttempt`, `Quality`, `RepairResult`, `SmartProbe`, `Compress`, and `ShowComplete`.

The server keeps an incremental in-memory cache (`Update-LogCache`) that reads only newly appended bytes, rebuilding from scratch only if the file shrank (i.e. logs were cleared). This backs the live log's virtual scrolling, slicing, and search without re-parsing the whole file each poll.

---

## Web API (`web/server.ps1`)

| Endpoint | Purpose |
|---|---|
| `/`, `/index.html`, `/style.css`, `/app.js`, `/favicon.ico` | Serve the static UI |
| `/start` | Validate paths + free space, then launch a scan/repair run |
| `/cancel` | Kill FFmpeg processes and tear down the job |
| `/status` | High-level run state (idle/running/completed/error) |
| `/status-console` | Latest console/progress object |
| `/status-all` | Status + run state + log line count in one call |
| `/browse-folder` | Native folder picker, returns the chosen path |
| `/logs/human`, `/logs/machine` | Full parsed log entries |
| `/logs/total` | Current log line count |
| `/logs/slice?start=&end=` | A window of raw log lines (virtual scroll) |
| `/logs/search?q=&max=` | Matching lines, capped at `max` but reporting true total |
| `/logs/clear` | Empty the log and saved compression selections |
| `/config`, `/config/save` | Read / persist settings |
| `/gpu-detect` | Detect a usable hardware HEVC encoder (cached) |
| `/disk-space?path=` | Free space on the drive for a path |
| `/compress/start` | Validate payload, persist the queue, launch compression |
| `/compression/selections`, `/compression/selections/save` | Read / persist review-tree selections |

---

## The Smart Compression Review screen

After a probe, the **Review** screen shows an expandable tree (library → shows → seasons → files) with original → estimated size, savings %, and a verdict per item. The **Filter By** panel narrows what's checked for compression:

- **Confidence** — High / Medium / Low (auto-disabled when there's no probe variance to gate on).
- **Resolution** — ≤720p / 1080p / ≥4K, bucketed by frame width.
- **Minimum saving (MB)** and **minimum space saved (%)** — per-file thresholds.
- **Cap modes** — *Top savers* (keep the N biggest savers), *Free up at least* (select files until X GB is reclaimed), or *Keep total under* (select files while staying under an X GB output budget). Caps always prefer the biggest savers first.
- **Reset Defaults** restores the panel.

Filters run in three passes: predicate filters build the eligible pool, the cap trims it, and sticky manual check/uncheck overrides are re-applied last so they survive filter changes. The running **Summary** (folder/file counts, size before/after, total saved) and selections persist via the server.

---

## Configuration

Settings persist to `config.json`:

| Key | Description |
|---|---|
| `RootPath` | Path to your media library |
| `RepairedPath` | Output path for repaired files |
| `Mode` | Saved operation mode |
| `RunMode` | Mode actually executed for the current run |
| `ScanAllEpisodes` | Quick (`false`) or Full (`true`) scan |
| `AccurateMode` | Fast (`false`) or Accurate (`true`) probe |
| `CrfValue` | x265 CRF quality value (18–28, default 22) |
| `Workers` | Parallel worker count (1–8) |
| `UseGPU` | Use a hardware encoder when available |
| `CompressionOutputPath` | Output path for compressed files |

Out-of-range or missing values are normalized on load (e.g. CRF clamps to 22, workers to 4).

---

## Installation and requirements

- Windows with PowerShell 5.1+
- FFmpeg and FFprobe on the system `PATH`
- Microsoft Edge (the UI opens as an Edge app window) or any modern browser
- Node.js + Playwright only if you want to run the end-to-end UI tests

```
git clone https://github.com/captincrum/flick-fix.git
```

---

## Usage

1. **Start the server** — run `web/server.ps1` in PowerShell. It launches the listener and opens the UI.
2. **Configure** — set the Library Root, set the Repaired/Compressed output, choose Quick or Full, pick a worker count, and toggle CPU/GPU.
3. **Pick a mode** — Scan & Repair, Scan, Repair, or Smart Compression.
4. **For Smart Compression** — choose Fast or Accurate and a CRF (22 ≈ 97.5% quality retained), click Start to probe, then open Review, narrow with the filters, set output + workers, and click Compress.
5. **Review logs** — the live log panel supports search and virtual scrolling; Human and Machine views read the same `UnifiedLog.json`.

The **Cancel** button stops the pipeline and force-kills any child FFmpeg processes immediately.

---

## Testing and CI

Two suites:

- **`Tests/Run-Tests.ps1`** — the PowerShell suite and the CI entry point. It covers file structure, config validation, module imports, helper functions (`UM-PrettyMode`, `UM-VideoExtensions`, `UM-LibraryType`, `UM-LoadJson`), output guards, scan resume performance, log entry formats, the log cache, server endpoint contracts, client-side contracts, and GPU encoder resolution/integration/client contracts. It prints a pass/fail tally and exits non-zero on any failure so CI fails the build.

  ```
  .\Tests\Run-Tests.ps1
  ```

- **`ui_spec.js`** — Playwright end-to-end tests driving the real UI at `http://localhost:17863` (page load, status badge, mode switching, log filter behavior, tree rendering, and more). Requires the server to be running.

> When changing behavior, contracts, or DOM IDs/structure the tests assert on, update the relevant suite in the same change so CI stays green.

---

## Contributing

Contributions, bug reports, and feature requests are welcome. Please open an issue or submit a pull request.