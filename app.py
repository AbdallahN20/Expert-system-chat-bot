import os
import json
import random
import re
from typing import Any, Dict, List, Optional, Tuple

import requests
from flask import Flask, render_template, request, jsonify, send_from_directory

app = Flask(__name__)

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "").strip()
TELEGRAM_API_URL = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/" if TELEGRAM_TOKEN else ""
MY_WEBSITE_URL = os.getenv("MY_WEBSITE_URL", "").strip()

user_context = {}

_AR_DIACRITICS_RE = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]")
_PUNCT_RE = re.compile(r"[^\w\s\u0600-\u06FF-]")

_STOPWORDS_AR = {
    "في", "من", "على", "الى", "إلى", "عن", "مع", "هو", "هي", "انا", "أنا", "انت", "أنت",
    "انتي", "إنتي", "احنا", "نحن", "ده", "دي", "دا", "دول", "ايه", "إيه", "يعني", "ممكن", "لو",
    "please", "pls",
}

_STOPWORDS_EN = {
    "the", "a", "an", "is", "are", "was", "were", "what", "why", "how", "tell", "me", "about", "please",
}

_TONE_PREFIXES = [
    "تمام، خلّينا نفهمها سوا:",
    "بص يا صاحبي:",
    "حلو، ركّز معايا:",
    "ماشي، تعال نقولها ببساطة:",
    "طيب، خلّيني أرتّبهالك:",
]

_TONE_SUFFIXES = [
    "تحب مثال سريع؟",
    "لو عايزها مختصر اكتب (مختصر)، ولو بالتفصيل اكتب (بالتفصيل).",
    "لو في نقطة مش واضحة قولي وأنا أوضحها.",
]

def _normalize_arabic(text: str) -> str:
    text = _AR_DIACRITICS_RE.sub("", text)
    text = text.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    text = text.replace("ى", "ي").replace("ة", "ه")
    text = text.replace("ؤ", "و").replace("ئ", "ي")
    text = text.replace("ـ", "")
    return text

def normalize_text(text: str) -> str:
    text = (text or "").strip().lower()
    text = _normalize_arabic(text)
    text = _PUNCT_RE.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def tokenize(text: str) -> List[str]:
    norm = normalize_text(text)
    if not norm:
        return []
    tokens = [t for t in norm.split(" ") if t]
    filtered: List[str] = []
    for t in tokens:
        if t in _STOPWORDS_AR or t in _STOPWORDS_EN:
            continue
        if len(t) <= 1:
            continue
        filtered.append(t)

        if t.startswith("ال") and len(t) > 3:
            stripped = t[2:]
            if len(stripped) >= 3 and stripped not in _STOPWORDS_AR and stripped not in _STOPWORDS_EN:
                filtered.append(stripped)
    return filtered


def stylize_response(text: str, intent_tag: Optional[str], norm_input: str) -> str:
    text = (text or "").strip()
    if not text:
        return text

    starter_tokens = (
        "بص",
        "تمام",
        "حلو",
        "ماشي",
        "طيب",
        "أهلاً",
        "اهلاً",
        "يا أهلاً",
        "يا اهلاً",
        "يا هلا",
        "إزيك",
        "ازيك",
        "صباح",
        "مساء",
        "العفو",
        "باي",
        "مع السلامة",
    )

    prefix = ""
    if not text.startswith(starter_tokens):
        prefix = random.choice(_TONE_PREFIXES)

    add_suffix = True
    if wants_short_answer(norm_input):
        add_suffix = False
    else:
        add_suffix = random.random() < 0.55

    suffix = random.choice(_TONE_SUFFIXES) if add_suffix else ""

    parts = []
    if prefix:
        parts.append(prefix)
    parts.append(text)
    if suffix:
        parts.append(suffix)

    return "\n\n".join(parts).strip()

def wants_short_answer(norm_input: str) -> bool:
    return any(k in norm_input for k in ["مختصر", "تلخيص", "الخلاصه", "باختصار", "summary", "short"])

def wants_long_answer(norm_input: str) -> bool:
    return any(
        k in norm_input
        for k in [
            "بالتفصيل",
            "تفاصيل",
            "شرح",
            "اشرح",
            "اشرحلي",
            "اشرح لى",
            "وضح",
            "وضحلي",
            "وضح لى",
            "فسر",
            "فسرلي",
            "فسر لى",
            "فهمني",
            "فهمنى",
            "عرفها",
            "explain",
            "more details",
            "expand",
        ]
    )

