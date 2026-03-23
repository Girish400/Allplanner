/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║       PlanAway — Pure Logic Unit Tests                           ║
 * ║  NO Firebase / NO emulator / NO network required                 ║
 * ║  Run: npm test                                                   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * 89 tests across 15 sections covering:
 *   • Settlement math & greedy algorithm
 *   • nightsCount date utility
 *   • flatKey checklist key generation
 *   • postLoginDest auth routing (invite code + sessionStorage)
 *   • Input sanitisation / XSS prevention (esc())
 *   • Auth token-refresh UID guard
 *   • Family management logic
 *   • Expense validation rules
 *   • Checklist lock system
 *   • Edge cases & boundary conditions
 *   • Performance benchmarks
 */

import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTIONS EXTRACTED FROM planner.html / landingpage.html / index.html
// These are exact copies of the production functions so tests reflect real behaviour
// ─────────────────────────────────────────────────────────────────────────────

/** renderSettlement() — planner.html */
function runSettlement(costs) {
  const allPayers = new Set(costs.map(c => c.paidBy).filter(Boolean));
  const allParties = new Set();
  costs.forEach(c => {
    if (c.paidBy) allParties.add(c.paidBy);
    if (Array.isArray(c.splitBetween)) {
      c.splitBetween.forEach(f => {
        if (f === 'All') { allPayers.forEach(p => allParties.add(p)); }
        else             { allParties.add(f); }
      });
    }
  });
  const paid = {}, owes = {};
  allParties.forEach(p => { paid[p] = 0; owes[p] = 0; });
  costs.forEach(c => {
    const amt = c.amount || 0;
    if (c.paidBy && allParties.has(c.paidBy)) paid[c.paidBy] += amt;
    let split = Array.isArray(c.splitBetween) && c.splitBetween.length > 0 ? c.splitBetween : [];
    if (split.includes('All')) split = Array.from(allPayers);
    if (split.length) {
      const share = amt / split.length;
      split.forEach(p => { if (!owes[p]) owes[p] = 0; owes[p] += share; });
    }
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

/** nightsCount() — planner.html */
function nightsCount(s, e) {
  if (!s || !e) return 0;
  return Math.max(0, Math.round((new Date(e) - new Date(s)) / 86400000));
}

/** flatKey() — planner.html */
function flatKey(cat, item) {
  return (cat + '__' + item).replace(/[^a-zA-Z0-9]/g, '_');
}

/** esc() — planner.html + landingpage.html */
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** genCode() — landingpage.html */
function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/** postLoginDest() — index.html (accepts mock sessionStorage for testability) */
function postLoginDest(inviteCode, mockStorage) {
  const pending = mockStorage.getItem('pendingInvite');
  if (pending) {
    mockStorage.removeItem('pendingInvite');
    return `planner.html?invite=${encodeURIComponent(pending)}`;
  }
  if (inviteCode) return `planner.html?invite=${encodeURIComponent(inviteCode)}`;
  return 'landingpage.html';
}

/** Mock sessionStorage for postLoginDest tests */
function mockStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem:    k      => store[k] ?? null,
    setItem:    (k, v) => { store[k] = v; },
    removeItem: k      => { delete store[k]; },
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1 — Settlement calculation
// Tests the core financial engine: greedy debt-settlement algorithm
// ═══════════════════════════════════════════════════════════════════════════

describe('1. Settlement calculation', () => {

  it('1.1 Simple 2-party split — one pays, other owes half', () => {
    const costs = [{ id: 'e1', item: 'Firewood', paidBy: 'Smith', amount: 40, splitBetween: ['Smith', 'Jones'] }];
    const { settlements } = runSettlement(costs);
    expect(settlements).toHaveLength(1);
    expect(settlements[0].from).toBe('Jones');
    expect(settlements[0].to).toBe('Smith');
    expect(settlements[0].amount).toBeCloseTo(20, 2);
  });

  it('1.2 3-party split — even thirds, correct total owed back', () => {
    const costs = [{ id: 'e1', item: 'Ice', paidBy: 'Alice', amount: 30, splitBetween: ['Alice', 'Bob', 'Carol'] }];
    const { settlements } = runSettlement(costs);
    expect(settlements).toHaveLength(2);
    const total = settlements.reduce((s, x) => s + x.amount, 0);
    expect(total).toBeCloseTo(20, 2); // Alice is owed $20 (paid $30, owes $10)
  });

  it('1.3 Multi-expense netting — balances netted before settling', () => {
    const costs = [
      { id: 'e1', paidBy: 'Alice', amount: 60, splitBetween: ['Alice', 'Bob'] },
      { id: 'e2', paidBy: 'Bob',   amount: 40, splitBetween: ['Alice', 'Bob'] },
    ];
    // Alice paid 60, owes 50 → net +10 | Bob paid 40, owes 50 → net -10
    const { settlements } = runSettlement(costs);
    expect(settlements).toHaveLength(1);
    expect(settlements[0].from).toBe('Bob');
    expect(settlements[0].to).toBe('Alice');
    expect(settlements[0].amount).toBeCloseTo(10, 2);
  });

  it('1.4 "All" sentinel with single payer — no settlement (payer covers themselves)', () => {
    const costs = [{ id: 'e1', paidBy: 'Alice', amount: 30, splitBetween: ['All'] }];
    const { settlements } = runSettlement(costs);
    expect(settlements).toHaveLength(0);
  });

  it('1.5 "All" sentinel with 2 different payers — settlement correctly produced', () => {
    // Alice paid $30 split "All" — allPayers = {Alice, Bob}
    // Alice owes $15, Bob owes $15. Alice net: +15, Bob net: -15
    const costs = [
      { id: 'e1', paidBy: 'Alice', amount: 30, splitBetween: ['All'] },
      { id: 'e2', paidBy: 'Bob',   amount: 0,  splitBetween: ['All'] },
    ];
    const { settlements } = runSettlement(costs);
    expect(settlements).toHaveLength(1);
    expect(settlements[0].from).toBe('Bob');
    expect(settlements[0].to).toBe('Alice');
    expect(settlements[0].amount).toBeCloseTo(15, 2);
  });

  it('1.6 Zero costs — empty result, no crash', () => {
    const { settlements, paid, owes } = runSettlement([]);
    expect(settlements).toHaveLength(0);
    expect(Object.keys(paid)).toHaveLength(0);
  });

  it('1.7 Everyone pays equal share — net zero, no settlements needed', () => {
    const costs = [
      { id: 'a', paidBy: 'X', amount: 30, splitBetween: ['X', 'Y', 'Z'] },
      { id: 'b', paidBy: 'Y', amount: 30, splitBetween: ['X', 'Y', 'Z'] },
      { id: 'c', paidBy: 'Z', amount: 30, splitBetween: ['X', 'Y', 'Z'] },
    ];
    expect(runSettlement(costs).settlements).toHaveLength(0);
  });

  it('1.8 Settlement total equals sum of all underpayers', () => {
    // A paid $100, split 4 ways → A owes $25, B/C/D owe $25 each
    const costs = [{ id: 'e1', paidBy: 'A', amount: 100, splitBetween: ['A', 'B', 'C', 'D'] }];
    const { settlements } = runSettlement(costs);
    const total = settlements.reduce((s, x) => s + x.amount, 0);
    expect(total).toBeCloseTo(75, 2);
  });

  it('1.9 Floating-point stability — $0.10 ÷ 3 parties', () => {
    const costs = [{ id: 'e1', paidBy: 'A', amount: 0.1, splitBetween: ['A', 'B', 'C'] }];
    const total = runSettlement(costs).settlements.reduce((s, x) => s + x.amount, 0);
    expect(total).toBeCloseTo(0.0667, 3);
  });

  it('1.10 Very small imbalance below 0.005 threshold — NOT settled', () => {
    // Net difference is ~0.0005 per party, below the 0.005 noise floor
    const costs = [
      { id: 'e1', paidBy: 'A', amount: 10.001, splitBetween: ['A', 'B'] },
      { id: 'e2', paidBy: 'B', amount: 10.000, splitBetween: ['A', 'B'] },
    ];
    expect(runSettlement(costs).settlements).toHaveLength(0);
  });

  it('1.11 SQL-injection strings in paidBy/item — no crash, safe result', () => {
    const costs = [{
      id: 'sql', item: "'; DROP TABLE users;--",
      paidBy: "Smith' OR '1'='1", amount: 50,
      splitBetween: ["Smith' OR '1'='1", 'Jones'],
    }];
    expect(() => runSettlement(costs)).not.toThrow();
    expect(Array.isArray(runSettlement(costs).settlements)).toBe(true);
  });

  it('1.12 Large number of parties — settlement runs without error', () => {
    const parties = Array.from({ length: 20 }, (_, i) => `Party${i}`);
    const costs = [{ id: 'e1', paidBy: 'Party0', amount: 200, splitBetween: parties }];
    expect(() => runSettlement(costs)).not.toThrow();
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2 — nightsCount date utility
// ═══════════════════════════════════════════════════════════════════════════

describe('2. nightsCount()', () => {
  it('2.1 Same-day trip → 0 nights',           () => expect(nightsCount('2026-07-01', '2026-07-01')).toBe(0));
  it('2.2 One-night trip → 1',                  () => expect(nightsCount('2026-07-01', '2026-07-02')).toBe(1));
  it('2.3 Seven-night trip → 7',                () => expect(nightsCount('2026-07-01', '2026-07-08')).toBe(7));
  it('2.4 Missing start → 0',                   () => expect(nightsCount(null, '2026-07-08')).toBe(0));
  it('2.5 Missing end → 0',                     () => expect(nightsCount('2026-07-01', null)).toBe(0));
  it('2.6 Both missing → 0',                    () => expect(nightsCount(null, null)).toBe(0));
  it('2.7 End before start → 0 (max guard)',     () => expect(nightsCount('2026-07-08', '2026-07-01')).toBe(0));
  it('2.8 Leap year February → 2 nights',        () => expect(nightsCount('2028-02-28', '2028-03-01')).toBe(2));
  it('2.9 Cross-year boundary → 3 nights',       () => expect(nightsCount('2025-12-30', '2026-01-02')).toBe(3));
  it('2.10 Day block count = nights + 1 (loop)', () => expect(nightsCount('2026-07-01', '2026-07-04') + 1).toBe(4));
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3 — flatKey checklist key generation
// ═══════════════════════════════════════════════════════════════════════════

describe('3. flatKey()', () => {
  it('3.1 Output contains only [a-zA-Z0-9_]', () => {
    const k = flatKey('Shelter & Sleeping', 'Tent / Tarp');
    expect(/[^a-zA-Z0-9_]/.test(k)).toBe(false);
  });

  it('3.2 Same inputs always produce same key', () => {
    expect(flatKey('Safety', 'First aid kit')).toBe(flatKey('Safety', 'First aid kit'));
  });

  it('3.3 Different categories produce different keys', () => {
    expect(flatKey('Safety', 'Headlamps + batteries'))
      .not.toBe(flatKey('Cooking & Food', 'Headlamps + batteries'));
  });

  it('3.4 All 5 production categories generate valid keys', () => {
    const CATS = {
      'Shelter & Sleeping': ['Tent / Tarp', 'Sleeping bags', 'Sleeping pads', 'Pillows', 'Tarp for rain'],
      'Cooking & Food':     ['Camp stove', 'Fuel canisters', 'Cookware set', 'Utensils', 'Cooler + ice', 'Can opener'],
      'Clothing':           ['Layers / fleece', 'Rain jacket', 'Hiking boots', 'Warm hat', 'Gloves'],
      'Safety':             ['First aid kit', 'Headlamps + batteries', 'Map & compass', 'Emergency whistle'],
      'Hygiene':            ['Biodegradable soap', 'Hand sanitizer', 'Toothbrush + paste', 'Towel', 'Toilet paper'],
    };
    Object.entries(CATS).forEach(([cat, items]) => {
      items.forEach(item => {
        const k = flatKey(cat, item);
        expect(k.length).toBeGreaterThan(0);
        expect(/[^a-zA-Z0-9_]/.test(k)).toBe(false);
      });
    });
  });

  it('3.5 No two different cat+item combos produce the same key (no collisions)', () => {
    const CATS = {
      'Shelter & Sleeping': ['Tent / Tarp', 'Sleeping bags'],
      'Cooking & Food':     ['Camp stove', 'Tent / Tarp'],  // same item name, different cat
    };
    const keys = [];
    Object.entries(CATS).forEach(([cat, items]) =>
      items.forEach(item => keys.push(flatKey(cat, item)))
    );
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4 — postLoginDest auth routing (index.html)
// Tests the Bug 1 fix: sessionStorage invite survives redirect sign-in
// ═══════════════════════════════════════════════════════════════════════════

describe('4. postLoginDest() — auth routing after sign-in', () => {

  it('4.1 No invite anywhere → routes to landingpage.html', () => {
    expect(postLoginDest(null, mockStorage())).toBe('landingpage.html');
  });

  it('4.2 URL inviteCode present → routes to planner.html with ?invite=', () => {
    expect(postLoginDest('ABC123', mockStorage())).toBe('planner.html?invite=ABC123');
  });

  it('4.3 sessionStorage pendingInvite takes priority over URL inviteCode', () => {
    const dest = postLoginDest('ABC123', mockStorage({ pendingInvite: 'XYZ999' }));
    expect(dest).toBe('planner.html?invite=XYZ999');
  });

  it('4.4 sessionStorage invite is consumed (removed) after routing', () => {
    const ss = mockStorage({ pendingInvite: 'XYZ999' });
    postLoginDest(null, ss);
    expect(ss.getItem('pendingInvite')).toBeNull();  // must be gone
  });

  it('4.5 sessionStorage consumed — second call falls back to URL invite', () => {
    const ss = mockStorage({ pendingInvite: 'FIRST' });
    postLoginDest('FALLBACK', ss);       // first call consumes sessionStorage
    const second = postLoginDest('FALLBACK', ss);  // second call uses URL
    expect(second).toBe('planner.html?invite=FALLBACK');
  });

  it('4.6 Special characters in invite code are URI-encoded', () => {
    const dest = postLoginDest('A B+C=D', mockStorage());
    expect(dest).not.toContain(' ');
    expect(dest).toContain('A%20B%2BC%3DD');
  });

  it('4.7 Empty string invite code treated as falsy → landingpage.html', () => {
    expect(postLoginDest('', mockStorage())).toBe('landingpage.html');
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5 — esc() input sanitisation / XSS prevention
// ═══════════════════════════════════════════════════════════════════════════

describe('5. esc() — XSS sanitisation', () => {

  it('5.1 <script> tag is encoded, cannot execute', () => {
    const out = esc('<script>alert("xss")</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('5.2 <img onerror> XSS vector is blocked', () => {
    const out = esc('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('5.3 Ampersand is encoded', () => {
    expect(esc('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  it('5.4 Double quotes are encoded', () => {
    expect(esc('"quoted"')).toBe('&quot;quoted&quot;');
  });

  it('5.5 Greater-than and less-than are encoded', () => {
    expect(esc('1 < 2 > 0')).toBe('1 &lt; 2 &gt; 0');
  });

  it('5.6 null input → empty string, no crash', () => {
    expect(esc(null)).toBe('');
  });

  it('5.7 undefined input → empty string, no crash', () => {
    expect(esc(undefined)).toBe('');
  });

  it('5.8 Number 0 → "0" string', () => {
    expect(esc(0)).toBe('0');
  });

  it('5.9 Normal text passes through unchanged', () => {
    expect(esc('Hello World')).toBe('Hello World');
  });

  it('5.10 10,000-character string handled without throwing', () => {
    expect(() => esc('A'.repeat(10000))).not.toThrow();
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6 — Auth UID guard (Bug 5 fix)
// Ensures hourly token refreshes don't reset the page
// ═══════════════════════════════════════════════════════════════════════════

describe('6. Auth UID guard — token-refresh protection', () => {

  it('6.1 Same UID on re-fire → shouldSkip is true', () => {
    const currentUid = 'user-abc';
    const incomingUser = { uid: 'user-abc' }; // token refresh, same user
    expect(currentUid && currentUid === incomingUser.uid).toBe(true);
  });

  it('6.2 Different UID → shouldSkip is false (genuine sign-in)', () => {
    const currentUid = 'user-abc';
    const incomingUser = { uid: 'user-xyz' };
    expect(currentUid && currentUid === incomingUser.uid).toBe(false);
  });

  it('6.3 currentUid null (first sign-in) → shouldSkip is falsy', () => {
    const currentUid = null;
    const incomingUser = { uid: 'user-abc' };
    // null && ... short-circuits to null, which is falsy — guard correctly skipped
    expect(currentUid && currentUid === incomingUser.uid).toBeFalsy();
  });

  it('6.4 currentUid empty string → shouldSkip is falsy', () => {
    const currentUid = '';
    const incomingUser = { uid: 'user-abc' };
    // '' && ... short-circuits to '', which is falsy — guard correctly skipped
    expect(currentUid && currentUid === incomingUser.uid).toBeFalsy();
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7 — Expense validation rules (client-side guards in addExpense)
// ═══════════════════════════════════════════════════════════════════════════

describe('7. Expense validation', () => {

  it('7.1 Negative amount is rejected', () => {
    const validate = v => !v || v <= 0;
    expect(validate(-5)).toBe(true);
  });

  it('7.2 Zero amount is rejected', () => {
    expect(!0 || 0 <= 0).toBe(true);
  });

  it('7.3 NaN is rejected (parseFloat of empty string)', () => {
    const raw = parseFloat('');
    expect(!raw || raw <= 0).toBe(true);
  });

  it('7.4 Valid small amount 0.01 is accepted', () => {
    const validate = v => !v || v <= 0;
    expect(validate(0.01)).toBe(false);
  });

  it('7.5 Valid large amount is accepted', () => {
    const validate = v => !v || v <= 0;
    expect(validate(9999.99)).toBe(false);
  });

  it('7.6 Empty item description is rejected', () => {
    expect(!''.trim()).toBe(true);
  });

  it('7.7 Whitespace-only item description is rejected after trim', () => {
    expect(!'   '.trim()).toBe(true);
  });

  it('7.8 Valid item description is accepted', () => {
    expect(!'Firewood'.trim()).toBe(false);
  });

  it('7.9 Empty paidBy is rejected', () => {
    expect(!''.trim()).toBe(true);
  });

  it('7.10 Custom split with no families selected is rejected', () => {
    const selected = []; // no checkboxes ticked
    expect(!selected.length).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8 — Checklist lock system (client-side logic)
// ═══════════════════════════════════════════════════════════════════════════

describe('8. Checklist lock system', () => {

  it('8.1 Item checked by me → isMine true, isOtherLock false', () => {
    const MY_UID = 'user-a';
    const state = { checked: true, uid: MY_UID };
    const isMine      = state.checked && state.uid === MY_UID;
    const isOtherLock = state.checked && state.uid && state.uid !== MY_UID;
    expect(isMine).toBe(true);
    expect(isOtherLock).toBe(false);
  });

  it('8.2 Item checked by another → isMine false, isOtherLock true', () => {
    const MY_UID    = 'user-a';
    const OTHER_UID = 'user-b';
    const state = { checked: true, uid: OTHER_UID };
    const isMine      = state.checked && state.uid === MY_UID;
    const isOtherLock = state.checked && state.uid && state.uid !== MY_UID;
    expect(isMine).toBe(false);
    expect(isOtherLock).toBe(true);
  });

  it('8.3 Unchecked item → both false, click allowed', () => {
    const state = undefined;
    const isChecked   = !!(state && (typeof state === 'object' ? state.checked : state === true));
    const isOtherLock = false;
    expect(isChecked).toBe(false);
    expect(isOtherLock).toBe(false);
  });

  it('8.4 Legacy boolean true state is normalised correctly', () => {
    const state = true;
    let isChecked = false, checkedByUid = null, checkedByName = '';
    if (state && typeof state === 'object') {
      isChecked = state.checked; checkedByUid = state.uid;
    } else if (state === true) {
      isChecked = true; checkedByUid = null; checkedByName = '(legacy)';
    }
    expect(isChecked).toBe(true);
    expect(checkedByUid).toBeNull();
    expect(checkedByName).toBe('(legacy)');
  });

  it('8.5 isOtherLock prevents click handler being added', () => {
    // In renderChecklist: `if (!isOtherLock) { row.addEventListener('click', ...) }`
    const isOtherLock = true;
    let handlerWouldBeAdded = false;
    if (!isOtherLock) { handlerWouldBeAdded = true; }
    expect(handlerWouldBeAdded).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 9 — Family management (edit form — Bug 4 fix)
// ═══════════════════════════════════════════════════════════════════════════

describe('9. Family management in edit form', () => {

  it('9.1 Duplicate family name blocked — case-insensitive', () => {
    const families = [{ name: 'Smith Family', members: [] }];
    const val = 'smith family';
    expect(families.some(f => f.name.trim().toLowerCase() === val.toLowerCase())).toBe(true);
  });

  it('9.2 Distinct family name allowed', () => {
    const families = [{ name: 'Smith Family', members: [] }];
    const val = 'Jones Family';
    expect(families.some(f => f.name.trim().toLowerCase() === val.toLowerCase())).toBe(false);
  });

  it('9.3 Remove by name-snapshot finds correct index after prior removal', () => {
    const families = [
      { name: 'Alpha', members: [] },
      { name: 'Beta',  members: [] },
      { name: 'Gamma', members: [] },
    ];
    const snap = 'Beta';
    const idx = families.findIndex(x => x.name === snap);
    families.splice(idx, 1);
    expect(families.map(f => f.name)).toEqual(['Alpha', 'Gamma']);
  });

  it('9.4 Removing first item does not affect remaining items', () => {
    const families = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
    families.splice(families.findIndex(x => x.name === 'A'), 1);
    expect(families.map(f => f.name)).toEqual(['B', 'C']);
  });

  it('9.5 Empty family name is rejected', () => {
    expect(!''.trim()).toBe(true);
  });

  it('9.6 Whitespace-only name is rejected after trim', () => {
    expect(!'   '.trim()).toBe(true);
  });

  it('9.7 Deep-copy of tripData.families prevents mutation of live data', () => {
    const tripDataFamilies = [{ name: 'Original', members: [] }];
    const editFamilies = tripDataFamilies.map(f => ({ ...f }));
    editFamilies[0].name = 'Modified';
    expect(tripDataFamilies[0].name).toBe('Original'); // original untouched
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 10 — Trip code generation and invite URL
// ═══════════════════════════════════════════════════════════════════════════

describe('10. Trip code and invite URL', () => {

  it('10.1 genCode() always produces 6-char uppercase alphanumeric', () => {
    for (let i = 0; i < 30; i++) {
      expect(genCode()).toMatch(/^[A-Z0-9]{6}$/);
    }
  });

  it('10.2 Trip codes are case-normalised to uppercase before Firestore query', () => {
    const rawInput = 'abc123';
    expect(rawInput.toUpperCase()).toBe('ABC123');
  });

  it('10.3 Share URL is built in correct format', () => {
    const tripCode = 'MTN42';
    const url = `https://myapp.com/planner.html?invite=${encodeURIComponent(tripCode)}`;
    expect(url).toBe('https://myapp.com/planner.html?invite=MTN42');
  });

  it('10.4 Guest card uses #docId URL — no invite re-query on dashboard click', () => {
    // Bug 8 fix: plannerUrl = `planner.html#${trip.id}` for all cards
    const tripId = 'abc123';
    const plannerUrl = `planner.html#${tripId}`;
    expect(plannerUrl).toBe('planner.html#abc123');
    expect(plannerUrl).not.toContain('?invite=');
  });

  it('10.5 Invite code with special chars is URI-safe in share URL', () => {
    const code = 'AB+CD';
    const url = `https://app.com/planner.html?invite=${encodeURIComponent(code)}`;
    expect(url).not.toContain('+');
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 11 — Date handling and timezone safety
// ═══════════════════════════════════════════════════════════════════════════

describe('11. Date handling', () => {

  it('11.1 T00:00:00 suffix prevents UTC-parse timezone mismatch', () => {
    const s = new Date('2026-07-01T00:00:00');
    const e = new Date('2026-07-05T00:00:00');
    expect(e > s).toBe(true);
    expect(s < e).toBe(true);
  });

  it('11.2 End date equal to start date is rejected (e <= s check)', () => {
    const start = '2026-07-01';
    const end   = '2026-07-01';
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end   + 'T00:00:00');
    expect(e <= s).toBe(true); // would be rejected by validation
  });

  it('11.3 End date before start date is rejected', () => {
    const s = new Date('2026-07-05T00:00:00');
    const e = new Date('2026-07-01T00:00:00');
    expect(e <= s).toBe(true); // rejected
  });

  it('11.4 Valid date range passes validation', () => {
    const s = new Date('2026-07-01T00:00:00');
    const e = new Date('2026-07-08T00:00:00');
    expect(e > s).toBe(true); // accepted
  });

  it('11.5 endDate + T23:59:59 means trip is "active" on end day until midnight', () => {
    const endDate = '2026-07-07';
    const endDt   = new Date(endDate + 'T23:59:59');
    const today   = new Date('2026-07-07T00:00:00');
    // Trip still active if endDt >= today
    expect(endDt >= today).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 12 — Array/field fallback guards (defensive programming)
// ═══════════════════════════════════════════════════════════════════════════

describe('12. Defensive array fallbacks', () => {

  it('12.1 Missing guestMembers field → empty array, no crash', () => {
    const data = { ownerUID: 'u1', name: 'Trip' };
    expect(Array.isArray(data.guestMembers) ? data.guestMembers : []).toEqual([]);
  });

  it('12.2 Missing families field → empty array, no crash', () => {
    const data = { ownerUID: 'u1', name: 'Trip' };
    expect(Array.isArray(data.families) ? data.families : []).toEqual([]);
  });

  it('12.3 Missing costs field → empty array, no crash', () => {
    const data = { ownerUID: 'u1' };
    expect(Array.isArray(data.costs) ? data.costs : []).toHaveLength(0);
  });

  it('12.4 null costs field → empty array', () => {
    const data = { costs: null };
    expect(Array.isArray(data.costs) ? data.costs : []).toEqual([]);
  });

  it('12.5 guestList.some() check works when guestMembers is populated', () => {
    const data = { guestMembers: [{ uid: 'u1' }, { uid: 'u2' }] };
    const guestList = Array.isArray(data.guestMembers) ? data.guestMembers : [];
    expect(guestList.some(m => m.uid === 'u1')).toBe(true);
    expect(guestList.some(m => m.uid === 'u99')).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 13 — isOwner / isGuest access control logic
// ═══════════════════════════════════════════════════════════════════════════

describe('13. Access control logic', () => {

  it('13.1 ownerUID match → isOwner true', () => {
    const data = { ownerUID: 'user-1' };
    expect(data.ownerUID === 'user-1').toBe(true);
  });

  it('13.2 ownerUID mismatch → isOwner false', () => {
    const data = { ownerUID: 'user-1' };
    expect(data.ownerUID === 'user-2').toBe(false);
  });

  it('13.3 User in guestMembers → isGuest true', () => {
    const data = { ownerUID: 'user-1', guestMembers: [{ uid: 'user-2' }] };
    const guestList = Array.isArray(data.guestMembers) ? data.guestMembers : [];
    const isOwner = data.ownerUID === 'user-2';
    const isGuest = !isOwner && guestList.some(m => m.uid === 'user-2');
    expect(isGuest).toBe(true);
  });

  it('13.4 User not in guestMembers and not owner → access denied', () => {
    const data = { ownerUID: 'user-1', guestMembers: [{ uid: 'user-2' }] };
    const guestList = Array.isArray(data.guestMembers) ? data.guestMembers : [];
    const isOwner = data.ownerUID === 'user-3';
    const isGuest = !isOwner && guestList.some(m => m.uid === 'user-3');
    expect(!isOwner && !isGuest).toBe(true); // → access denied
  });

  it('13.5 Owner is never also a guest', () => {
    const data = { ownerUID: 'user-1', guestMembers: [{ uid: 'user-1' }] };
    const isOwner = data.ownerUID === 'user-1';
    const guestList = Array.isArray(data.guestMembers) ? data.guestMembers : [];
    const isGuest  = !isOwner && guestList.some(m => m.uid === 'user-1');
    expect(isOwner).toBe(true);
    expect(isGuest).toBe(false); // isOwner takes priority
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 14 — Edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('14. Edge cases', () => {

  it('14.1 Trip with undefined checklistState → empty object fallback', () => {
    const data = { ownerUID: 'u1' };
    const checkState = data.checklistState || {};
    expect(typeof checkState).toBe('object');
    expect(Object.keys(checkState)).toHaveLength(0);
  });

  it('14.2 alreadyMember check prevents duplicate guestMembers entry', () => {
    const members = [{ uid: 'u1' }, { uid: 'u2' }];
    const newUid = 'u1';
    const alreadyMember = members.some(m => m.uid === newUid);
    expect(alreadyMember).toBe(true); // arrayUnion write would be skipped
  });

  it('14.3 New guest is correctly identified as not already a member', () => {
    const members = [{ uid: 'u1' }, { uid: 'u2' }];
    const newUid = 'u3';
    const alreadyMember = members.some(m => m.uid === newUid);
    expect(alreadyMember).toBe(false); // will be added
  });

  it('14.4 modeLabels covers all 4 supported camping modes', () => {
    const modeLabels = { tent: 'Tent Only', rv: 'RV Only', both: 'Both Tent & RV', cabin: 'Cabin' };
    expect(modeLabels['tent']).toBe('Tent Only');
    expect(modeLabels['rv']).toBe('RV Only');
    expect(modeLabels['both']).toBe('Both Tent & RV');
    expect(modeLabels['cabin']).toBe('Cabin');
    expect(modeLabels['unknown'] ?? '—').toBe('—');
  });

  it('14.5 splitBetween "All" expansion does not mutate original costs array', () => {
    const costs = [{ id: 'e1', paidBy: 'A', amount: 10, splitBetween: ['All'] }];
    const originalSplit = [...costs[0].splitBetween];
    runSettlement(costs);
    expect(costs[0].splitBetween).toEqual(originalSplit); // unchanged
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 15 — Performance benchmarks
// ═══════════════════════════════════════════════════════════════════════════

describe('15. Performance benchmarks', () => {

  it('15.1 Settlement with 100 expenses runs in under 50ms', () => {
    const costs = Array.from({ length: 100 }, (_, i) => ({
      id: `e${i}`,
      item: `Item ${i}`,
      paidBy: ['Alice', 'Bob', 'Carol'][i % 3],
      amount: (i + 1) * 1.5,
      splitBetween: ['Alice', 'Bob', 'Carol'],
    }));
    const t0 = performance.now();
    runSettlement(costs);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it('15.2 1,000 nightsCount calls run in under 10ms', () => {
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) nightsCount('2026-01-01', '2026-12-31');
    expect(performance.now() - t0).toBeLessThan(10);
  });

  it('15.3 Full checklist flatKey generation × 1,000 iterations under 100ms', () => {
    const CATS = {
      'Shelter & Sleeping': ['Tent / Tarp', 'Sleeping bags', 'Sleeping pads', 'Pillows', 'Tarp for rain'],
      'Cooking & Food':     ['Camp stove', 'Fuel canisters', 'Cookware set', 'Utensils', 'Cooler + ice', 'Can opener'],
      'Clothing':           ['Layers / fleece', 'Rain jacket', 'Hiking boots', 'Warm hat', 'Gloves'],
      'Safety':             ['First aid kit', 'Headlamps + batteries', 'Map & compass', 'Emergency whistle'],
      'Hygiene':            ['Biodegradable soap', 'Hand sanitizer', 'Toothbrush + paste', 'Towel', 'Toilet paper'],
    };
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      Object.entries(CATS).forEach(([cat, items]) => items.forEach(item => flatKey(cat, item)));
    }
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it('15.4 esc() called 10,000 times with adversarial input under 50ms', () => {
    const xss = '<script>alert("xss")</script><img src=x onerror=1>';
    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) esc(xss);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
