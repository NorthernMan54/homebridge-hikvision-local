import https from 'https';
import DigestFetch from 'digest-fetch';
import { XMLParser } from 'fast-xml-parser';
import { PlatformConfig } from 'homebridge';
import { MultipartXmlStreamParser } from './lib/MultiPartXMLStreamParser.js';
import { createLoggedDigestFetch } from './lib/loggedDigestFetch.js';

export interface HikVisionNvrApiConfiguration extends PlatformConfig {
  host: string
  port: number
  secure: boolean
  ignoreInsecureTls: boolean
  username: string
  password: string
  debugFfmpeg: boolean
  doorbells: string[]
  debug: boolean
}

export class HikvisionApi {
  private xmlParser: XMLParser;
  private log?: any;
  private config: HikVisionNvrApiConfiguration;
  public _baseURL?: string;
  public connected: boolean = false;
  private client: DigestFetch;
  private abortController: AbortController | null = null;
  private isStreaming: boolean = false;

  constructor(config: HikVisionNvrApiConfiguration, log: any) {
    this._baseURL = `http${config.secure ? 's' : ''}://${config.host}`;
    this.config = config;
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
    });
    this.log = log;

    this.client = createLoggedDigestFetch(
      this.config.username,
      this.config.password,
      {
        algorithm: 'MD5',
        timeout: 8000,
        agent: new https.Agent({ rejectUnauthorized: !this.config.ignoreInsecureTls }),
      },
      (msg: string) => this.log.debug(msg), // or `console.log`
    );
  }

  /*
    "DeviceInfo": {
    "$": {
      "version": "2.0",
      "xmlns": "http://www.isapi.org/ver20/XMLSchema"
    },
    "deviceName": "Network Video Recorder",
    "deviceID": "48443030-3637-3534-3837-f84dfcf8ef1c",
    "model": "DS-7608NI-I2/8P",
    "serialNumber": "DS-7608NI-I2/8P0820190316CCRRD00675487WCVU",
    "macAddress": "f8:4d:fc:f8:ef:1c",
    "firmwareVersion": "V4.22.005",
    "firmwareReleasedDate": "build 191208",
    "encoderVersion": "V5.0",
    "encoderReleasedDate": "build 191208",
    "deviceType": "NVR",
    "telecontrolID": "255"
  }
  */

  public async getSystemInfo() {
    return this._getResponse('/ISAPI/System/deviceInfo');
  }

  async getCameras() {
    const channels = await this._getResponse('/ISAPI/System/Video/inputs/channels');

    if (channels.VideoInputChannelList) {
      for (let i = 0; i < channels.VideoInputChannelList.VideoInputChannel.length; i++) {
        const channel = channels.VideoInputChannelList.VideoInputChannel[i];
        if (channel.resDesc !== 'NO VIDEO') {
          channel.capabilities = await this._getResponse(`/ISAPI/ContentMgmt/StreamingProxy/channels/${channel.id}01/capabilities`);
        }
        channel.status = { online: channel.resDesc !== 'NO VIDEO' };
      }

      return channels.VideoInputChannelList.VideoInputChannel.filter((camera: { status: { online: boolean; }; }) => camera.status.online);
    } else {
      const channels2 = await this._getResponse('/ISAPI/ContentMgmt/InputProxy/channels');

      for (let i = 0; i < channels2.InputProxyChannelList.InputProxyChannel.length; i++) {
        const channel = channels2.InputProxyChannelList.InputProxyChannel[i];
        if (channel.resDesc !== 'NO VIDEO') {
          channel.capabilities = await this._getResponse(`/ISAPI/ContentMgmt/StreamingProxy/channels/${channel.id}01/capabilities`);
        }
        channel.status = { online: channel.resDesc !== 'NO VIDEO' };
      }

      return channels2.InputProxyChannelList.InputProxyChannel.filter((camera: { status: { online: boolean; }; }) => camera.status.online);
    }
  }

  async startMonitoringEvents(callback: (event: any) => void): Promise<void> {
    const url = `${this._baseURL}/ISAPI/Event/notification/alertStream`;
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

    const startStream = async () => {
      if (this.isStreaming) {
        this.log.debug('Stream already active, skipping new connection');
        return;
      }

      this.isStreaming = true;
      this.abortController = new AbortController();

      try {
        const res = await this.client.fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'multipart/mixed', // Adjusted for Hikvision event stream
          },
          signal: this.abortController.signal,
        });

        if (res.status === 403) {
          this.log.warn('Received 403 — likely expired digest nonce. Reconnecting...');
          this.isStreaming = false;
          setTimeout(startStream, 5000);
          return;
        }

        if (!res.ok || !res.body) {
          this.log.error(`Stream connection failed: ${res.status} -> ${res.statusText}`);
          this.isStreaming = false;
          setTimeout(startStream, 30000);
          return;
        }

        const streamParser = new MultipartXmlStreamParser();

        streamParser.on('message', (part) => {
          try {
            const event = parser.parse(part.body);
            callback(event);
          } catch (e) {
            this.log.error(`Failed to parse XML: ${e instanceof Error ? e.message : String(e)}`);
            this.log.debug(`Fragment: ${part.body}`);
          }
        });

        streamParser.on('error', (err) => {
          this.log.error(`Stream parse error: ${err}`);
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        const pump = async (): Promise<void> => {
          try {
            const { value, done } = await reader.read();
            if (done) {
              this.log.warn('Stream ended. Reconnecting...');
              this.isStreaming = false;
              setTimeout(startStream, 30000);
              return;
            }

            streamParser.write(decoder.decode(value, { stream: true }));
            await pump();
          } catch (err: any) {
            this.log.error(`Stream read error: ${err.message}`);
            this.isStreaming = false;
            setTimeout(startStream, 30000);
          }
        };

        await pump();
      } catch (err: any) {
        if (err.name === 'AbortError') {
          this.log.debug('Stream aborted');
        } else {
          this.log.error(`Stream error: ${err.message}`);
          this.isStreaming = false;
          setTimeout(startStream, 30000);
        }
      } finally {
        if (this.isStreaming) {
          this.isStreaming = false;
        }
      }
    };

    startStream();
  }

  stopMonitoringEvents(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isStreaming = false;
    this.log.debug('Stream stopped');
  }

  private async _getResponse(path: string): Promise<any | undefined> {
    try {
      const url = `${this._baseURL}${path}`;

      const client = createLoggedDigestFetch(
        this.config.username,
        this.config.password,
        {
          algorithm: 'MD5',
          timeout: 8000,
          agent: new https.Agent({ rejectUnauthorized: !this.config.ignoreInsecureTls }),
        },
        (msg: string) => this.log.debug(msg), // or `console.log`
      );

      // this.log.debug(`➡️ Fetching URL: ${url}`);

      const res = await client.fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/xml',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (res.status === 401) {
        this.log.error(`❌ Unauthorized (401): ${url}`);
        return;
      }

      const xml = await res.text();

      // Log raw response
      // this.log.debug(`⬅️ STATUS: ${res.status} ${res.statusText}`);
      // this.log.debug(`⬅️ HEADERS: ${JSON.stringify(Object.fromEntries(res.headers.entries()), null, 2)}`);
      // this.log.debug(`⬅️ BODY: ${xml}`);

      // Always attempt to parse XML (even for 403 or 404)
      let responseJson: any;
      try {
        responseJson = this.xmlParser.parse(xml);
      } catch (e: any) {
        this.log.error(`❌ Failed to parse XML from ${url}: ${e.message}`);
        return;
      }

      this.connected = true;
      return responseJson;

    } catch (e: any) {
      this.log.error(`❌ ERROR: _getResponse ${path} -> ${e.message}`);
    }
  }

}
