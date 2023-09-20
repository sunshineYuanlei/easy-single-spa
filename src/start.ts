import { loadApps } from './application/apps'
import GlobalState from './globalState/GlobalState'
import { originalWindow } from './utils/originalEnv'
import { isInBrowser } from './utils/utils'

let isStarted = false
export default function start() {
    if (!isInBrowser()) {
        throw Error('mini-single-spa must be running in browser!')
    }
   
    if (!isStarted) { // 性能优化, 加载所有子应用这个动作只执行一次!
        // 实例化GlobalState类并挂靠在window上面
        originalWindow.spaGlobalState = new GlobalState()
        isStarted = true
        // 加载所有子应用
        loadApps()
    }
}

export function isStart() {
    return isStarted
}