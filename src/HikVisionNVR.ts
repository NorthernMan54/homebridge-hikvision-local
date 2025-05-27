// eslint-disable-next-line import/no-extraneous-dependencies
import { API, PlatformAccessory, PlatformConfig } from 'homebridge';
import { HikVisionCamera } from './HikVisionCamera.js';
import { HikVisionNvrApiConfiguration, HikvisionApi } from './HikvisionApi.js';
import { Log } from './lib/logger.js';
import { HIKVISION_PLUGIN_NAME } from './index.js';

export class HikVisionNVR {
  private homebridgeApi: API;
  private log: Log;

  config: HikVisionNvrApiConfiguration;
  hikVisionApi: HikvisionApi;
  cameras: HikVisionCamera[];

  constructor(log: any, config: PlatformConfig, api: API) {
    this.log = new Log(log, config.debug);
    this.homebridgeApi = api;
    this.hikVisionApi = new HikvisionApi(config as HikVisionNvrApiConfiguration, this.log);

    this.config = config as HikVisionNvrApiConfiguration;
    this.cameras = [];

    this.log.info('Initialising accessories for HikVision...');

    this.homebridgeApi.on(
      'didFinishLaunching',
      this.loadAccessories.bind(this),
    );
    setInterval(this.loadAccessories.bind(this), (this.config.refresh ? this.config.refresh * 60 * 60 * 1000 : 12 * 60 * 60 * 1000));
  }

  async loadAccessories() {
    this.log.info(`Connecting to NVR system @ ${this.hikVisionApi._baseURL}`);
    const systemInformation = await this.hikVisionApi.getSystemInfo();
    if (this.hikVisionApi.connected) {
      this.log.info(`Connected to NVR system: @ ${this.hikVisionApi._baseURL} -> '${systemInformation.DeviceInfo.deviceName}' ${systemInformation.DeviceInfo.model}`);
      this.log.info('Loading cameras...');
      const apiCameras = await this.hikVisionApi.getCameras();
      this.log.debug(`Found cameras: ${JSON.stringify(apiCameras, null, 2)}`);

      apiCameras.map((channel: {
        id: string;
        name: string;
        capabilities: any;
        sourceInputPortDescriptor: any
      }) => {

        if (!channel.capabilities.StreamingChannel) {
          this.log.error(`Failed to connect to NVR system, incomplete config @ ${this.hikVisionApi._baseURL}`);
          return;
        }

        if (this.config.maxWidth || this.config.maxWidth) {
          this.log.debug(`Overriding supplied camera config ${channel.name} - ${channel.capabilities.StreamingChannel.Video?.videoResolutionWidth?.['#text']}x${channel.capabilities.StreamingChannel.Video?.videoResolutionHeight?.['#text']} with ${this.config.maxWidth}x${this.config.maxHeight}`);
        }

        const cameraConfig = {
          accessory: 'camera',
          name: (this.config.test ? 'Test ' : '') + channel.name,
          channelId: channel.id,
          hasAudio: channel.capabilities ? String(channel.capabilities.StreamingChannel.Audio.enabled['#text']) == 'true' : false,
          doorbell: (this.config?.doorbells ? this.config?.doorbells.includes(channel.name) : false),
          model: channel.sourceInputPortDescriptor?.model,
          maxFPS: channel.capabilities.StreamingChannel.Video?.maxFrameRate?.['#text'] / 100,
          maxBitrate: channel.capabilities.StreamingChannel.Video?.vbrUpperCap?.['#text'],
          maxWidth: (this.config.maxWidth ? this.config.maxWidth : channel.capabilities.StreamingChannel.Video?.videoResolutionWidth?.['#text']),
          maxHeight: (this.config.maxHeight ? this.config.maxHeight : channel.capabilities.StreamingChannel.Video?.videoResolutionHeight?.['#text']),
        };

        const cameraUUID = this.homebridgeApi.hap.uuid.generate((this.config.test ? 'Test ' : '') + HIKVISION_PLUGIN_NAME + systemInformation.DeviceInfo.deviceID + cameraConfig.channelId,
        );

        let accessoryType = this.homebridgeApi.hap.Accessory.Categories.CAMERA;
        if (cameraConfig.doorbell) {
          accessoryType = this.homebridgeApi.hap.Accessory.Categories.VIDEO_DOORBELL;
        }
        const accessory: PlatformAccessory = new this.homebridgeApi.platformAccessory(
          cameraConfig.name,
          cameraUUID,
          accessoryType,
        );
        accessory.context = cameraConfig;

        // Only add new cameras that are not cached
        if (!this.cameras.find((x) => x.UUID === accessory.UUID)) {
          this.configureAccessory(accessory); // abusing the configureAccessory here
          this.homebridgeApi.publishExternalAccessories(
            HIKVISION_PLUGIN_NAME,
            [accessory],
          );
        }

        return accessory;
      });

      this.log.info('Registering cameras with homebridge');
      this.startMonitoring();
    } else {
      this.log.error(`Failed to connect to NVR system @ ${this.hikVisionApi._baseURL}`);
    }

    // var camerasToRemove: any[] = [];
    // // Remove cameras that were not in previous call
    // this.cameras.forEach((camera: any) => {
    //   if (!newAccessories.find((x: PlatformAccessory) => x.UUID === camera.UUID)) {
    //     this.log(`Unregistering missing camera: ${camera.UUID}`)
    //     camerasToRemove.push(camera.accessory);
    //   }
    // });

    // this.homebridgeApi.unregisterPlatformAccessories(HIKVISION_PLUGIN_NAME, HIKVISION_PLATFORM_NAME, camerasToRemove);
  }

