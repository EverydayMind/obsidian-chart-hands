import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export async function bumpVersion(directory) {
	const readJson = async (name) => JSON.parse(await readFile(resolve(directory, name), 'utf8'));
	const packageJson = await readJson('package.json');
	const manifest = await readJson('manifest.json');
	const versions = await readJson('versions.json');
	if (!versionPattern.test(packageJson.version) || !versionPattern.test(manifest.minAppVersion)) {
		throw new Error('Package version and minimum app version must use x.y.z without a prefix.');
	}
	manifest.version = packageJson.version;
	versions[packageJson.version] = manifest.minAppVersion;
	await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, '\t') + '\n');
	await writeFile(resolve(directory, 'versions.json'), JSON.stringify(versions, null, '\t') + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	await bumpVersion(process.cwd());
}
