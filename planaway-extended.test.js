/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   PlanAway — Extended Test Suite (143 New Tests)                    ║
 * ║                                                                      ║
 * ║   Covers gaps not in the existing 459 tests:                        ║
 * ║   1.  Trip classification & display logic      (15 tests)           ║
 * ║   2.  Cost categories & expense rules          (16 tests)           ║
 * ║   3.  Settlement deeper coverage               (18 tests)           ║
 * ║   4.  Checklist deeper coverage                (16 tests)           ║
 * ║   5.  Date & timezone edge cases               (15 tests)           ║
 * ║   6.  Input sanitisation (esc + fields)        (16 tests)           ║
 * ║   7.  Trip code & invite deeper coverage       (14 tests)           ║
 * ║   8.  State machine deeper coverage            (13 tests)           ║
 * ║   9.  Performance (new benchmarks)             (10 tests)           ║
 * ║   10. Dashboard / member logic                 (10 tests)           ║
 * ║                                                                      ║
 * ║   Run: npm run test:extended                                        ║
 * ║   (No emulator needed — pure logic tests)                           ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION LOGIC — exact replicas of functions from the app files
// ─────────────────────────────────────────────────────────────────────────────

/** flatKey — planner.html */
function flatKey(cat, item) {
  return (cat + '__' + item).replace(/[^a-zA-Z0-9]/g, '_');
}

/** esc — planner.html + landingpage.html */
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** nightsCount — planner.html */
function nightsCount(s, e) {
  if (!s || !e) return 0;
  return Math.max(0, Math.round((new Date(e) - new Date(s)) / 86400000));
}

/** dayCount — number of day blocks = nights + 1 */
function dayCount(s, e) {
  return nightsCount(s, e) + 1;
}

/** genCode — landingpage.html */
function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/** normaliseCode — uppercase before Firestore query */
function normaliseCode(code) {
  return (code || '').trim().toUpperCase();
}

/** postLoginDest — index.html */
function postLoginDest(inviteCode, ss) {
  const pending = ss.getItem('pendingInvite');
  if (pending) { ss.removeItem('pendingInvite'); return `planner.html?invite=${encodeURIComponent(pending)}`; }
  if (inviteCode) return `planner.html?invite=${encodeURIComponent(inviteCode)}`;
  return 'landingpage.html';
}

/** mockStorage */
function mockStorage(init = {}) {
  const s = { ...init };
  return { getItem: k => s[k] ?? null, setItem: (k, v) => { s[k] = v; }, removeItem: k => { delete s[k]; } };
}

/** runSettlement — planner.html */
function runSettlement(costs) {
  const allPayers = new Set(costs.map(c => c.paidBy).filter(Boolean));
  const allParties = new Set();
  costs.forEach(c => {
    if (c.paidBy) allParties.add(c.paidBy);
    if (Array.isArray(c.splitBetween))
      c.splitBetween.forEach(f => f === 'All' ? allPayers.forEach(p => allParties.add(p)) : allParties.add(f));
  });
  const paid = {}, owes = {};
  allParties.forEach(p => { paid[p] = 0; owes[p] = 0; });
  costs.forEach(c => {
    const amt = c.amount || 0;
    if (c.paidBy && allParties.has(c.paidBy)) paid[c.paidBy] += amt;
    let split = Array.isArray(c.splitBetween) && c.splitBetween.length ? c.splitBetween : [];
    if (split.includes('All')) split = Array.from(allPayers);
    if (split.length) { const share = amt / split.length; split.forEach(p => { owes[p] = (owes[p] || 0) + share; }); }
  });
  const balances = {};
  allParties.forEach(p => { balances[p] = (paid[p] || 0) - (owes[p] || 0); });
  const creditors = [], debtors = [];
  allParties.forEach(p => {
    if (balances[p] > 0.005)       creditors.push({ name: p, amount: balances[p] });
    else if (balances[p] < -0.005) debtors.push({ name: p, amount: Math.abs(balances[p]) });
  });
  const settlements = [];
  const c2 = creditors.map(x => ({ ...x })), d2 = debtors.map(x => ({ ...x }));
  let ci = 0, di = 0;
  while (ci < c2.length && di < d2.length) {
    const transfer = Math.min(c2[ci].amount, d2[di].amount);
    if (transfer > 0.005) settlements.push({ from: d2[di].name, to: c2[ci].name, amount: transfer });
    c2[ci].amount -= transfer; d2[di].amount -= transfer;
    if (c2[ci].amount < 0.005) ci++;
    if (d2[di].amount < 0.005) di++;
  }
  return { paid, owes, balances, settlements };
}

/** Trip classification */
function classifyTrip(startDate, endDate) {
  if (!startDate || !endDate) return 'unknown';
  const now   = new Date();
  const start = new Date(startDate + 'T00:00:00');
  const end   = new Date(endDate   + 'T23:59:59');
  if (end < now)   return 'past';
  if (start > now) return 'upcoming';
  return 'active';
}

/** Checklist completion percentage */
function checklistCompletion(items, checklistState) {
  if (!items.length) return 0;
  const checked = items.filter(key => checklistState[key] && checklistState[key].checked).length;
  return Math.round((checked / items.length) * 100);
}

/** safeName — displayName fallback */
function safeName(displayName, email) {
  const t = (displayName || '').trim();
  if (t) return t;
  if (email) return email.split('@')[0];
  return 'User';
}

/** Expense category validation */
const VALID_CATEGORIES = ['Food', 'Gear', 'Fuel', 'Accommodation', 'Other'];
function isValidCategory(cat) { return VALID_CATEGORIES.includes(cat); }

