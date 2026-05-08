import os, json, random, re
import requests
from flask import Flask, render_template, request, jsonify, send_from_directory

app = Flask(__name__)

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "").strip()
TELEGRAM_API = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/" if TELEGRAM_TOKEN else ""
MY_URL = os.getenv("MY_WEBSITE_URL", "").strip()

# ── NLP ──────────────────────────────────────────────────────────────

_NORM = str.maketrans("أإآؤئىة", "اااوييه", "ـ")
_DIAC = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]")
_PUNCT = re.compile(r"[^\w\s\u0600-\u06FF-]")
_WS = re.compile(r"\s+")
_STOPS = {
    "في","من","على","الى","إلى","عن","مع","هو","هي","انا","أنا","انت","أنت",
    "انتي","إنتي","احنا","نحن","ده","دي","دا","دول","ايه","إيه","يعني","ممكن","لو",
    "please","pls","the","a","an","is","are","was","were","what","why","how","tell","me","about",
}


def norm(t):
    return _WS.sub(" ", _PUNCT.sub(" ", _DIAC.sub("", (t or "").strip().lower()).translate(_NORM))).strip()


def toks(t):
    ws = [w for w in norm(t).split() if len(w) > 1 and w not in _STOPS]
    return ws + [w[2:] for w in ws if w[:2] == "ال" and len(w) > 4]


# ── Tone / Style ─────────────────────────────────────────────────────

_PREF = [
    "تمام، خلّينا نفهمها سوا:", "بص يا صاحبي:", "حلو، ركّز معايا:",
    "ماشي، تعال نقولها ببساطة:", "طيب، خلّيني أرتّبهالك:",
]
_SUFF = [
    "تحب مثال سريع؟",
    "لو عايزها مختصر اكتب (مختصر)، ولو بالتفصيل اكتب (بالتفصيل).",
    "لو في نقطة مش واضحة قولي وأنا أوضحها.",
]
_STARTER = re.compile(
    r"^(بص|تمام|حلو|ماشي|طيب|[اأ]هل|يا [اأ]هل|يا هلا|[اإ]زيك|صباح|مساء|العفو|باي|مع السلام)"
)
_SHORT = ["مختصر", "تلخيص", "الخلاصه", "باختصار", "summary", "short"]
_LONG = [
    "بالتفصيل", "تفاصيل", "شرح", "اشرح", "اشرحلي", "اشرح لى",
    "وضح", "وضحلي", "وضح لى", "فسر", "فسرلي", "فسر لى",
    "فهمني", "فهمنى", "عرفها", "explain", "more details", "expand",
]
_REASON = [
    "عرفت ازاي", "فهمت ازاي", "ازاي استنتجت", "إزاي استنتجت",
    "بناء على ايه", "ليه بتقول", "ليه قولت", "why did you", "explain your reasoning",
]
_RESET_KEYS = ["reset", "امسح", "ابدا من جديد", "ابدا من الاول", "new chat"]


def _has(ni, ks):
    return any(k in ni for k in ks)


def stylize(text, ni):
    text = (text or "").strip()
    if not text:
        return text
    p = "" if _STARTER.match(text) else random.choice(_PREF)
    s = random.choice(_SUFF) if not _has(ni, _SHORT) and random.random() < 0.55 else ""
    return "\n\n".join(filter(None, [p, text, s]))


# ── Knowledge & Scoring ──────────────────────────────────────────────

def _load():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "knowledge.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


KB = _load()
_ctx = {}


def _phrases(i):
    return (i.get("patterns") or []) + (i.get("keywords") or []) + [
        i.get("title", ""), i.get("tag", "").replace("_", " ")
    ]


def _score(intent, ni, tset):
    s, matched = 0.0, []
    for p in _phrases(intent):
        np = norm(p)
        if not np:
            continue
        if len(np) >= 3 and np in ni:
            s += 4.0 + 0.25 * np.count(" ")
            matched.append(p)
        else:
            pt = set(toks(np))
            ov = pt & tset
            if ov:
                s += 1.2 * len(ov) / max(1, len(pt))
                matched.extend(sorted(ov))
    return s, list(dict.fromkeys(matched))


def _best(ni, tset):
    scored = sorted(
        [(_score(i, ni, tset), i) for i in KB.get("intents", [])],
        key=lambda x: -x[0][0],
    )
    top5 = [(x[1].get("tag", ""), x[0][0]) for x in scored[:5]]
    if scored and scored[0][0][0] >= 1.4:
        (sc, mt), intent = scored[0]
        return intent, sc, mt, top5
    return None, 0, [], top5


