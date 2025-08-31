/* =========================================================
   - Data model in localStorage
   - Simple E2E-like encryption (demo) using Web Crypto AES-GCM
   - UI state, pagination, typing indicator, receipts, edit/delete
   - Smooth scrolling, clustering by day, unread jump, theme/density/mode persistence
   ========================================================= */

// ------------- Utilities -------------
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const fmtTime = (d) => {
  const dt = new Date(d);
  return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const isSameDay = (a, b) => {
  const d1 = new Date(a), d2 = new Date(b);
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
};

const dayLabel = (d) => {
  const dt = new Date(d); const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (isSameDay(dt, today)) return "Today";
  if (isSameDay(dt, yesterday)) return "Yesterday";
  return dt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};
const uuid = () => crypto.randomUUID();

// Smooth scroll helpers
const smoothScrollToBottom = (container) => { container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' }); };
const smoothScrollToMessage = (container, elm) => { const top = elm.offsetTop - 40; container.scrollTo({ top, behavior: 'smooth' }); };

// HTML escape
function escapeHtml(s) { return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m])); }

// ------------- Storage Keys -------------
const STORAGE_KEY = "chatly:v1:data";
const THEME_KEY = "chatly:theme";
const DENSITY_KEY = "chatly:density";
const MODE_KEY = "chatly:mode";
const DRAFT_KEY = "chatly:draft";
const LAST_READ_KEY = "chatly:lastRead";

// ------------- Contacts -------------
const CONTACTS = [
  { id: "u-1", name: "Ayesha", initials: "A" },
  { id: "u-2", name: "Bilal", initials: "B" },
  { id: "u-3", name: "Danish", initials: "D" },
  { id: "u-4", name: "Fatima", initials: "F" }
];

// ------------- Encryption (Demo) -------------
//For demo purposes, key is derived from a static passphrase + conversation id.
const DEMO_SECRET = "chatly-demo-secret-v1";

async function deriveKey(conversationId) {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    "raw", enc.encode(DEMO_SECRET + "|" + conversationId), { name: "PBKDF2" }, false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(conversationId), iterations: 100000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function encryptMessage(conversationId, plaintext) {
  const key = await deriveKey(conversationId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(ct)) };
}
async function decryptMessage(conversationId, cipher) {
  try {
    const key = await deriveKey(conversationId);
    const iv = new Uint8Array(cipher.iv);
    const data = new Uint8Array(cipher.data);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(pt);
  } catch {
    return "[Unable to decrypt]";
  }
}

// ------------- Data Model -------------
//message: { id, convId, from, to, cipher, createdAt, editedAt?, deleted?, status: 'sent'|'delivered'|'seen', seenAt? }
const PAGE_SIZE = 20;

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const data = JSON.parse(raw);
    // --- inline compaction ---
    if (Array.isArray(data.messages)) {
      // keep the last occurrence per id
      const byId = new Map();
      for (const m of data.messages) {
        if (m && m.id) byId.set(m.id, m);
      }
      let arr = Array.from(byId.values());

      // collapse near-identical messages by a simple fingerprint
      const byFp = new Map();
      for (const m of arr) {
        const ivStr = (m.cipher && m.cipher.iv ? m.cipher.iv.join(",") : "");
        const dataStr = (m.cipher && m.cipher.data ? m.cipher.data.slice(0, 24).join(",") : "");
        const bucket = Math.round((m.createdAt || 0) / 200); // 200ms bucket
        const fp = [m.convId, m.from, m.to, bucket, ivStr, dataStr].join("|");
        const prev = byFp.get(fp);
        if (!prev || (m.createdAt || 0) >= (prev.createdAt || 0)) {
          byFp.set(fp, m);
        }
      }
      data.messages = Array.from(byFp.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    } else {
      data.messages = [];
    }
    // write back the cleaned data to storage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return data;
  }
  const convs = CONTACTS.map(c => ({ id: `conv-${c.id}`, peerId: c.id }));
  const data = { conversations: convs, messages: [] };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

