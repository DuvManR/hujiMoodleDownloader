(() => {
	// Guard against duplicate script injection
	if (window.__hujiMoodleDownloaderLoaded) return;
	window.__hujiMoodleDownloaderLoaded = true;

	// Global state variables
	let isAborted = false;
	let isRunning = false;
	let totalTasks = 0;
	let completedTasks = 0;
	let failedDownloads = [];
	let widgetShadow = null;
	let noticeTimeoutId = null;

	// Helper to query elements inside the isolated Shadow DOM
	function getEl(id) {
		return widgetShadow ? widgetShadow.getElementById(id) : null;
	}

	chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
		if (request.action === "toggleGUI") {
			createOrToggleGUI();
		}
	});

	// Check GitHub manifest.json via background worker and show update banner if newer version exists
	function checkAndRenderUpdateBanner() {
		try {
			chrome.runtime.sendMessage({ action: "checkUpdate" }, (res) => {
				if (chrome.runtime.lastError || !res || !res.hasUpdate) return;

				const banner = getEl("huji-update-banner");
				const versionText = getEl("huji-update-version-text");
				const updateLink = getEl("huji-update-link");
				if (!banner || !versionText || !updateLink) return;

				versionText.textContent = `זמינה גרסה חדשה (v${res.latestVersion})!`;
				updateLink.href = res.portalUrl;
				banner.classList.add("visible");
			});
		} catch (e) {}
	}

	// Inline notification helper (replaces browser alert() popups)
	function showInlineNotice(message, type = "warning") {
		const banner = getEl("huji-inline-notice");
		if (!banner) return;

		banner.textContent = message;
		banner.className = `inline-notice visible ${type}`;

		if (noticeTimeoutId) clearTimeout(noticeTimeoutId);
		noticeTimeoutId = setTimeout(() => {
			banner.classList.remove("visible");
		}, 4000);
	}

	// Update live counter on the "Download Selected" button
	function updateSelectedCounter() {
		if (!widgetShadow) return;
		const panoptoChecked = widgetShadow.querySelectorAll(
			".huji-panopto-checkbox:checked"
		).length;
		const sectionsChecked = widgetShadow.querySelectorAll(
			".huji-section-checkbox:checked"
		).length;
		const total = panoptoChecked + sectionsChecked;

		const btnText = getEl("huji-download-selected-text");
		if (btnText) {
			btnText.textContent =
				total > 0 ? `הורד נבחרים (${total})` : "הורד נבחרים";
		}
	}

	// Initialize or toggle the floating GUI widget inside an isolated Shadow DOM
	function createOrToggleGUI() {
		let host = document.getElementById("huji-downloader-host");
		if (host) {
			const isHidden = host.style.display === "none";
			host.style.display = isHidden ? "block" : "none";
			if (isHidden) checkAndRenderUpdateBanner();
			return;
		}

		host = document.createElement("div");
		host.id = "huji-downloader-host";
		Object.assign(host.style, {
			position: "fixed",
			bottom: "28px",
			left: "28px",
			zIndex: "2147483646",
			display: "block",
		});

		widgetShadow = host.attachShadow({ mode: "open" });

		const currentVersion = chrome.runtime.getManifest().version;

		widgetShadow.innerHTML = `
			<style>
				:host {
					all: initial;
					font-family: 'Segoe UI', 'Heebo', system-ui, -apple-system, sans-serif;
				}
				* {
					box-sizing: border-box;
				}
				.widget-card {
					direction: rtl;
					width: 370px;
					max-width: calc(100vw - 32px);
					background: rgba(255, 255, 255, 0.96);
					backdrop-filter: blur(16px);
					-webkit-backdrop-filter: blur(16px);
					border-radius: 20px;
					box-shadow: 0 20px 45px -10px rgba(15, 23, 42, 0.22), 0 0 0 1px rgba(226, 232, 240, 0.9);
					padding: 20px;
					color: #0f172a;
					font-family: 'Segoe UI', 'Heebo', system-ui, -apple-system, sans-serif;
					animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
				}
				@keyframes slideUp {
					from { opacity: 0; transform: translateY(14px) scale(0.98); }
					to { opacity: 1; transform: translateY(0) scale(1); }
				}

				/* Header */
				.header {
					display: flex;
					align-items: center;
					justify-content: space-between;
					padding-bottom: 14px;
					margin-bottom: 16px;
					border-bottom: 1px solid #e2e8f0;
				}
				.brand {
					display: flex;
					align-items: center;
					gap: 10px;
				}
				.brand-logo {
					width: 34px;
					height: 34px;
					border-radius: 10px;
					object-fit: cover;
					box-shadow: 0 2px 8px rgba(79, 70, 229, 0.2);
				}
				.brand-titles {
					display: flex;
					flex-direction: column;
				}
				.brand-title {
					margin: 0;
					font-size: 16px;
					font-weight: 700;
					color: #0f172a;
					line-height: 1.2;
				}
				.brand-subtitle {
					font-size: 11px;
					font-weight: 500;
					color: #64748b;
					margin-top: 2px;
				}
				.close-btn {
					background: #f1f5f9;
					border: 1px solid #e2e8f0;
					border-radius: 10px;
					width: 32px;
					height: 32px;
					display: flex;
					align-items: center;
					justify-content: center;
					cursor: pointer;
					color: #64748b;
					transition: all 0.2s ease;
				}
				.close-btn:hover {
					background: #fee2e2;
					border-color: #fecaca;
					color: #e11d48;
				}

				/* Update Available Banner */
				.update-banner {
					display: none;
					align-items: center;
					justify-content: space-between;
					gap: 10px;
					padding: 10px 12px;
					margin-bottom: 14px;
					border-radius: 12px;
					background: linear-gradient(135deg, #eef2ff 0%, #f0fdfa 100%);
					border: 1px solid #c7d2fe;
					color: #3730a3;
					font-size: 12.5px;
					font-weight: 600;
				}
				.update-banner.visible {
					display: flex;
					animation: slideUp 0.25s ease;
				}
				.update-banner-info {
					display: flex;
					align-items: center;
					gap: 7px;
					min-width: 0;
				}
				.update-link {
					background: #4f46e5;
					color: #ffffff;
					text-decoration: none;
					padding: 5px 10px;
					border-radius: 8px;
					font-size: 11.5px;
					font-weight: 600;
					white-space: nowrap;
					transition: background 0.2s ease;
				}
				.update-link:hover {
					background: #4338ca;
				}

				/* Inline Notice Banner */
				.inline-notice {
					display: none;
					font-size: 12.5px;
					font-weight: 500;
					padding: 10px 12px;
					border-radius: 12px;
					margin-bottom: 14px;
					line-height: 1.4;
				}
				.inline-notice.visible {
					display: block;
					animation: slideUp 0.2s ease;
				}
				.inline-notice.warning {
					background: #fffbeb;
					color: #b45309;
					border: 1px solid #fde68a;
				}
				.inline-notice.info {
					background: #eef2ff;
					color: #4338ca;
					border: 1px solid #c7d2fe;
				}

				/* Buttons */
				.btn-row {
					display: flex;
					gap: 10px;
					margin-bottom: 10px;
				}
				.btn {
					display: inline-flex;
					align-items: center;
					justify-content: center;
					gap: 7px;
					border: none;
					border-radius: 12px;
					padding: 11px 14px;
					font-family: inherit;
					font-size: 13.5px;
					font-weight: 600;
					cursor: pointer;
					transition: all 0.2s ease;
				}
				.btn:active:not(:disabled) {
					transform: scale(0.98);
				}
				.btn:disabled {
					opacity: 0.55;
					cursor: not-allowed;
				}
				.btn-primary {
					flex: 1;
					background: linear-gradient(135deg, #4f46e5 0%, #0d9488 100%);
					color: #ffffff;
					box-shadow: 0 6px 16px -4px rgba(79, 70, 229, 0.4);
				}
				.btn-primary:hover:not(:disabled) {
					filter: brightness(1.06);
					box-shadow: 0 8px 20px -4px rgba(79, 70, 229, 0.5);
				}
				.btn-secondary {
					flex: 1;
					background: #eef2ff;
					color: #4338ca;
					border: 1px solid #c7d2fe;
				}
				.btn-secondary:hover:not(:disabled) {
					background: #e0e7ff;
				}
				.btn-stop {
					width: 100%;
					background: #f8fafc;
					color: #64748b;
					border: 1px solid #e2e8f0;
					margin-bottom: 16px;
				}
				.btn-stop:not(:disabled) {
					background: #fff1f2;
					color: #e11d48;
					border-color: #fecdd3;
				}
				.btn-stop:hover:not(:disabled) {
					background: #ffe4e6;
				}
				.btn-success {
					flex: 2;
					background: linear-gradient(135deg, #0d9488 0%, #059669 100%);
					color: #ffffff;
					box-shadow: 0 6px 14px -4px rgba(13, 148, 136, 0.35);
				}
				.btn-success:hover:not(:disabled) {
					filter: brightness(1.05);
				}
				.btn-neutral {
					flex: 1;
					background: #f1f5f9;
					color: #475569;
					border: 1px solid #e2e8f0;
				}
				.btn-neutral:hover:not(:disabled) {
					background: #e2e8f0;
				}

				/* Selection View */
				#huji-selection-view {
					display: none;
					margin-bottom: 16px;
				}
				.selection-title {
					font-size: 13px;
					font-weight: 700;
					color: #334155;
					margin-bottom: 8px;
				}
				.selection-list {
					max-height: 270px;
					overflow-y: auto;
					background: #f8fafc;
					border: 1px solid #e2e8f0;
					border-radius: 14px;
					padding: 10px;
					margin-bottom: 12px;
					font-size: 13px;
					text-align: right;
				}
				.selection-list::-webkit-scrollbar {
					width: 6px;
				}
				.selection-list::-webkit-scrollbar-track {
					background: transparent;
				}
				.selection-list::-webkit-scrollbar-thumb {
					background: #cbd5e1;
					border-radius: 999px;
				}
				.group-header {
					display: flex;
					align-items: center;
					gap: 6px;
					font-weight: 700;
					font-size: 12.5px;
					margin-bottom: 6px;
					padding: 4px 6px;
					border-radius: 8px;
				}
				.group-header.panopto {
					color: #0f766e;
					background: #f0fdfa;
				}
				.group-header.sections {
					color: #4338ca;
					background: #eef2ff;
					margin-top: 12px;
				}
				.select-all-row {
					display: flex;
					align-items: center;
					gap: 8px;
					padding: 6px 8px;
					margin-bottom: 6px;
					font-weight: 600;
					font-size: 12.5px;
					color: #334155;
					border-bottom: 1px solid #e2e8f0;
					cursor: pointer;
				}
				.item-row {
					display: flex;
					align-items: flex-start;
					gap: 8px;
					padding: 6px 8px;
					border-radius: 8px;
					cursor: pointer;
					color: #1e293b;
					line-height: 1.35;
					transition: background 0.15s ease;
				}
				.item-row:hover {
					background: #e2e8f0;
				}
				.item-row input[type="checkbox"],
				.select-all-row input[type="checkbox"] {
					accent-color: #4f46e5;
					width: 15px;
					height: 15px;
					margin: 2px 0 0 0;
					cursor: pointer;
					flex-shrink: 0;
				}

				/* Progress Area */
				.progress-wrapper {
					background: #f8fafc;
					border: 1px solid #e2e8f0;
					border-radius: 14px;
					padding: 12px 14px;
				}
				.progress-header {
					display: flex;
					justify-content: space-between;
					align-items: center;
					font-size: 12px;
					margin-bottom: 8px;
				}
				.phase-label {
					font-weight: 600;
					color: #475569;
				}
				.percent-label {
					font-weight: 700;
					color: #4f46e5;
					font-variant-numeric: tabular-nums;
				}
				.progress-track {
					background: #e2e8f0;
					border-radius: 999px;
					height: 10px;
					overflow: hidden;
					margin-bottom: 8px;
					position: relative;
				}
				.progress-fill {
					background: linear-gradient(90deg, #4f46e5, #14b8a6);
					height: 100%;
					width: 0%;
					transition: width 0.35s ease-out;
					border-radius: 999px;
				}
				.progress-fill.indeterminate {
					width: 40% !important;
					animation: indeterminateSlide 1.3s infinite ease-in-out;
				}
				@keyframes indeterminateSlide {
					0% { transform: translateX(150%); }
					100% { transform: translateX(-250%); }
				}
				.status-text {
					font-size: 12.5px;
					color: #334155;
					text-align: center;
					font-weight: 500;
					white-space: nowrap;
					overflow: hidden;
					text-overflow: ellipsis;
				}
				.status-text.success {
					color: #059669;
					font-weight: 600;
				}
				.status-text.error {
					color: #e11d48;
					font-weight: 600;
				}
			</style>

			<div class="widget-card" id="huji-downloader-widget">
				<div class="header">
					<div class="brand">
						<img src="${chrome.runtime.getURL("icon.png")}" alt="Logo" class="brand-logo">
						<div class="brand-titles">
							<h3 class="brand-title">הורדת קורס מהמודל</h3>
							<span class="brand-subtitle">רפואה עברית • כלי מחזור 2033 • v${currentVersion}</span>
						</div>
					</div>
					<button id="huji-close-btn" class="close-btn" title="סגור חלון" aria-label="סגור חלון">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
							<line x1="18" y1="6" x2="6" y2="18"></line>
							<line x1="6" y1="6" x2="18" y2="18"></line>
						</svg>
					</button>
				</div>

				<div id="huji-update-banner" class="update-banner">
					<div class="update-banner-info">
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; color: #0d9488;">
							<circle cx="12" cy="12" r="10"></circle>
							<polyline points="16 12 12 8 8 12"></polyline>
							<line x1="12" y1="16" x2="12" y2="8"></line>
						</svg>
						<span id="huji-update-version-text">זמינה גרסה חדשה!</span>
					</div>
					<a id="huji-update-link" href="#" target="_blank" rel="noopener noreferrer" class="update-link">לעדכון בפורטל</a>
				</div>

				<div id="huji-inline-notice" class="inline-notice"></div>

				<div id="huji-main-view">
					<div class="btn-row">
						<button id="huji-start-btn" class="btn btn-primary">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
								<polyline points="7 10 12 15 17 10"></polyline>
								<line x1="12" y1="15" x2="12" y2="3"></line>
							</svg>
							<span>הורד הכול</span>
						</button>
						<button id="huji-select-btn" class="btn btn-secondary">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="9 11 12 14 22 4"></polyline>
								<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
							</svg>
							<span>בחירה סלקטיבית</span>
						</button>
					</div>
					<button id="huji-stop-btn" disabled class="btn btn-stop">
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
							<rect x="6" y="6" width="12" height="12" rx="2"></rect>
						</svg>
						<span>עצור תהליך</span>
					</button>
				</div>

				<div id="huji-selection-view">
					<div class="selection-title">בחרו את הפריטים שתרצו להוריד:</div>
					<div id="huji-recordings-list" class="selection-list"></div>
					<div class="btn-row">
						<button id="huji-download-selected-btn" class="btn btn-success">
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
								<polyline points="7 10 12 15 17 10"></polyline>
								<line x1="12" y1="15" x2="12" y2="3"></line>
							</svg>
							<span id="huji-download-selected-text">הורד נבחרים</span>
						</button>
						<button id="huji-cancel-select-btn" class="btn btn-neutral">חזרה</button>
					</div>
				</div>

				<div class="progress-wrapper">
					<div class="progress-header">
						<span id="huji-phase-label" class="phase-label">מוכן להורדה</span>
						<span id="huji-percent-label" class="percent-label">0%</span>
					</div>
					<div class="progress-track">
						<div id="huji-progress-fill" class="progress-fill"></div>
					</div>
					<div id="huji-status-text" class="status-text">ממתין להתחלת התהליך...</div>
				</div>
			</div>
		`;

		document.body.appendChild(host);

		// Trigger silent update check against GitHub manifest.json
		checkAndRenderUpdateBanner();

		// Close widget
		getEl("huji-close-btn").addEventListener("click", () => {
			host.style.display = "none";
		});

		// Download All
		getEl("huji-start-btn").addEventListener("click", () => {
			if (isRunning) return;
			startProcessUI();
			scrapeAndDownload(null);
		});

		// Open Custom Selection View
		getEl("huji-select-btn").addEventListener("click", () => {
			if (isRunning) return;

			const panoptoNodes = document.querySelectorAll(
				'.block_panopto a[href*="Viewer.aspx"], .panopto-completed-container a'
			);
			const sectionNodes = document.querySelectorAll("h3.sectionname a");

			if (panoptoNodes.length === 0 && sectionNodes.length === 0) {
				showInlineNotice(
					"לא נמצאו קבצים או הקלטות להורדה בעמוד זה. ודאו שאתם בעמוד הראשי של הקורס.",
					"warning"
				);
				return;
			}

			const listContainer = getEl("huji-recordings-list");
			listContainer.innerHTML = "";

			// --- Panopto Recordings Section ---
			if (panoptoNodes.length > 0) {
				const panoptoHeader = document.createElement("div");
				panoptoHeader.className = "group-header panopto";
				panoptoHeader.innerHTML = `
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
						<polygon points="23 7 16 12 23 17 23 7"></polygon>
						<rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
					</svg>
					<span>הקלטות Panopto (${panoptoNodes.length})</span>
				`;
				listContainer.appendChild(panoptoHeader);

				const selectAllPanoptoLabel = document.createElement("label");
				selectAllPanoptoLabel.className = "select-all-row";

				const selectAllPanoptoCb = document.createElement("input");
				selectAllPanoptoCb.type = "checkbox";
				selectAllPanoptoCb.addEventListener("change", (e) => {
					widgetShadow
						.querySelectorAll(".huji-panopto-checkbox")
						.forEach((cb) => (cb.checked = e.target.checked));
					updateSelectedCounter();
				});
				selectAllPanoptoLabel.appendChild(selectAllPanoptoCb);
				selectAllPanoptoLabel.appendChild(
					document.createTextNode("בחר / נקה את כל ההקלטות")
				);
				listContainer.appendChild(selectAllPanoptoLabel);

				for (let i = 0; i < panoptoNodes.length; i++) {
					const a = panoptoNodes[i];
					let rawText =
						a.innerText ||
						a.textContent ||
						a.getAttribute("title") ||
						a.getAttribute("alt") ||
						"";
					let cleanTitle =
						rawText
							.replace(/[\r\n]+/g, " ")
							.trim()
							.replace(/[\/\\?%*:|"<>]/g, "-")
							.replace(/\.+$/, "")
							.trim() || "Recording";
					const recordingNumber = panoptoNodes.length - i;

					const label = document.createElement("label");
					label.className = "item-row";

					const cb = document.createElement("input");
					cb.type = "checkbox";
					cb.value = i;
					cb.className = "huji-panopto-checkbox";
					cb.addEventListener("change", updateSelectedCounter);

					const textSpan = document.createElement("span");
					textSpan.textContent = `(${recordingNumber}) ${cleanTitle}`;

					label.appendChild(cb);
					label.appendChild(textSpan);
					listContainer.appendChild(label);
				}
			}

			// --- Course Sections Section ---
			if (sectionNodes.length > 0) {
				const sectionHeader = document.createElement("div");
				sectionHeader.className = "group-header sections";
				sectionHeader.innerHTML = `
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
					</svg>
					<span>יחידות הקורס (${sectionNodes.length})</span>
				`;
				listContainer.appendChild(sectionHeader);

				const selectAllSectionsLabel = document.createElement("label");
				selectAllSectionsLabel.className = "select-all-row";

				const selectAllSectionsCb = document.createElement("input");
				selectAllSectionsCb.type = "checkbox";
				selectAllSectionsCb.addEventListener("change", (e) => {
					widgetShadow
						.querySelectorAll(".huji-section-checkbox")
						.forEach((cb) => (cb.checked = e.target.checked));
					updateSelectedCounter();
				});
				selectAllSectionsLabel.appendChild(selectAllSectionsCb);
				selectAllSectionsLabel.appendChild(
					document.createTextNode("בחר / נקה את כל היחידות")
				);
				listContainer.appendChild(selectAllSectionsLabel);

				for (let i = 0; i < sectionNodes.length; i++) {
					const node = sectionNodes[i];
					let cleanTitle =
						node.innerText
							.replace(/[\r\n]+/g, " ")
							.trim()
							.replace(/[\/\\?%*:|"<>]/g, "-")
							.replace(/\.+$/, "")
							.trim() || `Section_${i + 1}`;

					const label = document.createElement("label");
					label.className = "item-row";

					const cb = document.createElement("input");
					cb.type = "checkbox";
					cb.value = i;
					cb.className = "huji-section-checkbox";
					cb.addEventListener("change", updateSelectedCounter);

					const textSpan = document.createElement("span");
					textSpan.textContent = `(${i + 1}) ${cleanTitle}`;

					label.appendChild(cb);
					label.appendChild(textSpan);
					listContainer.appendChild(label);
				}
			}

			updateSelectedCounter();
			getEl("huji-main-view").style.display = "none";
			getEl("huji-selection-view").style.display = "block";
		});

		// Back from Selection View
		getEl("huji-cancel-select-btn").addEventListener("click", () => {
			getEl("huji-selection-view").style.display = "none";
			getEl("huji-main-view").style.display = "block";
		});

		// Download Selected Items
		getEl("huji-download-selected-btn").addEventListener("click", () => {
			const panoptoCheckboxes = widgetShadow.querySelectorAll(
				".huji-panopto-checkbox:checked"
			);
			const sectionCheckboxes = widgetShadow.querySelectorAll(
				".huji-section-checkbox:checked"
			);

			if (
				panoptoCheckboxes.length === 0 &&
				sectionCheckboxes.length === 0
			) {
				showInlineNotice(
					"יש לבחור לפחות פריט אחד לפני תחילת ההורדה.",
					"warning"
				);
				return;
			}

			const panoptoNodes = document.querySelectorAll(
				'.block_panopto a[href*="Viewer.aspx"], .panopto-completed-container a'
			);
			const sectionNodes = document.querySelectorAll("h3.sectionname a");

			const selectedData = {
				panopto: [],
				sections: [],
			};

			panoptoCheckboxes.forEach((cb) => {
				const idx = parseInt(cb.value);
				selectedData.panopto.push({
					element: panoptoNodes[idx],
					index: idx,
					total: panoptoNodes.length,
				});
			});

			sectionCheckboxes.forEach((cb) => {
				const idx = parseInt(cb.value);
				selectedData.sections.push({
					title: sectionNodes[idx].innerText.trim(),
					url: sectionNodes[idx].href,
					originalIndex: idx, // Preserves the original chronological numbering
				});
			});

			getEl("huji-selection-view").style.display = "none";
			getEl("huji-main-view").style.display = "block";

			startProcessUI();
			scrapeAndDownload(selectedData);
		});

		// Stop Process
		getEl("huji-stop-btn").addEventListener("click", () => {
			isAborted = true;
			const statusEl = getEl("huji-status-text");
			if (statusEl) {
				statusEl.className = "status-text error";
				statusEl.textContent = "עוצר את התהליך...";
			}
		});
	}

	function startProcessUI() {
		isAborted = false;
		isRunning = true;
		failedDownloads = []; // Reset failure log at the start of each run

		getEl("huji-start-btn").disabled = true;
		getEl("huji-select-btn").disabled = true;
		getEl("huji-stop-btn").disabled = false;

		const fill = getEl("huji-progress-fill");
		fill.style.width = "0%";
		fill.classList.add("indeterminate");

		const statusEl = getEl("huji-status-text");
		statusEl.className = "status-text";
		statusEl.textContent = "מתחיל סריקה...";

		getEl("huji-phase-label").textContent = "שלב 1/2: סורק מבנה קורס";
		getEl("huji-percent-label").textContent = "...";
	}

	function setScanningStatus(text) {
		if (isAborted) return;
		const statusEl = getEl("huji-status-text");
		if (statusEl) statusEl.textContent = text;
	}

	function startDownloadPhaseUI() {
		if (isAborted) return;
		const fill = getEl("huji-progress-fill");
		fill.classList.remove("indeterminate");
		fill.style.width = "0%";
		getEl("huji-phase-label").textContent = "שלב 2/2: מוריד קבצים";
		getEl("huji-percent-label").textContent = "0%";
	}

	function updateProgress(text) {
		if (isAborted) return;
		completedTasks++;
		const percent =
			totalTasks === 0
				? 0
				: Math.min(Math.round((completedTasks / totalTasks) * 100), 100);
		getEl("huji-progress-fill").style.width = percent + "%";
		getEl("huji-percent-label").textContent = `${percent}%`;
		getEl(
			"huji-status-text"
		).textContent = `(${completedTasks}/${totalTasks}) ${text}`;
	}

	function finishProcess(msg, statusType = "") {
		isRunning = false;
		const fill = getEl("huji-progress-fill");
		fill.classList.remove("indeterminate");

		const statusEl = getEl("huji-status-text");
		statusEl.className = `status-text ${statusType}`.trim();
		statusEl.textContent = msg;

		if (statusType === "success") {
			getEl("huji-phase-label").textContent = "הושלם בהצלחה";
			getEl("huji-percent-label").textContent = "100%";
		} else if (statusType === "error") {
			getEl("huji-phase-label").textContent = "התהליך נעצר / הסתיים עם שגיאות";
		} else {
			getEl("huji-phase-label").textContent = "מוכן להורדה";
		}

		getEl("huji-start-btn").disabled = false;
		getEl("huji-select-btn").disabled = false;
		getEl("huji-stop-btn").disabled = true;
	}

	// Fallback logic to extract clean video URLs from iframes
	function cleanIframeUrl(url) {
		try {
			if (url.includes("youtube.com/embed/")) {
				const urlObj = new URL(url);
				const videoId = urlObj.pathname.split("/").pop();
				return `https://www.youtube.com/watch?v=${videoId}`;
			}
		} catch (e) {}
		return url;
	}

	// Helper function to sanitize strings for Windows Batch script execution
	function sanitizeBat(str) {
		return str.replace(/[\r\n"]/g, "").replace(/%/g, "%%");
	}

	// Generate a robust FFmpeg command with PowerShell verification to prevent zero-byte files on Disk Full
	function generateSafeFfmpegCommand(url, outputPath) {
		const safeUrl = sanitizeBat(url);

		let cmd = `set "HUJI_OUT=${outputPath}"\r\n`;
		cmd += `ffmpeg -n -i "${safeUrl}" -c copy "%HUJI_OUT%"\r\n`;

		cmd += `powershell -NoProfile -Command "if (Test-Path -LiteralPath $env:HUJI_OUT) { if ((Get-Item -LiteralPath $env:HUJI_OUT).Length -lt 100KB) { Remove-Item -LiteralPath $env:HUJI_OUT -Force; exit 1 } } else { exit 1 }"\r\n`;
		cmd += `if %errorlevel% neq 0 (\r\n`;
		cmd += `    echo.\r\n`;
		cmd += `    echo =======================================================\r\n`;
		cmd += `    echo ERROR: Download failed, corrupted, or DISK IS FULL!\r\n`;
		cmd += `    echo Stopping process to prevent empty files...\r\n`;
		cmd += `    echo =======================================================\r\n`;
		cmd += `    pause\r\n`;
		cmd += `    exit /b\r\n`;
		cmd += `)\r\n`;

		return cmd;
	}

	// Ensure proper tracking of failed downloads
	async function handleDownload(urlToDownload, filename, originalUrl = "") {
		const res = await new Promise((resolve) => {
			chrome.runtime.sendMessage(
				{
					action: "downloadFile",
					url: urlToDownload,
					filename: filename,
				},
				(response) => resolve(response)
			);
		});

		if (!res || !res.success) {
			let logUrl = originalUrl || urlToDownload;
			if (logUrl.startsWith("data:")) logUrl = "Generated Text/HTML Document";

			failedDownloads.push({
				filename: filename,
				url: logUrl,
				error: res ? res.error : "Unknown Extension Error",
			});
		}
	}

	// Fetch with retry mechanism to prevent network drops during bulk operations
	async function fetchWithRetry(url, retries = 3) {
		for (let i = 0; i < retries; i++) {
			try {
				const response = await fetch(url);
				if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
				return await response.text();
			} catch (err) {
				if (i === retries - 1) throw err;
				await new Promise((r) => setTimeout(r, 1000));
			}
		}
	}

	// Main scraping and downloading logic
	async function scrapeAndDownload(selectionData = null) {
		let courseName = document.querySelector("h1")
			? document
					.querySelector("h1")
					.innerText.trim()
					.replace(/[\/\\?%*:|"<>]/g, "-")
					.replace(/\.+$/, "")
					.trim()
			: "HUJI_Course";

		const courseFolderName = `Moodle_${courseName}_${Date.now()}`;

		let panoptoLinksToProcess = [];
		let sectionsToProcess = [];

		// Determine scanning path based on user selection (Download All vs. Custom Selection)
		if (selectionData !== null) {
			panoptoLinksToProcess = selectionData.panopto;
			sectionsToProcess = selectionData.sections;
		} else {
			const panoptoNodes = document.querySelectorAll(
				'.block_panopto a[href*="Viewer.aspx"], .panopto-completed-container a'
			);
			for (let i = 0; i < panoptoNodes.length; i++) {
				panoptoLinksToProcess.push({
					element: panoptoNodes[i],
					index: i,
					total: panoptoNodes.length,
				});
			}

			const sectionNodes = document.querySelectorAll("h3.sectionname a");
			for (let i = 0; i < sectionNodes.length; i++) {
				sectionsToProcess.push({
					title: sectionNodes[i].innerText.trim(),
					url: sectionNodes[i].href,
					originalIndex: i,
				});
			}
		}

		if (sectionsToProcess.length === 0 && panoptoLinksToProcess.length === 0) {
			finishProcess("לא נמצאו פריטים להורדה בעמוד זה.");
			return;
		}

		// =========================================================================
		// PHASE 1: Pre-scan all selected course sections so progress bar is exact
		// =========================================================================
		const scannedSections = [];
		let totalSectionLinks = 0;

		for (let sIndex = 0; sIndex < sectionsToProcess.length; sIndex++) {
			if (isAborted) return finishProcess("ההורדה נעצרה על ידי המשתמש.", "error");

			const section = sectionsToProcess[sIndex];
			const safeSectionTitle = section.title
				.replace(/[\/\\?%*:|"<>]/g, "-")
				.replace(/\.+$/, "")
				.trim();
			const sectionFolder = `(${section.originalIndex + 1}) ${safeSectionTitle}`;

			setScanningStatus(
				`סורק יחידה ${sIndex + 1} מתוך ${sectionsToProcess.length}: ${safeSectionTitle}`
			);

			let sectionHtml;
			try {
				sectionHtml = await fetchWithRetry(section.url);
			} catch (error) {
				failedDownloads.push({
					filename: `Section: ${safeSectionTitle}`,
					url: section.url,
					error: `Failed to load section page after 3 retries: ${error.message}`,
				});
				continue;
			}

			const doc = new DOMParser().parseFromString(sectionHtml, "text/html");

			const linkElements = doc.querySelectorAll(
				".modtype_resource a, .modtype_url a, .modtype_videostream a, .modtype_folder a, .modtype_page a, .modtype_quiz a, .modtype_question a, .modtype_questionnaire a, .modtype_forum a, .modtype_lti a"
			);

			const validLinks = Array.from(linkElements).filter(
				(a) => !a.closest(".modtype_zoom") && !a.href.includes("mod/zoom/")
			);

			totalSectionLinks += validLinks.length;
			scannedSections.push({
				sectionFolder,
				validLinks,
			});
		}

		// =========================================================================
		// PHASE 2: Accurate progress tracking & downloading
		// =========================================================================
		totalTasks = panoptoLinksToProcess.length + totalSectionLinks;
		completedTasks = 0;
		startDownloadPhaseUI();

		if (totalTasks === 0) {
			finishProcess("לא נמצאו קבצים להורדה ביחידות שנסרקו.");
			return;
		}

		let batContent = "@echo off\r\nchcp 65001 >nul\r\n";
		batContent += "REM Check for FFmpeg installation\r\n";
		batContent += "ffmpeg -version >nul 2>&1\r\n";
		batContent += "if %errorlevel% neq 0 (\r\n";
		batContent +=
			"    echo =======================================================\r\n";
		batContent +=
			"    echo ERROR: FFmpeg is not installed or not in your PATH!\r\n";
		batContent +=
			"    echo Please download it from https://ffmpeg.org/download.html\r\n";
		batContent +=
			"    echo =======================================================\r\n";
		batContent += "    pause\r\n";
		batContent += "    exit /b\r\n";
		batContent += ")\r\n\r\n";

		let foundAnyPanoptoStream = false;

		// --- Step 1: Process Panopto Recordings ---
		if (panoptoLinksToProcess.length > 0) {
			for (let i = 0; i < panoptoLinksToProcess.length; i++) {
				if (isAborted) return finishProcess("ההורדה נעצרה על ידי המשתמש.", "error");

				const item = panoptoLinksToProcess[i];
				const a = item.element;

				let rawText =
					a.innerText ||
					a.textContent ||
					a.getAttribute("title") ||
					a.getAttribute("alt") ||
					"";
				let cleanTitle = rawText
					.replace(/[\r\n]+/g, " ")
					.trim()
					.replace(/[\/\\?%*:|"<>]/g, "-")
					.replace(/\.+$/, "")
					.trim();

				if (!cleanTitle) cleanTitle = `Recording`;

				const recordingNumber = item.total - item.index;
				const recordingFolderName = `(${recordingNumber}) ${cleanTitle}`;
				const mainPanoptoFolder = "Panopto Recordings";

				try {
					const bgResponse = await new Promise((resolve) => {
						chrome.runtime.sendMessage(
							{ action: "fetchPanoptoStreams", url: a.href },
							(res) => resolve(res)
						);
					});

					if (
						bgResponse &&
						bgResponse.success &&
						bgResponse.streams &&
						bgResponse.streams.length > 0
					) {
						foundAnyPanoptoStream = true;

						const safeMainFolder = sanitizeBat(mainPanoptoFolder);
						const safeRecFolder = sanitizeBat(recordingFolderName);

						batContent += `REM ${safeRecFolder}\r\n`;
						batContent += `if not exist "%~dp0${safeMainFolder}\\${safeRecFolder}" mkdir "%~dp0${safeMainFolder}\\${safeRecFolder}"\r\n`;

						const uniqueStreams = [...new Set(bgResponse.streams)];

						uniqueStreams.forEach((m3u8Url, idx) => {
							const streamSuffix =
								idx === 0
									? "Camera"
									: idx === 1
									? "Screen"
									: `Stream_${idx + 1}`;
							const outputPath = `%~dp0${safeMainFolder}\\${safeRecFolder}\\${streamSuffix}.mp4`;

							batContent += generateSafeFfmpegCommand(
								m3u8Url,
								outputPath
							);
						});
					} else {
						const txtContent = `Recording Name: ${cleanTitle}\n\nDirect Panopto Link:\n${a.href}`;
						await handleDownload(
							`data:text/plain;charset=utf-8,${encodeURIComponent(
								txtContent
							)}`,
							`${courseFolderName}/${mainPanoptoFolder}/${recordingFolderName}/Link.txt`,
							a.href
						);
					}
				} catch (e) {
					const txtContent = `Recording Name: ${cleanTitle}\n\nDirect Panopto Link:\n${a.href}`;
					await handleDownload(
						`data:text/plain;charset=utf-8,${encodeURIComponent(
							txtContent
						)}`,
						`${courseFolderName}/${mainPanoptoFolder}/${recordingFolderName}/Link.txt`,
						a.href
					);
				}

				updateProgress(recordingFolderName);
				await new Promise((r) => setTimeout(r, 400));
			}
		}

		if (foundAnyPanoptoStream) {
			batContent +=
				"\r\necho.\r\necho All Panopto recordings have been successfully processed!\r\npause\r\n";
			await handleDownload(
				`data:application/x-bat;charset=utf-8,${encodeURIComponent(
					batContent
				)}`,
				`${courseFolderName}/Download_Panopto_Recordings.bat`
			);
		}

		// --- Step 2: Process Pre-Scanned Course Sections ---
		for (let sIndex = 0; sIndex < scannedSections.length; sIndex++) {
			if (isAborted) return finishProcess("ההורדה נעצרה על ידי המשתמש.", "error");

			const { sectionFolder, validLinks } = scannedSections[sIndex];

			for (let fIndex = 0; fIndex < validLinks.length; fIndex++) {
				if (isAborted) return finishProcess("ההורדה נעצרה על ידי המשתמש.", "error");

				const a = validLinks[fIndex];
				let cloneA = a.cloneNode(true);
				cloneA
					.querySelectorAll(".accesshide")
					.forEach((node) => node.remove());

				let rawTitle =
					cloneA.getAttribute("title") ||
					cloneA.innerText ||
					cloneA.textContent ||
					"";
				let cleanTitle = rawTitle
					.replace(/[\r\n]+/g, " ")
					.trim()
					.replace(/[\/\\?%*:|"<>]/g, "-")
					.replace(/\.+$/, "")
					.trim();

				if (!cleanTitle) cleanTitle = `File_${fIndex + 1}`;

				const baseName = `(${fIndex + 1}) ${cleanTitle}`;

				const isFolder = !!a.closest(".modtype_folder");
				const isPage = !!a.closest(".modtype_page");
				const isQuiz = !!a.closest(".modtype_quiz");
				const isQuestion = !!a.closest(".modtype_question");
				const isQuestionnaire = !!a.closest(".modtype_questionnaire");
				const isForum = !!a.closest(".modtype_forum");
				const isLti = !!a.closest(".modtype_lti");
				const isUrl = !!a.closest(".modtype_url");
				const isResource = a.href.includes("mod/resource/view.php");

				if (isLti) {
					// Handling External Tools (LTI)
					const ltiLink =
						a.href && a.href.includes("mod/lti/launch.php")
							? a.href
							: a.href.replace(
									"mod/lti/view.php",
									"mod/lti/launch.php"
							  );
					const txtContent = `External Learning Tool: ${cleanTitle}\n\nPlease access this resource directly via Moodle:\n${ltiLink}\n\n(This is a secure external tool link and cannot be downloaded directly.)`;
					const downloadUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(
						txtContent
					)}`;
					const finalFilename = `${courseFolderName}/${sectionFolder}/${baseName}.txt`;
					await handleDownload(downloadUrl, finalFilename, a.href);
				} else if (isFolder) {
					try {
						const folderHtml = await fetchWithRetry(a.href);
						const folderDoc = new DOMParser().parseFromString(
							folderHtml,
							"text/html"
						);

						// HUJI specific download folder button (ZIP)
						const downloadForm = folderDoc.querySelector(
							'form[action*="download_folder.php"]'
						);
						if (downloadForm) {
							const action = downloadForm.getAttribute("action");
							const idInput =
								downloadForm.querySelector('input[name="id"]');
							if (idInput) {
								const zipUrl = `${action}?id=${idInput.value}`;
								const finalFilename = `${courseFolderName}/${sectionFolder}/${baseName}.zip`;
								await handleDownload(zipUrl, finalFilename, a.href);
							}
						} else {
							// Safe fallback for individual folder files
							const folderFiles =
								folderDoc.querySelectorAll(".fp-filename a");
							for (let i = 0; i < folderFiles.length; i++) {
								if (isAborted) break;
								const fileLink = folderFiles[i];
								const fileName = fileLink.innerText
									.trim()
									.replace(/[\/\\?%*:|"<>]/g, "-")
									.replace(/\.+$/, "")
									.trim();

								const finalFilename = `${courseFolderName}/${sectionFolder}/${baseName}/${fileName}`;
								await handleDownload(
									fileLink.href +
										(fileLink.href.includes("?") ? "&" : "?") +
										"forcedownload=1",
									finalFilename,
									fileLink.href
								);
								await new Promise((r) => setTimeout(r, 600));
							}
						}
					} catch (err) {
						failedDownloads.push({
							filename: `Folder contents: ${baseName}`,
							url: a.href,
							error: `Failed to parse folder after retries: ${err.message}`,
						});
					}
				} else if (
					isPage ||
					isQuiz ||
					isQuestion ||
					isQuestionnaire ||
					isForum
				) {
					try {
						const pageHtml = await fetchWithRetry(a.href);
						const pageDoc = new DOMParser().parseFromString(
							pageHtml,
							"text/html"
						);

						let downloadUrl = null;
						let ext = "";
						let handledSpecial = false;

						const iframeNode = pageDoc.querySelector("iframe");
						if (iframeNode && iframeNode.src) {
							const cleanSrc = cleanIframeUrl(iframeNode.src);
							const txtContent = `Resource Name: ${cleanTitle}\n\nExtracted Source Link:\n${cleanSrc}`;
							downloadUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(
								txtContent
							)}`;
							ext = ".txt";
							handledSpecial = true;
						}

						if (
							!handledSpecial &&
							(isPage || isQuestionnaire || isForum)
						) {
							let fileUrl = null;
							const videoNode = pageDoc.querySelector(
								"video source, video"
							);
							if (videoNode)
								fileUrl = videoNode.src || videoNode.currentSrc;

							if (!fileUrl) {
								const mp4Match = pageHtml.match(
									/(https:\/\/[^\s"'<>]+\.mp4)/
								);
								if (mp4Match) fileUrl = mp4Match[1];
							}

							if (fileUrl) {
								ext = ".mp4";
								downloadUrl =
									fileUrl +
									(fileUrl.includes("?") ? "&" : "?") +
									"forcedownload=1";
								handledSpecial = true;
							}
						}

						if (!handledSpecial) {
							const mainContent =
								pageDoc.querySelector('[role="main"]') ||
								pageDoc.querySelector("#region-main") ||
								pageDoc.body;
							const cleanHtml = `
								<!DOCTYPE html>
								<html lang="he" dir="rtl">
								<head>
									<meta charset="utf-8">
									<title>${cleanTitle}</title>
									<style>
										body { font-family: 'Segoe UI', 'Heebo', system-ui, sans-serif; padding: 40px; max-width: 820px; margin: 0 auto; line-height: 1.7; color: #1e293b; background: #f8fafc; direction: rtl; }
										.card { background: #ffffff; padding: 32px; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 20px rgba(15, 23, 42, 0.05); }
										h1 { color: #4338ca; border-bottom: 2px solid #e0e7ff; padding-bottom: 12px; margin-top: 0; }
										img { max-width: 100%; height: auto; border-radius: 10px; margin-top: 10px; }
										a { color: #0d9488; text-decoration: none; font-weight: 500; }
										a:hover { text-decoration: underline; }
										.activity-header { display: none; }
									</style>
								</head>
								<body>
									<div class="card">
										<h1>${cleanTitle}</h1>
										${
											mainContent
												? mainContent.innerHTML
												: "<p>לא נמצא תוכן בעמוד זה.</p>"
										}
									</div>
								</body>
								</html>
							`;
							downloadUrl = `data:text/html;charset=utf-8,${encodeURIComponent(
								cleanHtml
							)}`;
							ext = ".html";
						}

						const finalFilename = `${courseFolderName}/${sectionFolder}/${baseName}${ext}`;
						await handleDownload(downloadUrl, finalFilename, a.href);
					} catch (e) {
						failedDownloads.push({
							filename: `Page/Forum content: ${baseName}`,
							url: a.href,
							error: `Failed to fetch page after retries: ${e.message}`,
						});
					}
				} else if (isUrl) {
					// Handling modtype_url components
					let finalLinkToSave = a.href;

					try {
						const bgResponse = await new Promise((resolve) => {
							chrome.runtime.sendMessage(
								{ action: "resolveRedirect", url: a.href },
								resolve
							);
						});

						if (bgResponse && bgResponse.success) {
							finalLinkToSave = bgResponse.finalUrl;

							if (finalLinkToSave.includes("mod/url/view.php")) {
								const html = await fetchWithRetry(a.href);
								const innerDoc = new DOMParser().parseFromString(
									html,
									"text/html"
								);

								let extractedLink = null;

								const iframeNode = innerDoc.querySelector("iframe");
								if (iframeNode && iframeNode.src) {
									extractedLink = iframeNode.src;
								}

								if (!extractedLink) {
									const urlLink = innerDoc.querySelector(
										".urlworkaround a, .resourceworkaround a"
									);
									if (urlLink && urlLink.href)
										extractedLink = urlLink.href;
								}

								if (!extractedLink) {
									const onclickLinks =
										innerDoc.querySelectorAll("[onclick]");
									for (let l of onclickLinks) {
										const onclickValue =
											l.getAttribute("onclick");
										if (
											onclickValue &&
											onclickValue.includes("location.href")
										) {
											const match = onclickValue.match(
												/location\.href\s*=\s*['"]([^'"]+)['"]/
											);
											if (match && match[1]) {
												extractedLink = match[1];
												break;
											}
										}
									}
								}

								if (!extractedLink) {
									const externalLinks =
										innerDoc.querySelectorAll(
											'div[role="main"] a'
										);
									for (let l of externalLinks) {
										if (
											l.href &&
											!l.href.includes("mod/url/view.php") &&
											l.href.startsWith("http")
										) {
											extractedLink = l.href;
											break;
										}
									}
								}

								if (extractedLink) {
									finalLinkToSave = extractedLink;
								}
							}

							const cleanExtracted = cleanIframeUrl(finalLinkToSave);

							if (
								cleanExtracted.includes("panopto") ||
								cleanExtracted.includes("Viewer.aspx")
							) {
								try {
									const panoptoBg = await new Promise(
										(resolve) => {
											chrome.runtime.sendMessage(
												{
													action: "fetchPanoptoStreams",
													url: cleanExtracted,
												},
												(res) => resolve(res)
											);
										}
									);

									if (
										panoptoBg &&
										panoptoBg.success &&
										panoptoBg.streams &&
										panoptoBg.streams.length > 0
									) {
										let singleBatContent =
											"@echo off\r\nchcp 65001 >nul\r\n";
										const safeRecFolder =
											sanitizeBat(cleanTitle);
										singleBatContent += `REM ${safeRecFolder}\r\n`;
										singleBatContent += `if not exist "%~dp0${safeRecFolder}" mkdir "%~dp0${safeRecFolder}"\r\n`;

										const uniqueStreams = [
											...new Set(panoptoBg.streams),
										];
										uniqueStreams.forEach((m3u8Url, idx) => {
											const streamSuffix =
												idx === 0
													? "Camera"
													: idx === 1
													? "Screen"
													: `Stream_${idx + 1}`;
											const outputPath = `%~dp0${safeRecFolder}\\${streamSuffix}.mp4`;
											singleBatContent +=
												generateSafeFfmpegCommand(
													m3u8Url,
													outputPath
												);
										});

										const downloadUrl = `data:application/x-bat;charset=utf-8,${encodeURIComponent(
											singleBatContent
										)}`;
										const finalFilename = `${courseFolderName}/${sectionFolder}/${baseName}.bat`;
										await handleDownload(
											downloadUrl,
											finalFilename,
											a.href
										);
									} else {
										throw new Error("No Panopto streams found");
									}
								} catch (panoptoErr) {
									const txtContent = `Resource Name: ${cleanTitle}\n\nSource URL:\n${cleanExtracted}`;
									const downloadUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(
										txtContent
									)}`;
									const finalFilename = `${courseFolderName}/${sectionFolder}/${baseName}.txt`;
									await handleDownload(
										downloadUrl,
										finalFilename,
										a.href
									);
								}
							} else {
								const txtContent = `Resource Name: ${cleanTitle}\n\nSource URL:\n${cleanExtracted}`;
								const downloadUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(
									txtContent
								)}`;
								const finalFilename = `${courseFolderName}/${sectionFolder}/${baseName}.txt`;
								await handleDownload(
									downloadUrl,
									finalFilename,
									a.href
								);
							}
						} else {
							throw new Error("Background resolution failed");
						}
					} catch (e) {
						const txtContent = `Resource Name: ${cleanTitle}\n\nURL:\n${a.href}`;
						const downloadUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(
							txtContent
						)}`;
						const finalFilename = `${courseFolderName}/${sectionFolder}/${baseName}.txt`;
						await handleDownload(downloadUrl, finalFilename, a.href);
					}
				} else {
					// Handling standard resources (PDFs, PPTs, etc.)
					let fetchUrl = a.href;

					if (isResource) {
						fetchUrl +=
							(fetchUrl.includes("?") ? "&" : "?") + "redirect=1";
					}

					let downloadUrl = fetchUrl;
					let ext = "";
					let contentType = "";
					let finalUrl = fetchUrl;

					try {
						const controller = new AbortController();
						const res = await fetch(fetchUrl, {
							signal: controller.signal,
						});
						contentType = res.headers.get("content-type") || "";
						finalUrl = res.url;
						ext = getExtension(finalUrl, contentType);
						controller.abort();
					} catch (err) {}

					if (contentType.includes("text/html") && !ext) {
						try {
							const html = await fetchWithRetry(fetchUrl);
							const innerDoc = new DOMParser().parseFromString(
								html,
								"text/html"
							);

							const iframeNode = innerDoc.querySelector("iframe");
							if (iframeNode && iframeNode.src) {
								const cleanSrc = cleanIframeUrl(iframeNode.src);
								const txtContent = `Resource Name: ${cleanTitle}\n\nExtracted Source Link:\n${cleanSrc}`;
								downloadUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(
									txtContent
								)}`;
								ext = ".txt";
							} else {
								let fileUrl = null;
								const videoNode = innerDoc.querySelector(
									"video source, video"
								);
								if (videoNode)
									fileUrl =
										videoNode.src || videoNode.currentSrc;

								if (!fileUrl) {
									const mp4Match = html.match(
										/(https:\/\/[^\s"'<>]+\.mp4)/
									);
									if (mp4Match) fileUrl = mp4Match[1];
								}

								if (fileUrl) {
									ext = ".mp4";
									downloadUrl =
										fileUrl +
										(fileUrl.includes("?") ? "&" : "?") +
										"forcedownload=1";
								}
							}
						} catch (e) {
							failedDownloads.push({
								filename: `HTML Resource: ${baseName}`,
								url: fetchUrl,
								error: `Failed to extract HTML resource after retries: ${e.message}`,
							});
						}
					} else {
						downloadUrl = finalUrl;
						if (
							!downloadUrl.includes("forcedownload=1") &&
							!downloadUrl.startsWith("data:")
						) {
							downloadUrl +=
								(downloadUrl.includes("?") ? "&" : "?") +
								"forcedownload=1";
						}
					}

					if (!ext && a.closest(".modtype_videostream")) ext = ".mp4";
					if (!ext && isResource) ext = ".pdf";

					if (!ext) {
						const txtContent = `Resource Name: ${cleanTitle}\n\nURL:\n${a.href}`;
						downloadUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(
							txtContent
						)}`;
						ext = ".txt";
					}

					const finalFilename = `${courseFolderName}/${sectionFolder}/${baseName}${ext}`;
					await handleDownload(downloadUrl, finalFilename, a.href);
				}

				updateProgress(baseName);
				await new Promise((r) => setTimeout(r, 600));
			}
		}

		// Finalize process and generate error logs if necessary
		if (!isAborted) {
			completedTasks = totalTasks;
			getEl("huji-progress-fill").style.width = "100%";

			if (failedDownloads.length > 0) {
				let logContent =
					"HUJI Moodle Downloader - Failed Downloads Log\r\n";
				logContent += `Date: ${new Date().toLocaleString()}\r\n`;
				logContent +=
					"=================================================\r\n\r\n";

				failedDownloads.forEach((fail) => {
					logContent += `File: ${fail.filename}\r\n`;
					logContent += `URL:  ${fail.url}\r\n`;
					logContent += `Error: ${fail.error}\r\n`;
					logContent +=
						"-------------------------------------------------\r\n";
				});

				await handleDownload(
					`data:text/plain;charset=utf-8,${encodeURIComponent(
						logContent
					)}`,
					`${courseFolderName}/Failed_Downloads_Log.txt`
				);

				finishProcess(
					`הסתיים עם ${failedDownloads.length} שגיאות — בדקו את קובץ הלוג.`,
					"error"
				);
			} else {
				finishProcess("ההורדה הושלמה בהצלחה!", "success");
			}
		}
	}

	// Helper function to determine file extension based on URL and Content-Type
	function getExtension(url, contentType) {
		url = (url || "").toLowerCase();
		contentType = (contentType || "").toLowerCase();

		if (contentType.includes("pdf")) return ".pdf";
		if (contentType.includes("mp4") || contentType.includes("video"))
			return ".mp4";
		if (
			contentType.includes("word") ||
			contentType.includes("document") ||
			contentType.includes("wordprocessingml")
		)
			return ".docx";
		if (
			contentType.includes("powerpoint") ||
			contentType.includes("presentation") ||
			contentType.includes("presentationml")
		)
			return ".pptx";
		if (
			contentType.includes("excel") ||
			contentType.includes("sheet") ||
			contentType.includes("spreadsheetml")
		)
			return ".xlsx";
		if (contentType.includes("zip")) return ".zip";
		if (contentType.includes("text/plain")) return ".txt";

		const match = url.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
		if (match && match[1] !== "php") return `.${match[1]}`;
		return "";
	}
})();