// ── AlphaFold Server content script ──────────────────────────────────────────
// Handles DOM interactions for the AlphaFold Server Angular/MDC UI

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── Inject job name into the Angular MDC input ────────────────────────────
  if (msg.action === 'afInjectName') {
    const el = queryFirst(msg.selector);
    if (!el) { sendResponse({ success: false, reason: 'name input not found' }); return true; }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();
    setNativeValue(el, msg.value);
    // Dispatch all events Angular listens to
    ['input','change','blur'].forEach(evt =>
      el.dispatchEvent(new Event(evt, { bubbles: true }))
    );
    // Also fire a keyboard event so Angular's CDK detects the change
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    sendResponse({ success: true });
    return true;
  }

  // ── Inject protein/nucleotide sequence ───────────────────────────────────
  // AlphaFold Server's sequence input can be a <textarea> or a
  // contenteditable div — we probe both.
  if (msg.action === 'afInjectSequence') {
    // Try common AlphaFold Server sequence field selectors
    const candidateSelectors = [
      'textarea[data-testid="sequence-input"]',
      'textarea.sequence-input',
      'textarea[placeholder*="sequence"]',
      'textarea[placeholder*="FASTA"]',
      '[contenteditable="true"].sequence',
      '[contenteditable="true"][class*="sequence"]',
      'textarea',                             // last-resort: first textarea on page
    ];

    let el = null;
    for (const sel of candidateSelectors) {
      try { el = document.querySelector(sel); } catch(e) {}
      if (el) break;
    }

    if (!el) { sendResponse({ success: false, reason: 'sequence field not found' }); return true; }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();

    if (el.isContentEditable) {
      // Select all existing content and replace
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, msg.sequence);
    } else {
      setNativeValue(el, msg.sequence);
      ['input','change'].forEach(evt =>
        el.dispatchEvent(new Event(evt, { bubbles: true }))
      );
    }
    sendResponse({ success: true });
    return true;
  }

  // ── Click a button by CSS selector ───────────────────────────────────────
  if (msg.action === 'afClick') {
    const el = queryFirst(msg.selector);
    if (!el) { sendResponse({ success: false, reason: `not found: ${msg.selector}` }); return true; }

    // Check the button isn't disabled
    if (el.disabled || el.getAttribute('disabled') !== null || el.classList.contains('disabled')) {
      sendResponse({ success: false, reason: 'button is disabled' }); return true;
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      el.click();
      sendResponse({ success: true });
    }, 80);
    return true;
  }

  // ── Poll page for job statuses ────────────────────────────────────────────
  if (msg.action === 'afPollJobs') {
    const jobs = [];

    // Pending jobs
    document.querySelectorAll('[mattooltip="pending"]').forEach(el => {
      jobs.push({ name: extractJobName(el), status: 'pending' });
    });
    // Succeeded jobs
    document.querySelectorAll('[mattooltip="succeeded"]').forEach(el => {
      jobs.push({ name: extractJobName(el), status: 'succeeded' });
    });
    // Failed jobs
    document.querySelectorAll('[mattooltip="failed"]').forEach(el => {
      jobs.push({ name: extractJobName(el), status: 'failed' });
    });
    // Running jobs
    document.querySelectorAll('[mattooltip="running"]').forEach(el => {
      jobs.push({ name: extractJobName(el), status: 'running' });
    });

    sendResponse({ success: true, jobs });
    return true;
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Find the first element matching a space-separated list of class names.
 * Falls back to document.querySelector for full CSS selectors.
 */
function queryFirst(selector) {
  // Try as-is first
  try {
    const el = document.querySelector(selector);
    if (el) return el;
  } catch(e) {}

  // If selector looks like it has multiple class names (not a valid CSS selector),
  // find elements that have ALL the listed classes
  if (/^[\w\-][\w\s\-]*$/.test(selector)) {
    const classes = selector.trim().split(/\s+/);
    const els = document.querySelectorAll(`.${CSS.escape(classes[0])}`);
    for (const el of els) {
      if (classes.every(c => el.classList.contains(c))) return el;
    }
  }
  return null;
}

/**
 * Set the value of a React/Angular-controlled input element,
 * bypassing the framework's getter/setter caching.
 */
function setNativeValue(el, value) {
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

/**
 * Extract a human-readable job name from a job-row element.
 * AlphaFold Server renders the name as sibling/ancestor text.
 */
function extractJobName(el) {
  // Walk up to the nearest row/card container and read its text content
  let node = el;
  for (let i = 0; i < 5; i++) {
    if (!node.parentElement) break;
    node = node.parentElement;
    // Look for a child with a job name class
    const nameEl = node.querySelector('[class*="name"], [class*="title"], .job-name');
    if (nameEl) return nameEl.textContent.trim();
  }
  // Fallback: grab meaningful text from the row
  const rowText = (el.closest('tr, [role="row"], .job-row, .request-row, mat-row') ||
                   el.parentElement)?.textContent?.trim() ?? '';
  return rowText.slice(0, 60) || '(unknown)';
}