function saveData(data) {
  // --- inline compaction ---
  const messages = Array.isArray(data.messages) ? data.messages : [];
  // keep the last occurrence per id
  const byId = new Map();
  for (const m of messages) {
    if (m && m.id) byId.set(m.id, m);
  }
  let arr = Array.from(byId.values());

  // collapse near-identical messages by fingerprint
  const byFp = new Map();
  for (const m of arr) {
    const ivStr = (m.cipher && m.cipher.iv ? m.cipher.iv.join(",") : "");
    const dataStr = (m.cipher && m.cipher.data ? m.cipher.data.slice(0, 24).join(",") : "");
    const bucket = Math.round((m.createdAt || 0) / 200);
    const fp = [m.convId, m.from, m.to, bucket, ivStr, dataStr].join("|");
    const prev = byFp.get(fp);
    if (!prev || (m.createdAt || 0) >= (prev.createdAt || 0)) {
      byFp.set(fp, m);
    }
  }
  const clean = {
    ...data,
    messages: Array.from(byFp.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
}

function getConversationId(peerId) {
  return `conv-${peerId}`;
}

// ------------- UI State -------------
const state = {
  peerId: null, pageIndex: 0, typingTimer: null, peerTypingTimer: null,
  sending: false, lastSend: null, lastBot: null,
};

// ------------- DOM Elements -------------
const chatListEl = $("#chatList");
const messagesEl = $("#messages");
const inputEl = $("#input");
let sendBtn = $("#sendBtn");
const peerNameEl = $("#peerName");
const peerStatusEl = $("#peerStatus");
const peerAvatarEl = $("#peerAvatar");
const typingYouEl = $("#typingYou");
const composerEl = $("#composer");
const emptyStateEl = $("#emptyState");
const closeChatBtn = $("#closeChatBtn");
const chatHeaderEl = $("#chatHeader");

// ------------- Sidebar -------------
function renderSidebar(filter = "") {
  chatListEl.innerHTML = "";
  CONTACTS.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()))
    .forEach(c => {
      const item = document.createElement("div");
      item.className = "chat-item" + (c.id === state.peerId ? " active" : "");
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");
      item.innerHTML = `
        <div class="avatar">${c.initials}</div>
        <div class="chat-meta">
          <div class="name">${c.name}</div>
          <div class="last" data-last="${c.id}">No messages yet</div>
        </div>
        <div class="chat-time" data-time="${c.id}"></div>
      `;
      item.addEventListener("click", () => switchConversation(c.id));
      item.addEventListener("keydown", e => { if (e.key === "Enter") switchConversation(c.id); });
      chatListEl.appendChild(item);
    });
  updateSidebarPreviews();
}

function updateSidebarPreviews() {
  const data = loadData();
  CONTACTS.forEach(c => {
    const convId = getConversationId(c.id);
    const msgs = data.messages.filter(m => m.convId === convId && !m.deleted);
    const last = msgs.at(-1);
    const lastTextEl = chatListEl.querySelector(`[data-last="${c.id}"]`);
    const timeEl = chatListEl.querySelector(`[data-time="${c.id}"]`);
    if (last) {
      decryptMessage(convId, last.cipher).then(text => {
        if (lastTextEl) lastTextEl.textContent = (last.from === "me" ? "You: " : "") + text;
      });
      if (timeEl) timeEl.textContent = fmtTime(last.createdAt);
    } else {
      if (lastTextEl) lastTextEl.textContent = "No messages yet";
      if (timeEl) timeEl.textContent = "";
    }
  });
}

// ------------- Chat Header -------------
function setPeerHeader() {
  if (!state.peerId) {
    peerNameEl.textContent = "No chat";
    peerAvatarEl.textContent = "•";
    peerStatusEl.textContent = "Select a conversation";
    return;
  }
  const peer = CONTACTS.find(c => c.id === state.peerId);
  peerNameEl.textContent = peer?.name || "User Name";
  peerAvatarEl.textContent = peer?.initials || "U";
  peerStatusEl.textContent = "Online";
}

// ------------- Messages Rendering -------------
function updateChatVisibility() {
  const hasChat = !!state.peerId;
  // Empty state
  emptyStateEl.classList.toggle("show", !hasChat);
  emptyStateEl.setAttribute("aria-hidden", hasChat ? "true" : "false");
  // Messages and composer
  $("#messages").style.display = hasChat ? "flex" : "none";
  composerEl.style.display = hasChat ? "grid" : "none";

  //header visibility
  if (chatHeaderEl) {
    chatHeaderEl.style.display = hasChat ? "flex" : "none";
  }
}

