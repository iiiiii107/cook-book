/* Sharing a week — and later a cookbook — with the people you cook with.

   A share is one Firestore document under `shares/{id}` holding a members
   list and whatever is being shared. Everyone in the list reads and writes it
   live, so two people planning the same week see each other's Tuesday.

   The id is the capability. It is unguessable, and knowing it is what lets you
   join: the link route hands it over directly, and an emailed invitation is a
   way of delivering the same id to somebody who has not signed in yet. That
   means a forwarded invitation works exactly as well as the original, which is
   the right trade for a household meal plan and worth knowing before anything
   private goes in one.

   Nothing here touches the private shelf. Your own plan sits untouched under
   your own user id the whole time a share is active, and comes back the moment
   you leave one. */

import { firebaseSdk, currentAccount } from './sync.js';

export const SHARE_KINDS = { WEEK: 'week', BOOK: 'book' };

async function ctx() {
  const sdk = await firebaseSdk();
  const account = currentAccount();
  if (!sdk || !account) return null;
  return { ...sdk, uid: account.uid, email: account.email || '', name: account.name || '' };
}

/** Signing in is what makes any of this possible; say so rather than failing. */
export async function sharingAvailable() {
  return (await ctx()) !== null;
}

/* ---------- making and joining ---------- */

/**
 * Start sharing something. Returns the id, which is also the invitation.
 *
 * @param {'week'|'book'} kind
 * @param {object} payload what is being shared
 * @param {string} label a name to show whoever is invited
 */
export async function createShare(kind, payload, label) {
  const c = await ctx();
  if (!c) throw new Error('Sign in first.');

  const ref = c.firestore.doc(c.firestore.collection(c.db, 'shares'));
  await c.firestore.setDoc(ref, {
    kind,
    label: label || '',
    ownerId: c.uid,
    ownerName: c.name,
    // The rule for creating insists this is exactly you, so a share can never
    // be conjured with somebody else already inside it.
    memberIds: [c.uid],
    members: { [c.uid]: { name: c.name, email: c.email } },
    payload: JSON.stringify(payload ?? {}),
    updatedAt: c.firestore.serverTimestamp(),
  });
  return ref.id;
}

/**
 * Add yourself to a share you have the id for.
 *
 * The write comes first and the read second, deliberately: until you are in
 * the members list the rules will not let you see the document at all, so
 * there is nothing to look at before deciding.
 */
export async function joinShare(shareId) {
  const c = await ctx();
  if (!c) throw new Error('Sign in first.');

  const ref = c.firestore.doc(c.db, 'shares', shareId);
  await c.firestore.updateDoc(ref, {
    memberIds: c.firestore.arrayUnion(c.uid),
  });
  // Names are a separate write because the joining rule allows the members
  // list and nothing else — this one is permitted now that we are inside.
  await c.firestore.updateDoc(ref, {
    [`members.${c.uid}`]: { name: c.name, email: c.email },
  });

  const snap = await c.firestore.getDoc(ref);
  return snap.exists() ? decode(snap) : null;
}

/** Step out. The share carries on without you; your own plan comes back. */
export async function leaveShare(shareId) {
  const c = await ctx();
  if (!c) return;
  const ref = c.firestore.doc(c.db, 'shares', shareId);
  await c.firestore.updateDoc(ref, {
    memberIds: c.firestore.arrayRemove(c.uid),
  });
}

/** Only the person who started it can end it for everybody. */
export async function deleteShare(shareId) {
  const c = await ctx();
  if (!c) return;
  await c.firestore.deleteDoc(c.firestore.doc(c.db, 'shares', shareId));
}

/** Take somebody out. Same call as leaving, aimed at another id. */
export async function removeMember(shareId, uid) {
  const c = await ctx();
  if (!c) return;
  const ref = c.firestore.doc(c.db, 'shares', shareId);
  await c.firestore.updateDoc(ref, {
    memberIds: c.firestore.arrayRemove(uid),
    [`members.${uid}`]: c.firestore.deleteField(),
  });
}

