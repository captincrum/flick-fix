/* ------------------------[           DOM references           ]------------------------ */

const logPane         	= document.getElementById("logPane");
const splitter        	= document.getElementById("splitter");
const humanLogBtn     	= document.getElementById("humanLogBtn");
const machineLogBtn   	= document.getElementById("machineLogBtn");
const logViewer       	= document.getElementById("logViewer");
const resumeScrollBtn 	= document.getElementById("resumeScrollBtn");
const logSpacer  		= document.getElementById("logSpacer");
const logContent 		= document.getElementById("logContent");
const ESTIMATED_LINE_HEIGHT = 18;
const LINES_PER_ENTRY = 8;       
const ENTRY_HEIGHT = ESTIMATED_LINE_HEIGHT * LINES_PER_ENTRY;

/* ------------------------[          UI state tracking         ]------------------------ */

let logAutoScroll      	= true;
let logOpen            	= false;
let isResizing         	= false;
let startX             	= 0;
let startWidth         	= 0;

let activeLogMode      	= "live";
let isScrollFetching 	= false;

let lastRepairStatus   	= null;
let lastRepairUpdateAt 	= null;
let currentPhase       	= "none"; // "none" | "phase1" | "phase2" | "phase3"

let logFilterText = "";

let fullLogLength = 0;
let windowStart = 0;
let windowEnd = 200;

let resumeShouldBeVisible = false;

/* ------------------------[          GPU encoding state        ]------------------------ */

let gpuAvailable = false;
let gpuName      = "None";

function getGpuStatusText() {
    if (!gpuAvailable) return "No GPU detected";
    const on = document.getElementById("useGPU").checked;
    return on ? gpuName.split(" ")[0] + " detected" : "";
}

function updateGpuStatus() {
    const main = document.getElementById("gpuStatusDesc");
    if (main) main.textContent = getGpuStatusText();
    const modal = document.getElementById("compressGpuStatusDesc");
    if (modal) modal.textContent = getGpuStatusText();
}

function updateGpuToggleState() {
    const gpuToggle = document.getElementById("useGPU");
    const gpuGroup  = document.querySelector(".gpu-toggle-group");
    const isRunning = document.getElementById("startBtn").disabled;
    const selectedMode = document.querySelector("input[name='mode']:checked")?.value;
    const isScanOnly   = selectedMode === "ScanOnly";

    // Settings toggle: gated by detection, Scan mode, and running state
    const shouldDisable = !gpuAvailable || isScanOnly || isRunning;
    if (gpuToggle) gpuToggle.disabled = shouldDisable;
    if (gpuGroup)  gpuGroup.classList.toggle("disabled-ui", shouldDisable);

    // Modal toggle: only gated by detection (modal isn't shown while running)
    const modalToggle = document.getElementById("compressUseGPU");
    const modalGroup  = document.querySelector(".gpu-toggle-group-modal");
    if (modalToggle) modalToggle.disabled = !gpuAvailable;
    if (modalGroup)  modalGroup.classList.toggle("disabled-ui", !gpuAvailable);
}

async function detectGPU(savedPref) {
    const gpuToggle = document.getElementById("useGPU");
    try {
        const res  = await fetch("/gpu-detect");
        const data = await res.json();
        gpuAvailable = !!data.available;
        gpuName      = data.name || "None";
    } catch {
        gpuAvailable = false;
        gpuName      = "None";
    }

    const pref = gpuAvailable ? !!savedPref : false;
    if (gpuToggle) gpuToggle.checked = pref;
    const modalToggle = document.getElementById("compressUseGPU");
    if (modalToggle) modalToggle.checked = pref;

    updateGpuToggleState();
    updateGpuStatus();
}

/* ------------------------[       Clear Logs button state      ]------------------------ */

function updateClearLogsBtn() {
    const btn = document.getElementById("clearLogsBtn");
    const isRunning = document.getElementById("startBtn").disabled;
    const hasLogs = fullLogLength > 0 || currentEntries.length > 0;
    const shouldDisable = isRunning || !hasLogs;
    btn.disabled = shouldDisable;
    btn.classList.toggle("disabled-ui", shouldDisable);
}

/* ------------------------[        Core UI state helpers       ]------------------------ */

function setUIRunningState(isRunning) {
    const rootInput      = document.getElementById("rootPath");
    const repairedInput  = document.getElementById("repairedPath");
    const browseRoot     = document.getElementById("browseRoot");
    const browseRepaired = document.getElementById("browseRepaired");
    const scanAll        = document.getElementById("scanAllEpisodes");
    const modeRadios     = document.querySelectorAll("input[name='mode']");
    const startBtn       = document.getElementById("startBtn");
    const cancelBtn      = document.getElementById("cancelBtn");

    if (isRunning) {
        rootInput.disabled      = true;
        repairedInput.disabled  = true;
        browseRoot.disabled     = true;
        browseRepaired.disabled = true;
        scanAll.disabled        = true;
		document.getElementById("workerCount").disabled = true;
		document.getElementById("workerCount").closest(".toggle-row").classList.add("disabled-ui");
		document.getElementById("crfSlider").disabled = true;
        document.getElementById("crfSlider").closest(".toggle-row").classList.add("disabled-ui");
		document.getElementById("accurateMode").disabled = true;
        document.getElementById("scanAllEpisodes").disabled = true;
        document.querySelector("#accurateMode").closest(".toggle-row").classList.add("disabled-ui");
        document.querySelector("#scanAllEpisodes").closest(".scan-toggle-group").classList.add("disabled-ui");		
        startBtn.disabled       = true;
        cancelBtn.disabled      = false;
        modeRadios.forEach(r => (r.disabled = true));

        rootInput.classList.add("disabled-ui");
        repairedInput.classList.add("disabled-ui");
        browseRoot.classList.add("disabled-ui");
        browseRepaired.classList.add("disabled-ui");
        scanAll.classList.add("disabled-ui");
        startBtn.classList.add("disabled-ui");
        cancelBtn.classList.remove("disabled-ui");
        modeRadios.forEach(r => r.classList.add("disabled-ui"));
    } else {
        rootInput.disabled      = false;
        repairedInput.disabled  = false;
        browseRoot.disabled     = false;
        browseRepaired.disabled = false;
        scanAll.disabled        = false;
		document.getElementById("workerCount").disabled = false;
		document.getElementById("workerCount").closest(".toggle-row").classList.remove("disabled-ui");
		document.getElementById("crfSlider").disabled = false;
        document.getElementById("crfSlider").closest(".toggle-row").classList.remove("disabled-ui");
		document.getElementById("accurateMode").disabled = false;
        document.getElementById("scanAllEpisodes").disabled = false;
        document.querySelector("#accurateMode").closest(".toggle-row").classList.remove("disabled-ui");
        document.querySelector("#scanAllEpisodes").closest(".scan-toggle-group").classList.remove("disabled-ui");		
        startBtn.disabled       = false;
        cancelBtn.disabled      = true;
        modeRadios.forEach(r => (r.disabled = false));

        rootInput.classList.remove("disabled-ui");
        repairedInput.classList.remove("disabled-ui");
        browseRoot.classList.remove("disabled-ui");
        browseRepaired.classList.remove("disabled-ui");
        scanAll.classList.remove("disabled-ui");
        startBtn.classList.remove("disabled-ui");
        cancelBtn.classList.add("disabled-ui");
        modeRadios.forEach(r => r.classList.remove("disabled-ui"));
    }

    // GPU toggle follows the same running-state lockout as other settings
    updateGpuToggleState();
}

/* ------------------------[         Mode-based UI rules        ]------------------------ */

function applyModeRules() {
    const rootInput      = document.getElementById("rootPath");
    const browseRoot     = document.getElementById("browseRoot");
    const repairedInput  = document.getElementById("repairedPath");
    const browseRepaired = document.getElementById("browseRepaired");
    const scanAll        = document.getElementById("scanAllEpisodes");

    const selectedMode = document.querySelector("input[name='mode']:checked")?.value;

    const isRunning = document.getElementById("startBtn").disabled;
    if (isRunning) return;

    const isScanOnly   = selectedMode === "ScanOnly";
    const isRepairOnly = selectedMode === "RepairOnly";
	const isSmartCompression = selectedMode === "SmartCompression";

	const lockRepaired = isScanOnly || isSmartCompression;

    repairedInput.disabled  = lockRepaired;
    browseRepaired.disabled = lockRepaired;

    repairedInput.classList.toggle("disabled-ui", lockRepaired);
    browseRepaired.classList.toggle("disabled-ui", lockRepaired);

	const scanToggleRow  = document.querySelector("#scanAllEpisodes").closest(".scan-toggle-group");

    rootInput.disabled  = isRepairOnly;
    browseRoot.disabled = isRepairOnly;
    scanAll.disabled    = isRepairOnly;

    rootInput.classList.toggle("disabled-ui", isRepairOnly);
    browseRoot.classList.toggle("disabled-ui", isRepairOnly);
    scanAll.classList.toggle("disabled-ui", isRepairOnly);
    scanToggleRow.classList.toggle("disabled-ui", isRepairOnly);

	if (!isScanOnly && !isRepairOnly) {
        rootInput.disabled      = false;
        browseRoot.disabled     = false;
        repairedInput.disabled  = isSmartCompression;
        browseRepaired.disabled = isSmartCompression;
        scanAll.disabled        = false;

        rootInput.classList.remove("disabled-ui");
        browseRoot.classList.remove("disabled-ui");
        repairedInput.classList.toggle("disabled-ui", isSmartCompression);
        browseRepaired.classList.toggle("disabled-ui", isSmartCompression);
        scanAll.classList.remove("disabled-ui");
    }

    // GPU toggle is disabled in Scan mode (no encoding happens) and whenever
    // no compatible GPU was detected.
    updateGpuToggleState();
}

/* ------------------------[        Time formatting helpers     ]------------------------ */

