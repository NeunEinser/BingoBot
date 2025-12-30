export function splitMessage(message: string) {
	const ans = [];
	while (message.length !== 0) {
		message = message.trim();
		let snippet = ""
		while (message.indexOf("\n\n") !== -1 && snippet.length + message.indexOf("\n\n") < 1999) {
			const index = message.indexOf("\n\n") + 2;
			snippet += message.substring(0, index);
			message = message.substring(index);
		}
		if (message.indexOf("\n\n") === -1 && snippet.length + message.length < 2000) {
			snippet += message
			message = ""
		}
		if (snippet.length === 0) {
			while (message.indexOf("\n") != -1 && snippet.length + message.indexOf("\n") < 1999) {
				const index = message.indexOf("\n") + 1;
				snippet += message.substring(0, index);
				message = message.substring(index);
			}
		}
		if (snippet.length === 0) {
			snippet = message.substring(0, 2000);
			message = message.substring(2000);
		}
		ans.push(snippet)
	}
	return ans;
}