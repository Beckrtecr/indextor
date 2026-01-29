import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { oneDark } from "@codemirror/theme-one-dark";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import LightningFS from "@isomorphic-git/lightning-fs";

// Initialize FS for Git
const fs = new LightningFS("indextor-fs");
const pf = fs.promises;
const GIT_DIR = "/repo"; // Virtual path in LightningFS

// State
let rootHandle = null;
let currentFileHandle = null;
let fileHandles = new Map(); // path -> handle
let fileContent = new Map(); // path -> content
let editor = null;
let isDarkMode = false;
let currentMode = 'split'; // split, editor, preview

// DOM Elements
const editorHost = document.getElementById("editor-host");
const previewFrame = document.getElementById("preview-frame");
const fileListEl = document.getElementById("file-list");
const sidebarEl = document.getElementById("sidebar");
const editorPane = document.getElementById("editor-pane");
const previewPane = document.getElementById("preview-pane");

// --- Initialization ---


async function init() {
  setupTheme();
  setupEventListeners();
  await initEditor();

  // Initialize git directory
  try {
    await pf.mkdir(GIT_DIR);
  } catch (e) { }
}

async function initEditor() {
  /* const { Compartment } = await import("@codemirror/state"); // Imported at top level */
  const themeRef = new Compartment();
  window.themeCompartment = themeRef; // Global ref for toggle

  const startState = EditorState.create({
    doc: "<!-- Open a folder to start editing -->\n<div class='welcome'>\n  <h1>Welcome to Indextor</h1>\n  <p>Open a folder to start building.</p>\n</div>\n<style>\n  .welcome { font-family: sans-serif; text-align: center; color: #888; margin-top: 20%; }\n</style>",
    extensions: [
      basicSetup,
      keymap.of([defaultKeymap, indentWithTab]),
      html(),
      themeRef.of(isDarkMode ? oneDark : EditorView.theme({}, { dark: false })),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          if (currentFileHandle) {
            const path = getPathFromHandle(currentFileHandle);
            if (path) fileContent.set(path, update.state.doc.toString());
          }
        }
      })
    ]
  });

  editor = new EditorView({
    state: startState,
    parent: editorHost
  });
}



function setupTheme() {
  const savedTheme = localStorage.getItem('theme');
  isDarkMode = savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  applyTheme();
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
  localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');

  if (editor && window.themeCompartment) {
    editor.dispatch({
      effects: window.themeCompartment.reconfigure(isDarkMode ? oneDark : EditorView.theme({}, { dark: false }))
    });
  }
}

function setupEventListeners() {
  document.getElementById('folder-btn').addEventListener('click', openFolder);

  document.getElementById('theme-toggle').addEventListener('click', () => {
    isDarkMode = !isDarkMode;
    applyTheme();
    if (editor && window.themeCompartment) {
      editor.dispatch({
        effects: window.themeCompartment.reconfigure(isDarkMode ? oneDark : EditorView.theme({}, { dark: false }))
      });
    }
  });

  document.getElementById('view-toggle-btn').addEventListener('click', toggleViewMode);
  document.getElementById('refresh-preview').addEventListener('click', updatePreview);
  document.getElementById('save-btn').addEventListener('click', saveCurrentFile);

  // Keyboard shortcut for save
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveCurrentFile();
    }
  });
}

// --- Sidebar Logic ---

// Tab Switching
const tabExplorer = document.getElementById('tab-explorer');
const tabSearch = document.getElementById('tab-search');
const viewExplorer = document.getElementById('explorer-view');
const viewSearch = document.getElementById('search-view');

function switchSidebarTab(tabName) {
  if (tabName === 'explorer') {
    tabExplorer.classList.add('active');
    tabSearch.classList.remove('active');
    viewExplorer.classList.remove('hidden');
    viewSearch.classList.add('hidden');
  } else if (tabName === 'search') {
    tabExplorer.classList.remove('active');
    tabSearch.classList.add('active');
    viewExplorer.classList.add('hidden');
    viewSearch.classList.remove('hidden');
    document.getElementById('search-input').focus();
  }
}

