/* Sharing a week with the people you cook with.

   The panel is deliberately blunt about what sharing means: the link is the
   key, so anyone holding it can join. That is the right trade for a household
   meal plan and the wrong one for a secret, and the only way to make it a fair
   trade is to say so where the link is copied rather than in a help page. */

import { el, modal, toast, clear, iconButton } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { currentAccount, syncConfigured } from '../lib/sync.js';
import {
  inviteByEmail, removeMember, deleteShare, myInvites, acceptInvite, declineInvite,
} from '../lib/share.js';

function joinUrl(id) {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#/join/${id}`;
}

/** The button that lives beside the week's other actions. */
export function shareButton() {
  return iconButton('people', 'Share this week', { onClick: sharePanel });
}

export function sharePanel() {
  if (!syncConfigured()) {
    return modal({
      title: 'Sharing is not set up',
      body: el('p', { class: 'settings-sub', text: 'This copy of the app was built without an account to sync through.' }),
      actions: [{ label: 'Right' }],
    });
  }

  if (!currentAccount()) {
    return modal({
      title: 'Sign in first',
      body: el('p', {
        class: 'settings-sub',
        text: 'Sharing a week works through your Google account — it is how '
          + 'the app knows which sheet is yours and who else is allowed on it.',
      }),
      actions: [
        { label: 'Not now' },
        { label: 'Settings', class: 'btn', onClick: () => { location.hash = '#/settings'; } },
      ],
    });
  }

  return store.sharingWeek ? sharedPanel() : offerPanel();
}

/* ---------- not sharing yet ---------- */

function offerPanel() {
  modal({
    title: 'Share this week',
    body: el('div', {}, [
      el('p', {
        class: 'settings-sub',
        text: 'Everyone you share with sees the same sheet and can change it. '
          + 'What is already written on this week goes with you, and your quick '
          + 'meals go too — otherwise their Tuesday would say nothing.',
      }),
      el('p', {
        class: 'settings-sub',
        text: 'Your cookbooks stay yours. A recipe planned from one shows them '
          + 'its name, not what goes in it.',
      }),
    ]),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Share it',
        class: 'btn',
        onClick: async () => {
          try {
            await store.startWeekShare('Our week');
            toast('Shared. Send someone the link.');
            setTimeout(sharedPanel, 350);
          } catch (err) {
            console.warn(err);
            toast('Could not start sharing.');
          }
          return true;
        },
      },
    ],
  });
}

/* ---------- sharing ---------- */

function sharedPanel() {
  const share = store.shared;
  if (!share) return;

  const me = currentAccount()?.uid;
  const owner = share.ownerId === me;
  const body = el('div', {});

  const paint = () => {
    clear(body);
    const current = store.shared;
    if (!current) return;

    const link = el('input', { type: 'text', readonly: true, value: joinUrl(current.id) });
    const email = el('input', { type: 'email', placeholder: 'them@gmail.com' });

    body.append(
      el('div', { class: 'field' }, [
        el('span', { class: 'label', text: 'The link' }),
        el('div', { class: 'share-link' }, [
          link,
          el('button', {
            class: 'btn btn-secondary btn-sm',
            type: 'button',
            text: 'Copy',
            onClick: async () => {
              try {
                await navigator.clipboard.writeText(joinUrl(current.id));
                toast('Link copied.');
              } catch {
                // Clipboard access is refused often enough that selecting the
                // text has to be a real fallback, not an error message.
                link.select();
                toast('Press copy — the link is selected.');
              }
            },
          }),
        ]),
        el('span', {
          class: 'settings-sub',
          text: 'Anyone with this link can join the week and change it. Send '
            + 'it to people you cook with, not to a group you have not met.',
        }),
      ]),

      el('div', { class: 'field' }, [
        el('span', { class: 'label', text: 'Or invite by email' }),
        el('div', { class: 'share-link' }, [
          email,
          el('button', {
            class: 'btn btn-secondary btn-sm',
            type: 'button',
            text: 'Invite',
            onClick: async () => {
              try {
                await inviteByEmail(current.id, email.value, {
                  kind: 'week', label: current.label || 'a week',
                });
                email.value = '';
                toast('Invitation left for them.');
              } catch (err) {
                toast(err.message || 'Could not send that invitation.');
              }
            },
          }),
        ]),
        el('span', {
          class: 'settings-sub',
          text: 'They will find it the next time they sign in. It carries the '
            + 'same link, so it is no harder to pass on — treat it the same way.',
        }),
      ]),

      el('div', { class: 'field' }, [
        el('span', { class: 'label', text: 'On this week' }),
        el('ul', { class: 'share-members' },
          (current.memberIds || []).map((id) => {
            const who = current.members?.[id] || {};
            const label = who.name || who.email || 'Someone';
            return el('li', {}, [
              el('span', {}, [
                label,
                id === current.ownerId && el('small', { text: ' · started it' }),
                id === me && el('small', { text: ' · you' }),
              ]),
              owner && id !== me && el('button', {
                class: 'btn-link',
                type: 'button',
                text: 'Remove',
                onClick: async () => {
                  await removeMember(current.id, id);
                  toast(`${label} taken off the week.`);
                },
              }),
            ]);
          }),
        ),
      ]),
    );
  };

  paint();
  // Somebody joining while the panel is open should appear in it.
  const stop = () => store.removeEventListener('change', paint);
  store.addEventListener('change', paint);

  modal({
    title: 'A shared week',
    body,
    actions: [
      { label: 'Done', onClick: () => { stop(); return true; } },
      owner
        ? {
          label: 'Stop sharing',
          onClick: () => {
            stop();
            confirmEnd(share.id);
            return true;
          },
        }
        : {
          label: 'Leave',
          onClick: async () => {
            stop();
            await store.leaveWeekShare();
            toast('Your own week is back.');
            return true;
          },
        },
    ],
  });
}