function getVisibleMessages() {
  if (!state.peerId) return {slice: [], total: 0};
  const data = loadData();
  const convId = getConversationId(state.peerId);
  const all = (data.messages || []).filter(m => m.convId === convId && !m.deleted); // filter here
  const total = all.length;
  const end = total;
  const start = Math.max(0, end - PAGE_SIZE * (state.pageIndex + 1));
  return { slice: all.slice(start, end), total };
}

function renderStatusChip(m) {
  if (m.from !== "me") {
    if (m.status === "seen") return `<span class="chip success">Seen ${fmtTime(m.seenAt || m.createdAt)}</span>`;
    if (m.status === "delivered") return `<span class="chip">Delivered</span>`;
    return `<span class="chip muted">Sent</span>`;
  } else {
    if (m.status === "seen") return `<span class="chip success">✓✓ Seen ${fmtTime(m.seenAt || m.createdAt)}</span>`;
    if (m.status === "delivered") return `<span class="chip">✓✓ Delivered</span>`;
    return `<span class="chip muted">✓ Sent</span>`;
  }
}

function renderActions() {
  return `
    <div class="actions">
      <button class="tool-btn edit" title="Edit">✏️</button>
      <button class="tool-btn delete" title="Delete">🗑️</button>
    </div>
  `;
}

function bindMessageActions() {
  $$(".msg", messagesEl).forEach(msg => {
    const isMine = msg.classList.contains("sent");
    const editBtn = $(".edit", msg);
    const delBtn = $(".delete", msg);
    if (editBtn) {
      editBtn.onclick = isMine ? onEditMessage : null;
      editBtn.style.display = isMine ? "inline-flex" : "none"; // hide for received
    }
    if (delBtn) delBtn.onclick = onDeleteMessage; // enabled for both
  });
}

async function renderMessages({ keepScroll = false } = {}) {
  if (!state.peerId) return;
  const { slice } = getVisibleMessages();
  const convId = getConversationId(state.peerId);

  let oldHeight, oldScroll;
  if (keepScroll) {
    oldHeight = messagesEl.scrollHeight;
    oldScroll = messagesEl.scrollTop;
  }

  messagesEl.innerHTML = `<button class="unread-jump" id="unreadJump">
    <span>Jump to unread</span> <span class="unread-pill" id="unreadCount">0 new</span>
  </button>`;

  let lastDay = null;
  for (const m of slice) {
    const day = dayLabel(m.createdAt);
    if (day !== lastDay) {
      const group = document.createElement("div");
      group.className = "day-group";
      group.innerHTML = `<div class="day-label">${day}</div>`;
      messagesEl.appendChild(group);
      lastDay = day;
    }
    const text = await decryptMessage(convId, m.cipher);
    const bubble = document.createElement("div");
    bubble.className = "msg " + (m.from === "me" ? "sent" : "recv");
    bubble.dataset.id = m.id;
    bubble.innerHTML = `
      <div class="text" contenteditable="false">${escapeHtml(text)}</div>
      ${m.editedAt ? `<div class="edited">edited</div>` : ``}
      <div class="meta">
        <span>${fmtTime(m.createdAt)}</span>
        ${renderStatusChip(m)}
      </div>
      ${renderActions()}  <!-- always show actions -->
    `;
    messagesEl.appendChild(bubble);
  }

  // Typing indicator placeholder (peer)
  const typing = document.createElement("div");
  typing.id = "peerTyping";
  typing.className = "typing";
  typing.style.display = "none";
  typing.innerHTML = `<span>Typing</span> <span class="dots"><span></span><span></span><span></span></span>`;
  messagesEl.appendChild(typing);

  bindMessageActions();
  setupUnreadJump();

  if (keepScroll) {
    const delta = messagesEl.scrollHeight - oldHeight;
    messagesEl.scrollTop = oldScroll + delta;
  } else {
    smoothScrollToBottom(messagesEl);
  }
}

// ------------- Close Chat -------------
closeChatBtn.addEventListener("click", () => {
  state.peerId = null;
  state.pageIndex = 0;
  setPeerHeader();
  updateChatVisibility();
  renderSidebar($("#search").value);
  // Clear composer and typing badge
  inputEl.value = "";
  $("#typingYou").style.display = "none";
  // Clear unread jump
  $("#unreadJump").classList.remove("show");
});

