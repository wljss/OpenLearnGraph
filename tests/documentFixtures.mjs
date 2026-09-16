import JSZip from 'jszip';

export function createTestPdf(text = '') {
  const stream = text ? `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Title (PDF Test Book) /Author (Local Author) >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'binary');
}

export async function createTestEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
      <metadata>
        <dc:title>可靠学习</dc:title><dc:creator>本地作者</dc:creator>
        <dc:publisher>开放出版社</dc:publisher><dc:language>zh-CN</dc:language>
        <dc:identifier>urn:isbn:1234567890</dc:identifier>
      </metadata>
      <manifest>
        <item id="chapter-1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
        <item id="chapter-2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="chapter-1"/><itemref idref="chapter-2"/></spine>
    </package>`);
  zip.file('OEBPS/chapter1.xhtml', `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>
    <h1>第一章 基础</h1><p>这是第一章正文。</p><p>用 <strong>机器学习</strong> 解决问题。</p><script>不应进入正文</script>
  </body></html>`);
  zip.file('OEBPS/chapter2.xhtml', `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>
    <h1>第二章 进阶</h1><p>这是第二章正文。</p>
  </body></html>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
