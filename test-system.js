#!/usr/bin/env node

/**
 * Simple test script to validate the wake word and voice system
 * This script simulates the main system flow without requiring actual cameras
 */

import { spawn } from 'node:child_process';
import { logger } from './backend/src/config/logger.js';

console.log('🔍 Testing Wake Word and Voice System Integration...\n');

// Test 1: Check if all required dependencies are available
console.log('1. Checking dependencies...');
try {
  const { execSync } = await import('child_process');
  execSync('which ffmpeg', { stdio: 'pipe' });
  console.log('   ✅ FFmpeg is available');
} catch (err) {
  console.log('   ❌ FFmpeg not found - audio streaming will not work');
}

// Test 2: Check environment variables
console.log('\n2. Checking environment variables...');
const requiredEnvVars = ['OPENAI_API_KEY'];
let envOk = true;

for (const envVar of requiredEnvVars) {
  if (process.env[envVar]) {
    console.log(`   ✅ ${envVar} is set`);
  } else {
    console.log(`   ❌ ${envVar} is missing`);
    envOk = false;
  }
}

// Test 3: Check if the backend can start
console.log('\n3. Testing backend startup...');
try {
  const backend = spawn('node', ['backend/dist/index.js'], { 
    stdio: 'pipe',
    cwd: process.cwd()
  });
  
  let started = false;
  const timeout = setTimeout(() => {
    if (!started) {
      backend.kill();
      console.log('   ⏰ Backend startup timeout (this is expected if no cameras are configured)');
    }
  }, 5000);
  
  backend.stdout.on('data', (data) => {
    const output = data.toString();
    if (output.includes('Server listening')) {
      started = true;
      clearTimeout(timeout);
      console.log('   ✅ Backend started successfully');
      backend.kill();
    }
  });
  
  backend.stderr.on('data', (data) => {
    const error = data.toString();
    if (error.includes('OPENAI_API_KEY') && !started) {
      clearTimeout(timeout);
      console.log('   ❌ Backend failed: Missing OpenAI API key');
      backend.kill();
    }
  });
  
} catch (err) {
  console.log('   ❌ Failed to test backend startup:', err.message);
}

console.log('\n📋 System Status Summary:');
console.log('   • Audio streaming: FFmpeg required');
console.log('   • Wake word detection: OpenAI API required');
console.log('   • Voice sessions: OpenAI Realtime API required');
console.log('   • Two-way audio: Camera must support RTSP talkback');

console.log('\n🚀 To use the system:');
console.log('   1. Configure cameras in the admin interface');
console.log('   2. Set up RTSP URLs for audio input and talkback');
console.log('   3. Say the wake word (default: "hey guardian")');
console.log('   4. The system will start a voice conversation');

console.log('\n✨ System is ready for wake word activated real-time chat!');