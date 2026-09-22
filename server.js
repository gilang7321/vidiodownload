const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOAD_DIR = path.join(os.tmpdir(), "videodown-downloads");
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname, "public")));

function validUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function safeName(name) {
  return String(name || "video")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150) || "video";
}

function runYtDlp(args, { timeout = 120000 } = {}) {
  const python = process.env.PYTHON_CMD || (process.platform === "win32" ? "python" : "python3");
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-m", "yt_dlp", ...args], {
      windowsHide: true,
      cwd: __dirname,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("yt-dlp timeout"));
    }, timeout);

    child.stdout.on("data", d => { stdout += d.toString(); });
    child.stderr.on("data", d => { stderr += d.toString(); });
    child.on("error", err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Python/yt-dlp tidak ditemukan: ${err.message}`));
    });
    child.on("close", code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        const detail = (stderr || stdout || `yt-dlp keluar dengan kode ${code}`).trim();
        reject(new Error(detail.slice(-5000)));
      }
    });
  });
}

function parseJsonOutput(stdout) {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch {}
  }
  throw new Error("Output yt-dlp bukan JSON yang valid.");
}

function findOutput(base) {
  const candidates = fs.readdirSync(DOWNLOAD_DIR)
    .filter(f => f.startsWith(base + "."))
    .map(f => path.join(DOWNLOAD_DIR, f));
  return candidates.find(f => fs.statSync(f).isFile());
}

function friendlyError(err) {
  const msg = String(err?.message || err || "");
  if (/No module named ['"]?yt_dlp/i.test(msg)) return "yt-dlp belum terpasang. Jalankan: python -m pip install -U yt-dlp";
  if (/Python\/yt-dlp tidak ditemukan/i.test(msg)) return "Python tidak ditemukan. Pastikan Python sudah terpasang dan ada di PATH.";
  if (/ffmpeg/i.test(msg)) return "FFmpeg diperlukan untuk menggabungkan video dan audio pada format tertentu. Install FFmpeg lalu coba lagi.";
  if (/login required|sign in|authentication/i.test(msg)) return "Platform meminta login atau autentikasi. Gunakan URL publik yang dapat diakses tanpa login.";
  if (/private|not available|unavailable/i.test(msg)) return "Video tidak tersedia untuk diunduh dari URL tersebut.";
  if (/impersonat|challenge|Unexpected response/i.test(msg)) return "Platform menolak permintaan otomatis. Pastikan yt-dlp dan curl_cffi sudah diperbarui.";
  return "Video tidak dapat diproses. Pastikan URL publik dan konten dapat diunduh.";
}

app.get("/api/info", async (req, res) => {
  const url = String(req.query.url || "").trim();
  if (!validUrl(url)) return res.status(400).json({ error: "URL video tidak valid." });

  try {
    const result = await runYtDlp([
      "--dump-single-json", "--skip-download", "--no-playlist", "--no-warnings",
      "--socket-timeout", "20", url
    ], { timeout: 90000 });
    const info = parseJsonOutput(result.stdout);

    const formats = (info.formats || [])
      .filter(f => f.vcodec && f.vcodec !== "none")
      .filter(f => f.height)
      .map(f => ({
        format_id: f.format_id,
        ext: f.ext,
        height: f.height,
        fps: f.fps || null,
        filesize: f.filesize || f.filesize_approx || null,
        has_audio: Boolean(f.acodec && f.acodec !== "none")
      }))
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    const unique = [];
    const seen = new Set();
    for (const f of formats) {
      const key = `${f.height}-${f.ext}-${f.has_audio}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(f);
      }
      if (unique.length >= 10) break;
    }

    res.json({
      title: info.title || "Video",
      thumbnail: info.thumbnail || "",
      duration: info.duration || 0,
      uploader: info.uploader || info.channel || "",
      webpage_url: info.webpage_url || url,
      extractor: info.extractor_key || info.extractor || "",
      formats: unique
    });
  } catch (err) {
    console.error("INFO ERROR:", err.message);
    res.status(500).json({ error: friendlyError(err), detail: err.message });
  }
});

app.get("/api/download", async (req, res) => {
  const url = String(req.query.url || "").trim();
  const quality = String(req.query.quality || "best");
  if (!validUrl(url)) return res.status(400).send("URL tidak valid.");

  const id = crypto.randomBytes(8).toString("hex");
  const base = path.join(DOWNLOAD_DIR, id);
  const output = `${base}.%(ext)s`;

  try {
    let format;
    if (quality === "best") {
      // Prefer a single-file format first (works without FFmpeg on many sites),
      // then fall back to separate video+audio when FFmpeg is available.
      format = "best[ext=mp4]/best/bv*+ba/b";
    } else {
      const height = Math.max(144, Math.min(4320, Number.parseInt(quality, 10) || 1080));
      format = `best[height<=${height}][ext=mp4]/best[height<=${height}]/bv*[height<=${height}]+ba/b[height<=${height}]`;
    }

    await runYtDlp([
      "--no-playlist", "--no-warnings", "--no-progress", "--newline",
      "--socket-timeout", "30", "--retries", "3",
      "-f", format,
      "--merge-output-format", "mp4",
      "-o", output,
      url
    ], { timeout: 300000 });

    const file = findOutput(id);
    if (!file) throw new Error("File hasil download tidak ditemukan.");

    // Ask yt-dlp for the title separately only after the file exists.
    let title = "video";
    try {
      const meta = await runYtDlp(["--print", "title", "--skip-download", "--no-playlist", "--no-warnings", url], { timeout: 60000 });
      title = meta.stdout.trim().split(/\r?\n/).filter(Boolean).pop() || title;
    } catch {}

    res.download(file, safeName(title) + path.extname(file), err => {
      fs.promises.unlink(file).catch(() => {});
      if (err) console.error("SEND ERROR:", err.message);
    });
  } catch (err) {
    console.error("DOWNLOAD ERROR:", err.message);
    for (const f of fs.readdirSync(DOWNLOAD_DIR).filter(f => f.startsWith(id + "."))) {
      fs.promises.unlink(path.join(DOWNLOAD_DIR, f)).catch(() => {});
    }
    res.status(500).send(friendlyError(err));
  }
});

app.get("/api/health", async (req, res) => {
  try {
    const result = await runYtDlp(["--version"], { timeout: 15000 });
    res.json({ ok: true, service: "VideoDown", ytdlp: result.stdout.trim(), python: process.env.PYTHON_CMD || "python", time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ ok: false, service: "VideoDown", error: friendlyError(err), time: new Date().toISOString() });
  }
});

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`VideoDown berjalan di port ${PORT}`);
});
