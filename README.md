<div align="center">

<img src="https://img.shields.io/badge/Powered%20by-Gemini%202.5%20Flash-4285F4?style=for-the-badge&logo=google&logoColor=white" />
<img src="https://img.shields.io/badge/Backend-Flask%203.0-000000?style=for-the-badge&logo=flask&logoColor=white" />
<img src="https://img.shields.io/badge/Frontend-Vanilla%20JS%20%7C%20ES%20Modules-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" />
<img src="https://img.shields.io/badge/Status-Production%20Ready-22c55e?style=for-the-badge" />

<br/><br/>

# 🏛️ CivicGuide AI

### *Your AI-powered companion for India's democratic process*

**CivicGuide AI** helps every Indian citizen — from first-time voters to seasoned participants —  
navigate elections, check eligibility, explore timelines, and find their polling booth,  
all in one beautifully designed, offline-resilient platform.

<br/>

[🚀 Live Demo](#-getting-started) · [📖 Docs](#-architecture) · [🐛 Issues](https://github.com/BharathSAdiga/CivicGuide-AI---Bharath/issues) · [⭐ Star this repo](https://github.com/BharathSAdiga/CivicGuide-AI---Bharath)

</div>

---

## 📌 Problem Statement

India conducts the world's largest democratic elections — yet millions of eligible citizens remain **confused, uninformed, or excluded** from the process.

| Challenge | Reality |
|-----------|---------|
| 🗓️ Complex multi-phase timelines | Lok Sabha elections span 7 phases over 6 weeks |
| 📋 Opaque registration process | First-time voters struggle to navigate Form 6 and NVSP |
| 🏫 Unknown polling booth locations | Voters often don't know where or how to find their booth |
| 🌐 Language barriers | Civic information is largely English-only |
| ❓ Eligibility confusion | NRIs, youth, and new citizens are unsure of their voting rights |

> **There is no single, conversational, AI-powered platform** that answers civic questions in plain language, checks eligibility instantly, and guides citizens step-by-step through the entire election process.

---

## 💡 Solution Overview

**CivicGuide AI** is a full-stack civic assistant that combines a **Gemini 2.5 Flash AI chatbot** with purpose-built tools for voter eligibility checking, election timeline exploration, and nearest polling booth discovery.

```
Ask a question → Get a structured, personalised answer → Take action
```

The platform is designed around three principles:
- **Accessible** — beginner-friendly language, bilingual (EN/हि), works offline
- **Trustworthy** — grounded in ECI guidelines, never guesses
- **Instant** — no signup, no waiting; results appear in seconds

---

## ✨ Features

### 🤖 AI Election Assistant (`/chat`)
- Conversational chatbot powered by **Gemini 2.5 Flash**
- **Decision-based routing** — detects eligibility questions, vague queries, and how-to-vote intent before calling the AI
- **Personalised responses** — adapts to user's name, age, and location (Bengaluru → gets Bengaluru-specific guidance)
- **Bilingual** — toggle between English and Hindi (हिन्दी) mid-conversation
- **Conversation history** — multi-turn context maintained, capped at 20 turns to control token usage
- **Character counter** — warns at 80%, blocks at 1,000 characters
- **Quick Topics** — one-click prompts for common questions
- **Suggestion chips** — contextual chips on the welcome screen

### ✅ Voter Eligibility Checker (`/eligibility`)
- Instant eligibility check: age + citizenship → result in < 1 second
- **4 distinct result states**: Eligible · Under-age · Non-citizen · Both ineligible
- Pass/Fail badges for each criterion
- Personalised next-steps list with links to voters.eci.gov.in
- Client-side fallback — fully functional even when backend is offline

### 📅 Election Timeline (`/timeline`)
- Interactive 8-phase accordion timeline for 4 election types:
  `Lok Sabha` · `State Assembly` · `Rajya Sabha` · `Local Body`
- Colour-coded progress bar with phase markers
- Each phase includes: offset label, duration, key activities, citizen action
- **Google Calendar reminder** button — pre-fills Voting Day event
- Scroll-reveal animations via IntersectionObserver

### 🗺️ Polling Booth Finder (`/booths`)
- Google Maps integration with dark map theme
- **GPS geolocation** — "Use My Current Location"
- **Text search** with Google Places autocomplete (India-restricted)
- Haversine distance sorting — shows 3 nearest booths
- Loading skeleton animation while fetching
- Offline fallback with 5 major-city booths

### 🔒 System Reliability
- Global JSON error handlers (400 / 404 / 405 / 413 / 429 / 500)
- 1 MB request payload cap
- **Toast notifications** — non-blocking slide-in alerts for every error state
- Automatic retry with 1s backoff on network failures
- `isLoading` / `isSearching` guards prevent duplicate API calls
- Backend connection ping on page load

---

## 🛠️ Tech Stack

### Backend
| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | **Flask 3.0** | Lightweight WSGI web framework |
| AI | **Google Gemini 2.5 Flash** (`google-genai`) | Natural language understanding & generation |
| CORS | **Flask-CORS 4.0** | Cross-origin request handling |
| Config | **python-dotenv** | Environment variable management |
| Server | **Gunicorn** | Production WSGI server |

### Frontend
| Layer | Technology | Purpose |
|-------|-----------|---------|
| Structure | **Semantic HTML5** | Accessible markup |
| Styling | **Vanilla CSS** with CSS variables | Design tokens, glassmorphism, animations |
| Logic | **ES Modules (Vanilla JS)** | Modular, zero-dependency frontend |
| Maps | **Google Maps JS API** | Interactive map + Places autocomplete |
| Fonts | **Inter + Outfit** (Google Fonts) | Premium typography |

### Architecture & Design Patterns
| Pattern | Where Used |
|---------|-----------|
| Application Factory | `app.py` — `create_app()` for testability |
| Blueprint Registry | `routes/__init__.py` — modular URL namespacing |
| Singleton Client | `chat.py` — one Gemini client per process |
| Shared API Module | `api.js` — single source for all `fetch()` calls |
| Offline Fallback | All frontend modules — works without backend |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        BROWSER                              │
│                                                             │
│  index.html   chat.html   eligibility.html   timeline.html  │
│  booths.html                                                │
│       │                                                     │
│  ┌────▼──────────────────────────────────────────────┐      │
│  │              frontend/js/  (ES Modules)            │      │
│  │                                                    │      │
│  │  api.js ──── Shared fetch client (retry, timeout) │      │
│  │  toast.js ── Notification system                  │      │
│  │  chat.js     eligibility.js   timeline.js          │      │
│  │  booths.js   calendar.js                          │      │
│  └────────────────────────┬───────────────────────────┘      │
└───────────────────────────┼─────────────────────────────────┘
                            │ HTTP/JSON  (port 5000)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     FLASK BACKEND                           │
│                                                             │
│  app.py (create_app)                                        │
│  ├── config.py  ── All env vars & constants                 │
│  ├── utils.py   ── success_response / error_response        │
│  └── routes/                                                │
│      ├── chat.py        POST /api/chat                      │
│      ├── eligibility.py POST /api/eligibility               │
│      ├── booths.py      POST /api/booths/nearest            │
│      ├── timeline.py    GET  /api/timeline                  │
│      └── status.py      GET  /api/status                    │
│                                                             │
│                            │                                │
│                            ▼                                │
│              Google Gemini 2.5 Flash API                    │
└─────────────────────────────────────────────────────────────┘
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | Health check — returns version and uptime |
| `POST` | `/api/chat` | Send a message; returns Gemini AI response |
| `POST` | `/api/eligibility` | Check voter eligibility by age + citizenship |
| `POST` | `/api/booths/nearest` | Get 3 nearest booths by lat/lng |
| `GET` | `/api/timeline` | Fetch election phases by type |

---

## 📸 Screenshots

> *The application running locally at `http://127.0.0.1:5500`*

### 🏠 Home Page
Dark glassmorphism hero with gradient headline, feature cards, and statistics strip.

### 🤖 Chat Assistant
Sidebar with user profile, eligibility badge, and quick topics.
AI responses are structured with bold headers, numbered steps, and bullet points.
Personalised: "Hi Bharath! You're eligible to vote! Ask about registration, polling day, and more."

### ✅ Eligibility Checker
Two-column layout: form on the left, instant result card on the right.
Result shows: verdict icon, pass/fail badges, explanation paragraph, and numbered next steps.

### 📅 Election Timeline
Four election type tabs, colour-coded 8-segment progress bar, accordion phase cards.
Each card expands to show: offset label, duration, key activities, and citizen action.

### 🗺️ Polling Booth Finder
Side panel with location search + GPS button alongside a full-height dark Google Map.
Numbered markers drop onto the map; clicking a result card pans the map to that booth.

---

## 🚀 Getting Started

### Prerequisites
- Python 3.10+
- A [Gemini API key](https://aistudio.google.com/apikey) (free tier: 15 req/min)
- A [Google Maps API key](https://console.cloud.google.com/) (optional — for booth map)

### 1. Clone the repository
```bash
git clone https://github.com/BharathSAdiga/CivicGuide-AI---Bharath.git
cd CivicGuide-AI---Bharath
```

### 2. Set up the backend
```bash
cd backend
pip install -r requirements.txt
```

### 3. Configure environment variables
```bash
# Create backend/.env
cp .env.example .env
```

Edit `backend/.env`:
```env
GEMINI_API_KEY=your-gemini-api-key-here
GEMINI_MODEL=gemini-2.5-flash
FLASK_DEBUG=1
```

### 4. Start the Flask backend
```bash
python app.py
# → Running on http://127.0.0.1:5000
```

### 5. Serve the frontend
```bash
# From the project root:
python -m http.server 5500 --directory frontend
# → Running on http://127.0.0.1:5500
```

### 6. Open the app
| Page | URL |
|------|-----|
| Home | http://127.0.0.1:5500 |
| Chat | http://127.0.0.1:5500/chat.html |
| Eligibility | http://127.0.0.1:5500/eligibility.html |
| Timeline | http://127.0.0.1:5500/timeline.html |
| Booths | http://127.0.0.1:5500/booths.html |
| API Status | http://127.0.0.1:5000/api/status |

---

## 📁 Project Structure

```
CivicGuide AI/
│
├── backend/
│   ├── app.py              # Application factory + global error handlers
│   ├── config.py           # Centralised env vars & constants
│   ├── utils.py            # Shared JSON response helpers
│   ├── requirements.txt    # Python dependencies
│   ├── .env                # 🔒 API keys (not committed)
│   ├── .env.example        # Template for new developers
│   └── routes/
│       ├── __init__.py     # Blueprint registry
│       ├── chat.py         # Gemini AI chat endpoint
│       ├── eligibility.py  # Voter eligibility logic
│       ├── booths.py       # Nearest booth finder (Haversine)
│       ├── timeline.py     # Election phase data
│       └── status.py       # Health check
│
└── frontend/
    ├── index.html          # Landing page
    ├── chat.html           # Chat assistant
    ├── eligibility.html    # Eligibility checker
    ├── timeline.html       # Election timeline
    ├── booths.html         # Polling booth finder
    ├── css/
    │   ├── index.css
    │   ├── chat.css
    │   ├── eligibility.css
    │   ├── timeline.css
    │   └── booths.css
    └── js/
        ├── api.js          # Shared API client (retry, timeout, classify)
        ├── toast.js        # Toast notification system
        ├── chat.js         # Chat logic + char counter + markdown renderer
        ├── eligibility.js  # Eligibility form + client fallback
        ├── timeline.js     # Timeline accordion + scroll reveal
        ├── booths.js       # Maps + geocoding + booth fetching
        └── calendar.js     # Google Calendar reminder builder
```

---

## 🔮 Future Scope

| Feature | Description | Priority |
|---------|-------------|----------|
| 🗃️ **Live Booth Database** | Replace mock data with a PostGIS/PostgreSQL database fed by ECI's official voter portal API | High |
| 🔐 **Rate Limiting** | Add `Flask-Limiter` on `/api/chat` to prevent Gemini API exhaustion (e.g., 10 req/min per IP) | High |
| 📱 **Progressive Web App** | Add `manifest.json` + service worker for offline-first mobile installation | Medium |
| 🌐 **More Languages** | Extend beyond English/Hindi to Tamil, Telugu, Kannada, Bengali, Marathi | Medium |
| 📊 **Analytics Dashboard** | Request latency logging, error tracking, and usage heatmaps via middleware | Medium |
| 🔔 **Election Reminders** | Push notification system for election day reminders (Web Push API) | Medium |
| 🤳 **Voice Input** | Web Speech API integration for accessibility and hands-free queries | Low |
| 🗺️ **Real-Time Queue Data** | Live booth occupancy data via ECI APIs to help voters avoid peak hours | Low |
| 🧪 **Test Suite** | Pytest unit tests for all routes + Playwright end-to-end tests for frontend flows | Medium |
| 🐳 **Dockerisation** | `Dockerfile` + `docker-compose.yml` for one-command deployment | Medium |

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit your changes: `git commit -m "feat: add your feature"`
4. Push to the branch: `git push origin feat/your-feature`
5. Open a Pull Request

Please follow the existing code style — JSDoc on all JS functions, docstrings on all Python functions, and use `config.py` for any new constants.

---

## 📄 License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgements

| Resource | Use |
|----------|-----|
| [Election Commission of India](https://eci.gov.in) | Official election data and guidelines |
| [Google Gemini](https://deepmind.google/technologies/gemini/) | AI language model |
| [Google Maps Platform](https://mapsplatform.google.com/) | Geocoding and mapping |
| [National Voter Service Portal](https://voters.eci.gov.in) | Voter registration reference |
| [Inter & Outfit fonts](https://fonts.google.com) | Typography |

---

<div align="center">

Built with ❤️ to empower India's democracy

**[⬆ Back to top](#%EF%B8%8F-civicguide-ai)**

</div>
