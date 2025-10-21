# JuSt AI Guardian

JuSt AI Guardian is an AI-assisted multi-camera monitoring platform that connects ONVIF-compatible cameras (such as the Tapo C200) with OpenAI's realtime and vision models. The system listens for a configurable wake-word on every camera, initiates two-way conversations with users over the camera's audio channel, and analyses live snapshots with YOLO-based object detection and face recognition. A lightweight Vuetify admin panel allows operators to review event logs, manage cameras, and inspect detections.

## Features

- **Two-way AI voice assistant** – Wake-word detection on every camera starts a ChatGPT realtime session that speaks back through the same camera.
- **Vision analytics** – YOLOv8 object detection and face recognition extract embeddings so the backend can identify known people and trigger alerts for unknown faces or suspicious events.
- **People tracking** – The backend stores face embeddings and last-seen metadata, enabling queries like “Where did you last see Alice?”.
- **Admin web UI** – Manage cameras, review logs, and monitor alerts from a Vuetify dashboard.
- **Dockerised deployment** – docker-compose launches the Node.js backend, Vue admin UI, and Python-based vision service.

## Architecture Overview

```
+-------------------+      +------------------+      +-------------------+
| ONVIF Cameras     | ---> | Node.js Backend  | ---> | Vuetify Admin UI  |
| Wake-word audio   |      | - Voice sessions |      | (Vite/Vue)        |
| Snapshot capture  |      | - State storage  |      |                   |
+-------------------+      | - ONVIF control  |      +-------------------+
          |                |                  |
          | snapshots      v                  |
          +----------> Python Vision Service -+-- YOLOv8, face embeddings
```

- **backend/** – TypeScript Express app orchestrating cameras, wake-word detection, realtime ChatGPT conversations, and persistence.
- **vision-service/** – FastAPI server with YOLOv8 + face_recognition for object/person detection.
- **frontend/** – Vite + Vue + Vuetify admin dashboard.
- **data/state.json** – Simple JSON persistence for cameras, people, and logs (mounted into the backend container).

## Prerequisites

- Docker & docker-compose
- OpenAI API key with access to realtime + transcription models
- ONVIF cameras reachable from the backend container

## Running locally

```bash
export OPENAI_API_KEY="sk-..."
docker-compose up --build
```

The services will be available at:

- Backend API: http://localhost:8080/admin
- Admin UI: http://localhost:5173/
- Vision service health check: http://localhost:8000/health

## Configuration

Environment variables accepted by the backend:

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for realtime + transcription | _required_ |
| `VISION_ENDPOINT` | URL of the vision microservice | `http://vision-service:8000` |
| `WAKE_WORD` | Wake word string to trigger a voice session | `hey guardian` |
| `SNAPSHOT_INTERVAL_MS` | Snapshot capture cadence per camera | `5000` |
| `STATE_FILE` | JSON file used for persistence | `/data/state.json` |

## Extending the system

- **Two-way audio**: `backend/src/audio/twoway-audio.ts` currently exposes a PassThrough stream placeholder. Replace this with a vendor-specific implementation (e.g. RTP backchannel) to stream audio to/from the camera hardware.
- **Wake-word engine**: `backend/src/realtime/wakeword-service.ts` forwards audio to the OpenAI transcription API. Swap in a local wake-word detector (e.g. Porcupine, Whisper) for on-prem deployments.
- **PTZ control**: Extend `vision-service/app/main.py` `/ptz` handler and the backend tool plumbing to invoke ONVIF PTZ services.
- **Persistent database**: Replace the JSON storage in `data/state.json` with a proper database (PostgreSQL, Redis, etc.) and update `StateStore` accordingly.

## Development

- Backend: `npm install && npm run dev` inside `backend/`
- Frontend: `npm install && npm run dev` inside `frontend/`
- Vision service: `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000` inside `vision-service/`

## Disclaimer

Hardware integrations (wake-word capture, RTP audio, PTZ) are provided as high-level scaffolding. Additional integration work is required to connect to specific camera models and ensure realtime performance in production environments.