tabExplorer.addEventListener('click', () => switchSidebarTab('explorer'));
tabSearch.addEventListener('click', () => switchSidebarTab('search'));

// Resizable Sidebar
const resizer = document.getElementById('sidebar-resizer');
let isResizing = false;

resizer.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizer.classList.add('resizing');
  document.body.style.cursor = 'col-resize';
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  // Calculate new width relative to the left activity bar (48px)
  // e.clientX is total X. Activity bar is 48px.
  // Sidebar starts at 48px.
  // Width = e.clientX - 48
  let newWidth = e.clientX - 48;
  if (newWidth < 150) newWidth = 150;
  if (newWidth > 600) newWidth = 600;
  sidebarEl.style.width = `${newWidth}px`;
});

document.addEventListener('mouseup', () => {
  isResizing = false;
  resizer.classList.remove('resizing');
  document.body.style.cursor = 'default';
});

// --- File System & Tree ---

// We need a structured tree now, not just a list
// Map<path, { handle, kind, children: Map, parent: path }>
let fileTree = { children: new Map(), name: 'root', path: '', kind: 'directory' };

async function openFolder() {
  try {
    const handle = await window.showDirectoryPicker();
    rootHandle = handle;

    // Reset state
    fileHandles.clear();
    fileContent.clear();
    fileTree = { children: new Map(), name: handle.name, path: '', kind: 'directory' };

    fileListEl.innerHTML = '';

    await scanDirectory(rootHandle, fileTree);
    renderFileTree();

    // Update Explorer Header
    document.querySelector('#explorer-view .sidebar-title').textContent = handle.name.toUpperCase();

    // Switch to explorer
    switchSidebarTab('explorer');

    // Default open index.html
    if (fileHandles.has('index.html')) {
      await loadFile('index.html');
    }

  } catch (err) {
    if (err.name !== 'AbortError') console.error("Error opening folder:", err);
  }
}

async function scanDirectory(dirHandle, treeNode) {
  for await (const entry of dirHandle.values()) {
    const relativePath = treeNode.path ? `${treeNode.path}/${entry.name}` : entry.name;

    const node = {
      name: entry.name,
      path: relativePath,
      kind: entry.kind,
      handle: entry,
      children: new Map(),
      isOpen: false // Directory state
    };

    treeNode.children.set(entry.name, node);

    if (entry.kind === 'file') {
      fileHandles.set(relativePath, entry);
      // Lazy load text for search if needed, similar to before
      if (isTextFile(entry.name)) {
        const file = await entry.getFile();
        const text = await file.text();
        fileContent.set(relativePath, text);
      }
    } else if (entry.kind === 'directory') {
      await scanDirectory(entry, node);
    }
  }
}

function renderFileTree() {
  fileListEl.innerHTML = '';
  // Sort: Directories first, then files
  const children = Array.from(fileTree.children.values()).sort((a, b) => {
    if (a.kind === b.kind) return a.name.localeCompare(b.name);
    return a.kind === 'directory' ? -1 : 1;
  });

  children.forEach(child => {
    fileListEl.appendChild(createTreeElement(child, 0));
  });
}

