/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import deepCopy from '../utils/deepCopy'
import { Application, MicroWindow } from '../types'
import { temporarySetCurrentAppName } from '../utils/application'
import { isFunction } from '../utils/utils'
import { patchDocument, releaseDocument } from './patchDocument'
import {
    documentEventMap,
    patchDocumentEvents,
    releaseAppDocumentEvents,
    releaseDocumentEvents,
} from './patchDocumentEvents'
import { getEventTypes } from '../utils/dom'
import {
    originalWindowAddEventListener,
    originalWindowRemoveEventListener,
    originalDocument,
    originalEval,
    originalWindow,
    originalDocumentAddEventListener,
    originalDefineProperty,
} from '../utils/originalEnv'

/**
 * js 沙箱，用于隔离子应用 window 作用域
 */
export default class Sandbox {
  // 当前存活的子应用数量
  static activeCount = 0
  // 子应用 window 的代理对象
  public proxyWindow: MicroWindow = {}
  // 子应用 window 对象
  public microAppWindow: MicroWindow = {}
  // 子应用名称
  private appName = ''
  // 记录子应用第一次 mount() 前的 window 快照
  private windowSnapshot = new Map<string | symbol, Map<string | symbol, any>>()
  // 是否开启沙箱
  private active = false
  // 子应用向 window 注入的 key
  private injectKeySet = new Set<string | symbol>()
  // 子应用 setTimeout 集合，退出子应用时清除
  private timeoutSet = new Set<number>()
  // 子应用 setInterval 集合，退出子应用时清除
  private intervalSet = new Set<number>()
  // 子应用 requestIdleCallback 集合，退出子应用时清除
  private idleSet = new Set<number>()
  // 子应用绑定到 window 上的事件，退出子应用时清除
  private windowEventMap = new Map<
    string | symbol,
    { listener: any; options: any }[]
  >()
  // 子应用 window onxxx 事件集合，退出子应用时清除
  private onWindowEventMap = new Map<
    string,
    EventListenerOrEventListenerObject
  >()

  // 功能集一
  constructor(app: Application) {
      this.appName = app.name

      // 两件事
      // 初始化windowSnapshot的数据结构
      // 代理了 window、document 的 addEventListener 和 window.onxxx 事件, 以及其它注入子window的属性attrs
      this.windowSnapshot.set('attrs', new Map<string | symbol, any>())
      this.windowSnapshot.set('windowEvents', new Map<string | symbol, any>())
      this.windowSnapshot.set('onWindowEvents', new Map<string | symbol, any>())
      this.windowSnapshot.set('documentEvents', new Map<string | symbol, any>()) // 比较特别的处理

      // 劫持window属性
      // 1. 做事件一层包装, 从而间接操作window事件实现子window的对应api; 同时做一个记录
      // 2. 对属性做一层挂载
      // 3. 劫持 window.onxxx 事件

      // 核心是对特殊的事件做一个自我管理和实现, 并挂载对应变量
      // [setInterval,clearInterval,intervalSet], [setTimeout,clearTimeout,timeoutSet], [requestIdleCallback,cancelIdleCallback,idleSet],
      // [addEventListener, removeEventListener, windowEventMap],[onEventType, onWindowEventMap]

      // microAppWindow.eval = originalEval
      // microAppWindow.document = originalDocument
      // microAppWindow.originalWindow = originalWindow
      // microAppWindow.window = microAppWindow

      this.hijackProperties()

      // 1. 创建代理以实现 originalWindow + microAppWindow 的全部属性对应的操作, 包括window原生方法的this绑定;
      // 2. 在set和deleteProperty时通过全局变量injectKeySet做记录和删除, 在defineProperty和getOwnPropertyDescriptor使用局部变量descriptorMap维护
      this.proxyWindow = this.createProxyWindow(app.name)
  }

  // 功能集三
  /**
   * 开启沙箱
   */
  start() {
      if (this.active) return

      this.active = true
      // 如果当前子应用为第一个
      if (++Sandbox.activeCount === 1) {
          patchDocument() // 特别注意
          patchDocumentEvents() // 特别注意
      }
  }