// ------------- Unread Handling -------------
function setupUnreadJump() {
  if (!state.peerId) return;
  const convId = getConversationId(state.peerId);
  const lastReadRaw = localStorage.getItem(`${LAST_READ_KEY}:${convId}`);
  const lastReadTs = lastReadRaw ? parseInt(lastReadRaw, 10) : 0;

  const { slice } = getVisibleMessages();
  const unread = slice.filter(m => m.createdAt > lastReadTs && m.from !== "me" && !m.deleted);
  const count = unread.length;

  const btn = $("#unreadJump");
  const countEl = $("#unreadCount");
  if (!btn || !countEl) return;

  if (count > 0) {
    countEl.textContent = `${count} new`;
    btn.classList.add("show");
    btn.onclick = () => {
      const firstId = unread[0]?.id;
      if (firstId) {
        const target = messagesEl.querySelector(`.msg[data-id="${firstId}"]`);
        if (target) smoothScrollToMessage(messagesEl, target);
      }
      btn.classList.remove("show");
    };
  } else {
    btn.classList.remove("show");
  }
}

function markAllSeenIfAtBottom() {
  if (!state.peerId) return;
  const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 24;
  if (!nearBottom) return;

  const data = loadData();
  const convId = getConversationId(state.peerId);
  let changed = false;
  data.messages.forEach(m => {
    if (m.convId === convId && m.from !== "me" && !m.deleted) {
      if (m.status !== "seen") {
        m.status = "seen";
        m.seenAt = Date.now();
        changed = true;
      }
    }
  });
  if (changed) {
    saveData(data);
    renderMessages({ keepScroll: true });
  }
  localStorage.setItem(`${LAST_READ_KEY}:${convId}`, String(Date.now()));
}

// ------------- Typing Indicators -------------
function showPeerTyping(show) {
  const el = $("#peerTyping");
  if (el) el.style.display = show ? "inline-flex" : "none";
}

// ------------- Send / Receive / Bot -------------
let onSendClick = null;

function bindSendButtonOnce() {
  // Replace the button node to purge ANY prior listeners
  const oldBtn = document.getElementById("sendBtn");
  if (!oldBtn) return;

  const newBtn = oldBtn.cloneNode(true); // shallow clone keeps id and content
  oldBtn.replaceWith(newBtn);
  sendBtn = newBtn;

  // Single, guarded handler
  let clickGate = false; // blocks rapid double-clicks within a short window

  onSendClick = async () => {
    if (clickGate) return;            // immediate gate for double taps/clicks
    clickGate = true;
    setTimeout(() => (clickGate = false), 350); // reopen after 350ms

    if (!state.peerId || state.sending) return;

    const text = inputEl.value.trim();
    if (!text) return;

    await sendMessage(text);          // this also sets disabled early
    inputEl.value = "";
    typingYouEl.style.display = "none";
    localStorage.removeItem(`${DRAFT_KEY}:${getConversationId(state.peerId)}`);
  };

  // Attach exactly one listener
  sendBtn.addEventListener("click", onSendClick);
}

async function sendMessage(text) {
  if (!state.peerId) return;
  if (state.sending) return;

  const convId = getConversationId(state.peerId);
  const now = Date.now();
  if (
    state.lastSend && 
    state.lastSend.convId === convId && 
    state.lastSend.text === text && 
    now - state.lastSend.ts < 600
  ) {
    return; // drop duplicate within 600ms
  }
  state.lastSend = { convId, text, ts: now };

  state.sending = true;
  if(sendBtn) sendBtn.disabled = true;

  const peerIdAtSend = state.peerId;
  try {
    const data = loadData();
    const cipher = await encryptMessage(convId, text);
    const msg = {
      id: uuid(),
      convId,
      from: "me",
      to: peerIdAtSend,
      cipher,
      createdAt: now,
      status: "sent"
    };
    data.messages.push(msg);
    saveData(data);
    renderMessages();

    setTimeout(() => updateStatus(msg.id, "delivered"), 300);
    simulateBotResponse({ userText: text, convId, peerId: peerIdAtSend });
  } finally {
    state.sending = false;
    if(sendBtn) sendBtn.disabled = false;
  }
}

function updateStatus(messageId, status) {
  const data = loadData();
  const m = data.messages.find(x => x.id === messageId);
  if (m) {
    m.status = status;
    if (status === "seen") m.seenAt = Date.now();
    saveData(data);
    renderMessages({ keepScroll: true });
  }
}

