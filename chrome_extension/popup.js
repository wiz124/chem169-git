// ── AlphaFold Server Automation ─────────────────────────────────────────────
// Hardcoded target selectors matching AlphaFold Server's Angular/MDC elements

const AF = {
  JOB_SEQ_INPUT: '[class="mat-mdc-input-element cdk-textarea-autosize sequence-input dmat-mdc-input mat-mdc-form-field-textarea-control mat-mdc-form-field-input-control mdc-text-field__input ng-pristine ng-invalid cdk-text-field-autofill-monitored ng-touched"]',
  // Step 1 — fill the job-name <input>
  JOB_NAME_INPUT: '[class="mat-mdc-input-element dmat-mdc-input mat-mdc-form-field-input-control mdc-text-field__input ng-pristine ng-valid cdk-text-field-autofill-monitored ng-touched"]',

  // Step 2 — click "Continue & Preview Job"
  CONTINUE_BTN: '[class="mdc-button mat-mdc-button-base create-request mdc-button--unelevated mat-mdc-unelevated-button mat-primary dmat-mdc-button"]',

  // Step 3 — click "Confirm & Submit Job"
  CONFIRM_BTN: '[class=mdc-button mat-mdc-button-base confirm mdc-button--unelevated mat-mdc-unelevated-button mat-primary dmat-mdc-button"]',

  // Monitor: detect pending / succeeded jobs by their matTooltip attribute
  PENDING_JOB:   '[mattooltip="pending"]',
  SUCCEEDED_JOB: '[mattooltip="succeeded"]',
};

// Inter-step delays (ms) — tuned for AlphaFold Server's Angular rendering latency
const DELAY = {
  AFTER_SEQ_INPUT: 1000,
  AFTER_NAME_INPUT: 600,   // wait for Angular to register the value change
  AFTER_CONTINUE:   2500,  // preview modal takes ~2s to render
  AFTER_CONFIRM:    1500,  // submission confirmation
  BETWEEN_JOBS:     3000,  // gap between sequential job submissions
};

// ── State ────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

let fastaSequences = [];
let selectedSeqIndex = 0;
let submitMode = 'selected'; // 'selected' | 'all'
let isRunning = false;
let monitorTimer = null;
let currentPanel = 'submit';

// Queue: [{seqName, jobName, status: 'queued'|'running'|'pending'|'done'|'failed'}]
let queue = [];

// ── Tab navigation ────────────────────────────────────────────────────────────
$('tabSubmit').addEventListener('click',  () => switchPanel('submit'));
$('tabMonitor').addEventListener('click', () => switchPanel('monitor'));
$('tabQueue').addEventListener('click',   () => switchPanel('queue'));

function switchPanel(name) {
  currentPanel = name;
  ['submit','monitor','queue'].forEach(p => {
    $(`tab${p.charAt(0).toUpperCase()+p.slice(1)}`).classList.toggle('active', p === name);
    $(`${p}Panel`).classList.toggle('hidden', p !== name);
  });
  if (name === 'queue') renderQueue();
}

// ── Pipeline step highlights ──────────────────────────────────────────────────
function setStep(n, state) {
  // state: 'active' | 'done' | 'error' | ''
  const el = $(`step${n}`);
  el.className = 'step' + (state ? ' ' + state : '');
}
function resetSteps() { [1,2,3,4].forEach(n => setStep(n, '')); setStep(1,'active'); }

// ── FASTA: drag-and-drop + file picker ───────────────────────────────────────
const dropZone  = $('dropZone');
const fastaFile = $('fastaFile');

dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', ()=> dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const files = [...e.dataTransfer.files].filter(isFastaFile);
  if (files.length) loadFastaFiles(files);
});
fastaFile.addEventListener('change', () => { if (fastaFile.files.length) loadFastaFiles([...fastaFile.files]); });

$('clearFasta').addEventListener('click', () => {
  fastaSequences = []; selectedSeqIndex = 0; fastaFile.value = '';
  $('seqPanel').style.display = 'none';
  renderSeqList(); resetSteps();
  $('runBtn').disabled = true;
  setStatus('', 'Load a FASTA file to begin');
});

