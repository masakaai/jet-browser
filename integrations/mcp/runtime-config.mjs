export const JET_BROWSER_IMAGE = 'ghcr.io/masakaai/jet-browser@sha256:5884204e128a3e5bb17634078affdf28d1933d2745752cee3bc74235ed316cec';

const nativePlatforms = {
  x64: 'linux/amd64',
  arm64: 'linux/arm64',
};

export const JET_BROWSER_PLATFORM = nativePlatforms[process.arch];
if (!JET_BROWSER_PLATFORM) {
  throw new Error(`Jet Browser does not publish a runtime for ${process.arch}`);
}
