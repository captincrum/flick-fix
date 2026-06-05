const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:17863';

// ================================================================
// HELPERS
// ================================================================
const fs = require('fs');
const path = require('path');

// Adjust if ui_spec.js doesn't sit next to the Logs/ folder.
const UNIFIED_LOG = path.resolve(__dirname, '..', 'Logs', 'UnifiedLog.json');

// 10 Compress + 2 Skip, across 2 shows / 3 seasons. Each row is tagged with
// what it exercises so future assertions are obvious.
const PROBE_FIXTURE = [
  // Alpha Series / Season 01
  { Type:"SmartProbe", Path:"T:\\Media\\Alpha Series\\Season 01\\Alpha S01E01.mkv", Verdict:"Compress", Confidence:"High",   Width:1920, OriginalMB:3300, EstimatedMB:900,  SavedMB:2400, SavedPct:72.7 }, // High · 1080p · biggest saver
  { Type:"SmartProbe", Path:"T:\\Media\\Alpha Series\\Season 01\\Alpha S01E02.mkv", Verdict:"Compress", Confidence:"Medium", Width:1920, OriginalMB:2700, EstimatedMB:1200, SavedMB:1500, SavedPct:55.6 }, // Medium · 1080p
  { Type:"SmartProbe", Path:"T:\\Media\\Alpha Series\\Season 01\\Alpha S01E03.mkv", Verdict:"Compress", Confidence:"Low",    Width:1280, OriginalMB:860,  EstimatedMB:560,  SavedMB:300,  SavedPct:34.9 }, // Low · ≤720p bucket (1280)
  { Type:"SmartProbe", Path:"T:\\Media\\Alpha Series\\Season 01\\Alpha S01E04.mkv", Verdict:"Compress", Confidence:"High",   Width:3840, OriginalMB:5000, EstimatedMB:2000, SavedMB:3000, SavedPct:60.0 }, // High · 4K · top saver
  { Type:"SmartProbe", Path:"T:\\Media\\Alpha Series\\Season 01\\Alpha S01E05.mkv", Verdict:"Skip",     Confidence:"N/A",    Width:1920, OriginalMB:1800, EstimatedMB:1800, SavedMB:0,    SavedPct:0,  SkipReason:"AlreadyModernCodec", Codec:"hevc" }, // SKIP (already HEVC)

  // Beta Show / Season 01
  { Type:"SmartProbe", Path:"T:\\Media\\Beta Show\\Season 01\\Beta S01E01.mkv",     Verdict:"Compress", Confidence:"High",   Width:720,  OriginalMB:660,  EstimatedMB:540,  SavedMB:120,  SavedPct:18.2 }, // High · ≤720p (true 720) · smallest saver
  { Type:"SmartProbe", Path:"T:\\Media\\Beta Show\\Season 01\\Beta S01E02.mkv",     Verdict:"Compress", Confidence:"Medium", Width:4096, OriginalMB:2000, EstimatedMB:1100, SavedMB:900,  SavedPct:45.0 }, // Medium · 4K
  { Type:"SmartProbe", Path:"T:\\Media\\Beta Show\\Season 01\\Beta S01E03.mkv",     Verdict:"Compress", Confidence:"Low",    Width:2560, OriginalMB:1500, EstimatedMB:900,  SavedMB:600,  SavedPct:40.0 }, // Low · 1080p top edge (2560)
  { Type:"SmartProbe", Path:"T:\\Media\\Beta Show\\Season 01\\Beta S01E04.mkv",     Verdict:"Skip",     Confidence:"N/A",    Width:1280, OriginalMB:500,  EstimatedMB:480,  SavedMB:20,   SavedPct:4.0, SkipReason:"SavingsBelowThreshold" }, // SKIP (<10%)

  // Beta Show / Season 02  (second season -> tests multi-season folder counts)
  { Type:"SmartProbe", Path:"T:\\Media\\Beta Show\\Season 02\\Beta S02E01.mkv",     Verdict:"Compress", Confidence:"High",   Width:1920, OriginalMB:3600, EstimatedMB:1800, SavedMB:1800, SavedPct:50.0 }, // High · 1080p
  { Type:"SmartProbe", Path:"T:\\Media\\Beta Show\\Season 02\\Beta S02E02.mkv",     Verdict:"Compress", Confidence:"Medium", Width:1024, OriginalMB:1500, EstimatedMB:1050, SavedMB:450,  SavedPct:30.0 }, // Medium · ≤720p (1024)
  { Type:"SmartProbe", Path:"T:\\Media\\Beta Show\\Season 02\\Beta S02E03.mkv",     Verdict:"Compress", Confidence:"Low",    Width:7680, OriginalMB:3600, EstimatedMB:1500, SavedMB:2100, SavedPct:58.3 }, // Low · 8K -> proves it lands in ≥4K
];

// Dedicated to cap-mode tests: 12 eligible + 1 skip. savedMB descending and
// distinct so the cap boundaries are exact and each mode yields a DIFFERENT count.
//  - Top savers (min 10) -> keeps 10 of 12
//  - Total saved 10 GB   -> 3+2.5+2+1.5+1 GB = exactly 10 GB at the 5th row -> 5
//  - Size after 10 GB    -> est 1400 MB each; 7 fit under 10 GB (9800), 8th overflows -> 7
const CAP_FIXTURE = [
  { Type:"SmartProbe", Path:"T:\\Media\\Cap Show\\Season 01\\Cap S01E01.mkv", Verdict:"Compress", Confidence:"High", Width:1920, OriginalMB:4472, EstimatedMB:1400, SavedMB:3072, SavedPct:68.7 },
  { Type:"SmartProbe", Path:"T:\\Media\\Cap Show\\Season 01\\Cap S01E02.mkv", Verdict:"Compress", Confidence:"High", Width:1920, OriginalMB:3960, EstimatedMB:1400, SavedMB:2560, SavedPct:64.6 },
  { Type:"SmartProbe", Path:"T:\\Media\\Cap Show\\Season 01\\Cap S01E03.mkv", Verdict:"Compress", Confidence:"High", Width:1920, OriginalMB:3448, EstimatedMB:1400, SavedMB:2048, SavedPct:59.4 },
  { Type:"SmartProbe", Path:"T:\\Media\\Cap Show\\Season 01\\Cap S01E04.mkv", Verdict:"Compress", Confidence:"High", Width:1920, OriginalMB:2936, EstimatedMB:1400, SavedMB:1536, SavedPct:52.3 },
  { Type:"SmartProbe", Path:"T:\\Media\\Cap Show\\Season 01\\Cap S01E05.mkv", Verdict:"Compress", Confidence:"High", Width:1920, OriginalMB:2424, EstimatedMB:1400, SavedMB:1024, SavedPct:42.2 },
  { Type:"SmartProbe", Path:"T:\\Media\\Cap Show\\Season 01\\Cap S01E06.mkv", Verdict:"Compress", Confidence:"High", Width:1920, OriginalMB:2296, EstimatedMB:1400, SavedMB:896,  SavedPct:39.0 },
  { Type:"SmartProbe", Path:"T:\\Media\\Cap Show\\Season 01\\Cap S01E07.mkv", Verdict:"Compress", Confidence:"High", Width:1920, OriginalMB:2168, EstimatedMB:1400, SavedMB:768,  SavedPct:35.4 },
  { Type:"SmartProbe", Path:"T:\\Media\\Cap Show\\Season 01\\Cap S01E08.mkv", Verdict:"Compress", Confidence:"High", Width:1920, OriginalMB:2040, EstimatedMB:1400, SavedMB:640,  SavedPct:31.4 },
  { Type:"SmartProbe", Path:"T:\\Media\\Cap Show\\Season 01\\Cap S01E09.mkv", Verdict:"Compress", Confidence:"High", Width:1920, OriginalMB:1912, EstimatedMB:1400, SavedMB:512,  SavedPct:26.8 },
  { Type:"SmartProbe", Path:"T:\\Media\\Cap Show\\Season 01\\Cap S01E10.mkv", Verdict:"Compress", Confidence:"High", Width:1920, OriginalMB:1784, EstimatedMB:1400, SavedMB:384,  SavedPct:21.5 },
  { Type:"SmartProbe", Path:"T:\\Media\\Cap Show\\Season 01\\Cap S01E11.mkv", Verdict:"Compress", Confidence:"High", Width:1920, OriginalMB:1656, EstimatedMB:1400, SavedMB:256,  SavedPct:15.5 },
  { Type:"SmartProbe", Path:"T:\\Media\\Cap Show\\Season 01\\Cap S01E12.mkv", Verdict:"Compress", Confidence:"High", Width:1920, OriginalMB:1528, EstimatedMB:1400, SavedMB:128,  SavedPct:8.4 },
  { Type:"SmartProbe", Path:"T:\\Media\\Cap Show\\Season 01\\Cap S01E13.mkv", Verdict:"Skip", Confidence:"N/A", Width:1920, OriginalMB:800, EstimatedMB:800, SavedMB:0, SavedPct:0, SkipReason:"AlreadyModernCodec", Codec:"hevc" },
];

