// --- State ---
let inputMode = 'raw';
let singleSequence = '';
let batchSequences = []; // [{name, sequence}]
let isSubmitting = false;
 
// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
  checkPageStatus();
  renderBatchList();
  renderJobs();
 
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'monitor') renderJobs();
    });
  });
 
  // File input - single FASTA
  document.getElementById('fastaFile').addEventListener('change', e => {
    if (e.target.files[0]) handleFastaFile(e.target.files[0], 'single');
  });
 
  // File input - batch FASTA
  document.getElementById('batchFasta').addEventListener('change', e => {
    if (e.target.files[0]) handleFastaFile(e.target.files[0], 'batch');
  });
 
  // Drag and drop - single
  setupDragDrop('dropzone', file => handleFastaFile(file, 'single'));
  setupDragDrop('batchDropzone', file => handleFastaFile(file, 'batch'));
 
  // Auto-save settings
  ['autoConfirm','stripHeaders','trackJobs','batchDelay'].forEach(id => {
    document.getElementById(id).addEventListener('change', saveSettings);
  });
});
 
// --- Page Status ---
async function checkPageStatus() {
  const statusEl = document.getElementById('pageStatus');
  const bannerEl = document.getElementById('notOnPage');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('alphafoldserver.com')) {
      statusEl.textContent = 'Ready';
      statusEl.className = 'status-pill ready';
      if (bannerEl) bannerEl.style.display = 'none';
    } else {
      statusEl.textContent = 'Not on page';
      statusEl.className = 'status-pill error';
      if (bannerEl) bannerEl.style.display = 'block';
    }
  } catch {
    statusEl.textContent = 'Error';
    statusEl.className = 'status-pill error';
  }
}
 
// --- Mode Switching ---
function setMode(mode) {
  inputMode = mode;
  document.getElementById('rawSection').style.display = mode === 'raw' ? 'block' : 'none';
  document.getElementById('fastaSection').style.display = mode === 'fasta' ? 'block' : 'none';
  document.getElementById('modeRaw').style.borderColor = mode === 'raw' ? 'var(--accent2)' : '';
  document.getElementById('modeRaw').style.color = mode === 'raw' ? 'var(--accent)' : '';
  document.getElementById('modeFasta').style.borderColor = mode === 'fasta' ? 'var(--accent2)' : '';
  document.getElementById('modeFasta').style.color = mode === 'fasta' ? 'var(--accent)' : '';
}
 
// --- FASTA Parsing ---
function parseFasta(text) {
  const lines = text.trim().split(/\r?\n/);
  const sequences = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('>')) {
      if (current) sequences.push(current);
      current = { name: line.slice(1).trim() || 'sequence', sequence: '' };
    } else if (current) {
      current.sequence += line.trim();
    } else {
      // No header — treat entire content as a single raw sequence
      if (!current) current = { name: 'sequence', sequence: '' };
      current.sequence += line.trim();
    }
  }
  if (current) sequences.push(current);
  return sequences;
}
 
function cleanSequence(seq) {
  return seq.replace(/\s+/g, '').toUpperCase();
}
 
// --- File Handling ---
function handleFastaFile(file, target) {
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const parsed = parseFasta(text);
    if (parsed.length === 0) {
      logMsg(target === 'batch' ? 'batchLog' : 'log', 'No valid sequences found in file', 'err');
      return;
    }
 
    if (target === 'single') {
      singleSequence = cleanSequence(parsed[0].sequence);
      const dz = document.getElementById('dropzone');
      dz.classList.add('loaded');
      dz.querySelector('.dropzone-text').innerHTML = `<strong>✓ ${file.name}</strong> — ${parsed[0].name}`;
      const preview = document.getElementById('seqPreview');
      preview.textContent = singleSequence.substring(0, 200) + (singleSequence.length > 200 ? '...' : '');
      preview.classList.add('visible');
      if (!document.getElementById('jobName').value) {
        document.getElementById('jobName').value = parsed[0].name.replace(/[^a-zA-Z0-9_-]/g, '-').substring(0, 40);
      }
      logMsg('log', `Loaded: ${file.name} (${singleSequence.length} residues)`, 'ok');
    } else {
      batchSequences = parsed.map(p => ({ name: p.name, sequence: cleanSequence(p.sequence) }));
      const dz = document.getElementById('batchDropzone');
      dz.classList.add('loaded');
      dz.querySelector('.dropzone-text').innerHTML = `<strong>✓ ${file.name}</strong> — ${parsed.length} sequences`;
      renderBatchList();
      logMsg('batchLog', `Loaded ${parsed.length} sequences from ${file.name}`, 'ok');
    }
  };
  reader.readAsText(file);
}
 