function isFastaFile(f) {
  return /\.(fasta|fa|fna|ffn|faa|frn|txt)$/i.test(f.name) || f.type === 'text/plain';
}

async function loadFastaFiles(files) {
  const all = [];
  for (const f of files) all.push(...parseFasta(await f.text()));
  if (!all.length) { setStatus('error','No valid FASTA sequences found'); return; }
  fastaSequences = all;
  selectedSeqIndex = 0;
  $('seqPanel').style.display = 'flex';
  renderSeqList();
  setStep(1,'done'); setStep(2,'active');
  $('runBtn').disabled = false;
  setStatus('success', `Loaded ${all.length} sequence${all.length>1?'s':''} — ready to submit`);
}

// ── FASTA parser ──────────────────────────────────────────────────────────────
function parseFasta(text) {
  const out = []; let hdr = null, lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    if (line.startsWith('>')) {
      if (hdr !== null) { const r = mkRecord(hdr, lines); if (r) out.push(r); }
      hdr = line.slice(1).trim(); lines = [];
    } else {
      if (hdr === null) continue;
      const c = line.replace(/\s/g,'').toUpperCase();
      if (/^[ACDEFGHIKLMNPQRSTVWYBZXJUORYKSWMBDHVN\-\.\*]+$/i.test(c)) lines.push(c);
    }
  }
  if (hdr !== null) { const r = mkRecord(hdr, lines); if (r) out.push(r); }
  return out;
}
function mkRecord(header, lines) {
  const sequence = lines.join('');
  if (!sequence) return null;
  return { header, name: header.split(/\s+/)[0].slice(0,40), sequence };
}

// ── Sequence list UI ──────────────────────────────────────────────────────────
function renderSeqList() {
  const list = $('seqList');
  $('seqCount').textContent = `${fastaSequences.length} sequence${fastaSequences.length!==1?'s':''}`;
  if (!fastaSequences.length) { list.classList.remove('visible'); return; }
  list.classList.add('visible');
  list.innerHTML = '';
  fastaSequences.forEach((seq, i) => {
    const item = document.createElement('div');
    item.className = 'seq-item' + (i === selectedSeqIndex ? ' selected' : '');
    item.innerHTML = `
      <div class="seq-check">${i===selectedSeqIndex?'✓':''}</div>
      <span class="seq-name" title="${esc(seq.header)}">${esc(seq.name)}</span>
      <span class="seq-meta">${seq.sequence.length} aa</span>`;
    item.addEventListener('click', () => {
      selectedSeqIndex = i;
      renderSeqList();
    });
    list.appendChild(item);
  });
}

function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Submit mode ───────────────────────────────────────────────────────────────
$('modeSelected').addEventListener('click', () => {
  submitMode = 'selected';
  $('modeSelected').classList.add('active');
  $('modeAll').classList.remove('active');
});
$('modeAll').addEventListener('click', () => {
  submitMode = 'all';
  $('modeAll').classList.add('active');
  $('modeSelected').classList.remove('active');
});

// ── Build job list from current state ─────────────────────────────────────────
function buildJobs() {
  const prefix = $('jobNamePrefix').value.trim();
  const seqs = submitMode === 'all' ? fastaSequences : [fastaSequences[selectedSeqIndex]];
  return seqs.map(seq => ({
    seqName: seq.name,
    jobName: prefix ? `${prefix}_${seq.name}` : seq.name,
    sequence: seq.sequence,
    status: 'queued',
  }));
}

