import '@testing-library/jest-dom';
import { cleanup } from '@test/utils';

// Mock fetch globally
global.fetch = jest.fn();

afterEach(() => {
  jest.clearAllMocks();

  cleanup();
});
