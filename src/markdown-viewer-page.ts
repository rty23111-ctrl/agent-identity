export const markdownViewerHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Markdown Library</title>
  <style>
    :root {
      --bg: #f5f8ff;
      --card: #ffffff;
      --border: #dbe4f3;
      --text: #1b2840;
      --muted: #5f6f8c;
      --primary: #2f6bff;
      --code-bg: #f3f6fd;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
      color: var(--text);
      background: radial-gradient(circle at 10% 0%, #e8efff 0%, transparent 40%), linear-gradient(180deg, #f5f8ff, #f8fbff);
      min-height: 100vh;
      padding: 28px 16px;
    }

    .container {
      max-width: 1100px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: 16px;
    }

    .panel, .preview {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: 0 10px 24px rgba(20, 46, 100, 0.08);
    }

    .panel {
      padding: 16px;
      align-self: start;
      position: sticky;
      top: 12px;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 1.25rem;
    }

    .muted {
      color: var(--muted);
      margin: 0 0 14px;
      font-size: 0.92rem;
    }

    .file-panel {
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px;
      background: #f8fbff;
      margin-top: 12px;
      max-height: 420px;
      overflow: auto;
    }

    .file-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
    }

    .file-list button {
      text-align: left;
      background: #fff;
      color: var(--text);
      border: 1px solid var(--border);
      font-weight: 500;
      padding: 8px 10px;
      border-radius: 8px;
      width: 100%;
      cursor: pointer;
      overflow-wrap: anywhere;
    }

    .file-list button:hover {
      background: #f3f7ff;
      border-color: #b8caef;
    }

    .file-list button.active {
      background: #eaf1ff;
      border-color: #9fb7ff;
      color: #213b79;
    }

    button {
      border: none;
      border-radius: 10px;
      background: var(--primary);
      color: white;
      padding: 9px 12px;
      cursor: pointer;
      font-weight: 600;
    }

    button:hover { filter: brightness(0.95); }

    .preview {
      padding: 22px;
      overflow: auto;
      min-height: 70vh;
    }

    .preview-content h1,
    .preview-content h2,
    .preview-content h3 { margin-top: 1.4em; }
    .preview-content p { line-height: 1.6; }
    .preview-content code {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 2px 6px;
      font-size: 0.9em;
    }
    .preview-content pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      overflow-x: auto;
    }
    .preview-content pre code {
      background: transparent;
      border: none;
      padding: 0;
    }
    .preview-content blockquote {
      margin: 0;
      padding: 8px 12px;
      border-left: 4px solid #a9bee9;
      background: #f7faff;
      color: #3d4b67;
    }
    .preview-content table {
      border-collapse: collapse;
      width: 100%;
    }
    .preview-content th,
    .preview-content td {
      border: 1px solid var(--border);
      padding: 8px;
      text-align: left;
    }

    @media (max-width: 920px) {
      .container { grid-template-columns: 1fr; }
      .panel { position: static; }
      .preview { min-height: 50vh; }
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.7/dist/purify.min.js"></script>
</head>
<body>
  <div class="container">
    <section class="panel">
      <h1>Markdown Library</h1>
      <p class="muted">Select one of the predefined markdown documents.</p>

      <div id="filePanel" class="file-panel">
        <ul id="fileList" class="file-list"></ul>
      </div>
    </section>

    <article class="preview">
      <div id="preview" class="preview-content">
        <h1>Preview</h1>
        <p class="muted">Rendered markdown will appear here.</p>
      </div>
    </article>
  </div>

  <script>
    const fileList = document.getElementById("fileList");
    const preview = document.getElementById("preview");
    let selectedDocId = null;
    let markdownDocs = [];

    function renderMarkdown(text) {
      const html = marked.parse(text || "");
      preview.innerHTML = DOMPurify.sanitize(html);
    }

    async function fetchJson(url) {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("Request failed: " + res.status + " " + url);
      }
      return await res.json();
    }

    async function loadDoc(docId) {
      const doc = await fetchJson("/api/markdown-docs/" + encodeURIComponent(docId));
      selectedDocId = doc.id;
      renderFileList();
      renderMarkdown(doc.content);
    }

    function renderFileList() {
      fileList.innerHTML = "";

      if (!markdownDocs.length) {
        const li = document.createElement("li");
        li.className = "muted";
        li.textContent = "No markdown documents configured.";
        fileList.appendChild(li);
        return;
      }

      for (const doc of markdownDocs) {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.textContent = doc.title + " (" + doc.fileName + ")";
        if (selectedDocId === doc.id) btn.classList.add("active");
        btn.onclick = async () => {
          await loadDoc(doc.id);
        };
        li.appendChild(btn);
        fileList.appendChild(li);
      }
    }

    async function refreshDocs() {
      const payload = await fetchJson("/api/markdown-docs");
      markdownDocs = payload.documents || [];
      renderFileList();

      if (markdownDocs.length > 0) {
        await loadDoc(markdownDocs[0].id);
      } else {
        preview.innerHTML = '<h1>Preview</h1><p class="muted">No markdown documents available.</p>';
      }
    }

    refreshDocs().catch((err) => {
      preview.innerHTML = '<h1>Error</h1><p class="muted">' + String(err.message || err) + '</p>';
    });
  </script>
</body>
</html>
`;