function botReply(text) {
  const t = text.toLowerCase().trim();
  if (t.includes("hello") || t.includes("hi")) return "Hello! How can I help you today?";
  if (t.includes("how are you")) return "I’m good, Thanks! Working on some UI polish.";
  if (t.includes("theme")) return "Try toggling light/dark — your preference is saved.";
  if (t.includes("edit")) return "You can edit your last message via the ✏️ icon.";
  if (t.includes("delete")) return "Deleted by you — with an undo window!";
  if (t.includes("paginate") || t.includes("scroll")) return "Scroll up to load older messages. Smooth and fast.";
  return "Got it! I’ll keep that in mind.";
}

const botTimers = new Map(); // convId -> timeoutId
state.lastBot = null;

function simulateBotResponse({ userText, convId, peerId }) {
  const now = Date.now();

  //same input within 600ms -> ignore
  if (
    state.lastBot &&
    state.lastBot.convId === convId &&
    state.lastBot.text === userText &&
    now - state.lastBot.ts < 600
  ) {
    return;
  }
  state.lastBot = { convId, text: userText, ts: now };

  showPeerTyping(true);

  // Clear any previously scheduled reply for this conversation
  const prev = botTimers.get(convId);
  if (prev) {
    clearTimeout(prev);
    botTimers.delete(convId);
  }

  const tid = setTimeout(async () => {
    botTimers.delete(convId);
    showPeerTyping(false);

    const data = loadData();
    const reply = botReply(userText);
    const cipher = await encryptMessage(convId, reply);
    const msg = {
      id: uuid(),
      convId,
      from: peerId,
      to: "me",
      cipher,
      createdAt: Date.now(),
      status: "delivered"
    };
    data.messages.push(msg);
    saveData(data);

    if (state.peerId && getConversationId(state.peerId) === convId) {
      renderMessages();
      markAllSeenIfAtBottom();
    } else {
      updateSidebarPreviews();
    }
  }, 900 + Math.random() * 700);

  botTimers.set(convId, tid);
}

// ------------- Edit / Delete -------------
async function onEditMessage(e) {
  const msgEl = e.currentTarget.closest(".msg");
  const id = msgEl.dataset.id;
  const data = loadData();
  const m = data.messages.find(x => x.id === id);
  if (!m) return;

  const convId = getConversationId(state.peerId);
  const original = await decryptMessage(convId, m.cipher);

  const textEl = $(".text", msgEl);
  textEl.setAttribute("contenteditable", "true");
  textEl.focus();
  placeCaretAtEnd(textEl);

  const finish = async (commit) => {
    textEl.setAttribute("contenteditable", "false");
    if (commit) {
      const newText = textEl.textContent.trim();
      if (newText && newText !== original) {
        m.cipher = await encryptMessage(convId, newText);
        m.editedAt = Date.now();
        saveData(data);
        renderMessages({ keepScroll: true });
      } else {
        textEl.textContent = original;
      }
    } else {
      textEl.textContent = original;
    }
  };

  const onKey = async (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); document.removeEventListener("keydown", onKey); await finish(true); }
    if (ev.key === "Escape") { document.removeEventListener("keydown", onKey); await finish(false); }
  };
  document.addEventListener("keydown", onKey);
  textEl.addEventListener("blur", () => { document.removeEventListener("keydown", onKey); finish(true); }, { once: true });
}

