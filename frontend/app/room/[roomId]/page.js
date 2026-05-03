"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";

const PERSONALITIES = [
  { id: "harsha",     name: "Harsha Mode",      emoji: "🎙️", color: "#c0c0c0", tickerBg: "#0a192f", desc: "Poetic & Enthusiastic" },
  { id: "desi_aunty", name: "Desi Aunty",       emoji: "👵", color: "#ff8c00", tickerBg: "#ff9933", desc: "Funny Hinglish" },
  { id: "bollywood",  name: "Bollywood Mode",   emoji: "🎬", color: "#f4c542", tickerBg: "#ff2a2a", desc: "Cinematic & Epic" },
  { id: "hinglish",   name: "Hinglish Street",  emoji: "🤙", color: "#c77dff", tickerBg: "#4a00e0", desc: "Mass Relatable" },
  { id: "coach",      name: "Coach Mode",       emoji: "📋", color: "#2dd4a8", tickerBg: "#0f3443", desc: "Technical" },
];

const BACKEND    = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
const WS_BACKEND = BACKEND.replace("http", "ws");

const LIVE_STATUS = {
  INACTIVE:   { label: "Camera inactive",              icon: "⏹️", cls: "status-inactive" },
  ACTIVE:     { label: "Camera active — streaming",    icon: "🟢", cls: "status-active" },
  CAPTURING:  { label: "Capturing frame...",            icon: "📸", cls: "status-capturing" },
  GENERATING: { label: "Gemini analyzing frame...",     icon: "🤖", cls: "status-generating" },
  RECEIVED:   { label: "Commentary received",           icon: "✅", cls: "status-received" },
  ERROR:      { label: "Error — retrying next cycle",   icon: "⚠️", cls: "status-error" },
};

const CAPTURE_INTERVAL_MS = 2000;

