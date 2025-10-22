import { EventEmitter } from 'eventemitter3';
import { logger } from '../config/logger.js';

export interface DiscoveredCamera {
  name: string;
  hostname: string;
  port: number;
  hardware: string;
  address: string;
  urn: string;
}

export class CameraDiscoveryService extends EventEmitter {
  private isScanning = false;
  private discoveredCameras = new Map<string, DiscoveredCamera>();

  async discoverCameras(timeoutMs = 10000): Promise<DiscoveredCamera[]> {
    if (this.isScanning) {
      logger.info('Camera discovery already in progress');
      return Array.from(this.discoveredCameras.values());
    }

    this.isScanning = true;
    this.discoveredCameras.clear();

    try {
      logger.info('Starting ONVIF camera discovery...');
      
      // Use the onvif library's discovery functionality
      const discovered = await this.performDiscovery(timeoutMs);
      
      logger.info(`Discovered ${discovered.length} ONVIF cameras`);
      
      for (const camera of discovered) {
        this.discoveredCameras.set(camera.urn, camera);
        logger.info(`Found camera: ${camera.name} at ${camera.hostname}:${camera.port}`);
      }

      return discovered;
    } catch (error) {
      logger.error('Camera discovery failed:', error);
      throw error;
    } finally {
      this.isScanning = false;
    }
  }

  private async performDiscovery(timeoutMs: number): Promise<DiscoveredCamera[]> {
    return new Promise(async (resolve, reject) => {
      try {
        // Dynamisch importieren (ESM-kompatibel), dann CommonJS-Export benutzen
        const onvif = await import('onvif');
        const Discovery: any = (onvif as any).Discovery || (onvif as any).default?.Discovery;

        if (!Discovery || typeof Discovery.probe !== 'function') {
          reject(new Error('ONVIF Discovery.probe not available'));
          return;
        }

        const opts: any = {
          timeout: timeoutMs,
          resolve: true,
          messageId: Math.floor(Math.random() * 1000000)
        };

        let resolved = false;
        Discovery.probe(opts, (err: any, devices: any[]) => {
          if (resolved) return;
          if (err) {
            resolved = true;
            reject(err);
            return;
          }

          const cameras: DiscoveredCamera[] = (devices || []).map((device: any) => {
            const hostname = device.hostname || device.address || (Array.isArray(device.xaddrs) ? device.xaddrs[0] : '') || '';
            return {
              name: device.name || device.hostname || device.type || 'Unknown Camera',
              hostname,
              port: device.port || 80,
              hardware: device.hardware || device.type || 'Unknown',
              address: device.address || device.hostname || hostname,
              urn: device.urn || `${hostname || 'unknown'}_${Date.now()}`
            };
          }).filter((c: DiscoveredCamera) => !!c.hostname);

        resolved = true;
          resolve(cameras);
        });

        // Fallback-Timeout
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve([]);
          }
        }, timeoutMs + 2000);
      } catch (err) {
        reject(err);
      }
    });
  }

  private async performAlternativeDiscovery(timeoutMs: number, resolve: Function, reject: Function): Promise<void> {
    try {
      logger.info('Using alternative discovery method (example2.js style)');
      
      const cameras: DiscoveredCamera[] = [];
      
      // Based on example2.js - we'll try a simplified approach
      // For now, return empty array as fallback
      logger.info('Fallback discovery method - returning empty results');
      setTimeout(() => {
        logger.info('Alternative discovery timeout reached, found %d cameras', cameras.length);
        resolve(cameras);
      }, timeoutMs);
      
    } catch (err) {
      logger.error('Alternative discovery failed:', err);
      reject(err);
    }
  }

  getDiscoveredCameras(): DiscoveredCamera[] {
    return Array.from(this.discoveredCameras.values());
  }

  clearDiscoveredCameras(): void {
    this.discoveredCameras.clear();
  }
}
