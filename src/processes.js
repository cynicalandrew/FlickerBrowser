const { ipcRenderer } = require('electron');
const path = require('path');

// Global state
let tabs = [];
let activeTab = 0;
let draggedTab = null;
let popupWebview = null;
let popupContainer = null;
let urlBarClickCount = 0;
let urlBarClickTimeout = null;
let isTextSelected = false;

// DOM elements - cached for performance
const elements = {
  searchInput: document.getElementById('url-input'),
  newTabButton: document.getElementById('new-tab'),
  tabsContainer: document.getElementById('tabs-container'),
  towerButton: document.getElementById('tower-button'),
  refreshButton: document.getElementById('refresh-button'),
  forwardButton: document.getElementById('forward-button'),
  backwardButton: document.getElementById('back-button'),
  tower: document.getElementById('tower')
};

// === AUDIO SYSTEM ===
function setupAudio() {
  // Override Audio constructor to set default volume
  const originalAudio = window.Audio;
  window.Audio = function (src) {
    const audio = new originalAudio(src);
    audio.volume = 0.3;
    return audio;
  };
}

// Audio files
const sounds = {
  start: new Audio('../assets/menu_decision.wav'),
  exit: new Audio('../assets/menu_cancel.wav'),
  text: new Audio('../assets/text.wav'),
  tabOpen: new Audio('../assets/tick.wav'),
  tabClose: new Audio('../assets/tock.wav'),
  backspace: new Audio('../assets/menu_buzzer.wav'),
  enter: new Audio('../assets/menu_cursor.wav')
};

function playSound(soundName) {
  const sound = sounds[soundName];
  if (sound) {
    sound.currentTime = 0;
    sound.play().catch(() => {});
  }
}

// === URL BAR MANAGEMENT ===
function setupUrlBar() {
  const { searchInput } = elements;
  
  // Focus/blur handlers
  searchInput.addEventListener('focus', () => {
    searchInput.style.color = 'rgba(245, 198, 0, 1)';
  });

  searchInput.addEventListener('blur', () => {
    searchInput.style.color = 'rgba(245, 198, 0, 0.4)';
    urlBarClickCount = 0;
    isTextSelected = false;
  });

  // Click handling for text selection
  searchInput.addEventListener('mousedown', (e) => {
    e.preventDefault(); // Prevent default selection behavior
  });

  searchInput.addEventListener('click', handleUrlBarClick);
  searchInput.addEventListener('input', () => {
    searchInput.style.color = '#F5C600';
  });
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchOrGo();
  });

  // Set initial style
  searchInput.style.color = 'rgba(245, 198, 0, 0.4)';
}

function handleUrlBarClick(e) {
  e.preventDefault();
  urlBarClickCount++;
  
  if (urlBarClickCount === 1 && !isTextSelected) {
    // First click - select all text
    setTimeout(() => {
      elements.searchInput.select();
      isTextSelected = true;
      urlBarClickCount = 0;
    }, 0);
  } else if (isTextSelected) {
    // Second click while text is selected - position cursor
    positionCursorAtClick(e);
    isTextSelected = false;
    urlBarClickCount = 0;
  }
}

function positionCursorAtClick(e) {
  const { searchInput } = elements;
  const rect = searchInput.getBoundingClientRect();
  const clickX = e.clientX - rect.left - 8; // subtract left padding
  const inputStyle = window.getComputedStyle(searchInput);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = `${inputStyle.fontSize} ${inputStyle.fontFamily}`;
  
  // Find cursor position by measuring text width
  let cursorPosition = 0;
  for (let i = 0; i <= searchInput.value.length; i++) {
    const textWidth = context.measureText(searchInput.value.substring(0, i)).width;
    if (textWidth >= clickX) {
      cursorPosition = i;
      break;
    }
  }
  
  // Position cursor and clear selection
  searchInput.setSelectionRange(cursorPosition, cursorPosition);
}

// === TITLE BAR ===
function setupTitleBar() {
  document.getElementById('close').addEventListener('click', () => 
    ipcRenderer.send('window-close'));
  document.getElementById('minimize').addEventListener('click', () => 
    ipcRenderer.send('window-minimize'));
  document.getElementById('maximize').addEventListener('click', () => 
    ipcRenderer.send('window-maximize'));
}

