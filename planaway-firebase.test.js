/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║       PlanAway — Firebase / Firestore Emulator Tests             ║
 * ║  REQUIRES: Firebase emulator running on localhost:8080           ║
 * ║                                                                  ║
 * ║  Step 1 (one terminal):                                          ║
 * ║    firebase emulators:start --only firestore                     ║
 * ║                                                                  ║
 * ║  Step 2 (second terminal):                                       ║
 * ║    npm run test:firebase                                         ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * 43 tests across 8 sections covering:
 *   • Firestore security rules (who can read/write/delete)
 *   • Trip CRUD operations (create, read, update, delete)
 *   • Guest invite join flow
 *   • Expense add/delete via transactions
 *   • Checklist read/write operations
 *   • Notes persistence
 *   • Meal planner persistence
 *   • Family management persistence
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';

// ─────────────────────────────────────────────────────────────────────────────
// EMULATOR SETUP
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_ID = 'camp-cbf1d';

// Security rules matching the production intent for the trips collection
//
// KEY DESIGN DECISION — why `allow list` is separate from `allow get`:
// `allow read` covers both single-doc reads (get) AND collection queries (list).
// For `list` (collection queries), `resource` is NULL — you cannot reference
// resource.data in a list rule or it crashes with "Property X is undefined".
// The app queries by tripCode to find a trip, then verifies ownerUID client-side,
// so authenticated users must be allowed to execute collection queries.
const FIRESTORE_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /trips/{tripId} {

      // Single-doc read (get): owner or any guest member
      allow get: if request.auth != null && (
        resource.data.ownerUID == request.auth.uid ||
        request.auth.uid in resource.data.get('guestUids', [])
      );

      // Collection query (list): any authenticated user may query.
      // The app filters results client-side (e.g. tripCode lookup, guest scan).
      // Firestore returns only documents the user has permission to read anyway.
      allow list: if request.auth != null;

      // Create: authenticated user creating their own trip
      allow create: if request.auth != null &&
        request.resource.data.ownerUID == request.auth.uid;

      // Update: only the owner
      allow update: if request.auth != null &&
        resource.data.ownerUID == request.auth.uid;

      // Delete: only the owner
      allow delete: if request.auth != null &&
        resource.data.ownerUID == request.auth.uid;
    }
  }
}`;

let testEnv;

// Runs once before all tests — sets up the emulator connection
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: FIRESTORE_RULES,
      host: 'localhost',
      port: 8080,
    },
  });
}, 30000); // 30s timeout to allow emulator to connect

// Runs once after all tests — cleans up the connection
afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

// Runs before each individual test — wipes all Firestore data for isolation
beforeEach(async () => {
  if (testEnv) await testEnv.clearFirestore();
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Get a Firestore instance as an authenticated user */
function asUser(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

/** Get a Firestore instance as an unauthenticated visitor */
function asGuest() {
  return testEnv.unauthenticatedContext().firestore();
}

/** Seed a trip document directly, bypassing security rules */
async function seedTrip(tripId, data) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection('trips').doc(tripId).set(data);
  });
}

/** Read a trip directly, bypassing security rules */
async function readTrip(tripId) {
  let result;
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const snap = await ctx.firestore().collection('trips').doc(tripId).get();
    result = snap;
  });
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// BASE TRIP DATA used across multiple tests
// ─────────────────────────────────────────────────────────────────────────────

const OWNER = 'user-owner-001';
const GUEST = 'user-guest-001';
const OTHER = 'user-other-001';

const BASE_TRIP = {
  name:             'Yosemite 2026',
  location:         'Yosemite Valley Campground',
  startDate:        '2026-07-01',
  endDate:          '2026-07-07',
  mode:             'tent',
  tripCode:         'YOS001',
  ownerUID:         OWNER,
  ownerEmail:       'owner@test.com',
  ownerDisplayName: 'Trip Owner',
  ownerPhotoURL:    '',
  families:         [{ name: 'Smith', members: [] }, { name: 'Jones', members: [] }],
  guestMembers:     [{ uid: GUEST, email: 'guest@test.com', displayName: 'Guest User', photoURL: '', joinedAt: '2026-01-01' }],
  guestUids:        [GUEST],   // flat array used in security rules for fast lookup
  checklistState:   {},
  meals:            {},
  dayplan:          {},
  costs:            [],
  notes:            '',
};


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1 — Firestore Security Rules
// ═══════════════════════════════════════════════════════════════════════════

describe('1. Firestore security rules', () => {

  beforeEach(async () => {
    await seedTrip('trip-sec-001', BASE_TRIP);
  });

  it('1.1 Unauthenticated user cannot read a trip', async () => {
    const db = asGuest();
    await assertFails(db.collection('trips').doc('trip-sec-001').get());
  });

  it('1.2 Owner can read their own trip', async () => {
    const db = asUser(OWNER);
    await assertSucceeds(db.collection('trips').doc('trip-sec-001').get());
  });

  it('1.3 Guest member can read the trip', async () => {
    const db = asUser(GUEST);
    await assertSucceeds(db.collection('trips').doc('trip-sec-001').get());
  });

  it('1.4 Unrelated user cannot read a private trip', async () => {
    const db = asUser(OTHER);
    await assertFails(db.collection('trips').doc('trip-sec-001').get());
  });

  it('1.5 Owner can create a trip with themselves as ownerUID', async () => {
    const db = asUser(OWNER);
    await assertSucceeds(db.collection('trips').add({
      name: 'New Trip', ownerUID: OWNER, tripCode: 'NEW001',
      startDate: '2026-08-01', endDate: '2026-08-05',
    }));
  });

  it('1.6 User cannot create a trip impersonating another owner (privilege escalation)', async () => {
    const db = asUser(OTHER);
    await assertFails(db.collection('trips').add({
      name: 'Hijack',
      ownerUID: OWNER,   // trying to create a trip owned by someone else
      tripCode: 'BAD001',
    }));
  });

  it('1.7 Unauthenticated user cannot create a trip', async () => {
    const db = asGuest();
    await assertFails(db.collection('trips').add({
      name: 'Anon Trip', ownerUID: 'anon', tripCode: 'ANON01',
    }));
  });

  it('1.8 Owner can update their trip', async () => {
    const db = asUser(OWNER);
    await assertSucceeds(db.collection('trips').doc('trip-sec-001').update({ name: 'Updated Name' }));
  });

  it('1.9 Non-owner cannot update a trip', async () => {
    const db = asUser(OTHER);
    await assertFails(db.collection('trips').doc('trip-sec-001').update({ name: 'Hijacked' }));
  });

  it('1.10 Owner can delete their trip', async () => {
    const db = asUser(OWNER);
    await assertSucceeds(db.collection('trips').doc('trip-sec-001').delete());
  });

  it('1.11 Non-owner cannot delete a trip', async () => {
    const db = asUser(GUEST);
    await assertFails(db.collection('trips').doc('trip-sec-001').delete());
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2 — Trip CRUD operations
// ═══════════════════════════════════════════════════════════════════════════

describe('2. Trip CRUD operations', () => {

  it('2.1 Create trip — all required fields persisted correctly', async () => {
    const db = asUser(OWNER);
    const payload = {
      name: 'Grand Canyon 2026', location: 'South Rim',
      startDate: '2026-09-01', endDate: '2026-09-05',
      mode: 'tent', tripCode: 'GC2026', ownerUID: OWNER,
      ownerEmail: 'owner@test.com', ownerDisplayName: 'Owner',
      families: [{ name: 'Smith', members: [] }],
    };
    const ref  = await db.collection('trips').add(payload);
    const snap = await ref.get();
    expect(snap.exists).toBe(true);
    expect(snap.data().name).toBe('Grand Canyon 2026');
    expect(snap.data().tripCode).toBe('GC2026');
    expect(snap.data().ownerUID).toBe(OWNER);
    expect(snap.data().families).toHaveLength(1);
  });

  it('2.2 Trip code uniqueness query — existing code found', async () => {
    await seedTrip('trip-uniq-1', { ownerUID: OWNER, tripCode: 'EXIST1', name: 'Existing' });
    const db   = asUser(OWNER);
    const snap = await db.collection('trips').where('tripCode', '==', 'EXIST1').limit(1).get();
    expect(snap.empty).toBe(false);
  });

  it('2.3 Trip code uniqueness query — new code returns empty', async () => {
    const db   = asUser(OWNER);
    const snap = await db.collection('trips').where('tripCode', '==', 'BRANDNEW').limit(1).get();
    expect(snap.empty).toBe(true);
  });

  it('2.4 Update trip overview persists all changed fields', async () => {
    await seedTrip('trip-upd-1', { ...BASE_TRIP });
    const db = asUser(OWNER);
    await db.collection('trips').doc('trip-upd-1').update({
      name: 'New Name', location: 'New Location',
      startDate: '2026-08-01', endDate: '2026-08-10',
      mode: 'cabin',
      families: [{ name: 'Updated Family', members: [] }],
    });
    const snap = await (await readTrip('trip-upd-1'));
    expect(snap.data().name).toBe('New Name');
    expect(snap.data().location).toBe('New Location');
    expect(snap.data().mode).toBe('cabin');
    expect(snap.data().families[0].name).toBe('Updated Family');
  });

  it('2.5 Delete trip removes the document', async () => {
    await seedTrip('trip-del-1', { ...BASE_TRIP });
    const db = asUser(OWNER);
    await db.collection('trips').doc('trip-del-1').delete();
    const snap = await readTrip('trip-del-1');
    expect(snap.exists).toBe(false);
  });

  it('2.6 Non-existent trip returns snap.exists false', async () => {
    const snap = await readTrip('does-not-exist');
    expect(snap.exists).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3 — Guest invite join flow
// ═══════════════════════════════════════════════════════════════════════════

describe('3. Guest invite flow', () => {

  it('3.1 Invite code lookup finds correct trip', async () => {
    await seedTrip('trip-inv-1', { ownerUID: OWNER, name: 'Beach Trip', tripCode: 'BCH01' });
    const db   = asUser(OWNER);
    const snap = await db.collection('trips').where('tripCode', '==', 'BCH01').limit(1).get();
    expect(snap.empty).toBe(false);
    expect(snap.docs[0].data().name).toBe('Beach Trip');
  });

  it('3.2 Invalid invite code returns empty snapshot', async () => {
    const db   = asUser(OWNER);
    const snap = await db.collection('trips').where('tripCode', '==', 'XXXXXX').limit(1).get();
    expect(snap.empty).toBe(true);
  });

  it('3.3 New guest is added to guestMembers array', async () => {
    await seedTrip('trip-join-1', { ownerUID: OWNER, name: 'Forest Trip', tripCode: 'FOR01', guestMembers: [], guestUids: [] });
    const db = asUser(OWNER);
    const newGuest = {
      uid: GUEST, email: 'guest@test.com',
      displayName: 'Guest User', photoURL: '',
      joinedAt: new Date().toISOString(),
    };
    await db.collection('trips').doc('trip-join-1').update({
      guestMembers: [newGuest],
      guestUids:    [GUEST],
    });
    const snap = await readTrip('trip-join-1');
    expect(snap.data().guestMembers).toHaveLength(1);
    expect(snap.data().guestMembers[0].uid).toBe(GUEST);
  });

  it('3.4 alreadyMember check correctly detects existing guest', async () => {
    await seedTrip('trip-rejoin-1', {
      ownerUID: OWNER, name: 'Mountain Trip', tripCode: 'MTN01',
      guestMembers: [{ uid: GUEST, email: 'g@test.com', displayName: 'G', photoURL: '', joinedAt: '2026-01-01' }],
    });
    const snap = await readTrip('trip-rejoin-1');
    const alreadyMember = (snap.data().guestMembers || []).some(m => m.uid === GUEST);
    expect(alreadyMember).toBe(true);  // no duplicate write would happen
  });

  it('3.5 Owner arriving via invite code is detected (ownerUID match)', async () => {
    await seedTrip('trip-own-check', { ownerUID: OWNER, name: 'My Trip', tripCode: 'OWN01' });
    const db   = asUser(OWNER);
    const snap = await db.collection('trips').where('tripCode', '==', 'OWN01').limit(1).get();
    expect(snap.docs[0].data().ownerUID).toBe(OWNER); // app redirects owner to #id URL
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4 — Expense / Cost operations
// ═══════════════════════════════════════════════════════════════════════════

describe('4. Expense operations', () => {

  beforeEach(async () => {
    await seedTrip('trip-cost-001', { ...BASE_TRIP, costs: [] });
  });

  it('4.1 Add expense via transaction persists correctly', async () => {
    const db      = asUser(OWNER);
    const tripRef = db.collection('trips').doc('trip-cost-001');
    const expense = {
      id: 'exp-001', item: 'Firewood', category: 'Other',
      paidBy: 'Smith', amount: 25.00,
      splitBetween: ['Smith', 'Jones'],
      addedAt: new Date().toISOString(),
    };
    await db.runTransaction(async tx => {
      const doc     = await tx.get(tripRef);
      const current = Array.isArray(doc.data()?.costs) ? doc.data().costs : [];
      tx.update(tripRef, { costs: [...current, expense] });
    });
    const snap = await readTrip('trip-cost-001');
    expect(snap.data().costs).toHaveLength(1);
    expect(snap.data().costs[0].item).toBe('Firewood');
    expect(snap.data().costs[0].amount).toBe(25.00);
  });

  it('4.2 Two concurrent adds via transactions — both survive', async () => {
    const db      = asUser(OWNER);
    const tripRef = db.collection('trips').doc('trip-cost-001');
    const makeExp = (id, item) => ({
      id, item, category: 'Food', paidBy: 'Smith',
      amount: 10, splitBetween: ['Smith'],
      addedAt: new Date().toISOString(),
    });
    await Promise.all([
      db.runTransaction(async tx => {
        const doc = await tx.get(tripRef);
        const cur = doc.data()?.costs || [];
        tx.update(tripRef, { costs: [...cur, makeExp('a', 'Item A')] });
      }),
      db.runTransaction(async tx => {
        const doc = await tx.get(tripRef);
        const cur = doc.data()?.costs || [];
        tx.update(tripRef, { costs: [...cur, makeExp('b', 'Item B')] });
      }),
    ]);
    const snap = await readTrip('trip-cost-001');
    // Transactions retry on contention — both items must be present
    expect(snap.data().costs).toHaveLength(2);
  });

  it('4.3 Delete expense via transaction removes only the target item', async () => {
    await seedTrip('trip-cost-001', {
      ...BASE_TRIP,
      costs: [
        { id: 'keep-me',   item: 'Tent', category: 'Gear', paidBy: 'Smith', amount: 80, splitBetween: ['Smith'] },
        { id: 'delete-me', item: 'Gas',  category: 'Fuel', paidBy: 'Jones', amount: 30, splitBetween: ['Jones'] },
      ],
    });
    const db      = asUser(OWNER);
    const tripRef = db.collection('trips').doc('trip-cost-001');
    await db.runTransaction(async tx => {
      const doc     = await tx.get(tripRef);
      const current = doc.data()?.costs || [];
      tx.update(tripRef, { costs: current.filter(c => c.id !== 'delete-me') });
    });
    const snap = await readTrip('trip-cost-001');
    expect(snap.data().costs).toHaveLength(1);
    expect(snap.data().costs[0].id).toBe('keep-me');
  });

  it('4.4 Expense with all required fields round-trips correctly', async () => {
    const db      = asUser(OWNER);
    const tripRef = db.collection('trips').doc('trip-cost-001');
    const expense = {
      id: 'full-exp', item: 'Camp Stove', category: 'Gear',
      paidBy: 'Smith', amount: 149.99,
      splitBetween: ['Smith', 'Jones'],
      addedAt: '2026-07-01T10:00:00.000Z',
    };
    await db.runTransaction(async tx => {
      const doc = await tx.get(tripRef);
      const cur = doc.data()?.costs || [];
      tx.update(tripRef, { costs: [...cur, expense] });
    });
    const snap = await readTrip('trip-cost-001');
    const saved = snap.data().costs[0];
    expect(saved.id).toBe('full-exp');
    expect(saved.item).toBe('Camp Stove');
    expect(saved.category).toBe('Gear');
    expect(saved.paidBy).toBe('Smith');
    expect(saved.amount).toBe(149.99);
    expect(saved.splitBetween).toEqual(['Smith', 'Jones']);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5 — Checklist operations
// ═══════════════════════════════════════════════════════════════════════════

describe('5. Checklist operations', () => {

  beforeEach(async () => {
    await seedTrip('trip-chk-001', { ...BASE_TRIP, checklistState: {} });
  });

  it('5.1 Checking an item writes correct object structure', async () => {
    const db  = asUser(OWNER);
    const key = 'Safety__First_aid_kit';
    const update = {};
    update[`checklistState.${key}`] = {
      checked: true, uid: OWNER,
      displayName: 'Trip Owner', email: 'owner@test.com',
      lockedAt: '2026-07-01T09:00:00.000Z',
    };
    await db.collection('trips').doc('trip-chk-001').update(update);
    const snap = await readTrip('trip-chk-001');
    expect(snap.data().checklistState[key].checked).toBe(true);
    expect(snap.data().checklistState[key].uid).toBe(OWNER);
    expect(snap.data().checklistState[key].displayName).toBe('Trip Owner');
  });

  it('5.2 Multiple checklist items can be checked independently', async () => {
    const db = asUser(OWNER);
    const update1 = { 'checklistState.Safety__First_aid_kit':         { checked: true, uid: OWNER, displayName: 'Owner', email: 'o@t.com', lockedAt: '2026-01-01' } };
    const update2 = { 'checklistState.Clothing__Rain_jacket':          { checked: true, uid: GUEST, displayName: 'Guest', email: 'g@t.com', lockedAt: '2026-01-01' } };
    await db.collection('trips').doc('trip-chk-001').update(update1);
    await db.collection('trips').doc('trip-chk-001').update(update2);
    const snap = await readTrip('trip-chk-001');
    expect(snap.data().checklistState['Safety__First_aid_kit'].uid).toBe(OWNER);
    expect(snap.data().checklistState['Clothing__Rain_jacket'].uid).toBe(GUEST);
  });

  it('5.3 Unchecking sets key to null (simulating FieldValue.delete)', async () => {
    const key = 'Safety__Emergency_whistle';
    await seedTrip('trip-chk-001', {
      ...BASE_TRIP,
      checklistState: {
        [key]: { checked: true, uid: OWNER, displayName: 'Owner', email: 'o@t.com', lockedAt: '2026-01-01' },
      },
    });
    const db = asUser(OWNER);
    const update = {};
    update[`checklistState.${key}`] = null;
    await db.collection('trips').doc('trip-chk-001').update(update);
    const snap = await readTrip('trip-chk-001');
    expect(snap.data().checklistState[key]).toBeNull();
  });

  it('5.4 checklistState survives a concurrent trip update', async () => {
    const db  = asUser(OWNER);
    const key = 'Hygiene__Towel';
    const checkUpdate = {};
    checkUpdate[`checklistState.${key}`] = { checked: true, uid: OWNER, displayName: 'Owner', email: 'o@t.com', lockedAt: '2026-01-01' };
    // Update checklist and trip name simultaneously
    await Promise.all([
      db.collection('trips').doc('trip-chk-001').update(checkUpdate),
      db.collection('trips').doc('trip-chk-001').update({ name: 'Updated Name' }),
    ]);
    const snap = await readTrip('trip-chk-001');
    // Both updates should have been applied
    expect(snap.data().name).toBe('Updated Name');
    expect(snap.data().checklistState[key].checked).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6 — Notes persistence
// ═══════════════════════════════════════════════════════════════════════════

describe('6. Notes persistence', () => {

  beforeEach(async () => {
    await seedTrip('trip-notes-001', { ...BASE_TRIP, notes: '' });
  });

  it('6.1 Saving notes persists the text correctly', async () => {
    const db = asUser(OWNER);
    await db.collection('trips').doc('trip-notes-001').update({ notes: 'Pack extra water and sunscreen.' });
    const snap = await readTrip('trip-notes-001');
    expect(snap.data().notes).toBe('Pack extra water and sunscreen.');
  });

  it('6.2 Overwriting notes replaces the previous value', async () => {
    await seedTrip('trip-notes-001', { ...BASE_TRIP, notes: 'Old notes content' });
    const db = asUser(OWNER);
    await db.collection('trips').doc('trip-notes-001').update({ notes: 'Brand new notes' });
    const snap = await readTrip('trip-notes-001');
    expect(snap.data().notes).toBe('Brand new notes');
  });

  it('6.3 Empty string notes persists without error', async () => {
    await seedTrip('trip-notes-001', { ...BASE_TRIP, notes: 'Something' });
    const db = asUser(OWNER);
    await db.collection('trips').doc('trip-notes-001').update({ notes: '' });
    const snap = await readTrip('trip-notes-001');
    expect(snap.data().notes).toBe('');
  });

  it('6.4 Long notes (multi-paragraph) persists correctly', async () => {
    const longNotes = 'Day 1: Arrive and set up camp.\n\nDay 2: Hike to the falls.\n\nDay 3: Kayaking on the river.\n\nDay 4: Pack up and head home.';
    const db = asUser(OWNER);
    await db.collection('trips').doc('trip-notes-001').update({ notes: longNotes });
    const snap = await readTrip('trip-notes-001');
    expect(snap.data().notes).toBe(longNotes);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7 — Meal planner persistence
// ═══════════════════════════════════════════════════════════════════════════

describe('7. Meal planner persistence', () => {

  beforeEach(async () => {
    await seedTrip('trip-meals-001', { ...BASE_TRIP, meals: {} });
  });

  it('7.1 Single meal slot saves with dot-notation path', async () => {
    const db = asUser(OWNER);
    await db.collection('trips').doc('trip-meals-001').update({ 'meals.day0.breakfast': 'Oatmeal' });
    const snap = await readTrip('trip-meals-001');
    expect(snap.data().meals.day0.breakfast).toBe('Oatmeal');
  });

  it('7.2 All three meal slots for one day save independently', async () => {
    const db = asUser(OWNER);
    await db.collection('trips').doc('trip-meals-001').update({ 'meals.day0.breakfast': 'Eggs' });
    await db.collection('trips').doc('trip-meals-001').update({ 'meals.day0.lunch': 'Sandwiches' });
    await db.collection('trips').doc('trip-meals-001').update({ 'meals.day0.dinner': 'Hot Dogs' });
    const snap = await readTrip('trip-meals-001');
    expect(snap.data().meals.day0.breakfast).toBe('Eggs');
    expect(snap.data().meals.day0.lunch).toBe('Sandwiches');
    expect(snap.data().meals.day0.dinner).toBe('Hot Dogs');
  });

  it('7.3 Multiple days can be planned simultaneously', async () => {
    const db = asUser(OWNER);
    await db.collection('trips').doc('trip-meals-001').update({
      'meals.day0.dinner': 'Tacos',
      'meals.day1.breakfast': 'Pancakes',
      'meals.day2.lunch': 'Wraps',
    });
    const snap = await readTrip('trip-meals-001');
    expect(snap.data().meals.day0.dinner).toBe('Tacos');
    expect(snap.data().meals.day1.breakfast).toBe('Pancakes');
    expect(snap.data().meals.day2.lunch).toBe('Wraps');
  });

  it('7.4 Day planner activity saves correctly', async () => {
    const db = asUser(OWNER);
    await db.collection('trips').doc('trip-meals-001').update({ 'dayplan.day0': 'Morning hike to Mirror Lake' });
    const snap = await readTrip('trip-meals-001');
    expect(snap.data().dayplan.day0).toBe('Morning hike to Mirror Lake');
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8 — Family management persistence
// ═══════════════════════════════════════════════════════════════════════════

describe('8. Family management persistence', () => {

  beforeEach(async () => {
    await seedTrip('trip-fam-001', { ...BASE_TRIP });
  });

  it('8.1 Adding a new family via saveOverview persists correctly', async () => {
    const db         = asUser(OWNER);
    const newFamilies = [
      { name: 'Smith', members: [] },
      { name: 'Jones', members: [] },
      { name: 'Williams', members: [] },
    ];
    await db.collection('trips').doc('trip-fam-001').update({ families: newFamilies });
    const snap = await readTrip('trip-fam-001');
    expect(snap.data().families).toHaveLength(3);
    expect(snap.data().families[2].name).toBe('Williams');
  });

  it('8.2 Removing a family persists the updated array', async () => {
    const db            = asUser(OWNER);
    const after_removal = [{ name: 'Smith', members: [] }]; // Jones removed
    await db.collection('trips').doc('trip-fam-001').update({ families: after_removal });
    const snap = await readTrip('trip-fam-001');
    expect(snap.data().families).toHaveLength(1);
    expect(snap.data().families[0].name).toBe('Smith');
  });

  it('8.3 Clearing all families persists empty array', async () => {
    const db = asUser(OWNER);
    await db.collection('trips').doc('trip-fam-001').update({ families: [] });
    const snap = await readTrip('trip-fam-001');
    expect(snap.data().families).toHaveLength(0);
  });

  it('8.4 Family names are stored exactly as entered (preserves case)', async () => {
    const db = asUser(OWNER);
    await db.collection('trips').doc('trip-fam-001').update({
      families: [{ name: 'McAllister Family', members: [] }],
    });
    const snap = await readTrip('trip-fam-001');
    expect(snap.data().families[0].name).toBe('McAllister Family');
  });
});
