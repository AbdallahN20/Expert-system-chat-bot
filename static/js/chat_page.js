const STORAGE_KEY = "es_chat_state_v1";

const newChatBtn = document.getElementById("newChatBtn");
const restartBtn = document.getElementById("restartBtn");
const endBtn = document.getElementById("endBtn");

const chatListEl = document.getElementById("chatList");
const messagesEl = document.getElementById("messages");
const activeChatTitleEl = document.getElementById("activeChatTitle");

const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

function nowMs() {
    return Date.now();
}

function safeJsonParse(value, fallback) {
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const state = raw ? safeJsonParse(raw, null) : null;

    if (!state || typeof state !== "object") {
        return { activeId: "", chats: [] };
    }

    const chats = Array.isArray(state.chats) ? state.chats : [];
    const activeId = typeof state.activeId === "string" ? state.activeId : "";

    return { activeId, chats };
}

function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function generateId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `${nowMs().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function createChat() {
    const id = generateId();
    const ts = nowMs();
    return {
        id,
        title: "محادثة جديدة",
        createdAt: ts,
        updatedAt: ts,
        messages: [],
    };
}

function getActiveChat(state) {
    return state.chats.find((c) => c.id === state.activeId) || null;
}

function setActiveChat(state, chatId) {
    state.activeId = chatId;
    saveState(state);
}

function formatTitleFromText(text) {
    const cleaned = String(text || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return "محادثة جديدة";
    return cleaned.length > 28 ? cleaned.slice(0, 28) + "…" : cleaned;
}

function clearElement(el) {
    while (el.firstChild) {
        el.removeChild(el.firstChild);
    }
}

function scrollMessagesToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderChatList(state) {
    clearElement(chatListEl);

    const sorted = [...state.chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (sorted.length === 0) {
        const empty = document.createElement("div");
        empty.className = "sidebar-empty";
        empty.textContent = "مفيش محادثات لسه.";
        chatListEl.appendChild(empty);
        return;
    }

    for (const chat of sorted) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chat-list-item" + (chat.id === state.activeId ? " active" : "");

        const title = document.createElement("div");
        title.className = "chat-list-title";
        title.textContent = chat.title || "محادثة";

        const meta = document.createElement("div");
        meta.className = "chat-list-meta";
        meta.textContent = new Date(chat.updatedAt || chat.createdAt || nowMs()).toLocaleString("ar-EG");

        btn.appendChild(title);
        btn.appendChild(meta);

        btn.addEventListener("click", () => {
            setActiveChat(state, chat.id);
            renderAll(state);
        });

        chatListEl.appendChild(btn);
    }
}

function buildMessageRow(role, text, image) {
    const row = document.createElement("div");
    row.className = "chat-msg-row " + (role === "user" ? "user" : "bot");

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble " + (role === "user" ? "user" : "bot");

    if (text) {
        const p = document.createElement("div");
        p.className = "chat-text";
        p.textContent = text;
        bubble.appendChild(p);
    }

    if (image) {
        const img = document.createElement("img");
        img.className = "chat-img";
        img.alt = "";
        img.src = image;
        bubble.appendChild(img);
    }

    row.appendChild(bubble);
    return row;
}

function renderMessages(state) {
    clearElement(messagesEl);

    const activeChat = getActiveChat(state);
    if (!activeChat) {
        activeChatTitleEl.textContent = "محادثة جديدة";
        messagesEl.appendChild(
            buildMessageRow(
                "bot",
                "أهلاً! اسألني عن Expert Systems.\n\nمثال: (اشرح Forward Chaining) أو (يعني ايه Uncertainty؟)",
                null,
            ),
        );
        scrollMessagesToBottom();
        return;
    }

    activeChatTitleEl.textContent = activeChat.title || "محادثة";

    if (!Array.isArray(activeChat.messages) || activeChat.messages.length === 0) {
        messagesEl.appendChild(
            buildMessageRow(
                "bot",
                "أهلاً! اسألني عن Expert Systems.\n\nاكتب سؤالك، ولو تحب اكتب (مواضيع) علشان تشوف المحاور.",
                null,
            ),
        );
        scrollMessagesToBottom();
        return;
    }

    for (const m of activeChat.messages) {
        messagesEl.appendChild(buildMessageRow(m.role, m.text, m.image));
    }

    scrollMessagesToBottom();
}

function renderAll(state) {
    renderChatList(state);
    renderMessages(state);
}

function ensureActiveChat(state) {
    if (state.chats.length === 0) {
        const chat = createChat();
        state.chats.push(chat);
        state.activeId = chat.id;
        saveState(state);
        return chat;
    }

    const active = getActiveChat(state);
    if (active) return active;

    state.activeId = state.chats[0].id;
    saveState(state);
    return getActiveChat(state);
}

function autosizeTextarea() {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 180) + "px";
}

async function sendMessage() {
    const text = String(messageInput.value || "").trim();
    if (!text) return;

    const state = loadState();
    const activeChat = ensureActiveChat(state);

    const userMsg = { role: "user", text, image: null, ts: nowMs() };
    activeChat.messages.push(userMsg);
    activeChat.updatedAt = nowMs();

    if (!activeChat.title || activeChat.title === "محادثة جديدة") {
        activeChat.title = formatTitleFromText(text);
    }

    saveState(state);
    renderAll(state);

    messageInput.value = "";
    autosizeTextarea();

    sendBtn.disabled = true;

    try {
        const formData = new FormData();
        formData.append("msg", text);
        formData.append("cid", activeChat.id);

        const res = await fetch("/get_response", {
            method: "POST",
            body: formData,
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        const botText = data && typeof data.text === "string" ? data.text : "حصل خطأ في الرد.";
        const botImg = data && data.image ? data.image : null;

        activeChat.messages.push({ role: "bot", text: botText, image: botImg, ts: nowMs() });
        activeChat.updatedAt = nowMs();

        saveState(state);
        renderAll(state);
    } catch {
        activeChat.messages.push({ role: "bot", text: "حصل خطأ أثناء الاتصال بالسيرفر.", image: null, ts: nowMs() });
        activeChat.updatedAt = nowMs();
        saveState(state);
        renderAll(state);
    } finally {
        sendBtn.disabled = false;
    }
}

function startNewChat() {
    const state = loadState();
    const chat = createChat();
    state.chats.push(chat);
    state.activeId = chat.id;
    saveState(state);
    renderAll(state);

    messageInput.focus();
}

function endChat() {
    window.location.href = "/";
}

newChatBtn.addEventListener("click", startNewChat);
restartBtn.addEventListener("click", startNewChat);
endBtn.addEventListener("click", endChat);

sendBtn.addEventListener("click", sendMessage);

messageInput.addEventListener("input", autosizeTextarea);
messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

(function init() {
    const state = loadState();
    ensureActiveChat(state);
    renderAll(state);
    autosizeTextarea();
})();
