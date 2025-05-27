// require('axios-debug-log');
import https from 'https';
import { AxiosDigestAuth } from '@lukesthl/ts-axios-digest-auth';
import Axios from 'axios';
// eslint-disable-next-line import/no-extraneous-dependencies
import DigestFetch from 'digest-fetch';
import { XMLParser } from 'fast-xml-parser';
import { PlatformConfig } from 'homebridge';
import { MultipartXmlStreamParser } from './lib/MultiPartXMLStreamParser.js';

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

  constructor(config: HikVisionNvrApiConfiguration, log: any) {
    this._baseURL = `http${config.secure ? 's' : ''}://${config.host}`;
    this.config = config;
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
    });
    this.log = log;

    this.client = new DigestFetch(this.config.username, this.config.password, {
      algorithm: 'MD5',
      timeout: 10000,
    });
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
      try {
        const res = await this.client.fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });
        
        if (res.status === 403) {
          this.log.warn('Received 403 — likely expired digest nonce. Reconnecting...');
          setTimeout(startStream, 5000); // shorter reconnect for nonce errors
          return;
        }
        
        if (!res.ok || !res.body) {
          this.log.error(`Stream connection failed: ${res.status} -> ${res.statusText}`);
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
          const { value, done } = await reader.read();
          if (done) {
            this.log.warn('Stream ended. Reconnecting...');
            setTimeout(startStream, 30000);
            return;
          }
  
          streamParser.write(decoder.decode(value, { stream: true }));
          await pump();
        };
  
        await pump();
      } catch (err) {
        this.log.error(`Stream error: ${err}`);
        setTimeout(startStream, 30000);
      }
    };
  
    startStream();
  }
  
  private async _getResponse(path: string) {
    try {
      // this.log.debug(`_getResponse ${this._baseURL + path}`);
      const http = new AxiosDigestAuth({
        username: this.config.username,
        password: this.config.password,
        axios: Axios.create({
          httpsAgent: new https.Agent({
            rejectUnauthorized: !this.config.ignoreInsecureTls,
          }),
          timeout: 8000,
        }),
      });
      const response = await http?.get<string>(this._baseURL + path, {
        validateStatus: function (status) {
          if (status !== 401) {
            return true; // Resolve only if the status code is less than 500
          } else {
            return false;
          }
        },
      });
      const responseJson = await this.xmlParser.parse(response?.data);
      this.connected = true;
      return responseJson;
    } catch (e: any) {
      this.log.error(`ERROR: _getResponse ${this._baseURL + path} -> ${e.message}`);
    }
  }

}