function confirmEnd(id) {
  modal({
    title: 'Stop sharing?',
    body: el('p', {
      class: 'settings-sub',
      text: 'The shared sheet goes for everyone on it. Your own week comes '
        + 'back to your desk exactly as you left it — but what was planned '
        + 'together is not copied onto it.',
    }),
    actions: [
      { label: 'Keep sharing' },
      {
        label: 'Stop',
        class: 'btn',
        onClick: async () => {
          await store.leaveWeekShare();
          await deleteShare(id);
          toast('Stopped. Your own week is back.');
          return true;
        },
      },
    ],
  });
}

/* ---------- arriving by link ---------- */

export function renderJoin(host, id) {
  host.append(
    el('div', { class: 'scene-head' }, [
      el('h1', { class: 'wordmark' }, ['Joining a week']),
    ]),
  );

  const card = el('section', { class: 'settings-card' }, [
    el('p', { class: 'settings-sub', text: 'One moment.' }),
  ]);
  host.append(el('div', { class: 'settings-sheet' }, [card]));

  const say = (title, text, actions = []) => {
    clear(card);
    card.append(
      el('h2', { text: title }),
      el('p', { class: 'settings-sub', text }),
      actions.length && el('div', { class: 'settings-row' }, actions),
    );
  };

  if (!currentAccount()) {
    say(
      'Sign in first',
      'A shared week hangs off your Google account. Sign in, then open the '
        + 'link again — it will still work.',
      [el('button', {
        class: 'btn', type: 'button', text: 'Settings',
        onClick: () => { location.hash = '#/settings'; },
      })],
    );
    return;
  }

  (async () => {
    try {
      await store.joinWeekShare(id);
      say('You are on the week', 'Their sheet is now your sheet. Anything you '
        + 'add appears for everybody on it.', [
        el('button', {
          class: 'btn', type: 'button', text: 'Open the week',
          onClick: () => { location.hash = '#/plan'; },
        }),
      ]);
    } catch (err) {
      console.warn(err);
      say(
        'That link did not work',
        'It may have been withdrawn, or the week may have been stopped. Ask '
          + 'whoever sent it for a new one.',
        [el('button', {
          class: 'btn btn-secondary', type: 'button', text: 'Back to the desk',
          onClick: () => { location.hash = '#/'; },
        })],
      );
    }
  })();
}

/* ---------- invitations waiting ---------- */

/** Shown once after signing in, if somebody has left an invitation. */
export async function offerInvites() {
  let invites = [];
  try {
    invites = await myInvites();
  } catch (err) {
    // Never let a failed lookup get between someone and their cookbooks.
    console.warn('Could not look for invitations.', err);
    return;
  }
  if (!invites.length) return;

  const invite = invites[0];
  modal({
    title: 'You have been invited',
    body: el('p', {
      class: 'settings-sub',
      text: `${invite.fromName || 'Someone'} has asked you onto a shared week. `
        + 'You will both see the same sheet and either of you can change it.',
    }),
    actions: [
      {
        label: 'No thanks',
        onClick: async () => { await declineInvite(invite); return true; },
      },
      {
        label: 'Join',
        class: 'btn',
        onClick: async () => {
          try {
            await acceptInvite(invite);
            store.state.settings.weekShareId = invite.shareId;
            await store.persist();
            store.attachWeekShare(invite.shareId);
            toast('You are on the week.');
            location.hash = '#/plan';
          } catch (err) {
            console.warn(err);
            toast('Could not join that week.');
          }
          return true;
        },
      },
    ],
  });
}