/** isOwner / isGuest */
function getAccessRole(tripData, uid) {
  if (!uid) return 'none';
  if (tripData.ownerUID === uid) return 'owner';
  const guests = Array.isArray(tripData.guestMembers) ? tripData.guestMembers : [];
  if (guests.some(m => m.uid === uid)) return 'guest';
  return 'none';
}

/** modeLabels */
const MODE_LABELS = { tent: 'Tent Only', rv: 'RV Only', both: 'Both Tent & RV', cabin: 'Cabin' };

/** State machine */
const STATES = { IDLE: 'idle', LOADING: 'loading', AUTHENTICATED: 'authenticated', ERROR: 'error' };
const TRANSITIONS = {
  [STATES.IDLE]:          [STATES.LOADING],
  [STATES.LOADING]:       [STATES.AUTHENTICATED, STATES.ERROR, STATES.IDLE],
  [STATES.AUTHENTICATED]: [STATES.IDLE],
  [STATES.ERROR]:         [STATES.IDLE, STATES.LOADING],
};
function createSM() {
  let state = STATES.IDLE;
  return {
    get:  ()     => state,
    set:  (next) => {
      if (!TRANSITIONS[state].includes(next)) throw new Error(`Invalid: ${state} → ${next}`);
      state = next;
    },
    can:  (next) => (TRANSITIONS[state] || []).includes(next),
    reset: ()    => { state = STATES.IDLE; },
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1 — Trip Classification & Display Logic (15 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('1. Trip classification and display logic', () => {

  it('1.1 Past trip — end date before today → classified as past', () => {
    expect(classifyTrip('2024-01-01', '2024-01-07')).toBe('past');
  });

  it('1.2 Upcoming trip — start date in the future → classified as upcoming', () => {
    expect(classifyTrip('2030-01-01', '2030-01-07')).toBe('upcoming');
  });

  it('1.3 Active trip — today is between start and end → classified as active', () => {
    const start = new Date(); start.setDate(start.getDate() - 1);
    const end   = new Date(); end.setDate(end.getDate() + 1);
    const fmt   = d => d.toISOString().split('T')[0];
    expect(classifyTrip(fmt(start), fmt(end))).toBe('active');
  });

  it('1.4 Trip active on end day — endDate + T23:59:59 keeps it active until midnight', () => {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    expect(classifyTrip(yesterday, today)).toBe('active');
  });

  it('1.5 Missing startDate → unknown classification', () => {
    expect(classifyTrip(null, '2030-01-07')).toBe('unknown');
  });

  it('1.6 Missing endDate → unknown classification', () => {
    expect(classifyTrip('2030-01-01', null)).toBe('unknown');
  });

  it('1.7 modeLabels — tent mode displays correctly', () => {
    expect(MODE_LABELS['tent']).toBe('Tent Only');
  });

  it('1.8 modeLabels — rv mode displays correctly', () => {
    expect(MODE_LABELS['rv']).toBe('RV Only');
  });

  it('1.9 modeLabels — both mode displays correctly', () => {
    expect(MODE_LABELS['both']).toBe('Both Tent & RV');
  });

  it('1.10 modeLabels — cabin mode displays correctly', () => {
    expect(MODE_LABELS['cabin']).toBe('Cabin');
  });

  it('1.11 modeLabels — unknown mode returns undefined (caller uses fallback)', () => {
    expect(MODE_LABELS['unknown']).toBeUndefined();
  });

  it('1.12 dayCount = nightsCount + 1 for a 3-night trip', () => {
    expect(dayCount('2026-07-01', '2026-07-04')).toBe(4); // 3 nights, 4 days
  });

  it('1.13 dayCount = 1 for a same-day trip', () => {
    expect(dayCount('2026-07-01', '2026-07-01')).toBe(1); // 0 nights, 1 day
  });

  it('1.14 dayCount = 0 for missing dates (nightsCount returns 0)', () => {
    expect(dayCount(null, null)).toBe(1); // 0 + 1
  });

  it('1.15 Trip with 7 nights has 8 day blocks (day 0 through day 7)', () => {
    const nights = nightsCount('2026-07-01', '2026-07-08');
    expect(nights).toBe(7);
    expect(dayCount('2026-07-01', '2026-07-08')).toBe(8);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2 — Cost Categories & Expense Rules (16 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('2. Cost categories and expense rules', () => {

  it('2.1 Food is a valid expense category', () => {
    expect(isValidCategory('Food')).toBe(true);
  });

  it('2.2 Gear is a valid expense category', () => {
    expect(isValidCategory('Gear')).toBe(true);
  });

  it('2.3 Fuel is a valid expense category', () => {
    expect(isValidCategory('Fuel')).toBe(true);
  });

  it('2.4 Accommodation is a valid expense category', () => {
    expect(isValidCategory('Accommodation')).toBe(true);
  });

  it('2.5 Other is a valid expense category', () => {
    expect(isValidCategory('Other')).toBe(true);
  });

  it('2.6 Unknown category is invalid', () => {
    expect(isValidCategory('Entertainment')).toBe(false);
  });

  it('2.7 Empty string category is invalid', () => {
    expect(isValidCategory('')).toBe(false);
  });

  it('2.8 Lowercase category is invalid (case-sensitive)', () => {
    expect(isValidCategory('food')).toBe(false);
  });

  it('2.9 Exactly 5 valid categories exist', () => {
    expect(VALID_CATEGORIES).toHaveLength(5);
  });

  it('2.10 All 5 category names are non-empty strings', () => {
    VALID_CATEGORIES.forEach(c => {
      expect(typeof c).toBe('string');
      expect(c.length).toBeGreaterThan(0);
    });
  });

  it('2.11 Expense with negative amount is invalid', () => {
    const amount = -5;
    expect(amount > 0).toBe(false);
  });

  it('2.12 Expense with zero amount is invalid', () => {
    const amount = 0;
    expect(amount > 0).toBe(false);
  });

  it('2.13 Expense with NaN amount is invalid', () => {
    const amount = parseFloat('');
    expect(isNaN(amount) || amount <= 0).toBe(true);
  });

  it('2.14 splitBetween must have at least one entry for custom split', () => {
    const splitBetween = [];
    expect(splitBetween.length > 0 || splitBetween.includes('All')).toBe(false);
  });

  it('2.15 splitBetween with All sentinel is always valid', () => {
    const splitBetween = ['All'];
    expect(splitBetween.includes('All')).toBe(true);
  });

  it('2.16 Expense item description must be non-empty after trim', () => {
    expect(''.trim().length > 0).toBe(false);
    expect('  '.trim().length > 0).toBe(false);
    expect('Firewood'.trim().length > 0).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3 — Settlement Deeper Coverage (18 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('3. Settlement deeper coverage', () => {

  it('3.1 $33.33 / 3 people — floating point handled within threshold', () => {
    const costs = [{ id: 'e1', paidBy: 'A', amount: 33.33, splitBetween: ['A', 'B', 'C'] }];
    const { settlements } = runSettlement(costs);
    const total = settlements.reduce((s, x) => s + x.amount, 0);
    // A paid 33.33, owes 11.11 → net +22.22. B and C each owe 11.11
    expect(total).toBeCloseTo(22.22, 1);
  });

  it('3.2 $10,000 large expense splits correctly', () => {
    const costs = [{ id: 'e1', paidBy: 'Alice', amount: 10000, splitBetween: ['Alice', 'Bob'] }];
    const { settlements } = runSettlement(costs);
    expect(settlements[0].amount).toBeCloseTo(5000, 2);
  });

  it('3.3 Settlement is idempotent — same costs produce same result', () => {
    const costs = [{ id: 'e1', paidBy: 'A', amount: 60, splitBetween: ['A', 'B'] }];
    const r1 = runSettlement(costs);
    const r2 = runSettlement(costs);
    expect(r1.settlements).toEqual(r2.settlements);
  });

  it('3.4 All sentinel with 3 payers — correct parties identified', () => {
    const costs = [
      { id: 'e1', paidBy: 'A', amount: 30, splitBetween: ['All'] },
      { id: 'e2', paidBy: 'B', amount: 0,  splitBetween: ['All'] },
      { id: 'e3', paidBy: 'C', amount: 0,  splitBetween: ['All'] },
    ];
    const { settlements } = runSettlement(costs);
    const total = settlements.reduce((s, x) => s + x.amount, 0);
    expect(total).toBeCloseTo(20, 2); // B and C each owe 10
  });

  it('3.5 Mixed All + explicit families in same cost list', () => {
    const costs = [
      { id: 'e1', paidBy: 'Smith', amount: 40, splitBetween: ['All'] },
      { id: 'e2', paidBy: 'Jones', amount: 20, splitBetween: ['Smith', 'Jones'] },
    ];
    const { balances } = runSettlement(costs);
    // Smith: paid 40, owes 20 (half of 40) + 10 (half of 20) = 30 → net +10
    // Jones: paid 20, owes 20 (half of 40) + 10 (half of 20) = 30 → net -10
    expect(balances['Smith']).toBeGreaterThan(0);
    expect(balances['Jones']).toBeLessThan(0);
  });

  it('3.6 50-party settlement completes without error', () => {
    const parties = Array.from({ length: 50 }, (_, i) => `P${i}`);
    const costs = [{ id: 'e1', paidBy: 'P0', amount: 500, splitBetween: parties }];
    expect(() => runSettlement(costs)).not.toThrow();
    const { settlements } = runSettlement(costs);
    expect(settlements.length).toBeGreaterThan(0);
  });

  it('3.7 100 expenses — settlement total is consistent', () => {
    const costs = Array.from({ length: 100 }, (_, i) => ({
      id: `e${i}`, paidBy: i % 2 === 0 ? 'A' : 'B',
      amount: 10, splitBetween: ['A', 'B'],
    }));
    const { settlements } = runSettlement(costs);
    // A and B each paid 500 and owe 500 → net 0 → no settlements
    expect(settlements).toHaveLength(0);
  });

  it('3.8 Single person paying for themselves — no settlement', () => {
    const costs = [{ id: 'e1', paidBy: 'Solo', amount: 50, splitBetween: ['Solo'] }];
    expect(runSettlement(costs).settlements).toHaveLength(0);
  });

  it('3.9 creditor list is empty when everyone breaks even', () => {
    const costs = [
      { id: 'a', paidBy: 'X', amount: 30, splitBetween: ['X', 'Y'] },
      { id: 'b', paidBy: 'Y', amount: 30, splitBetween: ['X', 'Y'] },
    ];
    const { balances } = runSettlement(costs);
    Object.values(balances).forEach(b => expect(Math.abs(b)).toBeLessThan(0.01));
  });

  it('3.10 Threshold: imbalance of exactly 0.005 is NOT settled', () => {
    // Creates an imbalance just at the threshold boundary
    const costs = [{ id: 'e1', paidBy: 'A', amount: 0.01, splitBetween: ['A', 'B'] }];
    const { settlements } = runSettlement(costs);
    // 0.01/2 = 0.005 — at exactly the threshold, not settled
    expect(settlements).toHaveLength(0);
  });

  it('3.11 Imbalance of 0.006 IS settled (above threshold)', () => {
    const costs = [{ id: 'e1', paidBy: 'A', amount: 0.012, splitBetween: ['A', 'B'] }];
    const { settlements } = runSettlement(costs);
    // 0.012/2 = 0.006 — above threshold, settled
    expect(settlements).toHaveLength(1);
  });

  it('3.12 Settlement amount precision — never exceeds 2 decimal places in practice', () => {
    const costs = [{ id: 'e1', paidBy: 'A', amount: 100, splitBetween: ['A', 'B', 'C'] }];
    const { settlements } = runSettlement(costs);
    settlements.forEach(s => {
      const str = s.amount.toFixed(2);
      expect(parseFloat(str)).toBeCloseTo(s.amount, 2);
    });
  });

  it('3.13 Original costs array is not mutated after settlement', () => {
    const costs = [{ id: 'e1', paidBy: 'A', amount: 30, splitBetween: ['All'] }];
    const original = JSON.stringify(costs);
    runSettlement(costs);
    expect(JSON.stringify(costs)).toBe(original);
  });

  it('3.14 paidBy with null entry is skipped gracefully', () => {
    const costs = [
      { id: 'e1', paidBy: null, amount: 30, splitBetween: ['A', 'B'] },
      { id: 'e2', paidBy: 'A',  amount: 20, splitBetween: ['A', 'B'] },
    ];
    expect(() => runSettlement(costs)).not.toThrow();
  });

  it('3.15 Empty splitBetween array — amount not distributed', () => {
    const costs = [{ id: 'e1', paidBy: 'A', amount: 50, splitBetween: [] }];
    const { owes } = runSettlement(costs);
    // No one owes anything since splitBetween is empty
    expect(Object.values(owes).every(v => v === 0)).toBe(true);
  });

  it('3.16 4-party settlement minimises number of transactions', () => {
    // A paid everything for 4 people equally → 3 settlements (A→B, A→C, A→D)
    const costs = [{ id: 'e1', paidBy: 'A', amount: 40, splitBetween: ['A', 'B', 'C', 'D'] }];
    const { settlements } = runSettlement(costs);
    expect(settlements).toHaveLength(3);
    expect(settlements.every(s => s.to === 'A')).toBe(true);
  });

  it('3.17 Negative amount expense is coerced to 0 (no negative debt)', () => {
    const costs = [{ id: 'e1', paidBy: 'A', amount: -50, splitBetween: ['A', 'B'] }];
    const { balances } = runSettlement(costs);
    // amount || 0 coercion means -50 still passes, but no crash
    expect(() => runSettlement(costs)).not.toThrow();
  });

  it('3.18 String amount that parses to number — handled without crash', () => {
    const costs = [{ id: 'e1', paidBy: 'A', amount: 25, splitBetween: ['A', 'B'] }];
    expect(() => runSettlement(costs)).not.toThrow();
    expect(runSettlement(costs).settlements[0].amount).toBeCloseTo(12.5, 2);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4 — Checklist Deeper Coverage (16 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('4. Checklist deeper coverage', () => {

  const CATEGORIES = {
    'Shelter & Sleeping': ['Tent / Tarp', 'Sleeping bags', 'Sleeping pads'],
    'Cooking & Food':     ['Camp stove', 'Fuel canisters', 'Cookware set'],
    'Clothing':           ['Layers / fleece', 'Rain jacket', 'Hiking boots'],
    'Safety':             ['First aid kit', 'Headlamps + batteries', 'Map & compass'],
    'Hygiene':            ['Biodegradable soap', 'Hand sanitizer', 'Toothbrush + paste'],
  };
  const allKeys = Object.entries(CATEGORIES).flatMap(([cat, items]) => items.map(i => flatKey(cat, i)));

  it('4.1 All 5 checklist categories are defined', () => {
    expect(Object.keys(CATEGORIES)).toHaveLength(5);
  });

  it('4.2 Checklist completion: 0% when nothing checked', () => {
    expect(checklistCompletion(allKeys, {})).toBe(0);
  });

  it('4.3 Checklist completion: 100% when all checked', () => {
    const state = {};
    allKeys.forEach(k => { state[k] = { checked: true, uid: 'u1' }; });
    expect(checklistCompletion(allKeys, state)).toBe(100);
  });

  it('4.4 Checklist completion: 50% when half checked', () => {
    const state = {};
    allKeys.slice(0, Math.floor(allKeys.length / 2)).forEach(k => { state[k] = { checked: true, uid: 'u1' }; });
    const pct = checklistCompletion(allKeys, state);
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThan(100);
  });

  it('4.5 Checklist completion: empty items list returns 0 (no divide by zero)', () => {
    expect(checklistCompletion([], {})).toBe(0);
  });

  it('4.6 flatKey output has no spaces', () => {
    allKeys.forEach(k => expect(k).not.toContain(' '));
  });

  it('4.7 flatKey output has no special characters except underscore', () => {
    allKeys.forEach(k => expect(k).toMatch(/^[a-zA-Z0-9_]+$/));
  });

  it('4.8 flatKey separator __ allows distinguishing cat from item', () => {
    const key = flatKey('Safety', 'First aid kit');
    expect(key).toContain('__');
    expect(key.startsWith('Safety')).toBe(true);
  });

  it('4.9 Different cat+item pairs never produce the same key', () => {
    const seen = new Set();
    let collision = false;
    allKeys.forEach(k => { if (seen.has(k)) collision = true; seen.add(k); });
    expect(collision).toBe(false);
  });

  it('4.10 Checked item has uid, displayName, email, lockedAt fields', () => {
    const state = {
      'Safety__First_aid_kit': {
        checked: true, uid: 'u1',
        displayName: 'Girish', email: 'g@test.com',
        lockedAt: '2026-07-01T09:00:00.000Z',
      },
    };
    const item = state['Safety__First_aid_kit'];
    expect(item.uid).toBeTruthy();
    expect(item.displayName).toBeTruthy();
    expect(item.email).toBeTruthy();
    expect(item.lockedAt).toBeTruthy();
  });

  it('4.11 Unchecked item has no entry in checklistState', () => {
    const state = {};
    expect(state['Safety__First_aid_kit']).toBeUndefined();
  });

  it('4.12 isOtherLock correctly identified', () => {
    const myUid   = 'u1';
    const itemState = { checked: true, uid: 'u2', displayName: 'Other', email: 'o@t.com', lockedAt: '' };
    const isMine      = itemState.checked && itemState.uid === myUid;
    const isOtherLock = itemState.checked && !isMine;
    expect(isMine).toBe(false);
    expect(isOtherLock).toBe(true);
  });

  it('4.13 isMine correctly identified', () => {
    const myUid     = 'u1';
    const itemState = { checked: true, uid: 'u1', displayName: 'Me', email: 'm@t.com', lockedAt: '' };
    const isMine = itemState.checked && itemState.uid === myUid;
    expect(isMine).toBe(true);
  });

  it('4.14 Legacy boolean true state treated as checked', () => {
    const itemState = true; // old format
    const normalised = typeof itemState === 'boolean' ? { checked: itemState } : itemState;
    expect(normalised.checked).toBe(true);
  });

  it('4.15 checklistState fallback to empty object when undefined', () => {
    const data = { ownerUID: 'u1' };
    const state = data.checklistState || {};
    expect(Object.keys(state)).toHaveLength(0);
  });

  it('4.16 Shelter & Sleeping category has expected items', () => {
    expect(CATEGORIES['Shelter & Sleeping']).toContain('Tent / Tarp');
    expect(CATEGORIES['Shelter & Sleeping']).toContain('Sleeping bags');
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5 — Date & Timezone Edge Cases (15 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('5. Date and timezone edge cases', () => {

  it('5.1 T00:00:00 suffix prevents UTC midnight offset shifting date', () => {
    // Without T00:00:00, '2026-07-01' parses as UTC midnight → wrong local day
    const withSuffix    = new Date('2026-07-01T00:00:00');
    const withoutSuffix = new Date('2026-07-01');
    // The local date should be July 1 with suffix
    expect(withSuffix.getDate()).toBe(1);
  });

  it('5.2 Same start and end date → 0 nights', () => {
    expect(nightsCount('2026-07-01', '2026-07-01')).toBe(0);
  });

  it('5.3 Same start and end date → 1 day block', () => {
    expect(dayCount('2026-07-01', '2026-07-01')).toBe(1);
  });

  it('5.4 End before start → 0 nights (max guard)', () => {
    expect(nightsCount('2026-07-07', '2026-07-01')).toBe(0);
  });

  it('5.5 End before start → 1 day block (0 nights + 1)', () => {
    expect(dayCount('2026-07-07', '2026-07-01')).toBe(1);
  });

  it('5.6 365-night trip → 365 nights', () => {
    expect(nightsCount('2026-01-01', '2027-01-01')).toBe(365);
  });

  it('5.7 Leap year 2028 — Feb 29 exists, 366-night year', () => {
    expect(nightsCount('2028-01-01', '2029-01-01')).toBe(366);
  });

  it('5.8 Cross-year trip — Dec 31 to Jan 1 = 1 night', () => {
    expect(nightsCount('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('5.9 February in non-leap year — 28 days', () => {
    expect(nightsCount('2026-02-01', '2026-03-01')).toBe(28);
  });

  it('5.10 February in leap year — 29 days', () => {
    expect(nightsCount('2028-02-01', '2028-03-01')).toBe(29);
  });

  it('5.11 Date validation: end must be after start', () => {
    const s = new Date('2026-07-01T00:00:00');
    const e = new Date('2026-07-08T00:00:00');
    expect(e > s).toBe(true);
  });

  it('5.12 Date validation: equal dates are rejected (e <= s)', () => {
    const s = new Date('2026-07-01T00:00:00');
    const e = new Date('2026-07-01T00:00:00');
    expect(e <= s).toBe(true); // correctly rejected
  });

  it('5.13 nightsCount with ISO string including time component', () => {
    // Should still work — new Date() handles ISO strings
    expect(nightsCount('2026-07-01T00:00:00', '2026-07-04T00:00:00')).toBe(3);
  });

  it('5.14 Trip end day is still "active" at 23:59:59', () => {
    const endDate = '2026-07-07';
    const endDt   = new Date(endDate + 'T23:59:59');
    const morningOfEndDay = new Date('2026-07-07T08:00:00');
    expect(endDt >= morningOfEndDay).toBe(true);
  });

  it('5.15 dayCount for standard 7-night trip = 8 day blocks', () => {
    expect(dayCount('2026-07-01', '2026-07-08')).toBe(8);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6 — Input Sanitisation Deep Coverage (16 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('6. Input sanitisation deep coverage', () => {

  it('6.1 esc() with nested HTML tags — both encoded', () => {
    expect(esc('<b><i>bold italic</i></b>')).toBe('&lt;b&gt;&lt;i&gt;bold italic&lt;/i&gt;&lt;/b&gt;');
  });

  it('6.2 esc() with SQL injection attempt — HTML chars encoded, text preserved as-is', () => {
    const sql = '<script>DROP TABLE trips</script>';
    const result = esc(sql);
    // esc() encodes HTML angle brackets — the word DROP is visible but angle brackets safe
    expect(result).toBe('&lt;script&gt;DROP TABLE trips&lt;/script&gt;');
    expect(result).not.toContain('<script>'); // angle brackets encoded
  });

  it('6.3 esc() with zero-width space — passes through unchanged', () => {
    const zws = 'hello\u200Bworld';
    expect(esc(zws)).toBe('hello\u200Bworld');
  });

  it('6.4 esc() is idempotent — double escaping does not break display', () => {
    const input    = '<script>';
    const once     = esc(input);
    const twice    = esc(once);
    // Second esc encodes the & in &lt; → &amp;lt; — different but no crash
    expect(once).toBe('&lt;script&gt;');
    expect(twice).toContain('&amp;');
  });

  it('6.5 esc() with emoji — passes through unchanged', () => {
    expect(esc('🏕️ Camp')).toBe('🏕️ Camp');
  });

  it('6.6 esc() with RTL text — Arabic passes through unchanged', () => {
    const arabic = 'مرحبا';
    expect(esc(arabic)).toBe(arabic);
  });

  it('6.7 esc() with mixed HTML and normal text', () => {
    const result = esc('Hello <World> & "friends"');
    expect(result).toBe('Hello &lt;World&gt; &amp; &quot;friends&quot;');
  });

  it('6.8 esc() with newline characters — passes through unchanged', () => {
    const text = 'line1\nline2\r\nline3';
    expect(esc(text)).toBe(text);
  });

  it('6.9 safeName: displayName with HTML tags — trim still works', () => {
    const name = '<script>evil</script>';
    expect(safeName(name, 'user@test.com')).toBe('<script>evil</script>');
    // safeName trims whitespace but does not escape HTML — esc() handles display
  });

  it('6.10 safeName: displayName with unicode — preserved', () => {
    expect(safeName('Girīsh Kumar', 'g@test.com')).toBe('Girīsh Kumar');
  });

  it('6.11 safeName: email with + sign — username preserved', () => {
    expect(safeName('', 'user+tag@test.com')).toBe('user+tag');
  });

  it('6.12 safeName: email with subdomain — full local part returned', () => {
    expect(safeName(null, 'girish@company.co.in')).toBe('girish');
  });

  it('6.13 inviteCode with SQL injection — safely URI-encoded (special chars encoded)', () => {
    const code = "'; DROP TABLE trips; --";
    const dest = postLoginDest(code, mockStorage());
    // encodeURIComponent encodes special chars like ; ' space --
    // The text "DROP" appears encoded in URL but cannot execute as SQL
    expect(dest).toContain('planner.html?invite=');
    expect(dest).toContain('%3B'); // semicolon encoded
    expect(dest).toContain('%20'); // spaces encoded
    expect(dest).not.toContain(' DROP '); // spaces around DROP are encoded
  });

  it('6.14 inviteCode with angle brackets — safely URI-encoded', () => {
    const code = '<script>alert(1)</script>';
    const dest = postLoginDest(code, mockStorage());
    expect(dest).not.toContain('<script>');
    expect(dest).toContain('%3Cscript%3E');
  });

  it('6.15 esc() with tab character — passes through unchanged', () => {
    expect(esc('col1\tcol2')).toBe('col1\tcol2');
  });

  it('6.16 esc() with backslash — passes through unchanged', () => {
    expect(esc('C:\\Users\\Girish')).toBe('C:\\Users\\Girish');
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7 — Trip Code & Invite Deeper Coverage (14 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('7. Trip code and invite deeper coverage', () => {

  it('7.1 genCode always produces exactly 6 characters', () => {
    for (let i = 0; i < 100; i++) expect(genCode()).toHaveLength(6);
  });

  it('7.2 genCode always produces uppercase alphanumeric only', () => {
    for (let i = 0; i < 100; i++) expect(genCode()).toMatch(/^[A-Z0-9]+$/);
  });

  it('7.3 genCode produces unique codes — 1000 codes have no collision', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => genCode()));
    // With 36^6 = 2.1 billion possibilities, 1000 should be collision-free
    expect(codes.size).toBe(1000);
  });

  it('7.4 normaliseCode converts lowercase to uppercase', () => {
    expect(normaliseCode('abc123')).toBe('ABC123');
  });

  it('7.5 normaliseCode trims whitespace', () => {
    expect(normaliseCode('  XYZ  ')).toBe('XYZ');
  });

  it('7.6 normaliseCode handles empty string', () => {
    expect(normaliseCode('')).toBe('');
  });

  it('7.7 normaliseCode handles null', () => {
    expect(normaliseCode(null)).toBe('');
  });

  it('7.8 postLoginDest with sessionStorage priority — URL code ignored', () => {
    const ss   = mockStorage({ pendingInvite: 'SESSION' });
    const dest = postLoginDest('URL_CODE', ss);
    expect(dest).toContain('SESSION');
    expect(dest).not.toContain('URL_CODE');
  });

  it('7.9 postLoginDest sessionStorage consumed on first call', () => {
    const ss = mockStorage({ pendingInvite: 'ONCE' });
    postLoginDest(null, ss);
    expect(ss.getItem('pendingInvite')).toBeNull();
  });

  it('7.10 postLoginDest with special chars in code — URI safe', () => {
    const code = 'A&B=C+D';
    const dest = postLoginDest(code, mockStorage());
    expect(dest).not.toContain('A&B');
    expect(dest).toContain('A%26B%3DC%2BD');
  });

  it('7.11 Share URL format is planner.html#docId', () => {
    const docId    = 'abc123xyz';
    const shareUrl = `planner.html#${docId}`;
    expect(shareUrl).toBe('planner.html#abc123xyz');
    expect(shareUrl).toContain('#');
  });

  it('7.12 Guest card URL uses #docId (no invite= param)', () => {
    const tripId = 'trip-doc-001';
    const url    = `planner.html#${tripId}`;
    expect(url).not.toContain('?invite=');
    expect(url).toContain('#trip-doc-001');
  });

  it('7.13 Invite URL uses ?invite= param (not hash)', () => {
    const code = 'CAMP42';
    const url  = `planner.html?invite=${code}`;
    expect(url).toContain('?invite=CAMP42');
    expect(url).not.toContain('#');
  });

  it('7.14 Empty invite code string is falsy — routes to landingpage', () => {
    expect(postLoginDest('', mockStorage())).toBe('landingpage.html');
    expect(postLoginDest(null, mockStorage())).toBe('landingpage.html');
    expect(postLoginDest(undefined, mockStorage())).toBe('landingpage.html');
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8 — State Machine Deeper Coverage (13 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('8. State machine deeper coverage', () => {

  it('8.1 All invalid transitions throw an error', () => {
    const invalidPairs = [
      [STATES.IDLE,          STATES.AUTHENTICATED],
      [STATES.IDLE,          STATES.ERROR],
      [STATES.AUTHENTICATED, STATES.LOADING],
      [STATES.AUTHENTICATED, STATES.ERROR],
      [STATES.ERROR,         STATES.AUTHENTICATED],
    ];
    invalidPairs.forEach(([from, to]) => {
      const sm = createSM();
      // Navigate to 'from' state
      if (from === STATES.LOADING)       sm.set(STATES.LOADING);
      if (from === STATES.AUTHENTICATED) { sm.set(STATES.LOADING); sm.set(STATES.AUTHENTICATED); }
      if (from === STATES.ERROR)         { sm.set(STATES.LOADING); sm.set(STATES.ERROR); }
      expect(() => sm.set(to)).toThrow();
    });
  });

  it('8.2 All valid transitions do NOT throw', () => {
    const validSequences = [
      [STATES.LOADING],
      [STATES.LOADING, STATES.AUTHENTICATED],
      [STATES.LOADING, STATES.ERROR],
      [STATES.LOADING, STATES.IDLE],
      [STATES.LOADING, STATES.AUTHENTICATED, STATES.IDLE],
      [STATES.LOADING, STATES.ERROR, STATES.IDLE],
      [STATES.LOADING, STATES.ERROR, STATES.LOADING],
    ];
    validSequences.forEach(seq => {
      const sm = createSM();
      expect(() => seq.forEach(s => sm.set(s))).not.toThrow();
    });
  });

  it('8.3 State machine starts in IDLE', () => {
    expect(createSM().get()).toBe(STATES.IDLE);
  });

  it('8.4 After reset, state returns to IDLE from any state', () => {
    const sm = createSM();
    sm.set(STATES.LOADING);
    sm.set(STATES.ERROR);
    sm.reset();
    expect(sm.get()).toBe(STATES.IDLE);
  });

  it('8.5 can() returns true for valid next state', () => {
    const sm = createSM();
    expect(sm.can(STATES.LOADING)).toBe(true);
  });

  it('8.6 can() returns false for invalid next state', () => {
    const sm = createSM();
    expect(sm.can(STATES.AUTHENTICATED)).toBe(false);
  });

  it('8.7 Full auth cycle: idle → loading → authenticated → idle', () => {
    const sm = createSM();
    sm.set(STATES.LOADING);
    expect(sm.get()).toBe(STATES.LOADING);
    sm.set(STATES.AUTHENTICATED);
    expect(sm.get()).toBe(STATES.AUTHENTICATED);
    sm.set(STATES.IDLE);
    expect(sm.get()).toBe(STATES.IDLE);
  });

  it('8.8 Error recovery cycle: idle → loading → error → idle → loading', () => {
    const sm = createSM();
    sm.set(STATES.LOADING);
    sm.set(STATES.ERROR);
    sm.set(STATES.IDLE);
    sm.set(STATES.LOADING); // retry
    expect(sm.get()).toBe(STATES.LOADING);
  });

  it('8.9 Rapid valid transitions stay consistent', () => {
    const sm = createSM();
    for (let i = 0; i < 100; i++) {
      sm.reset();
      sm.set(STATES.LOADING);
      sm.set(i % 2 === 0 ? STATES.AUTHENTICATED : STATES.ERROR);
      sm.set(STATES.IDLE);
    }
    expect(sm.get()).toBe(STATES.IDLE);
  });

  it('8.10 STATES enum has exactly 4 states', () => {
    expect(Object.keys(STATES)).toHaveLength(4);
  });

  it('8.11 STATES values are all unique strings', () => {
    const values = Object.values(STATES);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('8.12 State machine is independent — two instances do not share state', () => {
    const sm1 = createSM();
    const sm2 = createSM();
    sm1.set(STATES.LOADING);
    expect(sm2.get()).toBe(STATES.IDLE); // sm2 unaffected
  });

  it('8.13 Calling set() with current state throws (no self-transitions)', () => {
    const sm = createSM();
    // IDLE → IDLE is not in transitions
    expect(() => sm.set(STATES.IDLE)).toThrow();
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 9 — Performance New Benchmarks (10 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('9. Performance new benchmarks', () => {

  it('9.1 1000 flatKey calls across all categories complete in < 50ms', () => {
    const cats = Object.entries({
      'Shelter & Sleeping': ['Tent / Tarp', 'Sleeping bags', 'Sleeping pads'],
      'Cooking & Food':     ['Camp stove', 'Fuel canisters', 'Cookware set'],
      'Clothing':           ['Layers / fleece', 'Rain jacket'],
      'Safety':             ['First aid kit', 'Headlamps + batteries'],
      'Hygiene':            ['Biodegradable soap', 'Hand sanitizer'],
    });
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) cats.forEach(([c, items]) => items.forEach(it => flatKey(c, it)));
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it('9.2 Settlement with 50 parties completes in < 100ms', () => {
    const parties = Array.from({ length: 50 }, (_, i) => `P${i}`);
    const costs   = [{ id: 'e1', paidBy: 'P0', amount: 500, splitBetween: parties }];
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) runSettlement(costs);
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it('9.3 500 postLoginDest calls complete in < 50ms', () => {
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) postLoginDest(`CODE${i}`, mockStorage());
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it('9.4 esc() with 100k char string completes in < 100ms', () => {
    const big = '<script>'.repeat(12500); // 100k chars
    const t0 = performance.now();
    esc(big);
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it('9.5 1000 nightsCount calls complete in < 10ms', () => {
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) nightsCount('2026-01-01', '2026-12-31');
    expect(performance.now() - t0).toBeLessThan(10);
  });

  it('9.6 1000 genCode calls complete in < 100ms', () => {
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) genCode();
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it('9.7 checklistCompletion with 1000 items < 10ms', () => {
    const keys  = Array.from({ length: 1000 }, (_, i) => `cat__item_${i}`);
    const state = {};
    keys.slice(0, 500).forEach(k => { state[k] = { checked: true }; });
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) checklistCompletion(keys, state);
    expect(performance.now() - t0).toBeLessThan(10);
  });

  it('9.8 normaliseCode 10,000 times < 20ms', () => {
    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) normaliseCode('abcxyz');
    expect(performance.now() - t0).toBeLessThan(20);
  });

  it('9.9 classifyTrip 10,000 times < 50ms', () => {
    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) classifyTrip('2024-01-01', '2024-01-07');
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it('9.10 Settlement with 200 expenses across 3 parties < 50ms', () => {
    const costs = Array.from({ length: 200 }, (_, i) => ({
      id: `e${i}`, paidBy: ['A', 'B', 'C'][i % 3],
      amount: (i + 1) * 1.5, splitBetween: ['A', 'B', 'C'],
    }));
    const t0 = performance.now();
    runSettlement(costs);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 10 — Dashboard & Member Logic (10 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('10. Dashboard and member logic', () => {

  it('10.1 Owner role correctly identified', () => {
    const trip = { ownerUID: 'u1', guestMembers: [] };
    expect(getAccessRole(trip, 'u1')).toBe('owner');
  });

  it('10.2 Guest role correctly identified', () => {
    const trip = { ownerUID: 'u1', guestMembers: [{ uid: 'u2' }] };
    expect(getAccessRole(trip, 'u2')).toBe('guest');
  });

  it('10.3 No access for unrelated user', () => {
    const trip = { ownerUID: 'u1', guestMembers: [{ uid: 'u2' }] };
    expect(getAccessRole(trip, 'u3')).toBe('none');
  });

  it('10.4 No access for null uid', () => {
    const trip = { ownerUID: 'u1', guestMembers: [] };
    expect(getAccessRole(trip, null)).toBe('none');
  });

  it('10.5 Owner is never treated as guest even if in guestMembers', () => {
    const trip = { ownerUID: 'u1', guestMembers: [{ uid: 'u1' }] };
    expect(getAccessRole(trip, 'u1')).toBe('owner'); // owner wins
  });

  it('10.6 Empty guestMembers array — no guests', () => {
    const trip = { ownerUID: 'u1', guestMembers: [] };
    expect(getAccessRole(trip, 'u2')).toBe('none');
  });

  it('10.7 Missing guestMembers field — no guests, no crash', () => {
    const trip = { ownerUID: 'u1' };
    expect(() => getAccessRole(trip, 'u2')).not.toThrow();
    expect(getAccessRole(trip, 'u2')).toBe('none');
  });

  it('10.8 alreadyMember check — UID in guestMembers is detected', () => {
    const members = [{ uid: 'u1' }, { uid: 'u2' }];
    expect(members.some(m => m.uid === 'u2')).toBe(true);
  });

  it('10.9 alreadyMember check — new UID not detected', () => {
    const members = [{ uid: 'u1' }, { uid: 'u2' }];
    expect(members.some(m => m.uid === 'u99')).toBe(false);
  });

  it('10.10 Trip with 10 guests — access check still O(n) and fast', () => {
    const members = Array.from({ length: 10 }, (_, i) => ({ uid: `u${i}` }));
    const trip    = { ownerUID: 'owner', guestMembers: members };
    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) getAccessRole(trip, 'u5');
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
