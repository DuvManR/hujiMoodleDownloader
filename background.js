const MOODLE_URL_REGEX = /^https?:\/\/([^/]*\.)?moodle[^/]*\.huji\.ac\.il\//i;
const REMOTE_MANIFEST_URL =
	"https://raw.githubusercontent.com/DuvManR/hujiMoodleDownloader/main/manifest.json";
const PORTAL_UPDATE_URL = "https://duvmanr.github.io/hujiMed2033/#extension";
const UPDATE_CACHE_TTL_MS = 60 * 60 * 1000; // Check GitHub at most once per hour

// Helper to show a temporary Hebrew toast when clicked on a non-Moodle regular webpage
function showNonMoodleToastInPage() {
	const existing = document.getElementById("huji-non-moodle-toast");
	if (existing) existing.remove();

	const toast = document.createElement("div");
	toast.id = "huji-non-moodle-toast";
	toast.dir = "rtl";
	Object.assign(toast.style, {
		position: "fixed",
		top: "20px",
		left: "50%",
		transform: "translateX(-50%) translateY(-10px)",
		background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
		color: "#f8fafc",
		padding: "12px 20px",
		borderRadius: "14px",
		boxShadow: "0 12px 30px rgba(15, 23, 42, 0.28)",
		border: "1px solid rgba(99, 102, 241, 0.45)",
		fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
		fontSize: "14px",
		fontWeight: "600",
		zIndex: "2147483647",
		display: "flex",
		alignItems: "center",
		gap: "10px",
		opacity: "0",
		transition: "opacity 0.25s ease, transform 0.25s ease",
	});

	toast.innerHTML = `
		<span style="width: 8px; height: 8px; border-radius: 50%; background: #14b8a6; display: inline-block; flex-shrink: 0;"></span>
		<span>יש להיכנס לעמוד קורס במודל האוניברסיטה העברית כדי להפעיל את התוסף!</span>
	`;

	document.body.appendChild(toast);
	requestAnimationFrame(() => {
		toast.style.opacity = "1";
		toast.style.transform = "translateX(-50%) translateY(0)";
	});

	setTimeout(() => {
		toast.style.opacity = "0";
		toast.style.transform = "translateX(-50%) translateY(-10px)";
		setTimeout(() => toast.remove(), 300);
	}, 4000);
}

// Show a temporary badge indicator on the extension icon
function flashBadge(tabId) {
	chrome.action.setBadgeText({ text: "!", tabId });
	chrome.action.setBadgeBackgroundColor({ color: "#f59e0b", tabId });
	setTimeout(() => {
		chrome.action.setBadgeText({ text: "", tabId });
	}, 3500);
}

chrome.action.onClicked.addListener(async (tab) => {
	if (!tab || !tab.id) return;

	try {
		await chrome.tabs.sendMessage(tab.id, { action: "toggleGUI" });
	} catch (err) {
		const url = tab.url || "";

		// If the user is already on Moodle (e.g., tab was open before installing), inject content.js automatically
		if (MOODLE_URL_REGEX.test(url)) {
			try {
				await chrome.scripting.executeScript({
					target: { tabId: tab.id },
					files: ["content.js"],
				});
				await chrome.tabs.sendMessage(tab.id, { action: "toggleGUI" });
				return;
			} catch (injectErr) {
				console.log("Failed to auto-inject content script:", injectErr);
			}
		}

		// User clicked outside Moodle — give clear visual feedback
		flashBadge(tab.id);
		if (url.startsWith("http://") || url.startsWith("https://")) {
			chrome.scripting
				.executeScript({
					target: { tabId: tab.id },
					func: showNonMoodleToastInPage,
				})
				.catch(() => {});
		}
	}
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.action === "checkUpdate") {
		checkForExtensionUpdate().then((result) => sendResponse(result));
		return true;
	} else if (request.action === "downloadFile") {
		// Trigger the safe download mechanism with 3 retries to prevent network errors
		downloadWithRetry(request.url, request.filename, 3).then((result) =>
			sendResponse(result)
		);
		return true; // Keep the message channel open for asynchronous response
	} else if (request.action === "resolveRedirect") {
		// Follow external redirects (e.g., Google Maps/Forms) bypassing CORS
		fetch(request.url)
			.then((res) => sendResponse({ success: true, finalUrl: res.url }))
			.catch((err) =>
				sendResponse({ success: false, error: err.toString() })
			);
		return true;
	} else if (request.action === "fetchPanoptoStreams") {
		handleFetchPanoptoStreams(request.url)
			.then((result) => sendResponse(result))
			.catch((err) =>
				sendResponse({ success: false, error: err.toString() })
			);

		return true; // Keep the message channel open for asynchronous response
	}
});

