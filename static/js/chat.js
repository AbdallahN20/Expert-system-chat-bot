const $ = id => document.getElementById(id);
const listEl = $('chatList'), msgsEl = $('messages'), titleEl = $('chatTitle'), input = $('userInput'), sendBtn = $('sendBtn');

let state = JSON.parse(localStorage.getItem('es_state')) || { active: null, chats: [] };
const save = () => localStorage.setItem('es_state', JSON.stringify(state));
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

const newChat = () => {
    const id = genId();
    state.chats.unshift({ id, title: 'محادثة جديدة', msgs: [], ts: Date.now() });
    state.active = id; save(); render(); input.focus();
};

const activeChat = () => state.chats.find(c => c.id === state.active);

const deleteChat = () => {
    state.chats = state.chats.filter(c => c.id !== state.active);
    if (!state.chats.length) newChat();
    else { state.active = state.chats[0].id; save(); render(); }
};

const addMsg = (chat, role, text, image=null) => {
    chat.msgs.push({role, text, image});
    if (chat.title === 'محادثة جديدة' && role === 'user') chat.title = text.slice(0, 25) + (text.length > 25 ? '...' : '');
    chat.ts = Date.now(); save(); render();
};

const render = () => {
    if (!state.chats.length) return newChat();
    
    // Render History List
    listEl.innerHTML = state.chats.sort((a,b) => b.ts - a.ts).map(c => 
        `<button class="history-item ${c.id === state.active ? 'active' : ''}" onclick="state.active='${c.id}'; save(); render()">${c.title}</button>`
    ).join('');

    // Render Active Chat
    const chat = activeChat();
    titleEl.textContent = chat.title;
    msgsEl.innerHTML = !chat.msgs.length ? 
        `<div class="msg bot">أهلاً! اسألني عن Expert Systems واكتب (مواضيع) للمحاور.</div>` : 
        chat.msgs.map(m => `<div class="msg ${m.role}">${m.text}${m.image ? `<img src="${m.image}" class="chat-img">` : ''}</div>`).join('');
    
    msgsEl.scrollTop = msgsEl.scrollHeight;
};

const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    
    const chat = activeChat();
    addMsg(chat, 'user', text);
    input.value = ''; sendBtn.disabled = true;

    try {
        const fd = new FormData(); fd.append('msg', text); fd.append('cid', chat.id);
        const res = await fetch('/get_response', { method: 'POST', body: fd });
        const data = await res.json();
        addMsg(chat, 'bot', data.text || 'خطأ', data.image);
    } catch {
        addMsg(chat, 'bot', 'خطأ في الاتصال.');
    } finally {
        sendBtn.disabled = false; input.focus();
    }
};

input.onkeydown = e => { if (e.key === 'Enter') send(); };
render();