// ── Run pipeline ──────────────────────────────────────────────────────────────
$('runBtn').addEventListener('click', async () => {
  if (isRunning || !fastaSequences.length) return;

  const jobs = buildJobs();
  queue = jobs;
  renderQueue();
  switchPanel('queue');

  isRunning = true;
  $('runBtn').disabled = true;
  $('stopBtn').classList.add('visible');

  setStep(2,'done'); setStep(3,'active');
  showProgress(0, jobs.length);

  for (let i = 0; i < jobs.length; i++) {
    if (!isRunning) break;
    const job = jobs[i];
    job.status = 'running';
    renderQueue();
    setStatus('active', `Submitting ${i+1}/${jobs.length}: ${job.jobName}`);
    showProgress(i, jobs.length);

    const ok = await submitJob(job);
    job.status = ok ? 'pending' : 'failed';
    renderQueue();

    if (!ok) setStatus('warn', `Job "${job.jobName}" submission failed — continuing`);

    if (i < jobs.length - 1) await sleep(DELAY.BETWEEN_JOBS);
  }

  showProgress(jobs.length, jobs.length);
  const nOk     = jobs.filter(j => j.status === 'pending').length;
  const nFailed = jobs.filter(j => j.status === 'failed').length;

  if (nFailed === 0) {
    setStatus('success', `✓ All ${nOk} job${nOk!==1?'s':''} submitted — now monitoring`);
    setStep(3,'done'); setStep(4,'active');
    // Auto-switch to monitor tab and start polling
    switchPanel('monitor');
    startMonitor();
  } else {
    setStatus('warn', `${nOk} submitted, ${nFailed} failed — see Queue tab`);
    setStep(3, nFailed > 0 ? 'error' : 'done');
  }

  isRunning = false;
  $('runBtn').disabled = false;
  $('stopBtn').classList.remove('visible');
});

$('stopBtn').addEventListener('click', () => {
  isRunning = false;
  setStatus('error','Stopped by user');
  $('runBtn').disabled = false;
  $('stopBtn').classList.remove('visible');
});

// ── Core job submission logic ─────────────────────────────────────────────────
async function submitJob(job) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
//Step A: inject sequence into name field
const seqOk=await sendMsg(tab.id, {
  action:'afsubmitsequence',
  selector:AF.JOB_SEQ_INPUT,
  value:job.jobName,
});
if (!seqOK) return false;
await sleep(DELAY.AFTER_SEQ_INPUT)

}
//   // Step A: inject job name into the name field
//   const nameOk = await sendMsg(tab.id, {
//     action: 'afInjectName',
//     selector: AF.JOB_NAME_INPUT,
//     value: job.jobName,
//   });
//   if (!nameOk) return false;
//   await sleep(DELAY.AFTER_NAME_INPUT);

//   // Step B: inject sequence into the page
//   // AlphaFold Server uses a custom textarea/contenteditable — handled by content script
//   const seqOk = await sendMsg(tab.id, {
//     action: 'afInjectSequence',
//     sequence: job.sequence,
//   });
//   if (!seqOk) return false;
//   await sleep(DELAY.AFTER_NAME_INPUT);

//   // Step C: click "Continue & Preview Job"
//   const contOk = await sendMsg(tab.id, {
//     action: 'afClick',
//     selector: AF.CONTINUE_BTN,
//   });
//   if (!contOk) return false;
//   await sleep(DELAY.AFTER_CONTINUE);

//   // Step D: click "Confirm & Submit Job"
//   const confirmOk = await sendMsg(tab.id, {
//     action: 'afClick',
//     selector: AF.CONFIRM_BTN,
//   });
//   if (!confirmOk) return false;
//   await sleep(DELAY.AFTER_CONFIRM);

//   return true;
// }

function sendMsg(tabId, msg) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, msg, res => {
      if (chrome.runtime.lastError) { resolve(false); return; }
      resolve(res?.success ?? false);
    });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Progress bar ──────────────────────────────────────────────────────────────
function showProgress(done, total) {
  const wrap = $('progWrap'), bar = $('progBar');
  wrap.classList.add('visible');
  bar.style.width = total > 0 ? `${Math.round((done/total)*100)}%` : '0%';
}

// ── Queue rendering ───────────────────────────────────────────────────────────
function renderQueue() {
  const grid = $('queueGrid');
  // Keep header row, replace rest
  const hdr = grid.querySelector('.hdr');
  grid.innerHTML = '';
  grid.appendChild(hdr);
  if (!queue.length) {
    const empty = document.createElement('div');
    empty.className = 'q-row';
    empty.style.gridTemplateColumns = '1fr';
    empty.innerHTML = `<span style="color:var(--muted);font-size:11px;padding:4px 0">No jobs queued yet</span>`;
    grid.appendChild(empty);
    return;
  }
  queue.forEach(job => {
    const row = document.createElement('div');
    row.className = 'q-row';
    row.style.gridTemplateColumns = '1fr 90px';
    row.innerHTML = `
      <span class="q-name" title="${esc(job.jobName)}">${esc(job.jobName)}</span>
      ${badgeHtml(job.status)}`;
    grid.appendChild(row);
  });
}

