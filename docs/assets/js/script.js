const chatWrapper = document.getElementById('chatWrapper');
const chatToggle = document.getElementById('chatToggle');

function toggleChat() {
    if (chatWrapper.style.display === "none" || chatWrapper.style.display === "") {
        chatWrapper.style.display = "flex";
        chatToggle.style.display = "none";
    } else {
        chatWrapper.style.display = "none";
        chatToggle.style.display = "block";
    }
}

chatToggle.addEventListener('click', toggleChat);

const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const chatLogs = document.getElementById("chatLogs");

userInput.addEventListener("keypress", function(event) {
    if (event.key === "Enter") {
        event.preventDefault();
        sendMessage();
    }
});

sendBtn.addEventListener("click", sendMessage);

function addMessage(data, isUser) {
    const rowDiv = document.createElement("div");
    rowDiv.className = "message-row " + (isUser ? "user-row" : "bot-row");

    const msgDiv = document.createElement("div");
    msgDiv.className = "message " + (isUser ? "user-msg" : "bot-msg");

    if (data.text) msgDiv.innerText = data.text;

    if (data.image) {
        const img = document.createElement("img");
        img.src = data.image;
        img.className = "chat-image";
        msgDiv.appendChild(img);
    }

    rowDiv.appendChild(msgDiv);
    chatLogs.appendChild(rowDiv);
    chatLogs.scrollTop = chatLogs.scrollHeight;
}

async function sendMessage() {
    const message = userInput.value.trim();
    if (message === "") return;

    addMessage({ text: message, image: null }, true);
    userInput.value = "";

    try {
        const engine = window.ESChatEngine;
        const data = engine
            ? await engine.getResponse({ message, cid: "home" })
            : { text: "حصل خطأ: محرك الشات مش جاهز.", image: null };

        addMessage(data, false);
    } catch {
        addMessage({ text: "حصل خطأ أثناء تشغيل الشات.", image: null }, false);
    }
}

window.__ES_KNOWLEDGE_URL = "knowledge.json";
if (window.ESChatEngine && window.ESChatEngine.loadKnowledge) {
    window.ESChatEngine.loadKnowledge();
}