  /**
   * 关闭沙箱
   */
  stop() {
      if (!this.active) return
      this.active = false

      const {
          injectKeySet,
          microAppWindow,
          timeoutSet,
          intervalSet,
          idleSet,
          windowEventMap,
          onWindowEventMap,
      } = this

      // 清除子window上的属性
      for (const key of injectKeySet) {
          Reflect.deleteProperty(microAppWindow, key as string | symbol)
      }
      
      // 清除计时器和事件监听, 以及requestIdleCallback
      for (const timer of timeoutSet) {
          originalWindow.clearTimeout(timer)
      }

      for (const timer of intervalSet) {
          originalWindow.clearInterval(timer)
      }

      for (const timer of idleSet) {
          originalWindow.cancelIdleCallback(timer)
      }

      for (const [type, arr] of windowEventMap) {
          for (const item of arr) {
              originalWindowRemoveEventListener.call(
                  originalWindow,
          type as string,
          item.listener,
          item.options,
              )
          }
      }

      getEventTypes().forEach((eventType) => {
          const fn = onWindowEventMap.get(
              eventType,
          ) as EventListenerOrEventListenerObject
          fn
        && originalWindowRemoveEventListener.call(originalWindow, eventType, fn)
      })

      // 释放对应的存储变量
      timeoutSet.clear()
      intervalSet.clear()
      idleSet.clear()

      injectKeySet.clear()

      windowEventMap.clear()
      onWindowEventMap.clear()

      // 特别地, 移除 DocumentEvents 事件监听, 删除记录/删除documentEventMap中的对应子应用的的记录
      // 1.
      releaseAppDocumentEvents(this.appName) // 特别注意

      // 如果所有的子应用都已卸载
      if (--Sandbox.activeCount === 0) {
          releaseDocument() // 特别注意
          // 2.
          releaseDocumentEvents() // 特别注意
      }
  }

  // 功能集二
  /**
   * 记录子应用快照
   */
  recordWindowSnapshot() {
      const { windowSnapshot, microAppWindow } = this
      const recordAttrs = windowSnapshot.get('attrs')!
      const recordWindowEvents = windowSnapshot.get('windowEvents')!
      const recordOnWindowEvents = windowSnapshot.get('onWindowEvents')!
      const recordDocumentEvents = windowSnapshot.get('documentEvents')!

      // createProxyWindow进行初始化
      // 初始化备份
      this.injectKeySet.forEach((key) => {
          recordAttrs.set(key, deepCopy(microAppWindow[key]))
      })

      // hijackProperties进行初始化
      this.windowEventMap.forEach((arr, type) => {
          recordWindowEvents.set(type, deepCopy(arr))
      })

      // hijackProperties进行初始化
      this.onWindowEventMap.forEach((func, type) => {
          recordOnWindowEvents.set(type, func)
      })

      documentEventMap.get(this.appName)?.forEach((arr: any[], type: string) => {
          recordDocumentEvents.set(type, deepCopy(arr))
      })
  }

  /**
   * 恢复子应用快照
   */
  restoreWindowSnapshot() {
      const {
          windowSnapshot,
          injectKeySet,
          microAppWindow,
          windowEventMap,
          onWindowEventMap,
      } = this
      const recordAttrs = windowSnapshot.get('attrs')!
      const recordWindowEvents = windowSnapshot.get('windowEvents')!
      const recordOnWindowEvents = windowSnapshot.get('onWindowEvents')!
      const recordDocumentEvents = windowSnapshot.get('documentEvents')!

      recordAttrs.forEach((value, key) => {
          injectKeySet.add(key) // 使用备份数据进行填充, 因此子应用的scripts只需要执行一次
          // 执行unmount生命周期钩子函数关闭沙箱后再次进入mount生命周期钩子函数开启沙箱后恢复microAppWindow上的数据, 确保只需要在bootstrap生命周期中执行一次子应用scripts即可
          // 操作备份
          microAppWindow[key] = deepCopy(value)
      })

      // 同上
      recordWindowEvents.forEach((arr, type) => {
          windowEventMap.set(type, deepCopy(arr))
          for (const { listener, options } of arr) {
              originalWindowAddEventListener.call(
                  originalWindow,
          type as string,
          listener,
          options,
              )
          }
      })

      recordOnWindowEvents.forEach((func, type) => {
          onWindowEventMap.set(type as string, func)
          originalWindowAddEventListener.call(originalWindow, type as string, func)
      })

      const curMap = documentEventMap.get(this.appName)!
      recordDocumentEvents.forEach((arr, type) => {
          curMap.set(type as string, deepCopy(arr))
          for (const { listener, options } of arr) {
              originalDocumentAddEventListener.call(
                  originalDocument,
          type as string,
          listener,
          options,
              )
          }
      })
  }

