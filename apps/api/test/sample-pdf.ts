import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
export async function samplePdf() {
  const d = await PDFDocument.create(),
    font = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    const page = d.addPage([420, 560]);
    page.drawText(i ? 'Signature page' : 'Service agreement', {
      x: 34,
      y: 500,
      size: 23,
      font,
      color: rgb(0.13, 0.25, 0.18),
    });
    page.drawText('Disposable LumoDossier verification document.', { x: 34, y: 462, size: 11, font });
  }
  return Buffer.from(await d.save());
}
