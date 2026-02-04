import { EditorView, basicSetup } from "codemirror";
import { keymap, drawSelection, highlightActiveLine, dropCursor, rectangularSelection, crosshairCursor } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { oneDark } from "@codemirror/theme-one-dark";
import { autocompletion, closeBrackets, completionKeymap, closeBracketsKeymap, snippet } from "@codemirror/autocomplete";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, defaultHighlightStyle, LanguageDescription } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { sql } from "@codemirror/lang-sql";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { php } from "@codemirror/lang-php";
import { json } from "@codemirror/lang-json";
import { StreamLanguage } from "@codemirror/language";
import { csharp, kotlin } from "@codemirror/legacy-modes/mode/clike";
import { swift } from "@codemirror/legacy-modes/mode/swift";


import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import LightningFS from "@isomorphic-git/lightning-fs";

// --- Custom Extensions ---

const selfClosing = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"];

// Simple auto-close tag extension for HTML
function autoCloseTags() {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== ">" || view.state.readOnly) return false;
    let { state } = view;
    let changes = state.changeByRange(range => {
      let { from, to } = range;
      let line = state.doc.lineAt(from);
      let textBefore = line.text.slice(0, from - line.from);
      let match = /<([a-zA-Z0-9\-]+)[^>]*$/.exec(textBefore);
      if (match) {
        let tagName = match[1];
        if (selfClosing.includes(tagName.toLowerCase())) return { range };

        let insert = ">" + "</" + tagName + ">";
        return {
          range: { from: from + 1, to: from + 1 },
          changes: { from, to, insert }
        };
      }
      return { range };
    });
    view.dispatch(changes);
    return true;
  });
}

// Custom HTML attribute completions
function htmlAttributeCompletions(context) {
  let word = context.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  // Check if we are inside a tag
  let textBefore = context.state.doc.sliceString(Math.max(0, context.pos - 500), context.pos);
  let lastOpenTag = textBefore.lastIndexOf('<');
  let lastCloseTag = textBefore.lastIndexOf('>');

  if (lastOpenTag > lastCloseTag) {
    // We are likely inside a tag
    return {
      from: word.from,
      options: [
        { label: "class", type: "property", apply: snippet('class="${}"'), detail: "CSS class" },
        { label: "id", type: "property", apply: snippet('id="${}"'), detail: "Unique ID" },
        { label: "style", type: "property", apply: snippet('style="${}"'), detail: "Inline CSS" },
        { label: "href", type: "property", apply: snippet('href="${}"'), detail: "Link URL" },
        { label: "src", type: "property", apply: snippet('src="${}"'), detail: "Source URL" },
        { label: "alt", type: "property", apply: snippet('alt="${}"'), detail: "Alt text" },
        { label: "type", type: "property", apply: snippet('type="${}"'), detail: "Input type" },
        { label: "value", type: "property", apply: snippet('value="${}"'), detail: "Input value" },
        { label: "placeholder", type: "property", apply: snippet('placeholder="${}"'), detail: "Placeholder text" },
        { label: "name", type: "property", apply: snippet('name="${}"'), detail: "Form name" },
        { label: "rel", type: "property", apply: snippet('rel="${}"'), detail: "Relationship" },
        { label: "target", type: "property", apply: snippet('target="_blank"'), detail: "Open target" },
        { label: "onclick", type: "property", apply: snippet('onclick="${}"'), detail: "Click handler" },
      ],
      validFor: /^\w*$/
    };
  }
  return null;
}

// Initialize FS for Git
const fs = new LightningFS("indextor-fs");
const pf = fs.promises;
const GIT_DIR = "/repo"; // Virtual path in LightningFS

// State
let rootHandle = null;
let currentFileHandle = null;
let openTabs = []; // Array of paths
let fileHandles = new Map(); // path -> handle
let fileContent = new Map(); // path -> content
let editor = null;
let isDarkMode = true;
let currentMode = 'editor'; // split, editor, preview
let creatingNewItem = null; // { type: 'file' | 'folder', parentNode: node }
let renamingItem = null;
let currentPreviewFile = 'index.html';
let searchQuery = '';

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
  showWelcomeScreen();

  // Initialize git directory
  try {
    await pf.mkdir(GIT_DIR);
  } catch (e) { }

  // Register Preview Service Worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./preview-sw.js');
      console.log('Preview Service Worker registered');
    } catch (err) {
      console.error('Service Worker registration failed:', err);
    }
  }
}

