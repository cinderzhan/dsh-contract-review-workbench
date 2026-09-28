import workerCode from 'pdf-worker-text'

let workerUrl
export async function readDocument(file) {
  if (file.size > 15 * 1024 * 1024) throw new Error('文件超过 15 MB，请拆分后导入。')
  const extension = file.name.split('.').at(-1).toLowerCase()
  let text = '', warnings = []
  if (['txt', 'md', 'text'].includes(extension)) text = await file.text()
  else if (extension === 'docx') {
    const { default: mammoth } = await import('mammoth/mammoth.browser.js')
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    text = result.value
    warnings = ['已提取 Word 正文；审核和导出使用文本，不保留原始排版、批注或修订痕迹。']
  } else if (extension === 'pdf') {
    const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }))
    GlobalWorkerOptions.workerSrc = workerUrl
    const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true })
    try {
      const pdf = await task.promise
      if (pdf.numPages > 150) throw new Error('PDF 超过 150 页，请按审核范围拆分。')
      const pages = []
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber)
        const content = await page.getTextContent()
        let pageText = ''
        for (const item of content.items) if ('str' in item) pageText += item.str + (item.hasEOL ? '\n' : ' ')
        pages.push(pageText.trim())
      }
      text = pages.join('\n\n')
      warnings = ['已提取 PDF 文字；表格、多栏内容可能改变顺序，请核对预览。扫描件暂不支持 OCR。']
    } finally { await task.destroy() }
  } else throw new Error('请选择 Word（.docx）、PDF、TXT 或 Markdown 文件。旧版 .doc 请先另存为 .docx。')
  if (!text.trim()) throw new Error('没有读取到文字。扫描件请先在本机完成 OCR，再导入文字版文件。')
  if (text.length > 60000) throw new Error('提取文本超过 60,000 字符，请拆分后审核。')
  return { text: text.replace(/\r\n/g, '\n'), warnings }
}
export async function exportDocx(name, text) {
  const { Document, Packer, Paragraph, TextRun } = await import('docx')
  const doc = new Document({ sections: [{ children: text.split('\n').map(line => new Paragraph({ children: [new TextRun(line)] })) }] })
  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = `${name.replace(/[\\/:*?"<>|]/g, '_').replace(/\.docx$/i, '')}.docx`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
