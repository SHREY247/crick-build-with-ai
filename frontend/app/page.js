"use client";

import { useRouter } from "next/navigation";

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function HomePage() {
  const router = useRouter();
  return (
    <main className="landing">
      <div className="hero-card">
        <h1>Stadium<span>Sync</span></h1>
        <p className="hero-headline">AI Live Commentary Rooms for Cricket Fans</p>
        <p className="hero-sub">
          Point your camera at a live match, choose a commentary personality, and share the AI-powered commentary room with your squad — in near real time.
        </p>
        <button className="primary-cta" onClick={() => router.push(`/room/${makeRoomId()}`)}>
          🎙️ Start Live Commentary Room
        </button>
        <div className="hero-features">
          <div className="hero-feature">
            <span>📷</span>
            <h3>Live Camera Commentary</h3>
            <p>Point your camera at any cricket screen and get AI commentary every few seconds</p>
          </div>
          <div className="hero-feature">
            <span>🎭</span>
            <h3>Multi-Style Personalities</h3>
            <p>Premium Analyst, Desi Aunty, Bollywood Drama, Hinglish Fan, or Coach Mode</p>
          </div>
          <div className="hero-feature">
            <span>🔗</span>
            <h3>Shared Commentary Rooms</h3>
            <p>Share a room link and everyone sees the same live AI commentary feed</p>
          </div>
        </div>
        <p className="hero-pitch">
          Frame-sampled visual reasoning powered by Gemini Vision — no fragile CV tracking, just practical AI commentary.
        </p>
      </div>
    </main>
  );
}
