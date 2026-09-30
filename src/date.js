import { useEffect, useState } from 'react';
import { getLanguage, subscribeLanguage } from './i18n/index.js';

// Demo reference date. Every "today" on screen is derived from this value.
export const DEMO_TODAY = '2026-09-30';
// Set to true to use the real current date instead of DEMO_TODAY.
export const USE_REAL_TODAY = false;

const LOCALES = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP' };
const pad = (n) => String(n).padStart(2, '0');

export function parseISO(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function getToday() {
  if (!USE_REAL_TODAY) return parseISO(DEMO_TODAY);
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(to, from = getToday()) {
  const a = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  const b = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((a - b) / 86400000);
}

export function isSameDay(a, b) {
  return diffDays(a, b) === 0;
}

function parts(date, language, options) {
  const out = {};
  for (const part of new Intl.DateTimeFormat(LOCALES[language] || LOCALES.ko, options).formatToParts(date)) {
    out[part.type] = part.value;
  }
  return out;
}

/** ko 2026.09.30 · en Sep 30, 2026 · ja 2026年9月30日 */
export function formatDate(date, language = getLanguage()) {
  if (language === 'en') {
    return new Intl.DateTimeFormat(LOCALES.en, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }
  if (language === 'ja') {
    return new Intl.DateTimeFormat(LOCALES.ja, { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
  }
  const p = parts(date, 'ko', { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}.${p.month}.${p.day}`;
}

/** ko 09.30 · en Sep 30 · ja 9月30日 */
export function formatShortDate(date, language = getLanguage()) {
  if (language === 'en') return new Intl.DateTimeFormat(LOCALES.en, { month: 'short', day: 'numeric' }).format(date);
  if (language === 'ja') return new Intl.DateTimeFormat(LOCALES.ja, { month: 'long', day: 'numeric' }).format(date);
  const p = parts(date, 'ko', { month: '2-digit', day: '2-digit' });
  return `${p.month}.${p.day}`;
}

/** ko 2026년 9월 · en September 2026 · ja 2026年9月 */
export function formatMonth(date, language = getLanguage()) {
  return new Intl.DateTimeFormat(LOCALES[language] || LOCALES.ko, { year: 'numeric', month: 'long' }).format(date);
}

/** Relative to the reference date: 오늘 / 내일 / N일 후 / N일 전 */
export function formatRelative(date, language = getLanguage(), from = getToday()) {
  const n = diffDays(date, from);
  const text = {
    ko: { 0: '오늘', 1: '내일', '-1': '어제', after: `${n}일 후`, before: `${-n}일 전` },
    en: { 0: 'Today', 1: 'Tomorrow', '-1': 'Yesterday', after: `In ${n} days`, before: `${-n} days ago` },
    ja: { 0: '本日', 1: '明日', '-1': '昨日', after: `${n}日後`, before: `${-n}日前` },
  }[language] || {};
  if (text[n] !== undefined) return text[n];
  return n > 0 ? text.after : text.before;
}

/** Deadline status: N일 초과 / 오늘 / 내일 / N일 남음 */
export function formatDue(date, language = getLanguage(), from = getToday()) {
  const n = diffDays(date, from);
  if (n < 0) return { ko: `${-n}일 초과`, en: `${-n} ${-n === 1 ? 'day' : 'days'} overdue`, ja: `${-n}日超過` }[language];
  if (n === 0) return { ko: '오늘', en: 'Today', ja: '本日' }[language];
  if (n === 1) return { ko: '내일', en: 'Tomorrow', ja: '明日' }[language];
  return { ko: `${n}일 남음`, en: `${n} days left`, ja: `残り${n}日` }[language];
}

export function formatDone(date, language = getLanguage()) {
  const d = formatShortDate(date, language);
  return { ko: `${d} 완료`, en: `Done ${d}`, ja: `${d}完了` }[language];
}

export function formatPlanned(date, language = getLanguage()) {
  const d = formatShortDate(date, language);
  return { ko: `${d} 예정`, en: `Due ${d}`, ja: `${d}予定` }[language];
}

// Selected date shared by the top date control and date filters.
let selectedISO = toISO(getToday());
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener(selectedISO));

export function setSelectedDate(value) {
  selectedISO = typeof value === 'string' ? value : toISO(value);
  emit();
}
export const shiftSelectedDate = (days) => setSelectedDate(addDays(parseISO(selectedISO), days));
export const resetSelectedDate = () => setSelectedDate(getToday());

export function useSelectedDate() {
  const [value, setValue] = useState(selectedISO);
  useEffect(() => {
    listeners.add(setValue);
    return () => listeners.delete(setValue);
  }, []);
  return parseISO(value);
}

export function useLanguage() {
  const [language, setLanguage] = useState(getLanguage);
  useEffect(() => subscribeLanguage(setLanguage), []);
  return language;
}