def is_reasoning_request(norm_input: str) -> bool:
    cues = [
        "عرفت ازاي", "فهمت ازاي", "ازاي استنتجت", "إزاي استنتجت", "بناء على ايه", "ليه بتقول", "ليه قولت",
        "why did you", "explain your reasoning",
    ]
    return any(cue in norm_input for cue in cues)

def _intent_phrases(intent: Dict[str, Any]) -> List[str]:
    phrases: List[str] = []
    phrases.extend(intent.get("patterns", []) or [])
    phrases.extend(intent.get("keywords", []) or [])
    title = intent.get("title")
    if title:
        phrases.append(str(title))
    tag = intent.get("tag")
    if tag:
        phrases.append(str(tag).replace("_", " "))
    return phrases

def score_intent(
    intent: Dict[str, Any],
    norm_input: str,
    input_tokens: List[str],
) -> Tuple[float, List[str]]:
    score = 0.0
    matched: List[str] = []
    token_set = set(input_tokens)

    for phrase in _intent_phrases(intent):
        norm_phrase = normalize_text(str(phrase))
        if not norm_phrase:
            continue

        if len(norm_phrase) >= 3 and norm_phrase in norm_input:
            score += 4.0 + (0.25 * len(norm_phrase.split(" ")))
            matched.append(str(phrase))
            continue

        phrase_tokens = set(tokenize(norm_phrase))
        overlap = phrase_tokens & token_set
        if overlap:
            score += 1.2 * (len(overlap) / max(1, len(phrase_tokens)))
            matched.extend(sorted(overlap))

    unique_matched = []
    seen = set()
    for m in matched:
        if m in seen:
            continue
        seen.add(m)
        unique_matched.append(m)

    return score, unique_matched

def find_best_intent(
    norm_input: str,
    input_tokens: List[str],
    knowledge: Dict[str, Any],
) -> Tuple[Optional[Dict[str, Any]], float, List[str], List[Tuple[str, float]]]:
    scored: List[Tuple[Dict[str, Any], float, List[str]]] = []
    for intent in knowledge.get("intents", []):
        s, matched = score_intent(intent, norm_input, input_tokens)
        scored.append((intent, s, matched))

    scored.sort(key=lambda x: x[1], reverse=True)
    top_debug = [(i.get("tag", ""), float(s)) for i, s, _ in scored[:5]]

    if not scored:
        return None, 0.0, [], top_debug

    best_intent, best_score, best_matched = scored[0]
    return best_intent, float(best_score), best_matched, top_debug

def pick_intent_response(intent: Dict[str, Any], norm_input: str) -> str:
    short = wants_short_answer(norm_input)
    long = wants_long_answer(norm_input)

    if short and intent.get("responses_short"):
        return random.choice(intent["responses_short"])
    if long and intent.get("responses_long"):
        return random.choice(intent["responses_long"])
    return random.choice(intent.get("responses", ["..."]))

def load_knowledge_base():
    base_path = os.path.dirname(os.path.abspath(__file__))
    file_path = os.path.join(base_path, 'knowledge.json')
    with open(file_path, 'r', encoding='utf-8') as file:
        return json.load(file)

knowledge_base = load_knowledge_base()

def get_intent_by_tag(tag: str) -> Optional[Dict[str, Any]]:
    for intent in knowledge_base.get("intents", []):
        if intent.get("tag") == tag:
            return intent
    return None


def _format_suggestions(knowledge: Dict[str, Any], top_debug: List[Tuple[str, float]]) -> str:
    if not top_debug:
        return "\n\nلو تحب، اكتب (مواضيع) علشان تشوف المحاور."

    tag_to_title: Dict[str, str] = {}
    for intent in knowledge.get("intents", []):
        tag = str(intent.get("tag") or "").strip()
        if not tag:
            continue
        tag_to_title[tag] = str(intent.get("title") or tag)

    suggestions: List[str] = []
    for tag, _score in top_debug:
        title = tag_to_title.get(tag)
        if not title:
            continue
        if title in suggestions:
            continue
        suggestions.append(title)

    if not suggestions:
        return "\n\nلو تحب، اكتب (مواضيع) علشان تشوف المحاور."

    top = suggestions[:3]
    joined = "، ".join(top)
    return f"\n\nغالباً تقصد: {joined}\nلو تحب القائمة كلها اكتب (مواضيع)."

