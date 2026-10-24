const icons = {
 chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/><path d="M8 10h8M8 14h5"/>',
 leaf:'<path d="M20 3C10 2 3 6 5 13c2 7 14 8 15-10Z"/><path d="M4 21 15 10M10 15v-4M10 15h4"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>', compose:'<path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M15 3l6 6M9 15l2-6 7-7 4 4-7 7-6 2Z"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>', globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',smile:'<circle cx="12" cy="12" r="9"/><path d="M8 14s1 3 4 3 4-3 4-3M8 8h.01M16 8h.01"/>',send:'<path d="m3 3 19 9-19 9 4-9-4-9ZM7 12h15"/>',back:'<path d="m14 5-7 7 7 7"/>',sparkles:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4M18 4h4"/>',check:'<path d="m2 12 4 4L17 5M11 16 22 5"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || ''}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const $ = id => document.getElementById(id);
const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let chats = [], selected = localStorage.getItem('dhanavitree-chat') || 'maya', role = localStorage.getItem('dhanavitree-role') || 'business', filter = 'all', snapshot = '', busy = false;
if (!['business','customer'].includes(role)) role = 'business';
$('role').value = role;
const drafts = new Map();
const time = date => new Date(date).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 4500); }
async function api(path, options) { const response = await fetch(path, options); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Something went wrong'); return data; }
function current() { return chats.find(c => c.id === selected); }
function render(scroll = false) {
 const chat = current();
 $('inbox-title').innerHTML = `${role === 'business' ? 'Messages' : 'Your chats'} <span>${chats.length}</span>`;
 $('inbox-caption').textContent = role === 'business' ? 'A little closer to your customers.' : 'Choose a demo customer conversation.';
 $('needs-count').textContent = chats.filter(c => c.messages.at(-1)?.sender === 'customer').length;
 $('quick-replies').hidden = role !== 'business';
 const search = $('search').value.toLowerCase();
 const visible = chats.filter(c => (c.name + ' ' + c.messages.at(-1)?.text).toLowerCase().includes(search) && (filter !== 'awaiting' || c.messages.at(-1)?.sender === 'customer')).sort((a,b) => (b.messages.at(-1)?.at || '').localeCompare(a.messages.at(-1)?.at || ''));
 $('conversations').innerHTML = visible.map(c => { const last = c.messages.at(-1); return `<button class="conversation-item ${c.id === selected ? 'selected' : ''}" data-chat="${escape(c.id)}" aria-label="Open conversation with ${escape(c.name)}" ${c.id === selected ? 'aria-current="true"' : ''}><div class="avatar ${escape(c.color)}">${escape(c.initials)}</div><div class="conversation-copy"><div class="conversation-title"><strong>${escape(c.name)}</strong><time>${last ? time(last.at) : 'New'}</time></div><div class="conversation-preview"><p>${last?.sender === role ? 'You: ' : ''}${escape(last?.text || 'Say hello to start a conversation')}</p>${last?.sender === 'customer' ? '<span class="unread" title="Awaiting business reply">•</span>' : ''}</div></div></button>`; }).join('') || '<p class="empty">No conversations found.</p>';
 if (!chat) return;
 $('chat-avatar').className = `avatar ${role === 'business' ? chat.color : 'peach'}`;
 $('chat-avatar').textContent = role === 'business' ? chat.initials : 'DV';
 $('contact-name').textContent = role === 'business' ? chat.name : 'Dhanavitree';
 $('contact-subtitle').textContent = role === 'business' ? 'Customer · Web chat' : `You are ${chat.name} · Customer view`;
 $('details').textContent = `${chat.topic} · ${chat.messages.length} messages · Shared demo: conversations are visible to everyone with this link.`;
 let day = '';
 $('messages').innerHTML = chat.messages.map(m => {
  const date = new Date(m.at).toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'});
  const divider = date !== day ? `<div class="day-divider"><span>${date === new Date().toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}) ? 'Today' : escape(date)}</span></div>` : ''; day = date;
  const mine = m.sender === role;
  return `${divider}<div class="message-row ${mine ? 'mine' : ''}">${!mine ? `<span class="sender-label">${escape(m.sender === 'business' ? 'Dhanavitree' : chat.name)}</span>` : ''}<div class="bubble"><div class="bubble-text">${escape(m.text)}</div><div class="message-meta"><time>${time(m.at)}</time>${mine ? icon('check') : ''}</div></div></div>`;
 }).join('') || '<p class="empty">Every good conversation starts with a hello. 👋</p>';
 if (scroll) $('chat-scroll').scrollTop = $('chat-scroll').scrollHeight;
}
async function refresh(force = false) { try { const data = await api('/api/conversations'); const next = JSON.stringify(data); if (next === snapshot && !force) return; const nearBottom = $('chat-scroll').scrollHeight - $('chat-scroll').scrollTop - $('chat-scroll').clientHeight < 100; chats = data; snapshot = next; if (!current()) selected = chats[0]?.id; render(force || nearBottom); } catch (error) { if (force) toast(error.message); } }
function draftKey() { return `${selected}:${role}`; }
function rememberDraft() { drafts.set(draftKey(), $('message-input').value); }
function restoreDraft() { $('message-input').value = drafts.get(draftKey()) || ''; $('message-input').style.height = 'auto'; }
$('conversations').addEventListener('click', event => { const button = event.target.closest('[data-chat]'); if (!button) return; rememberDraft(); selected = button.dataset.chat; localStorage.setItem('dhanavitree-chat', selected); restoreDraft(); render(true); document.querySelector('.messenger').classList.add('chat-open'); });
$('search').addEventListener('input', () => render());
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === button)); render(); }));
function switchRole() { rememberDraft(); role = $('role').value; localStorage.setItem('dhanavitree-role', role); restoreDraft(); render(true); }
$('role').addEventListener('change', switchRole);
$('profile-button').addEventListener('click', () => { $('role').value = role === 'business' ? 'customer' : 'business'; switchRole(); });
$('back').addEventListener('click', () => document.querySelector('.messenger').classList.remove('chat-open'));
$('inbox-button').addEventListener('click', () => { document.querySelector('.messenger').classList.remove('chat-open'); $('search').focus(); });
$('details-button').addEventListener('click', () => { $('details').hidden = !$('details').hidden; $('details-button').setAttribute('aria-expanded', String(!$('details').hidden)); });
$('message-input').addEventListener('input', () => { $('message-input').style.height = 'auto'; $('message-input').style.height = Math.min($('message-input').scrollHeight,105) + 'px'; });
$('message-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('composer').requestSubmit(); } });
$('emoji').addEventListener('click', () => { $('message-input').value += ' 😊'; $('message-input').focus(); });
document.querySelectorAll('[data-reply]').forEach(button => button.addEventListener('click', () => { $('message-input').value = button.dataset.reply; $('message-input').focus(); }));
$('composer').addEventListener('submit', async event => { event.preventDefault(); const text = $('message-input').value.trim(); if (!text || busy || !current()) return; busy = true; const target = selected, sender = role, key = draftKey(); $('send').disabled = true;
 try { await api(`/api/conversations/${target}/messages`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text,sender}) }); drafts.delete(key); if (selected === target && role === sender) { $('message-input').value = ''; $('message-input').style.height = 'auto'; } await refresh(true); } catch(error) { toast(error.message); } finally { busy = false; $('send').disabled = false; $('message-input').focus(); }
});
$('new-chat').addEventListener('click', () => $('new-dialog').showModal());
$('cancel-new').addEventListener('click', () => $('new-dialog').close());
$('new-form').addEventListener('submit', async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { const chat = await api('/api/conversations', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('new-name').value})}); rememberDraft(); selected = chat.id; localStorage.setItem('dhanavitree-chat',selected); restoreDraft(); $('new-dialog').close(); $('new-name').value = ''; await refresh(true); document.querySelector('.messenger').classList.add('chat-open'); } catch(error) { toast(error.message); } finally { button.disabled = false; } });
refresh(true);
setInterval(() => { if (!document.hidden) refresh(); }, 2000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
