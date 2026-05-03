import base64
import json
import asyncio
import os
import tempfile
import time
import uuid
from collections import defaultdict
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

try:
    import cv2
    CV2_AVAILABLE = True
except Exception:
    CV2_AVAILABLE = False

try:
    import google.generativeai as genai
except Exception:
    genai = None

app = FastAPI(title="StadiumSync API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
if genai and GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(os.getenv("GEMINI_MODEL", "gemini-1.5-flash"))
else:
    model = None

rooms: dict[str, list[WebSocket]] = defaultdict(list)
room_history: dict[str, list[dict]] = defaultdict(list)

PERSONALITIES = {
    "harsha": {
        "name": "Harsha Mode",
        "emoji": "🎙️",
        "prompt": "Style: Poetic, enthusiastic cricket broadcast legend. Explicitly use metaphors like 'the corridors of uncertainty', 'painting a canvas on the green', or 'a gentle caress of the ball'. Focus on the romance of the game.",
    },
    "desi_aunty": {
        "name": "Desi Aunty",
        "emoji": "👵",
        "prompt": "Style: Indian family watch-party energy. Clean Hinglish. Mandate: You MUST include at least one mention of 'chai', 'samosa', or make a judgmental comment about a player's haircut. Playful and emotional.",
    },
    "bollywood": {
        "name": "Bollywood Mode",
        "emoji": "🎬",
        "prompt": "Style: cinematic Indian movie trailer energy. Dramatic, high-stakes, over-the-top. Every ball is destiny.",
    },
    "hinglish": {
        "name": "Hinglish Street",
        "emoji": "🤙",
        "prompt": "Style: casual Indian cricket fan in natural Hinglish. Short, punchy, stadium vibe.",
    },
    "coach": {
        "name": "Coach Mode",
        "emoji": "📋",
        "prompt": "Style: serious cricket coach. Mandate: You MUST end every 2 sentences with a 'Technical Cue' such as 'Watch the backlift', 'Footwork is lazy', or 'Keep the head still'. Focus on technique.",
    },
}

MOCK_TEXT = {
    "harsha": "The frame suggests a tense match moment — the batter is reading the field carefully before committing. The key question is whether the bowler can hold a disciplined line and force a low-risk shot. From a tactical lens, this is exactly where pressure creates mistakes.",
    "desi_aunty": "Arre wah, full match ka mahaul ban gaya! Batter bilkul shaadi ke buffet line jaise ready khada hai — bas sahi ball ka wait hai. Ab agar shot connect ho gaya na, poori family drawing room mein commentary start kar degi!",
    "bollywood": "The stadium becomes a battlefield, the bat becomes destiny, and every ball feels like the final scene before interval. One perfect connection and this ordinary moment turns into a hero entry shot.",
    "hinglish": "Scene set hai boss! Batter wait kar raha hai ek proper loose ball ka, aur crowd ka vibe bhi full on hai. Agar timing lag gayi toh seedha highlights package material!",
    "coach": "The batter should stay balanced and avoid committing too early. Key technical cue: head position over the ball and a stable base. If the bowler keeps the line tight, shot selection becomes the deciding factor.",
}

MOCK_LIVE_ENTRIES = {
    "harsha": [
        {"scene_summary": "Batsman at the crease, preparing for the next delivery.", "commentary": "The batter has settled into a watchful stance — weight nicely balanced, eyes tracking the bowler's run-up. This is a moment of quiet intensity, the kind that often precedes a decisive stroke.", "insight": "The field placement suggests the bowling side is expecting a drive through covers.", "confidence": "medium"},
        {"scene_summary": "Bowler in the middle of their run-up approach.", "commentary": "The bowler is charging in with purpose, a full head of steam. The angle of approach suggests a plan to swing the ball into the right-hander. Classic battle between pace and patience.", "insight": "Watch for a short-pitched delivery to unsettle the batter's rhythm.", "confidence": "medium"},
        {"scene_summary": "Wide-angle view of the cricket ground under lights.", "commentary": "The floodlights bathe the ground in a warm glow as the crowd noise picks up. This is what evening cricket is all about — the dew factor could come into play soon, altering the dynamics.", "insight": "Dew can make the ball skid on, favoring batsmen in the second half.", "confidence": "low"},
        {"scene_summary": "Players gathered for a mid-pitch discussion.", "commentary": "A tactical huddle on the pitch — the captain appears to be adjusting the plan. These mid-over conferences often signal a bowling change or a shift in field placement.", "insight": "Expect a change in approach after this break — possibly a spin option.", "confidence": "medium"},
        {"scene_summary": "Crowd reactions visible from the stands.", "commentary": "The energy in the stands is electric. Every dot ball draws a collective sigh, every boundary an eruption. This is the theatre of cricket at its finest.", "insight": "Crowd pressure can influence decision-making on both sides.", "confidence": "low"},
    ],
    "desi_aunty": [
        {"scene_summary": "Cricket match visible on a screen with players in action.", "commentary": "Arre dekho dekho, poora match ka scene set ho gaya hai! Bilkul jaise hum log drawing room mein baith ke chai ke saath match dekhte hain na, wahi vibe hai!", "insight": "Mummy kehti — jab tak chai nahi aati, wicket nahi girta!", "confidence": "medium"},
        {"scene_summary": "Batsman playing a defensive shot.", "commentary": "Yeh batter bilkul uncle jaise khel raha hai — safe safe, koi risk nahi. Arre bhai, thoda maar ke dikhao! Rishtedaar log boring commentary ka complaint kar rahe hain!", "insight": "Kabhi kabhi safe khelna bhi zaroori hai, but entertainment bhi chahiye!", "confidence": "medium"},
        {"scene_summary": "Fielder diving to stop a boundary.", "commentary": "Wah wah, kya save kiya! Bilkul cousin bhai jaise jab last samosa bachata hai plate se! Full commitment, full dedication — aise effort se hi match jeetein hain!", "insight": "Ek acchi fielding se poore team ka morale boost ho jaata hai.", "confidence": "medium"},
        {"scene_summary": "Umpire raising finger for a decision.", "commentary": "OUT! Arre mummy papad lao, batter gaya! Bilkul wahi scene jaise exam result aata hai aur papa ka expression change hota hai. Ab bowling team ki party hai!", "insight": "Ek wicket se poora momentum shift ho jaata hai!", "confidence": "high"},
    ],
    "bollywood": [
        {"scene_summary": "Dramatic cricket match moment under floodlights.", "commentary": "The stadium is set, the stage is lit, and the hero stands alone against the world. Every delivery is a dialogue, every boundary a punchline. This is not just cricket — this is cinema!", "insight": "In the movies, the hero always wins in the last over.", "confidence": "medium"},
        {"scene_summary": "Bowler delivering a fast ball.", "commentary": "Like a villain making his grand entrance, the bowler charges in with thunder in his steps! The ball leaves his hand like a missile — will the hero survive this onslaught?", "insight": "The battle between bat and ball is the ultimate Bollywood script.", "confidence": "medium"},
        {"scene_summary": "Batsman hitting a big shot.", "commentary": "DHISHOOM! The bat connects and the ball soars into the night sky like fireworks at a grand finale! The crowd rises as one — this is the hero moment every fan lives for!", "insight": "One shot can change the entire narrative of the match.", "confidence": "high"},
    ],
    "hinglish": [
        {"scene_summary": "Cricket match in progress on a bright day.", "commentary": "Bhai full-on match chal raha hai! Scene ekdum lit hai, crowd bhi full support mein. Yeh wala session decide karega match ka fate. Let's gooo!", "insight": "Yeh woh time hai jab legends bante hain!", "confidence": "medium"},
        {"scene_summary": "Close-up of fielding setup.", "commentary": "Yaar fielding dekho, captain ne poora trap set kiya hai! Ek galat shot aur seedha slip mein catch. Batter ko smart khelna padega, no shortcuts!", "insight": "Fielding placement se pata chalta hai captain ka game plan.", "confidence": "medium"},
        {"scene_summary": "Players celebrating a wicket.", "commentary": "WICKET! Full celebration mode on! Poora team bhag ke aaya jaise free pizza mil raha ho! Ab batting team pressure mein, naya batter nervous hoga!", "insight": "Celebration bhi ek art hai — momentum ka part hai!", "confidence": "high"},
    ],
    "coach": [
        {"scene_summary": "Batsman taking a stance at the crease.", "commentary": "Notice the batter's stance — weight is slightly front-foot dominant, which is good for driving but could be exploited by short-pitched bowling. The grip looks solid but the backlift is a touch late.", "insight": "Work on trigger movement timing to get into position earlier.", "confidence": "medium"},
        {"scene_summary": "Bowler in delivery stride.", "commentary": "The bowler's action is smooth but the front foot is landing slightly wide of the crease. This changes the angle and can reduce the effectiveness of the inswinger. The wrist position at release is good.", "insight": "Tighten the front-foot landing position for better control.", "confidence": "medium"},
        {"scene_summary": "Field placement overview.", "commentary": "Interesting field setup — two slips and a gully suggest the captain is expecting movement. But the lack of a short leg means they're not fully committing to the attacking plan. A half-measure.", "insight": "Either attack fully or save runs — sitting in between is a tactical error.", "confidence": "medium"},
    ],
}


class GenerateRequest(BaseModel):
    image_base64: str
    personality: str = "analyst"
    room_id: str


class VideoGenerateRequest(BaseModel):
    video_base64: str
    personality: str = "analyst"
    room_id: str


class LiveFrameRequest(BaseModel):
    room_id: str
    style: str = "analyst"
    frame_base64: str
    timestamp: str = ""
    force_demo: bool = False


# ── Helpers ───────────────────────────────────────────────────────────────────

def clean_base64(raw: str) -> bytes:
    if "," in raw:
        raw = raw.split(",", 1)[1]
    return base64.b64decode(raw)


def fallback_commentary(personality_id: str, reason: str = "demo fallback") -> str:
    return MOCK_TEXT.get(personality_id, MOCK_TEXT["analyst"]) + f"\n\n[Fallback: {reason}]"


def fallback_live_commentary(personality_id: str, room_id: str) -> dict:
    """Return a mock live commentary entry for demo reliability."""
    import random
    entries = MOCK_LIVE_ENTRIES.get(personality_id, MOCK_LIVE_ENTRIES["analyst"])
    # Avoid repeating the same mock entry as last time
    recent_texts = [e.get("text", "") for e in room_history.get(room_id, [])[-3:]]
    available = [e for e in entries if e["commentary"] not in recent_texts]
    if not available:
        available = entries
    entry = random.choice(available)
    return {
        "scene_summary": entry["scene_summary"],
        "commentary": entry["commentary"],
        "insight": entry["insight"],
        "confidence": entry["confidence"],
    }


def extract_frames(video_bytes: bytes, num_frames: int = 5) -> list[bytes]:
    """Extract evenly-spaced JPEG frames from raw video bytes using OpenCV."""
    if not CV2_AVAILABLE:
        return []
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(video_bytes)
            tmp_path = f.name

        cap = cv2.VideoCapture(tmp_path)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total <= 0:
            cap.release()
            return []

        indices = [int(i * total / num_frames) for i in range(num_frames)]
        frames: list[bytes] = []
        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ret, frame = cap.read()
            if ret:
                _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                frames.append(buf.tobytes())
        cap.release()
        return frames
    except Exception:
        return []
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


async def generate_with_gemini(image_bytes: bytes, personality_id: str) -> str:
    personality = PERSONALITIES.get(personality_id, PERSONALITIES["analyst"])
    if not model:
        return fallback_commentary(personality_id, "Gemini key not configured")

    prompt = f"""You are an AI cricket broadcast assistant for a hackathon prototype.
Analyze the provided cricket/stadium image or frame. Infer only what is visible or reasonably likely.
If the image is unclear, say confidence is low but still produce useful commentary.

{personality['prompt']}

Return ONLY valid JSON with this exact shape:
{{
  "scene_summary": "one sentence",
  "detected_elements": ["short labels"],
  "likely_match_moment": "one sentence",
  "commentary": "3-4 sentences in the selected style",
  "insight": "one short tactical/fan insight",
  "confidence": "low|medium|high"
}}"""

    try:
        response = model.generate_content([
            prompt,
            {"mime_type": "image/jpeg", "data": image_bytes},
        ])
        text = (response.text or "").strip()
        text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(text)
        return parsed.get("commentary") or text
    except Exception as exc:
        return fallback_commentary(personality_id, str(exc)[:120])


async def generate_live_frame_with_gemini(
    image_bytes: bytes,
    personality_id: str,
    room_id: str,
    timestamp: str = "",
) -> dict:
    """Generate live-frame commentary with context awareness to reduce repetition."""
    personality = PERSONALITIES.get(personality_id, PERSONALITIES["analyst"])
    if not model:
        return fallback_live_commentary(personality_id, room_id)

    # Build context from recent room commentary to reduce repetition
    recent_entries = room_history.get(room_id, [])[-3:]
    context_block = ""
    if recent_entries:
        recent_lines = []
        for i, entry in enumerate(recent_entries, 1):
            recent_lines.append(f"{i}. {entry.get('text', '')[:200]}")
        context_block = f"""
RECENT COMMENTARY IN THIS ROOM (last {len(recent_entries)} entries):
{chr(10).join(recent_lines)}

IMPORTANT: Do NOT repeat the previous commentary. Add a fresh observation, continue the match narrative, or comment on a different aspect of the frame.
"""

    prompt = f"""You are an AI live cricket broadcast assistant for a hackathon prototype called StadiumSync.
You are analyzing a single frame captured from a live camera pointed at a cricket match (on TV, projector, or live).

{personality['prompt']}

Analyze the current cricket frame carefully.
- Infer only what is visible or reasonably likely.
- If the frame is unclear or shows a non-cricket scene, still generate a useful broadcast-style line but mark confidence as "low".
- Do NOT claim exact ball speed, player names, exact score, or specific outcomes unless clearly visible.
- Generate concise commentary suitable for a live scrolling feed (2-3 sentences max).
{context_block}
Return ONLY valid JSON (no markdown, no code fences) with this exact shape:
{{
  "scene_summary": "one concise sentence describing what you see",
  "commentary": "2-3 sentences of live-style commentary in the selected personality",
  "insight": "one short tactical or fan insight",
  "confidence": "low|medium|high"
}}"""

    try:
        response = model.generate_content([
            prompt,
            {"mime_type": "image/jpeg", "data": image_bytes},
        ])
        text = (response.text or "").strip()
        text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(text)
        return {
            "scene_summary": parsed.get("scene_summary", "Frame analyzed"),
            "commentary": parsed.get("commentary", ""),
            "insight": parsed.get("insight", ""),
            "confidence": parsed.get("confidence", "medium"),
        }
    except Exception as exc:
        result = fallback_live_commentary(personality_id, room_id)
        result["_fallback_reason"] = str(exc)[:120]
        return result


async def generate_video_with_gemini(frames: list[bytes], personality_id: str) -> str:
    personality = PERSONALITIES.get(personality_id, PERSONALITIES["analyst"])
    if not model:
        return fallback_commentary(personality_id, "Gemini key not configured")

    prompt = f"""You are an AI cricket broadcast assistant for a hackathon prototype.
You will receive multiple sampled frames from a short cricket/stadium video clip in chronological order.
Infer only what is visible or reasonably likely. If uncertain, mark confidence as low or medium.

{personality['prompt']}

Return ONLY valid JSON with this exact shape:
{{
  "clip_summary": "one sentence",
  "timeline": [
    {{"timestamp": "00:01", "observed_moment": "short phrase", "commentary": "1-2 sentences", "insight": "short insight", "confidence": "low|medium|high"}}
  ],
  "overall_insight": "one short tactical/fan insight",
  "confidence": "low|medium|high"
}}
Make the timeline feel like live commentary, not static image captions.
"""

    try:
        content = [prompt]
        for frame in frames[:5]:
            content.append({"mime_type": "image/jpeg", "data": frame})
        response = model.generate_content(content)
        text = (response.text or "").strip()
        text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(text)
        lines = []
        if parsed.get("clip_summary"):
            lines.append(f"Clip Summary: {parsed['clip_summary']}")
        for item in parsed.get("timeline", []):
            ts = item.get("timestamp", "00:00")
            moment = item.get("observed_moment", "Match moment")
            commentary = item.get("commentary", "")
            insight = item.get("insight", "")
            confidence = item.get("confidence", parsed.get("confidence", "medium"))
            lines.append(f"[{ts}] {moment}: {commentary} Insight: {insight} Confidence: {confidence}.")
        if parsed.get("overall_insight"):
            lines.append(f"Overall Insight: {parsed['overall_insight']}")
        return "\n\n".join(lines) if lines else text
    except Exception as exc:
        return fallback_commentary(personality_id, str(exc)[:120])


async def broadcast_to_room(room_id: str, message: dict, exclude: Optional[WebSocket] = None):
    dead = []
    for ws in list(rooms.get(room_id, [])):
        if ws is exclude:
            continue
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in rooms.get(room_id, []):
            rooms[room_id].remove(ws)


def save_to_room(room_id: str, message: dict):
    room_history[room_id].append(message)
    room_history[room_id] = room_history[room_id][-50:]


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "ok", "service": "StadiumSync backend", "cv2": CV2_AVAILABLE}


