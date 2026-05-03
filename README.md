# StadiumSync — AI Live Commentary Rooms for Cricket

Point your camera at a match. StadiumSync turns it into live AI commentary.

> We solve the live commentary problem by sampling frames from a live camera feed and using Gemini Vision to generate shareable, personalized cricket commentary in near real time. Instead of fragile CV tracking, we use practical frame-based visual reasoning and room-based sync.

## Features

- **Live Camera Commentary** — point your camera at a cricket match/screen/projector and get near real-time AI commentary
- Browser-side frame capture every 4 seconds (HTML5 video + canvas)
- Gemini Vision generates context-aware, non-repetitive live commentary
- **5 Commentary Personalities**: Premium Analyst, Desi Aunty, Bollywood Drama, Hinglish Fan, Coach Mode
- **Shared Commentary Rooms** — share a room link and everyone sees the same live feed via WebSocket
- Copy Room Link button for easy sharing
- Demo Safe Mode — high-quality mock commentary if Gemini is unavailable
- Image/video upload fallback mode

## Architecture

```
Camera → Browser (frame capture every 4s) → Base64 JPEG → POST /generate-live-frame
→ Backend (context-aware Gemini Vision prompt with last 3 entries)
→ Commentary JSON → WebSocket broadcast to all room viewers
```

## Run Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export GEMINI_API_KEY=your_key_here
uvicorn main:app --reload --port 8000
```

Health check: http://localhost:8000/health

## Run Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

## Demo Script

1. Start backend on port 8000.
2. Start frontend on port 3000.
3. Open the app and create a commentary room.
4. Click "Start Live Commentary".
5. Allow camera permission.
6. Point the laptop camera at the live cricket screening/projector/phone video.
7. Select Premium Analyst mode first.
8. Switch to Desi Aunty or Bollywood mode for the wow moment.
9. Copy the room link and open it in another tab/device to show shared commentary sync.

## Important

This prototype does not stream full video to the backend. It samples frames from the browser camera every few seconds and sends those frames to Gemini Vision. This makes the demo reliable while still matching the live-camera problem statement.

## API Endpoints

### `POST /generate-live-frame` (Primary)

**Input:**
```json
{
  "room_id": "ABC123",
  "style": "analyst",
  "frame_base64": "<base64 jpeg>",
  "timestamp": "2026-05-03T15:30:00Z",
  "force_demo": false
}
```

**Output:**
```json
{
  "timestamp": "2026-05-03T15:30:00Z",
  "style": "analyst",
  "scene_summary": "Batsman preparing for next delivery",
  "commentary": "The batter has settled into a watchful stance...",
  "insight": "Field placement suggests expecting a drive through covers",
  "confidence": "medium"
}
```

### `POST /generate` (Image upload fallback)
### `POST /generate-video` (Video upload fallback)
### `GET /room/{room_id}/history`
### `WS /ws/{room_id}`

## Submission Pitch

StadiumSync samples frames from a live camera pointed at a cricket match and uses Gemini Vision to generate shareable, personality-driven commentary in near real time.