function parseHmsToSeconds(hms) {
    if (!hms) return 0;
    const parts = hms.split(":").map(p => parseInt(p, 10));
    if (parts.length !== 3 || parts.some(isNaN)) return 0;
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function formatSecondsToHms(totalSeconds) {
    if (totalSeconds < 0) totalSeconds = 0;
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(4, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function padElapsed(str) {
    if (!str) return "0000:00:00";
    const parts = str.split(":");
    if (parts.length === 3) {
        parts[0] = parts[0].padStart(4, "0");
        return parts.join(":");
    }
    return str;
}

function fmtNum(n) {
	const v = Number(n);
    return Number(n || 0).toLocaleString("en-US");
}

/* ------------------------[          Log rendering helpers     ]------------------------ */

let currentEntries = [];

function renderLogFile(entries) {
    if (!entries || !Array.isArray(entries) || entries.length === 0) {
        logContent.textContent = "No logs found";
        return;
    }

    // Cache for re-renders when filter changes
    currentEntries = entries;

    const keyOrder = [
        "Type",
        "Path",
        "Library",
        "Errors",
        "RepairStatus",
        "StageFriendly",
        "CRF",
        "OriginalSizeMB",
        "RepairedSizeMB",
        "SizeRatio",
        "ErrorsAfter",
        "OutputPath",
        "Timestamp"
    ];

    function formatEntry(obj) {
        const cleaned = {};
        for (const key of Object.keys(obj)) {
            if (key === "AddedAt") continue;
            cleaned[key] = obj[key];
        }

        const sortedKeys = Object.keys(cleaned).sort((a, b) => {
            const ai = keyOrder.indexOf(a);
            const bi = keyOrder.indexOf(b);
            if (ai === -1 && bi === -1) return a.localeCompare(b);
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
        });

        const longestKey = sortedKeys.reduce((max, k) => Math.max(max, k.length), 0);

        const lines = [];
        lines.push("{");

        for (const key of sortedKeys) {
            const value = cleaned[key];

            let formattedValue;
			if (Array.isArray(value)) {
				const cleaned = value.filter(v => v !== null && typeof v === "object" ? Object.keys(v).length > 0 : v !== null && v !== undefined && v !== "");
				formattedValue = cleaned.length === 0 ? "null" : `[ ${cleaned.map(v => JSON.stringify(v)).join(", ")} ]`;
			} else {
				formattedValue = JSON.stringify(value);
			}

            const paddedKey = `"${key}"`.padEnd(longestKey + 2, " ");
            lines.push(`    ${paddedKey} : ${formattedValue}`);
        }

        lines.push("}");
        return lines.join("\n");
    }

if (activeLogMode === "machine") {
        let text = "";
        for (const e of entries) {
            if (!e || Object.keys(e).length === 0) continue;
            text += JSON.stringify(e) + "\n";
        }
        logContent.textContent = text;

        if (logAutoScroll) {
            logViewer.scrollTop = logViewer.scrollHeight;
        }
        return;
    }

    if (activeLogMode === "human") {
        let text = "";

        const globalLongestKey = entries.reduce((max, e) => {
            if (!e || Object.keys(e).length === 0) return max;
            return Object.keys(e).reduce((m, k) => k === "AddedAt" ? m : Math.max(m, k.length), max);
        }, 0);

        for (const e of entries) {
            if (!e || Object.keys(e).length === 0) continue;
            let block = formatEntry(e);

            block = block.replace(/^{\s*|\s*}$/g, "");
            block = block.replace(/\\\\/g, "\\");
            block = block.replace(/"/g, "");

            block = block
                .split("\n")
                .map(line => {
                    const match = line.match(/^\s*(\S+)\s+:\s+(.*)/);
                    if (!match) return line;
                    const key = match[1].padEnd(globalLongestKey, " ");
                    return `    ${key}  :  ${match[2]}`;
                })
                .join("\n");

            text += block.trimEnd() + "\n\n";
        }

        logContent.textContent = text;

        if (logAutoScroll) {
            logViewer.scrollTop = logViewer.scrollHeight;
        }
        return;
    }	
}

/* ------------------------[        Phase 3 console rendering   ]------------------------ */

function getWorkerDesc(n) {
    n = parseInt(n) || 4;
    if (n <= 3) return "Less CPU intensive — slower processing";
    if (n === 4) return "Recommended — balance of speed and CPU resources";
    return "More CPU intensive — faster processing";
}

function getCompressWorkerDesc(n) {
    n = parseInt(n) || 2;
    if (n === 1) return "Less CPU intensive — slower processing";
    if (n === 2) return "Recommended — balance of speed and CPU resources";
    return "More CPU intensive — faster processing";
}

function renderCompressConsole(s) {
    const consoleEl = document.getElementById("consoleOutput");
    const workers   = s.WorkerFolders || [];
    const pct       = s.TotalItems > 0 ? Math.floor((s.ItemIndex / s.TotalItems) * 100) : 0;

    let workerLines = "";
		const workerDisplayCount = parseInt(document.getElementById("compressWorkerCount").value) || 2;
		for (let i = 0; i < workerDisplayCount; i++) {
        const w           = workers[i];
        const workerLabel = `Worker ${i + 1}`.padEnd(10, " ");
        if (!w || typeof w === "string") {
            workerLines += `${workerLabel} : ${w || "Waiting..."}\n\n`;
            continue;
        }
        let fileElapsed = "0000:00:00";
        if (w.FileStart) {
            const sec = Math.floor((Date.now() - Date.parse(w.FileStart)) / 1000);
            const hh = String(Math.floor(sec / 3600)).padStart(4, "0");
            const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
            const ss = String(sec % 60).padStart(2, "0");
            fileElapsed = `${hh}:${mm}:${ss}`;
        }
		const curMB = w.CurrentMB  || 0;
        const estMB = w.EstimatedMB || 0;
        const speed = w.SpeedMBs   || 0;

        function fmtSize(mb) {
            if (mb >= 1024) return (mb / 1024).toFixed(2) + "GB";
            return Math.round(mb) + "MB";
        }

        let progressStr;
        if (estMB > 0 && curMB <= estMB) {
            const pct = Math.floor((curMB / estMB) * 100);
            progressStr = `~${pct}% (${fmtSize(curMB)} of ~${fmtSize(estMB)})`;
        } else if (estMB > 0 && curMB > estMB) {
            progressStr = `${fmtSize(curMB)} of ~${fmtSize(estMB)}`;
        } else {
            progressStr = `0MB of ~${fmtSize(estMB)}`;
        }
        const speedKBs = Math.round(speed * 1024);
		const speedStr = speed > 0 ? `${fmtNum(speedKBs)}KB/s` : "0KB/s";

        workerLines += `${workerLabel} : ${w.Folder || "--"}\n`;
        workerLines += `${"  File".padEnd(10, " ")} : ${w.Episode || "--"}\n`;
        workerLines += `${"  Time".padEnd(10, " ")} : ${fileElapsed}\n`;
        workerLines += `${"  Progress".padEnd(10, " ")} : ${speedStr} · ${progressStr}\n\n`;
    }

    let block = "";
    block += "----------------------------------------\n";
    block += "Phase 3    : Compressing Files\n";
    block += `Mode       : Smart Compression\n`;
    block += `Elapsed    : ${padElapsed(s.Elapsed)}\n`;
    block += `Compressed : ${fmtNum(s.ItemIndex)} / ${fmtNum(s.TotalItems)}\n`;
    block += `Completion : ${pct}%\n`;
    block += `CRF        : ${s.CRF}\n`;
    block += "----------------------------------------\n";
    block += workerLines;

    consoleEl.textContent = block;
}

function renderRepairConsole() {
    if (!lastRepairStatus) return;

    const consoleEl = document.getElementById("consoleOutput");
    const s         = lastRepairStatus;
    const workers   = s.WorkerFolders || [];
    const pct       = s.TotalItems > 0 ? Math.round((s.ItemIndex / s.TotalItems) * 100) : 0;

    let workerLines = "";
    const workerDisplayCount = parseInt(document.getElementById("workerCount").value) || 4;
    for (let i = 0; i < workerDisplayCount; i++) {
        const w = workers[i];
        const workerLabel = `Worker ${i + 1}`.padEnd(17, " ");

        if (!w || typeof w === "string") {
            workerLines += `${workerLabel}: ${w || "Waiting..."}\n\n`;
            continue;
        }

        let fileElapsed = "00:00:00";
        if (w.FileStart) {
            const sec = Math.floor((Date.now() - Date.parse(w.FileStart)) / 1000);
            const hh = String(Math.floor(sec / 3600)).padStart(2, "0");
            const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
            const ss = String(sec % 60).padStart(2, "0");
            fileElapsed = `${hh}:${mm}:${ss}`;
        }

        let attemptElapsed = "00:00:00";
        if (w.AttemptStart) {
            const sec = Math.floor((Date.now() - Date.parse(w.AttemptStart)) / 1000);
            const hh = String(Math.floor(sec / 3600)).padStart(2, "0");
            const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
            const ss = String(sec % 60).padStart(2, "0");
            attemptElapsed = `${hh}:${mm}:${ss}`;
        }

        workerLines += `${workerLabel}: ${w.Folder || "--"}\n`;
        workerLines += `${"  File".padEnd(17, " ")}: ${w.Episode || "--"}\n`;
        workerLines += `${"  Repair".padEnd(17, " ")}: ${w.Repair || "--"}\n`;
        workerLines += `${"  Attempt".padEnd(17, " ")}: ${w.Attempt || 0}\n`;
        workerLines += `${"  File Time".padEnd(17, " ")}: ${fileElapsed}\n`;
        workerLines += `${"  Attempt Time".padEnd(17, " ")}: ${attemptElapsed}\n\n`;
    }

    let block = "";
    block += "----------------------------------------\n";
    block += "Phase 3          : Repairing & Logging\n";
    block += `Mode             : ${s.Mode || "Repair"}\n`;
    block += `Elapsed Time     : ${padElapsed(s.Elapsed)}\n`;
    block += `Repaired         : ${fmtNum(s.ItemIndex)} / ${fmtNum(s.TotalItems)}\n`;
    block += `Completion       : ${pct}%\n`;
    block += "----------------------------------------\n";
    block += workerLines;

    consoleEl.textContent = block;
}

/* ------------------------[          Live console routing      ]------------------------ */

function renderStatusBlock(data) {
    const consoleEl = document.getElementById("consoleOutput");
    if (!data || !data.status) return;

    const s = data.status;
    let block = "";

    if (currentPhase === "none" && s.Type === "Console") {
        currentPhase = "phase1";
    }

    if (s.Type === "ScanProgress") {
        currentPhase = "phase2";
    }

    if (s.Type === "RepairProgress" || s.Type === "CompressProgress") {
        currentPhase = "phase3";
    }

    if (currentPhase === "phase1") {
        consoleEl.textContent = s.Message;
        return;
    }

	if (currentPhase === "phase2" && s.Type === "ScanProgress") {
		const workers = s.WorkerFolders || [];
		let workerLines = "";
		const workerDisplayCount = parseInt(document.getElementById("workerCount").value) || 4;
		for (let i = 0; i < workerDisplayCount; i++) {
			const w       = workers[i];
			const workerLabel = `Worker ${i + 1}`.padEnd(10, " ");

			if (!w || typeof w === "string") {
				workerLines += `${workerLabel} : ${w || "Waiting..."}\n\n`;
				continue;
			}

			if (!w.Sample && w.File !== undefined) {
				workerLines += `${workerLabel} : ${w.Folder || "--"}\n`;
				workerLines += `${"  File".padEnd(10, " ")} : ${w.File || "--"}\n\n`;
				continue;
			}

			const sample = (w.Sample != null && w.TotalSamples != null) ? `${w.Sample}/${w.TotalSamples}` : "--";
			let sampleElapsed = "00:00:00";
			if (w.SampleStart) {
				const sec = Math.floor((Date.now() - Date.parse(w.SampleStart)) / 1000);
				const hh = String(Math.floor(sec / 3600)).padStart(2, "0");
				const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
				const ss = String(sec % 60).padStart(2, "0");
				sampleElapsed = `${hh}:${mm}:${ss}`;
			}
			workerLines += `${workerLabel} : ${w.Folder || "--"}\n`;
			workerLines += `${"  File".padEnd(10, " ")} : ${w.Episode || "--"}\n`;
			workerLines += `${"  Sample".padEnd(10, " ")} : ${sample}\n`;
			workerLines += `${"  Time".padEnd(10, " ")} : ${sampleElapsed}\n\n`;
		}

		block += "----------------------------------------\n";
		const phase2Label = s.Mode === "SmartCompression" ? "Probing Compression" : "Scanning & Logging";
		block += `Phase 2    : ${phase2Label}\n`;
		const modeNames = { Full: "Scan & Repair", ScanOnly: "Scan", RepairOnly: "Repair", SmartCompression: "Smart Compression" };
		block += `Mode       : ${modeNames[s.Mode] || s.Mode}\n`;
		block += `Elapsed    : ${padElapsed(s.Elapsed)}\n`;
		block += `Scanned    : ${fmtNum(s.Scanned)}/${fmtNum(s.Total)}\n`;
		block += `Completion : ${s.Total > 0 ? Math.floor((s.Scanned / s.Total) * 100) : 0}%\n`;
		block += "----------------------------------------\n";
		block += workerLines;
		consoleEl.textContent = block;
		return;
	}

    if (s.Type === "CompressProgress") {
        currentPhase = "phase3";
        renderCompressConsole(s);
        return;
    }

    if (s.Type === "RepairProgress") {
        currentPhase = "phase3";

        const isNew =
            !lastRepairStatus ||
            lastRepairStatus.AttemptCount !== s.AttemptCount ||
            lastRepairStatus.StageFriendly !== s.StageFriendly ||
            lastRepairStatus.Elapsed !== s.Elapsed;

        if (isNew) {
            lastRepairStatus   = s;
            lastRepairUpdateAt = Date.now();
        }

        renderRepairConsole();
        return;
    }

    if (s.Type === "Console") {
        consoleEl.textContent = s.Message + "\n";
    }
}

/* ------------------------[              API helpers           ]------------------------ */

async function apiStart(root, repaired, mode, scanAll, workers, useGPU) {
    const url = `/start?root=${encodeURIComponent(root)}&repaired=${encodeURIComponent(
        repaired
    )}&mode=${encodeURIComponent(mode)}&scanAll=${scanAll}&workers=${workers || 4}&useGPU=${!!useGPU}`;
    const res = await fetch(url);
    return res.json();
}

async function apiCancel() {
    const res = await fetch("/cancel");
    return res.json();
}

async function apiStatus() {
    const res = await fetch("/status");
    return res.json();
}

async function apiBrowseFolder() {
    const res = await fetch("/browse-folder");
    return res.json();
}

async function apiStatusConsole() {
    const res = await fetch("/status-console");
    return res.json();
}

async function apiLoadHumanLog() {
    const res = await fetch("/logs/human");
    return res.json();
}

async function apiLoadMachineLog() {
    const res = await fetch("/logs/machine");
    return res.json();
}

async function clearLogs() {
    const modal  = document.getElementById("confirmModal");
    const yesBtn = document.getElementById("confirmYes");
    const noBtn  = document.getElementById("confirmNo");

    modal.classList.remove("hidden");

    return new Promise(resolve => {
        yesBtn.onclick = async () => {
            modal.classList.add("hidden");

            const res  = await fetch("/logs/clear");
            const data = await res.json();

			if (data.ok) {
                fullLogLength  = 0;
                windowStart    = 0;
                windowEnd      = 200;
                currentEntries = [];
                renderLogFile([]);
                updateClearLogsBtn();
            } else {
                alert("Failed to clear logs: " + data.error);
            }

            resolve(true);
        };

        noBtn.onclick = () => {
            modal.classList.add("hidden");
            resolve(false);
        };
    });
}

async function apiSaveConfig() {
    const root         = document.getElementById("rootPath").value.trim();
    const repaired     = document.getElementById("repairedPath").value.trim();
    const mode         = document.querySelector("input[name='mode']:checked").value;
    const scanAll      = document.getElementById("scanAllEpisodes").checked;
    const accurateMode = document.getElementById("accurateMode").checked;
    const crfValue     = parseInt(document.getElementById("crfSlider").value);
    const workers = parseInt(document.getElementById("workerCount").value) || 2;
    const useGPU       = document.getElementById("useGPU").checked;
    await fetch(`/config/save?root=${encodeURIComponent(root)}&repaired=${encodeURIComponent(repaired)}&mode=${encodeURIComponent(mode)}&scanAll=${scanAll}&accurateMode=${accurateMode}&crfValue=${crfValue}&workers=${workers}&useGPU=${useGPU}`);
}

async function loadConfig() {
    const res  = await fetch("/config");
    const data = await res.json();
    if (!data.ok) return;
    const cfg = data.config;

    document.getElementById("rootPath").value          = cfg.RootPath || "";
    document.getElementById("repairedPath").value      = cfg.RepairedPath || "";
    document.getElementById("scanAllEpisodes").checked = cfg.ScanAllEpisodes || false;
    document.getElementById("scanModeDesc").textContent = cfg.ScanAllEpisodes
        ? "Scans every episode"
        : "First episode per season";
    document.getElementById("accurateMode").checked    = cfg.AccurateMode || false;
	document.getElementById("crfSlider").value         = 22;
    document.getElementById("crfValue").textContent    = 22;
    document.getElementById("crfDesc").textContent     = "Recommended - ~97.5% quality retained";
    document.getElementById("workerCount").value       = 4;
    document.getElementById("workerValue").textContent = 4;
    document.getElementById("workerDesc").textContent  = getWorkerDesc(4);

    const modeRadio = document.querySelector(`input[name="mode"][value="${cfg.Mode}"]`);
    if (modeRadio) modeRadio.checked = true;

    const isSmartMode = cfg.Mode === "SmartCompression";
    document.getElementById("smartOptions").classList.toggle("hidden", !isSmartMode);
    document.getElementById("compressionOutputPath").value = cfg.CompressionOutputPath || "";

    const desc = document.getElementById("smartMethodDesc");
    desc.textContent = cfg.AccurateMode
        ? "Accuracy of space saved over speed"
        : "Quick results across your entire library";

    // Detect GPU and apply the saved preference
    detectGPU(cfg.UseGPU || false);

    updateReviewButton();
}

async function apiLoadLogSlice(start, end) {
    const res = await fetch(`/logs/slice?start=${start}&end=${end}`);
    return res.json();
}

async function apiLogTotal() {
    const res = await fetch("/logs/total");
    return res.json();
}

async function apiLogSearch(query, max) {
    const res = await fetch(`/logs/search?q=${encodeURIComponent(query)}&max=${max || 500}`);
    return res.json();
}

async function updateReviewButton() {
    const btn = document.getElementById("reviewBtn");
    const data = await apiLogSearch("SmartProbe", 1);
    btn.classList.toggle("disabled-ui", !data.entries || data.entries.length === 0);
}

function renderVirtualizedSlice(entries, anchorIndex) {
    if (!entries || entries.length === 0) return;

    currentEntries = entries;
    renderLogFile(entries);

    // Use fixed height estimate instead of measuring offsetHeight (avoids reflow + inaccuracy)
    const lineHeight = (activeLogMode === "machine") ? 20 : ENTRY_HEIGHT;
    const estContentHeight = entries.length * lineHeight;
    const totalHeight = Math.ceil((fullLogLength / entries.length) * estContentHeight);
    logSpacer.style.height = totalHeight + "px";

    const ratio = fullLogLength > 0 ? anchorIndex / fullLogLength : 0;
    const topOffset = Math.floor(ratio * totalHeight);
    logContent.style.top = topOffset + "px";
}

async function saveCompressionSelections() {
    const tbody = document.getElementById("compressionTreeBody");
    if (!tbody) return;

    // Refresh the resolved-state cache used by toggleChildren when a folder expands
    const cache = {};
    [...tbody.querySelectorAll("tr")].forEach(row => {
        const cb = row.querySelector(".tree-checkbox");
        if (row.dataset.path && cb) cache[row.dataset.path] = cb.checked;
    });
    window._compressionSelections = cache;

    // Persist only the user's deviations + the filter config (not all ~23k rows)
    const payload = {
        manual: window._manualSelections || {},
        filter: _readFilterConfig()
    };
    await fetch("/compression/selections/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
}

function _readFilterConfig() {
    return {
        conf:     { high:   document.getElementById("filterConfHigh").checked,
                    medium: document.getElementById("filterConfMedium").checked,
                    low:    document.getElementById("filterConfLow").checked },
        res:      { r720:  document.getElementById("filterRes720").checked,
                    r1080: document.getElementById("filterRes1080").checked,
                    r4k:   document.getElementById("filterRes4k").checked },
        minMB:    document.getElementById("filterMinMB").value,
        minPct:   document.getElementById("filterMinPct").value,
        capMode:  document.getElementById("filterCapMode").value,
        capValue: document.getElementById("filterCapValue").value
    };
}

function _applyFilterConfig(f) {
    if (f.conf && !document.getElementById("filterConfHigh").disabled) {
        document.getElementById("filterConfHigh").checked   = !!f.conf.high;
        document.getElementById("filterConfMedium").checked = !!f.conf.medium;
        document.getElementById("filterConfLow").checked    = !!f.conf.low;
    }
    if (f.res) {
        document.getElementById("filterRes720").checked  = !!f.res.r720;
        document.getElementById("filterRes1080").checked = !!f.res.r1080;
        document.getElementById("filterRes4k").checked   = !!f.res.r4k;
    }
    document.getElementById("filterMinMB").value    = f.minMB    != null ? f.minMB    : "";
    document.getElementById("filterMinPct").value   = f.minPct   != null ? f.minPct   : "";
    document.getElementById("filterCapMode").value  = f.capMode  || "none";
    document.getElementById("filterCapValue").value = f.capValue != null ? f.capValue : "";
    _onCapModeChange();   // updates cap unit/visibility AND re-runs the filter
}

function _anyFilterActive() {
    if (document.getElementById("filterCapMode").value !== "none") return true;
    if (_readFilterNum("filterMinMB", 1, 9999) !== null) return true;
    if (_readFilterNum("filterMinPct", 10, 95) !== null) return true;
    const r = ["filterRes720", "filterRes1080", "filterRes4k"].map(id => document.getElementById(id).checked);
    if (!(r[0] && r[1] && r[2])) return true;
    if (!document.getElementById("filterConfHigh").disabled) {
        const c = ["filterConfHigh", "filterConfMedium", "filterConfLow"].map(id => document.getElementById(id).checked);
        if (!(c[0] && c[1] && c[2])) return true;
    }
    return false;
}

function _recordManual(row, cb) {
    const path = row.dataset.path;
    if (!path || cb.disabled) return;            // skip/disabled rows are never recorded
    window._manualSelections = window._manualSelections || {};
    const bit = cb.checked ? 1 : 0;
    if (bit === 1 && !_anyFilterActive()) {
        delete window._manualSelections[path];   // back to verdict default, no filter -> forget it
    } else {
        window._manualSelections[path] = bit;
    }
}

async function loadCompressionSelections() {
    try {
        const res = await fetch("/compression/selections");
        if (!res.ok) return {};
        return await res.json();
    } catch { return {}; }
}

function showError(message) {
    document.getElementById("errorMessage").textContent = message;
    document.getElementById("errorModal").classList.remove("hidden");
}

document.getElementById("errorOk").addEventListener("click", () => {
    document.getElementById("errorModal").classList.add("hidden");
});

/* ------------------------[          Log pane controls         ]------------------------ */

function openLogPane() {
    logOpen = true;
    logPane.style.width = "0";
    void logPane.offsetWidth;
    logPane.classList.add("open");
    logPane.style.width = "";
	
    if (resumeShouldBeVisible) {
        resumeScrollBtn.classList.remove("hidden");
    }
}

function closeLogPane() {
    logOpen = false;
	resumeShouldBeVisible = !resumeScrollBtn.classList.contains("hidden");
    logPane.classList.remove("open");
    logPane.style.width = "0px";
    activeLogMode = "live";
	logContent.classList.remove("machine-log");
	resumeScrollBtn.classList.add("hidden");
}

function toggleLogPane() {
    if (logOpen) closeLogPane();
    else openLogPane();
}

/* ------------------------[        Event wiring: lifecycle     ]------------------------ */

window.addEventListener("DOMContentLoaded", () => {
    loadConfig();
    updateClearLogsBtn();
});

document.querySelectorAll("input[name='mode']").forEach(radio => {
    radio.addEventListener("change", () => {
        const isSmartMode = document.querySelector("input[name='mode']:checked")?.value === "SmartCompression";
        document.getElementById("smartOptions").classList.toggle("hidden", !isSmartMode);
        applyModeRules();
    });
});

applyModeRules();
document.getElementById("cancelBtn").disabled = true;
document.getElementById("cancelBtn").classList.add("disabled-ui");

/* ------------------------[      Event wiring: log autoscroll  ]------------------------ */

let scrollLockTimeout = null;
let scrollLocked = false;

logViewer.addEventListener("scroll", async () => {
    const atBottom =
        logViewer.scrollTop + logViewer.clientHeight >= logViewer.scrollHeight - 5;

    if (atBottom) {
        scrollLocked = false;
        logAutoScroll = true;
        resumeScrollBtn.classList.add("hidden");
        return;
    }

    if (logFilterText) return;

    // User scrolled up - lock the poller out
    logAutoScroll = false;
    scrollLocked = true;
    resumeScrollBtn.classList.remove("hidden");

    if (scrollLockTimeout) clearTimeout(scrollLockTimeout);
    scrollLockTimeout = setTimeout(() => {
        scrollLocked = false;
    }, 1500);

    // Only fetch when scrolled near the top of the current content
    if (logViewer.scrollTop > 50) return;

    if (isScrollFetching) return;
    isScrollFetching = true;

    // Load the page before the current window
    windowEnd = windowStart;
    windowStart = Math.max(0, windowStart - 200);

    const data = await apiLoadLogSlice(windowStart, windowEnd);
    fullLogLength = data.total;
    currentEntries = data.entries || [];
    logSpacer.style.height = "0px";
    logContent.style.top = "0px";
    renderLogFile(currentEntries);

    // Position viewport in the middle of the new content so they can keep scrolling up
    requestAnimationFrame(() => {
        logViewer.scrollTop = logViewer.scrollHeight / 2;
    });

    isScrollFetching = false;
});

resumeScrollBtn.addEventListener("click", async () => {
    logAutoScroll = true;
    scrollLocked = false;

    windowEnd = fullLogLength;
    windowStart = Math.max(0, fullLogLength - 200);

    const data = await apiLoadLogSlice(windowStart, windowEnd);
    currentEntries = data.entries || [];
    logSpacer.style.height = "0px";
    logContent.style.top = "0px";
    renderLogFile(currentEntries);
    requestAnimationFrame(() => { logViewer.scrollTop = logViewer.scrollHeight; });
    resumeScrollBtn.classList.add("hidden");
});

/* ------------------------[      Event wiring: log buttons     ]------------------------ */

humanLogBtn.addEventListener("click", async () => {
    const isActivating = !humanLogBtn.classList.contains("active");

    humanLogBtn.classList.toggle("active", isActivating);
    machineLogBtn.classList.remove("active");

	if (isActivating) {
		activeLogMode = "human";
		logContent.classList.remove("machine-log");
		openLogPane();

		const meta = await apiLogTotal();
		if (activeLogMode !== "human") return;
		fullLogLength = meta.total;
		windowEnd = fullLogLength;
		windowStart = Math.max(0, fullLogLength - 200);

		const data = await apiLoadLogSlice(windowStart, windowEnd);
		if (activeLogMode !== "human") return;
		currentEntries = data.entries || [];
		logSpacer.style.height = "0px";
		logContent.style.top = "0px";
		renderLogFile(currentEntries);
		requestAnimationFrame(() => { logViewer.scrollTop = logViewer.scrollHeight; });
	} else {
        closeLogPane();
    }
});

machineLogBtn.addEventListener("click", async () => {
    const isActivating = !machineLogBtn.classList.contains("active");

    machineLogBtn.classList.toggle("active", isActivating);
    humanLogBtn.classList.remove("active");

	if (isActivating) {
		activeLogMode = "machine";
		logContent.classList.add("machine-log");
		openLogPane();

		const meta = await apiLogTotal();
		if (activeLogMode !== "machine") return;
		fullLogLength = meta.total;
		windowEnd = fullLogLength;
		windowStart = Math.max(0, fullLogLength - 200);

		const data = await apiLoadLogSlice(windowStart, windowEnd);
		if (activeLogMode !== "machine") return;
		currentEntries = data.entries || [];
		logSpacer.style.height = "0px";
		logContent.style.top = "0px";
		renderLogFile(currentEntries);
		requestAnimationFrame(() => { logViewer.scrollTop = logViewer.scrollHeight; });
	} else {
        closeLogPane();
    }
});

let searchDebounce = null;

document.getElementById("logFilterInput").addEventListener("input", () => {
    logFilterText = document.getElementById("logFilterInput").value.trim().toLowerCase();

    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(async () => {
        const countEl = document.getElementById("logFilterCount");
        if (logFilterText) {
            const data = await apiLogSearch(logFilterText, 500);
            currentEntries = data.entries || [];
            fullLogLength = data.total || 0;
            logSpacer.style.height = "0px";
            logContent.style.top   = "0px";
            renderLogFile(currentEntries);
            countEl.textContent = `${fmtNum(data.matched)} matches`;
        } else {
            countEl.textContent = "";
            logAutoScroll = true;
            scrollLocked  = false;
            const meta = await apiLogTotal();
            fullLogLength = meta.total;
            windowEnd   = fullLogLength;
            windowStart = Math.max(0, fullLogLength - 200);
            const data  = await apiLoadLogSlice(windowStart, windowEnd);
            currentEntries = data.entries;
            renderLogFile(currentEntries);
            requestAnimationFrame(() => { logViewer.scrollTop = logViewer.scrollHeight; });
        }
    }, 300);
});

document.getElementById("logFilterClear").addEventListener("click", async () => {
    document.getElementById("logFilterInput").value = "";
    document.getElementById("logFilterCount").textContent = "";
    logFilterText = "";
    logAutoScroll = true;
    scrollLocked  = false;

    const meta = await apiLogTotal();
    fullLogLength = meta.total;
    windowEnd   = fullLogLength;
    windowStart = Math.max(0, fullLogLength - 200);
    const data  = await apiLoadLogSlice(windowStart, windowEnd);
    currentEntries = data.entries || [];
    logSpacer.style.height = "0px";
    logContent.style.top = "0px";
    renderLogFile(currentEntries);
    requestAnimationFrame(() => { logViewer.scrollTop = logViewer.scrollHeight; });
});

/* ------------------------[      Event wiring: splitter drag   ]------------------------ */

splitter.addEventListener("mousedown", e => {
    if (!logOpen) return;

    isResizing = true;
    startX     = e.clientX;
    startWidth = logPane.getBoundingClientRect().width;

    logPane.classList.add("dragging");

    document.body.style.cursor = "col-resize";
    document.body.classList.add("no-select");
});

window.addEventListener("mousemove", e => {
    if (!isResizing) return;

    const dx = e.clientX - startX;
    let newWidth = startWidth + dx;

    const shell = document.querySelector(".shell");
    const shellRect = shell.getBoundingClientRect();

    const leftPane = document.querySelector(".left-pane");
    const leftRect = leftPane.getBoundingClientRect();

    const splitterWidth = splitter.getBoundingClientRect().width;

    // Dynamically read wrapper padding from CSS
    const wrapper = document.getElementById("logPaneWrapper");
    const style = getComputedStyle(wrapper);
    const padLeft  = parseFloat(style.paddingLeft);
    const padRight = parseFloat(style.paddingRight);
    const totalPadding = padLeft + padRight;

    // True max width
    const available =
        shellRect.width -
        leftRect.width -
        splitterWidth;

    const minWidth = 260;
    const maxWidth = available;

    newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

    logPane.style.width = newWidth + "px";
});

window.addEventListener("mouseup", () => {
    if (!isResizing) return;
    isResizing = false;

    logPane.classList.remove("dragging");

    document.body.style.cursor = "default";
    document.body.classList.remove("no-select");
});

/* ------------------------[      Splitter double-click toggle  ]------------------------ */

splitter.addEventListener("dblclick", () => {
    if (!logOpen) return;
    const openWidthCSS = getComputedStyle(logPane).getPropertyValue("--open-width").trim();
    const wrapper = document.getElementById("logPaneWrapper");
    const wrapperWidth = wrapper.getBoundingClientRect().width;
    const minWidth = (parseFloat(openWidthCSS) / 100) * wrapperWidth;
    const paneWidth = logPane.getBoundingClientRect().width;
    const shell = document.querySelector(".shell");
    const shellRect = shell.getBoundingClientRect();
    const leftPane = document.querySelector(".left-pane");
    const leftRect = leftPane.getBoundingClientRect();
    const splitterWidth = splitter.getBoundingClientRect().width;

    const maxWidth =
        shellRect.width -
        leftRect.width -
        splitterWidth;

    if (paneWidth > maxWidth) {
        logPane.style.width = minWidth + "px";
        return;
    }

    if (paneWidth >= maxWidth * 0.98) {
        logPane.style.width = minWidth + "px";
        return;
    }

    logPane.style.width = maxWidth + "px";
});



/* ------------------------[      Event wiring: main buttons    ]------------------------ */

document.getElementById("startBtn").addEventListener("click", async () => {
	await apiSaveConfig();
    compressionModalDismissed = false;
    const startBtn = document.getElementById("startBtn");

    const root     = document.getElementById("rootPath").value.trim();
    const repaired = document.getElementById("repairedPath").value.trim();
    const mode     = document.querySelector("input[name='mode']:checked").value;
    const scanAll  = document.getElementById("scanAllEpisodes").checked;

    // Validate required fields based on mode
    if (mode !== "RepairOnly" && !root) {
        showError("Please select a Library Root before starting.");
        return;
    }

    if (mode !== "ScanOnly" && mode !== "SmartCompression" && !repaired) {
        showError("Please select a Repaired Root folder before starting.");
        return;
    }

    startBtn.classList.add("running");
    const workers = parseInt(document.getElementById("workerCount").value) || 4;
    const useGPU  = document.getElementById("useGPU").checked;
    const result = await apiStart(root, repaired, mode, scanAll, workers, useGPU);
    if (!result.ok) {
        startBtn.classList.remove("running");
        showError(result.error || "Could not start. Check your settings and try again.");
        return;
    }
    console.log("Start:", result);
});

document.getElementById("cancelBtn").addEventListener("click", async () => {
    const startBtn = document.getElementById("startBtn");
    startBtn.classList.remove("running"); // restore default Start button color

    const result = await apiCancel();
    console.log("Cancel:", result);
});

document.getElementById("browseRoot").addEventListener("click", async () => {
    const result = await apiBrowseFolder();
    if (result.ok) {
        document.getElementById("rootPath").value = result.path;
        apiSaveConfig();
    }
});

document.getElementById("browseRepaired").addEventListener("click", async () => {
    const result = await apiBrowseFolder();
    if (result.ok) {
        document.getElementById("repairedPath").value = result.path;
        apiSaveConfig();
    }
});

document.getElementById("rootPath").addEventListener("change", apiSaveConfig);

document.getElementById("repairedPath").addEventListener("change", apiSaveConfig);

document.getElementById("scanAllEpisodes").addEventListener("change", apiSaveConfig);

document.querySelectorAll("input[name='mode']").forEach(r => r.addEventListener("change", apiSaveConfig));

document.getElementById("accurateMode").addEventListener("change", () => {
    const desc     = document.getElementById("smartMethodDesc");
    const accurate = document.getElementById("accurateMode").checked;
    desc.textContent = accurate
		? "Prioritize accuracy in space savings over speed"
        : "Quick results across your entire library";
	apiSaveConfig();
});

document.getElementById("crfSlider").addEventListener("input", function () {
    const val = parseInt(this.value);
    document.getElementById("crfValue").textContent = val;
    const crfDescriptions = {
        18: "Near lossless - ~99.5% quality retained",
        19: "Excellent - ~99.0% quality retained",
        20: "Very high - ~98.5% quality retained",
        21: "High - ~98.0% quality retained",
        22: "Recommended - ~97.5% quality retained",
        23: "Good - ~96.5% quality retained",
        24: "Acceptable - ~95.0% quality retained",
        25: "Noticeable loss - ~93.0% quality retained",
        26: "Visible loss - ~90.0% quality retained",
        27: "Poor - ~86.0% quality retained",
        28: "Low quality - ~80.0% quality retained"
    };
    document.getElementById("crfDesc").textContent = crfDescriptions[val] || "Recommended - ~97.5% quality retained";
    apiSaveConfig();
});

document.getElementById("workerCount").addEventListener("input", function () {
    const val = parseInt(this.value) || 4;
    document.getElementById("workerValue").textContent = val;
    document.getElementById("workerDesc").textContent = getWorkerDesc(val);
    apiSaveConfig();
});

document.getElementById("useGPU").addEventListener("change", function () {
    const modalToggle = document.getElementById("compressUseGPU");
    if (modalToggle) modalToggle.checked = this.checked;
    updateGpuStatus();
    apiSaveConfig();
});

document.getElementById("compressUseGPU").addEventListener("change", function () {
    const mainToggle = document.getElementById("useGPU");
    if (mainToggle) mainToggle.checked = this.checked;
    updateGpuStatus();
    apiSaveConfig();
});

document.getElementById("compressWorkerCount").addEventListener("input", function () {
    const val = parseInt(this.value) || 2;
    document.getElementById("compressWorkerValue").textContent = val;
    document.getElementById("compressWorkerDesc").textContent = getCompressWorkerDesc(val);
});

document.getElementById("scanAllEpisodes").addEventListener("change", function () {
    document.getElementById("scanModeDesc").textContent = this.checked
        ? "Scans every episode"
        : "First episode per season";
    apiSaveConfig();
});

document.getElementById("clearLogsBtn").addEventListener("click", clearLogs);

/* ------------------------[      Compression Results Modal     ]------------------------ */

let compressionTreeData = null;
let compressionModalDismissed = false;

const expandedNodes = new Set();

function formatMB(mb) {
    if (!mb || isNaN(mb)) return "0 MB";
    if (mb >= 1024 * 1024) return (mb / (1024 * 1024)).toFixed(2) + " TB";
    if (mb >= 1024)        return (mb / 1024).toFixed(2) + " GB";
    return mb.toFixed(1) + " MB";
}


function buildTreeData(entries) {
    const root = { name: "All Media", children: {}, origMB: 0, estMB: 0, verdicts: [] };

    for (const e of entries) {
        if (e.Type !== "SmartProbe") continue;

        const parts      = e.Path.replace(/\\/g, "/").split("/");
        const fileName   = parts[parts.length - 1];
        const seasonDir  = parts[parts.length - 2];
        const showDir    = parts[parts.length - 3];

        const isCompress = e.Verdict === "Compress";
        root.origMB += e.OriginalMB || 0;
        root.estMB  += isCompress ? (e.EstimatedMB || e.OriginalMB) : (e.OriginalMB || 0);
        root.verdicts.push(e.Verdict || "Skip");

        if (!root.children[showDir]) {
            root.children[showDir] = { name: showDir, children: {}, origMB: 0, estMB: 0, verdicts: [], isShow: true };
        }
        const show = root.children[showDir];
        show.origMB += e.OriginalMB || 0;
        show.estMB  += isCompress ? (e.EstimatedMB || e.OriginalMB) : (e.OriginalMB || 0);
        show.verdicts.push(e.Verdict || "Skip");

        if (!show.children[seasonDir]) {
            show.children[seasonDir] = { name: seasonDir, children: {}, origMB: 0, estMB: 0, verdicts: [] };
        }
        const season = show.children[seasonDir];
        season.origMB += e.OriginalMB || 0;
        season.estMB  += isCompress ? (e.EstimatedMB || e.OriginalMB) : (e.OriginalMB || 0);
        season.verdicts.push(e.Verdict || "Skip");

        season.children[fileName] = {
            name:       fileName,
            children:   null,
            origMB:     e.OriginalMB || 0,
            estMB:      isCompress ? (e.EstimatedMB || e.OriginalMB) : (e.OriginalMB || 0),
            verdicts:   [e.Verdict || "Skip"],
            verdict:    e.Verdict || "Skip",
            skipReason: e.SkipReason || null,
            confidence: e.Confidence || null,
            savedPct:   e.SavedPct || 0,
            savedMB:    e.SavedMB || 0,
            width:      e.Width || 0,
            path:       e.Path
        };
    }

    function sortChildren(node) {
        if (!node.children) return;
        const sorted = {};
        Object.keys(node.children)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
            .forEach(key => {
                sorted[key] = node.children[key];
                sortChildren(node.children[key]);
            });
        node.children = sorted;
    }

    sortChildren(root);
    return root;
}

function verdictSummary(verdicts) {
    if (!verdicts || verdicts.length === 0) return { label: "Skip", cls: "verdict-skip" };
    const compressCount = verdicts.filter(v => v === "Compress").length;
    if (compressCount === verdicts.length) return { label: "Compress", cls: "verdict-compress" };
    if (compressCount === 0) return { label: "Ineligible", cls: "verdict-skip" };
    return { label: `${compressCount} / ${verdicts.length}`, cls: "verdict-compress" };
}

function savedClass(pct) {
    if (pct >= 20) return "saved-high";
    if (pct >= 5)  return "saved-mid";
    return "saved-low";
}

function restripeTree(tbody) {
    let visibleIdx = 0;
    for (const tr of tbody.querySelectorAll("tr")) {
        if (tr.style.display === "none") continue;
        tr.classList.toggle("tree-stripe", visibleIdx % 2 === 1);
        visibleIdx++;
    }
}

function renderTree(node, level, tbody, parentCheckbox) {
    const isLeaf   = node.children === null;
    const children = isLeaf ? [] : Object.values(node.children);

    const tr = document.createElement("tr");
    tr.className = `tree-tr level-${Math.min(level, 3)}`;

    // Dim skipped leaf rows
	if (isLeaf && node.verdict === "Skip") {
		tr.style.pointerEvents = "none";
	}

    // Name cell
    const tdName = document.createElement("td");
    tdName.className = "tree-td";

    const nameCell = document.createElement("div");
    nameCell.className = "tree-name-cell";

    const indent = document.createElement("span");
    indent.className = "tree-indent";
    indent.style.width = (level * 20) + "px";
    nameCell.appendChild(indent);

    const toggle = document.createElement("span");
    toggle.className = "tree-toggle";
    toggle.textContent = (!isLeaf && children.length > 0) ? "▶" : "";
    nameCell.appendChild(toggle);

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "tree-checkbox";
    cb.checked = isLeaf ? node.verdict === "Compress" : true;
    if (isLeaf && node.verdict === "Skip") {
        cb.disabled = true;
        cb.classList.add("checkbox-disabled");
    }
    nameCell.appendChild(cb);

    const name = document.createElement("span");
    name.className = "tree-name" + (isLeaf ? "" : " is-folder");
    name.textContent = node.name;
    name.title = node.name;
    nameCell.appendChild(name);

    tdName.appendChild(nameCell);
    tr.appendChild(tdName);

    // Size cell
    const tdSize = document.createElement("td");
    tdSize.className = "tree-td tree-td-size";
    if (isLeaf && node.verdict === "Skip") {
        tdSize.textContent = `${formatMB(node.origMB)} - Skip`;
    } else {
        const pct = isLeaf ? node.savedPct : (node.origMB > 0 ? ((node.origMB - node.estMB) / node.origMB * 100).toFixed(1) : 0);
        tdSize.innerHTML = `${formatMB(node.origMB)} &rarr; ${formatMB(node.estMB)}`;
        if (pct > 0) {
            const pctSpan = document.createElement("span");
            pctSpan.className = savedClass(parseFloat(pct));
            pctSpan.textContent = ` (${pct}%)`;
            tdSize.appendChild(pctSpan);
        }
    }
    tr.appendChild(tdSize);

    // Verdict cell
    const tdVerdict = document.createElement("td");
    tdVerdict.className = "tree-td tree-td-verdict";
    if (isLeaf) {
        const isCompress = node.verdict === "Compress";
        tdVerdict.className += " " + (isCompress ? "verdict-compress" : "verdict-skip");
        let label = isCompress ? "Confidence" : "Skip";
        if (isCompress && node.confidence && node.confidence !== "N/A") {
            label += ` (${node.confidence})`;
        }
		if (!isCompress && node.skipReason) {
			const reasonMap = {
				AlreadyModernCodec:   "HEVC/AV1",
				DurationTooShort:     "Too Short",
				BitrateTooLow:        "Low Bitrate",
				SampleExceedsSource:  "Would Grow",
				SavingsBelowThreshold:"< 10% Saving",
				SampleEncodeFailed:   "Probe Failed"
			};
			label = reasonMap[node.skipReason] || "Ineligible";
		} else if (!isCompress) {
			label = "Ineligible";
		}
        tdVerdict.textContent = label;
    } else {
        // Folder rows show the live "selected of available" count here;
        // syncParentCheckboxes fills it and keeps it current.
        const countSpan = document.createElement("span");
        countSpan.className = "tree-count";
        tdVerdict.appendChild(countSpan);
    }
    tr.appendChild(tdVerdict);

	if (isLeaf && node.verdict === "Skip") {
			name.style.opacity = "0.45";
			tdSize.style.opacity = "0.45";
			tdVerdict.style.opacity = "0.45";
	}
		
    if (node.path) {
        tr.dataset.path       = node.path;
        tr.dataset.width      = node.width      || 0;
        tr.dataset.savedmb    = node.savedMB    || 0;
        tr.dataset.savedpct   = node.savedPct   || 0;
        tr.dataset.estmb      = node.estMB      || 0;
        tr.dataset.confidence = node.confidence || "";
    }
    tbody.appendChild(tr);

    // Children
    if (!isLeaf && children.length > 0) {
        let expanded = false;

        for (const child of children) {
            renderTree(child, level + 1, tbody, cb);
        }

        const allRows = [...tbody.querySelectorAll("tr")];
        const idx = allRows.indexOf(tr);
        for (let i = idx + 1; i < allRows.length; i++) {
            const rowLevel = parseInt([...allRows[i].classList].find(c => c.startsWith("level-"))?.replace("level-", "") || "99");
            if (rowLevel <= level) break;
            allRows[i].style.display = "none";
        }

        toggle.textContent = "▶";
		const hasCompressible = children.some(function hasAny(c) {
			if (c.children === null) return c.verdict === "Compress";
			return Object.values(c.children).some(hasAny);
		});
		if (!hasCompressible) {
			tr.querySelector(".tree-checkbox").disabled = true;
			tr.querySelector(".tree-checkbox").classList.add("checkbox-disabled");
			tr.querySelector(".tree-checkbox").style.opacity = "0.3";
			name.style.opacity = "0.45";
			tdSize.style.opacity = "0.45";
			tdVerdict.style.opacity = "0.45";
			toggle.style.color = "var(--text)";
		}

        toggle.addEventListener("click", (e) => {
            e.stopPropagation();
            expanded = !expanded;
            toggle.textContent = expanded ? "▼" : "▶";
            const allRows = [...tbody.querySelectorAll("tr")];
            const idx = allRows.indexOf(tr);
            if (expanded) { expandedNodes.add(node.name); } else { expandedNodes.delete(node.name); }
            toggleChildren(tbody, idx, level, expanded);
        });

        tr.addEventListener("click", (e) => {
            if (e.target === cb || e.target === toggle) return;
            expanded = !expanded;
            toggle.textContent = expanded ? "▼" : "▶";
            const allRows = [...tbody.querySelectorAll("tr")];
            const idx = allRows.indexOf(tr);
            if (expanded) { expandedNodes.add(node.name); } else { expandedNodes.delete(node.name); }
            toggleChildren(tbody, idx, level, expanded);
        });

        // Three-state folder checkbox: smart (compress-only) -> none -> smart
        cb._folderState = "smart"; // "smart" | "none"
        cb.addEventListener("click", (e) => {
            e.stopPropagation();
            const allRows = [...tbody.querySelectorAll("tr")];
            const idx = allRows.indexOf(tr);
            if (cb._folderState === "smart") {
                // -> none
                cb._folderState = "none";
                setChildrenCheckedSmart(tbody, idx, level, false);
            } else {
                // -> smart
                cb._folderState = "smart";
                setChildrenCheckedSmart(tbody, idx, level, "smart");
            }
            // record each affected eligible leaf as a per-file deviation (rollup happens later, in Half B)
            const _allRowsM = [...tbody.querySelectorAll("tr")];
            const _idxM = _allRowsM.indexOf(tr);
            for (let i = _idxM + 1; i < _allRowsM.length; i++) {
                const rl = parseInt([..._allRowsM[i].classList].find(c => c.startsWith("level-"))?.replace("level-", "") || "0");
                if (rl <= level) break;
                const lcb = _allRowsM[i].querySelector(".tree-checkbox");
                if (_allRowsM[i].dataset.path && lcb && !lcb.disabled) _recordManual(_allRowsM[i], lcb);
            }
            updateCompressionSummary();
            saveCompressionSelections();
            syncParentCheckboxes(tbody);
        });
    }

    if (parentCheckbox) {
        cb.addEventListener("change", () => {
            if (tr.dataset.path) _recordManual(tr, cb);   // record the user's per-file deviation
            updateCompressionSummary();
            saveCompressionSelections();
            syncParentCheckboxes(tbody);
        });
    }
}

function toggleChildren(tbody, parentIdx, parentLevel, show) {
    const allRows = [...tbody.querySelectorAll("tr")];
    for (let i = parentIdx + 1; i < allRows.length; i++) {
        const rowLevel = parseInt([...allRows[i].classList].find(c => c.startsWith("level-"))?.replace("level-", "") || "99");
        if (rowLevel <= parentLevel) break;

        if (rowLevel === parentLevel + 1) {
            allRows[i].style.display = show ? "" : "none";

            if (show && window._compressionSelections && allRows[i].dataset.path) {
                const cb = allRows[i].querySelector(".tree-checkbox");
                if (cb && window._compressionSelections.hasOwnProperty(allRows[i].dataset.path)) {
                    cb.checked = window._compressionSelections[allRows[i].dataset.path];
                }
            }

            // If this child was previously expanded, restore its children visibility
            if (show) {
                const childName = allRows[i].querySelector(".tree-name")?.textContent;
                const childToggle = allRows[i].querySelector(".tree-toggle");
                if (childName && expandedNodes.has(childName) && childToggle) {
                    const childIdx = allRows.indexOf(allRows[i]);
                    toggleChildren(tbody, childIdx, rowLevel, true);
                    childToggle.textContent = "▼";
                }
            }
        } else if (!show) {
            allRows[i].style.display = "none";
        }
    }
    if (show) syncParentCheckboxes(tbody);
	restripeTree(tbody);
}

// Sets children checked state - "smart" mode checks only Compress verdicts, skips disabled
function setChildrenCheckedSmart(tbody, parentIdx, parentLevel, mode) {
    const allRows = [...tbody.querySelectorAll("tr")];
    for (let i = parentIdx + 1; i < allRows.length; i++) {
        const rowLevel = parseInt([...allRows[i].classList].find(c => c.startsWith("level-"))?.replace("level-", "") || "0");
        if (rowLevel <= parentLevel) break;
        const cb = allRows[i].querySelector(".tree-checkbox");
        if (!cb || cb.disabled) continue;
        if (mode === "smart") {
            // Only check leaf rows with Compress verdict; folder rows handled by syncParentCheckboxes
            if (allRows[i].dataset.path) {
                cb.checked = allRows[i].style.opacity !== "0.45";
            }
        } else {
            cb.checked = false;
        }
    }
}

function setChildrenChecked(tbody, parentIdx, parentLevel, checked) {
    const allRows = [...tbody.querySelectorAll("tr")];
    for (let i = parentIdx + 1; i < allRows.length; i++) {
        const rowLevel = [...allRows[i].classList]
            .find(c => c.startsWith("level-"))?.replace("level-", "");
        if (parseInt(rowLevel) <= parentLevel) break;
        const cb = allRows[i].querySelector(".tree-checkbox");
        if (cb) cb.checked = checked;
    }
}

function updateCompressionSummary() {
    const tbody = document.getElementById("compressionTreeBody");
    if (!tbody) return;
    const allRows = [...tbody.querySelectorAll("tr")];

    const leafRowsForSize = allRows.filter(row => {
        const cb = row.querySelector(".tree-checkbox");
        return cb && cb.checked && row.dataset.path;
    });

    let origMB = 0, estMB = 0;
    const folders = new Set();

    for (const row of leafRowsForSize) {
        const sizeText = row.querySelector(".tree-td-size")?.textContent || "";

        const parseMBfromText = t => {
            t = t.trim();
            const n = parseFloat(t);
            if (t.includes("TB")) return n * 1024 * 1024;
            if (t.includes("GB")) return n * 1024;
            return n;
        };

        const parts = sizeText.split("→").map(s => s.trim());
        if (parts.length === 2) {
            origMB += parseMBfromText(parts[0]);
            estMB  += parseMBfromText(parts[1].replace(/\(.*\)/, "").trim());
        } else {
            // Skip row - orig only
            origMB += parseMBfromText(sizeText.replace(/-.*/, "").trim());
            estMB  += parseMBfromText(sizeText.replace(/-.*/, "").trim());
        }

        const idx = allRows.indexOf(row);
        for (let i = idx - 1; i >= 0; i--) {
            const lvl = parseInt([...allRows[i].classList].find(c => c.startsWith("level-"))?.replace("level-", "") || "99");
            if (lvl === 2) {
                folders.add(allRows[i].querySelector(".tree-name")?.textContent);
                break;
            }
        }
    }

    const savedMB  = origMB - estMB;
    const savedPct = origMB > 0 ? ((savedMB / origMB) * 100).toFixed(1) : 0;

    document.getElementById("sumShows").textContent    = folders.size.toLocaleString();
    document.getElementById("sumEpisodes").textContent = leafRowsForSize.length.toLocaleString();
    document.getElementById("sumBefore").textContent   = formatMB(origMB);
    document.getElementById("sumAfter").textContent    = formatMB(estMB);
    document.getElementById("sumSaved").textContent    = `${formatMB(savedMB)} (${savedPct}%)`;
}

function syncParentCheckboxes(tbody) {
    const allRows = [...tbody.querySelectorAll("tr")];

    for (let i = allRows.length - 1; i >= 0; i--) {
        const row = allRows[i];
        if (row.dataset.path) continue; // skip leaf rows

        const level = parseInt([...row.classList].find(c => c.startsWith("level-"))?.replace("level-", "") || "0");

        // Find ALL descendant leaf rows
        const descLeaves = [];
        for (let j = i + 1; j < allRows.length; j++) {
            const childLevel = parseInt([...allRows[j].classList].find(c => c.startsWith("level-"))?.replace("level-", "") || "0");
            if (childLevel <= level) break;
            if (allRows[j].dataset.path) descLeaves.push(allRows[j]);
        }

        if (descLeaves.length === 0) continue;

        const cb = row.querySelector(".tree-checkbox");
        if (!cb) continue;

        const checkedCount = descLeaves.filter(r => r.querySelector(".tree-checkbox")?.checked).length;
        cb.checked = checkedCount === descLeaves.length;
        cb.indeterminate = checkedCount > 0 && checkedCount < descLeaves.length;

        // Live "selected of available" count beside the folder name.
        // Available = eligible leaves (skips have disabled checkboxes, so excluded).
        const eligibleCount = descLeaves.filter(r => !r.querySelector(".tree-checkbox")?.disabled).length;
        const countEl = row.querySelector(".tree-count");
        if (countEl) countEl.textContent = eligibleCount > 0 ? ` (${checkedCount} of ${eligibleCount})` : "";
    }
}

/* ------------------------[ Smart Compression Review: Filter ]---------------------- */

let _filterDebounce = null;
function _debounceFilter() {
    clearTimeout(_filterDebounce);
    _filterDebounce = setTimeout(applyCompressionFilter, 250);
}

function _readFilterNum(id, min, max) {
    const raw = document.getElementById(id).value.trim();
    if (raw === "") return null;             // blank = no limit
    const n = parseInt(raw, 10);
    if (isNaN(n)) return null;
    return Math.max(min, Math.min(max, n));  // clamp to range
}

function _clampFilterBox(el) {
    const raw = el.value.trim();
    if (raw === "") return;
    const n = parseInt(raw, 10);
    if (isNaN(n)) { el.value = ""; return; }
    el.value = Math.max(parseInt(el.min, 10), Math.min(parseInt(el.max, 10), n));
}

function _stepFilterNum(id, dir) {
    const el = document.getElementById(id);
    const step = parseInt(el.step, 10) || 1;
    const min = parseInt(el.min, 10);
    const max = parseInt(el.max, 10);
    let cur = parseInt(el.value, 10);
    if (isNaN(cur)) { el.value = (dir > 0 ? min : min); applyCompressionFilter(); return; }  // blank: first click lands on min
    el.value = Math.max(min, Math.min(max, cur + dir * step));
    applyCompressionFilter();
}

function _onCapModeChange() {
    const mode  = document.getElementById("filterCapMode").value;
    const field = document.getElementById("filterCapField");
    const unit  = document.getElementById("filterCapUnit");
    const box   = document.getElementById("filterCapValue");
    field.classList.toggle("hidden", mode === "none");
    if (mode === "topn")    { unit.textContent = "files"; box.min = 10; box.step = 10; }
    if (mode === "reclaim") { unit.textContent = "GB";    box.min = 10; box.step = 10; }
    if (mode === "fit")     { unit.textContent = "GB";    box.min = 10; box.step = 10; }
    applyCompressionFilter();
}

function _filterLeafMatches(row, st) {
    if (st.minMB  !== null && (parseFloat(row.dataset.savedmb)  || 0) < st.minMB)  return false;
    if (st.minPct !== null && (parseFloat(row.dataset.savedpct) || 0) < st.minPct) return false;

    if (!st.confDisabled) {
        const c = row.dataset.confidence;
        if (c === "High"   && !st.cHigh) return false;
        if (c === "Medium" && !st.cMed)  return false;
        if (c === "Low"    && !st.cLow)  return false;
    }

    if (st.r720 || st.r1080 || st.r4k) {
        const w = parseInt(row.dataset.width, 10) || 0;
        const match = (st.r720  && w <= 1280) ||
                      (st.r1080 && w >= 1281 && w <= 2560) ||
                      (st.r4k   && w >= 2561);
        if (!match) return false;
    }
    return true;
}

function applyCompressionFilter() {
    const tbody = document.getElementById("compressionTreeBody");
    if (!tbody) return;

    // Read control state once (avoids thousands of lookups on large libraries)
    const st = {
        confDisabled: document.getElementById("filterConfHigh").disabled,
        cHigh:  document.getElementById("filterConfHigh").checked,
        cMed:   document.getElementById("filterConfMedium").checked,
        cLow:   document.getElementById("filterConfLow").checked,
        r720:   document.getElementById("filterRes720").checked,
        r1080:  document.getElementById("filterRes1080").checked,
        r4k:    document.getElementById("filterRes4k").checked,
        minMB:  _readFilterNum("filterMinMB", 1, 9999),
        minPct: _readFilterNum("filterMinPct", 10, 95)
    };

    // Pass 1 - predicate filters decide the eligible pool
    const eligible = [];
    for (const row of tbody.querySelectorAll("tr[data-path]")) {
        const cb = row.querySelector(".tree-checkbox");
        if (!cb || cb.disabled) continue;          // Skip-verdict rows stay unchecked
        if (_filterLeafMatches(row, st)) {
            cb.checked = true;
            eligible.push(row);
        } else {
            cb.checked = false;
        }
    }

    // Pass 2 - cap trims the eligible pool, biggest savers first
    const capMode = document.getElementById("filterCapMode").value;
    if (capMode !== "none") {
        const capVal = _readFilterNum("filterCapValue", 10, 99999);
        if (capVal !== null) {
            eligible.sort((a, b) => (parseFloat(b.dataset.savedmb) || 0) - (parseFloat(a.dataset.savedmb) || 0));
            if (capMode === "topn") {
                console.log("capVal =", capVal, "eligible =", eligible.length);
                eligible.slice(capVal).forEach(row => row.querySelector(".tree-checkbox").checked = false);
            } else if (capMode === "reclaim") {
                const targetMB = capVal * 1024;            // GB -> MB
                let acc = 0, met = false;
                for (const row of eligible) {
                    if (met) { row.querySelector(".tree-checkbox").checked = false; continue; }
                    acc += parseFloat(row.dataset.savedmb) || 0;
                    if (acc >= targetMB) met = true;       // include the file that crosses the line
                }
            } else if (capMode === "fit") {
                const budgetMB = capVal * 1024;            // GB -> MB
                let acc = 0;
                for (const row of eligible) {
                    const out = parseFloat(row.dataset.estmb) || 0;
                    if (acc + out > budgetMB) { row.querySelector(".tree-checkbox").checked = false; continue; }
                    acc += out;                            // stop before crossing the line
                }
            }
        }
    }

    // Pass 3 - sticky manual overrides survive filter/cap changes
    const manual = window._manualSelections || {};
    for (const row of tbody.querySelectorAll("tr[data-path]")) {
        const cb = row.querySelector(".tree-checkbox");
        if (!cb || cb.disabled) continue;
        const m = manual[row.dataset.path];
        if (m === 0) cb.checked = false;
        else if (m === 1) cb.checked = true;
    }

    syncParentCheckboxes(tbody);
    updateCompressionSummary();
    saveCompressionSelections();
}

function resetCompressionFilter() {
    ["filterConfHigh", "filterConfMedium", "filterConfLow"].forEach(id => {
        const el = document.getElementById(id);
        if (!el.disabled) el.checked = true;
    });
    document.getElementById("filterMinMB").value = "";
    document.getElementById("filterMinPct").value = "";
    ["filterRes720", "filterRes1080", "filterRes4k"].forEach(id => document.getElementById(id).checked = true);
    document.getElementById("filterCapMode").value = "none";
    document.getElementById("filterCapValue").value = "";
    _onCapModeChange();
}

function resetCompressionCheckboxes() {
    window._manualSelections = {};   // drop hand-picked deviations; keep the active filter
    applyCompressionFilter();        // re-derive selection from the filter alone (Pass 3 now no-ops)
}

function initCompressionFilter() {
    const tbody = document.getElementById("compressionTreeBody");
    if (!tbody) return;

    // Confidence only varies under an accurate probe (fast probes return "High" for
    // everything). Enable the boxes only if Medium/Low values exist; else grey out + note.
    const confs = [...tbody.querySelectorAll("tr[data-path]")].map(r => r.dataset.confidence);
    const hasVariance = confs.some(c => c === "Medium" || c === "Low");
    ["filterConfHigh", "filterConfMedium", "filterConfLow"].forEach(id => {
        const el = document.getElementById(id);
        el.disabled = !hasVariance;
        el.checked = true;
    });
    document.getElementById("filterConfCol").classList.toggle("tip-disabled", !hasVariance);

    if (window._filterWired) return;             // attach listeners once
    window._filterWired = true;

    ["filterConfHigh", "filterConfMedium", "filterConfLow"].forEach(id =>
        document.getElementById(id).addEventListener("change", applyCompressionFilter));
    ["filterRes720", "filterRes1080", "filterRes4k"].forEach(id =>
        document.getElementById(id).addEventListener("change", applyCompressionFilter));
    ["filterMinMB", "filterMinPct"].forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener("input", _debounceFilter);              // debounced typed entry
        el.addEventListener("blur", () => _clampFilterBox(el));
    });
	document.querySelectorAll(".num-step").forEach(btn =>
        btn.addEventListener("click", () => _stepFilterNum(btn.dataset.target, btn.classList.contains("num-up") ? 1 : -1)));
	document.getElementById("filterCapMode").addEventListener("change", _onCapModeChange);
    document.getElementById("filterCapValue").addEventListener("input", _debounceFilter);
    document.getElementById("filterCapValue").addEventListener("blur", () => _clampFilterBox(document.getElementById("filterCapValue")));
    document.getElementById("filterReset").addEventListener("click", resetCompressionFilter);
	document.getElementById("filterResetChecks").addEventListener("click", resetCompressionCheckboxes);
}

function initColumnResize() {
    const th = document.querySelector(".tree-th-name");
    const col = document.getElementById("colName");
    const resizer = document.getElementById("nameResizer");
    if (!th || !resizer) return;

    let startX, startW;

    resizer.addEventListener("mousedown", e => {
        startX = e.clientX;
        startW = th.getBoundingClientRect().width;
        resizer.classList.add("resizing");
        document.body.classList.add("no-select");

        const onMove = e => {
            const wrapper = document.querySelector(".compression-tree-wrapper");
            const verdictW = document.querySelector(".tree-th-verdict").getBoundingClientRect().width;
            const maxW = wrapper.getBoundingClientRect().width - 200 - verdictW - 40;
            const newW = Math.max(120, Math.min(maxW, startW + (e.clientX - startX)));
            col.style.width = newW + "px";
        };

        const onUp = () => {
            resizer.classList.remove("resizing");
            document.body.classList.remove("no-select");
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        e.stopPropagation();
        e.preventDefault();
    });

    // ---- Verdict column: right edge pinned to the table; Name absorbs the change ----
    const vth      = document.querySelector(".tree-th-verdict");
    const vcol     = document.getElementById("colVerdict");
    const vResizer = document.getElementById("verdictResizer");
    if (vth && vcol && vResizer) {
        let vStartX, vStartW;
        vResizer.addEventListener("mousedown", e => {
            vStartX = e.clientX;
            vStartW = vth.getBoundingClientRect().width;
            vResizer.classList.add("resizing");
            document.body.classList.add("no-select");

            const onMove = e => {
                const wrapper = document.querySelector(".compression-tree-wrapper");
                const budget  = wrapper.getBoundingClientRect().width - 40;   // Size(200) + Name + Verdict
                const maxVerdictW = budget - 200 - 120;                       // keep Name >= 120
                // Drag left = wider Verdict; Name shrinks to compensate so the right edge stays put.
                const newVerdictW = Math.max(100, Math.min(maxVerdictW, vStartW + (vStartX - e.clientX)));
                vcol.style.width = newVerdictW + "px";
                col.style.width  = (budget - 200 - newVerdictW) + "px";
            };

            const onUp = () => {
                vResizer.classList.remove("resizing");
                document.body.classList.remove("no-select");
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
            };

            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
            e.stopPropagation();
            e.preventDefault();
        });
    }
}

async function showCompressionModal() {
	const modal   = document.getElementById("compressionModal");
    const tree    = document.getElementById("compressionTree");
    const summary = document.getElementById("compressionSummary");

	document.getElementById("compressWorkerCount").value = 2;
	document.getElementById("compressWorkerValue").textContent = 2;
	document.getElementById("compressWorkerDesc").textContent = getCompressWorkerDesc(2);

	// Mirror the current GPU toggle state into the modal
	const mainGpu  = document.getElementById("useGPU");
	const modalGpu = document.getElementById("compressUseGPU");
	if (mainGpu && modalGpu) modalGpu.checked = mainGpu.checked;
	updateGpuToggleState();
	updateGpuStatus();
	
    if (!modal || !tree || !summary) {
        console.error("Compression modal elements not found", { modal, tree, summary });
        return;
    }
    // Fetch SmartProbe entries
    const data = await apiLogSearch("SmartProbe", 999999);
    const entries = (data.entries || []).filter(e => e.Type === "SmartProbe");

    if (entries.length === 0) return;

    const root = buildTreeData(entries);
	
	const savedSelections = await loadCompressionSelections();
	
	const tbody = document.getElementById("compressionTreeBody");
	expandedNodes.clear();
    tbody.innerHTML = "";
    renderTree(root, 0, tbody, null);
    window._compressionSelections = {};   // empty cache so the initial expand doesn't reapply stale state

    // Expand only the root ("All Media"); Movies/Shows start collapsed
    const firstToggle = tbody.querySelector(".tree-toggle");
    if (firstToggle) {
        firstToggle.click();
    }

    // Summary HTML (full totals as baseline)
    const folderCount = Object.values(root.children).reduce((total, topLevel) => {
        return total + Object.keys(topLevel.children).length;
    }, 0);
    const fileCount   = entries.filter(e => e.Type === "SmartProbe").length;
    const compressCount = entries.filter(e => e.Type === "SmartProbe" && e.Verdict === "Compress").length;
    const savedMB     = root.origMB - root.estMB;
    const savedPct    = root.origMB > 0 ? ((savedMB / root.origMB) * 100).toFixed(1) : 0;
    summary.innerHTML = `
        <div class="summary-grid">
            <span class="summary-label">Number of Folders:</span>
            <span class="summary-value" id="sumShows">${folderCount.toLocaleString()}</span>
            <span class="summary-label">Number of Files:</span>
            <span class="summary-value" id="sumEpisodes">${fileCount.toLocaleString()}</span>
            <span class="summary-label">To Compress:</span>
            <span class="summary-value">${compressCount.toLocaleString()} / ${fileCount.toLocaleString()}</span>
            <span class="summary-label">Size Before:</span>
            <span class="summary-value" id="sumBefore">${formatMB(root.origMB)}</span>
            <span class="summary-label">Size After:</span>
            <span class="summary-value" id="sumAfter">${formatMB(root.estMB)}</span>
            <span class="summary-label">Total Saved:</span>
            <span class="summary-value summary-saved" id="sumSaved">${formatMB(savedMB)} (${savedPct}%)</span>
        </div>
    `;

	// Manual deviations are restored after initCompressionFilter (below), so the
    // confidence data-gate doesn't clobber the saved filter boxes.
    window._manualSelections = (savedSelections && savedSelections.manual && typeof savedSelections.manual === "object")
        ? { ...savedSelections.manual } : {};

	const savedOutput = await fetch("/config").then(r => r.json());
    if (savedOutput.ok && savedOutput.config.CompressionOutputPath) {
        document.getElementById("compressionOutputPath").value = savedOutput.config.CompressionOutputPath;
    }
	
    modal.classList.remove("hidden");
    initColumnResize();
    initCompressionFilter();

    // Restore saved filter config; this runs the filter, which re-applies sticky manual picks.
    if (savedSelections && savedSelections.filter) {
        _applyFilterConfig(savedSelections.filter);
    } else {
        applyCompressionFilter();
    }
}

document.getElementById("compressionClose").addEventListener("click", () => {
    document.getElementById("compressionModal").classList.add("hidden");
    compressionModalDismissed = true;
});

document.getElementById("compressionBrowse").addEventListener("click", async () => {
    const result = await apiBrowseFolder();
    if (result.ok) {
        document.getElementById("compressionOutputPath").value = result.path;
    }
});

document.getElementById("compressionStart").addEventListener("click", async () => {
    const outputPath = document.getElementById("compressionOutputPath").value.trim();
	if (!outputPath) {
        showError("Please select a Compression Root before compressing.");
        return;
    }

    // Collect checked leaf paths from tree
    const tbody = document.getElementById("compressionTreeBody");
    const allRows = [...tbody.querySelectorAll("tr")];
    const selectedPaths = allRows
        .filter(row => {
            const cb = row.querySelector(".tree-checkbox");
            const level = parseInt([...row.classList].find(c => c.startsWith("level-"))?.replace("level-", "") || "0");
            return cb && cb.checked && level === 3;
        })
        .map(row => row.dataset.path)
        .filter(Boolean);

    if (selectedPaths.length === 0) {
        alert("No files selected for compression.");
        return;
    }

    // Check available disk space
    const estMBText = document.getElementById("sumAfter").textContent;
    const parseSize = t => {
        const n = parseFloat(t);
        if (t.includes("TB")) return n * 1024 * 1024;
        if (t.includes("GB")) return n * 1024;
        return n;
    };
    const neededMB = parseSize(estMBText);   // probe-calculated estimated output size
    const spaceRes = await fetch(`/disk-space?path=${encodeURIComponent(outputPath)}`);
    const spaceData = await spaceRes.json();
    if (spaceData.ok && spaceData.freeMB < neededMB) {
        const additionalMB = neededMB - spaceData.freeMB;
        showError(`Not enough available space at the given location.\nNeeded: ${formatMB(neededMB)}\nAvailable: ${formatMB(spaceData.freeMB)}\nAdditional: ${formatMB(additionalMB)}`);
        return;
    }

    // Send to server
	const res = await fetch("/compress/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			outputPath,
			paths: selectedPaths,
			crf: parseInt(document.getElementById("crfSlider").value) || 22,
			sourceRoot: document.getElementById("rootPath").value.trim(),
			workers: parseInt(document.getElementById("compressWorkerCount").value) || 2,
			useGPU: document.getElementById("compressUseGPU").checked
		})
    });
    const result = await res.json();
    if (!result.ok) {
        showError(result.error || "Could not start compression. Check your settings and try again.");
        return;
    }

    document.getElementById("compressionModal").classList.add("hidden");
    compressionModalDismissed = true;
});

document.getElementById("reviewBtn").addEventListener("click", () => {
    if (document.getElementById("reviewBtn").classList.contains("disabled-ui")) return;
    compressionModalDismissed = false;
    showCompressionModal();
});

/* ------------------------[        Unified poller (single)     ]------------------------ */

let lastKnownTotal  = 0;
let lastReviewTotal = -1;
let unifiedPollBusy = false;

// Only touches the log pane when the cached total actually changed.
// Returns true if it applied an update, false if it bailed on a guard.
async function syncLiveLogFromTotal(newTotal) {
    if (!logOpen || isScrollFetching || scrollLocked) return false;

    if (logFilterText) {
        const data = await apiLogSearch(logFilterText, 500);
        currentEntries = data.entries || [];
        fullLogLength  = data.total || 0;
        logSpacer.style.height = "0px";
        logContent.style.top   = "0px";
        renderLogFile(currentEntries);
        document.getElementById("logFilterCount").textContent = `${fmtNum(data.matched)} matches`;
        return true;
    }

    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return false;

    const shouldAutoScroll = logAutoScroll;
    fullLogLength = newTotal;
    if (shouldAutoScroll) {
        windowEnd   = fullLogLength;
        windowStart = Math.max(0, fullLogLength - 200);
    }

    const data = await apiLoadLogSlice(windowStart, windowEnd);
    if (data.total > 0) {
        fullLogLength = data.total;
        if (data.entries.length !== currentEntries.length ||
            data.entries[data.entries.length - 1]?.Timestamp !== currentEntries[currentEntries.length - 1]?.Timestamp) {
            currentEntries = data.entries;
            logSpacer.style.height = "0px";
            logContent.style.top   = "0px";
            renderLogFile(currentEntries);
        }
    } else if (fullLogLength === 0) {
        logContent.textContent = "No logs found";
        logSpacer.style.height = "0px";
        logContent.style.top   = "0px";
    }

    if (shouldAutoScroll) {
        requestAnimationFrame(() => { logViewer.scrollTop = logViewer.scrollHeight; });
    }
    return true;
}

async function unifiedPoll() {
    if (unifiedPollBusy) return;          // never overlap — prevents request pile-up
    unifiedPollBusy = true;
    try {
        const res  = await fetch("/status-all");
        const data = await res.json();

        // --- Run state + badge (was the /status poller) ---
        const runState = data.runState || "idle";
        const badge = document.getElementById("statusBadge");
        badge.textContent = runState.charAt(0).toUpperCase() + runState.slice(1);

        setUIRunningState(runState === "running");
        applyModeRules();
        updateClearLogsBtn();

        if (runState === "completed" &&
            document.querySelector("input[name='mode']:checked")?.value === "SmartCompression" &&
            !compressionModalDismissed &&
            document.getElementById("compressionModal").classList.contains("hidden")) {
            showCompressionModal();
        }

        if (runState === "running") {
            badge.classList.remove("idle");
            badge.classList.add("running");
        } else {
            badge.classList.remove("running");
            badge.classList.add("idle");
            document.getElementById("startBtn").classList.remove("running");
            currentPhase       = "none";
            lastRepairStatus   = null;
            lastRepairUpdateAt = null;
        }

        // --- Console (was the /status-console + /status-all pollers) ---
        renderStatusBlock(data);

        // --- Review button: refresh only when the total changes (far fewer searches) ---
        if (data.logTotal !== undefined && data.logTotal !== lastReviewTotal) {
            lastReviewTotal = data.logTotal;
            updateReviewButton();
        }

        // --- Live log (was pollLiveLog): fetch a slice only when the total changed ---
        if (data.logTotal !== undefined && data.logTotal !== lastKnownTotal) {
            const applied = await syncLiveLogFromTotal(data.logTotal);
            if (applied) lastKnownTotal = data.logTotal;
        }
    } catch (e) {
        // transient — the next tick retries
    } finally {
        unifiedPollBusy = false;
    }
}

setInterval(unifiedPoll, 500);
unifiedPoll();