function placeCaretAtEnd(el) {
  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function onDeleteMessage(e) {
  const msgEl = e.currentTarget.closest(".msg");
  const id = msgEl.dataset.id;
  const data = loadData();
  const m = data.messages.find(x => x.id === id);
  if (!m) return;

  m.deleted = true;
  saveData(data);
  renderMessages({ keepScroll: true });
  updateSidebarPreviews();

  // Snapshot for undo
  const snapshot = { ...m };

  toastUndo("Message Deleted", async () => {
    const d2 = loadData();
    // Restore only if message still exists and is marked deleted
    const mm = d2.messages.find(x => x.id === id);
    if (mm) {
      Object.assign(mm, snapshot, { deleted: false });
      saveData(d2);
      renderMessages({ keepScroll: true });
      updateSidebarPreviews();
    }
  });
}

function toastUndo(text, onUndo) {
  ensureToastStyles();

  // Container
  const t = document.createElement("div");
  t.className = "toast-undo";
  t.setAttribute("role", "status");
  t.setAttribute("aria-live", "polite");
  t.innerHTML = `
    <div class="toast-rail" aria-hidden="true"></div>
    <div class="toast-content">
      <span class="toast-icon" aria-hidden="true">🗑️</span>
      <span class="toast-text">${escapeHtml(text)}</span>
    </div>
    <div class="toast-actions">
      <button class="toast-undo-btn" type="button">Undo</button>
    </div>
    <div class="toast-progress" aria-hidden="true"><div class="toast-progress-fill"></div></div>
  `;

  document.body.appendChild(t);

  const undoBtn = t.querySelector(".toast-undo-btn");
  const fill = t.querySelector(".toast-progress-fill");

  // Animate in (CSS handles)
  requestAnimationFrame(() => {
    t.classList.add("show");
  });

  let removed = false;
  let remaining = 6000; // ms
  let lastTick = Date.now();
  let rafId = null;
  let paused = false;

  const tick = () => {
    if (removed || paused) { rafId = requestAnimationFrame(tick); return; }
    const now = Date.now();
    const delta = now - lastTick;
    lastTick = now;
    remaining = Math.max(0, remaining - delta);
    const pct = 1 - remaining / 6000;
    fill.style.transform = `scaleX(${pct})`;
    if (remaining <= 0) {
      remove();
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  const remove = () => {
    if (removed) return;
    removed = true;
    cancelAnimationFrame(rafId);
    t.classList.remove("show");
    t.classList.add("hide");
    // Allow exit animation
    setTimeout(() => t.remove(), 220);
  };

  // Interactions
  undoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    try { onUndo?.(); } finally { remove(); }
  });

  t.addEventListener("mouseenter", () => { paused = true; });
  t.addEventListener("mouseleave", () => { paused = false; lastTick = Date.now(); });
  t.addEventListener("click", () => remove()); // Click anywhere on toast to dismiss early
  lastTick = Date.now(); // Start progress
  rafId = requestAnimationFrame(tick);
  setTimeout(() => { undoBtn.focus({ preventScroll: true }); }, 50); // Focus for accessibility
}

function ensureToastStyles() {
  if (document.getElementById("toast-undo-styles")) return;

  const css = `
  .toast-undo {
    position: fixed; left: 50%;
    transform: translate(-50%, 12px);
    bottom: 18px; z-index: 1000; display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center; gap: 12px;
    min-width: min(90vw, 350px);
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text); opacity: 0;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6);
    transition: transform 220ms ease, opacity 220ms ease;
  }
  .toast-undo.show { opacity: 1; transform: translate(-50%, 0); }
  .toast-undo.hide { opacity: 0; transform: translate(-50%, 8px); }

  .toast-rail {
    width: 6px; height: 100%; border-radius: 8px;
    background: linear-gradient(180deg, var(--primary), var(--accent));
  }
  html[data-theme="dark"] .toast-undo { box-shadow: 0 22px 70px rgba(215, 214, 214, 0.6); }
  .toast-content { display: inline-flex; align-items: center; gap: 8px; }
  .toast-icon { font-size: 18px; }
  .toast-text { font-weight: 600; }
  .toast-actions { display: inline-flex; align-items: center; }
  .toast-undo-btn {
    background: var(--primary);
    color: #fff; border: none;
    padding: 8px 12px;
    border-radius: 10px; cursor: pointer;
    box-shadow: 0 6px 18px rgba(0,0,0,0.15);
  }
  .toast-undo-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .toast-progress {
    grid-column: 1 / -1; height: 3px;
    background: rgba(0,0,0,0.08);
    border-radius: 999px;
    overflow: hidden; margin-top: 8px;
  }
  html[data-theme="dark"] .toast-progress { background: rgba(255,255,255,0.12); }
  .toast-progress-fill {
    height: 100%; width: 100%;
    transform-origin: left center;
    background: linear-gradient(90deg, var(--primary-2), var(--primary));
    transform: scaleX(0); transition: transform 120ms linear;
  }
  `;

  const style = document.createElement("style");
  style.id = "toast-undo-styles";
  style.textContent = css;
  document.head.appendChild(style);
}

// ------------- Pagination on Scroll Up -------------
messagesEl.addEventListener("scroll", () => {
  if (!state.peerId) return;
  if (messagesEl.scrollTop === 0) {
    const data = loadData();
    const convId = getConversationId(state.peerId);
    const count = data.messages.filter(m => m.convId === convId).length;
    if (PAGE_SIZE * (state.pageIndex + 1) < count) {
      state.pageIndex += 1;
      renderMessages({ keepScroll: true });
    }
  }
  markAllSeenIfAtBottom();
});

// ------------- Input / Draft / Beforeunload -------------
inputEl.addEventListener("input", () => {
  typingYouEl.style.display = inputEl.value.trim() ? "inline-flex" : "none";
  const convId = getConversationId(state.peerId);
  localStorage.setItem(`${DRAFT_KEY}:${convId}`, inputEl.value);
  showPeerTyping(true); // simulate peer noticing typing
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => showPeerTyping(false), 800);
});