// Write the fixture to the live log and wait for the server's cache to pick it up.
async function seedProbeLog(page, entries) {
  await page.request.get(`${BASE_URL}/logs/clear`);            // empty file + cache
  fs.mkdirSync(path.dirname(UNIFIED_LOG), { recursive: true }); // ensure Logs/ exists
  fs.writeFileSync(UNIFIED_LOG, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  // Update-LogCache debounces ~1s; poll /logs/total until it reflects our rows.
  await expect.poll(async () => {
    const r = await page.request.get(`${BASE_URL}/logs/total`);
    return (await r.json()).total;
  }, { timeout: 6000, intervals: [300, 400, 600, 800, 1000] }).toBe(entries.length);
}

async function openReview(page) {
  await selectMode(page, 'SmartCompression');
  await expect(page.locator('#reviewBtn')).not.toHaveClass(/disabled-ui/, { timeout: 6000 });
  await page.locator('#reviewBtn').click();
  await expect(page.locator('#compressionModal')).toBeVisible();
}

// Shows start collapsed; open every visible ▶ toggle until the whole tree is expanded.
async function expandAll(page) {
  for (let guard = 0; guard < 50; guard++) {
    const toggle = page.locator('#compressionTreeBody .tree-toggle:visible', { hasText: '▶' }).first();
    if (await toggle.count() === 0) break;
    await toggle.click();
  }
}

// A leaf row's checkbox, located by its file name.
const leafCb = (page, fileName) =>
  page.locator('#compressionTreeBody tr', { has: page.locator('.tree-name', { hasText: fileName }) })
      .locator('.tree-checkbox');
	  
async function resetConfig(page) {
    await page.request.get(`${BASE_URL}/config/save?root=&repaired=&mode=Full&scanAll=false&accurateMode=false`);
    await page.goto(BASE_URL);
    await page.waitForFunction(() => {
        const desc = document.getElementById('scanModeDesc');
        return desc && desc.textContent.includes('First episode');
    });
}

async function selectMode(page, mode) {
    await page.locator(`input[value="${mode}"]`).click();
}

// A folder row's "(x of y)" count, located by the folder name.
const folderCount = (page, name) =>
  page.locator('#compressionTreeBody tr', { has: page.locator('.tree-name', { hasText: name }) })
      .locator('.tree-count');
	  
// ================================================================
// SUITE 1: Page Load
// ================================================================
test.describe('Page Load', () => {

    test.beforeEach(async ({ page }) => { await resetConfig(page); });

    test('Page title is FlickFix', async ({ page }) => {
        await expect(page).toHaveTitle('FlickFix');
    });

    test('Header displays FlickFix', async ({ page }) => {
        await expect(page.locator('h1')).toHaveText('FlickFix');
    });

    test('Status badge is visible and shows a valid state', async ({ page }) => {
        const badge = page.locator('#statusBadge');
        await expect(badge).toBeVisible();
        const text = await badge.textContent();
        expect(['Idle', 'Running', 'Completed']).toContain(text.trim());
    });

    test('Console element is visible', async ({ page }) => {
        await expect(page.locator('#consoleOutput')).toBeVisible();
    });

    test('Scan & Repair is selected after config reset', async ({ page }) => {
        await expect(page.locator('input[value="Full"]')).toBeChecked();
    });

    test('Smart Compression panel is hidden after config reset', async ({ page }) => {
        await expect(page.locator('#smartOptions')).toHaveClass(/hidden/);
    });

    test('All four operation mode radios are present', async ({ page }) => {
        await expect(page.locator('input[value="Full"]')).toBeVisible();
        await expect(page.locator('input[value="ScanOnly"]')).toBeVisible();
        await expect(page.locator('input[value="RepairOnly"]')).toBeVisible();
        await expect(page.locator('input[value="SmartCompression"]')).toBeVisible();
    });

});

// ================================================================
// SUITE 2: Settings Panel
// ================================================================
test.describe('Settings Panel', () => {

    test.beforeEach(async ({ page }) => { await resetConfig(page); });

    test('Library Root input is visible and enabled', async ({ page }) => {
        await expect(page.locator('#rootPath')).toBeVisible();
        await expect(page.locator('#rootPath')).toBeEnabled();
    });

    test('Library Root Browse button is visible and enabled', async ({ page }) => {
        await expect(page.locator('#browseRoot')).toBeVisible();
        await expect(page.locator('#browseRoot')).toBeEnabled();
    });

    test('Repaired Output input is visible and enabled', async ({ page }) => {
        await expect(page.locator('#repairedPath')).toBeVisible();
        await expect(page.locator('#repairedPath')).toBeEnabled();
    });

    test('Repaired Output Browse button is visible and enabled', async ({ page }) => {
        await expect(page.locator('#browseRepaired')).toBeVisible();
        await expect(page.locator('#browseRepaired')).toBeEnabled();
    });

    test('Workers slider is visible and enabled', async ({ page }) => {
        await expect(page.locator('#workerCount')).toBeVisible();
        await expect(page.locator('#workerCount')).toBeEnabled();
    });

    test('Workers value label updates when slider moves', async ({ page }) => {
        await page.locator('#workerCount').fill('6');
        await page.locator('#workerCount').dispatchEvent('input');
        await expect(page.locator('#workerValue')).toHaveText('6');
    });

    test('Workers description shows Less CPU intensive at value 1', async ({ page }) => {
        await page.locator('#workerCount').fill('1');
        await page.locator('#workerCount').dispatchEvent('input');
        await expect(page.locator('#workerDesc')).toContainText('Less CPU intensive');
    });

	test('Workers description does NOT show Recommended when not at 4', async ({ page }) => {
        await page.locator('#workerCount').fill('1');
        await page.locator('#workerCount').dispatchEvent('input');
        await expect(page.locator('#workerDesc')).not.toHaveText('Recommended — balance of speed and CPU resources');
    });

    test('Workers description shows More CPU intensive at value 8', async ({ page }) => {
        await page.locator('#workerCount').fill('8');
        await page.locator('#workerCount').dispatchEvent('input');
        await expect(page.locator('#workerDesc')).toContainText('More CPU intensive');
    });

    test('Scan mode toggle shows Quick description when unchecked', async ({ page }) => {
        await page.locator('#scanAllEpisodes').uncheck();
        await expect(page.locator('#scanModeDesc')).toContainText('First episode');
    });

	test('Scan mode description changes when toggled to Full', async ({ page }) => {
        const before = await page.locator('#scanModeDesc').textContent();
        await page.locator('#scanAllEpisodes').evaluate(el => el.click());
        const after = await page.locator('#scanModeDesc').textContent();
        expect(before).not.toBe(after);
    });

    test('Scan mode description changes back when toggled to Quick', async ({ page }) => {
        await page.locator('#scanAllEpisodes').evaluate(el => el.click());
        const before = await page.locator('#scanModeDesc').textContent();
        await page.locator('#scanAllEpisodes').evaluate(el => el.click());
        const after = await page.locator('#scanModeDesc').textContent();
        expect(before).not.toBe(after);
    });

});

// ================================================================
// SUITE 3: Mode — Scan & Repair
// ================================================================
test.describe('Mode: Scan & Repair', () => {

    test.beforeEach(async ({ page }) => {
        await resetConfig(page);
        await selectMode(page, 'Full');
    });

    test('Library Root is enabled', async ({ page }) => {
        await expect(page.locator('#rootPath')).toBeEnabled();
    });

    test('Library Root Browse is enabled', async ({ page }) => {
        await expect(page.locator('#browseRoot')).toBeEnabled();
    });

    test('Repaired Output is enabled', async ({ page }) => {
        await expect(page.locator('#repairedPath')).toBeEnabled();
    });

    test('Repaired Output Browse is enabled', async ({ page }) => {
        await expect(page.locator('#browseRepaired')).toBeEnabled();
    });

    test('Workers slider is enabled', async ({ page }) => {
        await expect(page.locator('#workerCount')).toBeEnabled();
    });

    test('Scan toggle is enabled', async ({ page }) => {
        await expect(page.locator('#scanAllEpisodes')).toBeEnabled();
    });

    test('Start button is enabled', async ({ page }) => {
        await expect(page.locator('#startBtn')).toBeEnabled();
    });

    test('Smart Compression panel is hidden', async ({ page }) => {
        await expect(page.locator('#smartOptions')).toHaveClass(/hidden/);
    });

    test('Start with no root path shows error modal', async ({ page }) => {
        await page.locator('#rootPath').fill('');
        await page.locator('#startBtn').click();
        await expect(page.locator('#errorModal')).toBeVisible();
    });

    test('Start with no repaired path shows error modal', async ({ page }) => {
        await page.locator('#rootPath').fill('C:\\FakePath');
        await page.locator('#repairedPath').fill('');
        await page.locator('#startBtn').click();
        await expect(page.locator('#errorModal')).toBeVisible();
    });

    test('Start with both paths blank shows error mentioning Library Root first', async ({ page }) => {
        await page.locator('#rootPath').fill('');
        await page.locator('#repairedPath').fill('');
        await page.locator('#startBtn').click();
        await expect(page.locator('#errorModal')).toBeVisible();
        await expect(page.locator('#errorMessage')).toContainText('Library Root');
    });

    test('All mode radios are still selectable', async ({ page }) => {
        for (const mode of ['ScanOnly', 'RepairOnly', 'SmartCompression', 'Full']) {
            await page.locator(`input[value="${mode}"]`).click();
            await expect(page.locator(`input[value="${mode}"]`)).toBeChecked();
        }
    });

});

// ================================================================
// SUITE 4: Mode — Scan Only
// ================================================================
test.describe('Mode: Scan Only', () => {

    test.beforeEach(async ({ page }) => {
        await resetConfig(page);
        await selectMode(page, 'ScanOnly');
    });

    test('Library Root is enabled', async ({ page }) => {
        await expect(page.locator('#rootPath')).toBeEnabled();
    });

    test('Library Root Browse is enabled', async ({ page }) => {
        await expect(page.locator('#browseRoot')).toBeEnabled();
    });

    test('Repaired Output is disabled', async ({ page }) => {
        await expect(page.locator('#repairedPath')).toBeDisabled();
    });

    test('Repaired Output Browse is disabled', async ({ page }) => {
        await expect(page.locator('#browseRepaired')).toBeDisabled();
    });

    test('Workers slider is enabled', async ({ page }) => {
        await expect(page.locator('#workerCount')).toBeEnabled();
    });

    test('Scan toggle is enabled', async ({ page }) => {
        await expect(page.locator('#scanAllEpisodes')).toBeEnabled();
    });

    test('Smart Compression panel is hidden', async ({ page }) => {
        await expect(page.locator('#smartOptions')).toHaveClass(/hidden/);
    });

    test('Start with no root path shows error modal', async ({ page }) => {
        await page.locator('#rootPath').fill('');
        await page.locator('#startBtn').click();
        await expect(page.locator('#errorModal')).toBeVisible();
    });

    test('Start with no repaired path proceeds without error modal', async ({ page }) => {
        await page.locator('#rootPath').fill('C:\\FakePath');
        await page.locator('#startBtn').click();
        await expect(page.locator('#errorModal')).toBeHidden();
    });

    test('Start with both paths blank shows error mentioning Library Root', async ({ page }) => {
        await page.locator('#rootPath').fill('');
        await page.locator('#startBtn').click();
        await expect(page.locator('#errorModal')).toBeVisible();
        await expect(page.locator('#errorMessage')).toContainText('Library Root');
    });

});

// ================================================================
// SUITE 5: Mode — Repair Only
// ================================================================
test.describe('Mode: Repair Only', () => {

    test.beforeEach(async ({ page }) => {
        await resetConfig(page);
        await selectMode(page, 'RepairOnly');
    });

    test('Library Root is disabled', async ({ page }) => {
        await expect(page.locator('#rootPath')).toBeDisabled();
    });

    test('Library Root Browse is disabled', async ({ page }) => {
        await expect(page.locator('#browseRoot')).toBeDisabled();
    });

    test('Repaired Output is enabled', async ({ page }) => {
        await expect(page.locator('#repairedPath')).toBeEnabled();
    });

    test('Repaired Output Browse is enabled', async ({ page }) => {
        await expect(page.locator('#browseRepaired')).toBeEnabled();
    });

    test('Workers slider is enabled', async ({ page }) => {
        await expect(page.locator('#workerCount')).toBeEnabled();
    });

    test('Smart Compression panel is hidden', async ({ page }) => {
        await expect(page.locator('#smartOptions')).toHaveClass(/hidden/);
    });

    test('Start with no repaired path shows error modal', async ({ page }) => {
        await page.locator('#repairedPath').fill('');
        await page.locator('#startBtn').click();
        await expect(page.locator('#errorModal')).toBeVisible();
    });

    test('Start with repaired path and no root path proceeds without error modal', async ({ page }) => {
        await page.locator('#repairedPath').fill('C:\\FakePath');
        await page.locator('#startBtn').click();
        await expect(page.locator('#errorModal')).toBeHidden();
    });

    test('Start with both paths blank shows error mentioning Repaired Output', async ({ page }) => {
        await page.locator('#repairedPath').fill('');
        await page.locator('#startBtn').click();
        await expect(page.locator('#errorModal')).toBeVisible();
        await expect(page.locator('#errorMessage')).toContainText('Repaired Root');
    });

});

// ================================================================
// SUITE 6: Mode — Smart Compression
// ================================================================
test.describe('Mode: Smart Compression', () => {

    test.beforeEach(async ({ page }) => {
        await resetConfig(page);
        await selectMode(page, 'SmartCompression');
    });

    test('Smart Compression panel is visible', async ({ page }) => {
        await expect(page.locator('#smartOptions')).not.toHaveClass(/hidden/);
    });

    test('Library Root is enabled', async ({ page }) => {
        await expect(page.locator('#rootPath')).toBeEnabled();
    });

    test('Library Root Browse is enabled', async ({ page }) => {
        await expect(page.locator('#browseRoot')).toBeEnabled();
    });

    test('Repaired Output is disabled', async ({ page }) => {
        await expect(page.locator('#repairedPath')).toBeDisabled();
    });

    test('Repaired Output Browse is disabled', async ({ page }) => {
        await expect(page.locator('#browseRepaired')).toBeDisabled();
    });

    test('Workers slider is enabled', async ({ page }) => {
        await expect(page.locator('#workerCount')).toBeEnabled();
    });

    test('Scan toggle is enabled', async ({ page }) => {
        await expect(page.locator('#scanAllEpisodes')).toBeEnabled();
    });

    test('CRF slider is visible and enabled', async ({ page }) => {
        await expect(page.locator('#crfSlider')).toBeVisible();
        await expect(page.locator('#crfSlider')).toBeEnabled();
    });

    test('CRF value label updates when slider moves', async ({ page }) => {
        await page.locator('#crfSlider').fill('25');
        await page.locator('#crfSlider').dispatchEvent('input');
        await expect(page.locator('#crfValue')).toHaveText('25');
    });

    test('CRF description shows Near lossless at value 18', async ({ page }) => {
        await page.locator('#crfSlider').fill('18');
        await page.locator('#crfSlider').dispatchEvent('input');
        await expect(page.locator('#crfDesc')).toContainText('Near lossless');
    });

    test('CRF description shows Recommended at value 22', async ({ page }) => {
        await page.locator('#crfSlider').fill('22');
        await page.locator('#crfSlider').dispatchEvent('input');
        await expect(page.locator('#crfDesc')).toContainText('Recommended');
    });

    test('CRF description shows Low quality at value 28', async ({ page }) => {
        await page.locator('#crfSlider').fill('28');
        await page.locator('#crfSlider').dispatchEvent('input');
        await expect(page.locator('#crfDesc')).toContainText('Low quality');
    });

	test('Accurate mode toggle is attached and enabled', async ({ page }) => {
        await expect(page.locator('#accurateMode')).toBeAttached();
        await expect(page.locator('#accurateMode')).toBeEnabled();
    });

	test('Accurate mode description changes when toggled on', async ({ page }) => {
        await page.locator('#accurateMode').evaluate(el => { el.checked = false; el.dispatchEvent(new Event('change')); });
        await expect(page.locator('#smartMethodDesc')).toHaveText('Quick results across your entire library');
        await page.locator('#accurateMode').evaluate(el => { el.checked = true; el.dispatchEvent(new Event('change')); });
        await expect(page.locator('#smartMethodDesc')).not.toHaveText('Quick results across your entire library');
    });

    test('Accurate mode description changes when toggled off', async ({ page }) => {
        await page.locator('#accurateMode').evaluate(el => { el.checked = true; el.dispatchEvent(new Event('change')); });
        await expect(page.locator('#smartMethodDesc')).not.toHaveText('Quick results across your entire library');
        await page.locator('#accurateMode').evaluate(el => { el.checked = false; el.dispatchEvent(new Event('change')); });
        await expect(page.locator('#smartMethodDesc')).toHaveText('Quick results across your entire library');
    });
	
    test('Review button is visible', async ({ page }) => {
        await expect(page.locator('#reviewBtn')).toBeVisible();
    });

	test('Review button has disabled-ui class when no SmartProbe log data exists', async ({ page }) => {
        await expect(page.locator('#reviewBtn')).toHaveClass(/disabled-ui/);
    });

    test('Start with no root path shows error modal', async ({ page }) => {
        await page.locator('#rootPath').fill('');
        await page.locator('#startBtn').click();
        await expect(page.locator('#errorModal')).toBeVisible();
    });

    test('Start with both paths blank shows error mentioning Library Root', async ({ page }) => {
        await page.locator('#rootPath').fill('');
        await page.locator('#startBtn').click();
        await expect(page.locator('#errorModal')).toBeVisible();
        await expect(page.locator('#errorMessage')).toContainText('Library Root');
    });

});

// ================================================================
// SUITE 7: Mode Switching
// ================================================================
test.describe('Mode Switching', () => {

    test.beforeEach(async ({ page }) => { await resetConfig(page); });

    test('All mode radios are always selectable', async ({ page }) => {
        for (const mode of ['Full', 'ScanOnly', 'RepairOnly', 'SmartCompression']) {
            await page.locator(`input[value="${mode}"]`).click();
            await expect(page.locator(`input[value="${mode}"]`)).toBeChecked();
        }
    });

    test('Switching from Repair Only back to Full re-enables Library Root', async ({ page }) => {
        await selectMode(page, 'RepairOnly');
        await selectMode(page, 'Full');
        await expect(page.locator('#rootPath')).toBeEnabled();
    });

    test('Switching from Compression back to Full re-enables Repaired Output', async ({ page }) => {
        await selectMode(page, 'SmartCompression');
        await selectMode(page, 'Full');
        await expect(page.locator('#repairedPath')).toBeEnabled();
    });

    test('Switching away from Compression hides Smart Compression panel', async ({ page }) => {
        await selectMode(page, 'SmartCompression');
        await selectMode(page, 'ScanOnly');
        await expect(page.locator('#smartOptions')).toHaveClass(/hidden/);
    });

});

// ================================================================
// SUITE 8: Error Modal
// ================================================================
test.describe('Error Modal', () => {

    test.beforeEach(async ({ page }) => { await resetConfig(page); });

    test('Error modal is hidden on load', async ({ page }) => {
        await expect(page.locator('#errorModal')).toHaveClass(/hidden/);
    });

    test('Error modal OK button closes it', async ({ page }) => {
        await page.locator('#rootPath').fill('');
        await page.locator('#startBtn').click();
        await page.locator('#errorOk').click();
        await expect(page.locator('#errorModal')).toHaveClass(/hidden/);
    });

	test('Error message contains text when shown', async ({ page }) => {
        await page.locator('#rootPath').fill('');
        await page.locator('#startBtn').click();
        await expect(page.locator('#errorModal')).toBeVisible();
        await expect(page.locator('#errorMessage')).not.toBeEmpty();
    });

});

// ================================================================
// SUITE 9: Log Panel
// ================================================================
test.describe('Log Panel', () => {

    test.beforeEach(async ({ page }) => { await resetConfig(page); });

    test('Log pane is closed by default', async ({ page }) => {
        await expect(page.locator('#logPane')).not.toHaveClass(/open/);
    });

    test('Human Log button opens log pane', async ({ page }) => {
        await page.locator('#humanLogBtn').click();
        await expect(page.locator('#logPane')).toHaveClass(/open/);
    });

    test('Clicking Human Log again closes log pane', async ({ page }) => {
        await page.locator('#humanLogBtn').click();
        await page.locator('#humanLogBtn').click();
        await expect(page.locator('#logPane')).not.toHaveClass(/open/);
    });

    test('Machine Log button opens log pane', async ({ page }) => {
        await page.locator('#machineLogBtn').click();
        await expect(page.locator('#logPane')).toHaveClass(/open/);
    });

    test('Clicking Machine Log again closes log pane', async ({ page }) => {
        await page.locator('#machineLogBtn').click();
        await page.locator('#machineLogBtn').click();
        await expect(page.locator('#logPane')).not.toHaveClass(/open/);
    });

    test('Human and Machine Log cannot both be active simultaneously', async ({ page }) => {
        await page.locator('#humanLogBtn').click();
        await page.locator('#machineLogBtn').click();
        const humanActive   = await page.locator('#humanLogBtn').evaluate(el => el.classList.contains('active'));
        const machineActive = await page.locator('#machineLogBtn').evaluate(el => el.classList.contains('active'));
        expect(humanActive && machineActive).toBe(false);
    });

    test('Human Log button gets active class when clicked', async ({ page }) => {
        await page.locator('#humanLogBtn').click();
        await expect(page.locator('#humanLogBtn')).toHaveClass(/active/);
    });

    test('Machine Log button gets active class when clicked', async ({ page }) => {
        await page.locator('#machineLogBtn').click();
        await expect(page.locator('#machineLogBtn')).toHaveClass(/active/);
    });

    test('Clicking Machine Log removes Human Log active class', async ({ page }) => {
        await page.locator('#humanLogBtn').click();
        await page.locator('#machineLogBtn').click();
        const humanActive = await page.locator('#humanLogBtn').evaluate(el => el.classList.contains('active'));
        expect(humanActive).toBe(false);
    });

    test('Log filter input accepts text when log is open', async ({ page }) => {
        await page.locator('#humanLogBtn').click();
        await page.locator('#logFilterInput').fill('test search');
        await expect(page.locator('#logFilterInput')).toHaveValue('test search');
    });

    test('Log filter clear button empties input', async ({ page }) => {
        await page.locator('#humanLogBtn').click();
        await page.locator('#logFilterInput').fill('test search');
        await page.locator('#logFilterClear').click();
        await expect(page.locator('#logFilterInput')).toHaveValue('');
    });

	test('Clear Logs button shows confirm modal', async ({ page }) => {
        await page.locator('#humanLogBtn').click();
        await page.evaluate(() => {
            const btn = document.getElementById('clearLogsBtn');
            btn.disabled = false;
            btn.click();
        });
        await expect(page.locator('#confirmModal')).toBeVisible();
    });

    test('Confirm modal Cancel button closes it', async ({ page }) => {
        await page.locator('#humanLogBtn').click();
        await page.evaluate(() => {
            const btn = document.getElementById('clearLogsBtn');
            btn.disabled = false;
            btn.click();
        });
        await page.locator('#confirmNo').click();
        await expect(page.locator('#confirmModal')).toHaveClass(/hidden/);
    });

    test('Confirm modal OK button closes it', async ({ page }) => {
        await page.locator('#humanLogBtn').click();
        await page.evaluate(() => {
            const btn = document.getElementById('clearLogsBtn');
            btn.disabled = false;
            btn.click();
        });
        await page.locator('#confirmYes').click();
        await expect(page.locator('#confirmModal')).toHaveClass(/hidden/);
    });
	
	test('Clear Logs button is disabled after clearing logs', async ({ page }) => {
        await page.request.get(`${BASE_URL}/logs/clear`);
        await page.goto(BASE_URL);
        // Wait for the polling cycle to update button state
        await page.waitForTimeout(1500);
        await expect(page.locator('#clearLogsBtn')).toBeDisabled();
    });

    test('Clear Logs button has disabled-ui class when no logs exist', async ({ page }) => {
        await page.request.get(`${BASE_URL}/logs/clear`);
        await page.goto(BASE_URL);
        await page.waitForTimeout(1500);
        await expect(page.locator('#clearLogsBtn')).toHaveClass(/disabled-ui/);
    });

});

// ================================================================
// SUITE 10: Compression Modal Structure
// ================================================================
test.describe('Compression Modal Structure', () => {

    test.beforeEach(async ({ page }) => { await resetConfig(page); });

    test('Compression modal is hidden on load', async ({ page }) => {
        await expect(page.locator('#compressionModal')).toHaveClass(/hidden/);
    });

    test('Compression output path input is present', async ({ page }) => {
        await expect(page.locator('#compressionOutputPath')).toBeAttached();
    });

    test('Compression Browse button is present', async ({ page }) => {
        await expect(page.locator('#compressionBrowse')).toBeAttached();
    });

    test('Compression worker slider defaults to 2', async ({ page }) => {
        await expect(page.locator('#compressWorkerCount')).toHaveValue('2');
    });

	test('Compression worker description changes away from Recommended when not at 2', async ({ page }) => {
        await page.locator('#compressWorkerCount').fill('1', { force: true });
        await page.locator('#compressWorkerCount').dispatchEvent('input');
        await expect(page.locator('#compressWorkerDesc')).not.toHaveText('Recommended — balance of speed and CPU resources');
    });

    test('Compression worker value label updates when slider moves away from 2', async ({ page }) => {
        await page.locator('#compressWorkerCount').fill('4', { force: true });
        await page.locator('#compressWorkerCount').dispatchEvent('input');
        await expect(page.locator('#compressWorkerValue')).toHaveText('4');
    });

    test('Compression worker description is not blank at value 1', async ({ page }) => {
        await page.locator('#compressWorkerCount').fill('1', { force: true });
        await page.locator('#compressWorkerCount').dispatchEvent('input');
        await expect(page.locator('#compressWorkerDesc')).not.toBeEmpty();
    });

    test('Compression worker description is not blank at value 4', async ({ page }) => {
        await page.locator('#compressWorkerCount').fill('4', { force: true });
        await page.locator('#compressWorkerCount').dispatchEvent('input');
        await expect(page.locator('#compressWorkerDesc')).not.toBeEmpty();
    });

    test('Compression tree Size column header is present', async ({ page }) => {
        await expect(page.locator('.tree-th-size')).toBeAttached();
    });

    test('Compression tree Verdict column header is present', async ({ page }) => {
        await expect(page.locator('.tree-th-verdict')).toBeAttached();
    });

    test('Compression close button is present', async ({ page }) => {
        await expect(page.locator('#compressionClose')).toBeAttached();
    });

    test('Compression start button is present', async ({ page }) => {
        await expect(page.locator('#compressionStart')).toBeAttached();
    });

	test('Tree striping alternates over visible rows and skips hidden rows', async ({ page }) => {
        const result = await page.evaluate(() => {
            const tbody = document.createElement('tbody');
            const spec = [
                { name: 'All Media', hidden: false },  // visible 0 -> dark
                { name: 'Movies',    hidden: false },  // visible 1 -> light
                { name: 'HiddenA',   hidden: true  },  // collapsed - skipped
                { name: 'HiddenB',   hidden: true  },  // collapsed - skipped
                { name: 'Shows',     hidden: false },  // visible 2 -> dark
                { name: 'A Show',    hidden: false },  // visible 3 -> light
            ];
            for (const r of spec) {
                const tr = document.createElement('tr');
                tr.dataset.name = r.name;
                if (r.hidden) tr.style.display = 'none';
                tbody.appendChild(tr);
            }
            restripeTree(tbody);
            return [...tbody.querySelectorAll('tr')].map(tr => ({
                name:    tr.dataset.name,
                hidden:  tr.style.display === 'none',
                striped: tr.classList.contains('tree-stripe'),
            }));
        });

        // Hidden rows are never striped
        expect(result.filter(r => r.hidden).every(r => !r.striped)).toBe(true);

        // Visible rows alternate dark/light (0-indexed: odd = striped/light)
        result.filter(r => !r.hidden).forEach((r, i) => {
            expect(r.striped).toBe(i % 2 === 1);
        });

        // Hidden rows between Movies and Shows must NOT shift the pattern
        const byName = Object.fromEntries(result.map(r => [r.name, r.striped]));
        expect(byName['All Media']).toBe(false); // dark
        expect(byName['Movies']).toBe(true);     // light
        expect(byName['Shows']).toBe(false);     // dark
        expect(byName['A Show']).toBe(true);     // light
    });
	
});

// ================================================================
// SUITE 11: API Endpoints
// Verifies all server endpoints respond correctly
// ================================================================
test.describe('API Endpoints', () => {

    test('/logs/total returns ok and total count', async ({ page }) => {
        const res = await page.request.get(`${BASE_URL}/logs/total`);
        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(typeof json.total).toBe('number');
    });

    test('/logs/slice returns ok, entries array, and total', async ({ page }) => {
        const res = await page.request.get(`${BASE_URL}/logs/slice?start=0&end=10`);
        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(Array.isArray(json.entries)).toBe(true);
        expect(typeof json.total).toBe('number');
    });

    test('/logs/slice with no data returns empty entries', async ({ page }) => {
        // Clear logs first
        await page.request.get(`${BASE_URL}/logs/clear`);
        const res = await page.request.get(`${BASE_URL}/logs/slice?start=0&end=10`);
        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.entries.length).toBe(0);
    });

    test('/logs/search returns ok and entries array', async ({ page }) => {
        const res = await page.request.get(`${BASE_URL}/logs/search?q=test&max=10`);
        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(Array.isArray(json.entries)).toBe(true);
        expect(typeof json.total).toBe('number');
    });

    test('/logs/search with empty query returns empty entries', async ({ page }) => {
        const res = await page.request.get(`${BASE_URL}/logs/search?q=&max=10`);
        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.entries.length).toBe(0);
    });

    test('/logs/clear returns ok', async ({ page }) => {
        const res = await page.request.get(`${BASE_URL}/logs/clear`);
        const json = await res.json();
        expect(json.ok).toBe(true);
    });

    test('/logs/total returns 0 after clear', async ({ page }) => {
        await page.request.get(`${BASE_URL}/logs/clear`);
        const res = await page.request.get(`${BASE_URL}/logs/total`);
        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.total).toBe(0);
    });

    test('/status returns a valid status string', async ({ page }) => {
        const res = await page.request.get(`${BASE_URL}/status`);
        const json = await res.json();
        expect(['idle', 'running', 'completed', 'error']).toContain(json.status);
    });

    test('/status-all returns status and logTotal', async ({ page }) => {
        const res = await page.request.get(`${BASE_URL}/status-all`);
        const json = await res.json();
        expect(typeof json.logTotal).toBe('number');
        // status can be null when idle, so just check it exists
        expect('status' in json).toBe(true);
        expect('logTotal' in json).toBe(true);
    });

    test('/status-console returns a status field', async ({ page }) => {
        const res = await page.request.get(`${BASE_URL}/status-console`);
        const json = await res.json();
        expect('status' in json).toBe(true);
    });

    test('/config returns ok and config object', async ({ page }) => {
        const res = await page.request.get(`${BASE_URL}/config`);
        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.config).toBeDefined();
        expect(typeof json.config.RootPath).toBe('string');
    });

});