function setupDragDrop(id, callback) {
  const el = document.getElementById(id);
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('dragging'); });
  el.addEventListener('dragleave', () => el.classList.remove('dragging'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('dragging');
    const file = e.dataTransfer.files[0];
    if (file) callback(file);
  });
}
 
// --- Batch Rendering ---
function renderBatchList() {
  const list = document.getElementById('batchList');
  const label = document.getElementById('batchCountLabel');
  label.textContent = `Queued Jobs (${batchSequences.length})`;
  if (batchSequences.length === 0) {
    list.innerHTML = '<div class="empty-batch">No sequences loaded yet</div>';
    return;
  }
  list.innerHTML = batchSequences.map((s, i) => `
    <div class="batch-item">
      <span class="seq-name">${escHtml(s.name)}</span>
      <span class="seq-len">${s.sequence.length} aa</span>
      <button class="remove-btn" onclick="removeBatchItem(${i})">×</button>
    </div>
  `).join('');
}
 
function removeBatchItem(i) {
  batchSequences.splice(i, 1);
  renderBatchList();
}
 
function clearBatch() {
  batchSequences = [];
  renderBatchList();
  document.getElementById('batchDropzone').classList.remove('loaded');
  document.getElementById('batchDropzone').querySelector('.dropzone-text').innerHTML = '<strong>Click or drop</strong> a multi-sequence FASTA';
  document.getElementById('batchLog').innerHTML = '';
}
 
// --- Single Submission ---
async function submitSingle() {
  if (isSubmitting) return;
 
  const jobName = document.getElementById('jobName').value.trim();
  const stripHeaders = document.getElementById('stripHeaders').checked;
 
  let seq = '';
  if (inputMode === 'raw') {
    let raw = document.getElementById('rawSequence').value.trim();
    if (stripHeaders) raw = raw.split('\n').filter(l => !l.startsWith('>')).join('');
    seq = cleanSequence(raw);
  } else {
    seq = singleSequence;
  }
 
  if (!seq) { logMsg('log', 'No sequence provided', 'err'); return; }
  if (!jobName) { logMsg('log', 'Job name is required', 'err'); return; }
 
  isSubmitting = true;
  setSubmitLoading(true);
 
  const autoConfirm = document.getElementById('autoConfirm').checked;
  const trackJobs = document.getElementById('trackJobs').checked;
 
  logMsg('log', `Submitting: ${jobName} (${seq.length} residues)`, 'info');
  setProgress('singleProgress', 'singleProgressBar', 10);
 
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url.includes('alphafoldserver.com')) {
      logMsg('log', 'Please navigate to alphafoldserver.com first', 'err');
      throw new Error('Wrong page');
    }
 
    setProgress('singleProgress', 'singleProgressBar', 30);
 
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: automateJobSubmission,
      args: [{ sequence: seq, jobName, autoConfirm }]
    });
 
    setProgress('singleProgress', 'singleProgressBar', 90);
 
    const res = result[0]?.result;
    if (res?.success) {
      logMsg('log', `✓ Job submitted successfully`, 'ok');
      if (trackJobs) addTrackedJob(jobName, 'pending');
      setProgress('singleProgress', 'singleProgressBar', 100);
      setTimeout(() => setProgress('singleProgress', 'singleProgressBar', 0, true), 1500);
    } else {
      logMsg('log', `Error: ${res?.error || 'Unknown error'}`, 'err');
      setProgress('singleProgress', 'singleProgressBar', 0, true);
    }
  } catch (err) {
    logMsg('log', `Failed: ${err.message}`, 'err');
    setProgress('singleProgress', 'singleProgressBar', 0, true);
  } finally {
    isSubmitting = false;
    setSubmitLoading(false);
  }
}
 
