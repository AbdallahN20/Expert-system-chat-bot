(function () {
    const AR_DIACRITICS_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
    const PUNCT_RE = /[^\w\s\u0600-\u06FF-]/g;

    const STOPWORDS_AR = new Set([
        "في", "من", "على", "الى", "إلى", "عن", "مع", "هو", "هي", "انا", "أنا", "انت", "أنت",
        "انتي", "إنتي", "احنا", "نحن", "ده", "دي", "دا", "دول", "ايه", "إيه", "يعني", "ممكن", "لو",
        "please", "pls",
    ]);

    const STOPWORDS_EN = new Set([
        "the", "a", "an", "is", "are", "was", "were", "what", "why", "how", "tell", "me", "about", "please",
    ]);

    const TONE_PREFIXES = [
        "تمام، خلّينا نفهمها سوا:",
        "بص يا صاحبي:",
        "حلو، ركّز معايا:",
        "ماشي، تعال نقولها ببساطة:",
        "طيب، خلّيني أرتّبهالك:",
    ];

    const TONE_SUFFIXES = [
        "تحب مثال سريع؟",
        "لو عايزها مختصر اكتب (مختصر)، ولو بالتفصيل اكتب (بالتفصيل).",
        "لو في نقطة مش واضحة قولي وأنا أوضحها.",
    ];

    const CTX_STORAGE_KEY = "es_chat_ctx_v1";

    let knowledgeCache = null;
    let knowledgePromise = null;

    function normalizeArabic(text) {
        let t = String(text || "");
        t = t.replace(AR_DIACRITICS_RE, "");
        t = t.replace(/أ/g, "ا").replace(/إ/g, "ا").replace(/آ/g, "ا");
        t = t.replace(/ى/g, "ي").replace(/ة/g, "ه");
        t = t.replace(/ؤ/g, "و").replace(/ئ/g, "ي");
        t = t.replace(/ـ/g, "");
        return t;
    }

    function normalizeText(text) {
        let t = String(text || "").trim().toLowerCase();
        t = normalizeArabic(t);
        t = t.replace(PUNCT_RE, " ");
        t = t.replace(/\s+/g, " ").trim();
        return t;
    }

    function tokenize(text) {
        const norm = normalizeText(text);
        if (!norm) return [];

        const raw = norm.split(" ").filter(Boolean);
        const out = [];

        for (const token of raw) {
            if (STOPWORDS_AR.has(token) || STOPWORDS_EN.has(token)) continue;
            if (token.length <= 1) continue;

            out.push(token);

            if (token.startsWith("ال") && token.length > 3) {
                const stripped = token.slice(2);
                if (stripped.length >= 3 && !STOPWORDS_AR.has(stripped) && !STOPWORDS_EN.has(stripped)) {
                    out.push(stripped);
                }
            }
        }

        return out;
    }

    function wantsShort(normInput) {
        return ["مختصر", "تلخيص", "الخلاصه", "باختصار", "summary", "short"].some((k) => normInput.includes(k));
    }

    function wantsLong(normInput) {
        return [
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
        ].some((k) => normInput.includes(k));
    }

    function isReasoningRequest(normInput) {
        const cues = [
            "عرفت ازاي",
            "فهمت ازاي",
            "ازاي استنتجت",
            "إزاي استنتجت",
            "بناء على ايه",
            "ليه بتقول",
            "ليه قولت",
            "why did you",
            "explain your reasoning",
        ];
        return cues.some((c) => normInput.includes(c));
    }

    function intentPhrases(intent) {
        const phrases = [];
        if (Array.isArray(intent.patterns)) phrases.push(...intent.patterns);
        if (Array.isArray(intent.keywords)) phrases.push(...intent.keywords);
        if (intent.title) phrases.push(String(intent.title));
        if (intent.tag) phrases.push(String(intent.tag).replace(/_/g, " "));
        return phrases;
    }

    function scoreIntent(intent, normInput, inputTokens) {
        let score = 0;
        const matched = [];
        const tokenSet = new Set(inputTokens);

        for (const phrase of intentPhrases(intent)) {
            const normPhrase = normalizeText(String(phrase));
            if (!normPhrase) continue;

            if (normPhrase.length >= 3 && normInput.includes(normPhrase)) {
                score += 4.0 + 0.25 * normPhrase.split(" ").length;
                matched.push(String(phrase));
                continue;
            }

            const phraseTokens = new Set(tokenize(normPhrase));
            if (phraseTokens.size === 0) continue;

            let overlapCount = 0;
            for (const t of phraseTokens) {
                if (tokenSet.has(t)) overlapCount += 1;
            }

            if (overlapCount > 0) {
                score += 1.2 * (overlapCount / Math.max(1, phraseTokens.size));
                for (const t of phraseTokens) {
                    if (tokenSet.has(t)) matched.push(t);
                }
            }
        }

        const uniq = [];
        const seen = new Set();
        for (const m of matched) {
            if (seen.has(m)) continue;
            seen.add(m);
            uniq.push(m);
        }

        return { score, matched: uniq };
    }

    function findBestIntent(normInput, inputTokens, knowledge) {
        const intents = Array.isArray(knowledge.intents) ? knowledge.intents : [];
        const scored = intents.map((intent) => {
            const res = scoreIntent(intent, normInput, inputTokens);
            return { intent, score: res.score, matched: res.matched };
        });

        scored.sort((a, b) => b.score - a.score);

        const topDebug = scored.slice(0, 5).map((x) => [String(x.intent.tag || ""), Number(x.score || 0)]);
        if (scored.length === 0) {
            return { intent: null, score: 0, matched: [], topDebug };
        }

        return { intent: scored[0].intent, score: Number(scored[0].score), matched: scored[0].matched, topDebug };
    }

    function pickResponse(intent, normInput) {
        if (!intent) return "";

        const short = wantsShort(normInput);
        const long = wantsLong(normInput);

        const rs = Array.isArray(intent.responses_short) ? intent.responses_short : null;
        const rl = Array.isArray(intent.responses_long) ? intent.responses_long : null;
        const r = Array.isArray(intent.responses) ? intent.responses : ["..."];

        if (short && rs && rs.length) return rs[Math.floor(Math.random() * rs.length)];
        if (long && rl && rl.length) return rl[Math.floor(Math.random() * rl.length)];
        return r[Math.floor(Math.random() * r.length)];
    }

    function stylizeResponse(text, intentTag, normInput) {
        const t = String(text || "").trim();
        if (!t) return t;

        const starterTokens = [
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
        ];

        let prefix = "";
        if (!starterTokens.some((s) => t.startsWith(s))) {
            prefix = TONE_PREFIXES[Math.floor(Math.random() * TONE_PREFIXES.length)];
        }

        let addSuffix = true;
        if (wantsShort(normInput)) addSuffix = false;
        else addSuffix = Math.random() < 0.55;

        const suffix = addSuffix ? TONE_SUFFIXES[Math.floor(Math.random() * TONE_SUFFIXES.length)] : "";

        const parts = [];
        if (prefix) parts.push(prefix);
        parts.push(t);
        if (suffix) parts.push(suffix);

        return parts.join("\n\n").trim();
    }

    function getIntentByTag(knowledge, tag) {
        const intents = Array.isArray(knowledge.intents) ? knowledge.intents : [];
        return intents.find((i) => String(i.tag || "") === String(tag || "")) || null;
    }

    function loadCtxStore() {
        const raw = localStorage.getItem(CTX_STORAGE_KEY);
        if (!raw) return {};
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") return parsed;
        } catch {
            return {};
        }
        return {};
    }

    function saveCtxStore(store) {
        localStorage.setItem(CTX_STORAGE_KEY, JSON.stringify(store || {}));
    }

    function getCtx(cid) {
        const store = loadCtxStore();
        return store[cid] || {};
    }

    function setCtx(cid, ctx) {
        const store = loadCtxStore();
        store[cid] = ctx || {};
        saveCtxStore(store);
    }

    function resetCtx(cid) {
        const store = loadCtxStore();
        delete store[cid];
        saveCtxStore(store);
    }

    function formatSuggestions(knowledge, topDebug) {
        if (!Array.isArray(topDebug) || topDebug.length === 0) {
            return "\n\nلو تحب، اكتب (مواضيع) علشان تشوف المحاور.";
        }

        const tagToTitle = {};
        for (const intent of knowledge.intents || []) {
            const tag = String(intent.tag || "").trim();
            if (!tag) continue;
            tagToTitle[tag] = String(intent.title || tag);
        }

        const suggestions = [];
        for (const pair of topDebug) {
            const tag = pair && pair[0] ? String(pair[0]) : "";
            const title = tagToTitle[tag];
            if (!title) continue;
            if (suggestions.includes(title)) continue;
            suggestions.push(title);
        }

        if (suggestions.length === 0) {
            return "\n\nلو تحب، اكتب (مواضيع) علشان تشوف المحاور.";
        }

        return `\n\nغالباً تقصد: ${suggestions.slice(0, 3).join("، ")}\nلو تحب القائمة كلها اكتب (مواضيع).`;
    }

    async function loadKnowledge() {
        if (knowledgeCache) return knowledgeCache;
        if (knowledgePromise) return knowledgePromise;

        const url = window.__ES_KNOWLEDGE_URL || "knowledge.json";
        knowledgePromise = fetch(url)
            .then((r) => {
                if (!r.ok) throw new Error("Failed to load knowledge");
                return r.json();
            })
            .then((data) => {
                knowledgeCache = data;
                return knowledgeCache;
            })
            .catch(() => {
                knowledgeCache = { intents: [] };
                return knowledgeCache;
            });

        return knowledgePromise;
    }

    async function getResponse({ message, cid }) {
        const raw = String(message || "").trim();
        const chatId = String(cid || "default").trim() || "default";

        if (!raw) {
            return { text: "اكتب سؤالك بس، وأنا معاك.", image: null };
        }

        const knowledge = await loadKnowledge();
        const normInput = normalizeText(raw);
        const inputTokens = tokenize(normInput);

        const ctx = getCtx(chatId);

        const isReset = ["reset", "امسح", "ابدأ من جديد", "ابدأ من الاول", "new chat"].some((p) => normInput.includes(p));
        if (isReset) {
            resetCtx(chatId);
            const resetIntent = getIntentByTag(knowledge, "reset");
            const base = resetIntent ? pickResponse(resetIntent, normInput) : "تمام — بدأنا من جديد. اكتب (مواضيع) علشان تشوف المحاور.";
            return { text: stylizeResponse(base, "reset", normInput), image: null };
        }

        if (isReasoningRequest(normInput)) {
            const last = ctx.last_reasoning;
            if (!last) {
                return {
                    text: stylizeResponse("لسه ماعنديش نتيجة سابقة أشرحها. اسألني سؤال في النظم الخبيرة الأول.", "reasoning", normInput),
                    image: null,
                };
            }

            const lastTitle = last.intent_title || last.intent_tag || "";
            const matched = Array.isArray(last.matched) ? last.matched : [];
            const matchedStr = matched.length ? matched.slice(0, 10).join("، ") : "(مافيش كلمات واضحة)";

            const base = `رجّحت إن سؤالك عن: ${lastTitle}\n\nالسبب: لقيت كلمات/عبارات مرتبطة بالموضوع داخل سؤالك زي: ${matchedStr}\n\nلو ده مش قصدك، اكتب (مواضيع) واختار محور.`;
            return { text: stylizeResponse(base, "reasoning", normInput), image: null };
        }

        const best = findBestIntent(normInput, inputTokens, knowledge);

        const MIN_SCORE = 1.4;

        const followUp = (best.intent == null || best.score < MIN_SCORE) && ctx.last_intent_tag && (wantsShort(normInput) || wantsLong(normInput));
        if (followUp) {
            const lastIntent = getIntentByTag(knowledge, ctx.last_intent_tag);
            if (lastIntent) {
                const base = pickResponse(lastIntent, normInput);
                ctx.last_reasoning = {
                    intent_tag: String(lastIntent.tag || ""),
                    intent_title: String(lastIntent.title || lastIntent.tag || ""),
                    matched: ["متابعة"].concat(best.matched || []),
                    score: best.score,
                };
                setCtx(chatId, ctx);
                return { text: stylizeResponse(base, String(lastIntent.tag || ""), normInput), image: null };
            }
        }

        if (best.intent && best.score >= MIN_SCORE) {
            const base = pickResponse(best.intent, normInput);

            ctx.last_intent_tag = String(best.intent.tag || "");
            ctx.last_reasoning = {
                intent_tag: String(best.intent.tag || ""),
                intent_title: String(best.intent.title || best.intent.tag || ""),
                matched: best.matched || [],
                score: best.score,
            };
            setCtx(chatId, ctx);

            return { text: stylizeResponse(base, String(best.intent.tag || ""), normInput), image: best.intent.image || null };
        }

        const fallbackIntent = getIntentByTag(knowledge, "fallback");
        const baseFallback = fallbackIntent ? pickResponse(fallbackIntent, normInput) : "بص يا معلم، مش ماسك قصدك قوي.";
        const suggestions = formatSuggestions(knowledge, best.topDebug);

        return { text: stylizeResponse(baseFallback + suggestions, "fallback", normInput), image: null };
    }

    window.ESChatEngine = {
        loadKnowledge,
        getResponse,
        resetCtx,
    };
})();
