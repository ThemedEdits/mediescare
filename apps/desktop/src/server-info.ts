/** Pure: the text of the "Server address" dialog. */
export function serverAddressText(port: number, addresses: string[]): string {
  if (!addresses.length)
    return 'No network address was found. Connect this PC to the shop network (router or Wi-Fi).';
  return [
    'Terminals connect to one of these addresses:',
    ...addresses.map((a) => `  http://${a}:${port}`),
    '',
    'Terminals on the same network find this server by themselves. If one does not, type the address above on the terminal.',
  ].join('\n');
}

/** Pure: reads the answer of POST /api/sync/pairing-code that the signed-in admin page got. */
export function describePairingAnswer(answer: {
  status: number;
  body: { code?: unknown; error?: { message?: unknown } } | null;
}): { ok: true; code: string } | { ok: false; message: string } {
  if (answer.status === 201 && typeof answer.body?.code === 'string')
    return { ok: true, code: answer.body.code };
  if (answer.status === 401 || answer.status === 403)
    return {
      ok: false,
      message: 'Sign in with an administrator account in the main window first, then try again.',
    };
  const detail = answer.body?.error?.message;
  return {
    ok: false,
    message: typeof detail === 'string' ? detail : `Server answered ${answer.status}`,
  };
}