// --- Batch Submission ---
async function submitBatch() {
  if (isSubmitting || batchSequences.length === 0) return;
  isSubmitting = true;
 
  const autoConfirm = document.getElementById('autoConfirm').checked;
  const trackJobs = document.getElementById('trackJobs').checked;
  const delay = parseInt(document.getElementById('batchDelay').value) || 3;
 
  document.getElementById('submitBatch').disabled = true;
  logMsg('batchLog', `Starting batch: ${batchSequences.length} jobs`, 'info');
 
  for (let i = 0; i < batchSequences.length; i++) {
    const item = batchSequences[i];
    const pct = Math.round(((i) / batchSequences.length) * 100);
    setProgress('batchProgress', 'batchProgressBar', pct);
    logMsg('batchLog', `[${i+1}/${batchSequences.length}] Submitting: ${item.name}`, 'info');
 
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url.includes('alphafoldserver.com')) {
        logMsg('batchLog', 'Not on alphafoldserver.com — aborting', 'err');
        break;
      }
 
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: automateJobSubmission,
        args: [{ sequence: item.sequence, jobName: item.name.substring(0, 40), autoConfirm }]
      });
 
      const res = result[0]?.result;
      if (res?.success) {
        logMsg('batchLog', `✓ ${item.name} submitted`, 'ok');
        if (trackJobs) addTrackedJob(item.name, 'pending');
      } else {
        logMsg('batchLog', `✗ ${item.name}: ${res?.error || 'failed'}`, 'err');
      }
    } catch (err) {
      logMsg('batchLog', `✗ ${item.name}: ${err.message}`, 'err');
    }
 
    if (i < batchSequences.length - 1) {
      logMsg('batchLog', `Waiting ${delay}s...`, 'warn');
      await sleep(delay * 1000);
    }
  }
 
  setProgress('batchProgress', 'batchProgressBar', 100);
  logMsg('batchLog', `Batch complete`, 'ok');
  setTimeout(() => setProgress('batchProgress', 'batchProgressBar', 0, true), 2000);
  isSubmitting = false;
  document.getElementById('submitBatch').disabled = false;
}
 
// --- Content Script Function (injected into page) ---
function automateJobSubmission({ sequence, jobName, autoConfirm }) {
  return new Promise((resolve) => {
    // Helper: find element by class substring match
    function findByClass(classSubstring, tagName = null) {
      const all = document.querySelectorAll(tagName ? tagName : '*');
      for (const el of all) {
        if (el.className && typeof el.className === 'string' && el.className.includes(classSubstring)) {
          return el;
        }
      }
      return null;
    }
 
    function findButtonByClass(classSubstring) {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.className && btn.className.includes(classSubstring)) return btn;
      }
      return null;
    }
 
    function setNativeValue(el, value) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value') ||
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (nativeInputValueSetter) nativeInputValueSetter.set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
 
    function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
 
    async function run() {
      try {
        // Step 1: Find and fill the sequence input textarea
        const seqInput = document.querySelector('.sequence-input') ||
          findByClass('sequence-input') ||
          findByClass('mat-mdc-input-element');
 
        if (!seqInput) return { success: false, error: 'Sequence input not found on page' };
 
        seqInput.focus();
        setNativeValue(seqInput, sequence);
        await delay(400);
 
        // Step 2: Find and fill the job name input
        // Job name input has ng-valid (vs sequence which has ng-invalid initially)
        const allInputs = document.querySelectorAll('input.mat-mdc-input-element');
        let jobNameInput = null;
        for (const inp of allInputs) {
          if (inp.className.includes('ng-valid') || inp.type === 'text') {
            jobNameInput = inp;
          }
        }
        if (!jobNameInput) {
          jobNameInput = findByClass('dmat-mdc-input', 'input');
        }
        if (jobNameInput) {
          jobNameInput.focus();
          setNativeValue(jobNameInput, jobName);
          await delay(300);
        }
 
        // Step 3: Click "Continue and Preview Job" button
        let previewBtn = findButtonByClass('create-request');
        if (!previewBtn) previewBtn = findButtonByClass('mat-mdc-unelevated-button');
        if (!previewBtn) {
          const btns = document.querySelectorAll('button');
          for (const b of btns) {
            if (b.textContent.toLowerCase().includes('continue') || b.textContent.toLowerCase().includes('preview')) {
              previewBtn = b;
              break;
            }
          }
        }
 
        if (!previewBtn) return { success: false, error: 'Preview/Continue button not found' };
 
        previewBtn.click();
        await delay(1500);
 
        // Step 4: Optionally click "Confirm and Submit"
        if (autoConfirm) {
          let confirmBtn = findButtonByClass('confirm');
          if (!confirmBtn) {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
              if (b.textContent.toLowerCase().includes('confirm') || b.textContent.toLowerCase().includes('submit')) {
                confirmBtn = b;
                break;
              }
            }
          }
 
          if (!confirmBtn) return { success: false, error: 'Confirm button not found after clicking preview' };
 
          confirmBtn.click();
          await delay(800);
        }
 
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
 
    run().then(resolve);
  });
}
 
