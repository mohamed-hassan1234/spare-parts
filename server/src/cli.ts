import readline from 'node:readline';
import { Writable } from 'node:stream';
import { connectDb, bootstrap, disconnectDb } from './db/index.js';
import { migrationStatus } from './db/migrations.js';
import { createSuperAdmin, resetPasswordCli } from './modules/auth/auth.service.js';
import { seedDev } from './db/seed-dev.js';
import { createBackup, restoreBackup, verifyBackupFile } from './modules/backup/backup.service.js';

/**
 * Operator CLI (server console access = the verified recovery channel).
 *   init-admin       Create the single Super Admin (prompts; or INIT_ADMIN_* env vars for automation)
 *   reset-password   Reset a user's password and revoke all their sessions
 *   migrate          Apply pending schema migrations and ensure indexes
 *   seed-dev         Insert fictional demo data (refuses in production / non-empty DB)
 *   backup           Create an encrypted backup now
 *   verify <file>    Verify a backup file decrypts and parses
 *   restore <file> --target <dbName> [--force-live]
 */

async function ask(question: string, hidden = false): Promise<string> {
  let muted = false;
  const out = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output: out, terminal: true });
  const answer = await new Promise<string>((resolve) => {
    rl.question(question, (a) => resolve(a));
    muted = hidden;
  });
  rl.close();
  if (hidden) process.stdout.write('\n');
  return answer.trim();
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === 'help') {
    console.log('Commands: init-admin | reset-password | migrate | seed-dev | backup | verify <file> | restore <file> --target <db> [--force-live]');
    return;
  }
  await connectDb();
  await bootstrap();
  try {
    switch (cmd) {
      case 'init-admin': {
        const username = process.env.INIT_ADMIN_USERNAME || (await ask('Username: '));
        const fullName = process.env.INIT_ADMIN_FULLNAME || (await ask('Full name: '));
        const email = process.env.INIT_ADMIN_EMAIL || (process.env.INIT_ADMIN_PASSWORD ? undefined : (await ask('Recovery email (optional): ')) || undefined);
        let password = process.env.INIT_ADMIN_PASSWORD || undefined;
        if (!password) {
          password = await ask('Password (min 10 chars, upper, lower, digit): ', true);
          const confirm = await ask('Confirm password: ', true);
          if (password !== confirm) throw new Error('Passwords do not match');
        }
        const u = await createSuperAdmin({ username, fullName, email, password });
        console.log(`Super Admin "${u.username}" created.`);
        break;
      }
      case 'reset-password': {
        const username = args[0] ?? (await ask('Username: '));
        const password = process.env.RESET_PASSWORD || (await ask('New password: ', true));
        await resetPasswordCli(username, password);
        console.log('Password reset. All sessions for this user were signed out.');
        break;
      }
      case 'migrate':
        console.table(await migrationStatus());
        break;
      case 'seed-dev':
        console.log('Seeded fictional demo data:', await seedDev());
        break;
      case 'backup': {
        const log = await createBackup('MANUAL');
        console.log(`Backup written: ${log.fileName} (${log.sizeBytes} bytes, verified=${log.verified})`);
        break;
      }
      case 'verify': {
        if (!args[0]) throw new Error('Usage: verify <fileName>');
        const ok = await verifyBackupFile(args[0]);
        console.log(ok ? 'Backup is valid.' : 'Backup FAILED verification.');
        if (!ok) process.exitCode = 1;
        break;
      }
      case 'restore': {
        const file = args[0];
        const t = args.indexOf('--target');
        const target = t >= 0 ? args[t + 1] : undefined;
        if (!file || !target) throw new Error('Usage: restore <fileName> --target <newDatabaseName> [--force-live]');
        const forceLive = args.includes('--force-live');
        if (forceLive) {
          const typed = await ask(`This will REPLACE ALL DATA in "${target}". A pre-restore backup is taken first. Type the database name to confirm: `);
          if (typed !== target) throw new Error('Confirmation did not match; nothing was changed.');
        }
        console.log(await restoreBackup(file, target, { allowLive: forceLive }));
        break;
      }
      default:
        throw new Error(`Unknown command ${cmd}`);
    }
  } finally {
    await disconnectDb();
  }
}

main().catch((e) => {
  console.error('Error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
