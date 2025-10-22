declare module 'onvif' {
  export interface CamConstructor {
    new (config: {
      hostname: string;
      username: string;
      password: string;
      port?: number;
    }, callback: (err?: Error) => void): Cam;
  }

  export interface SnapshotUriResult {
    uri?: string;
  }

  export interface GetSnapshotUriCallback {
    (err?: Error, result?: SnapshotUriResult): void;
  }

  export interface GetSnapshotUriOptions {}

  export interface DiscoveryOptions {
    timeout?: number;
    resolve?: boolean;
    messageId?: number;
  }

  export interface DiscoveredDevice {
    name?: string;
    hostname?: string;
    address?: string;
    port?: number;
    hardware?: string;
    urn?: string;
  }

  export class Cam {
    constructor(
      config: {
        hostname: string;
        username: string;
        password: string;
        port?: number;
      },
      callback: (err?: Error) => void
    );

    removeAllListeners(): void;
    getSnapshotUri(options: GetSnapshotUriOptions, callback: GetSnapshotUriCallback): void;
  }

  export class Discovery {
    constructor(options: DiscoveryOptions);
    
    on(event: 'device', callback: (device: DiscoveredDevice) => void): void;
    on(event: 'error', callback: (error: Error) => void): void;
    on(event: 'done', callback: () => void): void;
    
    removeAllListeners(): void;
    probe(): void;
  }

  // Default export for CommonJS compatibility
  const onvif: {
    Cam: typeof Cam;
    Discovery: typeof Discovery;
  };
  export default onvif;
}
