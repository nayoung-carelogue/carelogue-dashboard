import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import * as enModule from './en.js';
import * as jaModule from './ja.js';

export const SUPPORTED_LANGUAGES = Object.freeze(['ko', 'ja', 'en']);
export const LANGUAGE_STORAGE_KEY = 'carelogue.language';
export const LANGUAGE_CHANGE_EVENT = 'carelogue:languagechange';

export const LANGUAGE_OPTIONS = Object.freeze([
  { value: 'ko', label: '한국어', shortLabel: 'KO' },
  { value: 'ja', label: '日本語', shortLabel: 'JA' },
  { value: 'en', label: 'English', shortLabel: 'EN' },
]);

const TRANSLATABLE_ATTRIBUTES = Object.freeze([
  'placeholder',
  'title',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-valuetext',
  'alt',
]);

const OBSERVER_OPTIONS = Object.freeze({
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: TRANSLATABLE_ATTRIBUTES,
});

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
const listeners = new Set();
const activeControllers = new Set();
const mountedRoots = new WeakMap();
const textOriginals = new WeakMap();
const attributeOriginals = new WeakMap();
let documentTitleOriginal = null;

function moduleDictionary(module, namedExport) {
  return module.default ?? module[namedExport] ?? module;
}

function flattenDictionary(source, target = {}) {
  if (!source || typeof source !== 'object') return target;

  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') {
      // macOS can save Korean dictionary keys as decomposed Unicode (NFD),
      // while JSX text is rendered as composed Unicode (NFC). Normalize both
      // sides so visually identical Korean always matches at runtime.
      const normalizedKey = key.normalize('NFC');
      if (normalizedKey && normalizedKey !== value) {
        target[normalizedKey] = value.normalize('NFC');
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenDictionary(value, target);
    }
  }

  return target;
}

const dictionaries = Object.freeze({
  ko: Object.freeze({}),
  ja: Object.freeze(flattenDictionary(moduleDictionary(jaModule, 'ja'))),
  en: Object.freeze(flattenDictionary(moduleDictionary(enModule, 'en'))),
});

const matcherCache = new Map();

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getMatcher(language) {
  if (language === 'ko') return null;
  if (matcherCache.has(language)) return matcherCache.get(language);

  const dictionary = dictionaries[language] ?? {};
  const keys = Object.keys(dictionary).sort((left, right) => {
    const lengthDifference = right.length - left.length;
    return lengthDifference || left.localeCompare(right, 'ko');
  });
  const matcher = keys.length
    ? new RegExp(keys.map(escapeRegularExpression).join('|'), 'gu')
    : null;

  matcherCache.set(language, matcher);
  return matcher;
}

export function normalizeLanguage(language) {
  const normalized = String(language || '').trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LANGUAGES.includes(normalized) ? normalized : 'ko';
}

function readStoredLanguage() {
  if (!isBrowser) return 'ko';
  try {
    return normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return 'ko';
  }
}

let currentLanguage = readStoredLanguage();

export function getLanguage() {
  return currentLanguage;
}

/**
 * Translates a Korean source string using one deterministic pass. Keys are
 * matched longest-first, so full phrases win over smaller terms. Anything
 * outside a matched dictionary key (including dates, counts, and punctuation)
 * is retained exactly as rendered.
 */
export function translateText(source, language = currentLanguage) {
  if (source == null) return source;

  const normalizedLanguage = normalizeLanguage(language);
  const value = String(source);
  if (normalizedLanguage === 'ko' || !value) return value;

  const dictionary = dictionaries[normalizedLanguage];
  const matcher = getMatcher(normalizedLanguage);
  if (!matcher) return value;

  // A callback is used so "$&" and other replacement tokens in translations
  // are treated as ordinary characters.
  return value.replace(matcher, (matched, offset, fullValue) => {
    // Single-character entries are useful for standalone weekday labels and
    // the profile avatar, but must not alter a syllable inside a Korean word.
    if (matched.length === 1 && /[가-힣]/u.test(matched)) {
      const previous = fullValue[offset - 1] ?? '';
      const next = fullValue[offset + 1] ?? '';
      if (/[가-힣]/u.test(previous) || /[가-힣]/u.test(next)) return matched;
    }
    return dictionary[matched] ?? matched;
  });
}

