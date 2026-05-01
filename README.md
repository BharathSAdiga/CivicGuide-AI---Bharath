# CivicGuide AI 🏛️

> **Your intelligent assistant for navigating government services, civic duties, and public resources — with AI.**

---

## 📁 Project Structure

```
CivicGuide AI/
├── frontend/
│   ├── index.html          # Main homepage
│   ├── css/
│   │   └── style.css       # Global styles (dark theme, animations)
│   └── js/
│       └── main.js         # Scroll reveal, counters, API ping
│
├── backend/
│   ├── app.py              # Flask app factory (entry point)
│   ├── requirements.txt    # Python dependencies
│   ├── .env.example        # Environment variable template
│   └── routes/
│       ├── __init__.py     # Blueprint registration
│       ├── status.py       # GET /api/status — health check
│       └── civic.py        # POST /api/civic/query, GET /api/civic/services
│
└── README.md
```

---

## 🚀 Getting Started

### 1. Frontend

No build step required. Open in your browser:

```bash
# Option A: Open directly
start frontend/index.html

# Option B: Use a local dev server (e.g., VS Code Live Server)
# or
npx serve frontend
```

---

### 2. Backend

**Prerequisites:** Python 3.10+

```bash
cd backend

# Create virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Copy env template
copy .env.example .env       # Windows
# cp .env.example .env       # macOS/Linux

# Run Flask dev server
python app.py
```

Backend runs at: **http://localhost:5000**

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | Health check |
| `GET` | `/api/civic/services` | List civic service categories |
| `POST` | `/api/civic/query` | Submit a civic query |

### Example — POST `/api/civic/query`

**Request:**
```json
{
  "question": "How do I renew my voter ID?",
  "location": "Karnataka"
}
```

**Response:**
```json
{
  "question": "How do I renew my voter ID?",
  "location": "Karnataka",
  "answer": "...",
  "sources": [],
  "next_steps": ["..."]
}
```

---

## 🗺️ Roadmap

- [ ] AI/RAG pipeline integration (LLM + vector store)
- [ ] User authentication
- [ ] Personalised civic reminders
- [ ] Multilingual support (Hindi, Kannada, Tamil, ...)
- [ ] Mobile-first PWA
- [ ] Government API integrations

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, Vanilla CSS, JavaScript (ES2022) |
| Backend | Python 3.10+, Flask 3, Flask-CORS |
| AI (planned) | LangChain / OpenAI / Gemini |
| Deployment (planned) | Vercel (frontend) + Render / Railway (backend) |

---

## 📜 License

MIT © 2025 CivicGuide AI
