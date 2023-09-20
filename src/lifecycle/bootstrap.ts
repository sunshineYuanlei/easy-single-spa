import Sandbox from '../sandbox/Sandbox'
import { addStyles } from '../utils/dom'
import { executeScripts, parseHTMLandLoadSources } from '../utils/source'
import { isFunction, isObject } from '../utils/utils'
import { AnyObject, Application, AppStatus } from '../types'
import { isSandboxEnabled, triggerAppHook } from '../utils/application'
import { originalWindow } from '../utils/originalEnv'

// 子应用首次加载执行一次bootstrapApp
export default async function bootstrapApp(app: Application) {
    // 第一步: 执行钩子函数后加载js和css资源

    // 执行钩子函数 beforeBootstrap
    triggerAppHook(app, 'beforeBootstrap', AppStatus.BEFORE_BOOTSTRAP)

    try {
        // 加载 js和css。其中, 全局js和全局css各自加载一次, 其它的放在app配置中(app.styles, app.scripts)。
        await parseHTMLandLoadSources(app)
    } catch (error) {
        app.status = AppStatus.BOOTSTRAP_ERROR
        throw error
    }
    
    // 第二步: 如果开启了沙箱功能则初始化沙箱后开启沙箱
    // 开启沙箱
    if (isSandboxEnabled(app)) {
        app.sandbox = new Sandbox(app)
        app.sandbox.start()
    }
    
    // 第三步: 执行资源(已填充)
    app.container.innerHTML = app.pageBody

    // 执行子应用入口页面的 style script 标签
    // 通过前面的sandbox中patchDocument中的patchAddChild和createElement的改造, 添加打点的样式
    addStyles(app.styles)
    executeScripts(app.scripts, app)
    
    // 第四步: 获取并校验子应用生命周期钩子函数并挂靠到app上
    const { mount, unmount } = await getLifeCycleFuncs(app)

    validateLifeCycleFunc('mount', mount)
    validateLifeCycleFunc('unmount', unmount)

    app.mount = mount
    app.unmount = unmount
    
    // 第五步: 初始化app的props并清空首次加载的scripts(杂项)

    // 初始化app的props
    try {
        app.props = await getProps(app.props)
    } catch (err) {
        app.status = AppStatus.BOOTSTRAP_ERROR
        throw err
    }
    
    // 子应用首次加载的脚本执行完就不再需要了
    // 等同于app.scripts = []
    app.scripts.length = 0

    // 第六步: 记录window快照便于重新挂载子应用时恢复快照
    if (isSandboxEnabled(app)) {
        // 记录当前的 window 快照/备份，重新挂载子应用时恢复
        app.sandbox.recordWindowSnapshot() 
    }
    
    // 执行钩子函数 bootstrapped
    triggerAppHook(app, 'bootstrapped', AppStatus.BOOTSTRAPPED)
}

async function getProps(props: AnyObject | (() => AnyObject)) {
    if (isFunction(props)) return (props as () => AnyObject)()
    if (isObject(props)) return props
    return {}
}

function validateLifeCycleFunc(name: string, fn: any) {
    if (!isFunction(fn)) {
        throw Error(`The "${name}" must be a function`)
    }
}

async function getLifeCycleFuncs(app: Application) {
    let result = originalWindow.__SINGLE_SPA__
    if (isSandboxEnabled(app)) {
        result = app.sandbox.proxyWindow.__SINGLE_SPA__
    }
     
    if (isFunction(result)) {
        return result()
    }

    if (isObject(result)) {
        return result
    }

    // eslint-disable-next-line no-restricted-globals
    throw Error('The micro app must inject the lifecycle("bootstrap" "mount" "unmount") into window.__SINGLE_SPA__')
}