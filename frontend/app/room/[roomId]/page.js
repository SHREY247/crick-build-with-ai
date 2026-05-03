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
  const [wsConnected,   setWsConnected]   = useState(false);

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

  const wsRef         = useRef(null);
  const feedRef       = useRef(null);
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const videoRef      = useRef(null);
  const fallbackVideoRef = useRef(null);
  const canvasRef     = useRef(null);
  const intervalRef   = useRef(null);
  const requestInFlight = useRef(false);

  // WebSocket
  useEffect(() => {
    const ws = new WebSocket(`${WS_BACKEND}/ws/${roomId}`);
    wsRef.current = ws;
    ws.onopen  = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if      (msg.type === "history")       { setFeed(msg.data || []); setViewers(msg.viewers || 1); setTickerQueue(msg.data || []); }
      else if (msg.type === "commentary")    { 
        setFeed(prev => [...prev, msg.data]); 
        setTickerQueue(prev => [...prev, msg.data]);
        setStreamState(null);
      }
      else if (msg.type === "viewer_update") { setViewers(msg.viewers); }
      else if (msg.type === "stream_start")  {
        setStreamState({ req_id: msg.req_id, text: "", personality: msg.personality, name: msg.personality_name, emoji: msg.emoji });
      }
      else if (msg.type === "stream_chunk")  {
        setStreamState(prev => prev && prev.req_id === msg.req_id ? { ...prev, text: prev.text + msg.text } : prev);
      }
    };
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, 25000);
    return () => { clearInterval(ping); ws.close(); };
  }, [roomId]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
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
      
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "frame",
          frame_base64: b64,
          personality: personality,
          req_id: Math.random().toString(36).slice(2, 10),
          force_demo: demoSafeMode
        }));
      }
      
      setTimeout(() => setLiveStatus("ACTIVE"), 1500);
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
      const endpoint = isVideo ? "/generate-video" : "/generate";
      const body = isVideo ? { video_base64: videoBase64, personality, room_id: roomId } : { image_base64: imageBase64, personality, room_id: roomId };
      const res = await fetch(`${BACKEND}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.success) throw new Error("Failed");
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
          <div className={`ws-dot ${wsConnected ? "connected" : "disconnected"}`} />
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

            <div className={`live-status-bar ${statusInfo.cls}`}>
              <span className="live-status-icon">{statusInfo.icon}</span>
              <span className="live-status-label">{statusInfo.label}</span>
              {liveActive && <span className="live-status-interval">{CAPTURE_INTERVAL_MS / 1000}s interval</span>}
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
              {feed.length > 0 && <span className="feed-count">{feed.length} entries</span>}
            </div>
            <div className="feed" ref={feedRef}>
              {feed.length === 0 ? (
                <div className="feed-empty">
                  <span>🎙️</span>
                  <p>No commentary yet</p>
                  <p className="feed-empty-sub">Start live camera commentary or upload a frame</p>
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
