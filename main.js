import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from 'ffmpeg-static';
import ffprobeInstaller from 'ffprobe-static';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configure FFmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 500,
        height: 700,
        resizable: false,
        frame: false, // Custom frameless look
        backgroundColor: '#09090b',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

// IPC Handlers for FFmpeg logic
ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'avi', 'jpg', 'png', 'gif'] }]
    });
    if (result.canceled) return null;
    
    const filePath = result.filePaths[0];
    const stats = fs.statSync(filePath);
    return {
        path: filePath,
        name: path.basename(filePath),
        size: (stats.size / (1024 * 1024)).toFixed(2)
    };
});

ipcMain.on('start-crunch', async (event, inputPath) => {
    const ext = path.extname(inputPath);
    const outputPath = path.join(path.dirname(inputPath), `crunched_${Date.now()}${ext}`);
    const TARGET_SIZE_MB = 3.8; 
    const TARGET_SIZE_BITS = TARGET_SIZE_MB * 1024 * 1024 * 8;

    ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
            event.reply('error', 'Could not analyze file.');
            return;
        }

        const duration = metadata.format.duration;
        const isVideo = metadata.streams.some(s => s.codec_type === 'video');

        if (!isVideo) {
            // Image processing
            ffmpeg(inputPath)
                .outputOptions('-q:v', '5')
                .on('end', () => event.reply('complete', outputPath))
                .on('error', (e) => event.reply('error', e.message))
                .save(outputPath);
        } else {
            // Video Compression Logic
            // We calculate bitrate based on 4MB target
            const videoBitrate = Math.floor((TARGET_SIZE_BITS / duration) / 1000) * 0.95;

            ffmpeg(inputPath)
                .videoCodec('libx264')
                .videoBitrate(videoBitrate)
                .outputOptions([
                    '-an', // REMOVE AUDIO STREAM
                    '-preset fast',
                    '-vf scale=trunc(oh*a/2)*2:720',
                    '-pix_fmt yuv420p',
                    '-movflags +faststart'
                ])
                .on('progress', (p) => event.reply('progress', p.percent))
                .on('end', () => event.reply('complete', outputPath))
                .on('error', (e) => event.reply('error', e.message))
                .save(outputPath);
        }
    });
});

ipcMain.on('close-app', () => app.quit());