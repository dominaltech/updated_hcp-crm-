/**
 * services/backupService.js
 * 
 * Hotel City Park CRM - Dual-Drive Redundant Database Backup Service (Goal 9)
 * 
 * Automatically backs up and mirrors the active SQLite database (hotel_city_park.db)
 * to both C:\ and D:\ drives (C:\HotelCityPark_Backups and D:\HotelCityPark_Backups).
 * 
 * Features:
 * 1. Safe online backup using SQLite's db.backup API (zero corruption, fully WAL-compatible).
 * 2. Automatic dual-drive mirroring across C:\ and D:\ drives by default.
 * 3. Graceful handling if D:\ drive is unmounted (backs up to C:\ and reports D:\ as offline).
 * 4. Automatic rotation / retention (keeps the last 30 backups per drive to prevent disk fill-up).
 * 5. Mirror copy at `hotel_city_park_latest.db` on each target drive for instant recovery.
 * 6. Audit logging in database table `database_backups`.
 * 7. Automatic periodic backup every 6 hours and on server startup.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_TARGET_DIRS = [
  'C:\\HotelCityPark_Backups',
  'D:\\HotelCityPark_Backups'
];

const MAX_RETENTION_BACKUPS = 30; // Keep last 30 backup files per drive
let dbInstance = null;
let backupTimer = null;

/**
 * Format bytes to human readable format (MB, KB)
 */
function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIdx = 0;
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024;
    unitIdx++;
  }
  return `${size.toFixed(2)} ${units[unitIdx]}`;
}

/**
 * Generate formatted timestamp string for filenames: YYYY-MM-DD_HH-mm-ss
 */
function getTimestampString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${MM}-${dd}_${HH}-${mm}-${ss}`;
}

/**
 * Initialize backup table and start auto-backup scheduler
 */
function initBackupSystem(db) {
  if (!db) return;
  dbInstance = db;

  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS database_backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        trigger_source TEXT DEFAULT 'manual',
        filename TEXT NOT NULL,
        c_drive_status TEXT,
        c_drive_path TEXT,
        c_drive_size INTEGER,
        d_drive_status TEXT,
        d_drive_path TEXT,
        d_drive_size INTEGER,
        summary TEXT
      )
    `).run();
  } catch (err) {
    console.warn('[BackupService] Notice creating database_backups table:', err.message);
  }

  // Clear existing interval if any
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }

  // Schedule auto-backup every 6 hours (6 * 60 * 60 * 1000 ms)
  backupTimer = setInterval(() => {
    createDualDriveBackup('auto_cron').catch((err) => {
      console.error('[BackupService] Auto-backup cron error:', err.message);
    });
  }, 6 * 60 * 60 * 1000);

  // Initial safety backup after 15 seconds of startup
  setTimeout(() => {
    createDualDriveBackup('startup').catch((err) => {
      console.warn('[BackupService] Startup backup notice:', err.message);
    });
  }, 15000);

  console.log('🛡️ [BackupService] Dual-Drive Redundant Backup service initialized (C:\\ & D:\\).');
}

/**
 * Check which drives exist on the local system
 */
function inspectAvailableDrives() {
  return DEFAULT_TARGET_DIRS.map((dir) => {
    const driveLetter = dir.slice(0, 2).toUpperCase(); // e.g. "C:" or "D:"
    const rootPath = driveLetter + '\\';
    const driveExists = fs.existsSync(rootPath);
    return {
      drive: driveLetter,
      dirPath: dir,
      isMounted: driveExists
    };
  });
}

/**
 * Prune older backups in a directory to maintain the retention limit
 */
function pruneOldBackups(dirPath, maxKeep = MAX_RETENTION_BACKUPS) {
  try {
    if (!fs.existsSync(dirPath)) return;
    const files = fs.readdirSync(dirPath)
      .filter((f) => f.startsWith('hcp_backup_') && f.endsWith('.db'))
      .map((f) => {
        const fullPath = path.join(dirPath, f);
        const stats = fs.statSync(fullPath);
        return { name: f, fullPath, mtime: stats.mtime.getTime() };
      })
      .sort((a, b) => b.mtime - a.mtime); // Newest first

    if (files.length > maxKeep) {
      const toRemove = files.slice(maxKeep);
      toRemove.forEach((item) => {
        try {
          fs.unlinkSync(item.fullPath);
        } catch (_) {}
      });
    }
  } catch (err) {
    console.warn('[BackupService] Retention pruning notice for', dirPath, err.message);
  }
}

/**
 * Perform a full dual-drive redundant backup
 */
