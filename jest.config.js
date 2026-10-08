/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  setupFiles: ['dotenv/config'],
  testTimeout: 30000,
  coveragePathIgnorePatterns: ['/node_modules/'],

  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/server.ts',
    '!src/config/db.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 65,
      functions: 75,
      lines: 75,
      statements: 75,
    },
  },
};
