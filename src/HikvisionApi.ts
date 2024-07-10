// require('axios-debug-log');
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
}

export class HikvisionApi {
  private _http: AxiosDigestAuth;
  private _parser?: Parser;
  private log?: any;
  public _baseURL?: string;
  public connected: boolean = false;

  constructor(config: HikVisionNvrApiConfiguration, logger: any) {
    this._baseURL = `http${config.secure ? 's' : ''}://${config.host}`;
    const axios = Axios.create({
      httpsAgent: new https.Agent({
        rejectUnauthorized: !config.ignoreInsecureTls,
      }),
      timeout: 8000,
    });
    this._http = new AxiosDigestAuth({
      username: config.username,
      password: config.password,
      axios: axios,
    });
    this._parser = new Parser({ explicitArray: false });
    this.log = logger;
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

    const xmlParser = new xml2js.Parser({
      explicitArray: false,
    });

    /*
      EventNotificationAlert: {
        '$': { version: '2.0', xmlns: 'http://www.isapi.org/ver20/XMLSchema' },
        ipAddress: '10.0.1.186',
        portNo: '80',
        protocolType: 'HTTP',
        macAddress: 'f8:4d:fc:f8:ef:1c',
        dynChannelID: '1',
        channelID: '1',
        dateTime: '2020-02-19T18:44:4400:00',
        activePostCount: '1',
        eventType: 'fielddetection',
        eventState: 'active',
        eventDescription: 'fielddetection alarm',
        channelName: 'Front door',
        DetectionRegionList: { DetectionRegionEntry: [Object] }
      }
      */

    const url = '/ISAPI/Event/notification/alertStream';

    // TODO: what do we do if we lose our connection to the NVR? Don't we need to re-connect?
    const response = await this.get(url, {
      responseType: 'stream',
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    const stream = response?.data;
    stream.on('data', async (data: {
      [x: string]: any; toString: () => any;
    }) => {
      data = data.toString();
      // console.log('DATA', data, data.includes('<EventNotificationAlert'));
      if (data.includes('<EventNotificationAlert')) {
        const message = data.slice(data.indexOf('<EventNotificationAlert'));
        // console.log('Message', message);
        //       callback(xmlParser.parseStringPromise(message));
        const eventMsg = await xmlParser.parseStringPromise(message).then();
        // console.log('Response', response);
        callback(eventMsg);
      }
    });

    const stream = response?.data;
    stream.on('data', async (data: {
      [x: string]: any; toString: () => any;
    }) => {
      data = data.toString();
      // console.log('DATA', data, data.includes('<EventNotificationAlert'));
      if (data.includes('<EventNotificationAlert')) {
        const message = data.slice(data.indexOf('<EventNotificationAlert'));
        // console.log('Message', message);
        //       callback(xmlParser.parseStringPromise(message));
        const eventMsg = await xmlParser.parseStringPromise(message).then();
        // console.log('Response', response);
        callback(eventMsg);
      }
    });

    //  .then((response: any) => {
    //    highland(response!.data)
    //      .map((chunk: any) => chunk.toString('utf8'))
    //      .filter(text => text.match(/<EventNotificationAlert/))
    //      .findWhere(/<EventNotificationAlert/)
    //      .each(text => console.log('DATA', text))
    //       .map(xmlText => xmlParser.parseStringPromise(xmlText))
    //       .each(promise => promise.then(callback));
    //  });
  }

  async get(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse | undefined> {
    try {
      return await this._http.get(this._baseURL + url, config);
    } catch (e: any) {
      this.log.error('ERROR: get', this._baseURL + url, config, e.message);
    }
  }

  private async _getResponse(path: string) {
    try {
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
      this.log.error('ERROR: _getResponse', this._baseURL + path, e.message);
    }
  }
}