@app.get("/health")
def health():
    return {"ok": True, "gemini_configured": bool(model), "cv2_available": CV2_AVAILABLE}


@app.post("/generate")
async def generate_commentary(req: GenerateRequest):
    personality_id = req.personality if req.personality in PERSONALITIES else "analyst"
    personality = PERSONALITIES[personality_id]
    try:
        image_bytes = clean_base64(req.image_base64)
    except Exception:
        image_bytes = b""

    commentary_text = await generate_with_gemini(image_bytes, personality_id)
    message = {
        "id": str(uuid.uuid4()),
        "personality": personality_id,
        "personality_name": personality["name"],
        "emoji": personality["emoji"],
        "text": commentary_text,
        "timestamp": int(time.time()),
        "source": "image",
    }
    save_to_room(req.room_id, message)
    await broadcast_to_room(req.room_id, {"type": "commentary", "data": message})
    return {"success": True, "message": message}


@app.post("/generate-live-frame")
async def generate_live_frame(req: LiveFrameRequest):
    """Live camera frame analysis endpoint — the primary demo flow."""
    personality_id = req.style if req.style in PERSONALITIES else "analyst"
    personality = PERSONALITIES[personality_id]

    try:
        image_bytes = clean_base64(req.frame_base64)
    except Exception:
        image_bytes = b""

    result = (
        fallback_live_commentary(personality_id, req.room_id)
        if req.force_demo
        else await generate_live_frame_with_gemini(
            image_bytes, personality_id, req.room_id, req.timestamp
        )
    )

    message = {
        "id": str(uuid.uuid4()),
        "personality": personality_id,
        "personality_name": personality["name"],
        "emoji": personality["emoji"],
        "text": result.get("commentary", ""),
        "timestamp": int(time.time()),
        "source": "live-camera",
        "scene_summary": result.get("scene_summary", ""),
        "insight": result.get("insight", ""),
        "confidence": result.get("confidence", "medium"),
    }
    save_to_room(req.room_id, message)
    await broadcast_to_room(req.room_id, {"type": "commentary", "data": message})

    return {
        "timestamp": req.timestamp or str(int(time.time())),
        "style": personality_id,
        "scene_summary": result.get("scene_summary", ""),
        "commentary": result.get("commentary", ""),
        "insight": result.get("insight", ""),
        "confidence": result.get("confidence", "medium"),
    }