export const t = translateText;

function translateDocumentTitle(language) {
  if (!isBrowser) return;

  const currentValue = document.title;
  if (!documentTitleOriginal) {
    documentTitleOriginal = { original: currentValue, lastOutput: null };
  } else {
    updateOriginal(documentTitleOriginal, currentValue);
  }

  const output = language === 'ko'
    ? documentTitleOriginal.original
    : translateText(documentTitleOriginal.original, language);

  if (currentValue !== output) document.title = output;
  documentTitleOriginal.lastOutput = output;
}

function emitLanguageChange(language) {
  if (isBrowser) {
    document.documentElement.lang = language;
    translateDocumentTitle(language);
    window.dispatchEvent(
      new CustomEvent(LANGUAGE_CHANGE_EVENT, { detail: { language } }),
    );
  }
  for (const listener of [...listeners]) listener(language);
}

export function setLanguage(language) {
  const nextLanguage = normalizeLanguage(language);
  currentLanguage = nextLanguage;

  if (isBrowser) {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    } catch {
      // Private browsing and locked-down webviews may reject localStorage.
    }
  }

  // Always emit, even when the value is unchanged. This doubles as a manual
  // refresh after a large React update.
  emitLanguageChange(nextLanguage);
  return nextLanguage;
}

export function subscribeLanguage(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function shouldIgnoreElement(element) {
  if (!element || element.nodeType !== 1) return false;
  if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE'].includes(element.tagName)) return true;
  if (element.matches('[data-i18n-ignore], [translate="no"]')) return true;
  if (element.isContentEditable) return true;
  return false;
}

function hasIgnoredAncestor(node, boundary) {
  let element = node.nodeType === 1 ? node : node.parentElement;
  while (element) {
    if (shouldIgnoreElement(element)) return true;
    if (element === boundary) break;
    element = element.parentElement;
  }
  return false;
}

function updateOriginal(record, currentValue) {
  // When React replaces translated content with newly rendered Korean content,
  // retain that new value as the source for future language switches.
  if (currentValue !== record.original && currentValue !== record.lastOutput) {
    record.original = currentValue;
  }
}

function translateTextNode(node, language, boundary) {
  if (!node.nodeValue || hasIgnoredAncestor(node, boundary)) return;

  const currentValue = node.nodeValue;
  let record = textOriginals.get(node);
  if (!record) {
    record = { original: currentValue, lastOutput: null };
    textOriginals.set(node, record);
  } else {
    updateOriginal(record, currentValue);
  }

  const output = language === 'ko'
    ? record.original
    : translateText(record.original, language);

  if (currentValue !== output) node.nodeValue = output;
  record.lastOutput = output;
}

function translateElementAttributes(element, language) {
  if (shouldIgnoreElement(element)) return;

  let records = attributeOriginals.get(element);
  if (!records) {
    records = new Map();
    attributeOriginals.set(element, records);
  }

  for (const attribute of TRANSLATABLE_ATTRIBUTES) {
    if (!element.hasAttribute(attribute)) {
      records.delete(attribute);
      continue;
    }

    const currentValue = element.getAttribute(attribute) ?? '';
    let record = records.get(attribute);
    if (!record) {
      record = { original: currentValue, lastOutput: null };
      records.set(attribute, record);
    } else {
      updateOriginal(record, currentValue);
    }

    const output = language === 'ko'
      ? record.original
      : translateText(record.original, language);

    if (currentValue !== output) element.setAttribute(attribute, output);
    record.lastOutput = output;
  }
}

function translateSubtree(node, language, boundary) {
  if (!node) return;
  const stack = [node];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    if (current.nodeType === 3) {
      translateTextNode(current, language, boundary);
      continue;
    }

    if (current.nodeType === 1) {
      if (hasIgnoredAncestor(current, boundary)) continue;
      translateElementAttributes(current, language);
    }

    if (current.nodeType === 1 || current.nodeType === 9 || current.nodeType === 11) {
      for (let index = current.childNodes.length - 1; index >= 0; index -= 1) {
        stack.push(current.childNodes[index]);
      }
    }
  }
}

