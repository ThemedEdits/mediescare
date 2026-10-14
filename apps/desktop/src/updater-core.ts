/**
 * Updates run only in the installed app. Development builds have no update feed, and tests and the
 * packaged smoke test switch them off with MEDIESCARE_DISABLE_UPDATES=1 so they never touch GitHub.
 */
export function updatesEnabled(input: { isPackaged: boolean; env: NodeJS.ProcessEnv }): boolean {
  return input.isPackaged && input.env.MEDIESCARE_DISABLE_UPDATES !== '1';
}