function showWelcomeScreen() {
  editorHost.innerHTML = `
    <div class="welcome-screen">
      <img src="./logo.png" alt="Indextor Logo" class="welcome-logo" />
      <h1 class="welcome-title">Welcome to Indextor</h1>
      <p class="welcome-subtitle">Open a folder to start building your next project with beauty and speed.</p>
      <button class="btn btn-primary" id="welcome-open-btn" style="padding: 12px 24px; font-size: 1rem;">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        Open Folder
      </button>
    </div>
  `;
  document.getElementById('welcome-open-btn').addEventListener('click', openFolder);

  // Clear the label
  document.getElementById('current-file-label').textContent = 'No file open';
}

async function initEditor(content = "", langExt = html()) {
  const themeRef = new Compartment();
  window.themeCompartment = themeRef; // Global ref for toggle

  const startState = EditorState.create({
    doc: content,
    extensions: [
      basicSetup,
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...searchKeymap,
        indentWithTab
      ]),
      langExt,
      autoCloseTags(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({
        activateOnTyping: true,
        override: langExt === html() ? [htmlAttributeCompletions] : null
      }),
      highlightSelectionMatches(),
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

  if (editor) {
    editor.destroy();
  }

  editor = new EditorView({
    state: startState,
    parent: editorHost
  });
}



function setupTheme() {
  isDarkMode = true;
  applyTheme();
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', 'dark');

  if (editor && window.themeCompartment) {
    editor.dispatch({
      effects: window.themeCompartment.reconfigure(oneDark)
    });
  }
}

function setupEventListeners() {
  document.getElementById('folder-btn').addEventListener('click', openFolder);

  // Theme toggle removed as requested

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

  // Search functionality
  const searchInput = document.getElementById('sidebar-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      renderFileTree();
    });
  }
}

// --- Sidebar Logic ---

// Resizable Sidebar
const resizer = document.getElementById('sidebar-resizer');
let isResizing = false;

resizer.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizer.classList.add('resizing');
  document.body.style.cursor = 'col-resize';
  previewFrame.style.pointerEvents = 'none'; // Prevent iframe from stealing events
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  // Calculate new width relative to the left (0px now)
  let newWidth = e.clientX;
  if (newWidth < 150) newWidth = 150;
  if (newWidth > 600) newWidth = 600;
  sidebarEl.style.width = `${newWidth}px`;
});

document.addEventListener('mouseup', () => {
  isResizing = false;
  resizer.classList.remove('resizing');
  document.body.style.cursor = 'default';
  previewFrame.style.pointerEvents = 'auto'; // Re-enable iframe events
});

// Workspace Resizer (Editor / Preview)
const workspaceResizer = document.getElementById('workspace-resizer');
let isWorkspaceResizing = false;

if (workspaceResizer) {
  workspaceResizer.addEventListener('mousedown', (e) => {
    isWorkspaceResizing = true;
    workspaceResizer.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    previewFrame.style.pointerEvents = 'none'; // Prevent iframe from stealing events
  });

  document.addEventListener('mousemove', (e) => {
    if (!isWorkspaceResizing) return;
    const sidebarWidth = sidebarEl.getBoundingClientRect().width;
    const containerWidth = document.querySelector('.main-content').getBoundingClientRect().width;
    let newEditorWidth = e.clientX - sidebarWidth;

    if (newEditorWidth < 100) newEditorWidth = 100;
    if (newEditorWidth > containerWidth - 100) newEditorWidth = containerWidth - 100;

    editorPane.style.flex = 'none';
    editorPane.style.width = `${newEditorWidth}px`;
  });

  document.addEventListener('mouseup', () => {
    isWorkspaceResizing = false;
    workspaceResizer.classList.remove('resizing');
    document.body.style.cursor = 'default';
    previewFrame.style.pointerEvents = 'auto'; // Re-enable iframe events
  });
}

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
    openTabs = [];
    fileTree = { children: new Map(), name: handle.name, path: '', kind: 'directory' };

    fileListEl.innerHTML = '';

    await scanDirectory(rootHandle, fileTree);
    renderFileTree();

    // Update Explorer Header
    document.querySelector('#explorer-view .sidebar-title').textContent = handle.name.toUpperCase();


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
      // Lazy load content
      const file = await entry.getFile();
      if (isTextFile(entry.name)) {
        const text = await file.text();
        fileContent.set(relativePath, text);
      } else {
        const buffer = await file.arrayBuffer();
        fileContent.set(relativePath, buffer);
      }
    } else if (entry.kind === 'directory') {
      await scanDirectory(entry, node);
    }
  }
}

