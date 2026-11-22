# HUJI Moodle Downloader

A Chrome Extension (Manifest V3) for automatically downloading and organizing course materials and Panopto lecture recordings from the Hebrew University of Jerusalem (HUJI) Moodle (`moodle.huji.ac.il` and `moodle2.cs.huji.ac.il`).

---

## Features

- **Download All & Custom Download Modes**: Download an entire course in one click, or use the **Custom Download** menu to selectively pick specific **Panopto Recordings** and **Course Sections** while preserving their original chronological numbering.
- **Comprehensive Resource Support**:
  - **Files**: PDF, DOCX, PPTX, XLSX, ZIP, MP4, and more.
  - **Folders**: Automatically detects HUJI's native "Download folder" button to fetch folders as `.zip` archives, with a file-by-file fallback.
  - **Pages, Forums, Quizzes & Questionnaires**: Saves embedded videos/iframes or exports clean, readable `.html` snapshots.
  - **External URLs & LTI Tools**: Resolves Moodle redirects (bypassing CORS via the background service worker), extracts embedded `iframe` links (e.g., Google Forms, Google Maps), saves LTI tool links cleanly, and even detects Panopto recordings hidden inside URL resources.
- **Local Panopto Recording Downloader (FFmpeg)**:
  - Extracts HLS (`.m3u8`) streams (Camera + Screen) directly from Panopto.
  - Generates a ready-to-run `Download_Panopto_Recordings.bat` script inside the course folder.
  - **Smart Resume**: Uses FFmpeg's `-n` flag so re-running the script automatically skips already-downloaded videos.
  - **Disk-Full & Corruption Protection**: Verifies each downloaded video via PowerShell (`> 100KB`). If a download fails or the disk runs out of space, it deletes the corrupted stub and halts cleanly.
- **Built-In Error Resilience & Logging**:
  - Sequential download queue with automatic retries (up to 3 attempts) to prevent Chrome network throttling.
  - Retry logic (`fetchWithRetry`) for scraping Moodle sections and folders.
  - Automatically generates a `Failed_Downloads_Log.txt` file listing any failed items, their URLs, and error messages.

---

## Prerequisites

- **Google Chrome** (or any Chromium-based browser).
- **FFmpeg** *(required only for downloading Panopto video recordings)*:
  - Must be installed and added to your Windows system `PATH`.
  - Verify installation by running `ffmpeg -version` in Command Prompt.
  - Download from [ffmpeg.org](https://ffmpeg.org/download.html) or install via `winget install Gyan.FFmpeg`.

---

## Installation

1. Clone or download this repository to your local machine.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the project folder containing `manifest.json`.
5. Pin the **HUJI Moodle Downloader** extension to your toolbar for quick access.

---

## Usage

1. Log in to HUJI Moodle and open any course page.
2. Click the extension icon in your Chrome toolbar to open the floating **HUJI Moodle** widget.
3. Choose one of the following options:
   - **Download All**: Scans and downloads all course sections and Panopto recordings.
   - **Custom Download**: Displays a categorized checklist of all Panopto recordings and course sections. Select the items you want and click **Download Selected**.
4. Your files will be saved in your Chrome Downloads folder under:
   ```text
   Moodle_<Course_Name>_<Timestamp>/
   ├── (1) Section Name/
   │   ├── (1) Lecture 1.pdf
   │   └── (2) Exercises.zip
   ├── Download_Panopto_Recordings.bat
   └── Failed_Downloads_Log.txt   (only created if any errors occur)
   ```
5. **To download Panopto videos**: Double-click `Download_Panopto_Recordings.bat` inside the course folder. It will create a `Panopto Recordings/` directory with numbered subfolders for each lecture containing `Camera.mp4` and `Screen.mp4`.

---

## Project Structure

```text
├── manifest.json     # Extension configuration (Manifest V3) & permissions
├── background.js     # Service worker: download queue/retries, Panopto API, redirect resolver
├── content.js        # Injected floating GUI, Moodle scraper, and BAT script generator
├── popup.html        # Legacy popup layout
├── popup.js          # Legacy popup script
└── icon.png          # Extension icon
```

---

## Disclaimer

This tool is intended strictly for personal academic use by students with authorized access to their course materials. Please respect your university's copyright and acceptable use policies.