// ================================================================
// SUITE 12: Search Filter Behavior
// Tests server-side search and client filter interactions
// ================================================================
test.describe('Search Filter', () => {

    test.beforeEach(async ({ page }) => { await resetConfig(page); });

    test('Search filter input is present when log is open', async ({ page }) => {
        await page.locator('#machineLogBtn').click();
        await expect(page.locator('#logFilterInput')).toBeVisible();
    });

    test('Typing in filter updates the input value', async ({ page }) => {
        await page.locator('#machineLogBtn').click();
        await page.locator('#logFilterInput').fill('test query');
        await expect(page.locator('#logFilterInput')).toHaveValue('test query');
    });

    test('Clear button resets filter input', async ({ page }) => {
        await page.locator('#machineLogBtn').click();
        await page.locator('#logFilterInput').fill('something');
        await page.locator('#logFilterClear').click();
        await expect(page.locator('#logFilterInput')).toHaveValue('');
    });

    test('Filter with no matches shows appropriate message', async ({ page }) => {
        await page.request.get(`${BASE_URL}/logs/clear`);
        await page.locator('#machineLogBtn').click();
        await page.locator('#logFilterInput').fill('zzz_nonexistent_query_zzz');
        await page.locator('#logFilterInput').dispatchEvent('input');
        // Wait for debounce + server response
        await page.waitForTimeout(500);
        const text = await page.locator('#logContent').textContent();
        expect(text.length).toBeGreaterThan(0);
    });

    test('Search with backslash in query does not crash', async ({ page }) => {
        await page.locator('#machineLogBtn').click();
        await page.locator('#logFilterInput').fill('Shows\\Test');
        await page.locator('#logFilterInput').dispatchEvent('input');
        await page.waitForTimeout(500);
        // Should not throw — page should still be responsive
        await expect(page.locator('#logFilterInput')).toBeVisible();
    });
	
	test('Filter count element exists in DOM', async ({ page }) => {
        await page.locator('#machineLogBtn').click();
        await expect(page.locator('#logFilterCount')).toBeAttached();
    });

    test('Filter count is empty when no filter is active', async ({ page }) => {
        await page.locator('#machineLogBtn').click();
        await expect(page.locator('#logFilterCount')).toHaveText('');
    });

    test('Filter count clears when clear button is clicked', async ({ page }) => {
        await page.locator('#machineLogBtn').click();
        await page.locator('#logFilterInput').fill('a');
        await page.locator('#logFilterInput').dispatchEvent('input');
        await page.waitForTimeout(500);
        await page.locator('#logFilterClear').click();
        await expect(page.locator('#logFilterCount')).toHaveText('');
    });

    test('Filter count clears when input is manually emptied', async ({ page }) => {
        await page.locator('#machineLogBtn').click();
        await page.locator('#logFilterInput').fill('a');
        await page.locator('#logFilterInput').dispatchEvent('input');
        await page.waitForTimeout(500);
        await page.locator('#logFilterInput').fill('');
        await page.locator('#logFilterInput').dispatchEvent('input');
        await page.waitForTimeout(500);
        await expect(page.locator('#logFilterCount')).toHaveText('');
    });

});

