from __future__ import annotations

import base64
import io
from typing import List, Optional

import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image
import numpy as np

try:
    from ultralytics import YOLO
    import face_recognition
except Exception as exc:  # pragma: no cover - handled at runtime
    YOLO = None  # type: ignore
    face_recognition = None  # type: ignore
    print(f"Warning: vision dependencies not fully loaded: {exc}")

app = FastAPI(title="Just AI Vision Service")

MODEL_NAME = "yolov8n.pt"
_yolo_model = None


class Credentials(BaseModel):
    username: str
    password: Optional[str] = None


class AnalyzeRequest(BaseModel):
    cameraId: str
    snapshotUri: str
    credentials: Optional[Credentials] = None


class SnapshotRequest(BaseModel):
    camera: dict


class PtzRequest(BaseModel):
    camera: dict
    params: dict


ALARM_LABELS = {"fire", "knife", "gun", "person_falling"}


def _ensure_model():
    global _yolo_model
    if _yolo_model is None:
        if YOLO is None:
            raise RuntimeError("YOLO model unavailable")
        _yolo_model = YOLO(MODEL_NAME)
    return _yolo_model


def _fetch_image(uri: str, auth: Optional[tuple[str, str]] = None) -> Image.Image:
    response = requests.get(uri, auth=auth, timeout=10)
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Failed to fetch snapshot: {response.status_code}")
    return Image.open(io.BytesIO(response.content)).convert("RGB")


def _image_to_data_url(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/jpeg;base64,{encoded}"


def _detect_objects(image: Image.Image):
    model = _ensure_model()
    results = model.predict(np.array(image), imgsz=640)[0]
    objects = []
    alarms: List[str] = []
    for box in results.boxes:
        cls_id = int(box.cls[0])
        label = model.model.names[cls_id]
        confidence = float(box.conf[0])
        xyxy = box.xyxy[0].tolist()
        bbox = [float(xyxy[0]), float(xyxy[1]), float(xyxy[2]), float(xyxy[3])]
        objects.append({
            "label": label,
            "confidence": confidence,
            "bbox": bbox,
        })
        if label in ALARM_LABELS and confidence > 0.5:
            alarms.append(f"Detected {label}")
    return objects, alarms


def _detect_people(image: Image.Image):
    if face_recognition is None:
        return []
    np_image = np.array(image)
    face_locations = face_recognition.face_locations(np_image)
    encodings = face_recognition.face_encodings(np_image, face_locations)
    people = []
    for bbox, encoding in zip(face_locations, encodings):
        top, right, bottom, left = bbox
        people.append({
            "bbox": [float(left), float(top), float(right), float(bottom)],
            "confidence": 1.0,
            "embedding": encoding.tolist(),
        })
    return people


@app.post("/analyze")
def analyze(request: AnalyzeRequest):
    camera_credentials = None
    if request.credentials:
        camera_credentials = (request.credentials.username, request.credentials.password or "")
    image = _fetch_image(request.snapshotUri, auth=camera_credentials)
    objects, alarms = _detect_objects(image)
    people = _detect_people(image)
    if any(obj["label"] == "person" for obj in objects) and not people:
        alarms.append("Person detected but face not visible")
    return {
        "objects": objects,
        "people": people,
        "alarms": alarms,
        "snapshotDataUrl": _image_to_data_url(image),
    }


@app.post("/snapshot")
def snapshot(request: SnapshotRequest):
    last_snapshot_uri = request.camera.get("lastSnapshotUrl")
    username = request.camera.get("username")
    password = request.camera.get("password")
    auth = (username, password) if username and password else None
    if last_snapshot_uri:
        image = _fetch_image(last_snapshot_uri, auth=auth)
        return {"dataUrl": _image_to_data_url(image)}
    raise HTTPException(status_code=400, detail="No snapshot URI available for camera")


@app.post("/ptz")
def ptz(_request: PtzRequest):
    # PTZ control would require vendor-specific integrations.
    # This endpoint acts as a placeholder that can be extended to call ONVIF PTZ services.
    return {"status": "not_implemented"}


@app.get("/health")
def health():
    return {"status": "ok"}
