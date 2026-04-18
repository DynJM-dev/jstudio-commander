import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EFFORT_LEVELS,
  SESSION_TYPES,
  SESSION_TYPE_EFFORT_DEFAULTS,
} from '../types/session.js';

describe('Session effort matrix (Phase M1)', () => {
  test('EFFORT_LEVELS includes medium as a first-class value', () => {
    assert.ok(EFFORT_LEVELS.includes('medium'));
  });

  test('SESSION_TYPES contains pm, coder, raw', () => {
    assert.deepEqual([...SESSION_TYPES].sort(), ['coder', 'pm', 'raw']);
  });

  test('SESSION_TYPE_EFFORT_DEFAULTS matches the Phase M1 spec', () => {
    assert.equal(SESSION_TYPE_EFFORT_DEFAULTS.pm, 'high');
    assert.equal(SESSION_TYPE_EFFORT_DEFAULTS.coder, 'medium');
    assert.equal(SESSION_TYPE_EFFORT_DEFAULTS.raw, 'medium');
  });

  test('every default effort is a member of EFFORT_LEVELS', () => {
    for (const effort of Object.values(SESSION_TYPE_EFFORT_DEFAULTS)) {
      assert.ok(
        EFFORT_LEVELS.includes(effort),
        `default ${effort} missing from EFFORT_LEVELS`,
      );
    }
  });
});