async function createDualDriveBackup(trigger = 'manual') {
  if (!dbInstance) {
    throw new Error('Database instance is not initialized for backup.');
  }

  const timestamp = new Date();
  const timestampStr = getTimestampString(timestamp);
  const backupFileName = `hcp_backup_${timestampStr}.db`;
  const latestFileName = 'hotel_city_park_latest.db';

  const driveConfigs = inspectAvailableDrives();
  const results = [];
  let primaryBackupFilePath = null;

  for (const config of driveConfigs) {
    if (!config.isMounted) {
      results.push({
        drive: config.drive,
        targetDir: config.dirPath,
        status: 'skipped',
        reason: `Drive ${config.drive} is not connected or accessible on this system.`
      });
      continue;
    }

    try {
      // Ensure target directory exists
      if (!fs.existsSync(config.dirPath)) {
        fs.mkdirSync(config.dirPath, { recursive: true });
      }

      const targetFilePath = path.join(config.dirPath, backupFileName);
      const targetLatestPath = path.join(config.dirPath, latestFileName);

      if (!primaryBackupFilePath) {
        // First available mounted drive: Perform live SQLite database backup
        await dbInstance.backup(targetFilePath);
        primaryBackupFilePath = targetFilePath;
      } else {
        // Second mounted drive: Mirror the exact backup file created on primary
        fs.copyFileSync(primaryBackupFilePath, targetFilePath);
      }

      // Copy to latest mirror
      try {
        fs.copyFileSync(targetFilePath, targetLatestPath);
      } catch (_) {}

      // Check file size
      const stats = fs.statSync(targetFilePath);
      const sizeBytes = stats.size;

      // Prune old backups in this drive
      pruneOldBackups(config.dirPath, MAX_RETENTION_BACKUPS);

      results.push({
        drive: config.drive,
        targetDir: config.dirPath,
        status: 'success',
        filePath: targetFilePath,
        latestPath: targetLatestPath,
        sizeBytes,
        sizeFormatted: formatBytes(sizeBytes)
      });
    } catch (driveErr) {
      console.error(`[BackupService] Failed backing up to ${config.drive}:`, driveErr.message);
      results.push({
        drive: config.drive,
        targetDir: config.dirPath,
        status: 'failed',
        error: driveErr.message
      });
    }
  }

  // Compile summary
  const successCount = results.filter((r) => r.status === 'success').length;
  const overallSuccess = successCount > 0;

  const cResult = results.find((r) => r.drive === 'C:') || {};
  const dResult = results.find((r) => r.drive === 'D:') || {};

  // Record audit log in database
  try {
    dbInstance.prepare(`
      INSERT INTO database_backups (
        trigger_source, filename,
        c_drive_status, c_drive_path, c_drive_size,
        d_drive_status, d_drive_path, d_drive_size,
        summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trigger,
      backupFileName,
      cResult.status || 'not_evaluated',
      cResult.filePath || null,
      cResult.sizeBytes || 0,
      dResult.status || 'not_evaluated',
      dResult.filePath || null,
      dResult.sizeBytes || 0,
      `Backed up to ${successCount} drive(s). C: ${cResult.status}, D: ${dResult.status}`
    );
  } catch (logErr) {
    console.warn('[BackupService] Notice logging backup to database:', logErr.message);
  }

  return {
    success: overallSuccess,
    timestamp: timestamp.toISOString(),
    filename: backupFileName,
    results,
    successCount,
    totalTargeted: driveConfigs.length,
    summary: `Backup complete: ${successCount} active drive(s) mirrored.`
  };
}

/**
 * Retrieve current backup status across C: and D: drives
 */
function getBackupStatus() {
  const driveConfigs = inspectAvailableDrives();

  const driveStatuses = driveConfigs.map((config) => {
    if (!config.isMounted) {
      return {
        drive: config.drive,
        targetDir: config.dirPath,
        isMounted: false,
        backupsCount: 0,
        latestBackup: null,
        backups: []
      };
    }

    let files = [];
    try {
      if (fs.existsSync(config.dirPath)) {
        files = fs.readdirSync(config.dirPath)
          .filter((f) => f.startsWith('hcp_backup_') && f.endsWith('.db'))
          .map((f) => {
            const p = path.join(config.dirPath, f);
            const st = fs.statSync(p);
            return {
              filename: f,
              fullPath: p,
              sizeBytes: st.size,
              sizeFormatted: formatBytes(st.size),
              createdAt: st.mtime.toISOString(),
              mtime: st.mtime.getTime()
            };
          })
          .sort((a, b) => b.mtime - a.mtime);
      }
    } catch (_) {}

    return {
      drive: config.drive,
      targetDir: config.dirPath,
      isMounted: true,
      backupsCount: files.length,
      latestBackup: files.length > 0 ? files[0] : null,
      backups: files.slice(0, 10) // Return the latest 10 files
    };
  });

  // Recent database audit records
  let recentAuditLogs = [];
  try {
    if (dbInstance) {
      recentAuditLogs = dbInstance.prepare(`
        SELECT * FROM database_backups 
        ORDER BY id DESC LIMIT 5
      `).all();
    }
  } catch (_) {}

  return {
    success: true,
    drives: driveStatuses,
    maxRetention: MAX_RETENTION_BACKUPS,
    recentAuditLogs,
    currentTime: new Date().toISOString()
  };
}

module.exports = {
  initBackupSystem,
  createDualDriveBackup,
  getBackupStatus,
  inspectAvailableDrives
};