export default function RoomPage() {
  const { roomId } = useParams();

  const [personality,   setPersonality]   = useState("harsha");
  const [feed,          setFeed]          = useState([]);
  const [viewers,       setViewers]       = useState(1);
  const [copied,        setCopied]        = useState(false);

  const [streamState,   setStreamState]   = useState(null);
  const [tickerQueue,   setTickerQueue]   = useState([]);

  const [liveActive,    setLiveActive]    = useState(false);
  const [liveStatus,    setLiveStatus]    = useState("INACTIVE");
  const [cameraStream,  setCameraStream]  = useState(null);
  const [frameCount,    setFrameCount]    = useState(0);
  const [demoSafeMode,  setDemoSafeMode]  = useState(false);

  const [showUpload,    setShowUpload]    = useState(false);
  const [previewUrl,    setPreviewUrl]    = useState(null);
  const [imageBase64,   setImageBase64]   = useState(null);
  const [videoBase64,   setVideoBase64]   = useState(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadMsg,     setUploadMsg]     = useState("Generating...");

  const feedScrollRef = useRef(null);
  const feedDataRef   = useRef([]);
  
  useEffect(() => { feedDataRef.current = feed; }, [feed]);
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const videoRef      = useRef(null);
  const fallbackVideoRef = useRef(null);
  const canvasRef     = useRef(null);
  const intervalRef   = useRef(null);
  const requestInFlight = useRef(false);

  // WebSockets removed for Vercel Serverless compatibility

  useEffect(() => {
    if (feedScrollRef.current) feedScrollRef.current.scrollTop = feedScrollRef.current.scrollHeight;
  }, [feed]);

  // Live frame capture
  const captureAndSendFrame = useCallback(async () => {
    if (requestInFlight.current) return;
    if (!videoRef.current || !canvasRef.current) return;
    requestInFlight.current = true;
    setLiveStatus("CAPTURING");
    try {
      const canvas = canvasRef.current;
      let video = null;
      if (videoRef.current && videoRef.current.readyState >= 2) video = videoRef.current;
      else if (fallbackVideoRef.current && fallbackVideoRef.current.readyState >= 2) video = fallbackVideoRef.current;
      
      if (!video) return;

      canvas.width  = video.videoWidth  || 640;
      canvas.height = video.videoHeight || 480;
      canvas.getContext("2d").drawImage(video, 0, 0);
      const b64 = canvas.toDataURL("image/jpeg", 0.75).split(",")[1];
      setLiveStatus("GENERATING");
      setFrameCount(prev => prev + 1);
      const req_id = Math.random().toString(36).slice(2, 10);
      const currentP = PERSONALITIES.find(p => p.id === personality);
      setStreamState({ req_id, text: "", personality: currentP.id, name: currentP.name, emoji: currentP.emoji });

      const history_text = feedDataRef.current.slice(-3).map((item, i) => `${i + 1}. ${item.text}`).join("\n");
      
      const res = await fetch(`/api/generate-live-frame`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId, personality, frame_base64: b64, force_demo: demoSafeMode, history_text }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(`HTTP ${res.status}: ${errorData.details || "Unknown error"}`);
      }
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        setStreamState(prev => prev && prev.req_id === req_id ? { ...prev, text: prev.text + chunk } : prev);
      }

      const finalMsg = {
        id: req_id,
        personality: currentP.id,
        personality_name: currentP.name,
        emoji: currentP.emoji,
        text: fullText,
        timestamp: Math.floor(Date.now() / 1000),
      };
      
      setFeed(prev => [...prev, finalMsg]);
      setTickerQueue(prev => [...prev, finalMsg]);
      setStreamState(null);
      
      setTimeout(() => setLiveStatus("ACTIVE"), 500);
    } catch (err) {
      console.error("Live frame error:", err);
      setLiveStatus("ERROR");
      setTimeout(() => setLiveStatus("ACTIVE"), 2000);
    } finally {
      requestInFlight.current = false;
    }
  }, [roomId, personality, demoSafeMode]);

  const startLiveCommentary = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } });
      setCameraStream(stream);
      setLiveActive(true);
      setLiveStatus("ACTIVE");
      setFrameCount(0);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 100);
    } catch { alert("Camera access denied."); }
  };

  useEffect(() => {
    if (videoRef.current && cameraStream) videoRef.current.srcObject = cameraStream;
  }, [cameraStream]);

  useEffect(() => {
    if (liveActive) {
      const warmup = setTimeout(() => captureAndSendFrame(), 1500);
      intervalRef.current = setInterval(() => captureAndSendFrame(), CAPTURE_INTERVAL_MS);
      return () => { clearTimeout(warmup); clearInterval(intervalRef.current); };
    } else { if (intervalRef.current) clearInterval(intervalRef.current); }
  }, [liveActive, captureAndSendFrame]);

  const stopLiveCommentary = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    setCameraStream(null); setLiveActive(false); setLiveStatus("INACTIVE");
    requestInFlight.current = false;
  };

  useEffect(() => { return () => { if (intervalRef.current) clearInterval(intervalRef.current); }; }, []);

  // Upload handlers
  const handleImageFile = (e) => { const f = e.target.files[0]; if (!f) return; setVideoBase64(null); const r = new FileReader(); r.onload = (ev) => { setPreviewUrl(ev.target.result); setImageBase64(ev.target.result.split(",")[1]); }; r.readAsDataURL(f); };
  const handleVideoFile = (e) => { const f = e.target.files[0]; if (!f) return; setImageBase64(null); setPreviewUrl(URL.createObjectURL(f)); const r = new FileReader(); r.onload = (ev) => { setVideoBase64(ev.target.result.split(",")[1]); }; r.readAsDataURL(f); };

  const generateUpload = async () => {
    if (!imageBase64 && !videoBase64) return alert("Upload an image or video first!");
    setUploadLoading(true);
    const isVideo = !!videoBase64;
    setUploadMsg(isVideo ? "Extracting frames..." : "Generating...");
    try {
      const endpoint = isVideo ? "/api/generate-video" : "/api/generate-live-frame";
      const body = isVideo ? { video_base64: videoBase64, personality, room_id: roomId } : { frame_base64: imageBase64, personality, room_id: roomId };
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      
      if (isVideo) {
        const data = await res.json();
        if (!data.success) throw new Error("Failed");
        setFeed(prev => [...prev, data.message]);
        setTickerQueue(prev => [...prev, data.message]);
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
        }
        const currentP = PERSONALITIES.find(p => p.id === personality);
        const finalMsg = {
          id: Math.random().toString(36).slice(2, 10),
          personality: currentP.id,
          personality_name: currentP.name,
          emoji: currentP.emoji,
          text: fullText,
          timestamp: Math.floor(Date.now() / 1000),
        };
        setFeed(prev => [...prev, finalMsg]);
        setTickerQueue(prev => [...prev, finalMsg]);
      }
    } catch { alert("Error — check backend."); }
    finally { setUploadLoading(false); }
  };

  const copyLink = () => { navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const fmtTime = (ts) => { if (!ts) return ""; try { return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch { return ""; } };

  const currentP  = PERSONALITIES.find(p => p.id === personality);
  const statusInfo = LIVE_STATUS[liveStatus] || LIVE_STATUS.INACTIVE;
  const activeTickerItem = tickerQueue.length > 0 ? tickerQueue[tickerQueue.length - 1] : null;
  const activeTickerP = activeTickerItem ? PERSONALITIES.find(p => p.id === activeTickerItem.personality) : currentP;

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <span className="logo-icon">🏏</span>
          <span className="logo-text">Stadium<span className="accent">Sync</span></span>
        </div>
        <div className="header-right">
          <div className="ws-dot connected" title="Edge Active" />
          <span className="viewers">👁 {viewers}</span>
          <button className="share-btn" onClick={copyLink} id="copy-room-link">
            {copied ? "✅ Copied!" : "🔗 Copy Room Link"}
          </button>
        </div>
      </header>

      <div className="room-id-bar">Room <code>{roomId}</code></div>

      <div className="match-strip">
        <p>
          <span className="strip-highlight">LIVE MATCH CENTER</span> — Point your camera at any cricket match for AI commentary
        </p>
      </div>

      <main className="main">
        <div className="left-panel">

          {/* Live Camera Card */}
          <div className="card live-card">
            <h3 className="card-title"><span className="live-badge-dot" /> 📡 Live Camera Commentary</h3>
            <p className="live-subtitle">Point your camera at the match. AI commentary starts automatically.</p>

            {liveActive && (
              <div className="camera-preview live-preview">
                <video ref={videoRef} autoPlay playsInline muted className="video-feed" />
                <div className="live-overlay">
                  <span className="live-rec-badge">● LIVE</span>
                  <span className="live-frame-count">{frameCount} frames</span>
                </div>
                {streamState && (
                  <div className="stream-overlay">
                    <div className="stream-header">{streamState.emoji} {streamState.name} Analyzing...</div>
                    <div className="stream-text">{streamState.text}</div>
                  </div>
                )}
              </div>
            )}

            <div className="status-indicators">
              <div className={`status-badge ${statusInfo.cls}`}>
                <span className="s-icon">{statusInfo.icon}</span>
                {statusInfo.label}
              </div>
            </div>

            <div className="live-actions">
              {!liveActive ? (
                <button className="btn btn-live-start" onClick={startLiveCommentary} id="start-live-commentary">🎙️ Start Live Commentary</button>
              ) : (
                <button className="btn btn-live-stop" onClick={stopLiveCommentary} id="stop-live-commentary">⏹️ Stop Live Commentary</button>
              )}
            </div>

            <label className="demo-toggle" id="demo-safe-mode-toggle">
              <input type="checkbox" checked={demoSafeMode} onChange={() => setDemoSafeMode(!demoSafeMode)} />
              <span className="demo-toggle-slider" />
              <span className="demo-toggle-label">Demo Safe Mode</span>
              <span className="demo-toggle-hint">(Fallback if Gemini fails)</span>
            </label>
          </div>

          {/* Personality */}
          <div className="card">
            <h3 className="card-title">🎭 Commentary Style</h3>
            <div className="personality-grid">
              {PERSONALITIES.map(p => (
                <button key={p.id} className={`personality-btn ${personality === p.id ? "active" : ""}`} style={{ "--p-color": p.color }} onClick={() => setPersonality(p.id)} id={`personality-${p.id}`}>
                  <span className="p-emoji">{p.emoji}</span>
                  <span className="p-name">{p.name}</span>
                  <span className="p-desc">{p.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Upload Fallback */}
          <div className="card upload-fallback-card">
            <button className="upload-fallback-toggle" onClick={() => setShowUpload(!showUpload)} id="toggle-upload-fallback">
              <span>{showUpload ? "▼" : "▶"} 📁 Upload Image/Video (Backup)</span>
            </button>
            {showUpload && (
              <div className="upload-fallback-content">
                <div className="preview-box" onClick={() => imageInputRef.current?.click()}>
                  {previewUrl && imageBase64 && <img src={previewUrl} alt="Preview" className="preview-img" />}
                  {previewUrl && videoBase64 && <video ref={fallbackVideoRef} src={previewUrl} className="preview-img" controls crossOrigin="anonymous" onPlay={() => setLiveActive(true)} onPause={() => setLiveActive(false)} onEnded={() => setLiveActive(false)} />}
                  {!previewUrl && <div className="preview-placeholder"><span>🏟️</span><p>Upload image or video</p></div>}
                </div>
                <div className="upload-actions three">
                  <button className="btn btn-secondary" onClick={() => imageInputRef.current?.click()}>🖼️ Image</button>
                  <button className="btn btn-secondary" onClick={() => videoInputRef.current?.click()}>🎥 Video</button>
                </div>
                <button className={`btn btn-generate ${uploadLoading ? "loading" : ""}`} onClick={generateUpload} disabled={uploadLoading || (!imageBase64 && !videoBase64)} style={{ marginTop: 12 }}>
                  {uploadLoading ? <><span className="spinner" /> {uploadMsg}</> : <>{currentP?.emoji} Generate</>}
                </button>
              </div>
            )}
            <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageFile} style={{ display: "none" }} />
            <input ref={videoInputRef} type="file" accept="video/mp4,video/mov,video/webm" onChange={handleVideoFile} style={{ display: "none" }} />
          </div>

          <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>

        {/* Right Panel — Feed */}
        <div className="right-panel">
          <div className="card feed-card">
            <div className="feed-header">
              <h3 className="card-title">📡 Live Commentary Feed</h3>
              <div className="viewer-count">👁️ {viewers} watching</div>
            </div>
            <div className="feed-list" ref={feedScrollRef}>
              {feed.length === 0 ? (
                <div className="empty-feed">
                  <span className="spinner"></span> Waiting for match events...
                </div>
              ) : (
                feed.map((item, i) => {
                  const p = PERSONALITIES.find(p => p.id === item.personality);
                  return (
                    <div key={item.id || i} className="feed-item" style={{ "--p-color": p?.color || "#22a6ff" }}>
                      <div className="feed-item-header">
                        <span className="feed-emoji">{item.emoji}</span>
                        <span className="feed-name">{item.personality_name}</span>
                        {item.source === "live-camera" && <span className="feed-badge live">📷 LIVE</span>}
                        {item.source === "video" && item.frame_count > 0 && <span className="feed-badge">🎥 {item.frame_count}f</span>}
                        {item.confidence && <span className={`feed-confidence conf-${item.confidence}`}>{item.confidence}</span>}
                        <span className="feed-dot" />
                      </div>
                      {item.scene_summary && <p className="feed-scene">{item.scene_summary}</p>}
                      <p className="feed-text">{item.text}</p>
                      {item.insight && <p className="feed-insight">💡 {item.insight}</p>}
                      {item.timestamp && <p className="feed-time">{fmtTime(item.timestamp)}</p>}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Broadcast Ticker */}
      {activeTickerItem && (
        <div className="broadcast-ticker" style={{ "--ticker-bg": activeTickerP?.tickerBg || "#0a192f", "--ticker-fg": activeTickerP?.color || "#fff" }}>
          <div className="ticker-label">LATEST 📡</div>
          <div className="ticker-content-wrap">
            <div className="ticker-content">
              <span className="ticker-emoji">{activeTickerItem.emoji}</span>
              <span className="ticker-name">{activeTickerItem.personality_name}:</span>
              <span className="ticker-text">{activeTickerItem.text}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