function createDomTranslator(root) {
  let stopped = false;
  let scheduled = false;
  const pendingNodes = new Set();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const addedNode of mutation.addedNodes) pendingNodes.add(addedNode);
      } else {
        pendingNodes.add(mutation.target);
      }
    }

    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  });

  function observe() {
    if (!stopped) observer.observe(root, OBSERVER_OPTIONS);
  }

  function apply(nodes) {
    if (stopped) return;
    observer.disconnect();
    for (const node of nodes) {
      if (node === root || node.isConnected) {
        translateSubtree(node, currentLanguage, root);
      }
    }
    observe();
  }

  function flush() {
    scheduled = false;
    const nodes = [...pendingNodes];
    pendingNodes.clear();
    if (nodes.length) apply(nodes);
  }

  function refresh() {
    pendingNodes.clear();
    apply([root]);
  }

  const unsubscribe = subscribeLanguage(refresh);
  refresh();

  return {
    refresh,
    stop() {
      if (stopped) return;
      stopped = true;
      observer.disconnect();
      pendingNodes.clear();
      unsubscribe();
    },
  };
}

/**
 * Starts DOM translation for a React root and returns a cleanup function.
 * Repeated mounts for the same root share one MutationObserver.
 */
export function mountDomI18n(root = isBrowser ? document.getElementById('root') : null) {
  if (!isBrowser || !root) return () => {};

  const mounted = mountedRoots.get(root);
  if (mounted) {
    mounted.references += 1;
    mounted.controller.refresh();
    return () => unmountDomI18n(root);
  }

  const controller = createDomTranslator(root);
  const entry = { controller, references: 1 };
  mountedRoots.set(root, entry);
  activeControllers.add(controller);
  document.documentElement.lang = currentLanguage;
  translateDocumentTitle(currentLanguage);

  return () => unmountDomI18n(root);
}

function unmountDomI18n(root) {
  const mounted = mountedRoots.get(root);
  if (!mounted) return;

  mounted.references -= 1;
  if (mounted.references > 0) return;

  mounted.controller.stop();
  activeControllers.delete(mounted.controller);
  mountedRoots.delete(root);
}

export function refreshI18n() {
  for (const controller of activeControllers) controller.refresh();
}

/**
 * React integration for App.jsx:
 *   const { language, setLanguage, languages } = useI18n();
 * The hook mounts the DOM observer after the first React render.
 */
export function useI18n(rootRef) {
  const [language, setLanguageState] = useState(getLanguage);

  useEffect(() => subscribeLanguage(setLanguageState), []);

  // The observer starts in a layout effect so a persisted non-Korean locale is
  // applied before the first browser paint instead of briefly flashing Korean.
  useLayoutEffect(() => {
    const root = rootRef?.current ?? document.getElementById('root');
    return mountDomI18n(root);
  }, [rootRef]);

  const changeLanguage = useCallback((nextLanguage) => {
    setLanguage(nextLanguage);
  }, []);

  const translate = useCallback(
    (source) => translateText(source, language),
    [language],
  );

  return useMemo(() => ({
    language,
    setLanguage: changeLanguage,
    t: translate,
    languages: LANGUAGE_OPTIONS,
  }), [language, changeLanguage, translate]);
}

if (isBrowser) {
  document.documentElement.lang = currentLanguage;
  window.addEventListener('storage', (event) => {
    if (event.key !== LANGUAGE_STORAGE_KEY) return;
    const nextLanguage = normalizeLanguage(event.newValue);
    if (nextLanguage === currentLanguage) return;
    currentLanguage = nextLanguage;
    emitLanguageChange(nextLanguage);
  });
}

// Dev only: this module keeps global language state and DOM observers, so a hot
// swap would leave two copies running. Reload the page when it or a dictionary changes.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
