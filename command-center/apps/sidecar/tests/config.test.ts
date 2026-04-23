import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateConfig, configFile, configDir } from '../src/config';

// Exercise the config shape + bearer-token persistence on a temp HOME so we
// don't touch the real ~/.jstudio-commander/ during test. `config.ts` now
// resolves paths per call (homedir() read at each call), so stubbing HOME
// in the test's beforeEach is sufficient — no import-cache dance needed.

describe('config.loadOrCreateConfig', () => {
  let tempHome: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'jstudio-n1-cfg-'));
    origHome = process.env.HOME;
    process.env.HOME = tempHome;
  });

  afterEach(async () => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    await rm(tempHome, { recursive: true, force: true });
  });

  it('resolves configDir/configFile against the stubbed HOME', () => {
    expect(configDir()).toBe(join(tempHome, '.jstudio-commander'));
    expect(configFile()).toBe(join(tempHome, '.jstudio-commander', 'config.json'));
  });

  it('mints a fresh UUID bearer on first run + persists config.json', async () => {
    const cfg = await loadOrCreateConfig(11005);
    expect(cfg.bearerToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(cfg.port).toBe(11005);
    expect(cfg.version).toBe('0.1.0-n1');

    const onDisk = JSON.parse(await readFile(configFile(), 'utf8'));
    expect(onDisk.bearerToken).toBe(cfg.bearerToken);
    expect(onDisk.port).toBe(11005);
  });

  it('preserves existing bearer across relaunches, rewrites port', async () => {
    const preBearer = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await mkdir(configDir(), { recursive: true });
    await writeFile(
      configFile(),
      JSON.stringify({ bearerToken: preBearer, port: 11002, version: 'old' }),
      'utf8',
    );

    const cfg = await loadOrCreateConfig(11007);
    expect(cfg.bearerToken).toBe(preBearer);
    expect(cfg.port).toBe(11007);

    const onDisk = JSON.parse(await readFile(configFile(), 'utf8'));
    expect(onDisk.bearerToken).toBe(preBearer);
    expect(onDisk.port).toBe(11007);
    expect(onDisk.version).toBe('0.1.0-n1');
  });
});