// === TOWER TOGGLE ===
function setupTowerToggle() {
  elements.towerButton.addEventListener('click', () => {
    elements.tower.classList.toggle('collapsed');
    elements.towerButton.src = elements.towerButton.src.includes('RightArrowLight.png')
      ? '../assets/LeftArrowLight.png'
      : '../assets/RightArrowLight.png';
  });
}

// === TAB MANAGEMENT ===
function createTab(url = null) {
  // Handle Google sign-in popup routing
  if (url && isGoogleSignInUrl(url)) {
    openPopup(url);
    return;
  }

  const tabIndex = tabs.length;
  const isHome = !url;

  // Play sound for new tabs (except first one)
  if (tabIndex !== 0) {
    playSound('tabOpen');
  }

  // Create webview
  const newWebView = createWebview(isHome ? `file://${path.join(__dirname, 'home.html')}` : url);
  
  // Create tab button
  const { button, titleSpan, closeSpan } = createTabButton(tabIndex, isHome);

  // Create tab object
  const tab = { 
    webview: newWebView, 
    button, 
    titleSpan, 
    isHome, 
    currentUrl: newWebView.src 
  };
  tabs.push(tab);

  // Setup event listeners
  setupTabEventListeners(tab, closeSpan);
  attachWebviewListeners(tab);
  makeTabsDraggable();
  
  switchTab(tabs.indexOf(tab));
  elements.searchInput.focus();
}

function createWebview(src) {
  const webview = document.createElement('webview');
  webview.src = src;
  webview.setAttribute('partition', 'persist:main');
  webview.setAttribute('allowpopups', '');
  webview.setAttribute(
    'webpreferences',
    'nativeWindowOpen=yes,contextIsolation=yes,nodeIntegrationInSubFrames=yes,webSecurity=false'
  );
  
  // Set styles
  Object.assign(webview.style, {
    flex: '1 1 0',
    width: '100%',
    height: '100%',
    display: 'none',
    borderRadius: '10px',
    overflow: 'hidden',
    backgroundColor: 'transparent'
  });
  
  document.getElementById('webviews-container').appendChild(webview);
  return webview;
}

function createTabButton(tabIndex, isHome) {
  const button = document.createElement('button');
  button.className = 'tab-btn';
  button.dataset.tab = tabIndex;
  button.setAttribute('draggable', true);

  const titleSpan = document.createElement('span');
  titleSpan.textContent = isHome ? 'Flicker' : 'Loading...';
  button.appendChild(titleSpan);

  const closeSpan = document.createElement('span');
  closeSpan.textContent = ' x';
  closeSpan.style.fontSize = '16px';
  closeSpan.className = 'close-tab';
  closeSpan.style.cursor = 'pointer';
  closeSpan.style.lineHeight = '1';
  closeSpan.style.paddingLeft = '1px';
  closeSpan.style.paddingBottom = '2px';
  button.appendChild(closeSpan);

  elements.newTabButton.before(button);
  return { button, titleSpan, closeSpan };
}

function setupTabEventListeners(tab, closeSpan) {
  tab.button.addEventListener('click', () => switchTab(tabs.indexOf(tab)));
  closeSpan.addEventListener('click', e => {
    e.stopPropagation();
    closeTab(tabs.indexOf(tab)); // Get fresh index each time
  });

  // Show/hide close button on hover
  tab.button.addEventListener('mousemove', e => {
    const rect = tab.button.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const threshold = rect.width * 0.7;
    closeSpan.style.display = mouseX > threshold ? 'block' : 'none';
  });
  
  tab.button.addEventListener('mouseleave', () => {
    closeSpan.style.display = 'none';
  });
}

function switchTab(index) {
  if (index < 0 || index >= tabs.length) return;
  
  tabs.forEach((tab, i) => {
    tab.webview.style.display = i === index ? 'flex' : 'none';
    tab.button.classList.toggle('active', i === index);
  });
  
  activeTab = index;
  const tab = tabs[activeTab];
  
  // Update URL bar
  updateUrlBar(tab);
  document.title = tab.titleSpan.textContent;
}