function renderFileTree() {
  fileListEl.innerHTML = '';

  // If creating a new item, show inline input at the top
  if (creatingNewItem) {
    const inputContainer = document.createElement('div');
    inputContainer.className = 'file-item inline-input-container';
    inputContainer.style.paddingLeft = '0px';

    const icon = document.createElement('div');
    icon.className = 'icon-box';
    icon.innerHTML = creatingNewItem.type === 'folder' ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #64748b;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>` : '📄';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-name-input';
    input.placeholder = creatingNewItem.type === 'folder' ? 'Folder name...' : 'File name...';
    input.autocomplete = 'off';

    inputContainer.appendChild(icon);
    inputContainer.appendChild(input);
    fileListEl.appendChild(inputContainer);

    // Focus the input
    setTimeout(() => input.focus(), 0);

    // Handle input submission
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const name = input.value.trim();
        if (name) {
          if (creatingNewItem.type === 'file') {
            await finalizeCreateFile(name, creatingNewItem.parentNode);
          } else {
            await finalizeCreateFolder(name, creatingNewItem.parentNode);
          }
        } else {
          creatingNewItem = null;
          renderFileTree();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        creatingNewItem = null;
        renderFileTree();
      }
    });

    // Handle blur (click outside)
    input.addEventListener('blur', () => {
      setTimeout(() => {
        creatingNewItem = null;
        renderFileTree();
      }, 200);
    });
  }

  // Sort: Directories first, then files
  const children = Array.from(fileTree.children.values()).sort((a, b) => {
    if (a.kind === b.kind) return a.name.localeCompare(b.name);
    return a.kind === 'directory' ? -1 : 1;
  });

  let hasMatches = false;
  children.forEach(child => {
    const el = createTreeElement(child, 0);
    if (el) {
      fileListEl.appendChild(el);
      hasMatches = true;
    }
  });

  if (!hasMatches && searchQuery) {
    fileListEl.innerHTML = `<div class="empty-message">No files match "${searchQuery}"</div>`;
  }
}

function hasSearchMatch(node, query) {
  if (!query) return true;
  if (node.name.toLowerCase().includes(query)) return true;
  if (node.kind === 'directory') {
    for (const child of node.children.values()) {
      if (hasSearchMatch(child, query)) return true;
    }
  }
  return false;
}

