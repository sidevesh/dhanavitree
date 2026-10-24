"""Dhanavi voice service.

Pipecat turns speech into text and text into speech; the Node app stays the brain.
Each finished utterance is sent to Node (/api/voice/turn), which runs the same owner
setup or customer conversation as the typed chat, saves both messages and returns the
reply to speak.

Pipeline: browser mic -> Silero VAD -> OpenAI STT -> DhanaviBridge -> OpenAI TTS -> browser speaker

Only Node should reach this service: it listens on 127.0.0.1 and checks a shared secret.
"""

import asyncio
import hmac
import json
import os
from pathlib import Path

import aiohttp
import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    EndFrame,
    Frame,
    TranscriptionFrame,
    TTSSpeakFrame,
    VADUserStartedSpeakingFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.openai.stt import OpenAISTTService
from pipecat.services.openai.tts import OpenAITTSService
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import IceServer, SmallWebRTCConnection
from pipecat.transports.smallwebrtc.request_handler import (
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

# Share the app's .env so one file configures both services.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

SECRET = os.environ.get("VOICE_INTERNAL_SECRET", "")
DHANAVI_URL = os.environ.get("DHANAVI_URL", f"http://127.0.0.1:{os.environ.get('PORT', '3000')}").rstrip("/")
OPENAI_KEY = os.environ.get("VOICE_OPENAI_API_KEY") or os.environ.get("LLM_API_KEY", "")
OPENAI_BASE = os.environ.get("VOICE_OPENAI_BASE_URL") or "https://api.openai.com/v1"
# Silence after speech before a turn is sent. Owners answering setup questions pause mid-answer,
# so short pauses are joined into one turn instead of advancing onboarding early.
TURN_PAUSE_SECS = float(os.environ.get("VOICE_TURN_PAUSE_SECS", "1.2"))
# JSON list such as [{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}].
ICE_SERVERS = [IceServer(**s) for s in json.loads(os.environ.get("VOICE_ICE_SERVERS") or '[{"urls":"stun:stun.l.google.com:19302"}]')]


class DhanaviBridge(FrameProcessor):
    """Collects transcribed speech into one turn, asks Node for the reply and speaks it."""

    def __init__(self, token: str, session: aiohttp.ClientSession):
        super().__init__()
        self._token = token
        self._session = session
        self._parts: list[str] = []
        self._timer: asyncio.Task | None = None
        self._turns = asyncio.Lock()
        # Speech that starts while the bot is talking is usually its own voice coming back
        # through the speaker. Ignore it, or it would be saved as the next answer.
        self._bot_speaking = False
        self._echo = False

    async def _call(self, text: str = "", end: bool = False) -> str:
        async with self._session.post(
            f"{DHANAVI_URL}/api/voice/turn",
            json={"token": self._token, "text": text, "end": end},
            headers={"X-Voice-Secret": SECRET},
            timeout=aiohttp.ClientTimeout(total=90),
        ) as r:
            data = await r.json(content_type=None)
            if r.status == 401:
                return "This voice session has expired. Please start it again."
            if not r.ok:
                return data.get("error") or "Sorry, I couldn't reply just now. Please try again."
            return data.get("reply", "")

    async def greet(self):
        await self.push_frame(TTSSpeakFrame(await self._call()))

    async def end(self):
        try:
            await self._call(end=True)
        except Exception:
            pass

    def _cancel_timer(self):
        if self._timer and not self._timer.done():
            self._timer.cancel()
        self._timer = None

    async def _send_after_pause(self):
        await asyncio.sleep(TURN_PAUSE_SECS)
        text = " ".join(self._parts).strip()
        self._parts = []
        self._timer = None
        if not text:
            return
        # Turns go to Node one at a time; Node also rejects overlapping turns.
        async with self._turns:
            try:
                reply = await self._call(text)
            except Exception as e:
                logger.warning(f"Dhanavi turn failed: {e}")
                reply = "Sorry, I couldn't reach Dhanavi. Please try again."
        if reply:
            await self.push_frame(TTSSpeakFrame(reply))

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, (BotStartedSpeakingFrame, BotStoppedSpeakingFrame)):
            self._bot_speaking = isinstance(frame, BotStartedSpeakingFrame)
            await self.push_frame(frame, direction)
        elif isinstance(frame, VADUserStartedSpeakingFrame):
            self._echo = self._bot_speaking
            if not self._echo:
                # The speaker continued; wait for the whole answer.
                self._cancel_timer()
            await self.push_frame(frame, direction)
        elif isinstance(frame, TranscriptionFrame):
            if frame.text.strip() and not self._echo:
                self._parts.append(frame.text.strip())
                self._cancel_timer()
                self._timer = self.create_task(self._send_after_pause())
        else:
            await self.push_frame(frame, direction)


async def run_bot(connection: SmallWebRTCConnection, token: str):
    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(audio_in_enabled=True, audio_out_enabled=True),
    )
    stt = OpenAISTTService(
        api_key=OPENAI_KEY,
        base_url=OPENAI_BASE,
        settings=OpenAISTTService.Settings(model=os.environ.get("VOICE_STT_MODEL") or "gpt-4o-transcribe"),
    )
    tts = OpenAITTSService(
        api_key=OPENAI_KEY,
        base_url=OPENAI_BASE,
        settings=OpenAITTSService.Settings(
            model=os.environ.get("VOICE_TTS_MODEL") or "gpt-4o-mini-tts",
            voice=os.environ.get("VOICE_TTS_VOICE") or "coral",
            instructions="Speak warmly and clearly, like a helpful shop assistant.",
        ),
    )
    async with aiohttp.ClientSession() as session:
        bridge = DhanaviBridge(token, session)
        pipeline = Pipeline([
            transport.input(),
            VADProcessor(vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=0.6))),
            stt,
            bridge,
            tts,
            transport.output(),
        ])
        task = PipelineTask(pipeline, params=PipelineParams(enable_metrics=False))

        @transport.event_handler("on_client_connected")
        async def on_connected(_transport, _client):
            await bridge.greet()

        @transport.event_handler("on_client_disconnected")
        async def on_disconnected(_transport, _client):
            await bridge.end()
            await task.queue_frame(EndFrame())

        await PipelineRunner(handle_sigint=False).run(task)


app = FastAPI()
handler = SmallWebRTCRequestHandler(ice_servers=ICE_SERVERS)


@app.post("/offer")
async def offer(request: Request, background: BackgroundTasks, x_voice_secret: str = Header(default="")):
    if not SECRET or not hmac.compare_digest(x_voice_secret, SECRET):
        raise HTTPException(status_code=403)
    data = await request.json()
    token = (data.get("request_data") or {}).get("token")
    if not token:
        raise HTTPException(status_code=400)

    async def start(connection: SmallWebRTCConnection):
        background.add_task(run_bot, connection, token)

    return await handler.handle_web_request(
        SmallWebRTCRequest(sdp=data["sdp"], type=data["type"]), start
    )


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    if not SECRET or not OPENAI_KEY:
        raise SystemExit("Set VOICE_INTERNAL_SECRET and LLM_API_KEY (or VOICE_OPENAI_API_KEY) in .env")
    uvicorn.run(app, host=os.environ.get("VOICE_HOST", "127.0.0.1"), port=int(os.environ.get("VOICE_PORT", "7860")))
