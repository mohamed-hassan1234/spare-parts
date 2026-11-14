process.env.NODE_ENV = 'test';
process.env.BACKUP_ENCRYPTION_KEY ??= 'a'.repeat(64);
process.env.BACKUP_DIR ??= './.test-backups';
process.env.UPLOAD_DIR ??= './.test-uploads';
