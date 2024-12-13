// eslint-disable-next-line import/no-extraneous-dependencies
import {
  API,
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
  CameraControllerOptions,
  PlatformAccessory,
  PlatformConfig,
  Service,
  WithUUID,
} from 'homebridge';
// We borrow, rather cheekly from the homebridge-camera-ffmpeg plugin.
// TODO: probably rethink and do something like https://github.com/homebridge/homebridge-examples/tree/master/bridged-camera-example-typescript.
import { CameraConfig } from 'homebridge-camera-ffmpeg/dist/configTypes';
import { Logger } from 'homebridge-camera-ffmpeg/dist/logger';
import { StreamingDelegate } from 'homebridge-camera-ffmpeg/dist/streamingDelegate';

export class HikVisionCamera {
  log: any;
  config: any;
  any: any;
  camera?: any;
  motionDetected: boolean = false;
  homebridgeApi: API;
  displayName: string;
  UUID: string;
  accessory: any;

  constructor(log: any, homebridgeApi: API, accessory: PlatformAccessory, config: PlatformConfig) {
    this.log = log;
    this.homebridgeApi = homebridgeApi;
    this.accessory = accessory;
    this.displayName = this.accessory.displayName;
    this.UUID = accessory.UUID;
    this.config = config;

    this.configure(this.accessory);
  }

  getService(...args: any[]) {
    return this.accessory.getService(...args);
  }

  configureController(...args: any[]) {
    return this.accessory.configureController(...args);
  }

  addService(...args: any[]) {
    return this.accessory.addService(...args);
  }

  removeService(...args: any[]) {
    return this.accessory.removeService(...args);
  }

  on(...args: any[]) {
    this.accessory.on(...args);
  }

  getServiceByUUIDAndSubType<T extends WithUUID<typeof Service>>(
    uuid: string | T,
    subType: string,
  ): Service | undefined {
    return undefined;
  }

  configure(accessory: any) {
    this.log.info(
      `Configuring ${( this.config.doorbells && this.config.doorbells.includes(accessory.displayName) ? 'doorbell' : 'camera' )} accessory: ${accessory.displayName}`,
    );

    accessory.on('identify', () => {
      this.log(`${accessory.displayName} identified!`);
    });

    let motionSensor: Service | undefined = accessory.getService(
      this.homebridgeApi.hap.Service.MotionSensor,
    );
    if (motionSensor) {
      this.log.info('Re-creating motion sensor');
      accessory.removeService(motionSensor);
    } else {
      // this.log.warn('There was no motion sensor set up!');
    }

    motionSensor = new this.homebridgeApi.hap.Service.MotionSensor(
      accessory.displayName,
    );
    accessory.addService(motionSensor!);

    if (this.config.doorbells && this.config.doorbells.includes(accessory.displayName)) {
      this.log.info(`Creating Doorbell Trigger: ${accessory.displayName} Doorbell Trigger`);
      const doorbellService = new this.homebridgeApi.hap.Service.Doorbell(accessory.displayName + ' Doorbell');
      accessory.addService(doorbellService);
      const switchService = new this.homebridgeApi.hap.Service.Switch(accessory.displayName + ' Doorbell Trigger', 'DoorbellTrigger');
      switchService.getCharacteristic(this.homebridgeApi.hap.Characteristic.On)
        .on('set', (state: any, callback: any) => {
          this.log.info(`Doorbell trigger for ${accessory.displayName} - ${state}` );
          if (state) {
            doorbellService.getCharacteristic(this.homebridgeApi.hap.Characteristic.ProgrammableSwitchEvent).setValue(this.homebridgeApi.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
            setTimeout(() => {
              switchService.getCharacteristic(this.homebridgeApi.hap.Characteristic.On).updateValue(false);
            }, 5000);
          }
          callback(null);
        });
      accessory.addService(switchService);

    }

    //      doorbell.updateCharacteristic(hap.Characteristic.ProgrammableSwitchEvent, hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);

    const channelId = accessory.context.channelId;
    const cameraConfig = <CameraConfig>{
      name: accessory.displayName,
      videoConfig: {
        source: `-rtsp_transport tcp -i rtsp://${accessory.context.username}:${accessory.context.password}@${accessory.context.host}/Streaming/Channels/${channelId}01`,
        stillImageSource: `-i http${accessory.context.secure ? 's' : ''}://${accessory.context.username
        }:${accessory.context.password}@${accessory.context.host
        }/ISAPI/Streaming/channels/${channelId}01/picture?videoResolutionWidth=720`,
        maxFPS: 30, // TODO: pull this from the camera to avoid ever upsampling
        maxBitrate: 16384, // TODO: pull this from the camera to avoid ever upsampling
        maxWidth: 1920, // TODO: pull this from the camera to avoid ever upsampling
        vcodec: 'libx264',
        audio: accessory.context.hasAudio,
        debug: Boolean(accessory.context.debugFfmpeg),
      },
    };

    const cameraLogger = new Logger(this.log);

    // Use the homebridge-camera-ffmpeg StreamingDelegate.
    const streamingDelegate = new StreamingDelegate(
      cameraLogger,
      cameraConfig,
      this.homebridgeApi,
      this.homebridgeApi.hap,
      '',
    );

    const cameraControllerOptions: CameraControllerOptions = {
      cameraStreamCount: 5, // HomeKit requires at least 2 streams, but 1 is also just fine
      delegate: streamingDelegate,
      streamingOptions: {
        supportedCryptoSuites: [
          this.homebridgeApi.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80,
        ],
        video: {
          resolutions: [
            // TODO: put in the max framerates & resolutions from the camera config.
            [320, 180, 30],
            [320, 240, 15], // Apple Watch requires this configuration
            [320, 240, 30],
            [480, 270, 30],
            [480, 360, 30],
            [640, 360, 30],
            [640, 480, 30],
            [1280, 720, 30],
            [1280, 960, 30],
            [1920, 1080, 30],
            [1600, 1200, 30],
          ],
          codec: {
            profiles: [
              this.homebridgeApi.hap.H264Profile.BASELINE,
              this.homebridgeApi.hap.H264Profile.MAIN,
              this.homebridgeApi.hap.H264Profile.HIGH,
            ],
            levels: [
              this.homebridgeApi.hap.H264Level.LEVEL3_1,
              this.homebridgeApi.hap.H264Level.LEVEL3_2,
              this.homebridgeApi.hap.H264Level.LEVEL4_0,
            ],
          },
        },
        audio: {
          codecs: [
            {
              type: AudioStreamingCodecType.OPUS,
              samplerate: AudioStreamingSamplerate.KHZ_24,
            },
            {
              type: AudioStreamingCodecType.AAC_ELD,
              samplerate: AudioStreamingSamplerate.KHZ_16,
            },
          ],
        },
      },
    };

    const cameraController = new this.homebridgeApi.hap.CameraController(
      cameraControllerOptions, true,
    );

    accessory.configureController(cameraController);
  }
}
