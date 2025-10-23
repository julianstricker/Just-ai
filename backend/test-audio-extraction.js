#!/usr/bin/env node

/**
 * Test script to debug audio extraction from video streams
 * Usage: node test-audio-extraction.js <rtsp-url> [username] [password]
 */

import { spawn } from 'node:child_process';

// Try to find ffmpeg
let ffmpegPath = 'ffmpeg'; // Default to system ffmpeg
try {
  const ffmpegStatic = await import('ffmpeg-static');
  if (ffmpegStatic.default) {
    ffmpegPath = ffmpegStatic.default;
  }
} catch (err) {
  console.log('⚠️ Using system ffmpeg (ffmpeg-static not available)');
}

const rtspUrl = process.argv[2];
const username = process.argv[3];
const password = process.argv[4];

if (!rtspUrl) {
  console.log('Usage: node test-audio-extraction.js <rtsp-url> [username] [password]');
  console.log('Example: node test-audio-extraction.js rtsp://192.168.1.100/stream1 admin password123');
  process.exit(1);
}

// Build URL with credentials if provided
let testUrl = rtspUrl;
if (username && password) {
  try {
    const url = new URL(rtspUrl);
    const encUser = encodeURIComponent(username);
    const encPass = encodeURIComponent(password);
    const hostAndPath = `${url.host}${url.pathname}${url.search}`;
    testUrl = `rtsp://${encUser}:${encPass}@${hostAndPath}`;
  } catch {
    const prefix = 'rtsp://';
    const rest = rtspUrl.startsWith(prefix) ? rtspUrl.substring(prefix.length) : rtspUrl;
    testUrl = `${prefix}${encodeURIComponent(username)}:${encodeURIComponent(password)}@${rest}`;
  }
}

console.log('🔍 Testing audio extraction from video stream...');
console.log('📹 RTSP URL:', rtspUrl);
console.log('🔐 Using credentials:', username ? 'Yes' : 'No');
console.log('');

// Test 1: Check stream info
console.log('1️⃣ Analyzing stream information...');
const probeArgs = [
  '-loglevel', 'error',
  '-rtsp_transport', 'tcp',
  '-i', testUrl,
  '-show_streams',
  '-select_streams', 'a',
  '-of', 'compact=p=0:nk=1'
];

const probe = spawn('ffprobe', probeArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

probe.stdout.on('data', (data) => {
  const output = data.toString();
  if (output.trim()) {
    console.log('✅ Audio stream found:', output.trim());
  }
});

probe.stderr.on('data', (data) => {
  const error = data.toString();
  if (error.includes('No such file')) {
    console.log('❌ Cannot connect to RTSP stream');
  } else if (error.includes('Invalid data')) {
    console.log('❌ Invalid RTSP stream data');
  } else if (error.trim()) {
    console.log('⚠️ FFprobe warning:', error.trim());
  }
});

probe.on('close', (code) => {
  if (code === 0) {
    console.log('✅ Stream analysis completed');
  } else {
    console.log('❌ Stream analysis failed with code:', code);
  }
  
  // Test 2: Extract audio
  console.log('');
  console.log('2️⃣ Testing audio extraction...');
  
  const extractArgs = [
    '-loglevel', 'warning',
    '-rtsp_transport', 'tcp',
    '-i', testUrl,
    '-map', '0:a',
    '-vn',
    '-acodec', 'pcm_s16le',
    '-ac', '1',
    '-ar', '16000',
    '-f', 'wav',
    '-avoid_negative_ts', 'make_zero',
    '-fflags', '+genpts+igndts',
    '-probesize', '32',
    '-analyzeduration', '0',
    '-t', '5', // Extract 5 seconds
    'test-audio-output.wav'
  ];
  
  const extract = spawn(ffmpegPath, extractArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  
  let audioDetected = false;
  
  extract.stderr.on('data', (data) => {
    const message = data.toString().trim();
    if (message.includes('Stream #0:0') || message.includes('Stream #0:1')) {
      console.log('📊 Stream info:', message);
    } else if (message.includes('Audio:')) {
      console.log('🎵 Audio detected:', message);
      audioDetected = true;
    } else if (message.includes('error') || message.includes('Error')) {
      console.log('❌ FFmpeg error:', message);
    } else if (message.length > 0) {
      console.log('ℹ️ FFmpeg output:', message);
    }
  });
  
  extract.on('close', (code) => {
    if (code === 0 && audioDetected) {
      console.log('✅ Audio extraction successful! Check test-audio-output.wav');
    } else if (code === 0) {
      console.log('⚠️ Extraction completed but no audio detected');
    } else {
      console.log('❌ Audio extraction failed with code:', code);
    }
    
    console.log('');
    console.log('🏁 Test completed');
  });
});