function createTreeElement(node, level) {
  const container = document.createElement('div');
  container.className = node.kind === 'directory' ? 'folder-container' : 'file-container';

  const item = document.createElement('div');
  item.className = 'file-item';
  item.style.paddingLeft = `${level * 12}px`; // indent

  // If directory -> add id for open state
  if (node.kind === 'directory') {
    if (node.isOpen) container.classList.add('folder-open');
  }

  // Arrow
  const arrow = document.createElement('div');
  arrow.className = 'folder-arrow';
  if (node.kind === 'directory') {
    arrow.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`;
  }

  // Icon
  const icon = document.createElement('div');
  icon.className = 'icon-box';

  if (node.kind === 'directory') {
    icon.innerHTML = '📁';
  } else {
    if (node.name.endsWith('.html')) {
      icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e44d26" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`;
    } else if (node.name.endsWith('.css')) {
      icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#264de4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>`;
    } else if (node.name.endsWith('.js')) {
      icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f0db4f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v7.31"></path><path d="M14 9.3V1.99"></path><path d="M8.5 2C4.36 2 1 5.36 1 9.5c0 3.8 2.87 6.96 6.56 7.42"></path><path d="M15 2c4.14 0 7.5 3.36 7.5 7.5 0 3.8-2.87 6.96-6.56 7.42"></path><path d="M10 21V12"></path><path d="M14 12v9"></path></svg>`;
    } else if (isImageFile(node.name)) {
      icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#aa00ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;
    } else {
      icon.innerHTML = '📄';
    }
  }

  // Content wrapper
  const content = document.createElement('div');
  content.className = 'file-item-content';
  content.appendChild(arrow);
  content.appendChild(icon);

  const nameSpan = document.createElement('span');
  nameSpan.textContent = node.name;
  content.appendChild(nameSpan);

  item.appendChild(content);

  // Interaction
  item.onclick = async (e) => {
    e.stopPropagation();
    if (node.kind === 'directory') {
      node.isOpen = !node.isOpen;
      // Re-render
      renderFileTree();
    } else {
      document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      await loadFile(node.path);
    }
  };


  if (node.kind === 'file' && currentFileHandle && getPathFromHandle(currentFileHandle) === node.path) {
    item.classList.add('active');
  }

  container.appendChild(item);

  // Render Children if open
  if (node.kind === 'directory' && node.isOpen) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'folder-children';

    const sortedChildren = Array.from(node.children.values()).sort((a, b) => {
      if (a.kind === b.kind) return a.name.localeCompare(b.name);
      return a.kind === 'directory' ? -1 : 1;
    });

    sortedChildren.forEach(child => {
      childrenContainer.appendChild(createTreeElement(child, level + 1));
    });
    container.appendChild(childrenContainer);
  }

  return container;
}


// --- Editor Logic ---

async function loadFile(path) {
  const handle = fileHandles.get(path);
  if (!handle) return;

  currentFileHandle = handle;

  // Highlight in sidebar
  document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
  const activeEl = document.querySelector(`.file-item[data-path="${path}"]`);
  if (activeEl) activeEl.classList.add('active');

  document.getElementById('current-file-label').textContent = path;

  // Handle Images
  if (isImageFile(path)) {
    const file = await handle.getFile();
    const blob = await file.slice(0, file.size, file.type);
    const url = URL.createObjectURL(blob);

    // Clear editor host
    editorHost.innerHTML = '';
    editorHost.style.display = 'flex';
    editorHost.style.alignItems = 'center';
    editorHost.style.justifyContent = 'center';
    editorHost.style.background = 'var(--bg-color)';

    const img = document.createElement('img');
    img.src = url;
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100%';
    img.style.objectFit = 'contain';

    editorHost.appendChild(img);

    editor = null;

    return;
  }

  // Restore editor host for code
  editorHost.innerHTML = '';
  editorHost.style.display = 'block'; // Default
  editorHost.style.background = '';

  let content = fileContent.get(path);
  if (content === undefined) {
    const file = await handle.getFile();
    content = await file.text();
    fileContent.set(path, content);
  }

  // Detect lang
  let langExt = html();
  if (path.endsWith('.css')) langExt = css();
  if (path.endsWith('.js')) langExt = javascript();
  if (path.endsWith('.json')) langExt = javascript();

  // Initialize Editor
  try {
    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        keymap.of([defaultKeymap, indentWithTab]),
        langExt,
        window.themeCompartment.of(isDarkMode ? oneDark : EditorView.theme({}, { dark: false })),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            fileContent.set(path, update.state.doc.toString());
          }
        })
      ]
    });

    editor = new EditorView({
      state: state,
      parent: editorHost
    });
  } catch (e) {
    console.error("Error loading editor:", e);
    editorHost.innerHTML = `<div class="empty-state" style="color: red;">
      <h3>Error loading file</h3>
      <p>${e.message}</p>
    </div>`;
  }
}

function getPathFromHandle(handle) {
  for (const [path, h] of fileHandles.entries()) {
    if (h === handle) return path;
  }
  return null;
}

