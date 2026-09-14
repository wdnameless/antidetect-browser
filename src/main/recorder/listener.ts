// Flow recorder capture listener (Wave 2, gap B1): builds the document-start
// script injected into the recording profile. The builder is only called when
// recording starts — when recording is off nothing is injected, no bridge
// channel exists and no page listener is ever installed.
//
// The injected source is plain ES2020 JavaScript (it runs in the page, MAIN
// world). It must stay valid plain JS: no TypeScript tokens, no template
// interpolation at runtime beyond the binding-name serialised by the builder.
// The unit tests assert it parses via `new vm.Script(source)`.
//
// Selectors follow the existing `selectorPathFromSteps` scheme (tag:nth-of-type
// chains, ids when present). The path is computed IN the page and sent as a
// string; tests round-trip it through `parseSelectorPath`.
//
// Mode gating: the script installs one set of capture listeners and exposes
// `window.__flowRecorderSetMode(...)` on the window. The bridge flips the mode
// ('recording' | 'picker' | 'off') over CDP. When the mode is 'off' every
// listener is inert, so once recording stops (or the picker closes) the page
// reports nothing even while the profile keeps running.

/** Name of the Runtime.addBinding the bridge registers for page -> main. */
export const RECORDER_BINDING = '__flowRecorderReport';

/** Window flag making the script idempotent per document. */
export const RECORDER_FLAG = '__flowRecorderInstalled';

/** Window mode flag the bridge flips to gate reporting. */
export const RECORDER_MODE = '__flowRecorderMode';

/** Custom event the picker surfaces fire (right-click on an element). */
export const RECORDER_PICK_EVENT = 'recorder:pick';

/** Mode: report browsing actions as capture records. */
export const RECORDER_MODE_RECORDING = 'recording';
/** Mode: report right-clicked elements (element action picker). */
export const RECORDER_MODE_PICKER = 'picker';
/** Mode: everything inert. */
export const RECORDER_MODE_OFF = 'off';

/** Record kinds the capture surface reports (shared wire contract). */
export type ListenerRecordKind = 'click' | 'type' | 'navigate' | 'scroll' | 'key';

/**
 * Shared capture contract: `{ kind: 'click'|'type'|'navigate'|'scroll'|'key';
 * selector: string|null; text?: string; url?: string; button?: number|string }`.
 * The injected page sends exactly this shape over the `RECORDER_BINDING`.
 */
export interface ListenerRecord {
  kind: ListenerRecordKind;
  selector: string | null;
  text?: string;
  url?: string;
  button?: number | string;
}

/** Element picker report (kind 'pick'), separate from the capture contract. */
export interface PickerRecord {
  kind: 'pick';
  selector: string | null;
  tag?: string;
  id?: string | null;
}

/**
 * Build the document-start listener source for the recording profile.
 *
 * @param bindingName CDP binding the page reports through (defaults to the
 *   shared `RECORDER_BINDING`).
 * @returns plain JavaScript that parses with `new vm.Script(source)`.
 */