// ================================================================
// SUITE 13: Log Panel — Mode Integrity
// Ensures switching between human/machine mode renders correctly
// ================================================================
test.describe('Log Mode Integrity', () => {

    test.beforeEach(async ({ page }) => { await resetConfig(page); });

    test('Machine log button sets machine-log class on content', async ({ page }) => {
        await page.locator('#machineLogBtn').click();
        const hasMachineClass = await page.locator('#logContent').evaluate(
            el => el.classList.contains('machine-log')
        );
        expect(hasMachineClass).toBe(true);
    });

    test('Human log button removes machine-log class from content', async ({ page }) => {
        await page.locator('#machineLogBtn').click();
        await page.locator('#humanLogBtn').click();
        const hasMachineClass = await page.locator('#logContent').evaluate(
            el => el.classList.contains('machine-log')
        );
        expect(hasMachineClass).toBe(false);
    });

    test('Switching from human to machine does not show human-formatted content', async ({ page }) => {
        await page.locator('#humanLogBtn').click();
        await page.waitForTimeout(300);
        await page.locator('#machineLogBtn').click();
        await page.waitForTimeout(300);
        const hasMachineClass = await page.locator('#logContent').evaluate(
            el => el.classList.contains('machine-log')
        );
        expect(hasMachineClass).toBe(true);
    });

    test('Closing and reopening log pane resets machine-log class', async ({ page }) => {
        await page.locator('#machineLogBtn').click();
        await page.locator('#machineLogBtn').click(); // close
        const hasMachineClass = await page.locator('#logContent').evaluate(
            el => el.classList.contains('machine-log')
        );
        expect(hasMachineClass).toBe(false);
    });

    test('Resume scroll button is hidden when log opens', async ({ page }) => {
        await page.locator('#machineLogBtn').click();
        await expect(page.locator('#resumeScrollBtn')).toHaveClass(/hidden/);
    });

});

