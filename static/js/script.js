// === منطق فتح وإغلاق الشات ===
const chatWrapper = document.getElementById('chatWrapper');
const chatToggle = document.getElementById('chatToggle');

function toggleChat() {
    if (chatWrapper.style.display === "none" || chatWrapper.style.display === "") {
        chatWrapper.style.display = "flex";
        chatToggle.style.display = "none"; // اخفاء الزر لما الشات يفتح
    } else {
        chatWrapper.style.display = "none";
        chatToggle.style.display = "block";
    }
}

// ربط زر الفتح بالدالة
chatToggle.addEventListener('click', toggleChat);


// === منطق الشات بوت (نفس الكود الذكي) ===
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const chatLogs = document.getElementById("chatLogs");

userInput.addEventListener("keypress", function(event) {
    if (event.key === "Enter") sendMessage();
});

sendBtn.addEventListener("click", sendMessage);

function addMessage(data, isUser) {
    var rowDiv = document.createElement("div");
    rowDiv.className = "message-row " + (isUser ? "user-row" : "bot-row");

    var msgDiv = document.createElement("div");
    msgDiv.className = "message " + (isUser ? "user-msg" : "bot-msg");

    if (data.text) msgDiv.innerText = data.text;

    if (data.image) {
        var img = document.createElement("img");
        img.src = data.image;
        img.className = "chat-image";
        msgDiv.appendChild(img);
    }

    rowDiv.appendChild(msgDiv);
    chatLogs.appendChild(rowDiv);
    chatLogs.scrollTop = chatLogs.scrollHeight;
}

function sendMessage() {
    var message = userInput.value.trim();
    if (message === "") return;

    addMessage({text: message, image: null}, true);
    userInput.value = "";

    var formData = new FormData();
    formData.append('msg', message);

    fetch('/get_response', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        addMessage(data, false);
    })
    .catch(error => console.error('Error:', error));
}