def _pick(intent, ni):
    if _has(ni, _SHORT) and intent.get("responses_short"):
        return random.choice(intent["responses_short"])
    if _has(ni, _LONG) and intent.get("responses_long"):
        return random.choice(intent["responses_long"])
    return random.choice(intent.get("responses", ["..."]))


def _tag(tag):
    return next((i for i in KB.get("intents", []) if i.get("tag") == tag), None)


def _suggest(top5):
    tm = {i.get("tag", ""): i.get("title", i.get("tag", "")) for i in KB.get("intents", []) if i.get("tag")}
    titles = list(dict.fromkeys(tm.get(t) for t, _ in top5 if tm.get(t)))
    if not titles:
        return "\n\nلو تحب، اكتب (مواضيع) علشان تشوف المحاور."
    return f"\n\nغالباً تقصد: {'، '.join(titles[:3])}\nلو تحب القائمة كلها اكتب (مواضيع)."


# ── Bot Response ─────────────────────────────────────────────────────

def get_response(user_input, uid="web"):
    raw = (user_input or "").strip()
    if not raw:
        return {"text": "اكتب سؤالك بس، وأنا معاك.", "image": None}

    ni, tset = norm(raw), set(toks(raw))
    ctx = _ctx.setdefault(uid, {})

    # Reset
    if _has(ni, _RESET_KEYS):
        _ctx[uid] = {}
        ri = _tag("reset")
        t = _pick(ri, ni) if ri else "تمام — بدأنا من جديد. اكتب (مواضيع) علشان تشوف المحاور."
        return {"text": stylize(t, ni), "image": None}

    # Reasoning request
    if _has(ni, _REASON):
        lr = ctx.get("lr")
        if not lr:
            return {"text": stylize("لسه ماعنديش نتيجة سابقة أشرحها. اسألني سؤال في النظم الخبيرة الأول.", ni), "image": None}
        ms = "، ".join(lr.get("m", [])[:10]) or "(مافيش كلمات واضحة)"
        return {
            "text": stylize(
                f"رجّحت إن سؤالك عن: {lr['t']}\n\nالسبب: لقيت كلمات/عبارات مرتبطة بالموضوع داخل سؤالك زي: {ms}\n\nلو ده مش قصدك، اكتب (مواضيع) واختار محور.",
                ni,
            ),
            "image": None,
        }

    found, bsc, matched, top5 = _best(ni, tset)

    # Follow-up on last intent (short/long)
    if not found and ctx.get("lt"):
        li = _tag(ctx["lt"])
        if li and (_has(ni, _SHORT) or _has(ni, _LONG)):
            ctx["lr"] = {"t": li.get("title", li.get("tag")), "m": ["متابعة"] + matched}
            return {"text": stylize(_pick(li, ni), ni), "image": None}

    # Match found
    if found:
        ctx["lt"] = found.get("tag")
        ctx["lr"] = {"t": found.get("title", found.get("tag")), "m": matched}
        return {"text": stylize(_pick(found, ni), ni), "image": found.get("image")}

    # Fallback
    fi = _tag("fallback")
    fb = _pick(fi, ni) if fi else "مش متأكد إني فهمت قصدك."
    return {"text": stylize(fb + _suggest(top5), ni), "image": None}


# ── Routes ───────────────────────────────────────────────────────────

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/chat")
def chat_page():
    return render_template("chat.html")


@app.route("/favicon.ico")
def favicon():
    return send_from_directory(os.path.join(app.root_path, "static/images"), "favicon.png", mimetype="image/png")


@app.route("/get_response", methods=["POST"])
def chat_api():
    msg = request.form.get("msg", "")
    cid = (request.form.get("cid") or "default").strip() or "default"
    uid = f"{request.remote_addr or 'web'}:{cid}"
    return jsonify(get_response(msg, uid))


@app.route("/telegram", methods=["POST"])
def telegram():
    if not TELEGRAM_TOKEN:
        return "OK"
    update = request.get_json()
    if "message" in update and "text" in update["message"]:
        cid = update["message"]["chat"]["id"]
        resp = get_response(update["message"]["text"], str(cid))
        requests.post(TELEGRAM_API + "sendMessage", json={"chat_id": cid, "text": resp["text"]}, timeout=10)
        if resp["image"] and MY_URL:
            requests.post(TELEGRAM_API + "sendPhoto", json={"chat_id": cid, "photo": MY_URL + resp["image"]}, timeout=10)
    return "OK"


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
    app.run(host="0.0.0.0", port=port, debug=debug)