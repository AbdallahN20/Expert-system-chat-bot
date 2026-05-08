const $ = id => document.getElementById(id);
const chatBox = $('chatBox'), msgs = $('messages'), input = $('userInput'), sendBtn = $('sendBtn');

let chat = JSON.parse(localStorage.getItem('es_chat')) || [{role: 'bot', text: 'أهلاً! اسألني عن Expert Systems واكتب (مواضيع) للمحاور.'}];
const save = () => localStorage.setItem('es_chat', JSON.stringify(chat));

const toggleChat = () => {
    chatBox.classList.toggle('hidden');
    if (!chatBox.classList.contains('hidden')) input.focus();
};

const clearChat = () => {
    chat = [chat[0]]; save(); render();
};

const addMsg = (role, text, image=null) => {
    const imgHtml = image ? `<img src="${image}" class="chat-img">` : '';
    msgs.insertAdjacentHTML('beforeend', `<div class="msg ${role}">${text}${imgHtml}</div>`);
    msgs.scrollTop = msgs.scrollHeight;
};

const render = () => {
    msgs.innerHTML = '';
    chat.forEach(m => addMsg(m.role, m.text, m.image));
};

const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    
    chat.push({role: 'user', text}); save(); render();
    input.value = ''; sendBtn.disabled = true;

    try {
        const fd = new FormData(); fd.append('msg', text);
        const res = await fetch('/get_response', { method: 'POST', body: fd });
        const data = await res.json();
        chat.push({role: 'bot', text: data.text || 'خطأ', image: data.image});
    } catch {
        chat.push({role: 'bot', text: 'خطأ في الاتصال.'});
    } finally {
        save(); render(); sendBtn.disabled = false; input.focus();
    }
};

sendBtn.onclick = send;
input.onkeydown = e => e.key === 'Enter' && send();
render();