// ================================================================
// SUITE 14: Console Updates
// Verifies the console area receives and displays status data
// ================================================================
test.describe('Console', () => {

    test.beforeEach(async ({ page }) => { await resetConfig(page); });

    test('Console output element is visible on load', async ({ page }) => {
        await expect(page.locator('#consoleOutput')).toBeVisible();
    });

    test('/status-all endpoint responds within 2 seconds', async ({ page }) => {
        const start = Date.now();
        const res = await page.request.get(`${BASE_URL}/status-all`);
        const elapsed = Date.now() - start;
        expect(res.ok()).toBe(true);
        expect(elapsed).toBeLessThan(2000);
    });

    test('/status-console endpoint responds within 2 seconds', async ({ page }) => {
        const start = Date.now();
        const res = await page.request.get(`${BASE_URL}/status-console`);
        const elapsed = Date.now() - start;
        expect(res.ok()).toBe(true);
        expect(elapsed).toBeLessThan(2000);
    });

    test('/logs/total responds within 1 second', async ({ page }) => {
        const start = Date.now();
        const res = await page.request.get(`${BASE_URL}/logs/total`);
        const elapsed = Date.now() - start;
        expect(res.ok()).toBe(true);
        expect(elapsed).toBeLessThan(1000);
    });

    test('/logs/slice responds within 2 seconds for 200 entries', async ({ page }) => {
        const start = Date.now();
        const res = await page.request.get(`${BASE_URL}/logs/slice?start=0&end=200`);
        const elapsed = Date.now() - start;
        expect(res.ok()).toBe(true);
        expect(elapsed).toBeLessThan(2000);
    });

});

