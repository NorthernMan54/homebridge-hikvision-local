require('axios-debug-log');
import https from 'https';
import { AxiosDigestAuth } from '@lukesthl/ts-axios-digest-auth';
import Axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
// eslint-disable-next-line import/no-extraneous-dependencies
import { PlatformConfig } from 'homebridge';
import xml2js, { Parser } from 'xml2js';

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
  private _http: AxiosDigestAuth;
  private _httpStream: AxiosDigestAuth;
  private _parser?: Parser;
  private log?: any;
  public _baseURL?: string;
  public connected: boolean = false;

  constructor(config: HikVisionNvrApiConfiguration, log: any) {
    this._baseURL = `http${config.secure ? 's' : ''}://${config.host}`;
    this._http = new AxiosDigestAuth({
      username: config.username,
      password: config.password,
      axios: Axios.create({
        httpsAgent: new https.Agent({
          rejectUnauthorized: !config.ignoreInsecureTls,
        }),
        timeout: 8000,
      }),
    });
    this._httpStream = new AxiosDigestAuth({
      username: config.username,
      password: config.password,
      axios: Axios.create({
        httpsAgent: new https.Agent({
          rejectUnauthorized: !config.ignoreInsecureTls,
        }),
      }),
    });
    this._parser = new Parser({ explicitArray: false });
    this.log = log;
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

  async startMonitoringEvents(callback: (value: any) => any) {
    this.log.info('Starting event monitoring...');
    const url = '/ISAPI/Event/notification/alertStream';

    const xmlParser = new xml2js.Parser({
      explicitArray: false,
    });

    const startStream = async () => {
      try {
        const response = await this.getStream(url, {
          responseType: 'stream',
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        this.log.info(`Event Monitoring Connection Status ${response?.status} -> ${response?.statusText}`);

        if (response?.status !== 200) {
          throw new Error(`Failed to start stream, retrying... ${response?.status} -> ${response?.statusText}`);
        } else {
          const stream = response?.data;
          // eslint-disable-next-line @typescript-eslint/no-use-before-define
          handleStream(stream);
        }
      } catch (error) {
        this.log.error(`Failed to start stream, retrying... ${error}`);
        setTimeout(startStream, 5000); // Retry after 5 seconds
      }
    };

    const handleStream = async (stream: any) => {
      stream.on('error', (error: any) => {
        this.log.error(`Stream error, restarting connection...${error}`);
        startStream();
      });

      //  stream.on('end', () => {
      //    this.log.info('Stream ended, restarting connection...');
      //    startStream();
      //  });

      stream.on('close', () => {
        this.log.info('Stream closed, restarting connection...');
        startStream();
      });

      stream.on('finish', () => {
        this.log.info('Stream finished, restarting connection...');
        startStream();
      });

      stream.on('pause', () => {
        this.log.debug('stream PAUSE');
      });

      stream.on('resume', () => {
        this.log.debug('stream RESUME');
      });

      stream.on('unpipe', () => {
        this.log.debug('stream UNPIPE');
      });

      stream.on('data', async (data: { [x: string]: any; toString: () => any; }) => {
        data = data.toString();
        // console.log('DATA', data);
        if (data.includes('<EventNotificationAlert')) {
          const message = data.slice(data.indexOf('<EventNotificationAlert'));
          const eventMsg = await xmlParser.parseStringPromise(message);
          callback(eventMsg);
        }
      });
    };

    startStream();
  }

  private async getStream(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse | undefined> {
    try {
      // this.log.debug('GET', this._baseURL + url, config);
      return await this._httpStream.get(this._baseURL + url, config);
    } catch (e: any) {
      this.log.error(`ERROR: getStream ${this._baseURL + url} -> ${config} ${e}`);
    }
  }

  private async _getResponse(path: string) {
    try {
      // this.log.debug(`_getResponse ${this._baseURL + path}`);
      const response = await this._http?.get<string>(this._baseURL + path, {
        validateStatus: function (status) {
          if (status !== 401) {
            return true; // Resolve only if the status code is less than 500
          } else {
            return false;
          }
        },
      });
      const responseJson = await this._parser?.parseStringPromise(response?.data);
      this.connected = true;
      return responseJson;
    } catch (e: any) {
      this.log.error(`ERROR: _getResponse ${this._baseURL + path} -> ${e.message}`);
    }
  }
  
}
