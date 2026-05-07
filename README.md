# Expert Systems Chatbot (Flask)

شات بوت تعليمي لمادة **النظم الخبيرة (Expert Systems)** — بواجهة ويب + صفحة شات كاملة فيها هيستوري (زي GPT) وحفظ للمحادثات على المتصفح.

## تشغيل محلي (Windows)

1) أنشئ بيئة افتراضية وثبّت المتطلبات:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

2) شغّل السيرفر:

```bash
python app.py
```

3) افتح:
- الصفحة الرئيسية: `http://127.0.0.1:5000/`
- صفحة الشات: `http://127.0.0.1:5000/chat`

## المتغيرات البيئية (اختياري)
انسخ `.env.example` إلى `.env` وعدّل القيم حسب احتياجك.

- `TELEGRAM_TOKEN`: لو هتشغل Webhook تيليجرام.
- `MY_WEBSITE_URL`: رابط موقعك العام (لو محتاج إرسال صور في تيليجرام كرابط كامل).

## ملاحظة مهمة عن GitHub Pages
GitHub Pages **بيشغّل ملفات Static فقط (HTML/CSS/JS)** ومش بيشغّل Flask/Python.
لو هدفك “لينك شغال” للـFlask، استخدم منصة Hosting زي Render / Railway / Heroku.

## Deploy (عام) من GitHub على Render (مقترح)
1) ارفع المشروع على GitHub.
2) على Render: New → Web Service → اربط الريبو.
3) Build Command:

```bash
pip install -r requirements.txt
```

4) Start Command:

```bash
gunicorn app:app
```

5) (اختياري) ضيف Environment Variables:
- `MY_WEBSITE_URL=https://YOUR-RENDER-URL`

## Git أوامر سريعة

```bash
git status
git add .
git commit -m "Prepare for deployment"
git push
```

لو هتغير الريبو على GitHub:

```bash
git remote set-url origin https://github.com/USERNAME/REPO.git
git push -u origin main
```