@app.post("/generate-video")
async def generate_video_commentary(req: VideoGenerateRequest):
    personality_id = req.personality if req.personality in PERSONALITIES else "analyst"
    personality = PERSONALITIES[personality_id]

    try:
        video_bytes = clean_base64(req.video_base64)
    except Exception:
        video_bytes = b""

    frames = extract_frames(video_bytes, num_frames=5)

    if not frames:
        commentary_text = fallback_commentary(personality_id, "Could not extract frames — cv2 unavailable or bad video")
        frame_count = 0
    else:
        commentary_text = await generate_video_with_gemini(frames, personality_id)
        frame_count = len(frames)

    message = {
        "id": str(uuid.uuid4()),
        "personality": personality_id,
        "personality_name": personality["name"],
        "emoji": personality["emoji"],
        "text": commentary_text,
        "timestamp": int(time.time()),
        "source": "video",
        "frame_count": frame_count,
    }
    save_to_room(req.room_id, message)
    await broadcast_to_room(req.room_id, {"type": "commentary", "data": message})
    return {"success": True, "message": message, "frame_count": frame_count}


@app.get("/room/{room_id}/history")
def get_room_history(room_id: str):
    return {"history": room_history.get(room_id, [])}

async def process_websocket_frame(room_id: str, data: dict):
    req_id = data.get("req_id", str(uuid.uuid4()))
    personality_id = data.get("personality", "harsha")
    personality = PERSONALITIES.get(personality_id, PERSONALITIES["harsha"])
    force_demo = data.get("force_demo", False)
    
    try:
        image_bytes = clean_base64(data.get("frame_base64", ""))
    except:
        image_bytes = b""
        
    await broadcast_to_room(room_id, {"type": "stream_start", "req_id": req_id, "personality": personality_id, "personality_name": personality["name"], "emoji": personality["emoji"]})
    
    async def run_gemini():
        prompt = f"You are an AI cricket commentator. Style: {personality['prompt']}. Analyze this frame. Give me 1-3 sentences of raw text commentary. No JSON. No markdown."
        response = await model.generate_content_async([prompt, {"mime_type": "image/jpeg", "data": image_bytes}], stream=True)
        full_text = ""
        async for chunk in response:
            text = chunk.text
            full_text += text
            await broadcast_to_room(room_id, {"type": "stream_chunk", "req_id": req_id, "text": text})
        return full_text
        
    try:
        if force_demo or not model:
            raise asyncio.TimeoutError("Demo mode forced or model unavailable")
        # 3 seconds timeout for failover
        full_text = await asyncio.wait_for(run_gemini(), timeout=3.0)
    except (asyncio.TimeoutError, Exception) as exc:
        result = fallback_live_commentary(personality_id, room_id)
        full_text = result.get("commentary", "")
        # Emulate streaming
        await broadcast_to_room(room_id, {"type": "stream_chunk", "req_id": req_id, "text": full_text})
        
    message = {
        "id": req_id,
        "personality": personality_id,
        "personality_name": personality["name"],
        "emoji": personality["emoji"],
        "text": full_text,
        "timestamp": int(time.time()),
        "source": "live-camera"
    }
    save_to_room(room_id, message)
    await broadcast_to_room(room_id, {"type": "commentary", "data": message})


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await websocket.accept()
    rooms[room_id].append(websocket)
    await websocket.send_json({
        "type": "history",
        "data": room_history.get(room_id, []),
        "room_id": room_id,
        "viewers": len(rooms[room_id]),
    })
    await broadcast_to_room(room_id, {"type": "viewer_update", "viewers": len(rooms[room_id])}, exclude=websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            if raw:
                try:
                    data = json.loads(raw)
                    if data.get("type") == "frame":
                        asyncio.create_task(process_websocket_frame(room_id, data))
                    elif data.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                except Exception:
                    await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        if websocket in rooms.get(room_id, []):
            rooms[room_id].remove(websocket)
        if not rooms.get(room_id):
            rooms.pop(room_id, None)
        else:
            await broadcast_to_room(room_id, {"type": "viewer_update", "viewers": len(rooms[room_id])})
