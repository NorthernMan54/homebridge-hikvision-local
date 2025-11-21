import { API } from 'homebridge';

// Mock the HikVisionNVR module before importing index
jest.mock('./HikVisionNVR.js', () => ({
  HikVisionNVR: jest.fn().mockImplementation(() => ({
    // Mock implementation if needed
  })),
}));

describe('HikvisionLocal Platform', () => {
  let mockAPI: jest.Mocked<API>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAPI = {
      registerPlatform: jest.fn(),
      on: jest.fn(),
    } as any;
  });

  it('should export default function', () => {
    const indexModule = require('./index');
    expect(typeof indexModule.default).toBe('function');
  });

  it('should register the platform with homebridge', () => {
    const indexModule = require('./index');
    indexModule.default(mockAPI);

    expect(mockAPI.registerPlatform).toHaveBeenCalledTimes(1);
    expect(mockAPI.registerPlatform).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Function),
    );
  });
});