export function buildRecorderListenerSource(bindingName: string = RECORDER_BINDING): string {
  // Everything from here down is literal JS inside the template string. No TS
  // tokens, no backtick nesting, no `${...}` — the only interpolation is the
  // serialised binding name above.
  return [
    `(() => {`,
    `  if (window.${RECORDER_FLAG}) return;`,
    `  window.${RECORDER_FLAG} = true;`,
    ``,
    `  var mode = 'off';`,
    `  window.${RECORDER_MODE} = function () { return mode; };`,
    `  window.__flowRecorderSetMode = function (m) { mode = m; };`,
    ``,
    `  var send = function (kind, payload) {`,
    `    try {`,
    `      var rec = Object.assign({ kind: kind, selector: null }, payload);`,
    `      window.${bindingName}(JSON.stringify(rec));`,
    `    } catch (e) {}`,
    `  };`,
    ``,
    `  var isIgnorable = function (el) {`,
    `    return !el || el === document || el === document.body ||`,
    `      (el.tagName || '').toLowerCase() === 'html';`,
    `  };`,
    ``,
    `  var isTextEditable = function (el) {`,
    `    var tag = (el.tagName || '').toLowerCase();`,
    `    return tag === 'input' || tag === 'textarea' || !!el.isContentEditable;`,
    `  };`,
    ``,
    `  var buildPath = function (el) {`,
    `    var steps = [];`,
    `    var node = el;`,
    `    var depth = 0;`,
    `    while (node && node.nodeType === 1 && depth < 12 && !node.id) {`,
    `      var tag = (node.tagName || 'div').toLowerCase();`,
    `      var nth = 1;`,
    `      var sib = node;`,
    `      while ((sib = sib.previousElementSibling)) {`,
    `        if ((sib.tagName || '').toLowerCase() === tag) nth++;`,
    `      }`,
    `      steps.unshift({ tag: tag, nth: nth });`,
    `      node = node.parentElement;`,
    `      depth++;`,
    `    }`,
    `    if (node && node.nodeType === 1 && node.id) {`,
    `      steps.unshift({ tag: '', nth: 1, id: node.id });`,
    `    }`,
    `    if (steps.length === 0) {`,
    `      steps.unshift({ tag: (el.tagName || 'div').toLowerCase(), nth: 1 });`,
    `    }`,
    `    return steps`,
    `      .map(function (s) { return s.id ? '#' + s.id : s.tag + ':nth-of-type(' + s.nth + ')'; })`,
    `      .join(' > ');`,
    `  };`,
    ``,
    `  var selectorOf = function (el) {`,
    `    try {`,
    `      var p = buildPath(el);`,
    `      var probe = document.querySelector(p);`,
    `      return probe === el ? p : null;`,
    `    } catch (e) {`,
    `      return null;`,
    `    }`,
    `  };`,
    ``,
    `  var isModifier = function (key) {`,
    `    return ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].indexOf(key) !== -1;`,
    `  };`,
    ``,
    `  document.addEventListener('click', function (ev) {`,
    `    if (mode !== 'recording') return;`,
    `    var el = ev.target;`,
    `    if (isIgnorable(el)) return;`,
    `    send('click', {`,
    `      selector: selectorOf(el),`,
    `      button: ev.button != null ? ev.button : 0,`,
    `    });`,
    `  }, true);`,
    ``,
    `  document.addEventListener('keydown', function (ev) {`,
    `    if (mode !== 'recording') return;`,
    `    if (isModifier(ev.key)) return;`,
    `    var el = ev.target;`,
    `    var editable = el && (isTextEditable(el) || (el.tagName || '').toLowerCase() === 'select');`,
    `    if (!editable) {`,
    `      send('key', { selector: null, text: ev.key || '' });`,
    `      return;`,
    `    }`,
    `    if (ev.key && ev.key.length === 1) {`,
    `      send('key', { selector: selectorOf(el), text: ev.key });`,
    `    } else if (ev.key === 'Backspace') {`,
    `      send('key', { selector: selectorOf(el), text: '\\b' });`,
    `    } else if (ev.key === 'Enter') {`,
    `      send('key', { selector: selectorOf(el), text: '\\n' });`,
    `    }`,
    `  }, true);`,
    ``,
    `  var reportField = function (el) {`,
    `    if (mode !== 'recording') return;`,
    `    var target = el;`,
    `    if (isIgnorable(target) || !isTextEditable(target)) return;`,
    `    var tag = (target.tagName || '').toLowerCase();`,
    `    if (tag === 'input') {`,
    `      var t = (target.type || 'text').toLowerCase();`,
    `      if (t === 'checkbox' || t === 'radio' || t === 'submit' || t === 'button' || t === 'file') return;`,
    `    }`,
    `    send('type', {`,
    `      selector: selectorOf(target),`,
    `      text: target.isContentEditable ? (target.textContent || '') : String(target.value != null ? target.value : ''),`,
    `    });`,
    `  };`,
    ``,
    `  document.addEventListener('change', function (ev) { reportField(ev.target); }, true);`,
    `  document.addEventListener('blur', function (ev) { reportField(ev.target); }, true);`,
    ``,
    `  window.addEventListener('scroll', function () {`,
    `    if (mode !== 'recording') return;`,
    `    if (window.__scrolling || !document.scrollingElement) return;`,
    `    window.__scrolling = true;`,
    `    setTimeout(function () {`,
    `      window.__scrolling = false;`,
    `      send('scroll', { selector: null, text: String(document.scrollingElement.scrollTop) });`,
    `    }, 150);`,
    `  }, true);`,
    ``,
    `  var navigatedUrl = null;`,
    `  var navigationReporter = function () {`,
    `    if (mode !== 'recording') return;`,
    `    var href = location.href;`,
    `    if (href && href !== navigatedUrl) {`,
    `      var prev = navigatedUrl;`,
    `      navigatedUrl = href;`,
    `      if (prev) send('navigate', { selector: null, url: href });`,
    `    }`,
    `  };`,
    `  if (document.readyState === 'loading') {`,
    `    document.addEventListener('DOMContentLoaded', navigationReporter);`,
    `  } else {`,
    `    navigationReporter();`,
    `  }`,
    `  window.addEventListener('popstate', navigationReporter);`,
    `  window.addEventListener('hashchange', navigationReporter);`,
    `  setInterval(navigationReporter, 750);`,
    ``,
    `  document.addEventListener('contextmenu', function (ev) {`,
    `    if (mode !== 'recording' && mode !== 'picker') return;`,
    `    var el = ev.target;`,
    `    if (isIgnorable(el)) return;`,
    `    send('pick', {`,
    `      selector: selectorOf(el),`,
    `      tag: (el.tagName || '').toLowerCase(),`,
    `      id: el.id || null,`,
    `    });`,
    `  }, true);`,
    `})();`,
  ].join('\n');
}