// ================================================================
// SUITE 15: Log Data Round-Trip
// Writes test entries, verifies they appear via endpoints
// ================================================================
test.describe('Log Data Round-Trip', () => {

    test('Clear then total returns 0', async ({ page }) => {
        await page.request.get(`${BASE_URL}/logs/clear`);
        const res = await page.request.get(`${BASE_URL}/logs/total`);
        const json = await res.json();
        expect(json.total).toBe(0);
    });

    test('Slice from empty log returns empty entries', async ({ page }) => {
        await page.request.get(`${BASE_URL}/logs/clear`);
        const res = await page.request.get(`${BASE_URL}/logs/slice?start=0&end=100`);
        const json = await res.json();
        expect(json.entries.length).toBe(0);
        expect(json.total).toBe(0);
    });

    test('Slice with start >= total returns clamped result', async ({ page }) => {
        await page.request.get(`${BASE_URL}/logs/clear`);
        const res = await page.request.get(`${BASE_URL}/logs/slice?start=9999&end=10000`);
        const json = await res.json();
        expect(json.ok).toBe(true);
    });

    test('Search max parameter limits results', async ({ page }) => {
        const res = await page.request.get(`${BASE_URL}/logs/search?q=a&max=1`);
        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.entries.length).toBeLessThanOrEqual(1);
    });

    test('Status-all logTotal matches logs/total count', async ({ page }) => {
        const [allRes, totalRes] = await Promise.all([
            page.request.get(`${BASE_URL}/status-all`),
            page.request.get(`${BASE_URL}/logs/total`)
        ]);
        const allJson = await allRes.json();
        const totalJson = await totalRes.json();
        expect(allJson.logTotal).toBe(totalJson.total);
    });

});

