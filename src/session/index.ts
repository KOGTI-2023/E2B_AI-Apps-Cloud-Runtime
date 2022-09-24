import SessionConnection, {
  SessionConnectionOpts,
} from './sessionConnection'
import {
  CodeSnippetManager,
  CodeSnippetStateHandler,
  CodeSnippetStderrHandler,
  CodeSnippetStdoutHandler,
  codeSnippetService,
  CodeSnippetExecState,
  ScanOpenedPortsHandler,
} from './codeSnippet'
import {
  TerminalManager,
  terminalService,
} from './terminal'
import {
  FilesystemManager,
  FileInfo,
  filesystemService,
} from './filesystem'
import {
  ProcessManager,
  processService,
} from './process'
import { id } from '../utils/id'
import {
  createDeferredPromise,
  evaluateSettledPromises,
  formatSettledErrors,
} from '../utils/promise'

export interface CodeSnippetOpts {
  onStateChange?: CodeSnippetStateHandler
  onStderr?: CodeSnippetStderrHandler
  onStdout?: CodeSnippetStdoutHandler
  onScanPorts?: ScanOpenedPortsHandler
}

export interface SessionOpts extends SessionConnectionOpts {
  codeSnippet?: CodeSnippetOpts
}

class Session extends SessionConnection {
  private readonly codeSnippetOpts?: CodeSnippetOpts

  codeSnippet?: CodeSnippetManager
  terminal?: TerminalManager
  filesystem?: FilesystemManager
  process?: ProcessManager

  constructor(opts: SessionOpts) {
    super(opts)
    this.codeSnippetOpts = opts.codeSnippet
  }


  async open() {
    await super.open()

    await this.handleSubscriptions(
      this.codeSnippetOpts?.onStateChange
        ? this.subscribe(codeSnippetService, this.codeSnippetOpts.onStateChange, 'state')
        : undefined,
      this.codeSnippetOpts?.onStderr
        ? this.subscribe(codeSnippetService, this.codeSnippetOpts.onStderr, 'stderr')
        : undefined,
      this.codeSnippetOpts?.onStdout
        ? this.subscribe(codeSnippetService, this.codeSnippetOpts.onStdout, 'stdout')
        : undefined,
      this.codeSnippetOpts?.onScanPorts
        ? this.subscribe(codeSnippetService, this.codeSnippetOpts.onScanPorts, 'scanOpenedPorts')
        : undefined,
    )

    // Init CodeSnippet handler
    this.codeSnippet = {
      run: async (code, envVars = {}) => {
        const state = await this.call(codeSnippetService, 'run', [code, envVars]) as CodeSnippetExecState
        this.codeSnippetOpts?.onStateChange?.(state)
        return state
      },
      stop: async () => {
        const state = await this.call(codeSnippetService, 'stop') as CodeSnippetExecState
        this.codeSnippetOpts?.onStateChange?.(state)
        return state
      },
    }

    // Init Filesystem handler
    this.filesystem = {
      listAllFiles: async (path) => {
        return await this.call(filesystemService, 'listAllFiles', [path]) as FileInfo[]
      },
      removeFile: async (path) => {
        await this.call(filesystemService, 'removeFile', [path])
      },
      writeFile: async (path, content) => {
        await this.call(filesystemService, 'writeFile', [path, content])
      },
      readFile: async (path) => {
        return await this.call(filesystemService, 'readFile', [path]) as string
      },
    }

    // Init Terminal handler
    this.terminal = {
      killProcess: async (pid) => {
        await this.call(terminalService, 'killProcess', [pid])
      },
      createSession: async ({
        onData,
        onChildProcessesChange,
        size,
        terminalID = id(12),
      }) => {
        const [
          onDataSubID,
          onChildProcessesChangeSubID,
        ] = await this.handleSubscriptions(
          this.subscribe(terminalService, onData, 'onData', terminalID),
          onChildProcessesChange ? this.subscribe(terminalService, onChildProcessesChange, 'onChildProcessesChange', terminalID) : undefined,
        )

        try {
          await this.call(terminalService, 'start', [terminalID, size.cols, size.rows])
        } catch (err) {
          const results = await Promise.allSettled([
            this.unsubscribe(onDataSubID),
            onChildProcessesChangeSubID ? this.unsubscribe(onChildProcessesChangeSubID) : undefined,
          ])

          const errMsg = formatSettledErrors(results)
          if (errMsg) {
            this.logger.error()
          }

          throw err
        }

        return {
          terminalID,
          destroy: async () => {
            const results = await Promise.allSettled([
              this.unsubscribe(onDataSubID),
              onChildProcessesChangeSubID ? this.unsubscribe(onChildProcessesChangeSubID) : undefined,
              await this.call(terminalService, 'destroy', [terminalID])
            ])

            evaluateSettledPromises(results)
          },
          sendData: async (data) => {
            await this.call(terminalService, 'data', [terminalID, data])
          },
          resize: async ({ cols, rows }) => {
            await this.call(terminalService, 'resize', [terminalID, cols, rows])
          },
        }
      }
    }

    // Init Process handler
    this.process = {
      start: async ({
        cmd,
        onStdout,
        onStderr,
        onExit,
        envVars = {},
        rootdir = '/',
        processID = id(12),
      }) => {

        const {
          promise: processExited,
          resolve: triggerExit,
        } = createDeferredPromise()

        const [
          onExitSubID,
          onStdoutSubID,
          onStderrSubID,
        ] = await this.handleSubscriptions(
          onExit ? this.subscribe(processService, triggerExit, 'onExit', processID) : undefined,
          onStdout ? this.subscribe(processService, onStdout, 'onStdout', processID) : undefined,
          onStderr ? this.subscribe(processService, onStderr, 'onStderr', processID) : undefined,
        )

        const {
          promise: unsubscribing,
          resolve: handleFinishUnsubscribing,
        } = createDeferredPromise()

        processExited.then(async () => {
          const results = await Promise.allSettled([
            onExitSubID ? this.unsubscribe(onExitSubID) : undefined,
            onStdoutSubID ? this.unsubscribe(onStdoutSubID) : undefined,
            onStderrSubID ? this.unsubscribe(onStderrSubID) : undefined,
          ])

          const errMsg = formatSettledErrors(results)
          if (errMsg) {
            this.logger.error(errMsg)
          }

          onExit?.()
          handleFinishUnsubscribing()
        })

        try {
          await this.call(processService, 'start', [processID, cmd, envVars, rootdir])
        } catch (err) {
          triggerExit()
          await unsubscribing
          throw err
        }

        return {
          processID,
          kill: async () => {
            try {
              await this.call(processService, 'kill', [processID])
            } finally {
              triggerExit()
              await unsubscribing
            }
          },
          sendStdin: async (data) => {
            await this.call(processService, 'stdin', [processID, data])
          },
        }
      }
    }
  }
}

export default Session
