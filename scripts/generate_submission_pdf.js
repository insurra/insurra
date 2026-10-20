const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/@playwright/test');

async function generatePDF() {
  const mdPath = path.resolve(__dirname, '../docs/submission/01_INSURRA_Technical_Documentation.md');
  const pdfPath = path.resolve(__dirname, '../docs/submission/01_INSURRA_Technical_Documentation.pdf');

  if (!fs.existsSync(mdPath)) {
    console.error('Markdown file not found:', mdPath);
    process.exit(1);
  }

  const markdownContent = fs.readFileSync(mdPath, 'utf-8');

  // Launch Playwright Chromium
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Create an HTML wrapper with marked, mermaid, and Times New Roman styling
  const htmlTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>INSURRA Technical Documentation</title>
  <style>
    @page {
      size: A4;
      margin: 18mm 15mm 18mm 15mm;
    }
    
    * {
      box-sizing: border-box;
      font-family: "Times New Roman", Times, Georgia, serif !important;
    }

    body {
      font-size: 10.5pt;
      line-height: 1.45;
      color: #111111;
      background-color: #ffffff;
      margin: 0;
      padding: 0;
    }

    h1, h2, h3, h4, h5, h6 {
      color: #000000;
      font-weight: bold;
      line-height: 1.25;
      page-break-after: avoid;
    }

    h1 {
      font-size: 18pt;
      border-bottom: 2px solid #000000;
      padding-bottom: 5px;
      margin-top: 0;
      margin-bottom: 12px;
      text-align: center;
    }

    h2 {
      font-size: 13.5pt;
      border-bottom: 1px solid #444444;
      padding-bottom: 3px;
      margin-top: 18px;
      margin-bottom: 8px;
    }

    h3 {
      font-size: 11.5pt;
      margin-top: 14px;
      margin-bottom: 6px;
    }

    h4 {
      font-size: 10.5pt;
      margin-top: 10px;
      margin-bottom: 4px;
    }

    p {
      margin-top: 0;
      margin-bottom: 5px;
      text-align: justify;
    }

    ul, ol {
      margin-top: 0;
      margin-bottom: 6px;
      padding-left: 20px;
    }

    li {
      margin-bottom: 2px;
      text-align: justify;
    }

    strong {
      color: #000000;
    }

    hr {
      border: 0;
      height: 1px;
      background: #888888;
      margin: 14px 0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0 12px 0;
      font-size: 9.5pt;
      page-break-inside: avoid;
    }

    th, td {
      border: 1px solid #333333;
      padding: 5px 8px;
      text-align: left;
      vertical-align: top;
    }

    th {
      background-color: #f2f2f2;
      font-weight: bold;
      color: #000000;
    }

    tr:nth-child(even) td {
      background-color: #fafafa;
    }

    code {
      font-size: 9pt;
      background-color: #f4f4f4;
      color: #111111;
      padding: 1px 3px;
      border: 1px solid #cccccc;
      border-radius: 2px;
    }

    pre {
      background-color: #f8f8f8;
      color: #111111;
      border: 1px solid #cccccc;
      padding: 8px 10px;
      border-radius: 3px;
      overflow-x: auto;
      font-size: 8.5pt;
      line-height: 1.35;
      margin: 8px 0;
      page-break-inside: avoid;
    }

    pre code {
      background-color: transparent;
      color: inherit;
      padding: 0;
      border: none;
      font-size: inherit;
    }

    blockquote {
      border-left: 3px solid #333333;
      background-color: #f9f9f9;
      padding: 6px 12px;
      margin: 8px 0;
      color: #222222;
      page-break-inside: avoid;
    }

    /* Mermaid diagrams container and scaling - prevents overflow and blank pages */
    .mermaid {
      display: flex;
      justify-content: center;
      align-items: center;
      margin: 10px 0;
      background-color: #ffffff;
      padding: 8px;
      border: 1px solid #dddddd;
      border-radius: 4px;
      page-break-inside: avoid;
      max-height: 420px;
      overflow: hidden;
    }

    .mermaid svg {
      max-height: 400px !important;
      max-width: 100% !important;
      height: auto !important;
      width: auto !important;
      font-family: "Times New Roman", Times, Georgia, serif !important;
    }

    .mermaid text, .mermaid tspan {
      font-family: "Times New Roman", Times, Georgia, serif !important;
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head>
<body>
  <div id="content"></div>

  <script>
    const rawMarkdown = ${JSON.stringify(markdownContent)};

    // Custom renderer for marked to turn mermaid code blocks into <pre class="mermaid">
    const renderer = new marked.Renderer();
    const defaultCode = renderer.code.bind(renderer);
    
    renderer.code = function({ text, lang }) {
      if (lang === 'mermaid') {
        return '<pre class="mermaid">' + text + '</pre>';
      }
      return defaultCode({ text, lang });
    };

    marked.setOptions({
      renderer: renderer,
      gfm: true,
      breaks: false
    });

    document.getElementById('content').innerHTML = marked.parse(rawMarkdown);

    // Initialize mermaid with Times New Roman font
    mermaid.initialize({
      startOnLoad: false,
      theme: 'neutral',
      securityLevel: 'loose',
      fontFamily: '"Times New Roman", Times, serif',
      themeVariables: {
        fontFamily: '"Times New Roman", Times, serif',
        fontSize: '13px',
        primaryColor: '#f1f5f9',
        primaryTextColor: '#000000',
        primaryBorderColor: '#334155',
        lineColor: '#475569',
        secondaryColor: '#f8fafc',
        tertiaryColor: '#ffffff'
      }
    });

    window.renderMermaidAsync = async function() {
      await mermaid.run();
    };
  </script>
</body>
</html>`;

  await page.setContent(htmlTemplate, { waitUntil: 'networkidle' });

  // Run Mermaid diagrams
  console.log('Rendering Mermaid diagrams with Times New Roman...');
  await page.evaluate(async () => {
    if (window.renderMermaidAsync) {
      await window.renderMermaidAsync();
    }
  });

  // Small buffer for SVGs to finalize rendering
  await page.waitForTimeout(1200);

  console.log('Generating PDF...');
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: {
      top: '18mm',
      bottom: '18mm',
      left: '15mm',
      right: '15mm'
    },
    displayHeaderFooter: true,
    headerTemplate: `
      <div style="font-family: 'Times New Roman', Times, serif; font-size: 8pt; width: 100%; border-bottom: 1px solid #999999; padding-bottom: 3px; margin: 0 15mm; display: flex; justify-content: space-between; color: #333333;">
        <span>INSURRA System Technical Documentation - Shenzhen FinTechathon 2026</span>
        <span>Team WGTC - Universitas Indonesia</span>
      </div>
    `,
    footerTemplate: `
      <div style="font-family: 'Times New Roman', Times, serif; font-size: 8pt; width: 100%; border-top: 1px solid #999999; padding-top: 3px; margin: 0 15mm; display: flex; justify-content: space-between; color: #333333;">
        <span>Confidential - Submission Document 01</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    `
  });

  await browser.close();
  console.log('PDF successfully generated at:', pdfPath);
}

generatePDF().catch(err => {
  console.error('PDF generation failed:', err);
  process.exit(1);
});