def get_bot_response(user_input, user_id="web"):
    global user_context

    raw_input = (user_input or "").strip()
    if not raw_input:
        return {"text": "اكتب سؤالك بس، وأنا معاك.", "image": None}

    norm_input = normalize_text(raw_input)
    input_tokens = tokenize(norm_input)

    if user_id not in user_context:
        user_context[user_id] = {}

    if any(p in norm_input for p in ["reset", "امسح", "ابدأ من جديد", "ابدأ من الاول", "new chat"]):
        user_context[user_id] = {}
        reset_intent = get_intent_by_tag("reset")
        if reset_intent:
            base = pick_intent_response(reset_intent, norm_input)
            return {"text": stylize_response(base, reset_intent.get("tag"), norm_input), "image": None}
        return {"text": stylize_response("تمام — بدأنا من جديد. اكتب (مواضيع) علشان تشوف المحاور.", "reset", norm_input), "image": None}

    if is_reasoning_request(norm_input):
        last = user_context[user_id].get("last_reasoning")
        if not last:
            return {"text": stylize_response("لسه ماعنديش نتيجة سابقة أشرحها. اسألني سؤال في النظم الخبيرة الأول.", "reasoning", norm_input), "image": None}

        last_title = last.get("intent_title") or last.get("intent_tag")
        matched = last.get("matched") or []
        matched_str = ", ".join(matched[:10]) if matched else "(مافيش كلمات واضحة)"
        base = f"رجّحت إن سؤالك عن: {last_title}\n\nالسبب: لقيت كلمات/عبارات مرتبطة بالموضوع داخل سؤالك زي: {matched_str}\n\nلو ده مش قصدك، اكتب (مواضيع) واختار محور."
        return {"text": stylize_response(base, "reasoning", norm_input), "image": None}

    found_intent, best_score, matched_terms, top_debug = find_best_intent(norm_input, input_tokens, knowledge_base)

    if (not found_intent or best_score < 1.4) and user_context[user_id].get("last_intent_tag"):
        last_tag = user_context[user_id].get("last_intent_tag")
        last_intent = get_intent_by_tag(last_tag)
        if last_intent and (wants_short_answer(norm_input) or wants_long_answer(norm_input)):
            text = pick_intent_response(last_intent, norm_input)
            user_context[user_id]["last_reasoning"] = {
                "intent_tag": last_intent.get("tag"),
                "intent_title": last_intent.get("title") or last_intent.get("tag"),
                "matched": ["متابعة"] + (matched_terms or []),
                "score": best_score,
            }
            return {"text": stylize_response(text, last_intent.get("tag"), norm_input), "image": None}

    MIN_SCORE = 1.4
    if found_intent and best_score >= MIN_SCORE:
        response_text = pick_intent_response(found_intent, norm_input)
        user_context[user_id]["last_intent_tag"] = found_intent.get("tag")
        user_context[user_id]["last_reasoning"] = {
            "intent_tag": found_intent.get("tag"),
            "intent_title": found_intent.get("title") or found_intent.get("tag"),
            "matched": matched_terms,
            "score": best_score,
        }
        return {"text": stylize_response(response_text, found_intent.get("tag"), norm_input), "image": found_intent.get("image")}

    fallback_intent = get_intent_by_tag("fallback")
    fallback_text = pick_intent_response(fallback_intent, norm_input) if fallback_intent else "مش متأكد إني فهمت قصدك."
    suggestions = _format_suggestions(knowledge_base, top_debug)
    return {"text": stylize_response(fallback_text + suggestions, "fallback", norm_input), "image": None}

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/chat")
def chat_page():
    return render_template("chat.html")

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(
        os.path.join(app.root_path, 'static/images'),
        'favicon.png',
        mimetype='image/png'
    )

@app.route("/get_response", methods=["POST"])
def chat():
    msg = request.form.get("msg", "")
    cid = (request.form.get("cid") or "default").strip() or "default"
    base_user_id = request.remote_addr or "web"
    user_id = f"{base_user_id}:{cid}"
    return jsonify(get_bot_response(msg, user_id=user_id))

@app.route('/telegram', methods=['POST'])
def telegram_webhook():
    if not TELEGRAM_TOKEN:
        return "OK"

    update = request.get_json()

    if "message" in update:
        chat_id = update["message"]["chat"]["id"]

        if "text" in update["message"]:
            text = update["message"]["text"]

            response = get_bot_response(text, str(chat_id))
            reply_text = response['text']
            reply_image = response['image']

            requests.post(
                TELEGRAM_API_URL + "sendMessage",
                json={"chat_id": chat_id, "text": reply_text},
                timeout=10,
            )

            if reply_image:
                if MY_WEBSITE_URL:
                    full_image_url = MY_WEBSITE_URL + reply_image
                    requests.post(
                        TELEGRAM_API_URL + "sendPhoto",
                        json={"chat_id": chat_id, "photo": full_image_url},
                        timeout=10,
                    )

    return "OK"

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
    app.run(host="0.0.0.0", port=port, debug=debug)