function isTextFile(name) {
  return /\.(html|css|js|txt|md|json|svg)$/i.test(name);
}

// --- Editor Actions ---

async function saveCurrentFile() {
  if (!currentFileHandle) return;
  const path = getPathFromHandle(currentFileHandle);
  if (!path) return;

  const content = fileContent.get(path);
  if (content === undefined) return;

  try {
    const writable = await currentFileHandle.createWritable();
    await writable.write(content);
    await writable.close();

    // Show feedback
    const btn = document.getElementById('save-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Saved!';
    setTimeout(() => {
      btn.innerHTML = originalText;
    }, 2000);

    // Refresh preview if needed
    if (currentMode !== 'editor') {
      updatePreview();
    }
  } catch (err) {
    console.error("Save error:", err);
    alert("Could not save file: " + err.message);
  }
}

async function updatePreview() {
  if (!rootHandle) return;

  // Find index.html
  let indexContent = fileContent.get('index.html');
  if (!indexContent) {
    // Try to find it if not loaded
    if (fileHandles.has('index.html')) {
      const handle = fileHandles.get('index.html');
      const file = await handle.getFile();
      indexContent = await file.text();
      fileContent.set('index.html', indexContent);
    }
  }

  if (!indexContent) {
    previewFrame.srcdoc = "<html><body style='font-family:sans-serif; color:#888; text-align:center; margin-top:100px;'><h3>No index.html found in root</h3></body></html>";
    return;
  }

  // Inject CSS and JS from the project for a better preview
  // This is a naive injection - it replaces relative paths with inline content
  let finalHtml = indexContent;

  // For each CSS/JS file we have in virtual memory, try to replace patterns if possible
  // or just use srcdoc as is. For now, srcdoc is the simplest.
  previewFrame.srcdoc = finalHtml;
}

function toggleViewMode() {
  const btn = document.getElementById('view-toggle-btn');
  const span = btn.querySelector('span');

  if (currentMode === 'editor') {
    currentMode = 'split';
    previewPane.classList.remove('hidden');
    editorPane.style.display = 'flex'; // Ensure visible
    span.textContent = 'Preview';
  } else if (currentMode === 'split') {
    currentMode = 'preview';
    editorPane.classList.add('hidden');
    previewPane.classList.remove('hidden'); // Ensure visible
    previewPane.style.flex = '1';
    span.textContent = 'Editor';
  } else {
    currentMode = 'editor';
    editorPane.classList.remove('hidden');
    previewPane.classList.add('hidden');
    span.textContent = 'Split';
  }

  if (currentMode !== 'editor') {
    updatePreview();
  }
}

// --- Search Logic ---

const searchInput = document.getElementById('search-input');
const replaceInput = document.getElementById('replace-input');
const replaceAllBtn = document.getElementById('replace-all-btn');
const searchResultsList = document.getElementById('search-results');

searchInput.addEventListener('input', (e) => {
  performSearch(e.target.value);
});

replaceAllBtn.addEventListener('click', () => {
  performReplaceAll();
});

let searchResults = []; // [{ path, line, content, index, length }]

function performSearch(query) {
  searchResultsList.innerHTML = '';
  searchResults = [];

  if (!query) return;

  const lowerQuery = query.toLowerCase();

  for (const [path, content] of fileContent.entries()) {
    const lines = content.split('\n');
    let fileMatches = [];

    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(lowerQuery)) {
        // Find all occurrences in line
        let startIndex = 0;
        let index;
        while ((index = line.toLowerCase().indexOf(lowerQuery, startIndex)) > -1) {
          fileMatches.push({
            line: i + 1,
            content: line.trim(),
            fullLine: line,
            index: index, // Index in line
          });
          startIndex = index + lowerQuery.length;
        }
      }
    });

    if (fileMatches.length > 0) {
      renderSearchResults(path, fileMatches);
    }
  }
}

