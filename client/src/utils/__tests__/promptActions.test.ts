// Regression — the permission-prompt action mapper.
//
// The v2.1.114 "Do you want to make this edit to X?" permission prompt
// arrives from the server as { type: 'choice', options: [...] }. The
// original SessionTerminalPreview had branches for 'trust' / 'permission'
// / 'confirm' and silently rendered zero buttons for 'choice', stranding
// any fresh session that hit a numbered-choice prompt.
//
// The fix extracts the prompt → action mapping into a pure helper used
// by both SessionTerminalPreview (fresh-session surface) and
// PermissionPrompt (active-chat surface). Tests pin the contract so a
// future prompt-shape change can't quietly regress either surface.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPromptActions,
  type DetectedPrompt,
} from '../../utils/promptActions.js';

describe('getPromptActions — choice prompt (numbered-option pane)', () => {
  test('returns one command action per option, value = 1-based index', () => {
    const prompt: DetectedPrompt = {
      type: 'choice',
      message: 'Do you want to make this edit to test-file.txt?',
      options: [
        '1. Yes',
        '2. Yes, allow all edits during this session (shift+tab)',
        '3. No',
      ],
    };
    const actions = getPromptActions(prompt);
    assert.equal(actions.length, 3);
    assert.deepEqual(actions[0], { label: '1. Yes', type: 'command', value: '1' });
    assert.deepEqual(actions[1], {
      label: '2. Yes, allow all edits during this session (shift+tab)',
      type: 'command',
      value: '2',
    });
    assert.deepEqual(actions[2], { label: '3. No', type: 'command', value: '3' });
  });

  test('choice prompt with no options → empty list (no buttons, no throw)', () => {
    const prompt: DetectedPrompt = { type: 'choice', message: 'x' };
    assert.deepEqual(getPromptActions(prompt), []);
  });
});

describe('getPromptActions — trust prompt', () => {
  test('two buttons, yes → command yes, second → command no', () => {
    const prompt: DetectedPrompt = {
      type: 'trust',
      message: 'Trust this folder?',
      options: ['Yes, I trust this folder', 'No, exit'],
    };
    const actions = getPromptActions(prompt);
    assert.equal(actions.length, 2);
    assert.equal(actions[0]!.value, 'yes');
    assert.equal(actions[0]!.type, 'command');
    assert.equal(actions[1]!.value, 'no');
  });
});

describe('getPromptActions — permission prompt (Allow/Deny)', () => {
  test('Allow/Deny → y/n commands', () => {
    const prompt: DetectedPrompt = {
      type: 'permission',
      message: 'Allow bash?',
      options: ['Allow', 'Deny'],
    };
    const actions = getPromptActions(prompt);
    assert.equal(actions.length, 2);
    assert.equal(actions[0]!.value, 'y');
    assert.equal(actions[1]!.value, 'n');
  });

  test('Allow / Allow always / Deny → y / a / n', () => {
    const prompt: DetectedPrompt = {
      type: 'permission',
      message: 'Allow?',
      options: ['Allow', 'Allow always', 'Deny'],
    };
    const actions = getPromptActions(prompt);
    assert.equal(actions.length, 3);
    assert.equal(actions[0]!.value, 'y');
    assert.equal(actions[1]!.value, 'a');
    assert.equal(actions[2]!.value, 'n');
  });
});

describe('getPromptActions — confirm (y/n) prompt', () => {
  test('defaults to Yes/No when options absent; Yes = Enter key, No = Escape key', () => {
    const prompt: DetectedPrompt = { type: 'confirm', message: 'proceed?' };
    const actions = getPromptActions(prompt);
    assert.equal(actions.length, 2);
    assert.equal(actions[0]!.label, 'Yes');
    assert.equal(actions[0]!.type, 'key');
    assert.equal(actions[0]!.value, 'Enter');
    assert.equal(actions[1]!.label, 'No');
    assert.equal(actions[1]!.type, 'key');
    assert.equal(actions[1]!.value, 'Escape');
  });
});

describe('getPromptActions — unknown type fallback', () => {
  test('unknown type returns empty actions rather than throwing', () => {
    // Defensive — if a new prompt type ships server-side without a client
    // update, the UI must render no buttons (clean no-op) rather than
    // crash. The same surface still lets the user type a custom reply
    // via the free-text input, so this is recoverable.
    const prompt = { type: 'brand-new-type', message: 'x' } as DetectedPrompt;
    assert.deepEqual(getPromptActions(prompt), []);
  });
});
