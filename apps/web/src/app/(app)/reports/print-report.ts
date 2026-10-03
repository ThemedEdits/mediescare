/** Save the open report as PDF through the desktop app, or the browser print dialog elsewhere. */
export async function printReport(fileName: string): Promise<string | null> {
  const style = document.createElement('style');
  style.textContent = '@page { size: A4 landscape; margin: 10mm; }';
  document.head.appendChild(style);
  try {
    const save = window.mediescare?.printToPdf;
    if (!save) {
      window.print();
      return null;
    }
    const result = await save(fileName);
    if (!result.ok && result.error !== 'Cancelled')
      throw new Error(result.error ?? 'Could not save the PDF');
    return result.ok ? (result.path ?? null) : null;
  } finally {
    style.remove();
  }
}
