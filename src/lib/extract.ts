// Läser ut text ur uppladdade filer direkt i webbläsaren.
import JSZip from 'jszip';

export interface Source {
  id: string;
  name: string;
  kind: 'docx' | 'pptx' | 'pdf' | 'text' | 'link';
  text: string;
  /** Kort beskrivning, t.ex. "12 bilder inlästa". */
  summary: string;
}

const newId = () => Math.random().toString(36).slice(2, 10);

export async function extractFile(file: File): Promise<Source> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'docx') return extractDocx(file);
  if (ext === 'pptx') return extractPptx(file);
  if (ext === 'pdf') return extractPdf(file);
  if (['txt', 'md', 'text'].includes(ext) || file.type.startsWith('text/')) {
    const text = (await file.text()).trim();
    return { id: newId(), name: file.name, kind: 'text', text, summary: `${countWords(text)} ord inlästa` };
  }
  throw new Error(`Filtypen .${ext || '?'} stöds inte än. Prova Word, PowerPoint, PDF eller text.`);
}

async function extractDocx(file: File): Promise<Source> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const text = value.replace(/\n{3,}/g, '\n\n').trim();
  return { id: newId(), name: file.name, kind: 'docx', text, summary: `${countWords(text)} ord inlästa` };
}

/** Plockar ut texten ur varje bild (a:t-element) och bildens anteckningar. */
export async function extractPptxFromBuffer(buf: ArrayBuffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(zip.files)
    .map((p) => ({ p, m: p.match(/^ppt\/slides\/slide(\d+)\.xml$/) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(a.m![1]) - Number(b.m![1]));
  const slides: string[] = [];
  for (const { p, m } of slideFiles) {
    const xml = await zip.file(p)!.async('string');
    let text = xmlText(xml);
    const notes = zip.file(`ppt/notesSlides/notesSlide${m![1]}.xml`);
    if (notes) {
      const n = xmlText(await notes.async('string')).replace(/^\d+$/m, '').trim();
      if (n) text += `\n(Anteckningar: ${n})`;
    }
    slides.push(text.trim());
  }
  return slides;
}

function xmlText(xml: string): string {
  // Varje <a:p> är ett stycke, <a:t> innehåller texten.
  return xml
    .split(/<\/a:p>/)
    .map((para) => [...para.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(''))
    .filter((s) => s.trim())
    .join('\n');
}

function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function extractPptx(file: File): Promise<Source> {
  const slides = await extractPptxFromBuffer(await file.arrayBuffer());
  const text = slides.map((s, i) => `[Bild ${i + 1}]\n${s}`).join('\n\n');
  return { id: newId(), name: file.name, kind: 'pptx', text, summary: `${slides.length} ${slides.length === 1 ? "bild" : "bilder"} inlästa` };
}

async function extractPdf(file: File): Promise<Source> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items.map((it) => ('str' in it ? it.str : '')).join(' ');
    pages.push(`[Sida ${i}]\n${line.replace(/\s+/g, ' ').trim()}`);
  }
  const text = pages.join('\n\n');
  return { id: newId(), name: file.name, kind: 'pdf', text, summary: `${doc.numPages} ${doc.numPages === 1 ? "sida" : "sidor"} inlästa` };
}

/**
 * Webblänkar: utan egen backend kan webbläsaren bara läsa sidor som tillåter det.
 * Wikipedia har ett öppet API, så det stöds redan nu.
 */
export async function extractLink(url: string): Promise<Source> {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new Error('Det ser inte ut som en giltig länk.');
  }
  const wiki = u.hostname.match(/^([a-z-]+)\.(?:m\.)?wikipedia\.org$/);
  const title = decodeURIComponent(u.pathname.replace(/^\/wiki\//, ''));
  if (wiki && u.pathname.startsWith('/wiki/') && title) {
    const api = `https://${wiki[1]}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(title)}`;
    const res = await fetch(api);
    if (!res.ok) throw new Error('Kunde inte hämta sidan från Wikipedia.');
    const data = await res.json();
    const page = Object.values(data?.query?.pages ?? {})[0] as { title?: string; extract?: string } | undefined;
    if (!page?.extract) throw new Error('Hittade ingen text på den Wikipedia-sidan.');
    const text = page.extract.trim();
    return { id: newId(), name: `Wikipedia: ${page.title}`, kind: 'link', text, summary: `${countWords(text)} ord inlästa` };
  }
  throw new Error(
    'Just nu fungerar bara länkar till Wikipedia. Andra webbsidor kommer när appen får en egen server. Du kan kopiera texten och klistra in den istället.',
  );
}

export function textSource(name: string, text: string): Source {
  return { id: newId(), name, kind: 'text', text: text.trim(), summary: `${countWords(text)} ord` };
}

export function countWords(s: string) {
  return s.split(/\s+/).filter(Boolean).length;
}
