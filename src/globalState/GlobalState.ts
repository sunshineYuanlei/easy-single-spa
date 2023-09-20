import { AnyObject, Application, AppStatus } from '../types'
import { getApp, getCurrentAppName, isActive } from '../utils/application'
import EventBus from './EventBus'

type Callback = (state: AnyObject, operator: string, key?: string) => void

export default class GlobalState extends EventBus {
  private state: AnyObject = {}
  private stateChangeCallbacksMap: Map<string, Array<Callback>> = new Map()
  
  // 设置属性值及执行相关的回调
  set(key: string, value: any) {
      this.state[key] = value
      this.emitChange('set', key)
  }

  get(key: string) {
      return this.state[key]
  }

  getAll() {
      return this.state
  }
 
  // 删除属性值及执行相关的回调
  delete(key: string) {
      delete this.state[key]
      this.emitChange('delete', key)
  }
  
  clear() {
      this.state = {}
      this.stateChangeCallbacksMap.clear()
      this.emitChange('clear')
  }
  
  // 事件回调注册
  onChange(callback: Callback) {
      const appName = getCurrentAppName()
      if (!appName) return

      const { stateChangeCallbacksMap } = this
      // 对数据结构负责, 保持代码健壮性
      if (!stateChangeCallbacksMap.get(appName)) {
          stateChangeCallbacksMap.set(appName, [])
      }

      stateChangeCallbacksMap.get(appName)?.push(callback)
  }

  emitChange(operator: string, key?: string) {
      this.stateChangeCallbacksMap.forEach((callbacks, appName) => {
      /**
       * 如果是点击其他子应用或父应用触发全局数据变更，则当前打开的子应用获取到的 app 为 null
       * 所以需要改成用 activeRule 来判断当前子应用是否运行
       */
          // 根据子应用名称获取应用配置
          const app = getApp(appName) as Application
          // 如果是未激活的子应用, 则不做处理
          if (!(isActive(app) && app.status === AppStatus.MOUNTED)) return
          // 定义与使用相统一
          callbacks.forEach((callback) => callback(this.state, operator, key))
      })
  }
  
  // 清除子应用全局状态
  clearGlobalStateByAppName(appName: string) {
      // 清空appName的callbacks
      this.stateChangeCallbacksMap.set(appName, [])
      // 保险起见
      this.clearEventsByAppName(appName)
  }
}