function createTreeElement(node, level) {
  // If searching, hide nodes that don't match and aren't parents of matches
  if (searchQuery && !hasSearchMatch(node, searchQuery)) {
    return null;
  }

  const container = document.createElement('div');
  container.className = node.kind === 'directory' ? 'folder-container' : 'file-container';

  const item = document.createElement('div');
  item.className = 'file-item';
  item.style.paddingLeft = `${level * 12}px`; // indent

  // If directory -> add id for open state
  const isActuallyOpen = node.isOpen || (searchQuery && hasSearchMatch(node, searchQuery));
  if (node.kind === 'directory') {
    if (isActuallyOpen) container.classList.add('folder-open');
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

  icon.innerHTML = getIconForFile(node.name, node.kind);

  // Content wrapper
  const content = document.createElement('div');
  content.className = 'file-item-content';
  content.appendChild(arrow);
  content.appendChild(icon);

  if (node === renamingItem) {
    const inputNode = document.createElement('input');
    inputNode.type = 'text';
    inputNode.className = 'inline-name-input';
    inputNode.value = node.name;
    inputNode.autocomplete = 'off';
    content.appendChild(inputNode);

    setTimeout(() => {
      inputNode.focus();
      inputNode.select();
    }, 0);

    inputNode.onkeydown = async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const newName = inputNode.value.trim();
        if (newName && newName !== node.name) {
          await finalizeRename(node, newName);
        } else {
          renamingItem = null;
          renderFileTree();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        renamingItem = null;
        renderFileTree();
      }
    };

    inputNode.onblur = () => {
      setTimeout(() => {
        if (renamingItem === node) {
          renamingItem = null;
          renderFileTree();
        }
      }, 200);
    };
  } else {
    const nameSpan = document.createElement('span');
    nameSpan.textContent = node.name;
    content.appendChild(nameSpan);
  }

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

  // Context menu (right-click)
  item.oncontextmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, node);
  };


  if (node.kind === 'file' && currentFileHandle && getPathFromHandle(currentFileHandle) === node.path) {
    item.classList.add('active');
  }

  container.appendChild(item);

  // Render Children if open
  if (node.kind === 'directory' && isActuallyOpen) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'folder-children';

    const sortedChildren = Array.from(node.children.values()).sort((a, b) => {
      if (a.kind === b.kind) return a.name.localeCompare(b.name);
      return a.kind === 'directory' ? -1 : 1;
    });

    sortedChildren.forEach(child => {
      const el = createTreeElement(child, level + 1);
      if (el) childrenContainer.appendChild(el);
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

  // Tabs logic
  if (!openTabs.includes(path)) {
    openTabs.push(path);
  }
  renderTabs();

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
  if (path.endsWith('.jsx')) langExt = javascript({ jsx: true });
  if (path.endsWith('.ts')) langExt = javascript({ typescript: true });
  if (path.endsWith('.tsx')) langExt = javascript({ typescript: true, jsx: true });
  if (path.endsWith('.py')) langExt = python();
  if (path.endsWith('.java')) langExt = java();
  if (path.endsWith('.cpp') || path.endsWith('.h') || path.endsWith('.hpp') || path.endsWith('.cc')) langExt = cpp();
  if (path.endsWith('.sql')) langExt = sql();
  if (path.endsWith('.rs')) langExt = rust();
  if (path.endsWith('.go')) langExt = go();
  if (path.endsWith('.php')) langExt = php();
  if (path.endsWith('.json')) langExt = json();
  if (path.endsWith('.cs')) langExt = StreamLanguage.define(csharp);
  if (path.endsWith('.kt')) langExt = StreamLanguage.define(kotlin);
  if (path.endsWith('.swift')) langExt = StreamLanguage.define(swift);


  // Initialize Editor
  try {
    await initEditor(content, langExt);
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
  return /\.(html|css|js|jsx|ts|tsx|py|java|cpp|h|hpp|cc|sql|rs|go|php|json|cs|kt|swift|txt|md|svg)$/i.test(name);
}


function getIconForFile(name, kind) {
  if (kind === 'directory') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #64748b;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
  } else {
    name = name.toLowerCase();
    if (name.endsWith('.html')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e44d26" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`;
    } else if (name.endsWith('.css')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#264de4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>`;
    } else if (name.endsWith('.js') || name.endsWith('.jsx')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f0db4f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v7.31"></path><path d="M14 9.3V1.99"></path><path d="M8.5 2C4.36 2 1 5.36 1 9.5c0 3.8 2.87 6.96 6.56 7.42"></path><path d="M15 2c4.14 0 7.5 3.36 7.5 7.5 0 3.8-2.87 6.96-6.56 7.42"></path><path d="M10 21V12"></path><path d="M14 12v9"></path></svg>`;
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3178c6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><path d="M7 8h3m-1.5 0v8m2.5-8h4m-2 0v8"></path></svg>`;
    } else if (name.endsWith('.py')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3776ab" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v10m0 0l-4-4m4 4l4-4"></path><circle cx="12" cy="12" r="10"></circle></svg>`;
    } else if (name.endsWith('.java')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b07219" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V8z"></path><path d="M10 12l4-4"></path></svg>`;
    } else if (name.endsWith('.cpp') || name.endsWith('.h') || name.endsWith('.hpp')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00599c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M14.8 9c-.4-.4-.9-.6-1.4-.6-1.1 0-2 .9-2 2s.9 2 2 2c.5 0 1-.2 1.4-.6"></path></svg>`;
    } else if (name.endsWith('.sql')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#336791" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>`;
    } else if (name.endsWith('.cs')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#178600" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l10 5v10l-10 5-10-5V7l10-5z"></path><path d="M7 10h4m-4 4h4m1 1l3-10"></path></svg>`;
    } else if (name.endsWith('.rs')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dea584" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 12h8m-4-4v8"></path></svg>`;
    } else if (name.endsWith('.go')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00add8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8h-6a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h6l4-4-4-4z"></path></svg>`;
    } else if (name.endsWith('.php')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4f5b93" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="10" ry="6"></ellipse><path d="M9 12h6"></path></svg>`;
    } else if (name.endsWith('.kt')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7f52ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 21H3V3h18l-9 9 9 9z"></path></svg>`;
    } else if (name.endsWith('.swift')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f05138" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 13s-5-1-11-1-11 1-11 1c5-3 10-6 10-6s-5-3-10-6c0 0 5 1 11 1s11-1 11-1c-5 3-10 6-10 6s5 3 10 6z"></path></svg>`;
    } else if (name.endsWith('.json')) {

      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#cbcb41" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 20l-4-4 4-4m4 0l4 4-4 4"></path><path d="M4 8V6a2 2 0 0 1 2-2h2m8 0h2a2 2 0 0 1 2 2v2m0 8v2a2 2 0 0 1-2 2h-2m-8 0H6a2 2 0 0 1-2-2v-2"></path></svg>`;
    } else if (isImageFile(name)) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#aa00ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;
    } else {
      return '📄';
    }
  }
}