  /**
   * 劫持 window 属性
   */
  hijackProperties() {
      const {
          microAppWindow,
          intervalSet,
          timeoutSet,
          idleSet,
          windowEventMap,
          onWindowEventMap,
      } = this

      microAppWindow.setInterval = function setInterval(
          callback: Function,
          timeout?: number | undefined,
          ...args: any[]
      ): number {
          const timer = originalWindow.setInterval(callback, timeout, ...args)
          this.intervalSet.add(timer)
          return timer
      }

      microAppWindow.clearInterval = function clearInterval(
          timer?: number,
      ): void {
          if (timer === undefined) return
          originalWindow.clearInterval(timer)
          intervalSet.delete(timer)
      }

      microAppWindow.setTimeout = function setTimeout(
          callback: Function,
          timeout?: number | undefined,
          ...args: any[]
      ): number {
          const timer = originalWindow.setTimeout(callback, timeout, ...args)
          timeoutSet.add(timer)
          return timer
      }

      microAppWindow.clearTimeout = function clearTimeout(timer?: number): void {
          if (timer === undefined) return
          originalWindow.clearTimeout(timer)
          timeoutSet.delete(timer)
      }

      microAppWindow.requestIdleCallback = function requestIdleCallback(
          callback: (options: any) => any,
          options?: { timeout: number },
      ): number {
          const timer = originalWindow.requestIdleCallback(callback, options)
          idleSet.add(timer)
          return timer
      }

      microAppWindow.cancelIdleCallback = function cancelIdleCallback(
          timer?: number,
      ): void {
          if (timer === undefined) return
          originalWindow.cancelIdleCallback(timer)
          idleSet.delete(timer)
      }

      microAppWindow.addEventListener = function addEventListener(
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions | undefined,
      ) {
          if (!windowEventMap.get(type)) {
              windowEventMap.set(type, [])
          }

          windowEventMap.get(type)?.push({ listener, options })
          return originalWindowAddEventListener.call(
              originalWindow,
              type,
              listener,
              options,
          )
      }

      microAppWindow.removeEventListener = function removeEventListener(
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions | undefined,
      ) {
      // 注意代码健壮性 -->  || []
          const arr = windowEventMap.get(type) || []
          for (let i = 0, len = arr.length; i < len; i++) {
              if (arr[i].listener === listener) {
                  arr.splice(i, 1)
                  break
              }
          }

          return originalWindowRemoveEventListener.call(
              originalWindow,
              type,
              listener,
              options,
          )
      }

      microAppWindow.eval = originalEval
      microAppWindow.document = originalDocument
      // 注意此处window和originalWindow的区分
      microAppWindow.originalWindow = originalWindow
      microAppWindow.window = microAppWindow

      // 劫持 window.onxxx 事件, 比较特殊
      // onxx事件底层由window.addEventListener实现, onWindowEventMap存取对应属性
      getEventTypes().forEach((eventType) => {
          originalDefineProperty(microAppWindow, `on${eventType}`, {
              configurable: true,
              enumerable: true,
              get() {
                  return onWindowEventMap.get(eventType)
              },
              set(val) {
                  onWindowEventMap.set(eventType, val)
                  originalWindowAddEventListener.call(originalWindow, eventType, val)
              },
          })
      })
  }

