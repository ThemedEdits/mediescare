/** What the Electron preload script exposes to pages. Missing in a normal browser and in the test runner. */
interface MediescareBridge {
  printToPdf?: (suggestedName: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
}

interface Window {
  mediescare?: MediescareBridge;
}
