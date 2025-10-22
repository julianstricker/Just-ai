import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

export async function grabRtspFrameAsDataUrl(rtspUrl: string, opts?: { transport?: 'tcp' | 'udp'; timeoutMs?: number }): Promise<string> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg binary not found');
  }

  return new Promise<string>((resolve, reject) => {
    const transport = opts?.transport ?? 'tcp';
    const timeoutMs = opts?.timeoutMs ?? 8000;
    const args = [
      '-y',
      '-rtsp_transport', transport,
      '-stimeout', String(timeoutMs * 1000),
      '-i', rtspUrl,
      '-frames:v', '1',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      'pipe:1'
    ];

    const child: any = spawn(ffmpegPath as string, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const chunks: Buffer[] = [];
    let stderr = '';
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        try { child.kill('SIGKILL'); } catch {}
        reject(err);
        return;
      }
      const buffer = Buffer.concat(chunks);
      const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
      resolve(dataUrl);
    };

    const timer = setTimeout(() => finish(new Error('ffmpeg timeout')), timeoutMs + 1000);

    child.stdout?.on('data', (d: Buffer) => chunks.push(d));
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err: Error) => finish(err));
    child.on('close', (code: number) => {
      if (code === 0 && chunks.length > 0) return finish();
      finish(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
    });
  });
}


