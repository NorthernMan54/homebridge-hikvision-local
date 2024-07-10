// eslint-disable-next-line import/no-extraneous-dependencies
import { API, PlatformAccessory, PlatformConfig } from 'homebridge';
import { HikVisionCamera } from './HikVisionCamera';
import { HikVisionNvrApiConfiguration, HikvisionApi } from './HikvisionApi';
import { HIKVISION_PLUGIN_NAME } from '.';

export class HikVisionNVR {
  private homebridgeApi: API;
  private log: any;

  config: HikVisionNvrApiConfiguration;
  hikVisionApi: HikvisionApi;
  cameras: HikVisionCamera[];

  constructor(logger: any, config: PlatformConfig, api: API) {
    this.hikVisionApi = new HikvisionApi(config as HikVisionNvrApiConfiguration, logger);
    this.homebridgeApi = api;
    this.log = logger;
    this.config = config as HikVisionNvrApiConfiguration;
    this.cameras = [];

    this.log('Initialising accessories for HikVision...');

    this.homebridgeApi.on(
      'didFinishLaunching',
      this.startMonitoring.bind(this),
    );

    this.loadAccessories();
    setInterval(this.loadAccessories.bind(this), ( this.config.refresh ? this.config.refresh * 60 * 60 * 1000 : 12 * 60 * 60 * 1000));
  }

  async loadAccessories() {
    this.log.info('Connecting to NVR system @ %s', this.hikVisionApi._baseURL);
    const systemInformation = await this.hikVisionApi.getSystemInfo();
    if (this.hikVisionApi.connected) {
      this.log.info('Connected to NVR system: @ %s -> %O', this.hikVisionApi._baseURL, systemInformation.DeviceInfo.deviceName, systemInformation.DeviceInfo.model);

      this.log.info('Loading cameras...');
      const apiCameras = await this.hikVisionApi.getCameras();
      // this.log.debug('Found cameras: %s', JSON.stringify(apiCameras, null, 4));

      apiCameras.map((channel: {
        id: string;
        name: string;
        capabilities: any;
      }) => {

        const cameraConfig = {
          accessory: 'camera',
          name: channel.name,
          channelId: channel.id,
          hasAudio: channel.capabilities ? String(channel.capabilities.StreamingChannel.Audio.enabled._) == 'true' : false,
          doorbell: (this.config?.doorbells ? this.config?.doorbells.includes(channel.name) : false),
        };

        const cameraUUID = this.homebridgeApi.hap.uuid.generate(HIKVISION_PLUGIN_NAME + systemInformation.DeviceInfo.deviceID + cameraConfig.channelId,
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
    } else {
      this.log.error('Failed to connect to NVR system @ %s', this.hikVisionApi._baseURL);
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
    this.log(`Configuring accessory ${accessory.displayName}`);

    accessory.context = Object.assign(accessory.context, this.config);
    const camera = new HikVisionCamera(this.log, this.homebridgeApi, accessory, this.config);

    const cameraAccessoryInfo = camera.getService(
      this.homebridgeApi.hap.Service.AccessoryInformation,
    );
    cameraAccessoryInfo!.setCharacteristic(this.homebridgeApi.hap.Characteristic.Manufacturer, 'HikVision');
    // cameraAccessoryInfo!.setCharacteristic(this.homebridgeApi.hap.Characteristic.Model, systemInformation.DeviceInfo.model);
    // cameraAccessoryInfo!.setCharacteristic(this.homebridgeApi.hap.Characteristic.SerialNumber, systemInformation.DeviceInfo.serialNumber);
    // cameraAccessoryInfo!.setCharacteristic(this.homebridgeApi.hap.Characteristic.FirmwareRevision, systemInformation.DeviceInfo.firmwareVersion);

    this.cameras.push(camera);
  }

  private processHikVisionEvent(event: any) {
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
          return this.log.warn('Could not find camera for event', event);
        }

        this.log.info(
          'Motion detected on camera, triggering motion for ',
          camera.displayName,
        );

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
            this.log.debug('Disabling motion detection on camera', camera.displayName);
            camera.motionDetected = !motionDetected;
            camera
              .getService(this.homebridgeApi.hap.Service.MotionSensor)
              ?.setCharacteristic(
                this.homebridgeApi.hap.Characteristic.MotionDetected,
                !motionDetected,
              );
          }, 10000);
        }

      default:
        this.log.debug('event', event);
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
