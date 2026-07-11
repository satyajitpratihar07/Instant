import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Initialize App Check (ReCAPTCHA v3)
const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
if (typeof window !== "undefined" && siteKey) {
  console.log("Initializing Firebase App Check...");
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true
    });
    console.log("Firebase App Check initialized successfully!");
  } catch (err) {
    console.error("Firebase App Check initialization failed:", err);
  }
}

// Initialize Realtime Database
export const db = getDatabase(app);