window.addEventListener("beforeunload", (e) => {
  if (inputEl.value.trim().length > 0) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ------------- Theme / Density / Mode -------------
const applyTheme = (val) => {
  document.documentElement.setAttribute("data-theme", val);
  localStorage.setItem(THEME_KEY, val);
};
const applyDensity = (val) => {
  if (val === "comfy") { document.documentElement.removeAttribute("data-density"); }
  else { document.documentElement.setAttribute("data-density", val); }
  localStorage.setItem(DENSITY_KEY, val);
  $$(".density").forEach(b => b.classList.toggle("active", b.dataset.density === val));
};
const applyMode = (val) => {
  document.documentElement.setAttribute("data-mode", val);
  localStorage.setItem(MODE_KEY, val);
  $$(".mode").forEach(b => b.classList.toggle("active", b.dataset.mode === val));
};

$("#themeToggle").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") || "light";
  applyTheme(cur === "light" ? "dark" : "light");
});
$$(".density").forEach(b => b.addEventListener("click", () => applyDensity(b.dataset.density)));
$$(".mode").forEach(b => b.addEventListener("click", () => applyMode(b.dataset.mode)));

// ------------- Conversation Switching -------------
async function switchConversation(peerId) {
  state.peerId = peerId;
  state.pageIndex = 0;
  renderSidebar($("#search").value);
  setPeerHeader(); updateChatVisibility();
  const convId = getConversationId(peerId);
  inputEl.value = localStorage.getItem(`${DRAFT_KEY}:${convId}`) || "";
  $("#typingYou").style.display = inputEl.value.trim() ? "inline-flex" : "none";
  await renderMessages(); markAllSeenIfAtBottom();
}

$("#search").addEventListener("input", (e) => renderSidebar(e.target.value));

// When user returns to tab, update receipts
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.peerId) {
    markAllSeenIfAtBottom();
    updateSidebarPreviews();
  }
});

// ------------- Initialization -------------
function initThemeDensityMode() {
  const theme = localStorage.getItem(THEME_KEY) || "light";
  const density = localStorage.getItem(DENSITY_KEY) || "comfy";
  const mode = localStorage.getItem(MODE_KEY) || "default";
  applyTheme(theme); applyDensity(density); applyMode(mode);
}

function seedDemoIfEmpty() {
  const data = loadData();
  if (data.messages.length === 0) {
    const convId = getConversationId(CONTACTS[0].id);
    (async () => {
      data.messages.push({
        id: uuid(), convId, from: CONTACTS[0].id, to: "me",
        cipher: await encryptMessage(convId, "Hello!"),
        createdAt: Date.now() - 1000 * 60 * 2, status: "delivered"
      });
      data.messages.push({
        id: uuid(), convId, from: "me", to: CONTACTS[0].id,
        cipher: await encryptMessage(convId, "Hi! How are you?"),
        createdAt: Date.now() - 1000 * 60 * 1, status: "seen", seenAt: Date.now() - 1000 * 50
      });
      saveData(data);
      renderSidebar();
      setPeerHeader();
      renderMessages();
      markAllSeenIfAtBottom();
    })();
  }
}

// Kickoff
(function start() {
  initThemeDensityMode();
  const tmp = loadData(); saveData(tmp);
  renderSidebar();  setPeerHeader();
  updateChatVisibility();
  if (state.peerId) renderMessages();
  seedDemoIfEmpty();  bindSendButtonOnce();
})();