function badgeHtml(status) {
  const map = {
    queued:  ['queued',  'Queued'],
    running: ['running', 'Running'],
    pending: ['pending', 'Pending'],
    done:    ['done',    'Done'],
    failed:  ['failed',  'Failed'],
  };
  const [cls, label] = map[status] || ['queued','?'];
  return `<span class="badge badge-${cls}">${label}</span>`;
}

$('clearDoneBtn').addEventListener('click', () => {
  queue = queue.filter(j => j.status !== 'done');
  renderQueue();
});
$('retryFailedBtn').addEventListener('click', async () => {
  const failed = queue.filter(j => j.status === 'failed');
  if (!failed.length) return;
  failed.forEach(j => j.status = 'queued');
  renderQueue();
  // re-run only failed jobs
  isRunning = true;
  $('runBtn').disabled = true;
  $('stopBtn').classList.add('visible');
  for (const job of failed) {
    if (!isRunning) break;
    job.status = 'running'; renderQueue();
    const ok = await submitJob(job);
    job.status = ok ? 'pending' : 'failed';
    renderQueue();
    await sleep(DELAY.BETWEEN_JOBS);
  }
  isRunning = false;
  $('runBtn').disabled = false;
  $('stopBtn').classList.remove('visible');
});

// ── Monitor ───────────────────────────────────────────────────────────────────
$('startMonitorBtn').addEventListener('click', startMonitor);
$('stopMonitorBtn').addEventListener('click',  stopMonitor);

function startMonitor() {
  if (monitorTimer) return;
  $('startMonitorBtn').style.display = 'none';
  $('stopMonitorBtn').classList.add('visible');
  setMonitorStatus('active', 'Polling AlphaFold Server…');
  pollJobs();
  const interval = Math.max(5, parseInt($('pollInterval').value) || 15) * 1000;
  monitorTimer = setInterval(pollJobs, interval);
}

function stopMonitor() {
  clearInterval(monitorTimer); monitorTimer = null;
  $('startMonitorBtn').style.display = '';
  $('stopMonitorBtn').classList.remove('visible');
  setMonitorStatus('', 'Stopped');
}

async function pollJobs() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: 'afPollJobs', selectors: AF }, res => {
    if (chrome.runtime.lastError || !res) {
      setMonitorStatus('error', 'Cannot reach page — make sure AlphaFold Server is open');
      return;
    }
    renderJobGrid(res.jobs || []);
    // Update queue statuses for submitted jobs
    if (res.jobs) {
      res.jobs.forEach(j => {
        const q = queue.find(q => q.jobName === j.name);
        if (q && j.status === 'succeeded') q.status = 'done';
      });
    }
    setMonitorStatus('active', `Last polled ${new Date().toLocaleTimeString()}`);
  });
}

function renderJobGrid(jobs) {
  const grid = $('jobGrid');
  const hdr = grid.querySelector('.hdr');
  grid.innerHTML = ''; grid.appendChild(hdr);
  if (!jobs.length) {
    const r = document.createElement('div');
    r.className = 'q-row';
    r.innerHTML = `<span style="color:var(--muted);font-size:11px;grid-column:1/-1">No jobs found on page</span>`;
    grid.appendChild(r); return;
  }
  jobs.forEach(j => {
    const row = document.createElement('div');
    row.className = 'q-row';
    const statusMap = { pending:'pending', succeeded:'done', failed:'failed', running:'running' };
    const cls = statusMap[j.status] || 'queued';
    row.innerHTML = `<span class="q-name" title="${esc(j.name)}">${esc(j.name)}</span>${badgeHtml(cls)}`;
    grid.appendChild(row);
  });
  grid.classList.add('visible');
}

function setMonitorStatus(type, msg) {
  $('monitorStatus').className = 'status' + (type ? ' '+type : '');
  $('monitorStatusText').textContent = msg;
}

// ── Status bar ────────────────────────────────────────────────────────────────
function setStatus(type, msg) {
  $('status').className = 'status' + (type ? ' '+type : '');
  $('statusText').textContent = msg;
}
