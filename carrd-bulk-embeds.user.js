// ==UserScript==
// @name         Carrd Bulk Embed Importer
// @namespace    local.carrd.bulk-embeds
// @version      1.4.0
// @description  Import ordered TXT segments into Carrd embeds, update or replace, with backups.
// @match        https://carrd.co/build/*
// @match        https://carrd.com/build/*
// @match        https://carrd.co/dashboard/*/build*
// @match        https://carrd.com/dashboard/*/build*
// @run-at       document-idle
// @grant        none
// @sandbox      raw
// @noframes
// ==/UserScript==

// INSTALL: Tampermonkey > Create a new script > replace its contents with this
// entire file > Save. Reload the Carrd editor. The panel appears bottom-right.
// USE: Choose all TXT segments, review their numeric filename order, then run.
// Update affects ALL embeds in page order; use it for a dedicated code container/site.
// Replace stages new embeds beside the originals, verifies them, then removes originals.
// Copy your Carrd site first if layout/advanced attributes need to be recoverable.
// The downloaded JSON restores code/titles/placement settings through this panel,
// but cannot reconstruct container positions, custom IDs, or other advanced options.

(() => {
  'use strict';
  if (document.getElementById('cbe-host')) return;
  const KEY = 'carrd-bulk-embeds-controls-v2';
  const defaults = {
    add: '#menu [data-menu="add"]', embed: '#menu [data-action="add-embed"]',
    code: '#embed-embed_code_content', label: '#embed-embed_title',
    done: '#properties-panel footer .buttons .do-close', remove: '#properties-panel footer [data-action="remove"]'
  };
  let config;
  try { config = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { config = { ...defaults }; }
  let files = [], busy = false, stopped = false, backup = null, picking = false;
  const host = document.createElement('div');
  host.id = 'cbe-host';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
  document.documentElement.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    *{box-sizing:border-box} .panel{width:370px;max-height:85vh;overflow:auto;background:#171c27;color:#eef2ff;border:1px solid #45516b;border-radius:14px;padding:16px;font:13px/1.5 system-ui;box-shadow:0 10px 50px #0008}
    h2{font-size:17px;margin:0 0 8px} p{margin:8px 0} button,select,input{font:inherit} button,select{border:1px solid #596780;border-radius:6px;background:#29334a;color:#fff;padding:6px 9px} button{cursor:pointer} button:disabled{opacity:.45;cursor:default} .row{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0} .primary{background:#476ce0} label{display:block;margin:10px 0 4px} select{width:100%} ol{max-height:160px;overflow:auto;padding-left:28px} li{padding:3px 0;overflow-wrap:anywhere} li button{padding:0 5px;margin-left:4px} pre{white-space:pre-wrap;max-height:150px;overflow:auto;background:#0d121c;padding:9px;border-radius:6px;font:12px/1.5 system-ui} summary{cursor:pointer} small{color:#bcc8df} .close{float:right} .launcher{display:none} input[type=file]{max-width:100%}
  </style><button class="launcher">Bulk embeds</button><section class="panel">
    <button class="close" title="Minimize">−</button><h2>Carrd bulk embeds · 1.4</h2>
    <small>One TXT file → one Code embed. Nothing is published automatically.</small>
    <label>Choose or drop segmented UTF-8 TXT files (or a backup JSON)</label><input id="files" type="file" accept=".txt,.json" multiple>
    <small>Files can also be dropped anywhere on this panel.</small>
    <ol id="list"></ol>
    <label>Action</label><select id="mode"><option value="update">Update all existing embeds + add missing</option><option value="replace">Delete all existing embeds + recreate</option></select>
    <label>Embed names</label><select id="naming"><option value="numbers">Numbers: 0, 1, 2, …</option><option value="filenames">Use filenames</option><option value="keep">Keep existing names</option></select>
    <label><input id="auto-backup" type="checkbox"> Automatically download a backup before importing</label>
    <label>Placement for new embeds</label><select id="placement"><option value="inline">Inline</option><option value="head">Hidden: Head</option><option value="body-start">Hidden: Body Top</option><option value="body-end">Hidden: Body End</option></select>
    <label><input id="defer" type="checkbox" checked> Defer scripts in new Inline embeds</label>
    <p><small>Existing embeds are matched in document order. All must be Code embeds. Updates preserve their settings. Replacement builds beside the originals, verifies the new code, then deletes the originals. It reuses code placement and defer settings by position. Extra embeds use the settings above.</small></p>
    <details><summary>Advanced: repair control detection</summary><p>Controls are preconfigured for Carrd. If its interface changes, open a Code embed. Click a setup button below, then click the corresponding Carrd control. The click only records its location.</p>
    <div class="row"><button data-pick="code">Pick Code field</button><button data-pick="label">Pick Label field</button><button data-pick="done">Pick Done</button><button data-pick="remove">Pick Delete</button></div>
    <p><small>Code, Title/Label and Done are required. Delete is needed for Replace. Carrd’s editable text facades, plain textareas and CodeMirror 5 are supported.</small></p><button id="reset">Reset setup</button><pre id="setup"></pre></details>
    <div class="row"><button id="scan">Scan embeds</button><button id="run" class="primary">Review & run</button><button id="stop" disabled>Stop</button><button id="backup" disabled>Download backup</button></div>
    <pre id="status" role="status">Choose files, check order, then run. Use Scan embeds to check what will be included.</pre>
  </section>`;
  const $ = s => root.querySelector(s);
  const status = message => { $('#status').textContent = message; };
  const visible = el => el && el.isConnected && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const embeds = () => [...document.querySelectorAll('#canvas .component-wrapper[data-type="embed"][data-id]')];
  const ids = () => embeds().map(el => el.dataset.id);
  const byId = id => embeds().find(el => el.dataset.id === id);
  // Compare content strictly, allowing only platform line-ending differences.
  const normalize = s => s.replace(/\r\n?/g, '\n');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  function check() { if (stopped) throw Error('Stopped. Changes already made remain in the editor.'); }
  async function waitFor(fn, message, timeout = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      check(); const result = fn(); if (result) return result; await delay(100);
    }
    throw Error(message);
  }
  function control(key) {
    if (!config[key]) throw Error(`Set up the ${key} control first.`);
    const matches = [...document.querySelectorAll(config[key])].filter(el => visible(el) || visible(el.parentElement?.querySelector('.input-facade[contenteditable]')));
    if (matches.length !== 1) throw Error(`The ${key} control was not found uniquely. Re-open a Code embed and repeat its setup.`);
    return matches[0];
  }
  function click(el) {
    check();
    if (!visible(el) || el.disabled || el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true') throw Error('A required Carrd control is unavailable. Check your plan and editor state.');
    el.click();
  }
  function codeAdapter() {
    const mode = document.querySelector('#embed-embed_mode');
    if (mode && mode.value !== 'code') throw Error('This embed uses IFRAME mode. Switch it to Code or remove it before importing.');
    const el = control('code');
    const cm = el.CodeMirror || el.closest('.CodeMirror')?.CodeMirror;
    if (cm) return { get: () => cm.getValue(), set: value => { cm.setValue(value); cm.save?.(); }, max: -1 };
    if (!(el instanceof HTMLTextAreaElement)) throw Error('Unsupported code editor. Pick the actual Code textarea or a CodeMirror 5 editor.');
    return { get: () => el.value, set: value => setInput(el, value), max: el.maxLength };
  }
  function setInput(el, value) {
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) throw Error('The selected field is not a standard input. Repeat setup.');
    if (el.disabled || el.readOnly) throw Error('The selected field is disabled or read-only.');
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    // Carrd's own textarea change handler refreshes its editable facade.
    // Do not send input/blur to the facade: those handlers trim every line.
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function panelReady(id) {
    const panel = document.querySelector('#properties-panel');
    const target = byId(id)?.querySelector('.component');
    return visible(panel) && panel.classList.contains('visible') && !panel.classList.contains('is-changing') && target?.classList.contains('active');
  }
  async function open(id) {
    const el = byId(id);
    if (!el) throw Error(`Embed ${id} disappeared. Stop and rescan.`);
    el.scrollIntoView({ block: 'center' });
    const component = el.querySelector('.component');
    if (!component) throw Error(`Carrd’s canvas structure changed for ${id}.`);
    // A tap on an already-open component toggles its panel closed.
    if (!panelReady(id)) {
      check();
      // Carrd binds .on('tap', '.component', ...); .click() only stops bubbling.
      component.dispatchEvent(new CustomEvent('tap', { bubbles: true, cancelable: true }));
    }
    await waitFor(() => panelReady(id), `Carrd did not select ${id}. Close any open dialogs and exit Section View, then retry.`);
    const embedTab = document.querySelector('#properties-panel header li[data-name="embed"]');
    if (embedTab && !embedTab.classList.contains('active')) click(embedTab);
    await waitFor(() => document.querySelector(config.code), `The Code control for ${id} is missing. Use Reset setup under Advanced.`);
    // Only report IFRAME mode when the Type control actually says IFRAME.
    codeAdapter();
  }
  async function done() {
    click(control('done'));
    // Carrd detaches the form after a 250ms animation. Waiting only 220ms can
    // let that pending callback detach the *next* embed's newly opened form.
    await waitFor(() => {
      const panel = document.querySelector('#properties-panel');
      return !panel || getComputedStyle(panel).display === 'none';
    }, 'Carrd’s properties panel did not finish closing. Close it manually and retry.');
  }
  function snapshot(id) {
    const code = codeAdapter(), label = control('label');
    if (!('value' in label)) throw Error('Pick the actual Label input.');
    return { id, name: label.value || `${id}.txt`, title: label.value, code: code.get(), settings: readSettings() };
  }
  function readSettings() {
    return { style: document.querySelector('#embed-embed_code_style')?.value,
      location: document.querySelector('#embed-embed_code_location')?.value,
      defer: document.querySelector('#embed-embed_code_defer')?.checked };
  }
  function applySettings(settings) {
    if (!settings) return;
    const style = document.querySelector('#embed-embed_code_style');
    const location = document.querySelector('#embed-embed_code_location');
    const defer = document.querySelector('#embed-embed_code_defer');
    if (!style || !location || !defer) throw Error('Carrd placement controls changed. Stopping before writing code.');
    if (!['inline', 'hidden'].includes(settings.style) || !['head', 'body-start', 'body-end'].includes(settings.location) || typeof settings.defer !== 'boolean') throw Error('Invalid embed settings in backup.');
    setInput(style, settings.style);
    if (settings.style === 'hidden') setInput(location, settings.location);
    if (settings.style === 'inline' && defer.checked !== settings.defer) defer.click();
  }
  function validateSettings(settings) {
    if (settings && (!['inline', 'hidden'].includes(settings.style) || !['head', 'body-start', 'body-end'].includes(settings.location) || typeof settings.defer !== 'boolean')) throw Error('Invalid embed settings in backup.');
  }
  function embedModel(id) {
    const builder = window.app?.builder;
    const component = typeof builder?.get === 'function' ? builder.get(id) : null;
    return component?.id === id && component.type === 'embed' && typeof component.property === 'function' ? component : null;
  }
  function mismatch(file, actual) {
    const expected = normalize(file.code), received = normalize(actual);
    let index = 0;
    while (index < Math.min(expected.length, received.length) && expected[index] === received[index]) index++;
    return `Carrd changed ${file.name} at character ${index + 1} (${expected.length} expected, ${received.length} retained). No further files were written. Carrd’s exact-code property setter may be unavailable; confirm only version 1.4 is enabled and reload the editor.`;
  }
  async function write(id, file, settings, requestedTitle) {
    await open(id);
    const title = requestedTitle ?? control('label').value;
    applySettings(settings);
    const field = codeAdapter();
    if (field.max >= 0 && file.code.length > field.max) throw Error(`${file.name} has ${file.code.length} characters, above this field’s ${field.max} limit. Split it further.`);
    const component = embedModel(id);
    if (!component) throw Error('Carrd’s exact-code property setter is unavailable. No code was written to this embed. Disable older script copies, save version 1.4, and fully reload the editor.');
    if (component) {
      // FieldToProperty/postprocess collapses repeated spaces, including inside
      // strings, HTML <pre>, and CSS. Carrd's property setter preserves the
      // original code and performs its normal history, rendering, and form sync.
      const active = document.activeElement;
      if (active && document.querySelector('#properties-panel')?.contains(active)) active.blur();
      component.property('embed_code_content', normalize(file.code));
      if (normalize(component.property('embed_code_content')) !== normalize(file.code)) throw Error(mismatch(file, component.property('embed_code_content')));
    }
    if (normalize(field.get()) !== normalize(file.code)) throw Error(`Code did not match after writing ${file.name}.`);
    const label = control('label');
    if (label.maxLength >= 0 && title.length > label.maxLength) throw Error(`Embed name is too long for Carrd’s Label: ${title}`);
    if (label.value !== title) setInput(label, title);
    await done();
    await open(id);
    const retained = codeAdapter().get();
    if (normalize(retained) !== normalize(file.code)) throw Error(mismatch(file, retained));
    if (control('label').value !== title) throw Error(`Carrd did not retain the title for ${file.name}. Stopping.`);
    const retainedModel = embedModel(id);
    if (retainedModel && normalize(retainedModel.property('embed_code_content')) !== normalize(file.code)) throw Error(mismatch(file, retainedModel.property('embed_code_content')));
    if (settings) {
      const actual = readSettings();
      if (actual.style !== settings.style || (settings.style === 'hidden' ? actual.location !== settings.location : actual.defer !== settings.defer)) throw Error(`Carrd did not retain placement settings for ${file.name}.`);
    }
    await done();
  }
  async function create() {
    const previous = new Set(ids());
    if (!visible(document.querySelector(config.embed))) { click(control('add')); await delay(150); }
    click(control('embed'));
    const id = await waitFor(() => ids().find(id => !previous.has(id)), 'Carrd did not create an embed. Check your plan or element limit.');
    await waitFor(() => panelReady(id), 'Carrd created an embed but did not finish opening its properties.');
    const mode = document.querySelector('#embed-embed_mode');
    if (mode && mode.value !== 'code') setInput(mode, 'code');
    return id;
  }
  async function remove(id) {
    await open(id); click(control('remove'));
    status(`Removing ${id}. If Carrd shows a delete confirmation, confirm it in Carrd. Stop cancels further work.`);
    await waitFor(() => !byId(id), `Deletion of ${id} was not confirmed.`, 60000);
    await waitFor(() => {
      const panel = document.querySelector('#properties-panel');
      return !panel || getComputedStyle(panel).display === 'none';
    }, 'Carrd did not finish closing the deleted embed.');
  }
  function downloadBackup() {
    if (!backup) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url;
    a.download = `carrd-embeds-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function setupStatus() {
    $('#setup').textContent = ['code', 'label', 'done', 'remove'].map(key => `${key}: ${config[key] || 'not set'}`).join('\n');
  }
  function saveConfig() { localStorage.setItem(KEY, JSON.stringify(config)); setupStatus(); }
  function selector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    for (const attr of ['data-action', 'name']) {
      const value = el.getAttribute(attr);
      if (value) { const s = `${el.tagName.toLowerCase()}[${attr}=${JSON.stringify(value)}]`; if (document.querySelectorAll(s).length === 1) return s; }
    }
    const path = [];
    for (let cur = el; cur && cur !== document.documentElement; cur = cur.parentElement) {
      if (cur.id) { path.unshift(`#${CSS.escape(cur.id)}`); break; }
      const siblings = [...cur.parentElement.children].filter(s => s.tagName === cur.tagName);
      path.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(cur) + 1})`);
    }
    return path.join(' > ');
  }
  function pick(key) {
    if (busy || picking) return;
    picking = true;
    status(`Click Carrd’s ${key} ${key === 'code' || key === 'label' ? 'field' : 'button'}. Press Escape to cancel. This click records the control only.`);
    const cleanup = () => { picking = false; document.removeEventListener('click', capture, true); document.removeEventListener('keydown', cancel, true); };
    const cancel = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cleanup(); status('Setup cancelled.'); } };
    const capture = e => {
      if (e.composedPath().includes(host)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      let el = e.target;
      if (key === 'code') el = el.closest('.CodeMirror') || (el.matches('textarea') ? el : el.closest('.input-textarea-autosize')?.querySelector('textarea'));
      else if (key === 'label') el = el.matches('input,textarea') ? el : el.closest('.input-textarea-autosize')?.querySelector('textarea');
      else el = el.closest('[data-action],button,[role="button"],a,[tabindex]') || el;
      cleanup();
      if (!el) return status(`That was not a ${key} field. Try again.`);
      config[key] = selector(el); saveConfig(); status(`Recorded ${key}.`);
    };
    document.addEventListener('click', capture, true); document.addEventListener('keydown', cancel, true);
  }
  function renderFiles() {
    const list = $('#list'); list.replaceChildren();
    files.forEach((file, index) => {
      const li = document.createElement('li'); li.append(document.createTextNode(`${file.name} (${file.code.length.toLocaleString()} chars)`));
      for (const [text, offset] of [['↑', -1], ['↓', 1]]) {
        const button = document.createElement('button'); button.textContent = text; button.title = `Move ${file.name} ${offset < 0 ? 'up' : 'down'}`;
        button.disabled = busy || index + offset < 0 || index + offset >= files.length;
        button.onclick = () => { [files[index], files[index + offset]] = [files[index + offset], files[index]]; renderFiles(); };
        li.append(button);
      }
      list.append(li);
    });
  }
  function lock(value) {
    busy = value;
    root.querySelectorAll('button,input,select').forEach(el => el.disabled = value);
    $('#stop').disabled = !value; $('#backup').disabled = !backup;
    renderFiles();
  }
  async function loadFiles(selected) {
    try {
      selected = [...selected];
      if (selected.length === 1 && /\.json$/i.test(selected[0].name)) {
        const parsed = JSON.parse(await selected[0].text());
        if (parsed.format !== 'carrd-bulk-embeds-v1' || !Array.isArray(parsed.embeds)) throw Error('Not a Carrd bulk embed backup.');
        files = parsed.embeds.map(item => {
          if (typeof item.name !== 'string' || typeof item.code !== 'string') throw Error('Invalid backup entry.');
          validateSettings(item.settings);
          return { name: item.name, code: item.code, settings: item.settings };
        });
      } else {
        if (selected.some(f => !/\.txt$/i.test(f.name))) throw Error('Choose TXT files only, or one backup JSON.');
        const sorted = selected.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
        files = await Promise.all(sorted.map(async f => ({ name: f.name, code: await f.text() })));
      }
      if (new Set(files.map(f => f.name)).size !== files.length) throw Error('Duplicate filenames. Rename segments so their order is unambiguous.');
      renderFiles(); status(`${files.length} segments loaded. Check the order above. Code is never executed by this importer.`);
    } catch (e) { files = []; renderFiles(); status(e.message); }
  }
  $('#files').onchange = e => loadFiles(e.target.files);
  $('.panel').addEventListener('dragover', e => {
    if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy'; }
  });
  $('.panel').addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation();
    if (!busy && !picking && e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
  });
  $('#scan').onclick = () => status(`${ids().length} embed(s) in document order:\n${ids().join('\n') || '(none)'}\nAll existing embeds are included. Exit Section View to include the whole site.`);
  $('#backup').onclick = downloadBackup;
  $('#reset').onclick = () => { config = { ...defaults }; saveConfig(); status('Setup reset.'); };
  root.querySelectorAll('[data-pick]').forEach(button => button.onclick = () => pick(button.dataset.pick));
  $('.close').onclick = () => { $('.panel').style.display = 'none'; $('.launcher').style.display = 'block'; };
  $('.launcher').onclick = () => { $('.panel').style.display = 'block'; $('.launcher').style.display = 'none'; };
  $('#stop').onclick = () => { stopped = true; status('Stopping after the current action. Completed changes remain.'); };
  $('#run').onclick = async () => {
    if (busy || picking) return;
    const replace = $('#mode').value === 'replace';
    try {
      if (!document.querySelector('#canvas')) throw Error('Open the Carrd site editor first.');
      if (typeof window.app?.builder?.get !== 'function') throw Error('Carrd’s exact-code editor connection is unavailable. Disable older copies, save version 1.4 in Tampermonkey, and fully reload the Carrd editor.');
      const section = document.querySelector('#menu [data-action="deactivate-section"]');
      if (visible(section) && !section.classList.contains('disabled') && !section.classList.contains('hidden')) throw Error('Exit Carrd Section View first so all embeds can be found.');
      if (!files.length) throw Error('Choose your TXT files first.');
      if (files.some(f => !f.code.trim())) throw Error('An empty segment was selected. Remove empty files first.');
      for (const key of ['code', 'label', 'done', ...(replace ? ['remove'] : [])]) if (!config[key]) throw Error(`Set up ${key} first.`);
      const existing = ids();
      if (!replace && existing.length > files.length) throw Error(`There are ${existing.length} embeds but only ${files.length} files. Use Replace to remove old extras, or choose at least ${existing.length} files.`);
      if (!confirm(`${replace ? 'REPLACE every existing embed' : 'UPDATE every existing embed and add missing'}?\n\n${existing.length} existing → ${files.length} files.\nALL embeds are included, even unrelated ones.\n\nThe backup includes code, titles, code placement and defer settings, but not advanced attributes. Replacement stages new embeds next to the originals and verifies them before deleting old ones; it temporarily needs extra element capacity. Publishing remains manual.`)) return;
      stopped = false; lock(true);
      backup = { format: 'carrd-bulk-embeds-v1', url: location.href, created: new Date().toISOString(), embeds: [], complete: false };
      $('#backup').disabled = true;
      for (let i = 0; i < existing.length; i++) {
        status(`Reading backup ${i + 1}/${existing.length}…`);
        await open(existing[i]); backup.embeds.push(snapshot(existing[i])); await done();
      }
      backup.complete = true; $('#backup').disabled = false;
      // Validate every segment against the observed Carrd limit before any deletion.
      if (existing.length) {
        await open(existing[0]);
        const max = codeAdapter().max;
        const tooLong = files.find(f => max >= 0 && f.code.length > max);
        await done();
        if (tooLong) throw Error(`${tooLong.name} exceeds Carrd’s ${max}-character limit. Split it further.`);
      } else if (files.some(f => f.code.length > 16384)) throw Error('A segment exceeds the observed Carrd limit of 16,384 characters. Split it further.');
      const naming = $('#naming').value;
      const titles = files.map((file, i) => naming === 'numbers' ? String(i) : naming === 'filenames' ? file.name : (backup.embeds[i]?.title ?? backup.embeds[i]?.name));
      if (titles.some(title => title !== undefined && title.length > 128)) throw Error('An embed name exceeds Carrd’s 128-character title limit. Choose numeric names or shorten it first.');
      // Keep the backup in memory; downloads are opt-in and off by default.
      if ($('#auto-backup').checked) downloadBackup();
      const targets = replace ? [] : [...existing];
      for (let i = 0; i < files.length; i++) {
        check(); status(`Writing and verifying ${i + 1}/${files.length}: ${files[i].name}`);
        // Carrd uses its OPEN properties panel to choose the insertion point.
        // Calling Done here clears that reference and appends at the page root.
        if (!targets[i]) {
          if (replace && existing[i]) await open(existing[i]);
          else if (i > 0) await open(targets[i - 1]);
          targets[i] = await create();
        }
        const isNew = replace || i >= existing.length;
        const placement = $('#placement').value;
        const settings = files[i].settings || (isNew ? (replace && backup.embeds[i]?.settings) || { style: placement === 'inline' ? 'inline' : 'hidden', location: placement === 'inline' ? 'body-end' : placement, defer: $('#defer').checked } : null);
        await write(targets[i], files[i], settings, titles[i]);
      }
      if (replace) {
        const staged = ids().filter(id => targets.includes(id));
        if (staged.length !== files.length || targets.some((id, i) => staged[i] !== id)) throw Error('New embeds are out of order. Original embeds were kept.');
        for (const id of existing) { check(); await remove(id); }
      }
      const current = ids();
      if (current.length !== files.length || targets.some((id, i) => current[i] !== id)) throw Error('Embed order or count differs from the requested file order. Check placement in Carrd before publishing.');
      status(`Finished: ${files.length} embeds written and read back successfully. Review placement, Style/Hidden location and script defer settings in Carrd, then publish when ready.`);
    } catch (e) { status(`${e.message}\nNo automatic rollback was attempted. Download the backup if available. Completed changes remain in the editor.`); console.error('[Carrd bulk embeds]', e); }
    finally { lock(false); }
  };
  setupStatus();
})();