// =========================================================================
// Automatic Update Check against GitHub manifest.json
// =========================================================================
let cachedUpdateCheck = null;
let lastUpdateCheckTime = 0;

function compareVersions(remoteVer, localVer) {
	const r = String(remoteVer || "0")
		.split(".")
		.map((n) => parseInt(n, 10) || 0);
	const l = String(localVer || "0")
		.split(".")
		.map((n) => parseInt(n, 10) || 0);
	const len = Math.max(r.length, l.length);
	for (let i = 0; i < len; i++) {
		const rv = r[i] || 0;
		const lv = l[i] || 0;
		if (rv > lv) return 1;
		if (rv < lv) return -1;
	}
	return 0;
}

async function checkForExtensionUpdate() {
	const currentVersion = chrome.runtime.getManifest().version;

	if (
		cachedUpdateCheck &&
		Date.now() - lastUpdateCheckTime < UPDATE_CACHE_TTL_MS
	) {
		return cachedUpdateCheck;
	}

	try {
		const res = await fetch(`${REMOTE_MANIFEST_URL}?t=${Date.now()}`, {
			cache: "no-store",
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);

		const remoteManifest = await res.json();
		const latestVersion = (remoteManifest.version || "").trim();
		const hasUpdate = Boolean(
			latestVersion && compareVersions(latestVersion, currentVersion) > 0
		);

		const result = {
			success: true,
			hasUpdate,
			currentVersion,
			latestVersion: latestVersion || currentVersion,
			portalUrl: PORTAL_UPDATE_URL,
		};

		cachedUpdateCheck = result;
		lastUpdateCheckTime = Date.now();
		return result;
	} catch (err) {
		return {
			success: false,
			hasUpdate: false,
			currentVersion,
			latestVersion: currentVersion,
			portalUrl: PORTAL_UPDATE_URL,
		};
	}
}

// Track silent Panopto authentication attempts to prevent opening multiple tabs
let panoptoAuthInProgress = null;
let lastPanoptoAuthTime = 0;

// Fetch Panopto .m3u8 streams directly from DeliveryInfo API
async function fetchPanoptoDeliveryStreams(host, videoId) {
	const res = await fetch(
		`https://${host}/Panopto/Pages/Viewer/DeliveryInfo.aspx`,
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: `deliveryId=${videoId}&responseType=json`,
			credentials: "include",
		}
	);
	const text = await res.text();
	let streams = [];

	try {
		const data = JSON.parse(text);
		if (data.Delivery && data.Delivery.Streams) {
			streams = data.Delivery.Streams.map((s) => s.StreamUrl).filter(
				(url) => url && url.includes(".m3u8")
			);
		}
	} catch (e) {}

	// Fallback regex extraction in case JSON parsing fails
	if (streams.length === 0) {
		const matches = text.match(
			/https:\/\/[^"'\s<>]*master\.m3u8[^"'\s<>]*/gi
		);
		if (matches) {
			streams = [...new Set(matches)];
		}
	}

	return streams;
}

// Silently open a background tab for a few seconds to trigger HUJI SSO and refresh Panopto cookies
function refreshPanoptoSessionSilently(viewerUrl) {
	if (panoptoAuthInProgress) return panoptoAuthInProgress;

	panoptoAuthInProgress = new Promise((resolve) => {
		let authTabId = null;
		let settled = false;
		let settleTimer = null;

		const cleanupAndResolve = () => {
			if (settled) return;
			settled = true;
			clearTimeout(maxTimeout);
			clearTimeout(settleTimer);
			chrome.tabs.onUpdated.removeListener(onTabUpdated);
			if (authTabId !== null) {
				chrome.tabs.remove(authTabId).catch(() => {});
			}
			lastPanoptoAuthTime = Date.now();
			panoptoAuthInProgress = null;
			resolve();
		};

		// Failsafe: never leave a background tab open for more than 12 seconds
		const maxTimeout = setTimeout(cleanupAndResolve, 12000);

		const onTabUpdated = (tabId, changeInfo, tab) => {
			if (tabId !== authTabId) return;
			if (changeInfo.status === "complete") {
				const currentUrl = tab.url || "";
				// Wait briefly once Panopto finishes loading so session cookies are fully written
				if (currentUrl.includes("panopto")) {
					clearTimeout(settleTimer);
					settleTimer = setTimeout(cleanupAndResolve, 2000);
				}
			}
		};

		chrome.tabs.onUpdated.addListener(onTabUpdated);

		chrome.tabs
			.create({ url: viewerUrl, active: false })
			.then((tab) => {
				authTabId = tab.id;
			})
			.catch(() => {
				cleanupAndResolve();
			});
	});

	return panoptoAuthInProgress;
}

// Main handler: try direct fetch, and if session is missing, silently authenticate once and retry
async function handleFetchPanoptoStreams(url) {
	const urlObj = new URL(url);
	const videoId = urlObj.searchParams.get("id");
	const host = urlObj.hostname;

	if (!videoId) {
		return { success: true, streams: [] };
	}

	let streams = await fetchPanoptoDeliveryStreams(host, videoId);

	// If no streams returned and we haven't tried silent auth in the last 60 seconds, refresh session
	if (streams.length === 0 && Date.now() - lastPanoptoAuthTime > 60000) {
		await refreshPanoptoSessionSilently(url);
		streams = await fetchPanoptoDeliveryStreams(host, videoId);
	}

	return { success: true, streams };
}

// Background retry function for failed downloads
async function downloadWithRetry(url, filename, retries) {
	for (let i = 0; i < retries; i++) {
		try {
			await startAndWaitForDownload(url, filename);
			return { success: true };
		} catch (error) {
			console.log(
				`Download failed for ${filename}, attempt ${
					i + 1
				} of ${retries}. Error: ${error.message}`
			);
			if (i === retries - 1) {
				return { success: false, error: error.message }; // Finally fail after max attempts
			}
			await new Promise((res) => setTimeout(res, 1500)); // Wait 1.5 seconds before retrying
		}
	}
}

// Function that halts execution until the specific file is successfully downloaded
function startAndWaitForDownload(url, filename) {
	return new Promise((resolve, reject) => {
		chrome.downloads.download(
			{
				url: url,
				filename: filename,
				conflictAction: "overwrite",
			},
			(downloadId) => {
				if (chrome.runtime.lastError) {
					return reject(new Error(chrome.runtime.lastError.message));
				}

				// Failsafe mechanism: if a file is stuck for more than 2 minutes, abort to prevent script freezing
				let timeoutId = setTimeout(() => {
					chrome.downloads.onChanged.removeListener(listener);
					chrome.downloads.cancel(downloadId);
					reject(new Error("Download timed out after 2 minutes"));
				}, 120000);

				function listener(delta) {
					if (delta.id === downloadId && delta.state) {
						if (delta.state.current === "complete") {
							clearTimeout(timeoutId);
							chrome.downloads.onChanged.removeListener(listener);
							resolve();
						} else if (delta.state.current === "interrupted") {
							clearTimeout(timeoutId);
							chrome.downloads.onChanged.removeListener(listener);
							reject(
								new Error(
									delta.error?.current ||
										"Interrupted by network/user"
								)
							);
						}
					}
				}
				chrome.downloads.onChanged.addListener(listener);
			}
		);
	});
}