/*
 * `walkdown migrate` is `walkdown where --fix` now.
 *
 * The name outlived the command. It once renamed directories - allocating a
 * number for each home, moving the records into it, re-pointing the config
 * (n-0124) - and it has moved nothing since the registry went away. What is
 * left is folding the addresses of homes that already exist into the config
 * so `where` can see them, which is `where` finishing its own sentence rather
 * than a migration.
 *
 * Kept as an alias rather than deleted: it is a published command name, and
 * somebody's notes say to run it. It says where it went and then does the
 * work, so nobody is answered with a usage error for following old advice.
 */
import { run as where } from './where.js';

export async function run() {
  console.log("walkdown migrate is now 'walkdown where --fix'. Running that.\n");
  return where(['--fix']);
}
