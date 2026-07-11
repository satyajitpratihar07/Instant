# 🌐 InstantE2E Chat & Share

InstantE2E is a high-fidelity, serverless-style end-to-end web chat and file-sharing application. It utilizes dynamic QR codes and 6-digit invite codes for zero-setup, instant room pairing, accompanied by robust real-time synchronization.

🚀 **Live Demo:** [https://instant-07.vercel.app](https://instant-07.vercel.app)

---

## ✨ Features

- **⚡ Zero-Setup Pairing**: Scan a generated QR code or enter a 6-digit invite code to connect instantly.
- **📱 Mobile Immersive Fullscreen UX**:
  - Hides global navigation and signatures when inside a chat room to maximize screen estate.
  - Responsive flexbox layout that adapts to keyboard inputs using the `window.visualViewport` API, locking the message bar perfectly at the **head of the keyboard** (no layout offsets or cut-offs).
- **🔒 Ephemeral Data Lifecycles**:
  - Strict zero-persistence model. Real-time data is cleared instantly from the database upon tab close/refresh via background `keepalive` HTTP `DELETE` requests.
  - Optional **5-Hour Keep Alive** toggle to preserve connections for long-running sessions.
- **📂 File Sharing**:
  - Fast file sharing up to 15MB with a responsive drag-and-drop interface.
  - Inline image lightbox preview support.
- **🎨 Premium UI/UX Design**:
  - Neon spotlight ambient blurs, glassmorphism cards, custom toast notifications, and interactive micro-animations.
  - Real-time typing indicators, peer online/offline status, and custom notification sounds for requests, connection approvals, and incoming messages.
- **👥 Multi-Peer Rooms**: Supports both 1-to-1 direct messaging and multi-peer group chat rooms.

---

## 🛠️ Tech Stack

- **Frontend**: [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/)
- **Styling**: [TailwindCSS](https://tailwindcss.com/) + Custom CSS Glassmorphism
- **Database / Signal Service**: [Firebase Realtime Database](https://firebase.google.com/docs/database) (REST & WebSockets)
- **QR Engine**: [qrcode](https://www.npmjs.com/package/qrcode) & [html5-qrcode](https://www.npmjs.com/package/html5-qrcode) (camera scanner)
- **Icons**: [Lucide React](https://lucide.dev/)

---

## 📂 Project Structure

```
├── .vercel/            # Vercel Deployment Link Metadata
├── public/             # Static Assets (Sounds, Favicons)
├── src/
│   ├── components/
│   │   ├── ChatRoom.tsx      # Main Messaging interface & participants sidebar
│   │   ├── Lightbox.tsx      # Fullscreen image viewer
│   │   ├── QrGenerator.tsx   # Premium QR canvas generator card
│   │   ├── QrScanner.tsx     # Camera viewport scanner & manual pair fallback
│   │   └── ...
│   ├── App.tsx         # Root component & central pair coordination logic
│   ├── firebase.ts     # Firebase client SDK initialization config
│   ├── index.css       # Tailwind directives & global style classes
│   ├── types.ts        # TypeScript typings (Session, Peer, Message, etc.)
│   └── utils.ts        # Shared helper scripts (Avatars, sound player, initials)
├── server.ts           # Development mock API server
├── vite.config.ts      # Vite build configurations
└── package.json        # Dependencies & package scripts
```

---

## 🚀 Running Locally

### Prerequisites

- **Node.js** (v18 or higher recommended)
- **npm** (v9 or higher)

### Setup & Installation

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/satyajitpratihar07/instant.git
   cd instant
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Verify Firebase Setup**:
   The app is pre-configured to connect to a default Firebase database instance in `src/firebase.ts`. If you want to use your own Firebase project:
   - Create a Firebase Realtime Database.
   - Replace the `firebaseConfig` object in `src/firebase.ts` with your credentials.
   - Adjust the `dbUrl` strings in `src/App.tsx` if necessary.

4. **Run the App**:
   ```bash
   npm run dev
   ```
   Open your browser and navigate to `http://localhost:5173`.

---

## 🌎 Deployment to Vercel

This project is configured for one-click Vercel deployments.

1. **Install Vercel CLI**:
   ```bash
   npm install -g vercel
   ```

2. **Deploy to Production**:
   ```bash
   vercel --prod
   ```

---

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