function renderTabs() {
  const tabsContainer = document.getElementById('file-tabs');
  if (!tabsContainer) return;

  tabsContainer.innerHTML = '';
  openTabs.forEach(path => {
    const fileName = path.split('/').pop();
    const tabEl = document.createElement('div');
    const isActive = currentFileHandle && getPathFromHandle(currentFileHandle) === path;
    tabEl.className = `tab ${isActive ? 'active' : ''}`;

    tabEl.innerHTML = `
      <div class="tab-icon">${getIconForFile(fileName, 'file')}</div>
      <span class="tab-name" title="${path}">${fileName}</span>
      <div class="tab-close" title="Close Tab">×</div>
    `;

    tabEl.onclick = () => loadFile(path);
    tabEl.querySelector('.tab-close').onclick = (e) => {
      e.stopPropagation();
      closeTab(path);
    };

    tabsContainer.appendChild(tabEl);

    // Scroll into view if active
    if (isActive) {
      tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  });
}

async function closeTab(path) {
  const index = openTabs.indexOf(path);
  if (index === -1) return;

  openTabs.splice(index, 1);

  if (openTabs.length === 0) {
    currentFileHandle = null;
    showWelcomeScreen();
  } else if (currentFileHandle && getPathFromHandle(currentFileHandle) === path) {
    // Open the next available tab
    const nextPath = openTabs[Math.min(index, openTabs.length - 1)];
    await loadFile(nextPath);
  } else {
    renderTabs();
  }
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
      updatePreview(currentPreviewFile);
    }
  } catch (err) {
    console.error("Save error:", err);
    alert("Could not save file: " + err.message);
  }
}

async function syncFilesToSW() {
  if (!navigator.serviceWorker.controller) {
    console.log('[Main] Waiting for Service Worker controller...');
    await new Promise(resolve => {
      const handler = () => {
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.removeEventListener('controllerchange', handler);
          resolve();
        }
      };
      navigator.serviceWorker.addEventListener('controllerchange', handler);
      setTimeout(resolve, 1000); // 1s fallback
    });
  }

  if (navigator.serviceWorker.controller) {
    const filesObj = {};
    for (const [path, content] of fileContent.entries()) {
      filesObj[path] = content;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[Main] Sync to SW timed out');
        resolve();
      }, 2000);

      const messageHandler = (event) => {
        if (event.data && event.data.type === 'FILES_SET_ACK') {
          clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener('message', messageHandler);
          console.log('[Main] Sync to SW successful');
          resolve();
        }
      };

      navigator.serviceWorker.addEventListener('message', messageHandler);

      navigator.serviceWorker.controller.postMessage({
        type: 'SET_FILES',
        files: filesObj
      });
    });
  }
}