/* ---------- reading and writing ---------- */

function decode(snap) {
  const data = snap.data();
  let payload = {};
  try {
    payload = JSON.parse(data.payload || '{}');
  } catch {
    // A payload we cannot read is better than a screen that will not open.
    console.warn('A share arrived unreadable; showing it empty.');
  }
  return {
    id: snap.id,
    kind: data.kind,
    label: data.label || '',
    ownerId: data.ownerId,
    ownerName: data.ownerName || '',
    memberIds: data.memberIds || [],
    members: data.members || {},
    payload,
  };
}

/**
 * Follow a share as it changes.
 *
 * `writing` is the same guard the main sync uses: our own save comes straight
 * back as a snapshot, and applying it would overwrite whatever was typed in
 * the meantime.
 */
export function watchShare(shareId, onChange, onGone) {
  let stop = null;
  let live = true;

  (async () => {
    const c = await ctx();
    if (!c || !live) return;
    const ref = c.firestore.doc(c.db, 'shares', shareId);
    stop = c.firestore.onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return onGone?.('gone');
        // Our own write comes straight back. Applying it would overwrite
        // whatever was typed while it was in flight.
        if (snap.metadata.hasPendingWrites) return;
        const share = decode(snap);
        if (!share.memberIds.includes(c.uid)) return onGone?.('removed');
        onChange(share);
      },
      (err) => {
        // Losing the read is how being removed arrives when the document
        // itself is still there.
        console.warn('Lost sight of the share.', err);
        onGone?.('removed');
      },
    );
  })();

  return () => {
    live = false;
    stop?.();
  };
}

/** Push what is being shared. Last write wins, which is right for a week. */
export async function saveShare(shareId, payload) {
  const c = await ctx();
  if (!c) return;
  await c.firestore.updateDoc(c.firestore.doc(c.db, 'shares', shareId), {
    payload: JSON.stringify(payload ?? {}),
    updatedAt: c.firestore.serverTimestamp(),
  });
}

/** Every share you are part of. */
export async function myShares(kind) {
  const c = await ctx();
  if (!c) return [];
  const q = c.firestore.query(
    c.firestore.collection(c.db, 'shares'),
    c.firestore.where('memberIds', 'array-contains', c.uid),
  );
  const snap = await c.firestore.getDocs(q);
  return snap.docs.map(decode).filter((s) => !kind || s.kind === kind);
}

/* ---------- invitations ---------- */

/**
 * Leave an invitation for an address.
 *
 * It is a document nobody but that address can read — the rule compares
 * against the email on the caller's own Google token, so asking for somebody
 * else's invitations is refused rather than answered emptily.
 */
export async function inviteByEmail(shareId, email, { kind, label }) {
  const c = await ctx();
  if (!c) throw new Error('Sign in first.');

  const address = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('That does not look like an email address.');
  if (address === c.email.toLowerCase()) throw new Error('That is your own address.');

  await c.firestore.addDoc(c.firestore.collection(c.db, 'invites'), {
    shareId,
    kind,
    label: label || '',
    email: address,
    fromId: c.uid,
    fromName: c.name,
    createdAt: c.firestore.serverTimestamp(),
  });
}

/** Invitations left for you, found on sign-in. */
export async function myInvites() {
  const c = await ctx();
  if (!c || !c.email) return [];
  const q = c.firestore.query(
    c.firestore.collection(c.db, 'invites'),
    c.firestore.where('email', '==', c.email.toLowerCase()),
  );
  const snap = await c.firestore.getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Take one up, and tidy it away. */
export async function acceptInvite(invite) {
  const share = await joinShare(invite.shareId);
  await declineInvite(invite);
  return share;
}

export async function declineInvite(invite) {
  const c = await ctx();
  if (!c) return;
  await c.firestore.deleteDoc(c.firestore.doc(c.db, 'invites', invite.id));
}
