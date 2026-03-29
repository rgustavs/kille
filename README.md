# Kille Poängräknare

A digital, mobile-first scorecard calculator for the classic Swedish card game **Kille**. It features a vintage-themed interface, a zero-sum scoring engine, automatic calculation of multi-player matches, a stand-by (vilande) system, and persistent game history. 

Designed to be resilient, it works fully offline via a Progressive Web App (PWA) architecture.

## Key Features

- **2-8 Player Matches**: Manage player rosters with avatars and multi-game persistence.
- **Automated Score Logic**: Handles Kille's unique zero-sum "pot" distribution, assigning the pot value to the winner and subtracting exact card values from losing players.
- **Stand-by (Vilande) Mechanics**: Players can sit out during specific rounds, automatically registering a zero score for that round.
- **Offline Capable**: Fully functional without network connectivity. Load it once and keep it on your home screen forever.
- **Game History**: Complete history metrics outlining rounds played, cumulative score progressions, and game lifetime statistics.

## Tech Stack

- **Language**: Vanilla JavaScript (ES6+ Modules)
- **Markup**: HTML5
- **Styling**: Vanilla CSS3 (Custom Properties, Grid/Flexbox)
- **Persistance**: `localStorage`
- **Offline Capabilities**: Service Worker API & Web App Manifest

## Prerequisites

No compilation tools, bundlers, or package managers are strictly required. You only need:
- A modern web browser.
- A basic local development server (to bypass CORS restrictions for ES modules).

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/user/kille-score-calculator.git
cd kille-score-calculator
```

### 2. Start a Local Development Server

Since the app uses native ES modules (`<script type="module">`), opening `index.html` directly from the filesystem (`file://`) will not work due to CORS policies. You must run a local HTTP server:

**Using Node.js (npx/serve):**
```bash
npx serve .
```

**Using Python:**
```bash
python3 -m http.server 8000
```

**Using PHP:**
```bash
php -S localhost:8000
```

### 3. Open in Browser

Open your browser and navigate to the address logged in your terminal (typically `http://localhost:3000` or `http://localhost:8000`).

## Architecture

The project relies on clean separation of concerns without relying on bulky frontend frameworks.

### Directory Structure

```text
├── assets/
│   └── cards/          # Image assets for card definitions
├── css/
│   └── style.css       # Complete design system & custom properties
├── js/
│   ├── app.js          # Global app controller: Navigation, UI updates, DOM events
│   ├── game.js         # State engine and scoring algorithms
│   └── cards.js        # Kille card dictionary (points, names, types)
├── index.html          # Application UI shell
├── manifest.json       # PWA Manifest
└── sw.js               # Service Worker for offline caching
```

### Core Components

**1. Data Persistence (`js/game.js`)**  
Stores player identities and entire game states (arrays of rounds) asynchronously into `localStorage`. 

**2. Scoring Engine (`calculateScoreTable`)**  
A pure functional engine inside `js/game.js` that receives a game object containing raw round input data, and produces a finalized "score table". It maps all standing round states and extracts lifetime total metrics. The scoring relies on Kille's zero-sum dynamic.

**3. State Management & Navigation (`js/app.js`)**  
Follows a simple `navigateTo(screenId)` SPA pattern. Instead of a virtual DOM, it explicitly controls toggling of `.screen.active` CSS classes and delegates event listeners broadly to handle clicks.

**4. PWA Pipeline (`sw.js` & `manifest.json`)**  
Employs a "Cache-First" progressive offline strategy. On installation, all UI core files are downloaded and cached. During subsequent loads, it retrieves files straight from the Service Worker cache, allowing immediate, offline boot-ups.

## Deployment

Since this is a static client-side application without a build step or backend, deployment is remarkably straightforward.

### Vercel / Netlify / Cloudflare Pages

1. Connect your GitHub repository to your preferred hosting provider.
2. Ensure the **Build Command** is empty.
3. Ensure the **Output Directory** is set to the repository root directory (`.`).
4. Simply deploy.

### GitHub Pages

You can directly serve the base directory via GitHub Pages. Ensure you configure it to use the "root" folder of the `main` branch.

### Manual Server/Docker

To host via Nginx or Apache, just put the files in your `public_html/` or `/var/www/html/` directory.

If you prefer a Dockerised approach:
```dockerfile
# Dockerfile
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
```
```bash
docker build -t kille-app .
docker run -p 8080:80 kille-app
```
