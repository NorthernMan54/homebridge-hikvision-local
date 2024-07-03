// eslint-disable-next-line import/no-extraneous-dependencies
import { API } from 'homebridge';
import { HikVisionNVR } from './HikVisionNVR';

export const HIKVISION_PLATFORM_NAME = 'Hikvision-Local';
export const HIKVISION_PLUGIN_NAME = 'homebridge-hikvision-local';

export default function main(api: API) {
  api.registerPlatform(
    HIKVISION_PLUGIN_NAME,
    HIKVISION_PLATFORM_NAME,
    HikVisionNVR,
  );
}