  /**
   * 创建 window 代理对象
   */
  createProxyWindow(appName: string) {
      const descriptorMap = new Map<
      string | symbol,
      'target' | 'originalWindow'
    >()
    // 作用: 除了get以外主要是做一个记录
      return new Proxy(this.microAppWindow, {
      // 作用:
      // 1. 全量属性读取
      // 2. window 原生方法的 this 指向必须绑在 window 上运行
          get(target, key) {
              temporarySetCurrentAppName(appName) // ?

              // 两种情况
              // 如果存在此属性则直接返回对应的值
              if (Reflect.has(target, key)) {
                  return Reflect.get(target, key)
              }

              // 否则, 此属性必定存在originalWindow上, 是window原生方法
              const result = originalWindow[key]
              // window 原生方法的 this 指向必须绑在 window 上运行，否则会报错 "TypeError: Illegal invocation"
              // e.g: const obj = {}; obj.alert = alert;  obj.alert();
              return isFunction(result) && needToBindOriginalWindow(result)
                  ? result.bind(window)
                  : result
          },

          set: (target, key, value) => {
              if (!this.active) return true

              // 记录子应用注入window的key
              this.injectKeySet.add(key)
              return Reflect.set(target, key, value)
          },

          has(target, key) {
              temporarySetCurrentAppName(appName) // ?
              return key in target || key in originalWindow
          },

          // Object.keys(window)
          // Object.getOwnPropertyNames(window)
          // Object.getOwnPropertySymbols(window)
          // Reflect.ownKeys(window)
          ownKeys(target) {
              temporarySetCurrentAppName(appName) // ?
              const result = Reflect.ownKeys(target).concat(
                  Reflect.ownKeys(originalWindow),
              )
              return Array.from(new Set(result))
          },

          deleteProperty: (target, key) => {
              // 删除注入子应用的key
              this.injectKeySet.delete(key)
              return Reflect.deleteProperty(target, key)
          },

          // Object.getOwnPropertyDescriptor(window, key)
          // Reflect.getOwnPropertyDescriptor(window, key)
          getOwnPropertyDescriptor(target, key) {
              // 为什么不使用 Reflect.getOwnPropertyDescriptor()
              // https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Reflect/getOwnPropertyDescriptor
              if (Reflect.has(target, key)) {
                  // 这里的作用是保证在获取（Object.getOwnPropertyDescriptor）和设置（Object.defineProperty）一个 key 的 descriptor 时，都操作的是同一个对象
                  // 即都操作 proxyWindow 或 originalWindow，否则会报错
                  descriptorMap.set(key, 'target')
                  return Object.getOwnPropertyDescriptor(target, key)
              }

              if (Reflect.has(originalWindow, key)) {
                  descriptorMap.set(key, 'originalWindow')
                  return Object.getOwnPropertyDescriptor(originalWindow, key)
              }
          },

          // Object.defineProperty(window, key, Descriptor)
          defineProperty: (target, key, value) => {
              if (!this.active) return true

              if (descriptorMap.get(key) === 'target') {
                  return Reflect.defineProperty(target, key, value)
              }

              return Reflect.defineProperty(originalWindow, key, value)
          },

          // 返回真正的 window 原型
          getPrototypeOf() {
              return Reflect.getPrototypeOf(originalWindow)
          },
      })
  }
}

// 除了构造函数、类、或使用 call() bind() apply() 绑定了作用域的函数都需要绑定到原始 window 上
export function needToBindOriginalWindow(fn: Function) {
    if (
        fn.toString().startsWith('class')
    || isBoundFunction(fn)
    || (/^[A-Z][\w_]+$/.test(fn.name) && fn.prototype?.constructor === fn)
    ) {
        return false
    }

    return true
}

export function isBoundFunction(fn: Function) {
    return fn?.name?.startsWith('bound ')  
}

 