async function updatePreview(previewFile) {
  if (!rootHandle) return;
  const fileToUse = (typeof previewFile === 'string') ? previewFile : currentPreviewFile;
  currentPreviewFile = fileToUse;

  await syncFilesToSW();

  const timestamp = Date.now();
  previewFrame.src = `preview/${fileToUse}?t=${timestamp}`;
}

function showFileSelectionModal() {
  return new Promise((resolve) => {
    const previewableExtensions = ['.html', '.json', '.jsx', '.tsx', '.py', '.java', '.cpp', '.sql', '.rs', '.go', '.php', '.cs', '.kt', '.swift', '.ts'];
    const previewableFiles = Array.from(fileHandles.keys()).filter(path =>
      previewableExtensions.some(ext => path.toLowerCase().endsWith(ext))
    );

    if (previewableFiles.length === 0) {
      alert("No previewable files found in the project.");
      resolve(null);
      return;
    }

    if (previewableFiles.length === 1) {
      resolve(previewableFiles[0]);
      return;
    }


    // Create modal
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content fade-in';

    modalContent.innerHTML = `
      <div class="modal-header">
        <h3>Choose File to Preview</h3>
        <button class="icon-btn" id="modal-close">×</button>
      </div>
      <div class="modal-body">
        ${previewableFiles.map(path => {
      const ext = path.split('.').pop();
      return `
          <div class="file-select-item" data-path="${path}">
            <span class="icon">
              <span style="font-size: 10px; font-weight: bold; opacity: 0.7;">${ext.toUpperCase()}</span>
            </span>
            <span>${path}</span>
          </div>
          `;
    }).join('')}
      </div>

    `;

    modalOverlay.appendChild(modalContent);
    document.body.appendChild(modalOverlay);

    const closeModal = () => {
      modalOverlay.remove();
      resolve(null);
    };

    modalContent.addEventListener('click', (e) => {
      const item = e.target.closest('.file-select-item');
      if (item) {
        const path = item.getAttribute('data-path');
        modalOverlay.remove();
        resolve(path);
      }
    });

    modalContent.querySelector('#modal-close').onclick = closeModal;
    modalOverlay.onclick = (e) => { if (e.target === modalOverlay) closeModal(); };
  });
}

async function toggleViewMode() {
  const btn = document.getElementById('view-toggle-btn');
  const span = btn.querySelector('span');
  const wsResizer = document.getElementById('workspace-resizer');

  if (currentMode === 'editor') {
    const fileToPreview = await showFileSelectionModal();
    if (!fileToPreview) return;

    currentMode = 'split';
    previewPane.classList.remove('hidden');
    editorPane.classList.remove('hidden');
    if (wsResizer) wsResizer.classList.remove('hidden');
    editorPane.style.width = '50%'; // Reset to split
    editorPane.style.flex = 'none';
    span.textContent = 'Preview';
    updatePreview(fileToPreview);
  } else if (currentMode === 'split') {
    currentMode = 'preview';
    editorPane.classList.add('hidden');
    previewPane.classList.remove('hidden');
    if (wsResizer) wsResizer.classList.add('hidden');
    previewPane.style.flex = '1';
    span.textContent = 'Editor';
  } else {
    currentMode = 'editor';
    editorPane.classList.remove('hidden');
    previewPane.classList.add('hidden');
    if (wsResizer) wsResizer.classList.add('hidden');
    editorPane.style.flex = '1';
    editorPane.style.width = 'auto';
    span.textContent = 'Split';
  }
}

// --- Search Logic ---

// --- Search Logic Removed ---
// Use Browser Find (Cmd+F) instead.

// --- File Actions ---

const newFileBtn = document.getElementById('new-file-btn');
const newFolderBtn = document.getElementById('new-folder-btn');
const importFileBtn = document.getElementById('import-file-btn');
// Check if elements exist to avoid null errors (if index.html isn't updated yet or cache issue)
if (newFileBtn) newFileBtn.addEventListener('click', createNewFile);
if (newFolderBtn) newFolderBtn.addEventListener('click', createNewFolder);
if (importFileBtn) importFileBtn.addEventListener('click', importFile);

