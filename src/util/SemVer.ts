export default class SemVer {
	constructor(
		public readonly major: number,
		public readonly minor: number,
		public readonly patch: number
	) { }

	public static fromString(str: string) {
		const components = str.split('.');
		if (components.length < 2) {
			throw new Error("SemVer needs at least two parts");
		}
		if (components.length > 3) {
			throw new Error("SemVer cannot have more than three parts");
		}
		const major = parseInt(components[0]);
		const minor = parseInt(components[1]);
		const patch = components.length > 2 ? parseInt(components[2]) : 0;
		if (major < 0 || minor < 0 || patch < 0) {
			throw new Error("SemVer must have positive parts only.")
		}

		return new SemVer(major, minor, patch);
	}

	public toString() {
		return `${this.major}.${this.minor}${this.patch == 0 ? '' : `.${this.patch}`}`
	}
}