# Wake Word Activated Real-Time Chat System

Dieses System ermöglicht es, über Kameras mit Two-Way-Audio zu kommunizieren, indem es auf Wake-Words hört und dann eine Echtzeit-Unterhaltung über die ChatGPT Realtime API startet.

## 🎯 Funktionsweise

### 1. Audio-Extraktion aus Video-Streams
- Das System extrahiert Audio **ausschließlich aus dem Video-Stream** der Kameras
- Kein separater Audio-Stream erforderlich oder unterstützt
- Nutzt FFmpeg zur Echtzeit-Audio-Extraktion aus RTSP-Video-Streams
- Unterstützt verschiedene Video-Stream-Formate und Transport-Protokolle (TCP/UDP)
- Automatische Konvertierung zu 16kHz Mono PCM für Wake-Word-Erkennung

### 2. Wake-Word-Erkennung
- Kontinuierliche Überwachung des Audio-Streams auf das konfigurierte Wake-Word
- Verwendet OpenAI's Whisper-Modell für präzise Spracherkennung
- Standardmäßig auf "hey guardian" konfiguriert (anpassbar)

### 3. ChatGPT Realtime API Integration
- Startet automatisch eine Echtzeit-Session bei Wake-Word-Erkennung
- Unterstützt Audio, Text und Vision-Modalities
- Integrierte Tool-Funktionen für Kamera-Steuerung

### 4. Two-Way-Audio über Kameras
- Sprachausgabe wird über die Kamera's RTSP Talkback-Stream gesendet
- Unterstützt verschiedene Audio-Codecs (AAC empfohlen)
- Automatische Audio-Format-Konvertierung

## 🔧 Konfiguration

### Umgebungsvariablen
```bash
OPENAI_API_KEY=your_openai_api_key_here
WAKE_WORD=hey guardian
SNAPSHOT_INTERVAL_MS=5000
```

### Kamera-Konfiguration
Jede Kamera benötigt:
- **Host/IP**: Kamera-Adresse
- **Benutzername/Passwort**: Für ONVIF und RTSP
- **RTSP Video URL**: Haupt-Video-Stream (Audio wird daraus extrahiert)
- **RTSP Talkback URL**: Für Audio-Ausgang (Two-Way-Audio)

**Wichtig**: Separate Audio-Streams werden NICHT verwendet - Audio wird immer aus dem Video-Stream extrahiert!

## 🚀 Verwendung

1. **System starten**:
   ```bash
   cd backend
   npm run dev
   ```

2. **Kameras konfigurieren**:
   - Öffne die Admin-Oberfläche
   - Füge Kameras hinzu mit korrekten RTSP-URLs
   - Teste die Audio-Verbindungen

3. **Wake-Word verwenden**:
   - Sage "hey guardian" in die Kamera
   - Das System startet automatisch eine Voice-Session
   - Du kannst jetzt mit der KI sprechen

## 📁 Wichtige Dateien

- `backend/src/audio/twoway-audio.ts` - Audio-Streaming und Two-Way-Audio
- `backend/src/cameras/wake-word-detector.ts` - Wake-Word-Erkennung
- `backend/src/realtime/voice-session-manager.ts` - ChatGPT Realtime API Integration
- `backend/src/cameras/camera-manager.ts` - Kamera-Management und Event-Handling

## 🔍 Debugging

### Logs überwachen
```bash
# Backend-Logs
cd backend && npm run dev

# Oder mit Docker
docker-compose logs -f backend
```

### Audio-Extraktion testen
```bash
# Teste Audio-Extraktion aus Video-Stream
node backend/test-audio-extraction.js rtsp://camera-ip/stream1 username password

# Manueller Test mit FFmpeg
ffmpeg -i rtsp://camera-ip/stream1 -map 0:a -vn -f wav -t 10 test-audio.wav

# Prüfe ob Video-Stream Audio enthält
ffprobe -i rtsp://camera-ip/stream1 -show_streams -select_streams a

# Teste Talkback-Stream
ffmpeg -f lavfi -i "sine=frequency=1000:duration=5" -f rtsp rtsp://camera-ip/talkback
```

## ⚡ Performance-Optimierungen

- **Wake-Word-Erkennung**: 2-Sekunden-Audio-Chunks für schnelle Reaktion
- **Audio-Streaming**: Automatische Reconnection und Transport-Fallback
- **Voice-Sessions**: 10-Sekunden-Timeout für längere Gespräche
- **Fehlerbehandlung**: Robuste Fehlerbehandlung mit automatischen Wiederholungen

## 🛠️ Technische Details

### Audio-Format
- **Eingang**: 16kHz, 16-bit, Mono PCM
- **Ausgang**: AAC, 64kbps für Kompatibilität
- **Transport**: RTSP über TCP/UDP

### Wake-Word-Pipeline
1. Audio-Extraktion aus Video-Stream der Kamera (oder Fallback auf Audio-Stream)
2. 2-Sekunden-Audio-Chunks sammeln (16kHz, 16-bit, Mono)
3. OpenAI Whisper Transkription
4. Text-basierte Wake-Word-Erkennung
5. Voice-Session starten bei Erkennung
6. Kurze Pause nach Erkennung um Mehrfach-Trigger zu vermeiden

### Voice-Session-Flow
1. WebSocket-Verbindung zur Realtime API
2. Audio-Chunks an API senden
3. Audio-Antworten über Kamera ausgeben
4. Tool-Calls für Kamera-Steuerung
5. Automatisches Session-Management

## 🎉 Fertig!

Das System ist jetzt vollständig implementiert und bereit für Wake-Word-aktivierte Echtzeit-Chats mit Kameras!
