/** Generates a mock vscode module for Node.js test environments. */
export function createVscodeStubSource() {
  return `const noop = () => undefined
const disposable = { dispose: noop }
const event = () => (() => disposable)

class Disposable {
  constructor(dispose) {
    this._dispose = typeof dispose === 'function' ? dispose : noop
  }
  dispose() {
    this._dispose()
  }
}

class EventEmitter {
  constructor() {
    this.event = event()
  }
  fire() {}
  dispose() {}
}

class MarkdownString {
  constructor() {
    this.value = ''
    this.supportThemeIcons = false
    this.supportHtml = false
    this.isTrusted = false
  }
  appendMarkdown(text) {
    this.value += String(text)
  }
  appendText(text) {
    this.value += String(text)
  }
}

class RelativePattern {
  constructor(base, pattern) {
    this.baseUri = base
    this.pattern = pattern
  }
}

class Uri {
  constructor(fsPath) {
    this.fsPath = fsPath
  }
  static file(fsPath) {
    return new Uri(fsPath)
  }
  static joinPath(base, ...parts) {
    return new Uri([base.fsPath, ...parts].join('/'))
  }
  toString() {
    return this.fsPath
  }
}

function makeQuickPick() {
  return {
    dispose: noop,
    show: noop,
    hide: noop,
    onDidAccept: event(),
    onDidHide: event(),
    onDidChangeSelection: event(),
    onDidChangeValue: event(),
    items: [],
    selectedItems: [],
    busy: false,
    enabled: true,
  }
}

function makeTerminal() {
  return {
    dispose: noop,
    show: noop,
    hide: noop,
    sendText: noop,
    name: '',
  }
}

function makeStatusBarItem() {
  return {
    dispose: noop,
    show: noop,
    hide: noop,
    text: '',
    tooltip: '',
    command: undefined,
  }
}

function makeConfiguration() {
  return {
    get: () => undefined,
    has: () => false,
    inspect: () => undefined,
    update: async () => undefined,
  }
}

function formatMessage(message, args) {
  return String(message).replace(/\{(\d+)\}/g, (_, index) => {
    const value = args[Number(index)]
    return value === undefined ? '' : String(value)
  })
}

function createDeferredProxy(target = {}) {
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) {
        return obj[prop]
      }
      return createDeferredProxy()
    },
    apply() {
      return createDeferredProxy()
    },
    construct() {
      return createDeferredProxy()
    },
  })
}

const commands = {
  executeCommand: async () => undefined,
  getCommands: async () => [],
  registerCommand: () => disposable,
}

const window = {
  state: { focused: false },
  createQuickPick: makeQuickPick,
  createTerminal: makeTerminal,
  createStatusBarItem: makeStatusBarItem,
  showErrorMessage: async () => undefined,
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showInputBox: async () => undefined,
  showOpenDialog: async () => undefined,
  showSaveDialog: async () => undefined,
  showQuickPick: async () => undefined,
  onDidChangeWindowState: () => disposable,
}

const workspace = {
  getConfiguration: () => makeConfiguration(),
  createFileSystemWatcher: () => disposable,
  onDidChangeConfiguration: () => disposable,
  workspaceFolders: undefined,
}

const env = {
  remoteName: undefined,
  clipboard: {
    writeText: async () => undefined,
  },
}

const l10n = {
  t: (message, ...args) => formatMessage(message, args),
}

module.exports = createDeferredProxy({
  commands,
  window,
  workspace,
  env,
  l10n,
  Uri,
  RelativePattern,
  Disposable,
  EventEmitter,
  MarkdownString,
  StatusBarAlignment: { Left: 0, Right: 1 },
  QuickPickItemKind: { Separator: -1 },
})
`
}