// --- Job Tracking ---
async function addTrackedJob(name, status) {
  const { trackedJobs = [] } = await chrome.storage.local.get('trackedJobs');
  trackedJobs.unshift({ name, status, time: Date.now() });
  if (trackedJobs.length > 50) trackedJobs.length = 50;
  await chrome.storage.local.set({ trackedJobs });
}
 
async function renderJobs() {
  const { trackedJobs = [] } = await chrome.storage.local.get('trackedJobs');
  const grid = document.getElementById('jobsGrid');
  if (trackedJobs.length === 0) {
    grid.innerHTML = '<div class="no-jobs">No jobs tracked yet.</div>';
    return;
  }
  grid.innerHTML = trackedJobs.map((j, i) => `
    <div class="job-card">
      <div class="job-status-dot ${j.status}"></div>
      <div class="job-name">${escHtml(j.name)}</div>
      <div class="job-status-label ${j.status}">${j.status}</div>
    </div>
  `).join('');
}
 
async function refreshJobs() {
  // Try to scrape job statuses from the current page
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url.includes('alphafoldserver.com')) {
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeJobStatuses
      });
      const scraped = result[0]?.result || [];
      if (scraped.length > 0) {
        const { trackedJobs = [] } = await chrome.storage.local.get('trackedJobs');
        // Update statuses for matching job names
        for (const scraped_job of scraped) {
          const match = trackedJobs.find(j => j.name === scraped_job.name);
          if (match) match.status = scraped_job.status;
        }
        await chrome.storage.local.set({ trackedJobs });
      }
    }
  } catch {}
  renderJobs();
}
 
function scrapeJobStatuses() {
  const jobs = [];
  const cards = document.querySelectorAll('[mattooltip]');
  cards.forEach(el => {
    const status = el.getAttribute('mattooltip');
    if (status === 'pending' || status === 'succeeded' || status === 'failed') {
      // Try to find nearby job name
      const row = el.closest('tr') || el.closest('.job-row') || el.parentElement;
      const nameEl = row ? row.querySelector('[class*="name"]') : null;
      jobs.push({ name: nameEl ? nameEl.textContent.trim() : 'unknown', status });
    }
  });
  return jobs;
}
 
async function clearJobs() {
  await chrome.storage.local.set({ trackedJobs: [] });
  renderJobs();
}
 
// --- Settings ---
function saveSettings() {
  chrome.storage.local.set({
    settings: {
      autoConfirm: document.getElementById('autoConfirm').checked,
      stripHeaders: document.getElementById('stripHeaders').checked,
      trackJobs: document.getElementById('trackJobs').checked,
      batchDelay: document.getElementById('batchDelay').value
    }
  });
}
 
async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) return;
  document.getElementById('autoConfirm').checked = settings.autoConfirm ?? true;
  document.getElementById('stripHeaders').checked = settings.stripHeaders ?? true;
  document.getElementById('trackJobs').checked = settings.trackJobs ?? true;
  if (settings.batchDelay) document.getElementById('batchDelay').value = settings.batchDelay;
}
 
// --- Utilities ---
function logMsg(logId, msg, type = 'info') {
  const log = document.getElementById(logId);
  const now = new Date();
  const time = now.toTimeString().slice(0, 8);
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-time">${time}</span><span class="log-msg ${type}">${escHtml(msg)}</span>`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}
 
function setProgress(wrapId, barId, pct, hide = false) {
  const wrap = document.getElementById(wrapId);
  const bar = document.getElementById(barId);
  if (hide) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  bar.style.width = pct + '%';
}
 
function setSubmitLoading(loading) {
  const btn = document.getElementById('submitSingle');
  const txt = document.getElementById('submitBtnText');
  btn.disabled = loading;
  txt.innerHTML = loading ? '<span class="spinner"></span> Submitting...' : '🚀 Submit Job';
}
 
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }