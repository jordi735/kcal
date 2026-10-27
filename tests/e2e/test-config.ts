// Shared serial-suite resources. Isolated child fixtures use their own settings.
export const E2E_PORT = '3001';
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;
export const E2E_DATABASE_PATH = '/tmp/kcal-e2e.db';
export const E2E_AUTH_DIRECTORY = 'tests/e2e/.auth';
export const E2E_USER_STATE = `${E2E_AUTH_DIRECTORY}/user.json`;
export const E2E_USER2_STATE = `${E2E_AUTH_DIRECTORY}/user2.json`;