function updateUrlBar(tab) {
  if (tab.isHome) {
    elements.searchInput.value = '';
  } else {
    // For non-home tabs, always show the current URL
    elements.searchInput.value = tab.currentUrl || tab.webview.src;
  }
}

function closeTab(index) {
  if (index < 0 || index >= tabs.length) return;
  
  // Check if this will be the last tab before removing it
  const isLastTab = tabs.length === 1;
  
  const tab = tabs[index];
  tab.webview.remove();
  tab.button.remove();
  tabs.splice(index, 1);

  // If this was the last tab, close the application (no sound)
  if (isLastTab) {
    ipcRenderer.send('window-close');
    return;
  }

  // Play sound only if there are remaining tabs
  playSound('tabClose');

  // Update tab indices
  tabs.forEach((t, i) => (t.button.dataset.tab = i));
  if (activeTab >= tabs.length) activeTab = tabs.length - 1;
  switchTab(activeTab);
}

function reloadTab() {
  const tab = tabs[activeTab];
  if (tab?.webview) tab.webview.reload();
}

// === NAVIGATION ===
function isURL(str) {
  return /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(:\d+)?(\/\S*)?$/i.test(str);
}

function searchOrGo() {
  let query = elements.searchInput.value.trim();
  if (!query) return;
  
  const tab = tabs[activeTab];
  if (isURL(query)) {
    if (!/^https?:\/\//i.test(query)) query = 'http://' + query;
    tab.webview.src = query;
    tab.currentUrl = query;
  } else {
    const searchUrl = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;
    tab.webview.src = searchUrl;
    tab.currentUrl = searchUrl;
  }
  
  tab.isHome = false;
  elements.searchInput.style.color = '#F5C600';
  
  // Focus the webview to remove focus from URL bar
  tab.webview.focus();
  elements.searchInput.blur();
}

// === POPUP HANDLING ===
function isGoogleSignInUrl(url) {
  return /https:\/\/accounts\.google\.com/.test(url);
}

function openPopup(url) {
  closePopup();

  popupContainer = document.createElement('div');
  popupContainer.style.width = '800px';
  popupContainer.style.height = '600px';
  popupContainer.style.position = 'absolute';
  popupContainer.style.top = '50px';
  popupContainer.style.left = '50px';
  popupContainer.style.borderRadius = '10px';
  popupContainer.style.overflow = 'hidden';
  popupContainer.style.backgroundColor = '#fff';

  popupWebview = document.createElement('webview');
  popupWebview.style.width = '100%';
  popupWebview.style.height = '100%';
  popupWebview.setAttribute(
    'webpreferences',
    'nativeWindowOpen=yes,contextIsolation=yes,nodeIntegrationInSubFrames=yes,webSecurity=false'
  );
  popupWebview.setAttribute('allowpopups', '');
  popupWebview.setAttribute('partition', 'persist:main');
  popupContainer.appendChild(popupWebview);
  document.body.appendChild(popupContainer);

  popupWebview.src = url;

  popupWebview.addEventListener('did-navigate', e => {
    if (!isGoogleSignInUrl(e.url)) {
      tabs[activeTab].webview.src = e.url;
      tabs[activeTab].currentUrl = e.url;
      setTimeout(() => closePopup(), 2000);
    }
  });

  popupWebview.addEventListener('close', () => closePopup());
}

function closePopup() {
  if (popupWebview || popupContainer) {
    if (popupWebview) popupWebview.remove();
    if (popupContainer) popupContainer.remove();
    popupWebview = null;
    popupContainer = null;
  }
}

// === WEBVIEW LISTENERS ===
function attachWebviewListeners(tab) {
  const { webview, titleSpan } = tab;

  webview.addEventListener('page-title-updated', e => {
    titleSpan.textContent = e.title || (tab.isHome ? 'Flicker' : 'New Tab');
    if (tabs[activeTab] === tab) document.title = titleSpan.textContent;
  });

  const updateUrlBar = () => {
    if (tabs[activeTab] === tab) {
      if (tab.isHome) {
        elements.searchInput.value = '';
      } else {
        // For non-home pages, always show the current URL
        const currentUrl = webview.getURL ? webview.getURL() : webview.src;
        elements.searchInput.value = currentUrl;
        tab.currentUrl = currentUrl;
      }
    }
  };

  const handleNavigation = e => {
    // Check if this is actually navigating away from the home page
    const isLeavingHome = tab.isHome && !e.url.includes('home.html') && !e.url.startsWith('file://');
    
    if (isLeavingHome) {
      tab.isHome = false;
    }
    
    tab.currentUrl = e.url;
    updateUrlBar();
  };

  // Navigation event listeners
  const navigationEvents = [
    'will-navigate', 'did-navigate', 'did-navigate-in-page', 
    'did-start-loading', 'did-stop-loading', 'did-finish-load', 'dom-ready'
  ];

  navigationEvents.forEach(eventName => {
    webview.addEventListener(eventName, 
      eventName.includes('loading') || eventName === 'did-finish-load' || eventName === 'dom-ready' 
        ? updateUrlBar : handleNavigation
    );
  });

  webview.addEventListener('new-window', e => {
    e.preventDefault();
    if (isGoogleSignInUrl(e.url)) {
      openPopup(e.url);
    } else {
      createTab(e.url || 'about:blank');
    }
  });
}

// === DRAG & DROP ===
function makeTabsDraggable() {
  tabs.forEach(tab => {
    const btn = tab.button;

    btn.addEventListener('dragstart', e => {
      draggedTab = tab;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
    });

    btn.addEventListener('dragover', e => {
      e.preventDefault();
      const targetTab = tabs.find(t => t.button === e.currentTarget);
      if (!targetTab || targetTab === draggedTab) return;

      const targetIndex = tabs.indexOf(targetTab);
      const draggedIndex = tabs.indexOf(draggedTab);

      if (draggedIndex < targetIndex)
        elements.tabsContainer.insertBefore(draggedTab.button, targetTab.button.nextSibling);
      else elements.tabsContainer.insertBefore(draggedTab.button, targetTab.button);
    });

    btn.addEventListener('drop', e => {
      e.preventDefault();
      tabs = Array.from(elements.tabsContainer.querySelectorAll('.tab-btn')).map(btnEl =>
        tabs.find(t => t.button === btnEl)
      );
      tabs.forEach((t, i) => (t.button.dataset.tab = i));
    });

    btn.addEventListener('dragend', () => {
      draggedTab = null;
    });
  });
}

// === EVENT LISTENERS ===
function setupEventListeners() {
  // Navigation buttons
  elements.forwardButton.addEventListener('click', () => {
    const tab = tabs[activeTab];
    if (tab.webview.canGoForward()) tab.webview.goForward();
  });
  
  elements.backwardButton.addEventListener('click', () => {
    const tab = tabs[activeTab];
    if (tab.webview.canGoBack()) tab.webview.goBack();
  });

  // New tab and refresh
  elements.refreshButton.addEventListener('click', searchOrGo);
  elements.newTabButton.addEventListener('click', () => createTab());

  // Global keyboard sounds
  document.addEventListener('keydown', e => {
    if (e.key.length === 1) playSound('text');
    if (e.key === 'Enter') playSound('enter');
    if (e.key === 'Backspace') playSound('backspace');
  });
}

// === IPC HANDLERS ===
function setupIpcHandlers() {
  ipcRenderer.on('play-exit-sound', () => {
    sounds.exit.play();
    sounds.exit.onended = () => ipcRenderer.send('close-window-okay');
  });

  ipcRenderer.on('open-url-in-new-tab', (event, url) => {
    createTab(url);
  });
  
  ipcRenderer.on('reload-active-tab', () => reloadTab());
  ipcRenderer.on('open-new-tab', () => createTab());
  ipcRenderer.on('reopen-last-tab', () => {});
}

// === INITIALIZATION ===
function init() {
  setupAudio();
  setupTitleBar();
  setupTowerToggle();
  setupUrlBar();
  setupEventListeners();
  setupIpcHandlers();
  
  // Play start sound and create first tab
  sounds.start.play();
  createTab();
}

// Start the application
init();