// ================================================================
// SUITE 16: Timer Formatting
// Verifies elapsed time formatting handles large values
// ================================================================
test.describe('Timer Formatting', () => {

    test.beforeEach(async ({ page }) => { await resetConfig(page); });

    test('formatSecondsToHms produces 4-digit hours for 0 seconds', async ({ page }) => {
        const result = await page.evaluate(() => formatSecondsToHms(0));
        expect(result).toBe('0000:00:00');
    });

    test('formatSecondsToHms produces 4-digit hours for 90 seconds', async ({ page }) => {
        const result = await page.evaluate(() => formatSecondsToHms(90));
        expect(result).toBe('0000:01:30');
    });

    test('formatSecondsToHms handles 1000+ hours', async ({ page }) => {
        const result = await page.evaluate(() => formatSecondsToHms(3600000));
        expect(result).toBe('1000:00:00');
    });

    test('formatSecondsToHms handles 9999 hours', async ({ page }) => {
        const result = await page.evaluate(() => formatSecondsToHms(35996400));
        expect(result).toBe('9999:00:00');
    });

    test('formatSecondsToHms handles negative input gracefully', async ({ page }) => {
        const result = await page.evaluate(() => formatSecondsToHms(-50));
        expect(result).toBe('0000:00:00');
    });

});
// ================================================================
// SUITE 17: GPU Encoding Toggle
// Verifies toggle existence, detection, config persistence,
// modal sync, and disabled-state rules
// ================================================================
test.describe('GPU Encoding Toggle', () => {

    test.beforeEach(async ({ page }) => { await resetConfig(page); });

    async function waitForDetection(page) {
        await page.waitForFunction(() => {
            const d = document.getElementById('gpuStatusDesc');
            return d && !d.textContent.includes('Detecting');
        });
    }

    test('Settings GPU toggle is present', async ({ page }) => {
        await expect(page.locator('#useGPU')).toBeAttached();
    });

    test('GPU status text element is present', async ({ page }) => {
        await expect(page.locator('#gpuStatusDesc')).toBeAttached();
    });

    test('Compression modal GPU toggle is present', async ({ page }) => {
        await expect(page.locator('#compressUseGPU')).toBeAttached();
    });

    test('/gpu-detect returns the expected shape', async ({ page }) => {
        const res = await page.request.get(`${BASE_URL}/gpu-detect`);
        expect(res.ok()).toBe(true);
        const json = await res.json();
        expect(json).toHaveProperty('available');
        expect(json).toHaveProperty('encoder');
        expect(json).toHaveProperty('name');
    });

    test('/config exposes a UseGPU field', async ({ page }) => {
        const res = await page.request.get(`${BASE_URL}/config`);
        const json = await res.json();
        expect(json.config).toHaveProperty('UseGPU');
    });

/*	test.skip(process.env.CI, 'Skipping GPU tests in CI: no GPU available'); */
	test('GPU status text resolves after detection (GPU Encoding Toggle)', async ({ page }) => {
	  test.skip(!!process.env.CI, 'Requires a real GPU; skipped in CI');
	  await waitForDetection(page);
	  const text = (await page.locator('#gpuStatusDesc').textContent()).trim();
	  expect(text === '' || text.includes('detected')).toBe(true);
	});
	test('GPU toggle enabled state matches detection result (GPU Encoding Toggle)', async ({ page }) => {
	  test.skip(!!process.env.CI, 'Requires a real GPU; skipped in CI');
	  await waitForDetection(page);
	  const status = await page.locator('#gpuStatusDesc').textContent();
	  if (status.includes('No compatible GPU')) {
		await expect(page.locator('#useGPU')).toBeDisabled();
		await expect(page.locator('.gpu-toggle-group')).toHaveClass(/disabled-ui/);
	  } else {
		await expect(page.locator('#useGPU')).toBeEnabled();
	  }
	});
    test('GPU toggle is disabled in Scan Only mode', async ({ page }) => {
        await waitForDetection(page);
        await selectMode(page, 'ScanOnly');
        await expect(page.locator('#useGPU')).toBeDisabled();
    });
    test('Changing the settings GPU toggle syncs the modal toggle', async ({ page }) => {
        test.skip(!!process.env.CI, 'Requires a real GPU; skipped in CI');
        await waitForDetection(page);
        await page.evaluate(() => {
            const m = document.getElementById('useGPU');
            m.checked = true;
            m.dispatchEvent(new Event('change'));
        });
        await expect(page.locator('#compressUseGPU')).toBeChecked();
        await page.evaluate(() => {
            const m = document.getElementById('useGPU');
            m.checked = false;
            m.dispatchEvent(new Event('change'));
        });
        await expect(page.locator('#compressUseGPU')).not.toBeChecked();
    });
    test('Changing the modal GPU toggle syncs the settings toggle', async ({ page }) => {
        test.skip(!!process.env.CI, 'Requires a real GPU; skipped in CI');
        await waitForDetection(page);
        await page.evaluate(() => {
            const m = document.getElementById('compressUseGPU');
            m.checked = true;
            m.dispatchEvent(new Event('change'));
        });
        await expect(page.locator('#useGPU')).toBeChecked();
    });
    test('GPU preference persists through /config/save round-trip', async ({ page }) => {
        await page.request.get(`${BASE_URL}/config/save?root=&repaired=&mode=Full&scanAll=false&accurateMode=false&useGPU=true`);
        const res = await page.request.get(`${BASE_URL}/config`);
        const json = await res.json();
        expect(json.config.UseGPU).toBe(true);
        // restore
        await page.request.get(`${BASE_URL}/config/save?root=&repaired=&mode=Full&scanAll=false&accurateMode=false&useGPU=false`);
    });

});

// ================================================================
// SUITE 18: Path Not-Found Validation (universal popup)
// ================================================================
test.describe('Path Not-Found Validation', () => {

    test.beforeEach(async ({ page }) => { await resetConfig(page); });

    test('Nonexistent Library Root shows the path-not-found popup', async ({ page }) => {
        await page.locator('#rootPath').fill('Z:\\nope_askjdhfs');
        await page.locator('#repairedPath').fill('Z:\\nope_repaired');
        await page.locator('#startBtn').click();
        await expect(page.locator('#errorModal')).toBeVisible();
        await expect(page.locator('#errorMessage')).toContainText('Directory not found.');
        await expect(page.locator('#errorMessage')).toContainText('Z:\\nope_askjdhfs');
    });

    test('Nonexistent Repaired Root shows the path-not-found popup', async ({ page }) => {
        await page.locator('#rootPath').fill('C:\\Windows');       // a path that exists, so root passes
        await page.locator('#repairedPath').fill('Z:\\nope_repaired');
        await page.locator('#startBtn').click();
        await expect(page.locator('#errorModal')).toBeVisible();
        await expect(page.locator('#errorMessage')).toContainText('Directory not found.');
        await expect(page.locator('#errorMessage')).toContainText('Z:\\nope_repaired');
    });

    test('Nonexistent Compressed Root is rejected by /compress/start', async ({ page }) => {
        const res = await page.request.post(`${BASE_URL}/compress/start`, {
            data: { outputPath: 'Z:\\nope_compressed', paths: ['Z:\\nope\\file.mkv'], crf: 22 }
        });
        const body = await res.json();
        expect(body.ok).toBe(false);
        expect(body.error).toContain('Directory not found.');
        expect(body.error).toContain('Z:\\nope_compressed');
    });

});