function renderSearchResults(path, matches) {
  const fileHeader = document.createElement('div');
  fileHeader.className = 'search-file-header';
  fileHeader.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
        <span>${path}</span>
        <span style="margin-left:auto; font-size:0.7em; background:rgba(0,0,0,0.1); padding:0 6px; border-radius:10px;">${matches.length}</span>
    `;

  fileHeader.onclick = () => loadFile(path);

  searchResultsList.appendChild(fileHeader);

  matches.forEach(match => {
    const matchEl = document.createElement('div');
    matchEl.className = 'search-match';
    // Highlight logic
    matchEl.textContent = match.content; // Simple text for now, could add highliting span
    // TODO: Visual highlight of the matched term

    matchEl.onclick = async () => {
      await loadFile(path);
      // Scroll to line (CodeMirror API)
      // Need to wait for editor init
      if (editor) {
        const lineInfo = editor.state.doc.line(match.line);
        editor.dispatch({
          selection: { anchor: lineInfo.from },
          effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" })
        });
      }
    };
    searchResultsList.appendChild(matchEl);
  });
}

async function performReplaceAll() {
  const query = searchInput.value;
  const replacement = replaceInput.value;
  if (!query) return;

  let count = 0;

  // Iterate all files with matches
  for (const [path, content] of fileContent.entries()) {
    if (content.toLowerCase().includes(query.toLowerCase())) {
      // Global regex replace (case insensitive for this demo?)
      // Creating a regex from string safely
      const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

      const newContent = content.replace(regex, replacement);

      if (newContent !== content) {
        fileContent.set(path, newContent);

        // Write to disk
        const handle = fileHandles.get(path);
        if (handle) {
          const writable = await handle.createWritable();
          await writable.write(newContent);
          await writable.close();
        }

        // If this is the current file, update editor
        if (currentFileHandle && getPathFromHandle(currentFileHandle) === path) {
          const { EditorState } = await import("@codemirror/state");
          editor.dispatch({
            changes: { from: 0, to: editor.state.doc.length, insert: newContent }
          });
        }

        count++;
      }
    }
  }

  // Re-run search to clear/update results
  performSearch(query);
  alert(`Replaced occurrences in ${count} files.`);
}

// --- File Actions ---

const newFileBtn = document.getElementById('new-file-btn');
const importFileBtn = document.getElementById('import-file-btn');
// Check if elements exist to avoid null errors (if index.html isn't updated yet or cache issue)
if (newFileBtn) newFileBtn.addEventListener('click', createNewFile);
if (importFileBtn) importFileBtn.addEventListener('click', importFile);

async function createNewFile() {
  if (!rootHandle) {
    alert("Please open a project folder first.");
    return;
  }

  const fileName = prompt("Enter file name (e.g., script.js):");
  if (!fileName) return;

  try {
    const fileHandle = await rootHandle.getFileHandle(fileName, { create: true });

    // Refresh tree
    fileHandles.clear();
    fileContent.clear();
    fileTree = { children: new Map(), name: rootHandle.name, path: '', kind: 'directory' };
    await scanDirectory(rootHandle, fileTree);
    renderFileTree();

    // Open it
    await loadFile(fileName);
  } catch (err) {
    console.error("Error creating file:", err);
    alert("Could not create file. " + err.message);
  }
}

async function importFile() {
  if (!rootHandle) {
    alert("Please open a project folder first.");
    return;
  }

  try {
    const pickedHandles = await window.showOpenFilePicker({
      multiple: true
    });

    if (!pickedHandles || pickedHandles.length === 0) return;

    for (const srcHandle of pickedHandles) {
      const srcFile = await srcHandle.getFile();
      const destHandle = await rootHandle.getFileHandle(srcFile.name, { create: true });
      const writable = await destHandle.createWritable();
      await writable.write(srcFile);
      await writable.close();
    }

    fileHandles.clear();
    fileContent.clear();
    fileTree = { children: new Map(), name: rootHandle.name, path: '', kind: 'directory' };
    await scanDirectory(rootHandle, fileTree);
    renderFileTree();

    alert("Files imported successfully.");

  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error("Import error:", err);
      alert("Error importing files: " + err.message);
    }
  }
}

function isImageFile(name) {
  return /\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(name);
}

// Start
init();
