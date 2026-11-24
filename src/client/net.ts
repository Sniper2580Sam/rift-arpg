// Online mode (sign-in, co-op rooms). Filled in by the co-op milestone.
export function onlineAvailable(): boolean { return location.protocol === "http:" || location.protocol === "https:" ? !location.hostname.endsWith("claude.ai") && !location.hostname.endsWith("claudeusercontent.com") : false; }
export function startOnline(root: HTMLElement) { root.className = "screen"; root.innerHTML = `<div class="panel hub"><h1>RIFT ARPG</h1><p>Online mode is not available in this build.</p></div>`; }