// ================================================================
// SUITE 19: Automated UnifiedLog
// ================================================================
test.describe('Compression Review — seeded tree', () => {
  test.beforeEach(async ({ page }) => {
    await resetConfig(page);
    await seedProbeLog(page, PROBE_FIXTURE);
    await openReview(page);
  });

  test.afterEach(async ({ page }) => {
    await page.request.get(`${BASE_URL}/logs/clear`);          // leave no fixture behind
  });

  test('tree renders one row per seeded file', async ({ page }) => {
    const leafRows = page.locator('#compressionTreeBody tr[data-path]');
    await expect(leafRows).toHaveCount(PROBE_FIXTURE.length);   // 12 leaves, collapsed or not
  });
  
  // Helper used by every assertion below: leaf checkboxes currently selected.
  // (Folders have no data-path; collapsed rows still count — we're testing
  //  logical selection, not visibility.)
  const checkedLeaves = page =>
    page.locator('#compressionTreeBody tr[data-path] .tree-checkbox:checked');

  test('all eligible rows checked by default; the 2 skips excluded', async ({ page }) => {
    await expect(checkedLeaves(page)).toHaveCount(10);   // 10 Compress, 2 Skip stay off/disabled
  });

  test('unchecking Low confidence drops exactly the 3 Low rows', async ({ page }) => {
    await page.locator('#filterConfLow').uncheck();
    await expect(checkedLeaves(page)).toHaveCount(7);     // 10 - 3 Low
    await page.locator('#filterConfLow').check();         // and it comes back
    await expect(checkedLeaves(page)).toHaveCount(10);
  });

  test('unchecking ≤720p drops the ≤1280px-width rows', async ({ page }) => {
    await page.locator('#filterRes720').uncheck();
    await expect(checkedLeaves(page)).toHaveCount(7);     // E03(1280), B-S01E01(720), B-S02E02(1024)
  });

  test('minimum savings of 1000 MB keeps only the bigger savers', async ({ page }) => {
    await page.locator('#filterMinMB').fill('1000');
    await expect(checkedLeaves(page)).toHaveCount(5);     // savedMB ≥ 1000: 2400,1500,3000,1800,2100
  });

  test('minimum savings of 50% keeps only the higher-ratio rows', async ({ page }) => {
    await page.locator('#filterMinPct').fill('50');
    await expect(checkedLeaves(page)).toHaveCount(5);     // savedPct ≥ 50: 72.7,55.6,60,50,58.3
  });

  test('Reset Defaults restores all eligible rows', async ({ page }) => {
    await page.locator('#filterConfLow').uncheck();
    await page.locator('#filterMinMB').fill('1500');
    await expect(checkedLeaves(page)).not.toHaveCount(10);
    await page.locator('#filterReset').click();
    await expect(checkedLeaves(page)).toHaveCount(10);
  });
  
test('a manually unchecked row stays off through a filter change', async ({ page }) => {
    await expandAll(page);
    await leafCb(page, 'Alpha S01E01.mkv').uncheck();              // force-OFF (records 0)
    await expect(leafCb(page, 'Alpha S01E01.mkv')).not.toBeChecked();

    await page.locator('#filterMinMB').fill('100');               // re-runs filter; this row matches

    await expect(leafCb(page, 'Alpha S01E01.mkv')).not.toBeChecked(); // override held by Pass 3
    await expect(checkedLeaves(page)).toHaveCount(9);                 // 10 eligible - 1 forced off
  });

  test('a manually re-checked row survives a filter that would exclude it', async ({ page }) => {
    await expandAll(page);

    await page.locator('#filterConfLow').uncheck();               // filter out the 3 Low rows
    await expect(leafCb(page, 'Alpha S01E03.mkv')).not.toBeChecked();

    await leafCb(page, 'Alpha S01E03.mkv').check();               // force-ON while filter active (records 1)
    await expect(leafCb(page, 'Alpha S01E03.mkv')).toBeChecked();

    await page.locator('#filterMinMB').fill('100');               // re-runs filter; Low still off

    await expect(leafCb(page, 'Alpha S01E03.mkv')).toBeChecked();      // override holds it on
    await expect(leafCb(page, 'Beta S01E03.mkv')).not.toBeChecked();   // other Low rows: still off
    await expect(leafCb(page, 'Beta S02E03.mkv')).not.toBeChecked();   // proves it's per-file, not global
  });
  
  test('Reset Filters clears the filter but keeps manual overrides', async ({ page }) => {
    await expandAll(page);
    await leafCb(page, 'Alpha S01E01.mkv').uncheck();          // manual force-off
    await page.locator('#filterMinMB').fill('1500');           // plus a filter
    await page.locator('#filterReset').click();
    await expect(page.locator('#filterMinMB')).toHaveValue('');        // filter cleared
    await expect(leafCb(page, 'Alpha S01E01.mkv')).not.toBeChecked();  // pick kept
    await expect(checkedLeaves(page)).toHaveCount(9);
  });

  test('Reset Checkboxes clears manual picks but keeps the active filter', async ({ page }) => {
    await expandAll(page);
    await page.locator('#filterConfLow').uncheck();            // filter active: Low out -> 7
    await leafCb(page, 'Alpha S01E01.mkv').uncheck();          // manual force-off a High row -> 6
    await expect(checkedLeaves(page)).toHaveCount(6);
    await page.locator('#filterResetChecks').click();
    await expect(page.locator('#filterConfLow')).not.toBeChecked();    // filter still active
    await expect(leafCb(page, 'Alpha S01E01.mkv')).toBeChecked();      // pick undone
    await expect(checkedLeaves(page)).toHaveCount(7);                 // pure Low-off result
  });
  
  test('folder counts show all eligible selected by default; skips excluded', async ({ page }) => {
    await expect(folderCount(page, 'All Media')).toContainText('10 of 10');   // 10 compress, 2 skips NOT counted
    await expect(folderCount(page, 'Alpha Series')).toContainText('4 of 4');
    await expect(folderCount(page, 'Beta Show')).toContainText('6 of 6');
  });

  test('counts update when a filter unchecks rows (denominator stays put)', async ({ page }) => {
    await page.locator('#filterConfLow').uncheck();                 // drops the 3 Low rows
    await expect(folderCount(page, 'All Media')).toContainText('7 of 10');   // selected fell, available held
    await expect(folderCount(page, 'Alpha Series')).toContainText('3 of 4'); // 1 Low here
    await expect(folderCount(page, 'Beta Show')).toContainText('4 of 6');    // 2 Low here
  });

  test('counts update when a single file is unchecked', async ({ page }) => {
    await expandAll(page);
    await leafCb(page, 'Alpha S01E01.mkv').uncheck();
    await expect(folderCount(page, 'Alpha Series')).toContainText('3 of 4');
    await expect(folderCount(page, 'All Media')).toContainText('9 of 10');
  });
  
  test('summary file count tracks the selection', async ({ page }) => {
    await expect(page.locator('#sumEpisodes')).toHaveText('10');    // all eligible
    await page.locator('#filterConfLow').uncheck();
    await expect(page.locator('#sumEpisodes')).toHaveText('7');     // recomputed
  });

  test('summary size totals shrink when the selection shrinks', async ({ page }) => {
    const toMB = async (sel) => {
      const t = (await page.locator(sel).textContent()).trim();
      const n = parseFloat(t) || 0;
      return t.includes('TB') ? n*1024*1024 : t.includes('GB') ? n*1024 : n;
    };
    const beforeAll = await toMB('#sumBefore');
    await page.locator('#filterConfLow').uncheck();
    await expect(page.locator('#sumEpisodes')).toHaveText('7');     // sync point: recompute done
    expect(await toMB('#sumBefore')).toBeLessThan(beforeAll);       // fewer files -> smaller total
  });

  test('summary zeroes out when nothing qualifies', async ({ page }) => {
    await page.locator('#filterMinPct').fill('95');                 // nothing saves >=95%
    await expect(page.locator('#sumEpisodes')).toHaveText('0');
  });
  
});

// ================================================================
// SUITE 20: Automated UnifiedLog Cap modes
// ================================================================
test.describe('Compression Review — cap modes', () => {
  test.beforeEach(async ({ page }) => {
    await resetConfig(page);
    await seedProbeLog(page, CAP_FIXTURE);
    await openReview(page);
  });

  test.afterEach(async ({ page }) => {
    await page.request.get(`${BASE_URL}/logs/clear`);
  });

  // Same helper as the predicate block; redefined here for block scope.
  const checkedLeaves = page =>
    page.locator('#compressionTreeBody tr[data-path] .tree-checkbox:checked');

  test('all 12 eligible checked by default; the skip is excluded', async ({ page }) => {
    await expect(checkedLeaves(page)).toHaveCount(12);
  });

  test('Top savers trims to the N biggest savers', async ({ page }) => {
    await page.locator('#filterCapMode').selectOption('topn');
    await page.locator('#filterCapValue').fill('10');   // min is 10 -> keeps top 10 of 12
    await expect(checkedLeaves(page)).toHaveCount(10);
  });

  test('Total saved keeps just enough top savers to hit the target', async ({ page }) => {
    await page.locator('#filterCapMode').selectOption('reclaim');
    await page.locator('#filterCapValue').fill('10');   // 10 GB reached exactly at the 5th row
    await expect(checkedLeaves(page)).toHaveCount(5);
  });

  test('Size after keeps the biggest savers that fit under the output budget', async ({ page }) => {
    await page.locator('#filterCapMode').selectOption('fit');
    await page.locator('#filterCapValue').fill('10');   // 10 GB / 1400 MB each -> 7 fit
    await expect(checkedLeaves(page)).toHaveCount(7);
  });

  test('switching cap back to No limit restores all eligible', async ({ page }) => {
    await page.locator('#filterCapMode').selectOption('topn');
    await page.locator('#filterCapValue').fill('10');
    await expect(checkedLeaves(page)).toHaveCount(10);
    await page.locator('#filterCapMode').selectOption('none');
    await expect(checkedLeaves(page)).toHaveCount(12);
  });
});