  async configureAccessory(accessory: PlatformAccessory) {

    accessory.context = Object.assign(accessory.context, this.config);
    const camera = new HikVisionCamera(this.log, this.homebridgeApi, accessory, this.config);

    const cameraAccessoryInfo = camera.getService(
      this.homebridgeApi.hap.Service.AccessoryInformation,
    );
    cameraAccessoryInfo!.setCharacteristic(this.homebridgeApi.hap.Characteristic.Manufacturer, 'HikVision');
    cameraAccessoryInfo!.setCharacteristic(this.homebridgeApi.hap.Characteristic.Model, accessory.context.model);
    // cameraAccessoryInfo!.setCharacteristic(this.homebridgeApi.hap.Characteristic.SerialNumber, systemInformation.DeviceInfo.serialNumber);
    // cameraAccessoryInfo!.setCharacteristic(this.homebridgeApi.hap.Characteristic.FirmwareRevision, systemInformation.DeviceInfo.firmwareVersion);

    this.cameras.push(camera);
  }

  private processHikVisionEvent(event: any) {
    try {
      switch (event.EventNotificationAlert.eventType) {
        case 'videoloss':
          this.log.debug('videoloss, nothing to do...');
          break;
        case 'fielddetection':
        case 'linedetection':
        case 'shelteralarm':
        case 'VMD':
          const motionDetected =
          event.EventNotificationAlert.eventState === 'active';
          const channelId = (event.EventNotificationAlert.channelID ? event.EventNotificationAlert.channelID : event.EventNotificationAlert.dynChannelID);

          const camera = this.cameras.find(
            (data) => data.accessory.context.channelId === channelId,
          );
          if (!camera) {
            return this.log.warn(`Could not find camera for event ${event}`);
          }

          this.log.info(`Motion detected on camera, triggering motion for ${camera.displayName}`);

          if (motionDetected !== camera.motionDetected) {
            camera.motionDetected = motionDetected;
            const motionService = camera.getService(
              this.homebridgeApi.hap.Service.MotionSensor,
            );
            motionService?.setCharacteristic(
              this.homebridgeApi.hap.Characteristic.MotionDetected,
              motionDetected,
            );

            setTimeout(() => {
              this.log.debug(`Disabling motion detection on camera ${camera.displayName}`);
              camera.motionDetected = !motionDetected;
              camera
                .getService(this.homebridgeApi.hap.Service.MotionSensor)
                ?.setCharacteristic(
                  this.homebridgeApi.hap.Characteristic.MotionDetected,
                  !motionDetected,
                );
            }, 10000);
          }
          break;
        default:
          this.log.debug(`event ${JSON.stringify(event)}`);
      }
    } catch (err) {
      this.log.error(`Error processing HikVision event: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  startMonitoring() {
    if (this.hikVisionApi.connected) {
      this.hikVisionApi.startMonitoringEvents(
        this.processHikVisionEvent.bind(this),
      );
    }
  }
}