async function createNewFile() {
  if (!rootHandle) {
    alert("Please open a project folder first.");
    return;
  }

  // Set state to show inline input
  creatingNewItem = { type: 'file', parentNode: fileTree };
  renderFileTree();
}

async function finalizeCreateFile(fileName, parentNode) {
  if (!fileName || !fileName.trim()) return;
  fileName = fileName.trim();

  try {
    // Get parent directory handle
    let parentHandle = rootHandle;
    if (parentNode.path) {
      const pathParts = parentNode.path.split('/');
      for (const part of pathParts) {
        parentHandle = await parentHandle.getDirectoryHandle(part);
      }
    }

    const fileHandle = await parentHandle.getFileHandle(fileName, { create: true });

    // Boilerplate for HTML files
    if (fileName.toLowerCase().endsWith('.html')) {
      const boilerplate = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
</head>
<body>
    
</body>
</html>`;
      const writable = await fileHandle.createWritable();
      await writable.write(boilerplate);
      await writable.close();
    }

    // Refresh tree
    creatingNewItem = null;
    fileHandles.clear();
    fileContent.clear();
    fileTree = { children: new Map(), name: rootHandle.name, path: '', kind: 'directory' };
    await scanDirectory(rootHandle, fileTree);
    renderFileTree();

    // Open it
    const newPath = parentNode.path ? `${parentNode.path}/${fileName}` : fileName;
    await loadFile(newPath);
  } catch (err) {
    console.error("Error creating file:", err);
    alert("Could not create file. " + err.message);
    creatingNewItem = null;
    renderFileTree();
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

// --- Context Menu ---

let contextMenu = null;

function showContextMenu(x, y, node) {
  // Remove existing menu
  if (contextMenu) {
    contextMenu.remove();
  }

  contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;

  const menuItems = [];

  // Rename option
  menuItems.push({
    label: 'Rename',
    icon: '✏️',
    action: () => renameItem(node)
  });

  // Delete option
  menuItems.push({
    label: 'Delete',
    icon: '🗑️',
    action: () => deleteItem(node)
  });

  menuItems.forEach(item => {
    const menuItem = document.createElement('div');
    menuItem.className = 'context-menu-item';
    menuItem.innerHTML = `<span class="menu-icon">${item.icon}</span><span>${item.label}</span>`;
    menuItem.onclick = () => {
      item.action();
      contextMenu.remove();
      contextMenu = null;
    };
    contextMenu.appendChild(menuItem);
  });

  document.body.appendChild(contextMenu);

  // Close menu on click outside
  const closeMenu = (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
      contextMenu.remove();
      contextMenu = null;
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

async function createNewFolder() {
  if (!rootHandle) {
    alert("Please open a project folder first.");
    return;
  }

  // Set state to show inline input
  creatingNewItem = { type: 'folder', parentNode: fileTree };
  renderFileTree();
}

async function finalizeCreateFolder(folderName, parentNode) {
  if (!folderName || !folderName.trim()) return;
  folderName = folderName.trim();

  try {
    // Get parent directory handle
    let parentHandle = rootHandle;
    if (parentNode.path) {
      const pathParts = parentNode.path.split('/');
      for (const part of pathParts) {
        parentHandle = await parentHandle.getDirectoryHandle(part);
      }
    }

    await parentHandle.getDirectoryHandle(folderName, { create: true });

    // Refresh tree
    creatingNewItem = null;
    fileHandles.clear();
    fileContent.clear();
    fileTree = { children: new Map(), name: rootHandle.name, path: '', kind: 'directory' };
    await scanDirectory(rootHandle, fileTree);
    renderFileTree();
  } catch (err) {
    console.error("Error creating folder:", err);
    alert("Could not create folder. " + err.message);
    creatingNewItem = null;
    renderFileTree();
  }
}

async function renameItem(node) {
  if (!rootHandle) return;
  renamingItem = node;
  renderFileTree();
}

async function finalizeRename(node, newName) {
  try {
    // Get parent directory handle
    const parentPath = node.path.substring(0, node.path.lastIndexOf('/'));
    let parentHandle = rootHandle;

    if (parentPath) {
      const pathParts = parentPath.split('/');
      for (const part of pathParts) {
        parentHandle = await parentHandle.getDirectoryHandle(part);
      }
    }

    // Create new item with new name
    if (node.kind === 'file') {
      // Copy file content
      const oldFile = await node.handle.getFile();
      const content = await oldFile.arrayBuffer();

      const newHandle = await parentHandle.getFileHandle(newName, { create: true });
      const writable = await newHandle.createWritable();
      await writable.write(content);
      await writable.close();

      // Delete old file
      await parentHandle.removeEntry(node.name);
    } else {
      // For directories, recursively copy
      await copyDirectory(node.handle, parentHandle, newName);
      // Delete old directory
      await parentHandle.removeEntry(node.name, { recursive: true });
    }

    // Refresh tree
    renamingItem = null;
    fileHandles.clear();
    fileContent.clear();
    fileTree = { children: new Map(), name: rootHandle.name, path: '', kind: 'directory' };
    await scanDirectory(rootHandle, fileTree);
    renderFileTree();

    // Update openTabs
    openTabs = openTabs.map(path => {
      if (path === node.path) {
        return parentPath ? `${parentPath}/${newName}` : newName;
      }
      if (node.kind === 'directory' && path.startsWith(node.path + '/')) {
        const newPrefix = parentPath ? `${parentPath}/${newName}` : newName;
        return path.replace(node.path, newPrefix);
      }
      return path;
    });

    // If renamed file was open, update handle or close
    if (currentFileHandle === node.handle) {
      currentFileHandle = null;
      document.getElementById('current-file-label').textContent = 'No file open';
      // Re-open if it was a file
      if (node.kind === 'file') {
        const newPath = parentPath ? `${parentPath}/${newName}` : newName;
        await loadFile(newPath);
      } else {
        renderTabs();
      }
    } else {
      renderTabs();
    }
  } catch (err) {
    console.error("Error renaming item:", err);
    alert("Could not rename item. " + err.message);
    renamingItem = null;
    renderFileTree();
  }
}

async function copyDirectory(srcHandle, destParentHandle, newName) {
  const newDirHandle = await destParentHandle.getDirectoryHandle(newName, { create: true });
  for await (const entry of srcHandle.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      const newFileHandle = await newDirHandle.getFileHandle(entry.name, { create: true });
      const writable = await newFileHandle.createWritable();
      await writable.write(file);
      await writable.close();
    } else if (entry.kind === 'directory') {
      await copyDirectory(entry, newDirHandle, entry.name);
    }
  }
}



async function deleteItem(node) {
  if (!rootHandle) return;

  try {
    // Get parent directory handle
    const parentPath = node.path.substring(0, node.path.lastIndexOf('/'));
    let parentHandle = rootHandle;

    if (parentPath) {
      const pathParts = parentPath.split('/');
      for (const part of pathParts) {
        parentHandle = await parentHandle.getDirectoryHandle(part);
      }
    }

    // Remove the entry
    await parentHandle.removeEntry(node.name, { recursive: node.kind === 'directory' });

    // Refresh tree
    fileHandles.clear();
    fileContent.clear();
    fileTree = { children: new Map(), name: rootHandle.name, path: '', kind: 'directory' };
    await scanDirectory(rootHandle, fileTree);
    renderFileTree();

    // Update openTabs
    const wasOpen = openTabs.includes(node.path);
    openTabs = openTabs.filter(path => {
      if (path === node.path) return false;
      if (node.kind === 'directory' && path.startsWith(node.path + '/')) return false;
      return true;
    });

    // If deleted file was open, close it
    if (currentFileHandle === node.handle || (node.kind === 'file' && wasOpen)) {
      currentFileHandle = null;
      document.getElementById('current-file-label').textContent = 'No file open';

      if (openTabs.length > 0) {
        await loadFile(openTabs[0]);
      } else {
        showWelcomeScreen();
      }
    } else {
      renderTabs();
    }
  } catch (err) {
    console.error("Error deleting item:", err);
    alert("Could not delete item. " + err.message);
  }
}

// Start
init();
